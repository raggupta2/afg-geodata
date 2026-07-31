import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import { JourneyConnection } from "../types/railway-journey";

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
    fromDistanceKm: number | null;
    toDistanceKm: number | null;
    fromStationId: bigint;
    fromStationCode: string;
    fromStationName: string;
    fromStationLatitude: number;
    fromStationLongitude: number;
    toStationId: bigint;
    toStationCode: string;
    toStationName: string;
    toStationLatitude: number;
    toStationLongitude: number;
};

function mapConnectionRow(row: ConnectionRow): JourneyConnection {
    return {
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
        fromDistanceKm: row.fromDistanceKm,
        toDistanceKm: row.toDistanceKm,
        fromStation: {
            id: row.fromStationId.toString(),
            code: row.fromStationCode,
            name: row.fromStationName,
            latitude: row.fromStationLatitude,
            longitude: row.fromStationLongitude
        },
        toStation: {
            id: row.toStationId.toString(),
            code: row.toStationCode,
            name: row.toStationName,
            latitude: row.toStationLatitude,
            longitude: row.toStationLongitude
        }
    };
}

/**
 * Loads the immutable active timetable snapshot. This query is intentionally
 * unfiltered: callers cache the result and reuse it across route searches
 * instead of materializing most of the connected network for every request.
 */
export async function findAllActiveJourneyConnections(): Promise<JourneyConnection[]> {
    const rows = await prisma.$queryRaw<ConnectionRow[]>(Prisma.sql`
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
            from_stop.distance_km::DOUBLE PRECISION AS "fromDistanceKm",
            to_stop.distance_km::DOUBLE PRECISION AS "toDistanceKm",
            from_station.id AS "fromStationId",
            from_station.station_code AS "fromStationCode",
            from_station.station_name AS "fromStationName",
            ST_Y(from_station.geom) AS "fromStationLatitude",
            ST_X(from_station.geom) AS "fromStationLongitude",
            to_station.id AS "toStationId",
            to_station.station_code AS "toStationCode",
            to_station.station_name AS "toStationName",
            ST_Y(to_station.geom) AS "toStationLatitude",
            ST_X(to_station.geom) AS "toStationLongitude"
        FROM train_connections connection
        JOIN "train" service
          ON service.id = connection.train_id
         AND service.active = TRUE
        JOIN train_stops from_stop ON from_stop.id = connection.from_stop_id
        JOIN train_stops to_stop ON to_stop.id = connection.to_stop_id
        JOIN railway_station from_station
          ON from_station.id = connection.from_station_id
        JOIN railway_station to_station
          ON to_station.id = connection.to_station_id
        ORDER BY connection.train_id, connection.sequence
    `);

    return rows.map(mapConnectionRow);
}
