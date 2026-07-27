import { NextFunction, Request, Response } from "express";
import { prisma } from "../config/database";

export const getRailwayTracks = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const {
            state,
            city,
            gauge,
            track,
            limit = 100,
            minLng,
            minLat,
            maxLng,
            maxLat
        } = req.query;

        const conditions: string[] = [];

        if (state) {
            conditions.push(`state ILIKE '%${state}%'`);
        }

        if (city) {
            conditions.push(`city ILIKE '%${city}%'`);
        }

        if (gauge) {
            conditions.push(`track_gauge ILIKE '%${gauge}%'`);
        }

        if (track) {
            conditions.push(`track_name ILIKE '%${track}%'`);
        }

        if (minLng && minLat && maxLng && maxLat) {
            conditions.push(`
                geom && ST_MakeEnvelope(
                    ${Number(minLng)},
                    ${Number(minLat)},
                    ${Number(maxLng)},
                    ${Number(maxLat)},
                    4326
                )
            `);
        }

        const whereSql = conditions.length > 0
            ? "WHERE " + conditions.join(" AND ")
            : "";

        const rows: any[] = await prisma.$queryRawUnsafe(`
            SELECT
                source_feature_id,
                track_gauge,
                state,
                city,
                track_name,
                source_length,
                ST_AsGeoJSON(geom)::json AS geometry
            FROM railway_track
            ${whereSql}
            LIMIT ${Number(limit)};
        `);

        const geojson = {
            type: "FeatureCollection",
            features: rows.map(row => ({
                type: "Feature",
                properties: {
                    source_feature_id: row.source_feature_id.toString(),
                    track_gauge: row.track_gauge,
                    state: row.state,
                    city: row.city,
                    track_name: row.track_name,
                    source_length: row.source_length
                },
                geometry: row.geometry
            }))
        };

        res.json({
            success: true,
            count: rows.length,
            data: geojson
        });
    } catch (error) {
        next(error);
    }
};