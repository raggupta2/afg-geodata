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
    roadAccessMinutes: number;
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
    destinationRoadAccessMinutes: Map<string, number>;
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
        state.originStationId,
        // At the one call site (the destination-completion check in
        // searchEarliestPaths), state.stationId is the alighting station.
        // Without it here, a train that can alight at more than one
        // candidate destination station (e.g. an earlier stop within the
        // destination search radius, and the traveler's actual selected
        // station further down the same route) would have its later,
        // real-destination alighting silently discarded as a "duplicate"
        // of the earlier one - even though they are different journeys.
        state.stationId,
        ...services,
        ...transfers
    ].join("|");
}

function compareStates(
    left: JourneySearchState,
    right: JourneySearchState,
    sortBy: JourneySortOrder,
    roadAccessByOrigin: Map<string, number>
): number {
    if (sortBy === "transfers") {
        return left.estimatedTotalLegs - right.estimatedTotalLegs
            || left.arrivalMinute - right.arrivalMinute
            || left.rides.length - right.rides.length;
    }
    if (sortBy === "departure") {
        // Raw train departure alone favors whichever origin happens to board
        // closest to the destination (least road access needed), the same
        // way raw departure favored the closest origin in the admission
        // budget fixed above - a farther origin's train can have an earlier
        // ACTUAL journey start (departure minus road access) than a closer
        // origin's earlier-departing train, but would never even be
        // expanded/admitted first under a raw-time comparison, so it could
        // be excluded by maxResultsPerOrigin/maxResults before the final,
        // already-correct compareJourneyOptions() sort ever sees it.
        // Subtracting each state's own origin's road-access minutes (a
        // per-origin constant, so it never changes relative order between
        // two states from the SAME origin) approximates that actual start
        // for exploration-priority purposes only - the boarding buffer is
        // deliberately omitted since it is a single shared constant across
        // every candidate and so cannot affect relative ordering.
        const leftRawDeparture = left.rides[0]?.[0]?.departureMinute
            ?? left.arrivalMinute;
        const rightRawDeparture = right.rides[0]?.[0]?.departureMinute
            ?? right.arrivalMinute;
        const leftDeparture = leftRawDeparture
            - (roadAccessByOrigin.get(left.originStationId) ?? 0);
        const rightDeparture = rightRawDeparture
            - (roadAccessByOrigin.get(right.originStationId) ?? 0);
        return leftDeparture - rightDeparture
            || left.arrivalMinute - right.arrivalMinute
            || left.estimatedTotalLegs - right.estimatedTotalLegs;
    }
    // "duration" has no dedicated branch and falls through here alongside
    // "arrival". Both must still explore in estimatedTotalLegs order first -
    // the same admissible (never-overestimates) leg-count heuristic the
    // "transfers" branch above uses - rather than plain arrival-time-first
    // Dijkstra: without it, a long-distance search spends its entire
    // expansion budget on ever-cheaper-arrival local hops near the origin
    // and never reaches a geographically distant destination, returning
    // zero (truncated) results even though valid paths exist. The final
    // output order for "arrival"/"duration" is still produced afterward by
    // compareJourneyOptions()/comparePaths() on the completed paths - this
    // only changes the search's internal traversal order, not what sorting
    // the caller receives.
    return left.estimatedTotalLegs - right.estimatedTotalLegs
        || left.arrivalMinute - right.arrivalMinute
        || left.rides.length - right.rides.length;
}

class JourneySearchQueue {
    private readonly states: JourneySearchState[] = [];

