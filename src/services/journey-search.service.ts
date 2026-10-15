import { createHash } from "crypto";
import { JourneyRoutingPolicy } from "@prisma/client";
import { BoundedAsyncTtlCache } from "../cache/bounded-async-ttl-cache";
import { ApiError } from "../errors/api.error";
import { NearbyRailwayStation } from "../repositories/nearby-railway-station.repository";
import { loadRoutingPolicy } from "../repositories/multimodal-routing.repository";
import {
    AdditionalTrainStation,
    AlternativeBoardingStation,
    AvailableDestinationStation,
    BoardingStationResult,
    Coordinates,
    JourneyLeg,
    JourneyPlace,
    JourneySearchInput,
    JourneySortOrder,
    JOURNEY_RESULT_LIMIT,
    JourneySearchOption,
    JourneySearchResult,
    JourneyTrainResult,
    RailJourneyLeg,
    RailwayStationCandidate,
    TrainServiceSummary,
    TransferJourneyLeg
} from "../types/journey-search";
import { JourneyConnection, JourneyStation } from "../types/railway-journey";
import {
    formatRailwayDateTime,
    minuteToInstant,
    RAILWAY_TIME_ZONE,
    RailwaySearchClock,
    createRailwaySearchClock,
    createRailwayDateSearchClock
} from "./journey-time.service";
import { getNearbyRailwayStations } from "./nearby-railway-station.service";
import {
    RailwayPath,
    resolveRailwayRoutingLimits,
    searchRailwayProvider
} from "./railway-provider.service";
import { calculateStationAccess } from "./station-access.service";

type SourceCandidateTiming = {
    station: NearbyRailwayStation;
    roadTravelMinutes: number;
    estimatedRoadDistanceKm: number;
    stationArrivalMinute: number;
    readyMinute: number;
};

const journeyResultCache = new BoundedAsyncTtlCache<JourneySearchResult>(
    Number(process.env.RAILWAY_RESULT_CACHE_TTL_MS ?? 2 * 60 * 1000),
    Number(process.env.RAILWAY_RESULT_CACHE_MAX_ENTRIES ?? 1_000)
);

function roundDistance(value: number): number {
    return Math.round(value * 10) / 10;
}

function userPlace(
    coordinates: Coordinates,
    kind: "USER_LOCATION" | "DESTINATION",
    fallbackName: string
): JourneyPlace {
    return {
        kind,
        name: coordinates.label ?? fallbackName,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        timeZone: RAILWAY_TIME_ZONE
    };
}

function stationPlace(station: {
    id: string;
    code: string;
    name: string;
    latitude: number;
    longitude: number;
}): JourneyPlace {
    return {
        kind: "RAILWAY_STATION",
        id: station.id,
        code: station.code,
        name: station.name,
        latitude: station.latitude,
        longitude: station.longitude,
        timeZone: RAILWAY_TIME_ZONE
    };
}

function connectionStationPlace(station: JourneyStation): JourneyPlace {
    if (station.latitude === undefined || station.longitude === undefined) {
        throw new Error(
            `Coordinates are missing for railway station '${station.code}'.`
        );
    }
    return stationPlace({
        ...station,
        latitude: station.latitude,
        longitude: station.longitude
    });
}

function publicCandidate(
    station: NearbyRailwayStation
): RailwayStationCandidate {
    return {
        id: station.id,
        code: station.code,
        name: station.name,
        latitude: station.latitude,
        longitude: station.longitude,
        aerialDistanceKm: roundDistance(station.aerialDistanceKm),
        activeTrainCount: station.activeTrainCount
    };
}

function groupTrainConnections(
    connections: JourneyConnection[]
): JourneyConnection[][] {
    const groups: JourneyConnection[][] = [];
    for (const connection of connections) {
        const current = groups[groups.length - 1];
        if (current?.[0].trainId === connection.trainId) {
            current.push(connection);
        } else {
            groups.push([connection]);
        }
    }
    return groups;
}

function railDistance(group: JourneyConnection[]): number | null {
    const first = group[0];
    const last = group[group.length - 1];
    return first.fromDistanceKm !== null && last.toDistanceKm !== null
        ? Math.max(0, last.toDistanceKm - first.fromDistanceKm)
        : null;
}

function railLeg(
    group: JourneyConnection[],
    clock: RailwaySearchClock
): RailJourneyLeg {
    const first = group[0];
    const last = group[group.length - 1];
    return {
        mode: "RAIL",
        from: connectionStationPlace(first.fromStation),
        to: connectionStationPlace(last.toStation),
        departureAt: formatRailwayDateTime(
            minuteToInstant(clock, first.departureMinute)
        ),
        arrivalAt: formatRailwayDateTime(
            minuteToInstant(clock, last.arrivalMinute)
        ),
        durationMinutes: last.arrivalMinute - first.departureMinute,
        trainNumber: first.trainNumber,
        trainName: first.trainName,
        serviceDate: first.serviceDate
            ?? minuteToInstant(clock, first.departureMinute)
                .toISOString()
                .slice(0, 10),
        distanceKm: railDistance(group),
        numberOfStops: Math.max(0, group.length - 1)
    };
}

