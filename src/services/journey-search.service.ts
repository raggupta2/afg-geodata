import { createHash } from "crypto";
import { BoundedAsyncTtlCache } from "../cache/bounded-async-ttl-cache";
import { ApiError } from "../errors/api.error";
import { NearbyRailwayStation } from "../repositories/nearby-railway-station.repository";
import {
    AdditionalTrainStation,
    AlternativeBoardingStation,
    AvailableDestinationStation,
    BoardingStationResult,
    Coordinates,
    JourneyLeg,
    JourneyPlace,
    JourneySearchInput,
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
    MINIMUM_RAIL_TRANSFER_MINUTES,
    MAXIMUM_TRAIN_LEGS,
    RAILWAY_SEARCH_HORIZON_DAYS,
    RailwayPath,
    searchRailwayProvider
} from "./railway-provider.service";
import {
    AVERAGE_ROAD_SPEED_KPH,
    BOARDING_BUFFER_MINUTES,
    calculateStationAccess,
    ROAD_DISTANCE_DETOUR_FACTOR
} from "./station-access.service";

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
    clock: RailwaySearchClock
): JourneySearchOption {
    const dateOnlySearch = request.departureDate !== undefined;
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
        destination.aerialDistanceKm
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
    const sourceDepartureMinute = dateOnlySearch
        ? path.departureMinute
            - BOARDING_BUFFER_MINUTES
            - source.roadTravelMinutes
        : clock.requestedMinute;
    const stationArrivalMinute = dateOnlySearch
        ? path.departureMinute - BOARDING_BUFFER_MINUTES
        : source.stationArrivalMinute;
    const readyMinute = dateOnlySearch
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
            boardingBufferMinutes: BOARDING_BUFFER_MINUTES,
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
        totalJourneyMinutes: dateOnlySearch
            ? source.roadTravelMinutes
                + BOARDING_BUFFER_MINUTES
                + railwayElapsedMinutes
                + destinationAccess.travelMinutes
            : path.arrivalMinute
                - clock.requestedMinute
                + destinationAccess.travelMinutes,
        numberOfTransfers: Math.max(0, trainGroups.length - 1),
        legs
    };
}

function railLegs(option: JourneySearchOption): RailJourneyLeg[] {
    return option.legs.filter(
        (leg): leg is RailJourneyLeg => leg.mode === "RAIL"
    );
}

function compareJourneyOptions(
    left: JourneySearchOption,
    right: JourneySearchOption
): number {
    const leftDirect = left.numberOfTransfers === 0 ? 0 : 1;
    const rightDirect = right.numberOfTransfers === 0 ? 0 : 1;
    return leftDirect - rightDirect
        || left.totalJourneyMinutes - right.totalJourneyMinutes
        || left.sourceAccess.travelMinutes - right.sourceAccess.travelMinutes
        || left.preTrainWaitingMinutes - right.preTrainWaitingMinutes
        || Date.parse(left.finalArrivalAt) - Date.parse(right.finalArrivalAt)
        || left.numberOfTransfers - right.numberOfTransfers
        || left.railTransferWaitingMinutes
            - right.railTransferWaitingMinutes;
}

function itineraryKey(option: JourneySearchOption): string {
    const trains = railLegs(option);
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
        ...services,
        ...transfers
    ].join("|");
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
    options: JourneySearchOption[]
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
        groupOptions.sort(compareJourneyOptions);
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
        const overallScoreMinutes = recommended.totalJourneyMinutes
            + recommended.numberOfTransfers * 30;
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
                    availableDestinations(groupOptions),
                alternativeBoardingStations:
                    alternativeBoardings(groupOptions, recommended),
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
        compareJourneyOptions(left.options[0], right.options[0])
    );
}

function boardingStationResults(
    sourceStations: NearbyRailwayStation[],
    groupedJourneys: GroupedJourney[],
    recommendedStationId: string | undefined,
    limit: number
): BoardingStationResult[] {
    const stations = sourceStations.map(station => {
        const access = calculateStationAccess(station.aerialDistanceKm);
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
    request: JourneySearchInput
): Promise<JourneySearchResult> {
    const dateOnlySearch = request.departureDate !== undefined;
    const clock = dateOnlySearch
        ? createRailwayDateSearchClock(request.departureDate)
        : createRailwaySearchClock(request.departureAt);
    const [sourceStations, destinationStations] = await Promise.all([
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
                station.aerialDistanceKm
            );
            const stationArrivalMinute =
                dateOnlySearch
                    ? 0
                    : clock.requestedMinute + access.travelMinutes;
            return {
                station,
                roadTravelMinutes: access.travelMinutes,
                estimatedRoadDistanceKm: access.estimatedRoadDistanceKm,
                stationArrivalMinute,
                readyMinute: dateOnlySearch
                    ? 0
                    : stationArrivalMinute + BOARDING_BUFFER_MINUTES
            };
        }
    );
    const sourceById = new Map(
        sourceTimings.map(source => [source.station.id, source])
    );
    const destinationById = new Map(
        destinationStations.map(station => [station.id, station])
    );
    const internalResultLimit = Math.min(
        60,
        Math.max(
            request.options.resultLimit * 2,
            sourceStations.length
                * request.options.routesPerBoardingStation
        )
    );
    const providerResult = await searchRailwayProvider(
        sourceTimings.map(source => ({
            stationId: source.station.id,
            readyMinute: source.readyMinute
        })),
        new Set(destinationStations.map(station => station.id)),
        clock.serviceDate,
        internalResultLimit,
        dateOnlySearch ? 24 * 60 : undefined
    );

    const allOptions = providerResult.paths
        .map(path => {
            const source = sourceById.get(path.originStationId);
            const destination = destinationById.get(
                path.destinationStationId
            );
            return source && destination
                ? buildOption(path, source, destination, request, clock)
                : null;
        })
        .filter((option): option is JourneySearchOption => option !== null)
        .sort((left, right) =>
            left.totalJourneyMinutes - right.totalJourneyMinutes
            || left.numberOfTransfers - right.numberOfTransfers
            || right.boardingStation.activeTrainCount
                - left.boardingStation.activeTrainCount
            || left.sourceAccess.travelMinutes
                - right.sourceAccess.travelMinutes
            || left.preTrainWaitingMinutes - right.preTrainWaitingMinutes
        );
    const groupedJourneys = groupJourneyOptions(allOptions);
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
            timeZone: RAILWAY_TIME_ZONE
        },
        assumptions: {
            aerialDistanceMethod: "POSTGIS_GEODESIC",
            roadDistanceMethod: "AERIAL_DISTANCE_DETOUR_FACTOR",
            roadDistanceAccuracy: "ESTIMATED",
            detourFactor: ROAD_DISTANCE_DETOUR_FACTOR,
            averageRoadSpeedKph: AVERAGE_ROAD_SPEED_KPH,
            boardingBufferMinutes: BOARDING_BUFFER_MINUTES,
            minimumRailTransferMinutes: MINIMUM_RAIL_TRANSFER_MINUTES,
            maximumTrainLegs: MAXIMUM_TRAIN_LEGS,
            searchHorizonDays: RAILWAY_SEARCH_HORIZON_DAYS
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
            request.options.boardingStationLimit
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
    const cacheKey = createHash("sha256")
        .update(JSON.stringify(request))
        .digest("hex");
    return journeyResultCache.getOrLoad(
        cacheKey,
        () => executeCoordinateRailwayJourneySearch(request)
    );
}
