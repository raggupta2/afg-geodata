import { ApiError } from "../errors/api.error";
import { BoundedAsyncTtlCache } from "../cache/bounded-async-ttl-cache";
import { findAllActiveJourneyConnections } from "../repositories/railway-routing.repository";
import { JourneyConnection, JourneyStation } from "../types/railway-journey";
import {
    railwayRunsOnDay,
    RailwayOperatingDay
} from "../utils/railway-runs-mask";

type TrainBoarding = {
    trainId: string;
    connections: JourneyConnection[];
    startIndex: number;
};

type RailwayGraphSnapshot = {
    version: string;
    expiresAt: number;
    boardingsByStation: Map<string, TrainBoarding[]>;
    connections: JourneyConnection[];
    minimumLegsCache: Map<string, Map<string, number>>;
};

type JourneySearchState = {
    originStationId: string;
    stationId: string;
    arrivalMinute: number;
    estimatedTotalLegs: number;
    rides: JourneyConnection[][];
    visitedStationIds: Set<string>;
    usedTrainIds: Set<string>;
};

type RoundLabel = {
    stationId: string;
    arrivalMinute: number;
    rides: JourneyConnection[][];
    usedTrainIds: Set<string>;
};

export type RailwaySearchOrigin = {
    stationId: string;
    readyMinute: number;
};

export type RailwayPath = {
    originStationId: string;
    destinationStationId: string;
    departureMinute: number;
    arrivalMinute: number;
    connections: JourneyConnection[];
};

export type RailwayProviderResult = {
    graphVersion: string;
    paths: RailwayPath[];
    searchComplete: boolean;
    truncationReason: string | null;
};

type SearchLimits = {
    maxResults: number;
    latestOriginDepartureMinute?: number;
};

const MINUTES_PER_DAY = 24 * 60;
const configuredMaximumTrainLegs = Number(
    process.env.RAILWAY_MAX_TRAIN_LEGS ?? 4
);
const MAX_TRAIN_LEGS = Number.isInteger(configuredMaximumTrainLegs)
    ? Math.min(Math.max(configuredMaximumTrainLegs, 1), 6)
    : 4;
const MAX_SEARCH_DAYS = 3;
export const MAXIMUM_TRAIN_LEGS = MAX_TRAIN_LEGS;
export const RAILWAY_SEARCH_HORIZON_DAYS = MAX_SEARCH_DAYS;
const MAX_EXPANDED_STATES = 30_000;
const MAX_GENERATED_STATES = 200_000;
const MAX_STATES_PER_STATION_DEPTH = 3;
const MAX_MINIMUM_LEG_CACHE_ENTRIES = 128;
export const MINIMUM_RAIL_TRANSFER_MINUTES = 10;
const SNAPSHOT_TTL_MS = Number(
    process.env.RAILWAY_GRAPH_TTL_MS ?? 30 * 60 * 1000
);
const MAX_QUEUED_SEARCHES = Number(
    process.env.RAILWAY_MAX_QUEUED_SEARCHES ?? 100
);
const WEEKDAYS: RailwayOperatingDay[] = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday"
];

let graphSnapshot: RailwayGraphSnapshot | null = null;
let graphLoadPromise: Promise<RailwayGraphSnapshot> | null = null;

class SearchSemaphore {
    private active = 0;
    private readonly queue: Array<() => void> = [];

    constructor(private readonly maximum: number) {}

    async run<Value>(task: () => Promise<Value>): Promise<Value> {
        if (this.active >= this.maximum) {
            if (this.queue.length >= MAX_QUEUED_SEARCHES) {
                throw new ApiError(
                    503,
                    "The railway routing service is busy. Please retry shortly."
                );
            }
            await new Promise<void>(resolve => this.queue.push(resolve));
        }

        this.active += 1;
        try {
            return await task();
        } finally {
            this.active -= 1;
            this.queue.shift()?.();
        }
    }
}