function optionId(path: RailwayPath, clock: RailwaySearchClock): string {
    const identity = [
        path.originStationId,
        path.destinationStationId,
        path.departureMinute,
        path.arrivalMinute,
        minuteToInstant(clock, path.departureMinute).toISOString(),
        ...path.connections.map(connection => connection.trainId)
    ].join(":");
    return createHash("sha256").update(identity).digest("hex").slice(0, 16);
}

function buildOption(
    path: RailwayPath,
    source: SourceCandidateTiming,
    destination: NearbyRailwayStation,
    request: JourneySearchInput,
    clock: RailwaySearchClock,
    policy: JourneyRoutingPolicy,
    departureAtIsTrainThreshold = false
): JourneySearchOption | null {
    const dateOnlySearch = request.departureDate !== undefined;
    const flexibleOriginTiming = dateOnlySearch
        || departureAtIsTrainThreshold;
    const sourceStation = publicCandidate(source.station);
    const destinationStation = publicCandidate(destination);
    const sourcePlace = stationPlace(sourceStation);
    const destinationStationPlace = stationPlace(destinationStation);
    const originPlace = userPlace(
        request.origin,
        "USER_LOCATION",
        "Current location"
    );
    const finalPlace = userPlace(
        request.destination,
        "DESTINATION",
        "Destination"
    );
    const destinationAccess = calculateStationAccess(
        destination.aerialDistanceKm,
        policy
    );
    const trainGroups = groupTrainConnections(path.connections);
    const railLegs = trainGroups.map(group => railLeg(group, clock));
    const trainInVehicleMinutes = railLegs.reduce(
        (total, leg) => total + leg.durationMinutes,
        0
    );
    const railwayElapsedMinutes = path.arrivalMinute - path.departureMinute;
    const railTransferWaitingMinutes = Math.max(
        0,
        railwayElapsedMinutes - trainInVehicleMinutes
    );
    // In flexibleOriginTiming mode the boarding time is fixed by the found
    // train, and the local-access leg is computed backward from it: leave
    // late enough to still catch the train, but no later than necessary. If
    // that backward calculation would place the departure before the instant
    // the traveler said they'd be ready (clock.requestedMinute), leaving that
    // early is not physically possible - the actual journey start is then
    // clock.requestedMinute itself, the earliest the traveler can move, and
    // the road-access/boarding-buffer legs are computed forward from it using
    // their real, un-hidden durations (source.roadTravelMinutes), rather than
    // collapsing every leg to the train's own departure time. Multiple
    // candidates can legitimately tie on this readiness floor - they are all
    // equally bound by when the traveler can leave - and remain distinguished
    // by their (still schedule-derived) arrival times and durations.
    const naturalStationArrivalMinute = path.departureMinute
        - policy.initialRailBufferMinutes;
    const naturalSourceDepartureMinute = naturalStationArrivalMinute
        - source.roadTravelMinutes;
    const sourceDepartureMinute = flexibleOriginTiming
        ? Math.max(naturalSourceDepartureMinute, clock.requestedMinute)
        : clock.requestedMinute;
    const stationArrivalMinute = flexibleOriginTiming
        ? sourceDepartureMinute + source.roadTravelMinutes
        : source.stationArrivalMinute;
    // The readiness floor above guarantees sourceDepartureMinute is never
    // shown before clock.requestedMinute, but says nothing about whether
    // the traveler can still physically reach THIS station in time for
    // THIS train once forced that late - road access from a farther
    // station can eat past the train's own departure, arriving at the
    // platform after it already left. The provider's own admissibility
    // bound only checks path.departureMinute >= clock.requestedMinute (a
    // road-access-blind threshold - see the readyMinute computation this
    // candidate's source.readyMinute came from), so it does not catch
    // this. Discarding the candidate here - rather than clamping
    // BOARDING_WAIT's Math.max(0, ...) to a deceptive 0m - is the only
    // correct outcome: unlike the readiness floor, arriving late is not a
    // display choice, it is this candidate genuinely not being reachable
    // by this traveler from this station for this train.
    if (flexibleOriginTiming && stationArrivalMinute > path.departureMinute) {
        return null;
    }
    const readyMinute = flexibleOriginTiming
        ? path.departureMinute
        : source.readyMinute;
    const sourceDepartureInstant = minuteToInstant(
        clock,
        sourceDepartureMinute
    );
    const stationArrivalInstant = minuteToInstant(
        clock,
        stationArrivalMinute
    );
    const readyInstant = minuteToInstant(clock, readyMinute);
    const finalTrainArrivalInstant = minuteToInstant(
        clock,
        path.arrivalMinute
    );
    const destinationArrivalInstant = minuteToInstant(
        clock,
        path.arrivalMinute + destinationAccess.travelMinutes
    );
    const legs: JourneyLeg[] = [
        {
            mode: "LOCAL",
            from: originPlace,
            to: sourcePlace,
            departureAt: formatRailwayDateTime(sourceDepartureInstant),
            arrivalAt: formatRailwayDateTime(stationArrivalInstant),
            durationMinutes: source.roadTravelMinutes,
            aerialDistanceKm: roundDistance(
                source.station.aerialDistanceKm
            ),
            estimatedRoadDistanceKm: roundDistance(
                source.estimatedRoadDistanceKm
            ),
            distanceMethod: "POSTGIS_GEODESIC",
            travelTimeMethod: "AERIAL_DISTANCE_DETOUR_FACTOR"
        }
    ];

    const firstTrainDepartureInstant = minuteToInstant(
        clock,
        path.departureMinute
    );
    legs.push({
        mode: "TRANSFER",
        transferType: "BOARDING_WAIT",
        from: sourcePlace,
        to: sourcePlace,
        departureAt: formatRailwayDateTime(stationArrivalInstant),
        arrivalAt: formatRailwayDateTime(firstTrainDepartureInstant),
        durationMinutes: Math.max(
            0,
            path.departureMinute - stationArrivalMinute
        )
    });

    for (let index = 0; index < railLegs.length; index += 1) {
        if (index > 0) {
            const previous = trainGroups[index - 1];
            const current = trainGroups[index];
            const previousArrival = previous[previous.length - 1].arrivalMinute;
            const currentDeparture = current[0].departureMinute;
            const transferPlace = connectionStationPlace(
                current[0].fromStation
            );
            legs.push({
                mode: "TRANSFER",
                transferType: "RAIL_TRANSFER",
                from: transferPlace,
                to: transferPlace,
                departureAt: formatRailwayDateTime(
                    minuteToInstant(clock, previousArrival)
                ),
                arrivalAt: formatRailwayDateTime(
                    minuteToInstant(clock, currentDeparture)
                ),
                durationMinutes: currentDeparture - previousArrival
            });
        }
        legs.push(railLegs[index]);
    }

    legs.push({
        mode: "LOCAL",
        from: destinationStationPlace,
        to: finalPlace,
        departureAt: formatRailwayDateTime(finalTrainArrivalInstant),
        arrivalAt: formatRailwayDateTime(destinationArrivalInstant),
        durationMinutes: destinationAccess.travelMinutes,
        aerialDistanceKm: roundDistance(destination.aerialDistanceKm),
        estimatedRoadDistanceKm: roundDistance(
            destinationAccess.estimatedRoadDistanceKm
        ),
        distanceMethod: "POSTGIS_GEODESIC",
        travelTimeMethod: "AERIAL_DISTANCE_DETOUR_FACTOR"
    });

    return {
        id: optionId(path, clock),
        rank: 0,
        boardingStation: sourceStation,
        arrivalStation: destinationStation,
        sourceAccess: {
            aerialDistanceKm: roundDistance(
                source.station.aerialDistanceKm
            ),
            estimatedRoadDistanceKm: roundDistance(
                source.estimatedRoadDistanceKm
            ),
            travelMinutes: source.roadTravelMinutes,
            boardingBufferMinutes: policy.initialRailBufferMinutes,
            stationArrivalAt: formatRailwayDateTime(stationArrivalInstant),
            readyToBoardAt: formatRailwayDateTime(readyInstant)
        },
        destinationAccess: {
            aerialDistanceKm: roundDistance(destination.aerialDistanceKm),
            estimatedRoadDistanceKm: roundDistance(
                destinationAccess.estimatedRoadDistanceKm
            ),
            travelMinutes: destinationAccess.travelMinutes,
            destinationArrivalAt: formatRailwayDateTime(
                destinationArrivalInstant
            )
        },
        firstTrainDepartureAt: formatRailwayDateTime(
            firstTrainDepartureInstant
        ),
        finalTrainArrivalAt: formatRailwayDateTime(
            finalTrainArrivalInstant
        ),
        finalArrivalAt: formatRailwayDateTime(destinationArrivalInstant),
        preTrainWaitingMinutes: Math.max(
            0,
            path.departureMinute - readyMinute
        ),
        railwayElapsedMinutes,
        trainInVehicleMinutes,
        railTransferWaitingMinutes,
        // Derived directly from the (possibly snapped, see above)
        // sourceDepartureMinute rather than re-summed from the individual
        // components, so it always exactly matches finalArrivalAt minus the
        // displayed departureAt regardless of which branch produced
        // sourceDepartureMinute - equivalent to the previous per-branch
        // formulas in the ordinary case, and automatically correct in the
        // no-lead-time case that those formulas got wrong.
        totalJourneyMinutes: path.arrivalMinute
            + destinationAccess.travelMinutes
            - sourceDepartureMinute,
        numberOfTransfers: Math.max(0, trainGroups.length - 1),
        legs
    };
}

