import { Request, Response, NextFunction } from "express";
import { prisma } from "../config/database";

console.log("Railway controller loaded");
export const getRailways = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {

        console.log("GET /railways called");

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


        let conditions: string[] = [];


        if (state) {
            conditions.push(
                `state_name ILIKE '%${state}%'`
            );
        }


        if (city) {
            conditions.push(
                `city_name ILIKE '%${city}%'`
            );
        }


        if (gauge) {
            conditions.push(
                `railway_gauge ILIKE '%${gauge}%'`
            );
        }


        if (track) {
            conditions.push(
                `track_name ILIKE '%${track}%'`
            );
        }


        // Map bounding box filter
        if (
            minLng &&
            minLat &&
            maxLng &&
            maxLat
        ) {

            conditions.push(`
                geometry && ST_MakeEnvelope(
                    ${Number(minLng)},
                    ${Number(minLat)},
                    ${Number(maxLng)},
                    ${Number(maxLat)},
                    4326
                )
            `);

        }


        let whereSQL = "";

        if (conditions.length > 0) {

            whereSQL =
                "WHERE " + conditions.join(" AND ");

        }


        const rows:any[] = await prisma.$queryRawUnsafe(`
            SELECT
                feature_id,
                railway_gauge,
                state_name,
                city_name,
                track_name,
                shape_length,
                ST_AsGeoJSON(geometry)::json AS geometry

            FROM indian_railways

            ${whereSQL}

            LIMIT ${Number(limit)};
        `);

     console.log(`Retrieved ${rows.length} rows from the database.`);

        const geojson = {
            type: "FeatureCollection",
            features: rows.map(row => ({
                type: "Feature",
                properties: {
                    feature_id: row.feature_id.toString(),
                    railway_gauge: row.railway_gauge,
                    state_name: row.state_name,
                    city_name: row.city_name,
                    track_name: row.track_name,
                    shape_length: row.shape_length
                },
                geometry: row.geometry
            }))
        };

           console.log(`Converted rows to GeoJSON format with ${geojson.features.length} features.`);


        res.json({
            success: true,
            count: rows.length,
            data: geojson
        });


    } catch(error){

        next(error);

    }

};