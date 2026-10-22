import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";

const CITY_MAPPING_RADIUS_KM = Number(process.env.RAILWAY_CITY_MAPPING_RADIUS_KM ?? 60);
const MAXIMUM_TRANSFER_KM = Number(process.env.INTERMODAL_TRANSFER_MAX_KM ?? 100);

// Rebuilds hub geography, railway-station city mapping, and every
// station <-> airport transfer link from scratch.
export async function refreshGeographyAndTransfers(): Promise<void> {
    const radiusKm = CITY_MAPPING_RADIUS_KM;
    const maximumTransferKm = MAXIMUM_TRANSFER_KM;
    await prisma.$executeRawUnsafe(`
        UPDATE transport_cities
        SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
        WHERE geom IS NULL
    `);
    await prisma.$executeRawUnsafe(`
        UPDATE transport_hubs
        SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
        WHERE geom IS NULL
    `);
    await prisma.$executeRawUnsafe(`
        WITH nearest_cities AS (
            SELECT
                hub.id AS hub_id,
                (
                    SELECT city.id
                    FROM transport_cities city
                    WHERE ST_DWithin(hub.geom, city.geom, ${radiusKm * 1000})
                    ORDER BY ST_Distance(hub.geom, city.geom)
                    LIMIT 1
                ) AS city_id
            FROM transport_hubs hub
            WHERE hub.hub_type = 'RAILWAY_STATION'
              AND hub.geom IS NOT NULL
        )
        UPDATE transport_hubs hub
        SET city_id = nearest.city_id,
            updated_at = CURRENT_TIMESTAMP
        FROM nearest_cities nearest
        WHERE nearest.hub_id = hub.id
          AND nearest.city_id IS NOT NULL
    `);
    await prisma.$executeRawUnsafe(`
        UPDATE hub_transfer_links
        SET active = false,
            updated_at = CURRENT_TIMESTAMP
    `);
    await prisma.$executeRawUnsafe(`
        WITH candidate_links AS (
            SELECT
                source.id AS from_hub_id,
                destination.id AS to_hub_id,
                source.hub_type AS from_hub_type,
                ST_Distance(source.geom, destination.geom) / 1000.0
                    AS aerial_distance_km,
                policy.road_speed_kph,
                policy.road_detour_factor,
                ROW_NUMBER() OVER (
                    PARTITION BY source.id
                    ORDER BY ST_Distance(source.geom, destination.geom)
                ) AS destination_rank
            FROM transport_hubs source
            JOIN transport_hubs destination
              ON destination.city_id = source.city_id
             AND destination.hub_type <> source.hub_type
            CROSS JOIN journey_routing_policies policy
            WHERE policy.active = true
              AND source.city_id IS NOT NULL
              AND source.geom IS NOT NULL
              AND destination.geom IS NOT NULL
              AND ST_DWithin(
                  source.geom,
                  destination.geom,
                  ${maximumTransferKm * 1000}
              )
        )
        INSERT INTO hub_transfer_links (
            from_hub_id, to_hub_id, aerial_distance_km,
            estimated_road_distance_km, travel_minutes,
            average_speed_kph, detour_factor
        )
        SELECT
            from_hub_id,
            to_hub_id,
            ROUND(aerial_distance_km::numeric, 2),
            ROUND((aerial_distance_km * road_detour_factor)::numeric, 2),
            CEIL(
                aerial_distance_km * road_detour_factor
                / road_speed_kph * 60.0
            )::integer,
            road_speed_kph,
            road_detour_factor
        FROM candidate_links
        WHERE from_hub_type = 'RAILWAY_STATION'
           OR destination_rank <= 10
        ON CONFLICT (from_hub_id, to_hub_id) DO UPDATE SET
            aerial_distance_km = EXCLUDED.aerial_distance_km,
            estimated_road_distance_km = EXCLUDED.estimated_road_distance_km,
            travel_minutes = EXCLUDED.travel_minutes,
            average_speed_kph = EXCLUDED.average_speed_kph,
            detour_factor = EXCLUDED.detour_factor,
            active = true,
            updated_at = CURRENT_TIMESTAMP
    `);
}