function railLegs(option: JourneySearchOption): RailJourneyLeg[] {
    return option.legs.filter(
        (leg): leg is RailJourneyLeg => leg.mode === "RAIL"
    );
}

// totalJourneyMinutes is computed backward from each candidate's OWN boarding
// stop, so boarding the same train further downstream always shows less
// in-vehicle time - which can make it look "faster" than a candidate that
// needs no road access at all, even though it only appears shorter because
// part of the trip moved from rail to road. Comparing total road-access
// minutes before raw duration ensures a candidate that needs no local
// transport is never outranked, by duration alone, by one that does.
function totalRoadAccessMinutes(option: JourneySearchOption): number {
    return option.sourceAccess.travelMinutes + option.destinationAccess.travelMinutes;
}

function compareJourneyOptions(
    left: JourneySearchOption,
    right: JourneySearchOption,
    sortBy: JourneySortOrder = "transfers"
): number {
    const tieBreak = left.numberOfTransfers - right.numberOfTransfers
        || totalRoadAccessMinutes(left) - totalRoadAccessMinutes(right)
        || left.totalJourneyMinutes - right.totalJourneyMinutes
        || left.preTrainWaitingMinutes - right.preTrainWaitingMinutes
        || Date.parse(left.finalArrivalAt) - Date.parse(right.finalArrivalAt)
        || left.railTransferWaitingMinutes
            - right.railTransferWaitingMinutes;
    if (sortBy === "duration") {
        return left.totalJourneyMinutes - right.totalJourneyMinutes || tieBreak;
    }
    if (sortBy === "departure") {
        return Date.parse(suggestedLeaveHomeAt(left))
            - Date.parse(suggestedLeaveHomeAt(right)) || tieBreak;
    }
    if (sortBy === "arrival") {
        return Date.parse(left.finalArrivalAt)
            - Date.parse(right.finalArrivalAt) || tieBreak;
    }
    return left.numberOfTransfers - right.numberOfTransfers || tieBreak;
}

