import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import {
    RailwayItinerary,
    RailwayStationSummary,
    TrainRouteLeg
} from "../types/railway-route";

type StationRow = {
    id: bigint;
    code: string;
    name: string;
};

type DirectTrainRow = {
    trainNumber: string;
    trainName: string;
    departureTime: string;
    arrivalTime: string;
    durationMinutes: number;
    numberOfStops: number;
};

type OneStopTrainRow = {
    firstTrainNumber: string;
    firstTrainName: string;
    secondTrainNumber: string;
    secondTrainName: string;
    transferStationId: bigint;
    transferStationCode: string;
    transferStationName: string;
    departureTime: string;
    transferArrivalTime: string;
    transferDepartureTime: string;
    arrivalTime: string;
    firstDurationMinutes: number;
    secondDurationMinutes: number;
    totalDurationMinutes: number;
    firstNumberOfStops: number;
    secondNumberOfStops: number;
    numberOfStops: number;
};

export type ResolvedRailwayStation = RailwayStationSummary & { databaseId: bigint };

const withoutDatabaseId = (
    { databaseId: _databaseId, ...station }: ResolvedRailwayStation
): RailwayStationSummary => station;

export async function findRailwayStationByCode(
    code: string
): Promise<ResolvedRailwayStation | null> {
    const rows = await prisma.$queryRaw<StationRow[]>(Prisma.sql`
        SELECT
            id,
            station_code AS code,
            station_name AS name
        FROM railway_stations
        WHERE station_code = ${code}
        LIMIT 1
    `);

    if (!rows[0]) return null;
    return {
        id: rows[0].id.toString(),
        code: rows[0].code,
        name: rows[0].name,
        databaseId: rows[0].id
    };
}

const directLeg = (
    row: DirectTrainRow,
    source: RailwayStationSummary,
    destination: RailwayStationSummary
): TrainRouteLeg => ({
    trainNumber: row.trainNumber,
    trainName: row.trainName,
    departureStation: source,
    arrivalStation: destination,
    departureTime: row.departureTime,
    arrivalTime: row.arrivalTime,
    durationMinutes: row.durationMinutes,
    numberOfStops: row.numberOfStops
});

export async function findDirectTrainRoutes(
    source: ResolvedRailwayStation,
    destination: ResolvedRailwayStation
): Promise<RailwayItinerary[]> {
    const rows = await prisma.$queryRaw<DirectTrainRow[]>(Prisma.sql`
        WITH direct_trains AS (
            SELECT
                service.train_number AS "trainNumber",
                service.train_name AS "trainName",
                TO_CHAR(source_stop.departure_time, 'HH24:MI:SS') AS "departureTime",
                TO_CHAR(destination_stop.arrival_time, 'HH24:MI:SS') AS "arrivalTime",
                (
                    destination_stop.day_offset * 1440
                    + EXTRACT(EPOCH FROM destination_stop.arrival_time) / 60
                    - source_stop.day_offset * 1440
                    - EXTRACT(EPOCH FROM source_stop.departure_time) / 60
                )::INTEGER AS "durationMinutes",
                (destination_stop.sequence - source_stop.sequence - 1)::INTEGER AS "numberOfStops"
            FROM train_stops source_stop
            JOIN train_stops destination_stop
              ON destination_stop.train_id = source_stop.train_id
             AND destination_stop.sequence > source_stop.sequence
            JOIN train_services service
              ON service.id = source_stop.train_id
             AND service.active = true
            WHERE source_stop.station_id = ${source.databaseId}
              AND destination_stop.station_id = ${destination.databaseId}
              AND source_stop.departure_time IS NOT NULL
              AND destination_stop.arrival_time IS NOT NULL
        )
        SELECT *
        FROM direct_trains
        WHERE "durationMinutes" > 0
        ORDER BY "durationMinutes", "departureTime", "trainNumber"
    `);

    const sourceSummary = withoutDatabaseId(source);
    const destinationSummary = withoutDatabaseId(destination);
    return rows.map(row => {
        const leg = directLeg(row, sourceSummary, destinationSummary);
        return {
            type: "direct",
            route: `${source.code} -> ${destination.code}`,
            departureStation: sourceSummary,
            arrivalStation: destinationSummary,
            departureTime: row.departureTime,
            arrivalTime: row.arrivalTime,
            totalDurationMinutes: row.durationMinutes,
            numberOfStops: row.numberOfStops,
            transferStation: null,
            trains: [leg]
        };
    });
}