    constructor(
        private readonly sortBy: JourneySortOrder,
        private readonly roadAccessByOrigin: Map<string, number>
    ) {}

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
                    this.sortBy,
                    this.roadAccessByOrigin
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
                    this.sortBy,
                    this.roadAccessByOrigin
                ) < 0
            ) {
                smallest = leftIndex;
            }
            if (
                rightIndex < this.states.length
                && compareStates(
                    this.states[rightIndex],
                    this.states[smallest],
                    this.sortBy,
                    this.roadAccessByOrigin
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
    const roadAccessByOrigin = new Map(
        origins.map(origin => [origin.stationId, origin.roadAccessMinutes])
    );
    const queue = new JourneySearchQueue(sortBy, roadAccessByOrigin);
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
    // For sortBy: "departure", a single early initial train from an origin
    // can be completed via many different downstream transfer choices, all
    // sharing that same first departure - the priority queue (ordered by
    // departure) explores and admits every one of them before it is ever
    // the turn of that same origin's NEXT, later, distinct initial train.
    // Left unchecked, an origin's entire maxResultsPerOrigin quota is spent
    // on transfer-path variety of its single earliest train, so a genuinely
    // later (but real, and possibly a much simpler direct service) departure
    // from that same origin is never admitted at all - reproducing the
    // reported "every result shows the same early time" symptom even though
    // buildOption()/compareJourneyOptions() already compute and sort by the
    // correct actual-journey-start value for whatever candidates make it
    // into this list. Capping how many of an origin's admitted results may
    // share the same first-ride train reserves quota for trying a different,
    // later initial departure from that same origin instead - a fairness
    // dimension analogous to the existing per-destination/per-origin caps
    // elsewhere in this file, just one level deeper (per origin AND per
    // first train). Scoped to "departure" only: other sort orders explore
    // primarily by remaining-legs/arrival-time, which does not exhibit this
    // same-initial-train monopolization pattern.
    const resultsByOriginAndFirstTrain = new Map<string, number>();
    // Half (not all) of an origin's own quota, so the freed-up half can go
    // toward finding this origin's NEXT, later, distinct departure instead
    // of more transfer-path variety of the same one. A cap of exactly 1 was
    // tried and produced more departure-time diversity, but on a real long-
    // distance, multi-transfer route it made the search exhaust its overall
    // exploration budget (truncated: true) before finishing - each move to
    // a new initial train restarts a costly branching exploration, and
    // reaching more distinct initial trains sooner means more of those
    // branchy subtrees get partially generated within the same budget. Half
    // is the verified, non-truncating middle ground: confirmed against the
    // real database to surface genuinely different departure times (not
    // just one shared value) while keeping search completion intact.
    //
    // A further attempt to guarantee even more diversity - a two-phase cap
    // starting at 1 per new first train until a handful of distinct first
    // trains were found per origin, then relaxing to this same half-quota
    // value - was tried and found unsafe: on a real long-distance,
    // multi-transfer route (DWX -> SVDK) it drove multiple node processes
    // to several gigabytes of memory and tens of seconds of wall time
    // before still returning `truncated: true` - worse than this flat half
    // cap on both cost and correctness. Reverted; see PROJECT_MEMORY.md's
    // "Wasteful backtracking detour..." root cause for the full account and
    // what remains unresolved.
    const maxResultsPerOriginPerFirstTrain = sortBy === "departure"
        ? Math.max(1, Math.floor(maxResultsPerOrigin / 2))
        : maxResultsPerOrigin;
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
        const firstTrainId = state.rides[0]?.[0]?.trainId;
        const originFirstTrainKey = `${state.originStationId}:${firstTrainId}`;
        if (destinationStationIds.has(state.stationId)) {
            const routeKey = journeyKey(state);
            const trainKey = trainSequenceKey(state);
            const originResultCount = resultsByOrigin.get(
                state.originStationId
            ) ?? 0;
            const originFirstTrainCount = resultsByOriginAndFirstTrain.get(
                originFirstTrainKey
            ) ?? 0;
            if (
                originResultCount < maxResultsPerOrigin
                && originFirstTrainCount < maxResultsPerOriginPerFirstTrain
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
                resultsByOriginAndFirstTrain.set(
                    originFirstTrainKey,
                    originFirstTrainCount + 1
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
        if (
            firstTrainId !== undefined
            && (resultsByOriginAndFirstTrain.get(originFirstTrainKey) ?? 0)
                >= maxResultsPerOriginPerFirstTrain
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
    latestOriginDepartureMinute: number | undefined,
    destinationRoadAccessMinutes: Map<string, number>
): {
    paths: RailwayPath[];
    originsWithoutDirectPaths: RailwaySearchOrigin[];
} {
    const paths: RailwayPath[] = [];
    const originsWithoutDirectPaths: RailwaySearchOrigin[] = [];

    for (const origin of origins) {
        let originPaths: RailwayPath[] = [];
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

        // Same rule as pruneUpstreamAlightingDetours() in
        // journey-search.service.ts: getting off this origin's train at an
        // earlier stop is dropped when the same train also reaches a later
        // candidate stop needing no more road access. Applying it here,
        // before the quotas below, keeps those certain-to-be-pruned
        // variants from using up slots - otherwise an origin's one
        // guaranteed slot in executeSearch() could go to an early stop
        // (e.g. Dewas for an Indore search) and the same boarding to the
        // real destination station never surfaced.
        const pathsByTrain = new Map<string, RailwayPath[]>();
        for (const path of originPaths) {
            const trainId = path.connections[0].trainId;
            const group = pathsByTrain.get(trainId);
            if (group) group.push(path);
            else pathsByTrain.set(trainId, [path]);
        }
        const destinationAccess = (path: RailwayPath) =>
            destinationRoadAccessMinutes.get(path.destinationStationId);
        originPaths = originPaths.filter(candidate => {
            const candidateAccess = destinationAccess(candidate);
            if (candidateAccess === undefined) return true;
            return !pathsByTrain.get(candidate.connections[0].trainId)?.some(
                other => {
                    const otherAccess = destinationAccess(other);
                    return other !== candidate
                        && otherAccess !== undefined
                        && other.arrivalMinute > candidate.arrivalMinute
                        && otherAccess <= candidateAccess;
                }
            );
        });
        originPaths.sort((left, right) =>
            left.arrivalMinute - right.arrivalMinute
            || left.departureMinute - right.departureMinute
        );
        if (originPaths.length === 0) {
            originsWithoutDirectPaths.push(origin);
        } else {
            // A busy origin can have many different trains reaching many
            // different candidate destination stations. Selecting purely by
            // arrival time - "first distinct destination wins, then fill
            // remaining slots soonest-first" - lets a nearby but otherwise
            // irrelevant destination, reached by many short local trains,
            // consume the whole per-origin quota before the traveler's own
            // selected destination is ever considered, since a real direct
            // train to that destination is necessarily a longer ride and so
            // arrives later. That silently discards a genuine direct train
            // to the actual destination in favor of unrelated trains to
            // other nearby stations that merely happened to arrive sooner.
            // Give every candidate destination its own fair, guaranteed
            // share of the quota instead (mirroring the per-origin fair
            // share computed above), independent of arrival time across
            // different destinations.
            const maxResultsPerDestination = Math.max(
                1,
                Math.ceil(maxResultsPerOrigin / destinationStationIds.size)
            );
            const perDestinationCount = new Map<string, number>();
            const selected: RailwayPath[] = [];
            for (const path of originPaths) {
                const count = perDestinationCount.get(
                    path.destinationStationId
                ) ?? 0;
                if (count >= maxResultsPerDestination) continue;
                perDestinationCount.set(path.destinationStationId, count + 1);
                selected.push(path);
                if (selected.length >= maxResultsPerOrigin) break;
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
    // Must include destinationStationId: findDirectPaths() already
    // correctly retains one entry per distinct destination for the same
    // train (its own per-origin `keys` set is keyed by
    // `${trainId}:${destinationStationId}`), but without it here too, this
    // cross-origin dedup would still collapse a train's earlier candidate
    // destination (e.g. a stop within the destination search radius) and
    // its later stop at the traveler's actual selected station into "the
    // same" direct service, discarding whichever was sorted/processed second.
    return `DIRECT|${path.originStationId}|${path.destinationStationId}|${first.trainNumber}@${first.serviceDate ?? ""}`;
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
        // Boardings of the same train run share their arrival, and the
        // shortest in-vehicle time always belongs to the stop farthest down
        // the line - so a duration tie-break here made Pass 1 below pick
        // that farther stop (e.g. Roorkee) over the traveler's own station
        // (e.g. Haridwar) on the same train. Order instead as the final
        // compareJourneyOptions() does: door-to-door arrival (train arrival
        // plus road access from the alighting station), then total road
        // access, then the existing keys - so an origin's per-origin slot
        // also goes to the alighting stop nearest the real destination
        // rather than an earlier stop reached by a longer road leg.
        const roadAccessByOrigin = new Map(
            origins.map(origin => [origin.stationId, origin.roadAccessMinutes])
        );
        const destinationAccess = (path: RailwayPath) =>
            limits.destinationRoadAccessMinutes.get(path.destinationStationId)
            ?? 0;
        const roadAccess = (path: RailwayPath) =>
            (roadAccessByOrigin.get(path.originStationId) ?? 0)
            + destinationAccess(path);
        const direct = findDirectPaths(
            snapshot,
            origins,
            destinationStationIds,
            requestedDate,
            limits.maxResults,
            routingLimits.searchHorizonDays,
            limits.latestOriginDepartureMinute,
            limits.destinationRoadAccessMinutes
        ).paths.sort((left, right) =>
            pathTransferCount(left) - pathTransferCount(right)
            || left.arrivalMinute + destinationAccess(left)
                - right.arrivalMinute - destinationAccess(right)
            || roadAccess(left) - roadAccess(right)
            || comparePaths(left, right, limits.sortBy)
        );
        // Same fairness problem one level up: this merges direct paths
        // across every origin AND every candidate destination. Capping
        // purely by "first limits.maxResults in arrival-time order" lets
        // paths to a nearby-but-irrelevant destination - reached sooner
        // simply because it is an earlier stop on the same or a different
        // train - crowd out paths to the traveler's own selected
        // destination before this loop ever reaches them. A per-destination
        // cap alone is not enough either: multiple origins boarding the
        // SAME train to a destination can still fill that destination's
        // whole share before a genuinely DIFFERENT train serving the same
        // destination (from any origin) is ever considered. Pass 1
        // guarantees every distinct (destination, train) pair gets at
        // least one representative - whichever origin sorts first for it -
        // regardless of arrival time relative to other destinations/trains.
        // Pass 2 then fills any remaining budget with further alternatives
        // (other origins for a train/destination already represented),
        // still respecting the per-destination cap.
        const maxDirectResultsPerDestination = Math.max(
            1,
            Math.ceil(limits.maxResults / destinationStationIds.size)
        );
        const directCountByDestination = new Map<string, number>();
        const admittedTrainsByDestination = new Map<string, Set<string>>();
        for (const path of direct) {
            if (directPaths.length >= limits.maxResults) break;
            const key = directServiceKey(path);
            if (trainKeys.has(key)) continue;
            const trainId = path.connections[0].trainId;
            const admittedTrains = admittedTrainsByDestination.get(
                path.destinationStationId
            ) ?? new Set<string>();
            if (admittedTrains.has(trainId)) continue;
            trainKeys.add(key);
            admittedTrains.add(trainId);
            admittedTrainsByDestination.set(
                path.destinationStationId,
                admittedTrains
            );
            directCountByDestination.set(
                path.destinationStationId,
                (directCountByDestination.get(path.destinationStationId) ?? 0)
                    + 1
            );
            directPaths.push(path);
        }
        // Pass 1 guarantees every distinct (destination, train) pair a
        // representative, but always picks whichever origin's version of
        // that pair sorts first in the shared arrival/road-access order -
        // for the same scheduled arrival, that is the origin needing the
        // LEAST road access. Any other legitimate origin can then go
        // completely unrepresented even when every candidate boarding
        // station is supposed to be searched independently (this is the
        // same class of bug the origin-aware directServiceKey() fixed for
        // dedup collisions - this is the admission-budget counterpart of
        // it). Give every origin with at least one still-admissible direct
        // candidate one guaranteed slot too, before Pass 2's unrestricted
        // fill - still bounded by the same per-destination cap and train
        // dedup as every other pass, so this can only add origin coverage,
        // never displace Pass 1's picks or exceed destination fairness.
        const admittedOrigins = new Set(
            directPaths.map(path => path.originStationId)
        );
        for (const path of direct) {
            if (directPaths.length >= limits.maxResults) break;
            if (admittedOrigins.has(path.originStationId)) continue;
            const key = directServiceKey(path);
            if (trainKeys.has(key)) continue;
            const destinationCount = directCountByDestination.get(
                path.destinationStationId
            ) ?? 0;
            if (destinationCount >= maxDirectResultsPerDestination) continue;
            trainKeys.add(key);
            admittedOrigins.add(path.originStationId);
            directCountByDestination.set(
                path.destinationStationId,
                destinationCount + 1
            );
            directPaths.push(path);
        }
        for (const path of direct) {
            if (directPaths.length >= limits.maxResults) break;
            const key = directServiceKey(path);
            if (trainKeys.has(key)) continue;
            const destinationCount = directCountByDestination.get(
                path.destinationStationId
            ) ?? 0;
            if (destinationCount >= maxDirectResultsPerDestination) continue;
            trainKeys.add(key);
            directCountByDestination.set(
                path.destinationStationId,
                destinationCount + 1
            );
            directPaths.push(path);
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
    sortBy: JourneySortOrder = "transfers",
    destinationRoadAccessMinutes: Map<string, number> = new Map()
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
            .map(origin =>
                `${origin.stationId}:${origin.readyMinute}:${origin.roadAccessMinutes}`
            )
            .join(","),
        [...destinationStationIds]
            .sort()
            .map(stationId =>
                `${stationId}:${destinationRoadAccessMinutes.get(stationId) ?? 0}`
            )
            .join(","),
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
                {
                    maxResults,
                    latestOriginDepartureMinute,
                    sortBy,
                    destinationRoadAccessMinutes
                },
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