// Shared by downstreamContinuationKey() (the full ride) and
// pruneSelfDefeatingFirstLegs() below (a candidate's OWN ride minus its
// first leg) - identifies a sequence of train legs by every train ridden,
// every transfer point, and the final alighting station, regardless of
// where the FIRST of these legs was boarded from.
function continuationKeyFromLegs(trains: RailJourneyLeg[]): string {
    const alightingStationKey = trains[trains.length - 1].to.id
        ?? trains[trains.length - 1].to.code;
    const services = trains.map(
        leg => `${leg.trainNumber}@${leg.serviceDate}`
    );
    const transfers = trains.slice(0, -1).map(
        (leg, index) =>
            `${leg.to.id ?? leg.to.code}>${trains[index + 1].from.id
                ?? trains[index + 1].from.code}`
    );
    return [
        trains.length <= 1 ? "DIRECT" : "TRANSFER",
        alightingStationKey,
        ...services,
        ...transfers
    ].join("|");
}

// Identifies the downstream continuation an option rides - every train
// boarded from the first leg onward, every transfer point, and the final
// alighting station - without regard to which station the first train was
// boarded from. Two options sharing this key ride the exact same physical
// service chain to the same destination and differ only in local access to
// their (possibly different) boarding station on the first train.
function downstreamContinuationKey(option: JourneySearchOption): string {
    return continuationKeyFromLegs(railLegs(option));
}

function itineraryKey(option: JourneySearchOption): string {
    const trains = railLegs(option);
    const boardingStationKey = trains[0].from.id ?? trains[0].from.code;
    return `${boardingStationKey}|${downstreamContinuationKey(option)}`;
}

// The mirror image of downstreamContinuationKey(): identifies the boarding
// side of an option - the boarding station, every train and transfer point
// up to and including the LAST train's own identity - without regard to
// where that last train was alighted from. Two options sharing this key
// board the exact same sequence of services and differ only in which stop
// of the final train they get off at (and therefore in the local-access
// leg needed to complete the journey to the real destination from there).
function upstreamServiceChainKey(option: JourneySearchOption): string {
    const trains = railLegs(option);
    const boardingStationKey = trains[0].from.id ?? trains[0].from.code;
    const services = trains.map(
        leg => `${leg.trainNumber}@${leg.serviceDate}`
    );
    const transfers = trains.slice(0, -1).map(
        (leg, index) =>
            `${leg.to.id ?? leg.to.code}>${trains[index + 1].from.id
                ?? trains[index + 1].from.code}`
    );
    return [
        option.numberOfTransfers === 0 ? "DIRECT" : "TRANSFER",
        boardingStationKey,
        ...services,
        ...transfers
    ].join("|");
}

// A same-train continuation is identical no matter which of its stops it is
// boarded from - the train reaches every downstream stop, including the
// final destination, at the same time regardless. So boarding it from a
// station upstream of another available boarding station on the SAME
// service chain never arrives any sooner, and only ever adds local-access
// time - a pure, avoidable detour/backtrack (AGENTS.md Practicality:
// "Backtracking", "Unnecessary detours"), not a real alternative. Discard
// candidate A only when another candidate B rides the identical downstream
// continuation (downstreamContinuationKey matches) but boards the first
// train later - i.e. at a station strictly downstream of A's boarding
// station - while requiring no more local access to reach it. Candidates
// requiring MORE local access than every later boarding option are kept:
// this only removes detours that are strictly no better in every respect,
// never a candidate that trades more access time for something else.
function pruneUpstreamBoardingDetours(
    options: JourneySearchOption[]
): JourneySearchOption[] {
    // Grouping by key once up front, rather than recomputing
    // downstreamContinuationKey(other) for every (candidate, other) pair,
    // turns this from an O(n^2) pass of string-building work into O(n) -
    // see pruneSelfDefeatingFirstLegs() below, where the same redundant
    // recomputation measured 40-60s on a real, large candidate pool.
    const byKey = new Map<string, JourneySearchOption[]>();
    for (const option of options) {
        const key = downstreamContinuationKey(option);
        const group = byKey.get(key);
        if (group) group.push(option);
        else byKey.set(key, [option]);
    }
    return options.filter(candidate => {
        const key = downstreamContinuationKey(candidate);
        const candidateBoardMs = Date.parse(candidate.firstTrainDepartureAt);
        return !byKey.get(key)?.some(other =>
            other !== candidate
            && Date.parse(other.firstTrainDepartureAt) > candidateBoardMs
            && other.sourceAccess.travelMinutes
                <= candidate.sourceAccess.travelMinutes
        );
    });
}

