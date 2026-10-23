-- Corrects four transport_cities points inherited from the old Aviation Edge
-- data, found after the airport fix (20261023120000_fix_airport_hub_coordinates):
--   PAB Bilaspur  was Bilaspur, Himachal (1159 km from PAB)
--   BEK Bareli    was Rae Bareli, exactly at RBL station (301 km from BEK)
--   KTU Kota      was a placeholder 68 km from Kota
--   JLR Jabalpur  was a placeholder 58 km from Jabalpur
-- Each city moves to its main railway station (BSP, BE, KOTA, JBP; points
-- taken from transport_hubs on 2026-10-23). Deparizo is intentionally left
-- unchanged: it currently serves Itanagar (HGI, Naharlagun).
--
-- Steps, in one transaction:
--   1. back up the city rows and the city of every hub that is re-mapped;
--   2. move the cities;
--   3. re-map railway stations near the old or new points, or currently
--      mapped to these cities, to the nearest city within 60 km
--      (RAILWAY_CITY_MAPPING_RADIUS_KM default). A station with no city in
--      range gets no city: refreshGeographyAndTransfers would otherwise keep
--      the stale one (e.g. Rae Bareli stations still in "Bareli");
--   4. re-map airports of these cities: the city whose IATA code matches
--      aviation_airports.city_iata_code if within 60 km, else the nearest
--      city within 60 km, else unchanged;
--   5. retire and rebuild every transfer link touching a hub whose city was
--      or now is one of these cities, or whose city changed, with the same
--      rules as refreshGeographyAndTransfers (100 km INTERMODAL_TRANSFER_MAX_KM
--      default, airports keep their 10 nearest stations).
-- Cities already within 1 km of the new point are skipped, so re-running the
-- statements does nothing.
--
-- Restore:
--   UPDATE transport_cities c SET latitude = b.latitude, longitude = b.longitude, geom = b.geom
--   FROM maintenance_backups.city_coordinates_20261023 b WHERE b.city_id = c.id;
--   UPDATE transport_hubs h SET city_id = b.city_id
--   FROM maintenance_backups.hub_cities_20261023 b WHERE b.hub_id = h.id;
-- then rebuild transfer links.

BEGIN;

CREATE TEMPORARY TABLE "city_coordinate_fix" (
    "iata_code" VARCHAR(3) PRIMARY KEY,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL
);

INSERT INTO "city_coordinate_fix" ("iata_code", "latitude", "longitude") VALUES
    ('PAB', 22.0561021, 82.1707668),
    ('BEK', 28.3381037, 79.4102663),
    ('KTU', 25.2239827, 75.8808529),
    ('JLR', 23.1649573, 79.9512511);

CREATE TEMPORARY TABLE "city_targets" AS
SELECT
    city."id" AS "city_id",
    city."geom" AS "old_geom",
    fix."latitude",
    fix."longitude",
    ST_SetSRID(ST_MakePoint(fix."longitude", fix."latitude"), 4326)::geography AS "new_geom"
FROM "city_coordinate_fix" fix
JOIN "transport_cities" city ON city."iata_code" = fix."iata_code"
WHERE city."geom" IS NULL
   OR ST_Distance(
        city."geom",
        ST_SetSRID(ST_MakePoint(fix."longitude", fix."latitude"), 4326)::geography
      ) > 1000;

CREATE SCHEMA IF NOT EXISTS "maintenance_backups";

CREATE TABLE IF NOT EXISTS "maintenance_backups"."city_coordinates_20261023" (
    "city_id" BIGINT PRIMARY KEY,
    "iata_code" VARCHAR(3) NOT NULL,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "geom" geography,
    "backed_up_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "maintenance_backups"."hub_cities_20261023" (
    "hub_id" BIGINT PRIMARY KEY,
    "code" VARCHAR(20) NOT NULL,
    "hub_type" VARCHAR(20) NOT NULL,
    "city_id" BIGINT,
    "backed_up_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "maintenance_backups"."city_coordinates_20261023" (
    "city_id", "iata_code", "latitude", "longitude", "geom"
)
SELECT city."id", city."iata_code", city."latitude", city."longitude", city."geom"
FROM "transport_cities" city
JOIN "city_targets" target ON target."city_id" = city."id"
ON CONFLICT ("city_id") DO NOTHING;

-- Hubs whose city must be re-evaluated, with their city before any change.
CREATE TEMPORARY TABLE "hub_candidates" AS
SELECT hub."id" AS "hub_id", hub."hub_type", hub."city_id" AS "old_city_id"
FROM "transport_hubs" hub
WHERE hub."geom" IS NOT NULL
  AND (
      hub."city_id" IN (SELECT "city_id" FROM "city_targets")
      OR (
          hub."hub_type" = 'RAILWAY_STATION'
          AND EXISTS (
              SELECT 1 FROM "city_targets" target
              WHERE ST_DWithin(hub."geom", target."new_geom", 60000)
                 OR ST_DWithin(hub."geom", target."old_geom", 60000)
          )
      )
      OR (
          hub."hub_type" = 'AIRPORT'
          AND EXISTS (
              SELECT 1
              FROM "aviation_airports" airport
              JOIN "transport_cities" city ON city."iata_code" = airport."city_iata_code"
              JOIN "city_targets" target ON target."city_id" = city."id"
              WHERE airport."hub_id" = hub."id"
          )
      )
  );

