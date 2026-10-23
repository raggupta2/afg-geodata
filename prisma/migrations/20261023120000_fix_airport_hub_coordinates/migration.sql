-- Corrects airport hub coordinates inherited from the old Aviation Edge data.
-- Those hubs were stored at city-centre points (e.g. DED at Dehradun city
-- instead of Jolly Grant), and the flight SQLite migration and importer never
-- overwrite existing airports. The 43 airports below were reviewed against
-- the coordinates in 20261017120000_flight_sqlite_source and agreed to be
-- fixed. VTZ and SXR are intentionally left unchanged.
--
-- Steps: back up the current rows, move each hub to the SQLite point, re-map
-- its city if the linked city is missing or now beyond the 60 km city radius,
-- then rebuild the transfer links of these hubs with the same rules as
-- linkAirportHubs (src/maintenance/transport-hub-links.ts). Every step only
-- touches hubs that are more than 1 km from the SQLite point, so re-running
-- the statements does nothing. The whole migration runs in one transaction,
-- so a failure leaves nothing half-applied and searches never see the moved
-- hubs without transfer links.

BEGIN;

CREATE TEMPORARY TABLE "airport_coordinate_fix" (
    "iata_code" VARCHAR(3) PRIMARY KEY,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL
);

INSERT INTO "airport_coordinate_fix" ("iata_code", "latitude", "longitude") VALUES
    ('PAB', 21.9884000, 82.1110000),
    ('BEK', 28.4221000, 79.4507980),
    ('DEP', 27.9855000, 94.2228010),
    ('KTU', 25.1602000, 75.8455960),
    ('JLR', 23.1777990, 80.0520020),
    ('BUP', 30.2701000, 74.7557980),
    ('ISK', 20.1191010, 73.9129030),
    ('DED', 30.1892430, 78.1766510),
    ('SXV', 11.7833000, 78.0655980),
    ('SHL', 25.7036000, 91.9786990),
    ('DHM', 32.1649020, 76.2630180),
    ('TJV', 10.7238350, 79.1094570),
    ('KUU', 31.8766990, 77.1544040),
    ('NMB', 20.4344010, 72.8432010),
    ('LUH', 30.8547000, 75.9525990),
    ('BKB', 28.0706010, 73.2071990),
    ('NVY', 11.6129560, 79.5273820),
    ('PYB', 18.8795490, 82.5524780),
    ('REW', 24.5034010, 81.2202990),
    ('SLV', 31.0818000, 77.0680010),
    ('MYQ', 12.2297510, 76.6536830),
    ('RMD', 18.7010000, 79.3923000),
    ('MZU', 26.1191010, 85.3136980),
    ('RGH', 25.2617000, 88.7956010),
    ('DBD', 23.8340000, 86.4253010),
    ('HSS', 29.1860650, 75.7414200),
    ('PNY', 11.9680000, 79.8120000),
    ('IXT', 28.0647860, 95.3369520),
    ('ZER', 27.5883010, 93.8281020),
    ('KLH', 16.6647000, 74.2893980),
    ('JSA', 26.8887000, 70.8649980),
    ('AKD', 20.6989310, 77.0568830),
    ('LDA', 25.0101800, 88.1269170),
    ('GUX', 24.6546990, 77.3472980),
    ('IXV', 28.1753010, 94.8020020),
    ('BEP', 15.1628000, 76.8827970),
    ('IXX', 17.9081000, 77.4870990),
    ('PUT', 14.1493000, 77.7911000),
    ('RTC', 17.0135990, 73.3277970),
    ('IXP', 32.2336110, 75.6344440),
    ('CDP', 14.5131540, 78.7691830),
    ('TCR', 8.7242410, 78.0258030),
    ('RUP', 26.1418670, 89.9078920);

-- Hubs that will actually move (more than 1 km from the SQLite point).
CREATE TEMPORARY TABLE "airport_coordinate_targets" AS
SELECT
    hub."id" AS "hub_id",
    fix."iata_code",
    fix."latitude",
    fix."longitude",
    ST_SetSRID(ST_MakePoint(fix."longitude", fix."latitude"), 4326)::geography AS "geom"
