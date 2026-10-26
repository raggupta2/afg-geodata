-- Corrects railway stations that were given the coordinates of a different,
-- similarly named station. Found on 2026-10-24 by comparing consecutive stops
-- of active trains: the straight-line distance between the two stations was
-- far longer than the rail distance in the timetable (more than
-- 1.15 x rail km + 15 km). Examples: BBK Barabanki Junction sat in West
-- Bengal (683 km away, mapped to city "Dhanbad"), MD Madar near Udaipur
-- (mapped to "Udaipur"), MUW Mathurapur Road at the exact point of MPRD
-- Mathurapur Rd in West Bengal.
--
-- New points:
--   MD, HKR  - the existing, correctly placed row of the same station
--              (MDJN Madar Junction, HKNT Hiwarkhed), 2-4 km from the
--              timetable estimate below.
--   others   - interpolated along the straight line between the nearest
--              correctly placed previous and next stops of the same train,
--              by timetable distance (pair named per row). Accurate to a few
--              km; PDG and RNE less so (their neighbours' timetable
--              distances are themselves inconsistent).
-- KTCR, SVZ and KUU also carried the wrong station name (Katlicherra,
-- Sivadi, Bhuntar Airport); they are renamed to Kottacheruvu, Sarai Harkhu
-- and Kuhuri (names confirmed by the user, 2026-10-24) in railway_station
-- and the station hub. The KUU airport hub ("Kullu Manali Airport") is a
-- different row and is not touched.
-- Not changed: DAKA (Dhaka, Bangladesh, line end, cannot be interpolated)
-- and DJRZ ("TO DARJEELING").
--
-- Steps, in one transaction:
--   1. back up each moved or renamed station and its hub (point, name, city);
--   2. move railway_station.geom and the mapped transport_hubs point, and
--      rename KTCR, SVZ and KUU;
--   3. re-map each moved hub to the nearest city within 60 km
--      (RAILWAY_CITY_MAPPING_RADIUS_KM default), or no city;
--   4. retire and rebuild every transfer link of the moved hubs and of all
--      hubs in their old and new cities, with the same rules as
--      refreshGeographyAndTransfers (100 km INTERMODAL_TRANSFER_MAX_KM
--      default, airports keep their 10 nearest stations).
-- Stations already within 5 km of the new point are not moved, and names
-- already set are not rewritten, so re-running the statements does nothing.
--
-- Restore:
--   UPDATE railway_station s SET geom = b.station_geom, station_name = b.station_name
--   FROM maintenance_backups.station_coordinates_20261024 b WHERE b.station_id = s.id;
--   UPDATE transport_hubs h SET latitude = b.hub_latitude, longitude = b.hub_longitude,
--       geom = b.hub_geom, name = b.hub_name, city_id = b.hub_city_id
--   FROM maintenance_backups.station_coordinates_20261024 b WHERE b.hub_id = h.id;
-- then rebuild transfer links.

BEGIN;

CREATE TEMPORARY TABLE "station_coordinate_fix" (
    "station_code" VARCHAR(20) PRIMARY KEY,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "station_name" VARCHAR(200)
);

INSERT INTO "station_coordinate_fix" ("station_code", "latitude", "longitude", "station_name") VALUES
    ('BBK',  26.8926, 81.1827, NULL),         -- Barabanki Jn, between DYD and SFH
    ('MD',   26.4628698, 74.6850428, NULL),   -- Madar, = MDJN
    ('CAA',  26.4148, 85.0474, NULL),         -- Chakia (East Champaran), MAI-PPA
    ('LSR',  19.9377, 75.0239, NULL),         -- Lasur, POZ-KAJG
    ('PSD',  19.9514, 74.8758, NULL),         -- Parsoda, KAJG-RGO
    ('MUW',  24.3686, 86.6428, NULL),         -- Mathurapur (Jharkhand), KBQ-MDP
    ('SNQ',  24.4484, 86.6433, NULL),         -- Sankarpur (Jharkhand), KBQ-MDP
    ('PDG',  19.5569, 76.1822, NULL),         -- Paradgaon, KODI-PTU
    ('RNE',  19.6083, 76.1234, NULL),         -- Ranjani, KODI-PTU
    ('KMV',  19.8794, 75.5508, NULL),         -- Karmad, BDU-MKDD
    ('CTH',  19.8628, 75.3981, NULL),         -- Chikalthana, BDU-MKDD
    ('PNPI', 20.8000, 83.8972, NULL),         -- Purunapani, BOUH-SNPU
    ('HKR',  21.4055985, 78.0677937, NULL),   -- Hiwarkhed, = HKNT
    ('KUU',  19.8622, 85.3561, 'Kuhuri'),     -- GNGD-KAPG (Odisha)
    ('KTCR', 14.1861, 77.7567, 'Kottacheruvu'), -- SSPN-BSPL (Andhra Pradesh)
    ('SVZ',  25.8408, 82.5113, 'Sarai Harkhu'); -- JOP-SKN (Uttar Pradesh)

CREATE TEMPORARY TABLE "station_renames" AS
SELECT station."id" AS "station_id", mapping."hub_id", fix."station_name"
FROM "station_coordinate_fix" fix
JOIN "railway_station" station ON station."station_code" = fix."station_code"
LEFT JOIN "railway_station_hubs" mapping ON mapping."station_id" = station."id"
LEFT JOIN "transport_hubs" hub ON hub."id" = mapping."hub_id"
WHERE fix."station_name" IS NOT NULL
  AND (
      station."station_name" IS DISTINCT FROM fix."station_name"
      OR (hub."id" IS NOT NULL AND hub."name" IS DISTINCT FROM fix."station_name")
  );