-- Move the cities.
UPDATE "transport_cities" city
SET "latitude" = target."latitude",
    "longitude" = target."longitude",
    "geom" = target."new_geom",
    "updated_at" = CURRENT_TIMESTAMP
FROM "city_targets" target
WHERE target."city_id" = city."id";

-- New city per candidate hub.
CREATE TEMPORARY TABLE "hub_new_cities" AS
SELECT
    candidate."hub_id",
    candidate."old_city_id",
    CASE
        WHEN candidate."hub_type" = 'RAILWAY_STATION' THEN (
            SELECT city."id"
            FROM "transport_cities" city
            WHERE city."geom" IS NOT NULL
              AND ST_DWithin(hub."geom", city."geom", 60000)
            ORDER BY ST_Distance(hub."geom", city."geom")
            LIMIT 1
        )
        ELSE COALESCE(
            (
                SELECT city."id"
                FROM "aviation_airports" airport
                JOIN "transport_cities" city ON city."iata_code" = airport."city_iata_code"
                WHERE airport."hub_id" = hub."id"
                  AND city."geom" IS NOT NULL
                  AND ST_DWithin(hub."geom", city."geom", 60000)
            ),
            (
                SELECT city."id"
                FROM "transport_cities" city
                WHERE city."geom" IS NOT NULL
                  AND ST_DWithin(hub."geom", city."geom", 60000)
                ORDER BY ST_Distance(hub."geom", city."geom")
                LIMIT 1
            ),
            candidate."old_city_id"
        )
    END AS "new_city_id"
FROM "hub_candidates" candidate
JOIN "transport_hubs" hub ON hub."id" = candidate."hub_id";

INSERT INTO "maintenance_backups"."hub_cities_20261023" ("hub_id", "code", "hub_type", "city_id")
SELECT hub."id", hub."code", hub."hub_type", changed."old_city_id"
FROM "hub_new_cities" changed
JOIN "transport_hubs" hub ON hub."id" = changed."hub_id"
WHERE changed."new_city_id" IS DISTINCT FROM changed."old_city_id"
ON CONFLICT ("hub_id") DO NOTHING;

UPDATE "transport_hubs" hub
SET "city_id" = changed."new_city_id",
    "updated_at" = CURRENT_TIMESTAMP
FROM "hub_new_cities" changed
WHERE changed."hub_id" = hub."id"
  AND changed."new_city_id" IS DISTINCT FROM changed."old_city_id";

-- Hubs whose transfer links must be rebuilt: everything in the moved cities
-- now, plus every hub whose city changed.
CREATE TEMPORARY TABLE "relink_hubs" AS
SELECT hub."id" AS "hub_id", hub."city_id"
FROM "transport_hubs" hub
WHERE hub."city_id" IN (SELECT "city_id" FROM "city_targets")
UNION
SELECT hub."id", hub."city_id"
FROM "hub_new_cities" changed
JOIN "transport_hubs" hub ON hub."id" = changed."hub_id"
WHERE changed."new_city_id" IS DISTINCT FROM changed."old_city_id";

UPDATE "hub_transfer_links" link
SET "active" = false,
    "updated_at" = CURRENT_TIMESTAMP
WHERE link."active" = true
  AND (
      link."from_hub_id" IN (SELECT "hub_id" FROM "relink_hubs")
      OR link."to_hub_id" IN (SELECT "hub_id" FROM "relink_hubs")
  );

-- Ranks are computed over every hub of the affected cities, so an airport
-- outside the moved cities (e.g. one that gains a re-mapped station) still
-- keeps only its 10 nearest stations; only links touching relink_hubs are
-- written.
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
      AND source.city_id IN (
          SELECT "city_id" FROM "relink_hubs" WHERE "city_id" IS NOT NULL
      )
      AND source.geom IS NOT NULL
      AND destination.geom IS NOT NULL
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
WHERE (from_hub_type = 'RAILWAY_STATION' OR destination_rank <= 10)
  AND (
      from_hub_id IN (SELECT "hub_id" FROM "relink_hubs")
      OR to_hub_id IN (SELECT "hub_id" FROM "relink_hubs")
  )
ON CONFLICT (from_hub_id, to_hub_id) DO UPDATE SET
    aerial_distance_km = EXCLUDED.aerial_distance_km,
    estimated_road_distance_km = EXCLUDED.estimated_road_distance_km,
    travel_minutes = EXCLUDED.travel_minutes,
    average_speed_kph = EXCLUDED.average_speed_kph,
    detour_factor = EXCLUDED.detour_factor,
    active = true,
    updated_at = CURRENT_TIMESTAMP;

DROP TABLE "relink_hubs";
DROP TABLE "hub_new_cities";
DROP TABLE "hub_candidates";
DROP TABLE "city_targets";
DROP TABLE "city_coordinate_fix";

COMMIT;
