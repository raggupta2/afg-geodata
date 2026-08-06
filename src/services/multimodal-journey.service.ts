import { createHash } from "crypto";
import { BoundedAsyncTtlCache } from "../cache/bounded-async-ttl-cache";
import {
    MultimodalJourneyResult,
    MultimodalLeg,
    MultimodalPlace,
    MultimodalSearchInput,
    MultimodalSearchResult
} from "../types/multimodal-journey";
import {
    findNearbyRoutingHubs,
    loadCoverageSummary,
    loadFlightInstances,
    loadRoutingHubs,
    loadRoutingPolicy,
    loadTransferLinks,
    NearbyRoutingHub,
    RoutingHub
} from "../repositories/multimodal-routing.repository";
import {
    expandRailwayRides,
    RailwayRideExpansion
} from "./railway-provider.service";
import {
    createRailwayDateSearchClock,
    instantToMinute,
    minuteToInstant
} from "./journey-time.service";
import { searchCoordinateRailwayJourney } from "./journey-search.service";
import { JourneyTrainResult } from "../types/journey-search";

type FlightRecord = Awaited<ReturnType<typeof loadFlightInstances>>[number];
type Policy = Awaited<ReturnType<typeof loadRoutingPolicy>>;
type TransferRecord = Awaited<ReturnType<typeof loadTransferLinks>>[number];

type SearchState = {
    hubId: string;
    arrivalMs: number;
    priority: number;
    scheduledLegs: number;
    lastMode: "RAIL" | "FLIGHT" | null;
    currentCityId: string | null;
    visitedCityIds: Set<string>;
    visitedHubIds: Set<string>;
    usedTrainIds: Set<string>;
    usedFlightIds: Set<string>;
    modes: Array<"RAIL" | "FLIGHT">;
    serviceKeys: string[];
    departureHub: RoutingHub;
    legs: MultimodalLeg[];
};

class StateQueue {
    private readonly values: SearchState[] = [];
    get length(): number { return this.values.length; }

    push(value: SearchState): void {
        this.values.push(value);
        let index = this.values.length - 1;
        while (index > 0) {
            const parent = Math.floor((index - 1) / 2);
            if (this.values[parent].priority <= value.priority) break;
            this.values[index] = this.values[parent];
            index = parent;
        }
        this.values[index] = value;
    }

    pop(): SearchState | undefined {
        const first = this.values[0];
        const last = this.values.pop();
        if (!first || !last || this.values.length === 0) return first;
        let index = 0;
        while (true) {
            const left = index * 2 + 1;
            const right = left + 1;
            if (left >= this.values.length) break;
            let next = left;
            if (
                right < this.values.length
                && this.values[right].priority < this.values[left].priority
            ) next = right;
            if (this.values[next].priority >= last.priority) break;
            this.values[index] = this.values[next];
            index = next;
        }
        this.values[index] = last;
        return first;
    }
}

const EARTH_RADIUS_KM = 6371;
// Deliberately optimistic domestic-flight cruise speed. Used only as the A*
// heuristic's speed bound - it must never be lower than the fastest real mode,
// otherwise the heuristic could overestimate remaining time and the search
// could skip past a genuinely faster route.
const FASTEST_MODE_SPEED_KPH = 900;

// Complete RAIL_ONLY coverage already comes from the dedicated point-to-point
// rail search below (railwayOnlyPromise); the only reason this unified search
// needs to expand RAIL legs before a FLIGHT has been taken is to reach a hub
// with flight connectivity from the origin (a short "feeder" rail leg to an
// airport). Left uncapped, the shared expansion budget gets consumed by deep
// nation-wide pure-rail branches - which duplicate that dedicated search - long
// before genuinely useful mixed-mode states (e.g. a nearby airport reachable by
// a short flight) are ever popped from the queue.
const MAX_FEEDER_RAIL_LEGS_BEFORE_FLIGHT = 2;

// A hub can carry active transfer links to dozens of small stations/airports
// scattered across a wide metro area (a real traveler would use one of the
// handful of nearest ones, not a suburban halt 50km away). Exploring every
// link fully - each independently re-running a ride search - multiplies the
// state count by the link count at every hub visit, which is what actually
// starves out the search budget before it reaches a useful destination.
// Keeping only the nearest few preserves the realistic options while keeping
// this multiplier bounded.
const MAX_TRANSFER_TARGETS_PER_HUB = 8;

// Rail exploration that hasn't used a flight yet is only useful for reaching a
// hub with flight connectivity (see MAX_FEEDER_RAIL_LEGS_BEFORE_FLIGHT above),
// so it doesn't need the same breadth per station visit as post-flight rail
// continuation - a much smaller sample of the earliest departures is enough to
// find a way to an airport, and keeping it small is what leaves the shared
// expansion budget available for the flight-inclusive states search is meant
// to find.
const FEEDER_RAIL_RIDE_OPTIONS = 30;
const POST_FLIGHT_RAIL_RIDE_OPTIONS = 150;

// A busy railway station near a major airport (e.g. a state capital's junction)
// gets reached by dozens of near-duplicate states - the same physical station,
// moments apart, via many different flights into the same city. Each one would
// otherwise re-run its own full onward-rail search and push its own near-
// identical batch of results, so the first (best-priority, by A*'s best-first
// order) handful of visits already cover the useful onward options; letting
// every later visit repeat that work is what actually starves out the shared
// budget before a distinct, useful itinerary (e.g. from a smaller origin
// airport with only one flight into that city) gets a chance to be explored.
const MAX_RAIL_EXPANSIONS_PER_HUB = 20;