// Mirror image of pruneUpstreamBoardingDetours(), for the alighting side:
// the same physical last train passes through every one of its own
// downstream stops regardless of where it is alighted from, so getting off
// EARLIER than another available alighting stop on that same train - and
// completing the trip to the real destination by local access from there -
// never arrives sooner and only ever adds unneeded local-access time.
// Discard candidate A only when another candidate B boards the identical
// service chain (upstreamServiceChainKey matches - same boarding station,
// same trains, same transfer points) but alights from the final train
// later - i.e. at a stop strictly downstream of A's alighting stop - while
// requiring no more local access to complete the journey from there.
function pruneUpstreamAlightingDetours(
    options: JourneySearchOption[]
): JourneySearchOption[] {
    // Same O(n^2) -> O(n) fix as pruneUpstreamBoardingDetours() above:
    // group by key once instead of recomputing upstreamServiceChainKey(other)
    // for every (candidate, other) pair.
    const byKey = new Map<string, JourneySearchOption[]>();
    for (const option of options) {
        const key = upstreamServiceChainKey(option);
        const group = byKey.get(key);
        if (group) group.push(option);
        else byKey.set(key, [option]);
    }
    return options.filter(candidate => {
        const key = upstreamServiceChainKey(candidate);
        const candidateAlightMs = Date.parse(candidate.finalTrainArrivalAt);
        return !byKey.get(key)?.some(other =>
            other !== candidate
            && Date.parse(other.finalTrainArrivalAt) > candidateAlightMs
            && other.destinationAccess.travelMinutes
                <= candidate.destinationAccess.travelMinutes
        );
    });
}

// Neither pruneUpstreamBoardingDetours() nor pruneUpstreamAlightingDetours()
// catch a candidate that rides an entirely different, throwaway FIRST train
// before continuing onward - e.g. drive to a farther station, board a train
// back to (or through) a station the traveler could have boarded directly
// from, then continue from there via trains that were reachable from the
// true origin all along. Both existing prunes only compare options riding
// the IDENTICAL continuation (same downstreamContinuationKey/
// upstreamServiceChainKey); this candidate's continuation includes one
// extra leg the alternative doesn't, so it never matches either key. Catch
// it by comparing a candidate's OWN remaining continuation - its full ride
// with the first leg dropped - against every OTHER candidate's full
// continuation: if some other candidate reaches that exact same remaining
// journey (same trains, same transfer points, same final alighting) with
// no worse local access than this candidate's own first-leg boarding
// required, the first leg added nothing but a pointless detour, and this
// candidate is discarded. A continuationKeyFromLegs() match on train
// number + serviceDate guarantees the SAME calendar-day run of every
// remaining train, so the matched alternative's final arrival is
// identical - this can only ever remove a candidate, never disadvantage
// one that trades access time for something else.
function pruneSelfDefeatingFirstLegs(
    options: JourneySearchOption[]
): JourneySearchOption[] {
    // Recomputing downstreamContinuationKey(other) inside the candidate
    // loop (once per (candidate, other) pair) turned this into an O(n^2)
    // pass of non-trivial string-building work - measured at 40-60s on a
    // real multi-transfer route with a large candidate pool. Computing
    // every option's own key exactly once up front, then looking candidates
    // up by that key, keeps the same comparisons (same result) at O(n).
    const byDownstreamKey = new Map<string, JourneySearchOption[]>();
    for (const option of options) {
        const key = downstreamContinuationKey(option);
        const group = byDownstreamKey.get(key);
        if (group) group.push(option);
        else byDownstreamKey.set(key, [option]);
    }
    return options.filter(candidate => {
        const trains = railLegs(candidate);
        if (trains.length < 2) return true;
        const tailKey = continuationKeyFromLegs(trains.slice(1));
        const matches = byDownstreamKey.get(tailKey);
        return !matches?.some(other =>
            other !== candidate
            && other.sourceAccess.travelMinutes
                <= candidate.sourceAccess.travelMinutes
        );
    });
}

function trainSummaries(option: JourneySearchOption): TrainServiceSummary[] {
    return railLegs(option).map(leg => ({
        trainNumber: leg.trainNumber,
        trainName: leg.trainName,
        serviceDate: leg.serviceDate,
        from: leg.from,
        to: leg.to,
        departureAt: leg.departureAt,
        arrivalAt: leg.arrivalAt,
        durationMinutes: leg.durationMinutes,
        distanceKm: leg.distanceKm === null
            ? null
            : roundDistance(leg.distanceKm)
    }));
}

function suggestedLeaveHomeAt(option: JourneySearchOption): string {
    return option.legs.find(leg => leg.mode === "LOCAL")?.departureAt
        ?? option.firstTrainDepartureAt;
}