const configuredConcurrency = Number(process.env.RAILWAY_SEARCH_CONCURRENCY ?? 2);
const searchSemaphore = new SearchSemaphore(
    Number.isInteger(configuredConcurrency) && configuredConcurrency > 0
        ? configuredConcurrency
        : 2
);
const providerResultCache = new BoundedAsyncTtlCache<RailwayProviderResult>(
    Number(process.env.RAILWAY_PROVIDER_CACHE_TTL_MS ?? 2 * 60 * 1000),
    Number(process.env.RAILWAY_PROVIDER_CACHE_MAX_ENTRIES ?? 2_000)
);

function addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
}

function operatingDay(date: Date): RailwayOperatingDay {
    return WEEKDAYS[date.getUTCDay()];
}

function buildTrainBoardings(
    connections: JourneyConnection[]
): Map<string, TrainBoarding[]> {
    const byTrain = new Map<string, JourneyConnection[]>();
    for (const connection of connections) {
        const trainConnections = byTrain.get(connection.trainId) ?? [];
        trainConnections.push(connection);
        byTrain.set(connection.trainId, trainConnections);
    }

    const boardingsByStation = new Map<string, TrainBoarding[]>();
    for (const [trainId, trainConnections] of byTrain) {
        trainConnections.sort((left, right) => left.sequence - right.sequence);
        for (
            let startIndex = 0;
            startIndex < trainConnections.length;
            startIndex += 1
        ) {
            const first = trainConnections[startIndex];
            if (!first.boardingAllowed) continue;
            const stationBoardings = boardingsByStation.get(
                first.fromStation.id
            ) ?? [];
            stationBoardings.push({
                trainId,
                connections: trainConnections,
                startIndex
            });
            boardingsByStation.set(first.fromStation.id, stationBoardings);
        }
    }
    return boardingsByStation;
}

async function loadGraphSnapshot(): Promise<RailwayGraphSnapshot> {
    const connections = await findAllActiveJourneyConnections();
    const loadedAt = new Date();
    return {
        version: `${loadedAt.toISOString()}:${connections.length}`,
        expiresAt: Date.now() + SNAPSHOT_TTL_MS,
        boardingsByStation: buildTrainBoardings(connections),
        connections,
        minimumLegsCache: new Map()
    };
}

async function getGraphSnapshot(): Promise<RailwayGraphSnapshot> {
    if (graphSnapshot && graphSnapshot.expiresAt > Date.now()) {
        return graphSnapshot;
    }
    if (!graphLoadPromise) {
        graphLoadPromise = loadGraphSnapshot()
            .then(snapshot => {
                graphSnapshot = snapshot;
                return snapshot;
            })
            .finally(() => {
                graphLoadPromise = null;
            });
    }
    return graphLoadPromise;
}

function findNextTrainOccurrence(
    boarding: TrainBoarding,
    earliestDepartureMinute: number,
    requestedDate: Date
): JourneyConnection[] | null {
    const first = boarding.connections[boarding.startIndex];
    const originDayOffset = Math.floor(
        first.departureMinute / MINUTES_PER_DAY
    );
    const departureMinuteOfDay = first.departureMinute % MINUTES_PER_DAY;
    let departureDay = Math.floor(
        earliestDepartureMinute / MINUTES_PER_DAY
    );

    if (
        departureDay * MINUTES_PER_DAY + departureMinuteOfDay
        < earliestDepartureMinute
    ) {
        departureDay += 1;
    }

    while (departureDay <= MAX_SEARCH_DAYS) {
        const trainOriginDate = addDays(
            requestedDate,
            departureDay - originDayOffset
        );
        if (railwayRunsOnDay(first.runsMask, operatingDay(trainOriginDate))) {
            const serviceDayShift = (
                departureDay - originDayOffset
            ) * MINUTES_PER_DAY;
            const occurrence: JourneyConnection[] = [];
            for (
                let index = boarding.startIndex;
                index < boarding.connections.length;
                index += 1
            ) {
                const connection = boarding.connections[index];
                const previous = occurrence[occurrence.length - 1];
                if (
                    previous
                    && previous.toStation.id !== connection.fromStation.id
                ) {
                    break;
                }
                occurrence.push({
                    ...connection,
                    serviceDate: trainOriginDate.toISOString().slice(0, 10),
                    departureMinute:
                        connection.departureMinute + serviceDayShift,
                    arrivalMinute:
                        connection.arrivalMinute + serviceDayShift
                });
            }
            return occurrence;
        }
        departureDay += 1;
    }
    return null;
}