// The very first hop needs full breadth - every departure airport/flight from
// the true origin is an equally valid starting point. A second or third flight
// hop is different: it's already a less practical choice (see the transfer
// penalty in the ranking below), so exploring dozens of onward destinations
// from it - each a further multiplier on an already-large branching factor -
// spends the shared search budget on itineraries that are unlikely to rank
// well even if found. A small sample of the earliest onward flights is enough
// to represent that option without letting it dominate the queue.
const FIRST_HOP_MAX_FLIGHTS_PER_DESTINATION = 3;
const FIRST_HOP_MAX_FLIGHTS_TOTAL = 150;
const ONWARD_HOP_MAX_FLIGHTS_PER_DESTINATION = 1;
const ONWARD_HOP_MAX_FLIGHTS_TOTAL = 20;

function toRadians(degrees: number): number {
    return degrees * Math.PI / 180;
}

function haversineKm(
    fromLatitude: number,
    fromLongitude: number,
    toLatitude: number,
    toLongitude: number
): number {
    const dLat = toRadians(toLatitude - fromLatitude);
    const dLon = toRadians(toLongitude - fromLongitude);
    const sinLat = Math.sin(dLat / 2);
    const sinLon = Math.sin(dLon / 2);
    const a = sinLat * sinLat
        + Math.cos(toRadians(fromLatitude)) * Math.cos(toRadians(toLatitude)) * sinLon * sinLon;
    return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

// Lower bound on the time still needed to reach the destination from this
// point, assuming the rest of the trip could be flown in a straight line at
// FASTEST_MODE_SPEED_KPH. Adding this to arrivalMs turns the plain earliest-
// arrival search into A*: states that are still geographically far from the
// destination get deprioritized even if their clock time is early, so a dense
// local rail network can no longer starve out a faster route departing from a
// different hub.
//
// HEURISTIC_WEIGHT scales that bound above 1, which makes the search greedier
// (a "weighted A*") and no longer strictly admissible - a truly-earliest state
// that happens to be geographically far from the destination can now be popped
// after a slightly-later one that's already close to it. That trade is
// deliberate here: this search already runs under a hard expansion budget and
// reports its results as best-effort (see `truncated`), not a proven optimum,
// so a heuristic this system can't reach that guarantee for anyway is better
// spent keeping the frontier pointed at the destination - without it, a dense
// network's sheer number of same-day departures in every direction drowns out
// the few states actually converging on the destination well before the
// budget is exhausted.
const HEURISTIC_WEIGHT = 12;

function remainingTimeHeuristicMs(
    fromLatitude: number,
    fromLongitude: number,
    toLatitude: number,
    toLongitude: number
): number {
    const distanceKm = haversineKm(fromLatitude, fromLongitude, toLatitude, toLongitude);
    return (distanceKm / FASTEST_MODE_SPEED_KPH) * 60 * 60 * 1000 * HEURISTIC_WEIGHT;
}

const resultCache = new BoundedAsyncTtlCache<MultimodalSearchResult>(
    Number(process.env.MULTIMODAL_RESULT_CACHE_TTL_MS ?? 60_000),
    Number(process.env.MULTIMODAL_RESULT_CACHE_MAX_ENTRIES ?? 500)
);

const round = (value: number): number => Math.round(value * 10) / 10;
const iso = (milliseconds: number): string => new Date(
    milliseconds + 330 * 60_000
).toISOString().replace("Z", "+05:30");

function place(hub: RoutingHub): MultimodalPlace {
    return {
        kind: hub.type,
        id: hub.id,
        code: hub.code,
        name: hub.name,
        city: hub.cityName ?? undefined,
        latitude: hub.latitude,
        longitude: hub.longitude,
        timezone: hub.timezone
    };
}

function endpointPlace(
    input: MultimodalSearchInput,
    kind: "USER_LOCATION" | "DESTINATION"
): MultimodalPlace {
    const coordinates = kind === "USER_LOCATION" ? input.origin : input.destination;
    return {
        kind,
        name: coordinates.label ?? (kind === "USER_LOCATION" ? "Current location" : "Destination"),
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        timezone: "Asia/Kolkata"
    };
}

function access(hub: NearbyRoutingHub, policy: Policy) {
    const roadKm = hub.aerialDistanceKm * Number(policy.roadDetourFactor);
    const roadSpeedKph = roadKm > Number(policy.roadSpeedDistanceThresholdKm)
        ? Number(policy.longDistanceRoadSpeedKph)
        : Number(policy.roadSpeedKph);
        
    return {
        roadKm,
        minutes: Math.ceil(roadKm / roadSpeedKph * 60)
    };
}

function waitLeg(
    hub: RoutingHub,
    fromMs: number,
    toMs: number,
    transferType: string
): MultimodalLeg[] {
    if (toMs <= fromMs) return [];
    return [{
        mode: "WAIT",
        from: place(hub),
        to: place(hub),
        departureAt: iso(fromMs),
        arrivalAt: iso(toMs),
        durationMinutes: Math.ceil((toMs - fromMs) / 60_000),
        transferType
    }];
}

function railwayDistance(ride: RailwayRideExpansion): number | null {
    const first = ride.connections[0];
    const last = ride.connections[ride.connections.length - 1];
    return first.fromDistanceKm === null || last.toDistanceKm === null
        ? null
        : Math.max(0, last.toDistanceKm - first.fromDistanceKm);
}

function stateKey(state: SearchState): string {
    return [
        state.hubId,
        state.scheduledLegs,
        state.lastMode ?? "NONE",
        [...state.visitedCityIds].sort().join(",")
    ].join("|");
}

function canVisitCity(state: SearchState, cityId: string | null): boolean {
    return cityId === null
        || cityId === state.currentCityId
        || !state.visitedCityIds.has(cityId);
}

function withVisitedCity(state: SearchState, hub: RoutingHub): Set<string> {
    const visited = new Set(state.visitedCityIds);
    if (hub.cityId) visited.add(hub.cityId);
    return visited;
}

function journeyType(modes: Array<"RAIL" | "FLIGHT">): MultimodalJourneyResult["journeyType"] {
    const unique = new Set(modes);
    if (unique.size > 1) return "MIXED";
    return unique.has("FLIGHT") ? "FLIGHT_ONLY" : "RAIL_ONLY";
}

function dateOnlyOrigin(
    legs: MultimodalLeg[],
    policy: Policy
): { departureMs: number; legs: MultimodalLeg[] } {
    const firstScheduledIndex = legs.findIndex(leg =>
        leg.mode === "RAIL" || leg.mode === "FLIGHT"
    );
    const firstScheduled = legs[firstScheduledIndex];
    const initialLocal = legs.slice(0, firstScheduledIndex).find(leg =>
        leg.mode === "LOCAL" && leg.from.kind === "USER_LOCATION"
    );
    if (!firstScheduled || !initialLocal) {
        return {
            departureMs: Date.parse(legs[0]?.departureAt ?? ""),
            legs
        };
    }

    const firstServiceDepartureMs = Date.parse(firstScheduled.departureAt);
    const bufferMinutes = firstScheduled.mode === "FLIGHT"
        ? policy.initialFlightBufferMinutes
        : policy.initialRailBufferMinutes;
    const hubArrivalMs = firstServiceDepartureMs - bufferMinutes * 60_000;
    const departureMs = hubArrivalMs - initialLocal.durationMinutes * 60_000;
    const adjustedLocal: MultimodalLeg = {
        ...initialLocal,
        departureAt: iso(departureMs),
        arrivalAt: iso(hubArrivalMs)
    };
    const boardingBuffer: MultimodalLeg[] = bufferMinutes > 0 ? [{
        mode: "WAIT",
        from: initialLocal.to,
        to: initialLocal.to,
        departureAt: iso(hubArrivalMs),
        arrivalAt: firstScheduled.departureAt,
        durationMinutes: bufferMinutes,
        transferType: "INITIAL_BOARDING_BUFFER"
    }] : [];

    return {
        departureMs,
        legs: [adjustedLocal, ...boardingBuffer, ...legs.slice(firstScheduledIndex)]
    };
}

function resultFromState(
    state: SearchState,
    destinationHub: NearbyRoutingHub,
    request: MultimodalSearchInput,
    policy: Policy
): MultimodalJourneyResult {
    const finalAccess = access(destinationHub, policy);
    const finalArrivalMs = state.arrivalMs + finalAccess.minutes * 60_000;
    const destination = endpointPlace(request, "DESTINATION");
    const itineraryKey = state.serviceKeys.join("|");
    const originJourney = dateOnlyOrigin(state.legs, policy);
    return {
        id: createHash("sha256").update(
            `${state.departureHub.id}|${destinationHub.id}|${itineraryKey}`
        ).digest("hex").slice(0, 16),
        rank: 0,
        journeyType: journeyType(state.modes),
        departureHub: place(state.departureHub),
        arrivalHub: place(destinationHub),
        departureAt: iso(originJourney.departureMs),
        finalArrivalAt: iso(finalArrivalMs),
        totalJourneyMinutes: Math.ceil(
            (finalArrivalMs - originJourney.departureMs) / 60_000
        ),
        numberOfTransfers: Math.max(0, state.scheduledLegs - 1),
        scheduledLegs: state.scheduledLegs,
        modes: [...new Set(state.modes)],
        legs: [...originJourney.legs, {
            mode: "LOCAL",
            from: place(destinationHub),
            to: destination,
            departureAt: iso(state.arrivalMs),
            arrivalAt: iso(finalArrivalMs),
            durationMinutes: finalAccess.minutes,
            distanceKm: round(destinationHub.aerialDistanceKm),
            estimatedRoadDistanceKm: round(finalAccess.roadKm)
        }]
    };
}

function railwayPlace(source: JourneyTrainResult["legs"][number]["from"]): MultimodalPlace {
    return {
        kind: source.kind === "DESTINATION"
            ? "DESTINATION"
            : source.kind === "USER_LOCATION"
                ? "USER_LOCATION"
                : "RAILWAY_STATION",
        id: source.id,
        code: source.code,
        name: source.name,
        latitude: source.latitude,
        longitude: source.longitude,
        timezone: source.timeZone
    };
}

function convertRailwayResult(result: JourneyTrainResult): MultimodalJourneyResult {
    const railLegs = result.legs.filter(leg => leg.mode === "RAIL");
    const lastRailLeg = railLegs[railLegs.length - 1];
    return {
        id: `rail-${result.id}`,
        rank: 0,
        journeyType: "RAIL_ONLY",
        departureHub: railwayPlace(railLegs[0].from),
        arrivalHub: railwayPlace(lastRailLeg.to),
        departureAt: result.suggestedLeaveHomeAt,
        finalArrivalAt: result.finalArrivalAt,
        totalJourneyMinutes: result.totalJourneyMinutes,
        numberOfTransfers: result.numberOfTransfers,
        scheduledLegs: result.trains.length,
        modes: ["RAIL"],
        legs: result.legs.map(leg => ({
            mode: leg.mode === "TRANSFER"
                ? leg.transferType === "BOARDING_WAIT" ? "WAIT" : "TRANSFER"
                : leg.mode,
            from: railwayPlace(leg.from),
            to: railwayPlace(leg.to),
            departureAt: leg.departureAt,
            arrivalAt: leg.arrivalAt,
            durationMinutes: leg.durationMinutes,
            distanceKm: leg.mode === "LOCAL"
                ? leg.aerialDistanceKm
                : leg.mode === "RAIL" ? leg.distanceKm : undefined,
            estimatedRoadDistanceKm: leg.mode === "LOCAL"
                ? leg.estimatedRoadDistanceKm
                : undefined,
            transferType: leg.mode === "TRANSFER" ? leg.transferType : undefined,
            serviceNumber: leg.mode === "RAIL" ? leg.trainNumber : undefined,
            serviceName: leg.mode === "RAIL" ? leg.trainName : undefined,
            numberOfStops: leg.mode === "RAIL" ? leg.numberOfStops : undefined
        }))
    };
}

function registerState(
    state: SearchState,
    best: Map<string, number>,
    queue: StateQueue
): void {
    const key = stateKey(state);
    const known = best.get(key);
    if (known !== undefined && known <= state.arrivalMs) return;
    best.set(key, state.arrivalMs);
    queue.push(state);
}

// --- Ranking ---
// The search above enumerates every itinerary that reaches the destination; ranking
// then decides which of those is most PRACTICAL to actually take, which is not the
// same question as "which has the fewest total minutes". Left unweighted, a route
// that shaves a few minutes off the clock by adding a third or fourth flight leg
// will out-rank a route that is barely slower but far simpler to travel - flight
// segments cost real money and carry connection risk that raw duration ignores.
//
// Every penalty below is expressed as duration-equivalent minutes so it can be
// added directly to totalJourneyMinutes and compared on one scale. None of this is
// a real cost model - once actual per-km fares for flight/train/road become
// configurable (tracked separately as a future enhancement), FLIGHT_DISTANCE_MINUTES_PER_KM
// in particular should be replaced by a real cost-per-km -> minutes conversion.

// Flight kilometres are expensive relative to the time they take, so a modest
// per-km penalty lets a route with a meaningfully shorter flight distance outrank
// one that is only slightly faster, without letting it override a large duration
// gap (e.g. a 500km shorter flight route buys ~100 minutes of tolerance).
const FLIGHT_DISTANCE_MINUTES_PER_KM = 0.2;

// Flat inconvenience cost for every additional transfer: queues, luggage
// handling, and a chance of missing the next leg.
const TRANSFER_PENALTY_MINUTES = 25;

// Flight-to-flight connections add security/immigration/baggage overhead on top
// of the generic transfer cost above, so they're penalized again per occurrence.
const FLIGHT_TRANSFER_PENALTY_MINUTES = 35;

// Beyond this many transfers, each extra one is treated as increasingly
// impractical (quadratic, not flat) so a 4+ transfer itinerary only outranks a
// simpler one when its raw numbers are substantially better, not marginally so.
const EXCESSIVE_TRANSFER_THRESHOLD = 3;
const EXCESSIVE_TRANSFER_PENALTY_MINUTES = 45;

// A short layover is a normal, expected part of connecting; only time spent
// waiting beyond this is treated as dead, impractical time.
const REASONABLE_LAYOVER_MINUTES = 90;
const LONG_LAYOVER_PENALTY_FACTOR = 0.5;

// An intermodal transfer that requires a long road hop between hubs (e.g. an
// airport far from the connecting railway station) is a genuine detour beyond
// the time it already adds to the clock.
const TRANSFER_DETOUR_PENALTY_PER_KM = 0.5;

function totalFlightDistanceKm(result: MultimodalJourneyResult): number {
    return result.legs
        .filter(leg => leg.mode === "FLIGHT")
        .reduce((sum, leg) => sum + (leg.distanceKm ?? 0), 0);
}

function flightTransferCount(result: MultimodalJourneyResult): number {
    return Math.max(0, result.legs.filter(leg => leg.mode === "FLIGHT").length - 1);
}

function transferPenaltyMinutes(result: MultimodalJourneyResult): number {
    const transfers = result.numberOfTransfers;
    const excess = Math.max(0, transfers - EXCESSIVE_TRANSFER_THRESHOLD);
    return transfers * TRANSFER_PENALTY_MINUTES
        + flightTransferCount(result) * FLIGHT_TRANSFER_PENALTY_MINUTES
        + excess * excess * EXCESSIVE_TRANSFER_PENALTY_MINUTES;
}

function longLayoverPenaltyMinutes(result: MultimodalJourneyResult): number {
    return result.legs
        .filter(leg => leg.mode === "WAIT")
        .reduce((penalty, leg) => {
            const excess = leg.durationMinutes - REASONABLE_LAYOVER_MINUTES;
            return excess > 0 ? penalty + excess * LONG_LAYOVER_PENALTY_FACTOR : penalty;
        }, 0);
}

function transferDetourPenaltyMinutes(result: MultimodalJourneyResult): number {
    return result.legs
        .filter(leg => leg.mode === "TRANSFER")
        .reduce((sum, leg) => sum + (leg.distanceKm ?? 0) * TRANSFER_DETOUR_PENALTY_PER_KM, 0);
}

// Lower score = more practical. Combines total travel time with duration-equivalent
// penalties for flight distance, transfer count/type, long layovers, and transfer
// detours, so routes are ranked on overall practicality rather than any single
// metric optimized in isolation.
function practicalityScore(result: MultimodalJourneyResult): number {
    return result.totalJourneyMinutes
        + totalFlightDistanceKm(result) * FLIGHT_DISTANCE_MINUTES_PER_KM
        + transferPenaltyMinutes(result)
        + longLayoverPenaltyMinutes(result)
        + transferDetourPenaltyMinutes(result);
}

export function compareMultimodalJourneyResults(
    left: MultimodalJourneyResult,
    right: MultimodalJourneyResult
): number {
    return practicalityScore(left) - practicalityScore(right)
        || left.numberOfTransfers - right.numberOfTransfers
        || Date.parse(left.finalArrivalAt) - Date.parse(right.finalArrivalAt);
}

function isServiceKeyPrefix(prefix: string[], keys: string[]): boolean {
    if (prefix.length >= keys.length) return false;
    return prefix.every((key, index) => key === keys[index]);
}

// Discards an itinerary only when another surviving itinerary already reaches the
// same destination using a strict prefix of the same scheduled flights/trains and
// does so no slower and with no more transfers - i.e. the extra legs on top of that
// shared prefix (e.g. an unnecessary rail detour tacked on after the same flight)
// added nothing. Itineraries built from genuinely different services (a different
// flight, a different train) are always kept, even if slower, since they are real
// alternatives rather than a pointless continuation of a shorter route.
function pruneRedundantContinuations(
    entries: Array<{ serviceKeys: string[]; result: MultimodalJourneyResult }>
): MultimodalJourneyResult[] {
    return entries
        .filter(candidate =>
            !entries.some(other =>
                other !== candidate
                && isServiceKeyPrefix(other.serviceKeys, candidate.serviceKeys)
                && other.result.totalJourneyMinutes <= candidate.result.totalJourneyMinutes
                && other.result.numberOfTransfers <= candidate.result.numberOfTransfers
            )
        )
        .map(entry => entry.result);
}

function isServiceKeySuffix(suffix: string[], keys: string[]): boolean {
    if (suffix.length >= keys.length) return false;
    const offset = keys.length - suffix.length;
    return suffix.every((key, index) => key === keys[offset + index]);
}

// Discards an itinerary only when another surviving itinerary boards the exact same
// remaining sequence of flights/trains (a strict suffix of this one's scheduled
// services) while spending no more total time and no more transfers overall - i.e.
// the extra legs BEFORE that shared suffix (e.g. a long rail detour to reach an
// airport that was already reachable by a short direct road hop) bought nothing.
// Itineraries that board a genuinely different flight or train downstream - even to
// the same airport - are always kept, since they are real alternatives rather than
// merely a worse way of reaching the same onward service.
function pruneDominatedAccessPaths(
    entries: Array<{ serviceKeys: string[]; result: MultimodalJourneyResult }>
): Array<{ serviceKeys: string[]; result: MultimodalJourneyResult }> {
    return entries.filter(candidate =>
        !entries.some(other =>
            other !== candidate
            && isServiceKeySuffix(other.serviceKeys, candidate.serviceKeys)
            && other.result.totalJourneyMinutes <= candidate.result.totalJourneyMinutes
            && other.result.numberOfTransfers <= candidate.result.numberOfTransfers
        )
    );
}

async function executeSearch(request: MultimodalSearchInput): Promise<MultimodalSearchResult> {
    const requested = new Date(`${request.departureAt}T00:00:00+05:30`);
    const requestedMs = requested.getTime();
    const firstServiceDateEndMs = requestedMs + 24 * 60 * 60 * 1000;
    const railwayOnlyPromise = searchCoordinateRailwayJourney({
        origin: request.origin,
        destination: request.destination,
        departureDate: request.departureAt,
        options: {
            sourceRadiusKm: request.options.sourceRailRadiusKm,
            destinationRadiusKm: request.options.destinationRailRadiusKm,
            sourceCandidateLimit: Math.max(2, request.options.candidatesPerMode),
            destinationCandidateLimit: request.options.candidatesPerMode,
            boardingStationLimit: request.options.candidatesPerMode,
            routesPerBoardingStation: 3,
            resultLimit: Math.max(request.options.resultLimit, 10)
        }
    });
    const [policy, sourceHubs, destinationHubs, hubs] = await Promise.all([
        loadRoutingPolicy(),
        findNearbyRoutingHubs(
            request.origin.latitude,
            request.origin.longitude,
            request.options.sourceRailRadiusKm,
            request.options.sourceAirportRadiusKm,
            request.options.candidatesPerMode,
            true
        ),
        findNearbyRoutingHubs(
            request.destination.latitude,
            request.destination.longitude,
            request.options.destinationRailRadiusKm,
            request.options.destinationAirportRadiusKm,
            request.options.candidatesPerMode
        ),
        loadRoutingHubs()
    ]);
    const maximumTransfers = Math.min(
        request.options.maximumTransfers ?? policy.maximumTransfers,
        policy.maximumTransfers
    );
    const maximumScheduledLegs = maximumTransfers + 1;
    const horizonEnd = new Date(
        requestedMs + policy.searchHorizonDays * 24 * 60 * 60 * 1000
    );
    const [flights, transfers, coverage] = await Promise.all([
        loadFlightInstances(requested, horizonEnd),
        loadTransferLinks(),
        loadCoverageSummary(requested, horizonEnd)
    ]);
    const stationToHub = new Map<string, RoutingHub>();
    for (const hub of hubs.values()) {
        if (hub.stationId) stationToHub.set(hub.stationId, hub);
    }
    const flightsByHub = new Map<string, FlightRecord[]>();
    for (const flight of flights) {
        const hubId = flight.departureAirport.hub.id.toString();
        const values = flightsByHub.get(hubId) ?? [];
        values.push(flight);
        flightsByHub.set(hubId, values);
    }
    const transfersByHub = new Map<string, TransferRecord[]>();
    for (const transfer of transfers) {
        const key = transfer.fromHubId.toString();
        const values = transfersByHub.get(key) ?? [];
        values.push(transfer);
        transfersByHub.set(key, values);
    }
    for (const [key, values] of transfersByHub) {
        if (values.length <= MAX_TRANSFER_TARGETS_PER_HUB) continue;
        values.sort((left, right) =>
            Number(left.aerialDistanceKm) - Number(right.aerialDistanceKm)
        );
        transfersByHub.set(key, values.slice(0, MAX_TRANSFER_TARGETS_PER_HUB));
    }
    const destinationByHub = new Map(destinationHubs.map(hub => [hub.id, hub]));
    const clock = createRailwayDateSearchClock(request.departureAt);
    const queue = new StateQueue();
    const best = new Map<string, number>();
    const origin = endpointPlace(request, "USER_LOCATION");

    for (const candidate of sourceHubs) {
        const hub = hubs.get(candidate.id);
        if (!hub) continue;
        const sourceAccess = access(candidate, policy);
        const buffer = hub.type === "AIRPORT"
            ? policy.initialFlightBufferMinutes
            : policy.initialRailBufferMinutes;
        const readyMs = requestedMs;
        const hubArrivalMs = readyMs - buffer * 60_000;
        const originDepartureMs = hubArrivalMs - sourceAccess.minutes * 60_000;
        const visitedCities = new Set<string>();
        if (hub.cityId) visitedCities.add(hub.cityId);
        const legs: MultimodalLeg[] = [{
            mode: "LOCAL",
            from: origin,
            to: place(hub),
            departureAt: iso(originDepartureMs),
            arrivalAt: iso(hubArrivalMs),
            durationMinutes: sourceAccess.minutes,
            distanceKm: round(candidate.aerialDistanceKm),
            estimatedRoadDistanceKm: round(sourceAccess.roadKm)
        }, ...waitLeg(hub, hubArrivalMs, readyMs, "INITIAL_BOARDING_BUFFER")];
        registerState({
            hubId: hub.id,
            arrivalMs: readyMs,
            priority: readyMs + remainingTimeHeuristicMs(
                hub.latitude, hub.longitude,
                request.destination.latitude, request.destination.longitude
            ),
            scheduledLegs: 0,
            lastMode: null,
            currentCityId: hub.cityId,
            visitedCityIds: visitedCities,
            visitedHubIds: new Set([hub.id]),
            usedTrainIds: new Set(),
            usedFlightIds: new Set(),
            modes: [],
            serviceKeys: [],
            departureHub: hub,
            legs
        }, best, queue);
    }

    const results = new Map<string, { serviceKeys: string[]; result: MultimodalJourneyResult }>();
    const maximumExpandedStates = Number(
        process.env.MULTIMODAL_MAX_EXPANDED_STATES ?? 15_000
    );
    let expandedStates = 0;
    let truncated = false;
    const railExpansionsByHub = new Map<string, number>();

    while (queue.length > 0) {
        const state = queue.pop();
        if (!state) break;
        if (state.arrivalMs > horizonEnd.getTime()) continue;
        if (expandedStates >= maximumExpandedStates) {
            truncated = true;
            break;
        }
        expandedStates += 1;
        if (expandedStates % 1_000 === 0) {
            await new Promise<void>(resolve => setImmediate(resolve));
        }

        const hub = hubs.get(state.hubId);
        if (!hub) continue;
        const destinationHub = destinationByHub.get(hub.id);
        if (destinationHub && state.scheduledLegs > 0) {
            const result = resultFromState(
                state, destinationHub, request, policy
            );
            const key = JSON.stringify(state.serviceKeys);
            const known = results.get(key);
            if (!known || result.totalJourneyMinutes < known.result.totalJourneyMinutes) {
                results.set(key, { serviceKeys: state.serviceKeys, result });
            }
        }
        if (state.scheduledLegs >= maximumScheduledLegs) continue;

        const railLegsWithoutFlight = state.modes.includes("FLIGHT")
            ? 0
            : state.modes.filter(mode => mode === "RAIL").length;
        const railExpansionsSoFar = railExpansionsByHub.get(hub.id) ?? 0;
        if (
            hub.type === "RAILWAY_STATION" && hub.stationId
            && railLegsWithoutFlight < MAX_FEEDER_RAIL_LEGS_BEFORE_FLIGHT
            && railExpansionsSoFar < MAX_RAIL_EXPANSIONS_PER_HUB
        ) {
            railExpansionsByHub.set(hub.id, railExpansionsSoFar + 1);
            const minimumMs = state.arrivalMs + (
                state.lastMode === "RAIL" ? policy.railToRailMinutes * 60_000 : 0
            );
            const rides = await expandRailwayRides(
                hub.stationId,
                instantToMinute(clock, new Date(minimumMs)),
                clock.serviceDate,
                state.usedTrainIds,
                policy.searchHorizonDays,
                state.modes.includes("FLIGHT")
                    ? POST_FLIGHT_RAIL_RIDE_OPTIONS
                    : FEEDER_RAIL_RIDE_OPTIONS
            );
            for (const ride of rides) {
                const target = stationToHub.get(ride.destinationStationId);
                if (!target || !canVisitCity(state, target.cityId)) continue;
                const departureMs = minuteToInstant(clock, ride.departureMinute).getTime();
                const arrivalMs = minuteToInstant(clock, ride.arrivalMinute).getTime();
                if (departureMs < minimumMs || arrivalMs > horizonEnd.getTime()) continue;
                if (state.scheduledLegs === 0
                    && departureMs >= firstServiceDateEndMs) continue;
                const first = ride.connections[0];
                const last = ride.connections[ride.connections.length - 1];
                registerState({
                    ...state,
                    hubId: target.id,
                    arrivalMs,
                    priority: arrivalMs + remainingTimeHeuristicMs(
                        target.latitude, target.longitude,
                        request.destination.latitude, request.destination.longitude
                    ),
                    scheduledLegs: state.scheduledLegs + 1,
                    lastMode: "RAIL",
                    currentCityId: target.cityId,
                    visitedCityIds: withVisitedCity(state, target),
                    visitedHubIds: new Set([...state.visitedHubIds, target.id]),
                    usedTrainIds: new Set([...state.usedTrainIds, ride.trainId]),
                    modes: [...state.modes, "RAIL"],
                    serviceKeys: [
                        ...state.serviceKeys,
                        `RAIL:${ride.trainId}:${first.serviceDate}:${hub.id}:${target.id}`
                    ],
                    legs: [
                        ...state.legs,
                        ...waitLeg(hub, state.arrivalMs, departureMs, "RAIL_WAIT"),
                        {
                            mode: "RAIL",
                            from: place(hub),
                            to: place(target),
                            departureAt: iso(departureMs),
                            arrivalAt: iso(arrivalMs),
                            durationMinutes: ride.arrivalMinute - ride.departureMinute,
                            distanceKm: railwayDistance(ride),
                            serviceId: ride.trainId,
                            serviceNumber: first.trainNumber,
                            serviceName: first.trainName,
                            numberOfStops: Math.max(0, ride.connections.length - 1)
                        }
                    ]
                }, best, queue);
            }
        }

        if (hub.type === "AIRPORT" && hub.airportId) {
            const minimumMs = state.arrivalMs + (
                state.lastMode === "FLIGHT"
                    ? policy.sameAirportFlightTransferMinutes * 60_000
                    : 0
            );
            const destinationCounts = new Map<string, number>();
            let selectedFlights = 0;
            const maxFlightsPerDestination = state.scheduledLegs === 0
                ? FIRST_HOP_MAX_FLIGHTS_PER_DESTINATION
                : ONWARD_HOP_MAX_FLIGHTS_PER_DESTINATION;
            const maxFlightsTotal = state.scheduledLegs === 0
                ? FIRST_HOP_MAX_FLIGHTS_TOTAL
                : ONWARD_HOP_MAX_FLIGHTS_TOTAL;
            for (const flight of flightsByHub.get(hub.id) ?? []) {
                const departureMs = flight.departureAt.getTime();
                if (departureMs < minimumMs) continue;
                if (state.scheduledLegs === 0
                    && departureMs >= firstServiceDateEndMs) continue;
                if (state.usedFlightIds.has(flight.identityKey)) continue;
                const target = hubs.get(flight.arrivalAirport.hub.id.toString());
                if (!target || !canVisitCity(state, target.cityId)) continue;
                const targetCount = destinationCounts.get(target.id) ?? 0;
                if (targetCount >= maxFlightsPerDestination) continue;
                destinationCounts.set(target.id, targetCount + 1);
                selectedFlights += 1;
                const arrivalMs = flight.arrivalAt.getTime();
                registerState({
                    ...state,
                    hubId: target.id,
                    arrivalMs,
                    priority: arrivalMs + remainingTimeHeuristicMs(
                        target.latitude, target.longitude,
                        request.destination.latitude, request.destination.longitude
                    ),
                    scheduledLegs: state.scheduledLegs + 1,
                    lastMode: "FLIGHT",
                    currentCityId: target.cityId,
                    visitedCityIds: withVisitedCity(state, target),
                    visitedHubIds: new Set([...state.visitedHubIds, target.id]),
                    usedFlightIds: new Set([...state.usedFlightIds, flight.identityKey]),
                    modes: [...state.modes, "FLIGHT"],
                    serviceKeys: [...state.serviceKeys, `FLIGHT:${flight.identityKey}`],
                    legs: [
                        ...state.legs,
                        ...waitLeg(hub, state.arrivalMs, departureMs, "FLIGHT_WAIT"),
                        {
                            mode: "FLIGHT",
                            from: place(hub),
                            to: place(target),
                            departureAt: iso(departureMs),
                            arrivalAt: iso(arrivalMs),
                            durationMinutes: Math.ceil((arrivalMs - departureMs) / 60_000),
                            distanceKm: round(haversineKm(
                                hub.latitude, hub.longitude,
                                target.latitude, target.longitude
                            )),
                            serviceId: flight.id.toString(),
                            serviceNumber: flight.flightIataNumber ?? flight.flightIcaoNumber ?? flight.flightNumber,
                            serviceName: flight.airline?.name ?? "Airline unavailable",
                            terminalFrom: flight.departureTerminal,
                            terminalTo: flight.arrivalTerminal
                        }
                    ]
                }, best, queue);
                if (selectedFlights >= maxFlightsTotal) break;
            }
        }

        if (state.scheduledLegs > 0) {
            for (const transfer of transfersByHub.get(hub.id) ?? []) {
                const target = hubs.get(transfer.toHubId.toString());
                if (!target || state.visitedHubIds.has(target.id)) continue;
                let extraMinutes = 0;
                let transferType = "INTERMODAL_TRANSFER";
                if (state.lastMode === "RAIL" && target.type === "AIRPORT") {
                    extraMinutes = policy.railToFlightBufferMinutes;
                    transferType = "RAIL_TO_FLIGHT";
                } else if (state.lastMode === "FLIGHT" && target.type === "RAILWAY_STATION") {
                    extraMinutes = policy.flightToRailExitMinutes
                        + policy.flightToRailBufferMinutes;
                    transferType = "FLIGHT_TO_RAIL";
                }
                const duration = transfer.travelMinutes + extraMinutes;
                const arrivalMs = state.arrivalMs + duration * 60_000;
                registerState({
                    ...state,
                    hubId: target.id,
                    arrivalMs,
                    priority: arrivalMs + remainingTimeHeuristicMs(
                        target.latitude, target.longitude,
                        request.destination.latitude, request.destination.longitude
                    ),
                    currentCityId: target.cityId,
                    visitedHubIds: new Set([...state.visitedHubIds, target.id]),
                    legs: [...state.legs, {
                        mode: "TRANSFER",
                        from: place(hub),
                        to: place(target),
                        departureAt: iso(state.arrivalMs),
                        arrivalAt: iso(arrivalMs),
                        durationMinutes: duration,
                        distanceKm: Number(transfer.aerialDistanceKm),
                        estimatedRoadDistanceKm: Number(transfer.estimatedRoadDistanceKm),
                        transferType
                    }]
                }, best, queue);
            }
        }
    }

    const railwayOnly = await railwayOnlyPromise;
    const accessPruned = pruneDominatedAccessPaths([...results.values()]);
    const prunedMultimodal = pruneRedundantContinuations(accessPruned);
    const combined = ([] as MultimodalJourneyResult[]).concat(
        prunedMultimodal,
        railwayOnly.trainResults.map(convertRailwayResult)
    );
    const selected = combined
        .sort(compareMultimodalJourneyResults)
        .slice(0, request.options.resultLimit)
        .map((result, index) => ({ ...result, rank: index + 1 }));
    const available = coverage.counts.get("AVAILABLE") ?? 0;
    const empty = coverage.counts.get("EMPTY_REPORTED") ?? 0;
    const covered = [...coverage.counts.values()].reduce((sum, count) => sum + count, 0);
    const expectedDates = coverage.airportCount * (policy.searchHorizonDays + 1);
    const missing = Math.max(0, expectedDates - covered);

    return {
        request: {
            origin: request.origin,
            destination: request.destination,
            departureAt: request.departureAt,
            timezone: "Asia/Kolkata"
        },
        policy: {
            version: policy.version,
            roadSpeedKph: Number(policy.roadSpeedKph),
            longDistanceRoadSpeedKph: Number(policy.longDistanceRoadSpeedKph),
            roadSpeedDistanceThresholdKm: Number(policy.roadSpeedDistanceThresholdKm),
            roadDetourFactor: Number(policy.roadDetourFactor),
            initialRailBufferMinutes: policy.initialRailBufferMinutes,
            initialFlightBufferMinutes: policy.initialFlightBufferMinutes,
            railToRailMinutes: policy.railToRailMinutes,
            sameAirportFlightTransferMinutes: policy.sameAirportFlightTransferMinutes,
            maximumTransfers,
            searchHorizonDays: policy.searchHorizonDays
        },
        coverage: {
            status: flights.length === 0
                ? "RAIL_ONLY"
                : missing > 0 ? "PARTIAL" : "COMPLETE",
            availableAirportDates: available,
            emptyAirportDates: empty,
            missingAirportDates: missing
        },
        search: {
            sourceHubsEvaluated: sourceHubs.length,
            destinationHubsEvaluated: destinationHubs.length,
            expandedStates,
            truncated
        },
        journeyResults: selected
    };
}

export async function searchMultimodalJourneys(
    request: MultimodalSearchInput
): Promise<MultimodalSearchResult> {
    const key = createHash("sha256").update(JSON.stringify(request)).digest("hex");
    return resultCache.getOrLoad(key, () => executeSearch(request));
}
