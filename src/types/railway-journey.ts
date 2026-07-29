export type JourneyStation = {
    id: string;
    code: string;
    name: string;
};

export type JourneyConnection = {
    id: string;
    trainId: string;
    trainNumber: string;
    trainName: string;
    runsMask: number;
    sequence: number;
    departureMinute: number;
    arrivalMinute: number;
    boardingAllowed: boolean;
    alightingAllowed: boolean;
    fromDistanceKm: number | null;
    toDistanceKm: number | null;
    fromStation: JourneyStation;
    toStation: JourneyStation;
};

export type RailwayJourneyLeg = {
    trainNumber: string;
    trainName: string;
    departureStation: JourneyStation;
    arrivalStation: JourneyStation;
    departureTime: string;
    arrivalTime: string;
    departureDateTime: string;
    arrivalDateTime: string;
    durationMinutes: number;
    totalDistanceKm: number | null;
    numberOfStops: number;
    stations: JourneyStation[];
};

export type RailwayJourney = {
    routeType: "direct" | "transfer";
    searchDate: string;
    requestedDepartureTime: string;
    departureStation: JourneyStation;
    arrivalStation: JourneyStation;
    departureTime: string;
    arrivalTime: string;
    departureDateTime: string;
    arrivalDateTime: string;
    totalDurationMinutes: number;
    totalDistanceKm: number | null;
    numberOfStops: number;
    numberOfTransfers: number;
    stations: JourneyStation[];
    legs: RailwayJourneyLeg[];
};