function findMinimumRemainingLegs(
    snapshot: RailwayGraphSnapshot,
    destinationStationIds: Set<string>
): Map<string, number> {
    const cacheKey = [...destinationStationIds].sort().join("|");
    const cached = snapshot.minimumLegsCache.get(cacheKey);
    if (cached) {
        snapshot.minimumLegsCache.delete(cacheKey);
        snapshot.minimumLegsCache.set(cacheKey, cached);
        return cached;
    }

    const byTrain = new Map<string, JourneyConnection[]>();
    for (const connection of snapshot.connections) {
        const trainConnections = byTrain.get(connection.trainId) ?? [];
        trainConnections.push(connection);
        byTrain.set(connection.trainId, trainConnections);
    }

    const minimumLegs = new Map<string, number>(
        [...destinationStationIds].map(stationId => [stationId, 0])
    );
    for (let iteration = 0; iteration < MAX_TRAIN_LEGS; iteration += 1) {
        let changed = false;
        for (const trainConnections of byTrain.values()) {
            let bestDownstreamLegs: number | undefined;
            for (
                let index = trainConnections.length - 1;
                index >= 0;
                index -= 1
            ) {
                const connection = trainConnections[index];
                const downstreamLegs = minimumLegs.get(
                    connection.toStation.id
                );
                if (
                    connection.alightingAllowed
                    && downstreamLegs !== undefined
                    && (
                        bestDownstreamLegs === undefined
                        || downstreamLegs < bestDownstreamLegs
                    )
                ) {
                    bestDownstreamLegs = downstreamLegs;
                }
                if (
                    connection.boardingAllowed
                    && bestDownstreamLegs !== undefined
                ) {
                    const candidate = bestDownstreamLegs + 1;
                    const known = minimumLegs.get(connection.fromStation.id);
                    if (known === undefined || candidate < known) {
                        minimumLegs.set(connection.fromStation.id, candidate);
                        changed = true;
                    }
                }
            }
        }
        if (!changed) break;
    }

    snapshot.minimumLegsCache.set(cacheKey, minimumLegs);
    while (
        snapshot.minimumLegsCache.size > MAX_MINIMUM_LEG_CACHE_ENTRIES
    ) {
        const oldest = snapshot.minimumLegsCache.keys().next().value;
        if (oldest === undefined) break;
        snapshot.minimumLegsCache.delete(oldest);
    }
    return minimumLegs;
}

function journeyKey(state: JourneySearchState): string {
    if (state.rides.length === 0) return state.originStationId;
    return [
        state.originStationId,
        ...state.rides.map(ride => ride[ride.length - 1].toStation.id)
    ].join("|");
}

function trainSequenceKey(state: JourneySearchState): string {
    return [
        state.originStationId,
        ...state.rides.map(ride => ride[0].trainId)
    ].join("|");
}

function compareStates(
    left: JourneySearchState,
    right: JourneySearchState
): number {
    return left.arrivalMinute - right.arrivalMinute
        || left.estimatedTotalLegs - right.estimatedTotalLegs
        || left.rides.length - right.rides.length;
}

class JourneySearchQueue {
    private readonly states: JourneySearchState[] = [];

    get length(): number {
        return this.states.length;
    }

