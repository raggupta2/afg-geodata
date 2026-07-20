import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import { ScheduledFlight } from "../types/flight-schedule";

type FlightScheduleRow = {
    airlineCode: string;
    airlineName: string;
    flightNumber: string;
    departureTime: Date;
    arrivalTime: Date;
    durationMinutes: number;
    aircraft: string | null;
    status: string | null;
};

export async function findScheduledFlights(
    from: string,
    to: string,
    startTime: Date,
    endTime: Date
): Promise<ScheduledFlight[]> {
    const rows = await prisma.$queryRaw<FlightScheduleRow[]>(Prisma.sql`
        SELECT
            BTRIM(airline_code) AS "airlineCode",
            airline_name AS "airlineName",
            BTRIM(flight_number) AS "flightNumber",
            departure_time AS "departureTime",
            arrival_time AS "arrivalTime",
            ROUND(
                EXTRACT(EPOCH FROM (arrival_time - departure_time)) / 60.0
            )::INTEGER AS "durationMinutes",
            aircraft_type AS "aircraft",
            status
        FROM flight_schedules
        WHERE departure_airport = ${from}
          AND arrival_airport = ${to}
          AND departure_time >= ${startTime}
          AND departure_time < ${endTime}
        ORDER BY departure_time, flight_number
    `);

    return rows.map(row => ({
        flightNumber: row.flightNumber,
        airline: {
            code: row.airlineCode,
            name: row.airlineName
        },
        departureTime: row.departureTime.toISOString(),
        arrivalTime: row.arrivalTime.toISOString(),
        durationMinutes: row.durationMinutes,
        aircraft: row.aircraft,
        status: row.status
    }));
}

export async function hasDirectRouteConnectivity(
    sourceAirportId: bigint,
    destinationAirportId: bigint
): Promise<boolean> {
    const rows = await prisma.$queryRaw<Array<{ available: boolean }>>(Prisma.sql`
        SELECT EXISTS (
            SELECT 1
            FROM flight_routes
            WHERE source_airport_id = ${sourceAirportId}
              AND destination_airport_id = ${destinationAirportId}
              AND active = true
              AND stops = 0
        ) AS available
    `);

    return rows[0]?.available ?? false;
}
