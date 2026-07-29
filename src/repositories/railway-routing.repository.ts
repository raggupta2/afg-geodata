import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import { JourneyConnection, JourneyStation } from "../types/railway-journey";

type StationRow = { id: bigint; code: string; name: string };
type ConnectionRow = {
    id: bigint;
    trainId: bigint;
    trainNumber: string;
    trainName: string;
    runsMask: number;
    sequence: number;
    departureMinute: number;
    arrivalMinute: number;
    boardingAllowed: boolean;
    alightingAllowed: boolean;
    fromStationId: bigint;
    fromStationCode: string;
    fromStationName: string;
    toStationId: bigint;
    toStationCode: string;
    toStationName: string;
};

export type ResolvedJourneyStation = JourneyStation & { databaseId: bigint };

export async function findJourneyStationByCode(
    code: string
): Promise<ResolvedJourneyStation | null> {
    const rows = await prisma.$queryRaw<StationRow[]>(Prisma.sql`
        SELECT id, station_code AS code, station_name AS name
        FROM railway_station
        WHERE station_code = ${code}
        LIMIT 1
    `);
    const station = rows[0];
    if (!station) return null;

    return {
        id: station.id.toString(),
        code: station.code,
        name: station.name,
        databaseId: station.id
    };
}

export async function findJourneyConnections(
    departureStationId: bigint,
    arrivalStationId: bigint
): Promise<JourneyConnection[]> {
    const rows = await prisma.$queryRaw<ConnectionRow[]>(Prisma.sql`
        WITH RECURSIVE
        forward_stations(station_id) AS (
            SELECT ${departureStationId}::BIGINT
            UNION
            SELECT connection.to_station_id
            FROM train_connections connection
            JOIN forward_stations reachable
              ON reachable.station_id = connection.from_station_id
            JOIN "train" service
              ON service.id = connection.train_id
             AND service.active = TRUE
        ),
        backward_stations(station_id) AS (
            SELECT ${arrivalStationId}::BIGINT
            UNION
            SELECT connection.from_station_id
            FROM train_connections connection
            JOIN backward_stations reachable
              ON reachable.station_id = connection.to_station_id
            JOIN "train" service
              ON service.id = connection.train_id
             AND service.active = TRUE
        )
        SELECT
            connection.id,
            connection.train_id AS "trainId",
            service.train_number AS "trainNumber",
            service.train_name AS "trainName",
            service.runs_mask AS "runsMask",
            connection.sequence,
            connection.departure_minute AS "departureMinute",
            connection.arrival_minute AS "arrivalMinute",
            from_stop.boarding_allowed AS "boardingAllowed",
            to_stop.alighting_allowed AS "alightingAllowed",
            from_station.id AS "fromStationId",
            from_station.station_code AS "fromStationCode",
            from_station.station_name AS "fromStationName",
            to_station.id AS "toStationId",
            to_station.station_code AS "toStationCode",
            to_station.station_name AS "toStationName"
        FROM train_connections connection
        JOIN "train" service
          ON service.id = connection.train_id
         AND service.active = TRUE
        JOIN train_stops from_stop ON from_stop.id = connection.from_stop_id
        JOIN train_stops to_stop ON to_stop.id = connection.to_stop_id
        JOIN railway_station from_station ON from_station.id = connection.from_station_id
        JOIN railway_station to_station ON to_station.id = connection.to_station_id
        WHERE connection.from_station_id IN (SELECT station_id FROM forward_stations)
          AND connection.to_station_id IN (SELECT station_id FROM backward_stations)
        ORDER BY
            connection.departure_minute,
            connection.arrival_minute,
            connection.train_id,
            connection.sequence
    `);

    return rows.map(row => ({
        id: row.id.toString(),
        trainId: row.trainId.toString(),
        trainNumber: row.trainNumber,
        trainName: row.trainName,
        runsMask: row.runsMask,
        sequence: row.sequence,
        departureMinute: row.departureMinute,
        arrivalMinute: row.arrivalMinute,
        boardingAllowed: row.boardingAllowed,
        alightingAllowed: row.alightingAllowed,
        fromStation: {
            id: row.fromStationId.toString(),
            code: row.fromStationCode,
            name: row.fromStationName
        },
        toStation: {
            id: row.toStationId.toString(),
            code: row.toStationCode,
            name: row.toStationName
        }
    }));
}