    push(state: JourneySearchState): void {
        this.states.push(state);
        let index = this.states.length - 1;
        while (index > 0) {
            const parentIndex = Math.floor((index - 1) / 2);
            if (
                compareStates(
                    this.states[parentIndex],
                    this.states[index]
                ) <= 0
            ) {
                break;
            }
            [this.states[parentIndex], this.states[index]] = [
                this.states[index],
                this.states[parentIndex]
            ];
            index = parentIndex;
        }
    }

    pop(): JourneySearchState | undefined {
        const first = this.states[0];
        const last = this.states.pop();
        if (!first || !last || this.states.length === 0) return first;

        this.states[0] = last;
        let index = 0;
        while (true) {
            const leftIndex = index * 2 + 1;
            const rightIndex = leftIndex + 1;
            let smallest = index;
            if (
                leftIndex < this.states.length
                && compareStates(
                    this.states[leftIndex],
                    this.states[smallest]
                ) < 0
            ) {
                smallest = leftIndex;
            }
            if (
                rightIndex < this.states.length
                && compareStates(
                    this.states[rightIndex],
                    this.states[smallest]
                ) < 0
            ) {
                smallest = rightIndex;
            }
            if (smallest === index) break;
            [this.states[index], this.states[smallest]] = [
                this.states[smallest],
                this.states[index]
            ];
            index = smallest;
        }
        return first;
    }
}

function registerState(
    state: JourneySearchState,
    labelsByOriginStationDepth: Map<string, JourneySearchState[]>
): boolean {
    const key = [
        state.originStationId,
        state.stationId,
        state.rides.length
    ].join(":");
    const labels = labelsByOriginStationDepth.get(key) ?? [];
    const routeKey = journeyKey(state);
    const matchingIndex = labels.findIndex(
        label => journeyKey(label) === routeKey
    );

    if (matchingIndex >= 0) {
        if (labels[matchingIndex].arrivalMinute <= state.arrivalMinute) {
            return false;
        }
        labels[matchingIndex] = state;
        return true;
    }
    if (labels.length < MAX_STATES_PER_STATION_DEPTH) {
        labels.push(state);
        labelsByOriginStationDepth.set(key, labels);
        return true;
    }

    let latestIndex = 0;
    for (let index = 1; index < labels.length; index += 1) {
        if (labels[index].arrivalMinute > labels[latestIndex].arrivalMinute) {
            latestIndex = index;
        }
    }
    if (labels[latestIndex].arrivalMinute <= state.arrivalMinute) return false;
    labels[latestIndex] = state;
    return true;
}

function toPath(state: JourneySearchState): RailwayPath {
    const connections = state.rides.flat();
    const first = connections[0];
    const last = connections[connections.length - 1];
    return {
        originStationId: state.originStationId,
        destinationStationId: last.toStation.id,
        departureMinute: first.departureMinute,
        arrivalMinute: last.arrivalMinute,
        connections
    };
}