// Same rules as refreshGeographyAndTransfers, limited to the given airport
// hubs: maps each one without a city to the nearest city and creates its
// transfer links in both directions. Links between other hubs are untouched.
export async function linkAirportHubs(hubIds: bigint[]): Promise<number> {
    if (hubIds.length === 0) return 0;
    await prisma.$executeRaw(Prisma.sql`
        UPDATE transport_hubs
        SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
        WHERE id = ANY(${hubIds}::bigint[])
          AND geom IS NULL
    `);
    await prisma.$executeRaw(Prisma.sql`
        UPDATE transport_hubs hub
        SET city_id = nearest.city_id,
            updated_at = CURRENT_TIMESTAMP
        FROM (
            SELECT
                candidate.id AS hub_id,
                (
                    SELECT city.id
                    FROM transport_cities city
                    WHERE ST_DWithin(candidate.geom, city.geom, ${CITY_MAPPING_RADIUS_KM * 1000})
                    ORDER BY ST_Distance(candidate.geom, city.geom)
                    LIMIT 1
                ) AS city_id
            FROM transport_hubs candidate
            WHERE candidate.id = ANY(${hubIds}::bigint[])
              AND candidate.hub_type = 'AIRPORT'
              AND candidate.city_id IS NULL
              AND candidate.geom IS NOT NULL
        ) nearest
        WHERE nearest.hub_id = hub.id
          AND nearest.city_id IS NOT NULL
    `);
    return prisma.$executeRaw(Prisma.sql`
        WITH candidate_links AS (
            SELECT
                source.id AS from_hub_id,
                destination.id AS to_hub_id,
                source.hub_type AS from_hub_type,
                ST_Distance(source.geom, destination.geom) / 1000.0
                    AS aerial_distance_km,
                policy.road_speed_kph,
                policy.road_detour_factor,
                ROW_NUMBER() OVER (
                    PARTITION BY source.id
                    ORDER BY ST_Distance(source.geom, destination.geom)
                ) AS destination_rank
            FROM transport_hubs source
            JOIN transport_hubs destination
              ON destination.city_id = source.city_id
             AND destination.hub_type <> source.hub_type
            CROSS JOIN journey_routing_policies policy
            WHERE policy.active = true
              AND source.city_id IS NOT NULL
              AND source.geom IS NOT NULL
              AND destination.geom IS NOT NULL
              AND (
                  source.id = ANY(${hubIds}::bigint[])
                  OR destination.id = ANY(${hubIds}::bigint[])
              )
              AND ST_DWithin(
                  source.geom,
                  destination.geom,
                  ${MAXIMUM_TRANSFER_KM * 1000}
              )
        )
        INSERT INTO hub_transfer_links (
            from_hub_id, to_hub_id, aerial_distance_km,
            estimated_road_distance_km, travel_minutes,
            average_speed_kph, detour_factor
        )
        SELECT
            from_hub_id,
            to_hub_id,
            ROUND(aerial_distance_km::numeric, 2),
            ROUND((aerial_distance_km * road_detour_factor)::numeric, 2),
            CEIL(
                aerial_distance_km * road_detour_factor
                / road_speed_kph * 60.0
            )::integer,
            road_speed_kph,
            road_detour_factor
        FROM candidate_links
        WHERE from_hub_type = 'RAILWAY_STATION'
           OR destination_rank <= 10
        ON CONFLICT (from_hub_id, to_hub_id) DO UPDATE SET
            aerial_distance_km = EXCLUDED.aerial_distance_km,
            estimated_road_distance_km = EXCLUDED.estimated_road_distance_km,
            travel_minutes = EXCLUDED.travel_minutes,
            average_speed_kph = EXCLUDED.average_speed_kph,
            detour_factor = EXCLUDED.detour_factor,
            active = true,
            updated_at = CURRENT_TIMESTAMP
    `);
}
