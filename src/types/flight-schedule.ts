import { AirportSummary } from "./flight-route";

export type ScheduledFlight = {
    flightNumber: string;
    airline: {
        code: string;
        name: string;
    };
    departureTime: string;
    arrivalTime: string;
    durationMinutes: number;
    aircraft: string | null;
    status: string | null;
};

export type FlightConnectivityFallback = {
    available: boolean;
    source: "FLIGHT_ROUTE";
};

export type FlightScheduleSearchResult = {
    fromAirport: AirportSummary;
    toAirport: AirportSummary;
    travelDate: string;
    source: "FLIGHT_SCHEDULE";
    flights: ScheduledFlight[];
    connectivityFallback: FlightConnectivityFallback | null;
};