async function searchEarliestPaths(
    snapshot: RailwayGraphSnapshot,
    minimumRemainingLegs: Map<string, number>,
    origins: RailwaySearchOrigin[],
    destinationStationIds: Set<string>,
    requestedDate: Date,
    maxResults: number,
    maxResultsPerOrigin: number,
    resultKeys: Set<string>,
    trainKeys: Set<string>
): Promise<{
    paths: RailwayPath[];
    truncated: boolean;
    reason: string | null;
}> {
    const queue = new JourneySearchQueue();
    const labels = new Map<string, JourneySearchState[]>();
    const reachableOriginIds = new Set<string>();
    for (const origin of origins) {
        const minimumLegs = minimumRemainingLegs.get(origin.stationId);
        if (minimumLegs === undefined || minimumLegs > MAX_TRAIN_LEGS) {
            continue;
        }
        reachableOriginIds.add(origin.stationId);
        const state: JourneySearchState = {
            originStationId: origin.stationId,
            stationId: origin.stationId,
            arrivalMinute: origin.readyMinute,
            estimatedTotalLegs: minimumLegs,
            rides: [],
            visitedStationIds: new Set([origin.stationId]),
            usedTrainIds: new Set()
        };
        queue.push(state);
        registerState(state, labels);
    }

    const paths: RailwayPath[] = [];
    const resultsByOrigin = new Map<string, number>();
    let expandedStates = 0;
    let generatedStates = origins.length;

    while (queue.length > 0 && paths.length < maxResults) {
        const completedOrigins = [...reachableOriginIds].filter(
            originId =>
                (resultsByOrigin.get(originId) ?? 0) >= maxResultsPerOrigin
        ).length;
        if (
            reachableOriginIds.size > 0
            && completedOrigins === reachableOriginIds.size
        ) {
            break;
        }
        if (
            expandedStates >= MAX_EXPANDED_STATES
            || generatedStates >= MAX_GENERATED_STATES
        ) {
            return {
                paths,
                truncated: true,
                reason: expandedStates >= MAX_EXPANDED_STATES
                    ? "expanded_state_limit"
                    : "generated_state_limit"
            };
        }

        const state = queue.pop();
        if (!state) break;
        if (destinationStationIds.has(state.stationId)) {
            const routeKey = journeyKey(state);
            const trainKey = trainSequenceKey(state);
            const originResultCount = resultsByOrigin.get(
                state.originStationId
            ) ?? 0;
            if (
                originResultCount < maxResultsPerOrigin
                && !resultKeys.has(routeKey)
                && !trainKeys.has(trainKey)
            ) {
                resultKeys.add(routeKey);
                trainKeys.add(trainKey);
                paths.push(toPath(state));
                resultsByOrigin.set(
                    state.originStationId,
                    originResultCount + 1
                );
            }
            continue;
        }
        if (state.rides.length >= MAX_TRAIN_LEGS) continue;
        if (
            (resultsByOrigin.get(state.originStationId) ?? 0)
            >= maxResultsPerOrigin
        ) {
            continue;
        }

        expandedStates += 1;
        if (expandedStates % 2_000 === 0) {
            await new Promise<void>(resolve => setImmediate(resolve));
        }

        const earliestDeparture = state.arrivalMinute
            + (state.rides.length > 0 ? MINIMUM_RAIL_TRANSFER_MINUTES : 0);
        const boardings = snapshot.boardingsByStation.get(state.stationId) ?? [];
        for (const boarding of boardings) {
            if (state.usedTrainIds.has(boarding.trainId)) continue;
            const occurrence = findNextTrainOccurrence(
                boarding,
                earliestDeparture,
                requestedDate
            );
            if (!occurrence) continue;

            const ride: JourneyConnection[] = [];
            for (const connection of occurrence) {
                if (state.visitedStationIds.has(connection.toStation.id)) break;
                ride.push(connection);
                if (!connection.alightingAllowed) continue;

                const remaining = minimumRemainingLegs.get(
                    connection.toStation.id
                );
                if (remaining === undefined) continue;
                const nextLegCount = state.rides.length + 1;
                if (nextLegCount + remaining > MAX_TRAIN_LEGS) continue;

                const nextState: JourneySearchState = {
                    originStationId: state.originStationId,
                    stationId: connection.toStation.id,
                    arrivalMinute: connection.arrivalMinute,
                    estimatedTotalLegs: nextLegCount + remaining,
                    rides: [...state.rides, [...ride]],
                    visitedStationIds: new Set([
                        ...state.visitedStationIds,
                        ...ride.map(item => item.toStation.id)
                    ]),
                    usedTrainIds: new Set([
                        ...state.usedTrainIds,
                        boarding.trainId
                    ])
                };
                if (!registerState(nextState, labels)) continue;
                queue.push(nextState);
                generatedStates += 1;
                if (generatedStates >= MAX_GENERATED_STATES) break;
            }
            if (generatedStates >= MAX_GENERATED_STATES) break;
        }
    }

    return { paths, truncated: false, reason: null };
}