function availableDestinations(
    options: JourneySearchOption[]
): AvailableDestinationStation[] {
    const bestByStation = new Map<string, JourneySearchOption>();
    for (const option of [...options].sort(compareJourneyOptions)) {
        if (!bestByStation.has(option.arrivalStation.id)) {
            bestByStation.set(option.arrivalStation.id, option);
        }
    }
    return [...bestByStation.values()]
        .sort((left, right) =>
            Date.parse(left.finalArrivalAt) - Date.parse(right.finalArrivalAt)
        )
        .map(option => ({
            station: option.arrivalStation,
            trainArrivalAt: option.finalTrainArrivalAt,
            finalArrivalAt: option.finalArrivalAt,
            destinationAccess: option.destinationAccess
        }));
}

function alternativeBoardings(
    options: JourneySearchOption[],
    recommended: JourneySearchOption
): AlternativeBoardingStation[] {
    const bestByStation = new Map<string, JourneySearchOption>();
    for (const option of [...options].sort(compareJourneyOptions)) {
        if (option.boardingStation.id === recommended.boardingStation.id) {
            continue;
        }
        if (!bestByStation.has(option.boardingStation.id)) {
            bestByStation.set(option.boardingStation.id, option);
        }
    }
    return [...bestByStation.values()]
        .sort((left, right) =>
            left.sourceAccess.travelMinutes - right.sourceAccess.travelMinutes
            || left.sourceAccess.estimatedRoadDistanceKm
                - right.sourceAccess.estimatedRoadDistanceKm
        )
        .map(option => ({
            station: option.boardingStation,
            sourceAccess: option.sourceAccess,
            suggestedLeaveHomeAt: suggestedLeaveHomeAt(option),
            trainDepartureAt: option.firstTrainDepartureAt,
            totalJourneyMinutes: option.totalJourneyMinutes
        }));
}

type GroupedJourney = {
    key: string;
    options: JourneySearchOption[];
    result: JourneyTrainResult;
};

function groupJourneyOptions(
    options: JourneySearchOption[],
    sortBy: JourneySortOrder
): GroupedJourney[] {
    const grouped = new Map<string, JourneySearchOption[]>();
    for (const option of options) {
        const key = itineraryKey(option);
        const group = grouped.get(key) ?? [];
        group.push(option);
        grouped.set(key, group);
    }

    const results: GroupedJourney[] = [];
    for (const [key, groupOptions] of grouped) {
        groupOptions.sort((left, right) =>
            compareJourneyOptions(left, right, sortBy)
        );
        const recommended = groupOptions[0];
        const trains = trainSummaries(recommended);
        const availableTrainDistances = trains
            .map(train => train.distanceKm)
            .filter((distance): distance is number => distance !== null);
        const totalTrainDistanceKm = availableTrainDistances.length === 0
            ? null
            : roundDistance(
                availableTrainDistances.reduce(
                    (total, distance) => total + distance,
                    0
                )
            );
        const transferDetails = recommended.legs.filter(
            (leg): leg is TransferJourneyLeg =>
                leg.mode === "TRANSFER"
                && leg.transferType === "RAIL_TRANSFER"
        );
        const overallScoreMinutes = recommended.totalJourneyMinutes;
        // groupOptions itself never has more than one distinct boarding or
        // alighting station - itineraryKey (the Map key above) is boarding-
        // and-alighting-specific, on purpose, so each boarding-station
        // variant of a train surfaces as its own visible trainResults entry
        // rather than being silently folded into another station's "best"
        // pick (see the direct-boarding-train-hidden fix this guarded
        // against). availableDestinationStations/alternativeBoardingStations
        // are informational cross-references to those OTHER, separately
        // visible entries, so they need the full candidate pool scoped by
        // the boarding-agnostic/alighting-agnostic key instead - the same
        // scoping pruneUpstreamBoardingDetours/pruneUpstreamAlightingDetours
        // already use to decide which boarding/alighting variants of the
        // same continuation are genuine (non-dominated) alternatives.
        const sameUpstreamChain = options.filter(option =>
            upstreamServiceChainKey(option)
                === upstreamServiceChainKey(recommended)
        );
        const sameDownstreamContinuation = options.filter(option =>
            downstreamContinuationKey(option)
                === downstreamContinuationKey(recommended)
        );
        results.push({
            key,
            options: groupOptions,
            result: {
                id: createHash("sha256")
                    .update(key)
                    .digest("hex")
                    .slice(0, 16),
                rank: 0,
                itineraryKey: key,
                journeyType: recommended.numberOfTransfers === 0
                    ? "DIRECT"
                    : "TRANSFER",
                trainNumber: trains[0].trainNumber,
                trainName: trains[0].trainName,
                serviceDate: trains[0].serviceDate,
                numberOfTransfers: recommended.numberOfTransfers,
                trains,
                recommendedBoardingStation: recommended.boardingStation,
                sourceAccess: recommended.sourceAccess,
                suggestedLeaveHomeAt: suggestedLeaveHomeAt(recommended),
                firstTrainDepartureAt: recommended.firstTrainDepartureAt,
                availableDestinationStations:
                    availableDestinations(sameUpstreamChain),
                alternativeBoardingStations:
                    alternativeBoardings(sameDownstreamContinuation, recommended),
                transferDetails,
                finalTrainArrivalAt: recommended.finalTrainArrivalAt,
                finalArrivalAt: recommended.finalArrivalAt,
                preTrainWaitingMinutes: recommended.preTrainWaitingMinutes,
                railwayElapsedMinutes: recommended.railwayElapsedMinutes,
                trainInVehicleMinutes: recommended.trainInVehicleMinutes,
                railTransferWaitingMinutes:
                    recommended.railTransferWaitingMinutes,
                totalTrainDistanceKm,
                totalJourneyMinutes: recommended.totalJourneyMinutes,
                overallScoreMinutes,
                legs: recommended.legs
            }
        });
    }
    return results.sort((left, right) =>
        compareJourneyOptions(left.options[0], right.options[0], sortBy)
    );
}

