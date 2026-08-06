import { Coordinates } from "./journey-search";

export type MultimodalSearchInput = {
    origin: Coordinates;
    destination: Coordinates;
    departureAt: string;
    options: {
        sourceRailRadiusKm: number;
        sourceAirportRadiusKm: number;
        destinationRailRadiusKm: number;
        destinationAirportRadiusKm: number;
        candidatesPerMode: number;
        maximumTransfers?: number;
        resultLimit: number;
    };
};

export type MultimodalPlace = {
    kind: "USER_LOCATION" | "DESTINATION" | "RAILWAY_STATION" | "AIRPORT";
    id?: string;
    code?: string;
    name: string;
    city?: string;
    latitude: number;
    longitude: number;
    timezone: string;
};

export type MultimodalLeg = {
    mode: "LOCAL" | "TRANSFER" | "RAIL" | "FLIGHT" | "WAIT";
    from: MultimodalPlace;
    to: MultimodalPlace;
    departureAt: string;
    arrivalAt: string;
    durationMinutes: number;
    distanceKm?: number | null;
    estimatedRoadDistanceKm?: number;
    transferType?: string;
    serviceId?: string;
    serviceNumber?: string;
    serviceName?: string;
    terminalFrom?: string | null;
    terminalTo?: string | null;
    numberOfStops?: number;
};

export type MultimodalJourneyResult = {
    id: string;
    rank: number;
    journeyType: "RAIL_ONLY" | "FLIGHT_ONLY" | "MIXED";
    departureHub: MultimodalPlace;
    arrivalHub: MultimodalPlace;
    departureAt: string;
    finalArrivalAt: string;
    totalJourneyMinutes: number;
    numberOfTransfers: number;
    scheduledLegs: number;
    modes: Array<"RAIL" | "FLIGHT">;
    legs: MultimodalLeg[];
};

export type MultimodalSearchResult = {
    request: {
        origin: Coordinates;
        destination: Coordinates;
        departureAt: string;
        timezone: "Asia/Kolkata";
    };
    policy: {
        version: number;
        roadSpeedKph: number;
        longDistanceRoadSpeedKph: number;
        roadSpeedDistanceThresholdKm: number;
        roadDetourFactor: number;
        initialRailBufferMinutes: number;
        initialFlightBufferMinutes: number;
        railToRailMinutes: number;
        sameAirportFlightTransferMinutes: number;
        maximumTransfers: number;
        searchHorizonDays: number;
    };
    coverage: {
        status: "COMPLETE" | "PARTIAL" | "RAIL_ONLY";
        availableAirportDates: number;
        emptyAirportDates: number;
        missingAirportDates: number;
    };
    search: {
        sourceHubsEvaluated: number;
        destinationHubsEvaluated: number;
        expandedStates: number;
        truncated: boolean;
    };
    journeyResults: MultimodalJourneyResult[];
};