async function searchRoundBasedPaths(
    snapshot: RailwayGraphSnapshot,
    origins: RailwaySearchOrigin[],
    destinationStationIds: Set<string>,
    requestedDate: Date,
    latestOriginDepartureMinute?: number
): Promise<RailwayPath[]> {
    const paths: RailwayPath[] = [];

    for (const origin of origins) {
        let previousRound = new Map<string, RoundLabel>([[
            origin.stationId,
            {
                stationId: origin.stationId,
                arrivalMinute: origin.readyMinute,
                rides: [],
                usedTrainIds: new Set()
            }
        ]]);
        const bestArrival = new Map<string, number>([[
            origin.stationId,
            origin.readyMinute
        ]]);
        const pathKeys = new Set<string>();

        for (
            let round = 1;
            round <= MAX_TRAIN_LEGS && previousRound.size > 0;
            round += 1
        ) {
            const nextRound = new Map<string, RoundLabel>();
            let processedStations = 0;

            for (const label of previousRound.values()) {
                processedStations += 1;
                if (processedStations % 500 === 0) {
                    await new Promise<void>(
                        resolve => setImmediate(resolve)
                    );
                }
                const earliestDeparture = label.arrivalMinute
                    + (round > 1 ? MINIMUM_RAIL_TRANSFER_MINUTES : 0);
                const boardings = snapshot.boardingsByStation.get(
                    label.stationId
                ) ?? [];

                for (const boarding of boardings) {
                    if (label.usedTrainIds.has(boarding.trainId)) continue;
                    const occurrence = findNextTrainOccurrence(
                        boarding,
                        earliestDeparture,
                        requestedDate
                    );
                    if (!occurrence) continue;
                    if (
                        round === 1
                        && latestOriginDepartureMinute !== undefined
                        && occurrence[0].departureMinute
                            >= latestOriginDepartureMinute
                    ) {
                        continue;
                    }

                    const ride: JourneyConnection[] = [];
                    for (const connection of occurrence) {
                        ride.push(connection);
                        if (!connection.alightingAllowed) continue;

                        const knownArrival = bestArrival.get(
                            connection.toStation.id
                        );
                        const roundKnownArrival = nextRound.get(
                            connection.toStation.id
                        )?.arrivalMinute;
                        if (
                            knownArrival !== undefined
                            && knownArrival <= connection.arrivalMinute
                        ) {
                            continue;
                        }
                        if (
                            roundKnownArrival !== undefined
                            && roundKnownArrival <= connection.arrivalMinute
                        ) {
                            continue;
                        }

                        const nextLabel: RoundLabel = {
                            stationId: connection.toStation.id,
                            arrivalMinute: connection.arrivalMinute,
                            rides: [...label.rides, [...ride]],
                            usedTrainIds: new Set([
                                ...label.usedTrainIds,
                                boarding.trainId
                            ])
                        };
                        nextRound.set(connection.toStation.id, nextLabel);
                    }
                }
            }

            for (const [stationId, label] of nextRound) {
                const knownArrival = bestArrival.get(stationId);
                if (
                    knownArrival === undefined
                    || label.arrivalMinute < knownArrival
                ) {
                    bestArrival.set(stationId, label.arrivalMinute);
                }
                if (!destinationStationIds.has(stationId)) continue;

                const path = toPath({
                    originStationId: origin.stationId,
                    stationId,
                    arrivalMinute: label.arrivalMinute,
                    estimatedTotalLegs: round,
                    rides: label.rides,
                    visitedStationIds: new Set(),
                    usedTrainIds: label.usedTrainIds
                });
                const key = [
                    path.destinationStationId,
                    ...path.connections.map(connection => connection.trainId)
                ].join(":");
                if (pathKeys.has(key)) continue;
                pathKeys.add(key);
                paths.push(path);
            }

            previousRound = nextRound;
        }
    }

    return paths;
}