CREATE TEMPORARY TABLE "station_targets" AS
SELECT
    station."id" AS "station_id",
    mapping."hub_id",
    hub."city_id" AS "old_city_id",
    fix."latitude",
    fix."longitude",
    ST_SetSRID(ST_MakePoint(fix."longitude", fix."latitude"), 4326) AS "new_point"
FROM "station_coordinate_fix" fix
JOIN "railway_station" station ON station."station_code" = fix."station_code"
LEFT JOIN "railway_station_hubs" mapping ON mapping."station_id" = station."id"
LEFT JOIN "transport_hubs" hub ON hub."id" = mapping."hub_id"
WHERE ST_DistanceSphere(
    station."geom",
    ST_SetSRID(ST_MakePoint(fix."longitude", fix."latitude"), 4326)
) > 5000;

CREATE SCHEMA IF NOT EXISTS "maintenance_backups";

CREATE TABLE IF NOT EXISTS "maintenance_backups"."station_coordinates_20261024" (
    "station_id" BIGINT PRIMARY KEY,
    "station_code" VARCHAR(20),
    "station_name" TEXT NOT NULL,
    "station_geom" geometry NOT NULL,
    "hub_id" BIGINT,
    "hub_name" VARCHAR(200),
    "hub_latitude" DECIMAL(10,7),
    "hub_longitude" DECIMAL(10,7),
    "hub_geom" geography,
    "hub_city_id" BIGINT,
    "backed_up_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "maintenance_backups"."station_coordinates_20261024" (
    "station_id", "station_code", "station_name", "station_geom",
    "hub_id", "hub_name", "hub_latitude", "hub_longitude", "hub_geom", "hub_city_id"
)
SELECT
    station."id", station."station_code", station."station_name", station."geom",
    hub."id", hub."name", hub."latitude", hub."longitude", hub."geom", hub."city_id"
FROM (
    SELECT "station_id", "hub_id" FROM "station_targets"
    UNION
    SELECT "station_id", "hub_id" FROM "station_renames"
) target
JOIN "railway_station" station ON station."id" = target."station_id"
LEFT JOIN "transport_hubs" hub ON hub."id" = target."hub_id"
ON CONFLICT ("station_id") DO NOTHING;

-- Rename.
UPDATE "railway_station" station
SET "station_name" = renamed."station_name",
    "updated" = CURRENT_TIMESTAMP
FROM "station_renames" renamed
WHERE renamed."station_id" = station."id"
  AND station."station_name" IS DISTINCT FROM renamed."station_name";

UPDATE "transport_hubs" hub
SET "name" = renamed."station_name",
    "updated_at" = CURRENT_TIMESTAMP
FROM "station_renames" renamed
WHERE renamed."hub_id" = hub."id"
  AND hub."name" IS DISTINCT FROM renamed."station_name";

-- Move the stations and their hubs.
UPDATE "railway_station" station
SET "geom" = target."new_point",
    "updated" = CURRENT_TIMESTAMP
FROM "station_targets" target
WHERE target."station_id" = station."id";

UPDATE "transport_hubs" hub
SET "latitude" = target."latitude",
    "longitude" = target."longitude",
    "geom" = target."new_point"::geography,
    "updated_at" = CURRENT_TIMESTAMP
FROM "station_targets" target
WHERE target."hub_id" = hub."id";

-- Nearest city within 60 km, or none.
CREATE TEMPORARY TABLE "hub_new_cities" AS
SELECT
    target."hub_id",
    target."old_city_id",
    (
        SELECT city."id"
        FROM "transport_cities" city
        WHERE city."geom" IS NOT NULL
          AND ST_DWithin(hub."geom", city."geom", 60000)
        ORDER BY ST_Distance(hub."geom", city."geom")
        LIMIT 1
    ) AS "new_city_id"
FROM "station_targets" target
JOIN "transport_hubs" hub ON hub."id" = target."hub_id";

UPDATE "transport_hubs" hub
SET "city_id" = changed."new_city_id",
    "updated_at" = CURRENT_TIMESTAMP
FROM "hub_new_cities" changed
WHERE changed."hub_id" = hub."id"
  AND changed."new_city_id" IS DISTINCT FROM changed."old_city_id";

-- Hubs whose transfer links must be rebuilt: the moved hubs plus every hub
-- of the cities they left or joined (so those airports re-pick their 10
-- nearest stations).
CREATE TEMPORARY TABLE "relink_hubs" AS
SELECT "hub_id", "new_city_id" AS "city_id"
FROM "hub_new_cities"
UNION
SELECT hub."id", hub."city_id"
FROM "transport_hubs" hub
WHERE hub."city_id" IN (
    SELECT "old_city_id" FROM "hub_new_cities" WHERE "old_city_id" IS NOT NULL
    UNION
    SELECT "new_city_id" FROM "hub_new_cities" WHERE "new_city_id" IS NOT NULL
);

UPDATE "hub_transfer_links" link
SET "active" = false,
    "updated_at" = CURRENT_TIMESTAMP
WHERE link."active" = true
  AND (
      link."from_hub_id" IN (SELECT "hub_id" FROM "relink_hubs")
      OR link."to_hub_id" IN (SELECT "hub_id" FROM "relink_hubs")
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
DROP TABLE "station_targets";
DROP TABLE "station_renames";
DROP TABLE "station_coordinate_fix";

COMMIT;