function boardingStationResults(
    sourceStations: NearbyRailwayStation[],
    groupedJourneys: GroupedJourney[],
    recommendedStationId: string | undefined,
    limit: number,
    policy: JourneyRoutingPolicy
): BoardingStationResult[] {
    const stations = sourceStations.map(station => {
        const access = calculateStationAccess(station.aerialDistanceKm, policy);
        const matchingGroups = groupedJourneys.filter(group =>
            group.options.some(
                option => option.boardingStation.id === station.id
            )
        );
        return {
            ...publicCandidate(station),
            estimatedRoadDistanceKm: roundDistance(
                access.estimatedRoadDistanceKm
            ),
            roadTravelMinutes: access.travelMinutes,
            matchingTrainCount: matchingGroups.length,
            bestTotalJourneyMinutes: matchingGroups.length > 0
                ? Math.min(...matchingGroups.flatMap(group =>
                    group.options
                        .filter(option =>
                            option.boardingStation.id === station.id
                        )
                        .map(option => option.totalJourneyMinutes)
                ))
                : null,
            recommended: station.id === recommendedStationId
        };
    }).sort((left, right) =>
        left.aerialDistanceKm - right.aerialDistanceKm
        || (left.bestTotalJourneyMinutes ?? Number.POSITIVE_INFINITY)
            - (right.bestTotalJourneyMinutes ?? Number.POSITIVE_INFINITY)
    );
    const selected = stations.slice(0, limit);
    const recommended = stations.find(station => station.recommended);
    if (
        recommended
        && !selected.some(station => station.id === recommended.id)
    ) {
        selected[Math.max(0, selected.length - 1)] = recommended;
        selected.sort((left, right) =>
            left.aerialDistanceKm - right.aerialDistanceKm
        );
    }
    return selected;
}

function additionalTrainStations(
    groupedJourneys: GroupedJourney[],
    selectedKeys: Set<string>
): AdditionalTrainStation[] {
    const byStation = new Map<string, {
        station: RailwayStationCandidate;
        keys: Set<string>;
    }>();
    for (const group of groupedJourneys) {
        if (selectedKeys.has(group.key)) continue;
        for (const option of group.options) {
            const entry = byStation.get(option.boardingStation.id) ?? {
                station: option.boardingStation,
                keys: new Set<string>()
            };
            entry.keys.add(group.key);
            byStation.set(option.boardingStation.id, entry);
        }
    }
    return [...byStation.values()]
        .map(entry => ({
            ...entry.station,
            additionalTrainCount: entry.keys.size
        }))
        .filter(station => station.additionalTrainCount > 0)
        .sort((left, right) =>
            left.aerialDistanceKm - right.aerialDistanceKm
        );
}