function findDirectPaths(
    snapshot: RailwayGraphSnapshot,
    origins: RailwaySearchOrigin[],
    destinationStationIds: Set<string>,
    requestedDate: Date,
    maxResultsPerOrigin: number,
    latestOriginDepartureMinute?: number
): {
    paths: RailwayPath[];
    originsWithoutDirectPaths: RailwaySearchOrigin[];
} {
    const paths: RailwayPath[] = [];
    const originsWithoutDirectPaths: RailwaySearchOrigin[] = [];

    for (const origin of origins) {
        const originPaths: RailwayPath[] = [];
        const keys = new Set<string>();
        const boardings = snapshot.boardingsByStation.get(origin.stationId)
            ?? [];
        for (const boarding of boardings) {
            const occurrence = findNextTrainOccurrence(
                boarding,
                origin.readyMinute,
                requestedDate
            );
            if (!occurrence) continue;
            if (
                latestOriginDepartureMinute !== undefined
                && occurrence[0].departureMinute >= latestOriginDepartureMinute
            ) {
                continue;
            }

            const ride: JourneyConnection[] = [];
            for (const connection of occurrence) {
                ride.push(connection);
                if (
                    !connection.alightingAllowed
                    || !destinationStationIds.has(connection.toStation.id)
                ) {
                    continue;
                }
                const key = `${boarding.trainId}:${connection.toStation.id}`;
                if (keys.has(key)) continue;
                keys.add(key);
                originPaths.push({
                    originStationId: origin.stationId,
                    destinationStationId: connection.toStation.id,
                    departureMinute: ride[0].departureMinute,
                    arrivalMinute: connection.arrivalMinute,
                    connections: [...ride]
                });
            }
        }

        originPaths.sort((left, right) =>
            left.arrivalMinute - right.arrivalMinute
            || left.departureMinute - right.departureMinute
        );
        if (originPaths.length === 0) {
            originsWithoutDirectPaths.push(origin);
        } else {
            const selected: RailwayPath[] = [];
            const selectedKeys = new Set<string>();
            const destinationIds = new Set<string>();
            for (const path of originPaths) {
                if (destinationIds.has(path.destinationStationId)) continue;
                destinationIds.add(path.destinationStationId);
                selected.push(path);
                selectedKeys.add(
                    `${path.connections[0].trainId}:${path.destinationStationId}`
                );
                if (selected.length >= maxResultsPerOrigin) break;
            }
            for (const path of originPaths) {
                if (selected.length >= maxResultsPerOrigin) break;
                const key =
                    `${path.connections[0].trainId}:${path.destinationStationId}`;
                if (selectedKeys.has(key)) continue;
                selectedKeys.add(key);
                selected.push(path);
            }
            paths.push(...selected);
        }
    }

    return { paths, originsWithoutDirectPaths };
}

