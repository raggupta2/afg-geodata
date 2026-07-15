import { NextFunction, Request, Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";

type AirportRow = {
    id: bigint;
    osm_id: bigint;
    osm_type: string | null;
    airport_name: string;
    alt_name: string | null;
    short_name: string | null;
    int_name: string | null;
    image: string | null;
    ref: string | null;
    iata_code: string | null;
    icao_code: string | null;
    airport_type: string | null;
    airport_class: string | null;
    city: string | null;
    country: string | null;
    country_code: string | null;
    region: string | null;
    operator: string | null;
    operator_type: string | null;
    owner: string | null;
    elevation_m: number | null;
    geometry: { type: "Point"; coordinates: [number, number] };
};

const getQueryValue = (value: unknown): string | undefined =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;

const getCoordinate = (value: unknown): number | undefined => {
    const text = getQueryValue(value);
    if (!text) return undefined;

    const coordinate = Number(text);
    return Number.isFinite(coordinate) ? coordinate : undefined;
};

export const getAirports = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const search = getQueryValue(req.query.q);
        const countryCode = getQueryValue(req.query.countryCode);
        const requestedLimit = Number(getQueryValue(req.query.limit) ?? 500);
        const limit = Number.isFinite(requestedLimit)
            ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 1000)
            : 500;

        const bounds = {
            minLng: getCoordinate(req.query.minLng),
            minLat: getCoordinate(req.query.minLat),
            maxLng: getCoordinate(req.query.maxLng),
            maxLat: getCoordinate(req.query.maxLat)
        };

        const suppliedBoundCount = Object.values(bounds).filter(
            value => value !== undefined
        ).length;

        if (suppliedBoundCount !== 0 && suppliedBoundCount !== 4) {
            res.status(400).json({
                success: false,
                message: "Provide minLng, minLat, maxLng, and maxLat together."
            });
            return;
        }

        if (
            suppliedBoundCount === 4 &&
            (bounds.minLng! >= bounds.maxLng! || bounds.minLat! >= bounds.maxLat!)
        ) {
            res.status(400).json({
                success: false,
                message: "The minimum map coordinates must be less than the maximum coordinates."
            });
            return;
        }

        const conditions: Prisma.Sql[] = [Prisma.sql`geom IS NOT NULL`];

        if (search) {
            const pattern = `${search}%`;
            conditions.push(Prisma.sql`(
                airport_name ILIKE ${pattern}
                OR alt_name ILIKE ${pattern}
                OR short_name ILIKE ${pattern}
                OR int_name ILIKE ${pattern}
                OR city ILIKE ${pattern}
                OR country ILIKE ${pattern}
                OR region ILIKE ${pattern}
                OR operator ILIKE ${pattern}
                OR owner ILIKE ${pattern}
                OR ref ILIKE ${pattern}
                OR iata_code ILIKE ${pattern}
                OR icao_code ILIKE ${pattern}
            )`);
        }

        if (countryCode) {
            conditions.push(Prisma.sql`country_code = ${countryCode.toUpperCase()}`);
        }

        if (suppliedBoundCount === 4) {
            conditions.push(Prisma.sql`
                geom::geometry && ST_MakeEnvelope(
                    ${bounds.minLng!},
                    ${bounds.minLat!},
                    ${bounds.maxLng!},
                    ${bounds.maxLat!},
                    4326
                )
            `);
        }

        const ranking = search
            ? Prisma.sql`
                CASE
                    WHEN LOWER(COALESCE(iata_code, '')) = LOWER(${search}) THEN 0
                    WHEN LOWER(COALESCE(icao_code, '')) = LOWER(${search}) THEN 1
                    WHEN LOWER(airport_name) = LOWER(${search}) THEN 2
                    WHEN LOWER(COALESCE(city, '')) = LOWER(${search}) THEN 3
                    WHEN LOWER(COALESCE(iata_code, '')) LIKE LOWER(${`${search}%`}) THEN 4
                    WHEN LOWER(COALESCE(icao_code, '')) LIKE LOWER(${`${search}%`}) THEN 5
                    WHEN LOWER(airport_name) LIKE LOWER(${`${search}%`}) THEN 6
                    WHEN LOWER(COALESCE(city, '')) LIKE LOWER(${`${search}%`}) THEN 7
                    ELSE 8
                END,
            `
            : Prisma.empty;

        const rows = await prisma.$queryRaw<AirportRow[]>(Prisma.sql`
            SELECT
                id,
                osm_id,
                osm_type,
                airport_name,
                alt_name,
                short_name,
                int_name,
                image,
                ref,
                iata_code,
                icao_code,
                airport_type,
                airport_class,
                city,
                country,
                country_code,
                region,
                operator,
                operator_type,
                owner,
                elevation_m,
                ST_AsGeoJSON(geom::geometry)::json AS geometry
            FROM airports
            WHERE ${Prisma.join(conditions, " AND ")}
            ORDER BY
                ${ranking}
                airport_name
            LIMIT ${limit}
        `);

        const data = {
            type: "FeatureCollection",
            features: rows.map(row => ({
                type: "Feature",
                id: row.id.toString(),
                properties: {
                    id: row.id.toString(),
                    osm_id: row.osm_id.toString(),
                    osm_type: row.osm_type,
                    airport_name: row.airport_name,
                    alt_name: row.alt_name,
                    short_name: row.short_name,
                    int_name: row.int_name,
                    image: row.image,
                    ref: row.ref,
                    iata_code: row.iata_code,
                    icao_code: row.icao_code,
                    airport_type: row.airport_type,
                    airport_class: row.airport_class,
                    city: row.city,
                    country: row.country,
                    country_code: row.country_code,
                    region: row.region,
                    operator: row.operator,
                    operator_type: row.operator_type,
                    owner: row.owner,
                    elevation_m: row.elevation_m
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