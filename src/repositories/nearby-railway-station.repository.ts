import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";

export type StationCandidateRole = "BOARDING" | "ALIGHTING";

export type NearbyRailwayStation = {
    databaseId: bigint;
    id: string;
    code: string;
    name: string;
    latitude: number;
    longitude: number;
    aerialDistanceKm: number;
    activeTrainCount: number;
};

type NearbyStationRow = {
    id: bigint;
    code: string;
    name: string;
    latitude: number;
    longitude: number;
    aerialDistanceKm: number;
    activeTrainCount: number;
};

export async function findNearbyRailwayStations(
    latitude: number,
    longitude: number,
    radiusKm: number,
    limit: number,
    role: StationCandidateRole
): Promise<NearbyRailwayStation[]> {
    const allowedFilter = role === "BOARDING"
        ? Prisma.sql`stop.boarding_allowed = TRUE`
        : Prisma.sql`stop.alighting_allowed = TRUE`;
    const scanLimit = Math.min(Math.max(limit * 8, 40), 200);

    const rows = await prisma.$queryRaw<NearbyStationRow[]>(Prisma.sql`
        WITH origin AS (
            SELECT ST_SetSRID(
                ST_MakePoint(${longitude}, ${latitude}),
                4326
            )::geography AS point
        ),
        nearby AS (
            SELECT
                station.id,
                station.station_code AS code,
                station.station_name AS name,
                ST_Y(station.geom) AS latitude,
                ST_X(station.geom) AS longitude,
                (
                    ST_Distance(station.geom::geography, origin.point)
                    / 1000.0
                )::DOUBLE PRECISION AS "aerialDistanceKm"
            FROM railway_station station
            CROSS JOIN origin
            WHERE station.geom IS NOT NULL
              AND station.station_code IS NOT NULL
              AND ST_DWithin(
                  station.geom::geography,
                  origin.point,
                  ${radiusKm * 1000}
              )
            ORDER BY "aerialDistanceKm"
            LIMIT ${scanLimit}
        ),
        available AS (
            SELECT
                nearby.id,
                nearby.code,
                nearby.name,
                nearby.latitude,
                nearby.longitude,
                nearby."aerialDistanceKm",
                COUNT(DISTINCT stop.train_id)::INTEGER AS "activeTrainCount"
            FROM nearby
            JOIN train_stops stop
              ON stop.station_id = nearby.id
             AND ${allowedFilter}
            JOIN "train" service
              ON service.id = stop.train_id
             AND service.active = TRUE
            GROUP BY
                nearby.id,
                nearby.code,
                nearby.name,
                nearby.latitude,
                nearby.longitude,
                nearby."aerialDistanceKm"
        )
        SELECT *
        FROM available
        ORDER BY
            CASE
                WHEN "aerialDistanceKm" < 0.5 THEN 0
                ELSE "aerialDistanceKm"
                    / GREATEST(
                        1.0,
                        POWER("activeTrainCount"::DOUBLE PRECISION, 0.75)
                    )
            END,
            "aerialDistanceKm",
            "activeTrainCount" DESC,
            code
        LIMIT ${limit}
    `);

    return rows.map(row => ({
        databaseId: row.id,
        id: row.id.toString(),
        code: row.code,
        name: row.name,
        latitude: row.latitude,
        longitude: row.longitude,
        aerialDistanceKm: row.aerialDistanceKm,
        activeTrainCount: row.activeTrainCount
    }));
}