async function executeCoordinateRailwayJourneySearch(
    request: JourneySearchInput,
    departureAtIsTrainThreshold = false
): Promise<JourneySearchResult> {
    const dateOnlySearch = request.departureDate !== undefined;
    const clock = dateOnlySearch
        ? createRailwayDateSearchClock(request.departureDate)
        : createRailwaySearchClock(request.departureAt);
    const [policy, sourceStations, destinationStations] = await Promise.all([
        loadRoutingPolicy(),
        getNearbyRailwayStations(
            request.origin.latitude,
            request.origin.longitude,
            request.options.sourceRadiusKm,
            request.options.sourceCandidateLimit,
            "BOARDING"
        ),
        getNearbyRailwayStations(
            request.destination.latitude,
            request.destination.longitude,
            request.options.destinationRadiusKm,
            request.options.destinationCandidateLimit,
            "ALIGHTING"
        )
    ]);
    const routingLimits = resolveRailwayRoutingLimits(policy);

    if (sourceStations.length === 0) {
        throw new ApiError(
            404,
            "No boardable railway station was found near the current location."
        );
    }
    if (destinationStations.length === 0) {
        throw new ApiError(
            404,
            "No railway station was found near the destination."
        );
    }

    const sourceTimings: SourceCandidateTiming[] = sourceStations.map(
        station => {
            const access = calculateStationAccess(
                station.aerialDistanceKm,
                policy
            );
            const stationArrivalMinute =
                dateOnlySearch
                    ? 0
                    : departureAtIsTrainThreshold
                        ? clock.requestedMinute
                        : clock.requestedMinute + access.travelMinutes;
            return {
                station,
                roadTravelMinutes: access.travelMinutes,
                estimatedRoadDistanceKm: access.estimatedRoadDistanceKm,
                stationArrivalMinute,
                readyMinute: dateOnlySearch
                    ? 0
                    : departureAtIsTrainThreshold
                        ? clock.requestedMinute
                        : stationArrivalMinute + policy.initialRailBufferMinutes
            };
        }
    );
    const sourceById = new Map(
        sourceTimings.map(source => [source.station.id, source])
    );
    const destinationById = new Map(
        destinationStations.map(station => [station.id, station])
    );
    const providerResult = await searchRailwayProvider(
        sourceTimings.map(source => ({
            stationId: source.station.id,
            readyMinute: source.readyMinute,
            roadAccessMinutes: source.roadTravelMinutes
        })),
        new Set(destinationStations.map(station => station.id)),
        clock.serviceDate,
        request.options.resultLimit,
        routingLimits,
        dateOnlySearch ? 24 * 60 : undefined,
        request.options.sortBy
    );

    const allOptions = providerResult.paths
        .map(path => {
            const source = sourceById.get(path.originStationId);
            const destination = destinationById.get(
                path.destinationStationId
            );
            return source && destination
                ? buildOption(
                    path,
                    source,
                    destination,
                    request,
                    clock,
                    policy,
                    departureAtIsTrainThreshold
                )
                : null;
        })
        .filter((option): option is JourneySearchOption => option !== null)
        .sort((left, right) =>
            compareJourneyOptions(left, right, request.options.sortBy)
            || right.boardingStation.activeTrainCount
                - left.boardingStation.activeTrainCount
        );
    const groupedJourneys = groupJourneyOptions(
        pruneSelfDefeatingFirstLegs(
            pruneUpstreamAlightingDetours(pruneUpstreamBoardingDetours(allOptions))
        ),
        request.options.sortBy
    );
    const selectedGroups = groupedJourneys.slice(
        0,
        request.options.resultLimit
    );
    const trainResults = selectedGroups.map((group, index) => ({
        ...group.result,
        rank: index + 1
    }));
    const selectedKeys = new Set(selectedGroups.map(group => group.key));

    return {
        request: {
            origin: request.origin,
            destination: request.destination,
            searchMode: dateOnlySearch ? "DATE_ONLY" : "DATE_TIME",
            departureDate: clock.serviceDate.toISOString().slice(0, 10),
            departureAt: dateOnlySearch
                ? null
                : formatRailwayDateTime(clock.requestedInstant),
            sortBy: request.options.sortBy,
            timeZone: RAILWAY_TIME_ZONE
        },
        assumptions: {
            aerialDistanceMethod: "POSTGIS_GEODESIC",
            roadDistanceMethod: "AERIAL_DISTANCE_DETOUR_FACTOR",
            roadDistanceAccuracy: "ESTIMATED",
            detourFactor: Number(policy.roadDetourFactor),
            averageRoadSpeedKph: Number(policy.longDistanceRoadSpeedKph),
            shortDistanceRoadSpeedKph: Number(policy.roadSpeedKph),
            roadDistanceSpeedThresholdKm: Number(
                policy.roadSpeedDistanceThresholdKm
            ),
            boardingBufferMinutes: policy.initialRailBufferMinutes,
            minimumRailTransferMinutes: routingLimits.minimumRailTransferMinutes,
            maximumTrainLegs: routingLimits.maxTrainLegs,
            searchHorizonDays: routingLimits.searchHorizonDays
        },
        search: {
            sourceCandidatesEvaluated: sourceStations.length,
            destinationCandidatesEvaluated: destinationStations.length,
            graphVersion: providerResult.graphVersion,
            searchComplete: providerResult.searchComplete,
            truncationReason: providerResult.truncationReason
        },
        boardingStations: boardingStationResults(
            sourceStations,
            groupedJourneys,
            trainResults[0]?.recommendedBoardingStation.id,
            request.options.boardingStationLimit,
            policy
        ),
        trainResults,
        nearbyStationsWithAdditionalTrains: additionalTrainStations(
            groupedJourneys,
            selectedKeys
        )
    };
}

export async function searchCoordinateRailwayJourney(
    request: JourneySearchInput
): Promise<JourneySearchResult> {
    const boundedRequest: JourneySearchInput = {
        ...request,
        options: {
            ...request.options,
            resultLimit: Math.min(
                request.options.resultLimit,
                JOURNEY_RESULT_LIMIT
            ),
            sortBy: request.options.sortBy ?? "transfers"
        }
    };
    const cacheKey = createHash("sha256")
        .update(JSON.stringify(boundedRequest))
        .digest("hex");
    return journeyResultCache.getOrLoad(
        cacheKey,
        () => executeCoordinateRailwayJourneySearch(boundedRequest)
    );
}

export async function searchCoordinateRailwayDeparturesAfter(
    request: JourneySearchInput
): Promise<JourneySearchResult> {
    const boundedRequest: JourneySearchInput = {
        ...request,
        options: {
            ...request.options,
            resultLimit: Math.min(
                request.options.resultLimit,
                JOURNEY_RESULT_LIMIT
            ),
            sortBy: request.options.sortBy ?? "transfers"
        }
    };
    const cacheKey = createHash("sha256")
        .update(`train-departures-after:${JSON.stringify(boundedRequest)}`)
        .digest("hex");
    return journeyResultCache.getOrLoad(
        cacheKey,
        () => executeCoordinateRailwayJourneySearch(boundedRequest, true)
    );
}
