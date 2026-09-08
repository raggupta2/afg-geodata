import { JourneyRoutingPolicy } from "@prisma/client";
import { BoundedAsyncTtlCache } from "../cache/bounded-async-ttl-cache";
import { findAllActiveJourneyConnections } from "../repositories/railway-routing.repository";
import { JourneyConnection, JourneyStation } from "../types/railway-journey";
import { JourneySortOrder } from "../types/journey-search";
import {
    railwayRunsOnDay,
    RailwayOperatingDay
} from "../utils/railway-runs-mask";
import { SearchSemaphore } from "../utils/search-semaphore";
import { registerSemaphoreMetrics } from "../observability/metrics";
import { StringChainNode, chainHas, chainWith } from "../utils/string-chain";

type TrainBoarding = {
    trainId: string;
    connections: JourneyConnection[];
    startIndex: number;
};

type RailwayGraphSnapshot = {
    version: string;
    expiresAt: number;
    boardingsByStation: Map<string, TrainBoarding[]>;
    connectionsByTrain: Map<string, JourneyConnection[]>;
    alightingsByStation: Map<string, Array<{
        trainId: string;
        sequence: number;
    }>>;
    minimumLegsCache: Map<string, Map<string, number>>;
};

type JourneySearchState = {
    originStationId: string;
    stationId: string;
    arrivalMinute: number;
    estimatedTotalLegs: number;
    rides: JourneyConnection[][];
    visitedStations: StringChainNode | null;
    usedTrains: StringChainNode | null;
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

export type RailwayRideExpansion = {
    trainId: string;
    departureMinute: number;
    arrivalMinute: number;
    destinationStationId: string;
    connections: JourneyConnection[];
};

type SearchLimits = {
    maxResults: number;
    latestOriginDepartureMinute?: number;
    sortBy: JourneySortOrder;
};

export type RailwayRoutingLimits = {
    minimumRailTransferMinutes: number;
    maxTrainLegs: number;
    searchHorizonDays: number;
};

const MINUTES_PER_DAY = 24 * 60;
// Hard engine ceiling, independent of policy: guards against pathological
// configuration values triggering runaway state-space growth.
const ENGINE_MAX_SUPPORTED_TRAIN_LEGS = 6;
const MAX_EXPANDED_STATES = 30_000;
const MAX_GENERATED_STATES = 200_000;
const MAX_STATES_PER_STATION_DEPTH = 3;
const MAX_MINIMUM_LEG_CACHE_ENTRIES = 128;
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

export function resolveRailwayRoutingLimits(
    policy: JourneyRoutingPolicy
): RailwayRoutingLimits {
    return {
        minimumRailTransferMinutes: policy.railToRailMinutes,
        maxTrainLegs: Math.min(
            policy.maximumTransfers + 1,
            ENGINE_MAX_SUPPORTED_TRAIN_LEGS
        ),
        searchHorizonDays: policy.searchHorizonDays
    };
}

let graphSnapshot: RailwayGraphSnapshot | null = null;
let graphLoadPromise: Promise<RailwayGraphSnapshot> | null = null;

const configuredConcurrency = Number(process.env.RAILWAY_SEARCH_CONCURRENCY ?? 2);
const searchSemaphore = new SearchSemaphore(
    Number.isInteger(configuredConcurrency) && configuredConcurrency > 0
        ? configuredConcurrency
        : 2,
    MAX_QUEUED_SEARCHES,
    "The railway routing service is busy. Please retry shortly."
);
registerSemaphoreMetrics("railway", () => ({
    active: searchSemaphore.activeCount,
    queued: searchSemaphore.queuedCount
}));
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

function buildConnectionIndexes(
    connections: JourneyConnection[]
): Pick<
    RailwayGraphSnapshot,
    "connectionsByTrain" | "alightingsByStation"
> {
    const byTrain = new Map<string, JourneyConnection[]>();
    const alightings: RailwayGraphSnapshot["alightingsByStation"] = new Map();
    for (const connection of connections) {
        const trainConnections = byTrain.get(connection.trainId) ?? [];
        trainConnections.push(connection);
        byTrain.set(connection.trainId, trainConnections);
        if (connection.alightingAllowed) {
            const stationAlightings = alightings.get(
                connection.toStation.id
            ) ?? [];
            stationAlightings.push({
                trainId: connection.trainId,
                sequence: connection.sequence
            });
            alightings.set(connection.toStation.id, stationAlightings);
        }
    }
    for (const trainConnections of byTrain.values()) {
        trainConnections.sort((left, right) => left.sequence - right.sequence);
    }
    return {
        connectionsByTrain: byTrain,
        alightingsByStation: alightings
    };
}

function buildTrainBoardings(
    byTrain: Map<string, JourneyConnection[]>
): Map<string, TrainBoarding[]> {
    const boardingsByStation = new Map<string, TrainBoarding[]>();
    for (const [trainId, trainConnections] of byTrain) {
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
    const indexes = buildConnectionIndexes(connections);
    const loadedAt = new Date();
    return {
        version: `${loadedAt.toISOString()}:${connections.length}`,
        expiresAt: Date.now() + SNAPSHOT_TTL_MS,
        boardingsByStation: buildTrainBoardings(indexes.connectionsByTrain),
        ...indexes,
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
    requestedDate: Date,
    maxSearchDays: number
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

    while (departureDay <= maxSearchDays) {
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
    destinationStationIds: Set<string>,
    maxTrainLegs: number
): Map<string, number> {
    const cacheKey = [
        maxTrainLegs,
        ...[...destinationStationIds].sort()
    ].join("|");
    const cached = snapshot.minimumLegsCache.get(cacheKey);
    if (cached) {
        snapshot.minimumLegsCache.delete(cacheKey);
        snapshot.minimumLegsCache.set(cacheKey, cached);
        return cached;
    }

    const minimumLegs = new Map<string, number>(
        [...destinationStationIds].map(stationId => [stationId, 0])
    );
    let frontier = new Set(destinationStationIds);
    const expandedSequenceByTrain = new Map<string, number>();
    for (
        let legCount = 1;
        legCount <= maxTrainLegs && frontier.size > 0;
        legCount += 1
    ) {
        const nextFrontier = new Set<string>();
        for (const stationId of frontier) {
            const alightings = snapshot.alightingsByStation.get(stationId) ?? [];
            for (const alighting of alightings) {
                const previousSequence = expandedSequenceByTrain.get(
                    alighting.trainId
                ) ?? 0;
                if (alighting.sequence <= previousSequence) continue;
                const trainConnections = snapshot.connectionsByTrain.get(
                    alighting.trainId
                ) ?? [];
                for (const connection of trainConnections) {
                    if (connection.sequence > alighting.sequence) break;
                    if (
                        connection.sequence <= previousSequence
                        || !connection.boardingAllowed
                        || minimumLegs.has(connection.fromStation.id)
                    ) {
                        continue;
                    }
                    minimumLegs.set(connection.fromStation.id, legCount);
                    nextFrontier.add(connection.fromStation.id);
                }
                expandedSequenceByTrain.set(
                    alighting.trainId,
                    alighting.sequence
                );
            }
        }
        frontier = nextFrontier;
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
    const services = state.rides.map(ride => {
        const first = ride[0];
        return `${first.trainNumber}@${first.serviceDate ?? ""}`;
    });
    const transfers = state.rides.slice(0, -1).map((ride, index) => {
        const nextRide = state.rides[index + 1];
        return `${ride[ride.length - 1].toStation.id}>${nextRide[0].fromStation.id}`;
    });
    return [
        state.rides.length === 1 ? "DIRECT" : "TRANSFER",
        ...services,
        ...transfers
    ].join("|");
}

function compareStates(
    left: JourneySearchState,
    right: JourneySearchState,
    sortBy: JourneySortOrder
): number {
    if (sortBy === "transfers") {
        return left.estimatedTotalLegs - right.estimatedTotalLegs
            || left.arrivalMinute - right.arrivalMinute
            || left.rides.length - right.rides.length;
    }
    if (sortBy === "departure") {
        const leftDeparture = left.rides[0]?.[0]?.departureMinute
            ?? left.arrivalMinute;
        const rightDeparture = right.rides[0]?.[0]?.departureMinute
            ?? right.arrivalMinute;
        return leftDeparture - rightDeparture
            || left.arrivalMinute - right.arrivalMinute
            || left.estimatedTotalLegs - right.estimatedTotalLegs;
    }
    return left.arrivalMinute - right.arrivalMinute
        || left.estimatedTotalLegs - right.estimatedTotalLegs
        || left.rides.length - right.rides.length;
}

class JourneySearchQueue {
    private readonly states: JourneySearchState[] = [];

    constructor(private readonly sortBy: JourneySortOrder) {}

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
                    this.states[index],
                    this.sortBy
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
                    this.states[smallest],
                    this.sortBy
                ) < 0
            ) {
                smallest = leftIndex;
            }
            if (
                rightIndex < this.states.length
                && compareStates(
                    this.states[rightIndex],
                    this.states[smallest],
                    this.sortBy
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
    trainKeys: Set<string>,
    limits: RailwayRoutingLimits,
    latestOriginDepartureMinute: number | undefined,
    sortBy: JourneySortOrder
): Promise<{
    paths: RailwayPath[];
    truncated: boolean;
    reason: string | null;
}> {
    const queue = new JourneySearchQueue(sortBy);
    const labels = new Map<string, JourneySearchState[]>();
    const reachableOriginIds = new Set<string>();
    for (const origin of origins) {
        const minimumLegs = minimumRemainingLegs.get(origin.stationId);
        if (minimumLegs === undefined || minimumLegs > limits.maxTrainLegs) {
            continue;
        }
        reachableOriginIds.add(origin.stationId);
        const state: JourneySearchState = {
            originStationId: origin.stationId,
            stationId: origin.stationId,
            arrivalMinute: origin.readyMinute,
            estimatedTotalLegs: minimumLegs,
            rides: [],
            visitedStations: chainWith(null, origin.stationId),
            usedTrains: null
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
        if (state.rides.length >= limits.maxTrainLegs) continue;
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
            + (state.rides.length > 0 ? limits.minimumRailTransferMinutes : 0);
        const boardings = snapshot.boardingsByStation.get(state.stationId) ?? [];
        for (const boarding of boardings) {
            if (chainHas(state.usedTrains, boarding.trainId)) continue;
            const occurrence = findNextTrainOccurrence(
                boarding,
                earliestDeparture,
                requestedDate,
                limits.searchHorizonDays
            );
            if (!occurrence) continue;
            if (
                state.rides.length === 0
                && latestOriginDepartureMinute !== undefined
                && occurrence[0].departureMinute >= latestOriginDepartureMinute
            ) {
                continue;
            }

            const ride: JourneyConnection[] = [];
            // Extended by exactly one node per connection processed, in
            // lockstep with `ride` - at any alighting-allowed connection
            // below, rideVisited represents exactly the same membership as
            // the original `new Set([...state.visitedStationIds,
            // ...ride.map(...)])` would have at that same point. The break
            // check just above always tests against the parent state's own
            // (pre-ride) chain, never this accumulating one - preserving
            // the original code's behavior of only guarding against
            // stations visited before this ride began.
            let rideVisited = state.visitedStations;
            for (const connection of occurrence) {
                if (chainHas(state.visitedStations, connection.toStation.id)) break;
                ride.push(connection);
                rideVisited = chainWith(rideVisited, connection.toStation.id);
                if (!connection.alightingAllowed) continue;

                const remaining = minimumRemainingLegs.get(
                    connection.toStation.id
                );
                if (remaining === undefined) continue;
                const nextLegCount = state.rides.length + 1;
                if (nextLegCount + remaining > limits.maxTrainLegs) continue;

                const nextState: JourneySearchState = {
                    originStationId: state.originStationId,
                    stationId: connection.toStation.id,
                    arrivalMinute: connection.arrivalMinute,
                    estimatedTotalLegs: nextLegCount + remaining,
                    rides: [...state.rides, [...ride]],
                    visitedStations: rideVisited,
                    usedTrains: chainWith(state.usedTrains, boarding.trainId)
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
    limits: RailwayRoutingLimits,
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
            round <= limits.maxTrainLegs && previousRound.size > 0;
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
                    + (round > 1 ? limits.minimumRailTransferMinutes : 0);
                const boardings = snapshot.boardingsByStation.get(
                    label.stationId
                ) ?? [];

                for (const boarding of boardings) {
                    if (label.usedTrainIds.has(boarding.trainId)) continue;
                    const occurrence = findNextTrainOccurrence(
                        boarding,
                        earliestDeparture,
                        requestedDate,
                        limits.searchHorizonDays
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
                    visitedStations: null,
                    usedTrains: null
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
    searchHorizonDays: number,
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
                requestedDate,
                searchHorizonDays
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

function pathTransferCount(path: RailwayPath): number {
    return Math.max(
        0,
        new Set(path.connections.map(connection => connection.trainId)).size - 1
    );
}

function comparePaths(
    left: RailwayPath,
    right: RailwayPath,
    sortBy: JourneySortOrder
): number {
    const transferDifference = pathTransferCount(left)
        - pathTransferCount(right);
    const durationDifference = (left.arrivalMinute - left.departureMinute)
        - (right.arrivalMinute - right.departureMinute);
    const arrivalDifference = left.arrivalMinute - right.arrivalMinute;
    if (sortBy === "duration") {
        return durationDifference || transferDifference || arrivalDifference;
    }
    if (sortBy === "departure") {
        return left.departureMinute - right.departureMinute
            || transferDifference || arrivalDifference;
    }
    if (sortBy === "arrival") {
        return arrivalDifference || transferDifference || durationDifference;
    }
    return transferDifference || arrivalDifference || durationDifference;
}

function directServiceKey(path: RailwayPath): string {
    const first = path.connections[0];
    return `DIRECT|${first.trainNumber}@${first.serviceDate ?? ""}`;
}

async function executeSearch(
    origins: RailwaySearchOrigin[],
    destinationStationIds: Set<string>,
    requestedDate: Date,
    limits: SearchLimits,
    routingLimits: RailwayRoutingLimits
): Promise<RailwayProviderResult> {
    const snapshot = await getGraphSnapshot();
    const maxResultsPerOrigin = Math.max(
        2,
        Math.ceil(limits.maxResults / origins.length)
    );
    const directPaths: RailwayPath[] = [];
    const trainKeys = new Set<string>();
    // An arrival-ordered cutoff can fill all five slots with connections before
    // a later direct service is popped. Resolve direct services first when the
    // requested primary key is transfer count, then fill only the open slots.
    if (limits.sortBy === "transfers") {
        const direct = findDirectPaths(
            snapshot,
            origins,
            destinationStationIds,
            requestedDate,
            limits.maxResults,
            routingLimits.searchHorizonDays,
            limits.latestOriginDepartureMinute
        ).paths.sort((left, right) =>
            comparePaths(left, right, limits.sortBy)
        );
        for (const path of direct) {
            const key = directServiceKey(path);
            if (trainKeys.has(key)) continue;
            trainKeys.add(key);
            directPaths.push(path);
            if (directPaths.length >= limits.maxResults) break;
        }
        if (directPaths.length >= limits.maxResults) {
            return {
                graphVersion: snapshot.version,
                paths: directPaths,
                searchComplete: true,
                truncationReason: null
            };
        }
    }
    const minimumRemainingLegs = findMinimumRemainingLegs(
        snapshot,
        destinationStationIds,
        routingLimits.maxTrainLegs
    );
    const search = await searchEarliestPaths(
        snapshot,
        minimumRemainingLegs,
        origins,
        destinationStationIds,
        requestedDate,
        limits.maxResults - directPaths.length,
        maxResultsPerOrigin,
        new Set<string>(),
        trainKeys,
        routingLimits,
        limits.latestOriginDepartureMinute,
        limits.sortBy
    );
    const paths = [...directPaths, ...search.paths].sort((left, right) =>
        comparePaths(left, right, limits.sortBy)
        || left.connections[0].trainId.localeCompare(
            right.connections[0].trainId
        )
    );

    return {
        graphVersion: snapshot.version,
        paths,
        searchComplete: !search.truncated,
        truncationReason: search.reason
    };
}

export async function searchRailwayProvider(
    origins: RailwaySearchOrigin[],
    destinationStationIds: Set<string>,
    requestedDate: Date,
    maxResults: number,
    routingLimits: RailwayRoutingLimits,
    latestOriginDepartureMinute?: number,
    sortBy: JourneySortOrder = "transfers"
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
        latestOriginDepartureMinute ?? "none",
        sortBy,
        routingLimits.minimumRailTransferMinutes,
        routingLimits.maxTrainLegs,
        routingLimits.searchHorizonDays
    ].join("|");
    return providerResultCache.getOrLoad(
        cacheKey,
        () => searchSemaphore.run(
            () => executeSearch(
                origins,
                destinationStationIds,
                requestedDate,
                { maxResults, latestOriginDepartureMinute, sortBy },
                routingLimits
            )
        )
    );
}

export async function expandRailwayRides(
    stationId: string,
    earliestDepartureMinute: number,
    requestedDate: Date,
    excludedTrainIds: Set<string>,
    searchHorizonDays: number,
    maximumOptions = 400
): Promise<RailwayRideExpansion[]> {
    const snapshot = await getGraphSnapshot();
    const boardings = snapshot.boardingsByStation.get(stationId) ?? [];
    const options: RailwayRideExpansion[] = [];

    for (const boarding of boardings) {
        if (excludedTrainIds.has(boarding.trainId)) continue;
        const occurrence = findNextTrainOccurrence(
            boarding,
            earliestDepartureMinute,
            requestedDate,
            searchHorizonDays
        );
        if (!occurrence) continue;
        const ride: JourneyConnection[] = [];
        for (const connection of occurrence) {
            ride.push(connection);
            if (!connection.alightingAllowed) continue;
            options.push({
                trainId: boarding.trainId,
                departureMinute: ride[0].departureMinute,
                arrivalMinute: connection.arrivalMinute,
                destinationStationId: connection.toStation.id,
                connections: [...ride]
            });
        }
    }

    options.sort((left, right) =>
        left.departureMinute - right.departureMinute
        || left.arrivalMinute - right.arrivalMinute
    );
    const selected: RailwayRideExpansion[] = [];
    const destinationCounts = new Map<string, number>();
    for (const option of options) {
        const count = destinationCounts.get(option.destinationStationId) ?? 0;
        if (count >= 3) continue;
        destinationCounts.set(option.destinationStationId, count + 1);
        selected.push(option);
        if (selected.length >= maximumOptions) break;
    }
    return selected;
}

export function stationFromConnection(
    station: JourneyStation,
    latitude: number,
    longitude: number
): JourneyStation & { latitude: number; longitude: number } {
    return { ...station, latitude, longitude };
}
