export type RailwayRouteType = "direct" | "one-stop";

export type RailwayStationSummary = {
    id: string;
    code: string;
    name: string;
};

export type TrainRouteLeg = {
    trainNumber: string;
    trainName: string;
    departureStation: RailwayStationSummary;
    arrivalStation: RailwayStationSummary;
    departureTime: string;
    arrivalTime: string;
    durationMinutes: number;
    numberOfStops: number;
    distanceKm?: number;
    runDays?: TrainRunDays;
};

export type TrainRunDays = {
    M: boolean;
    T: boolean;
    W: boolean;
    Th: boolean;
    F: boolean;
    S: boolean;
    Su: boolean;
};

export type TrainSummary = {
    distance: string;
    totalKms: number;
    runDays: TrainRunDays;
};

export type RailwayItinerary = {
    type: RailwayRouteType;
    route: string;
    departureStation: RailwayStationSummary;
    arrivalStation: RailwayStationSummary;
    departureTime: string;
    arrivalTime: string;
    totalDurationMinutes: number;
    numberOfStops: number;
    transferStation: RailwayStationSummary | null;
    trains: TrainRouteLeg[];
    summary?: TrainSummary;
};