export async function findOneStopTrainRoutes(
    source: ResolvedRailwayStation,
    destination: ResolvedRailwayStation
): Promise<RailwayItinerary[]> {
    const rows = await prisma.$queryRaw<OneStopTrainRow[]>(Prisma.sql`
        WITH candidates AS (
            SELECT
                first_service.train_number AS "firstTrainNumber",
                first_service.train_name AS "firstTrainName",
                second_service.train_number AS "secondTrainNumber",
                second_service.train_name AS "secondTrainName",
                transfer_station.id AS "transferStationId",
                transfer_station.station_code AS "transferStationCode",
                transfer_station.station_name AS "transferStationName",
                TO_CHAR(source_stop.departure_time, 'HH24:MI:SS') AS "departureTime",
                TO_CHAR(first_transfer.arrival_time, 'HH24:MI:SS') AS "transferArrivalTime",
                TO_CHAR(second_transfer.departure_time, 'HH24:MI:SS') AS "transferDepartureTime",
                TO_CHAR(destination_stop.arrival_time, 'HH24:MI:SS') AS "arrivalTime",
                (
                    first_transfer.day_offset * 1440
                    + EXTRACT(EPOCH FROM first_transfer.arrival_time) / 60
                    - source_stop.day_offset * 1440
                    - EXTRACT(EPOCH FROM source_stop.departure_time) / 60
                )::INTEGER AS "firstDurationMinutes",
                (
                    destination_stop.day_offset * 1440
                    + EXTRACT(EPOCH FROM destination_stop.arrival_time) / 60
                    - second_transfer.day_offset * 1440
                    - EXTRACT(EPOCH FROM second_transfer.departure_time) / 60
                )::INTEGER AS "secondDurationMinutes",
                MOD(
                    (
                        EXTRACT(EPOCH FROM second_transfer.departure_time) / 60
                        - EXTRACT(EPOCH FROM first_transfer.arrival_time) / 60
                        + 1440
                    )::INTEGER,
                    1440
                )::INTEGER AS "transferWaitMinutes",
                (first_transfer.sequence - source_stop.sequence - 1)::INTEGER
                    AS "firstNumberOfStops",
                (destination_stop.sequence - second_transfer.sequence - 1)::INTEGER
                    AS "secondNumberOfStops"
            FROM train_stops source_stop
            JOIN train_stops first_transfer
              ON first_transfer.train_id = source_stop.train_id
             AND first_transfer.sequence > source_stop.sequence
            JOIN train_stops second_transfer
              ON second_transfer.station_id = first_transfer.station_id
             AND second_transfer.train_id <> first_transfer.train_id
            JOIN train_stops destination_stop
              ON destination_stop.train_id = second_transfer.train_id
             AND destination_stop.sequence > second_transfer.sequence
            JOIN train_services first_service
              ON first_service.id = source_stop.train_id
             AND first_service.active = true
            JOIN train_services second_service
              ON second_service.id = second_transfer.train_id
             AND second_service.active = true
            JOIN railway_stations transfer_station
              ON transfer_station.id = first_transfer.station_id
            WHERE source_stop.station_id = ${source.databaseId}
              AND destination_stop.station_id = ${destination.databaseId}
              AND first_transfer.station_id <> ${source.databaseId}
              AND first_transfer.station_id <> ${destination.databaseId}
              AND source_stop.departure_time IS NOT NULL
              AND first_transfer.arrival_time IS NOT NULL
              AND second_transfer.departure_time IS NOT NULL
              AND destination_stop.arrival_time IS NOT NULL
        ), valid_candidates AS (
            SELECT
                *,
                (
                    "firstDurationMinutes"
                    + "transferWaitMinutes"
                    + "secondDurationMinutes"
                )::INTEGER AS "totalDurationMinutes",
                (
                    "firstNumberOfStops" + "secondNumberOfStops" + 1
                )::INTEGER AS "numberOfStops"
            FROM candidates
            WHERE "firstDurationMinutes" > 0
              AND "secondDurationMinutes" > 0
        )
        SELECT
            "firstTrainNumber",
            "firstTrainName",
            "secondTrainNumber",
            "secondTrainName",
            "transferStationId",
            "transferStationCode",
            "transferStationName",
            "departureTime",
            "transferArrivalTime",
            "transferDepartureTime",
            "arrivalTime",
            "firstDurationMinutes",
            "secondDurationMinutes",
            "totalDurationMinutes",
            "firstNumberOfStops",
            "secondNumberOfStops",
            "numberOfStops"
        FROM valid_candidates
        ORDER BY "totalDurationMinutes", "departureTime", "firstTrainNumber", "secondTrainNumber"
    `);

    const sourceSummary = withoutDatabaseId(source);
    const destinationSummary = withoutDatabaseId(destination);
    return rows.map(row => {
        const transferStation: RailwayStationSummary = {
            id: row.transferStationId.toString(),
            code: row.transferStationCode,
            name: row.transferStationName
        };
        return {
            type: "one-stop",
            route: `${source.code} -> ${transferStation.code} -> ${destination.code}`,
            departureStation: sourceSummary,
            arrivalStation: destinationSummary,
            departureTime: row.departureTime,
            arrivalTime: row.arrivalTime,
            totalDurationMinutes: row.totalDurationMinutes,
            numberOfStops: row.numberOfStops,
            transferStation,
            trains: [
                {
                    trainNumber: row.firstTrainNumber,
                    trainName: row.firstTrainName,
                    departureStation: sourceSummary,
                    arrivalStation: transferStation,
                    departureTime: row.departureTime,
                    arrivalTime: row.transferArrivalTime,
                    durationMinutes: row.firstDurationMinutes,
                    numberOfStops: row.firstNumberOfStops
                },
                {
                    trainNumber: row.secondTrainNumber,
                    trainName: row.secondTrainName,
                    departureStation: transferStation,
                    arrivalStation: destinationSummary,
                    departureTime: row.transferDepartureTime,
                    arrivalTime: row.arrivalTime,
                    durationMinutes: row.secondDurationMinutes,
                    numberOfStops: row.secondNumberOfStops
                }
            ]
        };
    });
}