FROM "airport_coordinate_fix" fix
JOIN "aviation_airports" airport ON airport."iata_code" = fix."iata_code"
JOIN "transport_hubs" hub ON hub."id" = airport."hub_id"
WHERE hub."geom" IS NULL
   OR ST_Distance(
        hub."geom",
        ST_SetSRID(ST_MakePoint(fix."longitude", fix."latitude"), 4326)::geography
      ) > 1000;

-- Backup kept outside the Prisma-managed public schema so `prisma migrate`
-- does not report it as drift. Restore with:
--   UPDATE transport_hubs hub SET latitude = b.latitude, longitude = b.longitude,
--       geom = b.geom, city_id = b.city_id
--   FROM maintenance_backups.airport_hub_coordinates_20261023 b
--   WHERE b.hub_id = hub.id;
-- then rebuild transfer links.
CREATE SCHEMA IF NOT EXISTS "maintenance_backups";

CREATE TABLE IF NOT EXISTS "maintenance_backups"."airport_hub_coordinates_20261023" (
    "hub_id" BIGINT PRIMARY KEY,
    "code" VARCHAR(20) NOT NULL,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "geom" geography,
    "city_id" BIGINT,
    "backed_up_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "maintenance_backups"."airport_hub_coordinates_20261023" (
    "hub_id", "code", "latitude", "longitude", "geom", "city_id"
)
SELECT hub."id", hub."code", hub."latitude", hub."longitude", hub."geom", hub."city_id"
FROM "transport_hubs" hub
JOIN "airport_coordinate_targets" target ON target."hub_id" = hub."id"
ON CONFLICT ("hub_id") DO NOTHING;

-- Move the hubs to the airport coordinates.
UPDATE "transport_hubs" hub
SET "latitude" = target."latitude",
    "longitude" = target."longitude",
    "geom" = target."geom",
    "updated_at" = CURRENT_TIMESTAMP
FROM "airport_coordinate_targets" target
WHERE target."hub_id" = hub."id";

-- Re-map the city when it is missing or the linked city is now farther than
-- the 60 km city-mapping radius (RAILWAY_CITY_MAPPING_RADIUS_KM default). A
-- linked city that is still within range is kept.
UPDATE "transport_hubs" hub
SET "city_id" = nearest."city_id",
    "updated_at" = CURRENT_TIMESTAMP
FROM (
    SELECT
        target."hub_id",
        (
            SELECT city."id"
            FROM "transport_cities" city
            WHERE city."geom" IS NOT NULL
              AND ST_DWithin(target."geom", city."geom", 60000)
            ORDER BY ST_Distance(target."geom", city."geom")
            LIMIT 1
        ) AS "city_id"
    FROM "airport_coordinate_targets" target
    JOIN "transport_hubs" current_hub ON current_hub."id" = target."hub_id"
    LEFT JOIN "transport_cities" linked ON linked."id" = current_hub."city_id"
    WHERE linked."id" IS NULL
       OR linked."geom" IS NULL
       OR NOT ST_DWithin(target."geom", linked."geom", 60000)
) nearest
WHERE nearest."hub_id" = hub."id"
  AND nearest."city_id" IS NOT NULL
  AND hub."city_id" IS DISTINCT FROM nearest."city_id";

-- Rebuild transfer links of the moved hubs: retire their old links, then
-- re-create them from the corrected points (same rules as linkAirportHubs,
-- with the 100 km INTERMODAL_TRANSFER_MAX_KM default).
UPDATE "hub_transfer_links" link
SET "active" = false,
    "updated_at" = CURRENT_TIMESTAMP
WHERE link."active" = true
  AND (
      link."from_hub_id" IN (SELECT "hub_id" FROM "airport_coordinate_targets")
      OR link."to_hub_id" IN (SELECT "hub_id" FROM "airport_coordinate_targets")
  );

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
          source.id IN (SELECT "hub_id" FROM "airport_coordinate_targets")
          OR destination.id IN (SELECT "hub_id" FROM "airport_coordinate_targets")
      )
      AND ST_DWithin(source.geom, destination.geom, 100000)
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
    updated_at = CURRENT_TIMESTAMP;

DROP TABLE "airport_coordinate_targets";
DROP TABLE "airport_coordinate_fix";

COMMIT;
