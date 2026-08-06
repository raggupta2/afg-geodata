export type Coordinates = {
    latitude: number;
    longitude: number;
    label?: string;
};

export type JourneySearchOptions = {
    sourceRadiusKm: number;
    destinationRadiusKm: number;
    sourceCandidateLimit: number;
    destinationCandidateLimit: number;
    boardingStationLimit: number;
    routesPerBoardingStation: number;
    resultLimit: number;
};

type JourneySearchBase = {
    origin: Coordinates;
    destination: Coordinates;
    options: JourneySearchOptions;
};

export type JourneySearchInput = JourneySearchBase & (
    | {
        departureDate: string;
        departureAt?: never;
    }
    | {
        departureAt: string;
        departureDate?: never;
    }
);

export type JourneyPlace = {
    kind: "USER_LOCATION" | "DESTINATION" | "RAILWAY_STATION";
    id?: string;
    code?: string;
    name: string;
    latitude: number;
    longitude: number;
    timeZone: string;
};

export type LocalJourneyLeg = {
    mode: "LOCAL";
    from: JourneyPlace;
    to: JourneyPlace;
    departureAt: string;
    arrivalAt: string;
    durationMinutes: number;
    aerialDistanceKm: number;
    estimatedRoadDistanceKm: number;
    distanceMethod: "POSTGIS_GEODESIC";
    travelTimeMethod: "AERIAL_DISTANCE_DETOUR_FACTOR";
};

export type RailJourneyLeg = {
    mode: "RAIL";
    from: JourneyPlace;
    to: JourneyPlace;
    departureAt: string;
    arrivalAt: string;
    durationMinutes: number;
    trainNumber: string;
    trainName: string;
    serviceDate: string;
    distanceKm: number | null;
    numberOfStops: number;
};

export type TransferJourneyLeg = {
    mode: "TRANSFER";
    transferType: "BOARDING_WAIT" | "RAIL_TRANSFER";
    from: JourneyPlace;
    to: JourneyPlace;
    departureAt: string;
    arrivalAt: string;
    durationMinutes: number;
};

export type JourneyLeg =
    | LocalJourneyLeg
    | RailJourneyLeg
    | TransferJourneyLeg;

export type StationAccessSummary = {
    aerialDistanceKm: number;
    estimatedRoadDistanceKm: number;
    travelMinutes: number;
    boardingBufferMinutes: number;
    stationArrivalAt: string;
    readyToBoardAt: string;
};

export type RailwayStationCandidate = {
    id: string;
    code: string;
    name: string;
    latitude: number;
    longitude: number;
    aerialDistanceKm: number;
    activeTrainCount: number;
};

export type JourneySearchOption = {
    id: string;
    rank: number;
    boardingStation: RailwayStationCandidate;
    arrivalStation: RailwayStationCandidate;
    sourceAccess: StationAccessSummary;
    destinationAccess: {
        aerialDistanceKm: number;
        estimatedRoadDistanceKm: number;
        travelMinutes: number;
        destinationArrivalAt: string;
    };
    firstTrainDepartureAt: string;
    finalTrainArrivalAt: string;
    finalArrivalAt: string;
    preTrainWaitingMinutes: number;
    railwayElapsedMinutes: number;
    trainInVehicleMinutes: number;
    railTransferWaitingMinutes: number;
    totalJourneyMinutes: number;
    numberOfTransfers: number;
    legs: JourneyLeg[];
};

export type BoardingStationResult = RailwayStationCandidate & {
    estimatedRoadDistanceKm: number;
    roadTravelMinutes: number;
    matchingTrainCount: number;
    bestTotalJourneyMinutes: number | null;
    recommended: boolean;
};

export type TrainServiceSummary = {
    trainNumber: string;
    trainName: string;
    serviceDate: string;
    from: JourneyPlace;
    to: JourneyPlace;
    departureAt: string;
    arrivalAt: string;
    durationMinutes: number;
    distanceKm: number | null;
};

export type AlternativeBoardingStation = {
    station: RailwayStationCandidate;
    sourceAccess: StationAccessSummary;
    suggestedLeaveHomeAt: string;
    trainDepartureAt: string;
    totalJourneyMinutes: number;
};

export type AvailableDestinationStation = {
    station: RailwayStationCandidate;
    trainArrivalAt: string;
    finalArrivalAt: string;
    destinationAccess: JourneySearchOption["destinationAccess"];
};

export type JourneyTrainResult = {
    id: string;
    rank: number;
    itineraryKey: string;
    journeyType: "DIRECT" | "TRANSFER";
    trainNumber: string;
    trainName: string;
    serviceDate: string;
    numberOfTransfers: number;
    trains: TrainServiceSummary[];
    recommendedBoardingStation: RailwayStationCandidate;
    sourceAccess: StationAccessSummary;
    suggestedLeaveHomeAt: string;
    firstTrainDepartureAt: string;
    availableDestinationStations: AvailableDestinationStation[];
    alternativeBoardingStations: AlternativeBoardingStation[];
    transferDetails: TransferJourneyLeg[];
    finalTrainArrivalAt: string;
    finalArrivalAt: string;
    preTrainWaitingMinutes: number;
    railwayElapsedMinutes: number;
    trainInVehicleMinutes: number;
    railTransferWaitingMinutes: number;
    totalTrainDistanceKm: number | null;
    totalJourneyMinutes: number;
    overallScoreMinutes: number;
    legs: JourneyLeg[];
};

export type AdditionalTrainStation = RailwayStationCandidate & {
    additionalTrainCount: number;
};

export type JourneySearchResult = {
    request: {
        origin: Coordinates;
        destination: Coordinates;
        searchMode: "DATE_ONLY" | "DATE_TIME";
        departureDate: string;
        departureAt: string | null;
        timeZone: string;
    };
    assumptions: {
        aerialDistanceMethod: "POSTGIS_GEODESIC";
        roadDistanceMethod: "AERIAL_DISTANCE_DETOUR_FACTOR";
        roadDistanceAccuracy: "ESTIMATED";
        detourFactor: number;
        averageRoadSpeedKph: number;
        shortDistanceRoadSpeedKph: number;
        roadDistanceSpeedThresholdKm: number;
        boardingBufferMinutes: number;
        minimumRailTransferMinutes: number;
        maximumTrainLegs: number;
        searchHorizonDays: number;
    };
    search: {
        sourceCandidatesEvaluated: number;
        destinationCandidatesEvaluated: number;
        graphVersion: string;
        searchComplete: boolean;
        truncationReason: string | null;
    };
    boardingStations: BoardingStationResult[];
    trainResults: JourneyTrainResult[];
    nearbyStationsWithAdditionalTrains: AdditionalTrainStation[];
};
