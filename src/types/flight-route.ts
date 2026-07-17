export type AirportSummary = {
    id: string;
    code: string;
    iataCode: string | null;
    icaoCode: string | null;
    name: string;
    city: string | null;
    countryCode: string | null;
    latitude: number;
    longitude: number;
};

export type AirlineSummary = {
    id: string;
    name: string;
    iataCode: string | null;
    icaoCode: string | null;
};

export type FlightLeg = {
    routeId: string;
    sourceAirport: AirportSummary;
    destinationAirport: AirportSummary;
    airline: AirlineSummary;
    flightNumber: string | null;
    route: string;
    codeshare: boolean;
    equipment: string | null;
    distanceKm: number | null;
    durationMinutes: number | null;
};

export type FlightItinerary = {
    route: string;
    stopAirport: AirportSummary | null;
    airlines: AirlineSummary[];
    flightNumbers: Array<string | null>;
    totalStops: number;
    legs: FlightLeg[];
};

export type AirportConnection = {
    airport: AirportSummary;
    airlines: AirlineSummary[];
    routeCount: number;
};

export type RouteType = "direct" | "one-stop";
