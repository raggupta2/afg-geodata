import { logger } from "../config/logger";
import { ApiError } from "../errors/api.error";
import { findAirportByCode, ResolvedAirport } from "../repositories/flight-route.repository";
import {
    findScheduledFlights,
    hasDirectRouteConnectivity
} from "../repositories/flight-schedule.repository";
import { AirportSummary } from "../types/flight-route";
import { FlightScheduleSearchResult } from "../types/flight-schedule";

const toAirportSummary = ({ databaseId: _databaseId, ...airport }: ResolvedAirport): AirportSummary =>
    airport;

async function resolveAirport(code: string): Promise<ResolvedAirport> {
    const airport = await findAirportByCode(code);
    if (!airport || airport.iataCode !== code) {
        throw new ApiError(404, `Airport code '${code}' was not found or has no map coordinates.`);
    }
    return airport;
}

export async function searchFlightSchedules(
    from: string,
    to: string,
    travelDate: string
): Promise<FlightScheduleSearchResult> {
    const [fromAirport, toAirport] = await Promise.all([
        resolveAirport(from),
        resolveAirport(to)
    ]);
    const startTime = new Date(`${travelDate}T00:00:00.000Z`);
    const endTime = new Date(startTime);
    endTime.setUTCDate(endTime.getUTCDate() + 1);

    const flights = await findScheduledFlights(from, to, startTime, endTime);
    const connectivityFallback = flights.length === 0
        ? {
            available: await hasDirectRouteConnectivity(
                fromAirport.databaseId,
                toAirport.databaseId
            ),
            source: "FLIGHT_ROUTE" as const
        }
        : null;

    logger.info(
        {
            from,
            to,
            travelDate,
            count: flights.length,
            fallbackAvailable: connectivityFallback?.available ?? false
        },
        "flight schedules searched"
    );

    return {
        fromAirport: toAirportSummary(fromAirport),
        toAirport: toAirportSummary(toAirport),
        travelDate,
        source: "FLIGHT_SCHEDULE",
        flights,
        connectivityFallback
    };
}