async function executeSearch(
    origins: RailwaySearchOrigin[],
    destinationStationIds: Set<string>,
    requestedDate: Date,
    limits: SearchLimits
): Promise<RailwayProviderResult> {
    const snapshot = await getGraphSnapshot();
    const maxResultsPerOrigin = Math.max(
        2,
        Math.ceil(limits.maxResults / origins.length)
    );
    const direct = findDirectPaths(
        snapshot,
        origins,
        destinationStationIds,
        requestedDate,
        maxResultsPerOrigin,
        limits.latestOriginDepartureMinute
    );
    const paths: RailwayPath[] = [...direct.paths];
    const roundBasedPaths = await searchRoundBasedPaths(
        snapshot,
        origins,
        destinationStationIds,
        requestedDate,
        limits.latestOriginDepartureMinute
    );
    paths.push(...roundBasedPaths);

    paths.sort((left, right) =>
        left.arrivalMinute - right.arrivalMinute
        || left.connections[0].trainId.localeCompare(
            right.connections[0].trainId
        )
    );
    const deduplicatedPaths: RailwayPath[] = [];
    const pathKeys = new Set<string>();
    for (const path of paths) {
        const key = [
            path.originStationId,
            path.destinationStationId,
            path.departureMinute,
            path.arrivalMinute,
            ...path.connections.map(connection => connection.trainId)
        ].join(":");
        if (pathKeys.has(key)) continue;
        pathKeys.add(key);
        deduplicatedPaths.push(path);
    }
    const diversifiedPaths: RailwayPath[] = [];
    const selectedPathKeys = new Set<string>();
    const pathCountByOrigin = new Map<string, number>();
    const directDestinationKeys = new Set<string>();

    for (const path of deduplicatedPaths) {
        const trainIds = new Set(
            path.connections.map(connection => connection.trainId)
        );
        if (trainIds.size !== 1) continue;
        const destinationKey =
            `${path.originStationId}:${path.destinationStationId}`;
        if (directDestinationKeys.has(destinationKey)) continue;
        const count = pathCountByOrigin.get(path.originStationId) ?? 0;
        if (count >= maxResultsPerOrigin) continue;
        directDestinationKeys.add(destinationKey);
        pathCountByOrigin.set(path.originStationId, count + 1);
        diversifiedPaths.push(path);
        selectedPathKeys.add([
            path.originStationId,
            path.destinationStationId,
            path.departureMinute,
            path.arrivalMinute,
            ...path.connections.map(connection => connection.trainId)
        ].join(":"));
    }

    for (const path of deduplicatedPaths) {
        const pathKey = [
            path.originStationId,
            path.destinationStationId,
            path.departureMinute,
            path.arrivalMinute,
            ...path.connections.map(connection => connection.trainId)
        ].join(":");
        if (selectedPathKeys.has(pathKey)) continue;
        const count = pathCountByOrigin.get(path.originStationId) ?? 0;
        if (count >= maxResultsPerOrigin) continue;
        pathCountByOrigin.set(path.originStationId, count + 1);
        diversifiedPaths.push(path);
        selectedPathKeys.add(pathKey);
    }
    diversifiedPaths.sort((left, right) =>
        left.arrivalMinute - right.arrivalMinute
        || left.connections[0].trainId.localeCompare(
            right.connections[0].trainId
        )
    );

    return {
        graphVersion: snapshot.version,
        paths: diversifiedPaths,
        searchComplete: true,
        truncationReason: null
    };
}

export async function searchRailwayProvider(
    origins: RailwaySearchOrigin[],
    destinationStationIds: Set<string>,
    requestedDate: Date,
    maxResults: number,
    latestOriginDepartureMinute?: number
): Promise<RailwayProviderResult> {
    if (origins.length === 0 || destinationStationIds.size === 0) {
        return {
            graphVersion: "not-loaded",
            paths: [],
            searchComplete: true,
            truncationReason: null
        };
    }
    const cacheKey = [
        requestedDate.toISOString().slice(0, 10),
        [...origins]
            .sort((left, right) =>
                left.stationId.localeCompare(right.stationId)
            )
            .map(origin => `${origin.stationId}:${origin.readyMinute}`)
            .join(","),
        [...destinationStationIds].sort().join(","),
        maxResults,
        latestOriginDepartureMinute ?? "none"
    ].join("|");
    return providerResultCache.getOrLoad(
        cacheKey,
        () => searchSemaphore.run(
            () => executeSearch(
                origins,
                destinationStationIds,
                requestedDate,
                { maxResults, latestOriginDepartureMinute }
            )
        )
    );
}

export function stationFromConnection(
    station: JourneyStation,
    latitude: number,
    longitude: number
): JourneyStation & { latitude: number; longitude: number } {
    return { ...station, latitude, longitude };
}
