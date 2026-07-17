import { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import { parseNearbyQuery } from "../services/nearby-query.service";

type RailwayStationRow = {
    id: bigint;
    station_code: string | null;
    station_name: string;
    station_name_hi: string | null;
    network: string | null;
    operator: string | null;
    railway_type: string | null;
    public_transport_type: string | null;
    internet_access: string | null;
    train_available: boolean;
    distance_km: number | null;
    geometry: { type: "Point"; coordinates: [number, number] };
};

const getQueryValue = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;

export const getRailwayStations = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const search = getQueryValue(req.query.q);
        const nearby = parseNearbyQuery(req.query);
        const requestedLimit = Number(getQueryValue(req.query.limit) ?? 500);
        const limit = Number.isFinite(requestedLimit)
            ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 1000)
            : 500;

        const searchFilter = search
            ? Prisma.sql`AND (
                station_name ILIKE ${`${search}%`}
                OR station_code ILIKE ${`${search}%`}
            )`
            : Prisma.empty;

        const ranking = search
            ? Prisma.sql`
                CASE
                    WHEN LOWER(COALESCE(station_code, '')) = LOWER(${search}) THEN 0
                    WHEN LOWER(station_name) = LOWER(${search}) THEN 1
                    WHEN LOWER(COALESCE(station_code, '')) LIKE LOWER(${`${search}%`}) THEN 2
                    WHEN LOWER(station_name) LIKE LOWER(${`${search}%`}) THEN 3
                    ELSE 4
                END,
            `
            : Prisma.empty;

        const distance = nearby
            ? Prisma.sql`ST_Distance(
                geom::geography,
                ST_SetSRID(ST_MakePoint(${nearby.longitude}, ${nearby.latitude}), 4326)::geography
            ) / 1000.0`
            : Prisma.sql`NULL::double precision`;

        const ordering = nearby
            ? Prisma.sql`distance_km, station_name, station_code NULLS LAST`
            : Prisma.sql`${ranking} station_name, station_code NULLS LAST`;

        const rows = await prisma.$queryRaw<RailwayStationRow[]>(Prisma.sql`
            SELECT
                id,
                station_code,
                station_name,
                station_name_hi,
                network,
                operator,
                railway_type,
                public_transport_type,
                internet_access,
                train_available,
                ${distance} AS distance_km,
                ST_AsGeoJSON(geom)::json AS geometry
            FROM railway_stations
            WHERE geom IS NOT NULL
            ${searchFilter}
            ORDER BY
                ${ordering}
            LIMIT ${limit}
        `);

        const data = {
            type: "FeatureCollection",
            features: rows.map(row => ({
                type: "Feature",
                id: row.id.toString(),
                properties: {
                    id: row.id.toString(),
                    station_code: row.station_code,
                    station_name: row.station_name,
                    station_name_hi: row.station_name_hi,
                    network: row.network,
                    operator: row.operator,
                    railway_type: row.railway_type,
                    public_transport_type: row.public_transport_type,
                    internet_access: row.internet_access,
                    train_available: row.train_available,
                    distance_km: row.distance_km,
                    address: [row.station_name, row.network, row.operator]
                        .filter(Boolean)
                        .join(", ") || null
                },
                geometry: row.geometry
            }))
        };

        res.json({
            success: true,
            count: rows.length,
            data
        });
    } catch (error) {
        next(error);
    }
};