CREATE TYPE "FlightDurationSource" AS ENUM (
    'SCHEDULE',
    'DISTANCE_ESTIMATE',
    'MANUAL'
);

CREATE TABLE "flight_schedules" (
    "id" BIGSERIAL NOT NULL,
    "airline_code" CHAR(2) NOT NULL,
    "airline_name" TEXT NOT NULL,
    "flight_number" VARCHAR(8) NOT NULL,
    "departure_airport" CHAR(3) NOT NULL,
    "arrival_airport" CHAR(3) NOT NULL,
    "departure_terminal" VARCHAR(5),
    "arrival_terminal" VARCHAR(5),
    "departure_time" TIMESTAMPTZ(6) NOT NULL,
    "arrival_time" TIMESTAMPTZ(6) NOT NULL,
    "aircraft_type" VARCHAR(20),
    "frequency" VARCHAR(20),
    "status" VARCHAR(20),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flight_schedules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "flight_schedules_airports_different_check"
        CHECK (BTRIM("departure_airport") <> BTRIM("arrival_airport")),
    CONSTRAINT "flight_schedules_arrival_after_departure_check"
        CHECK ("arrival_time" > "departure_time"),
    CONSTRAINT "flight_schedules_airline_name_not_blank_check"
        CHECK (BTRIM("airline_name") <> ''),
    CONSTRAINT "flight_schedules_flight_number_not_blank_check"
        CHECK (BTRIM("flight_number") <> '')
);

CREATE UNIQUE INDEX "flight_schedules_instance_key"
    ON "flight_schedules" (
        "airline_code",
        "flight_number",
        "departure_airport",
        "departure_time"
    );

CREATE INDEX "flight_schedules_route_departure_idx"
    ON "flight_schedules" (
        "departure_airport",
        "arrival_airport",
        "departure_time"
    );

CREATE INDEX "flight_schedules_flight_departure_idx"
    ON "flight_schedules" ("flight_number", "departure_time");

ALTER TABLE "flight_routes"
    ADD COLUMN "duration_source" "FlightDurationSource";

CREATE OR REPLACE FUNCTION estimate_flight_duration_minutes(distance_km NUMERIC)
RETURNS INTEGER
LANGUAGE SQL
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
    SELECT GREATEST(
        1,
        CEIL(30.0 + (distance_km / 800.0 * 60.0))::INTEGER
    )
$$;

UPDATE "flight_routes"
SET "duration_source" = 'MANUAL'::"FlightDurationSource"
WHERE "duration_minutes" IS NOT NULL
  AND "duration_source" IS NULL;

UPDATE "flight_routes" AS route
SET "distance_km" = ROUND(
    (ST_Distance(source_airport."geom", destination_airport."geom") / 1000.0)::NUMERIC,
    2
)
FROM "airports" AS source_airport,
     "airports" AS destination_airport
WHERE source_airport."id" = route."source_airport_id"
  AND destination_airport."id" = route."destination_airport_id"
  AND source_airport."geom" IS NOT NULL
  AND destination_airport."geom" IS NOT NULL
  AND route."distance_km" IS NULL;

WITH scheduled_durations AS (
    SELECT
        route."id" AS route_id,
        ROUND(AVG(
            EXTRACT(EPOCH FROM (schedule."arrival_time" - schedule."departure_time")) / 60.0
        ))::INTEGER AS duration_minutes
    FROM "flight_routes" AS route
    JOIN "airlines" AS airline
      ON airline."id" = route."airline_id"
    JOIN "airports" AS source_airport
      ON source_airport."id" = route."source_airport_id"
    JOIN "airports" AS destination_airport
      ON destination_airport."id" = route."destination_airport_id"
    JOIN "flight_schedules" AS schedule
      ON BTRIM(schedule."airline_code") = BTRIM(airline."iata_code")
     AND BTRIM(schedule."flight_number") = BTRIM(route."flight_number")
     AND BTRIM(schedule."departure_airport") = BTRIM(
         COALESCE(route."source_iata", source_airport."iata_code")
     )
     AND BTRIM(schedule."arrival_airport") = BTRIM(
         COALESCE(route."destination_iata", destination_airport."iata_code")
     )
    WHERE route."flight_number" IS NOT NULL
      AND route."duration_source" IS DISTINCT FROM 'MANUAL'::"FlightDurationSource"
    GROUP BY route."id"
)
UPDATE "flight_routes" AS route
SET
    "duration_minutes" = scheduled.duration_minutes,
    "duration_source" = 'SCHEDULE'::"FlightDurationSource"
FROM scheduled_durations AS scheduled
WHERE scheduled.route_id = route."id"
  AND scheduled.duration_minutes > 0;

UPDATE "flight_routes"
SET
    "duration_minutes" = estimate_flight_duration_minutes("distance_km"),
    "duration_source" = 'DISTANCE_ESTIMATE'::"FlightDurationSource"
WHERE "duration_minutes" IS NULL
  AND "distance_km" IS NOT NULL;

ALTER TABLE "flight_routes"
    ADD CONSTRAINT "flight_routes_duration_source_pair_check"
    CHECK (
        ("duration_minutes" IS NULL AND "duration_source" IS NULL)
        OR
        ("duration_minutes" IS NOT NULL AND "duration_source" IS NOT NULL)
    );

CREATE INDEX "flight_routes_duration_source_idx"
    ON "flight_routes" ("duration_source");

DROP INDEX "flight_routes_static_route_unique_idx";

CREATE UNIQUE INDEX "flight_routes_static_route_unique_idx"
    ON "flight_routes" (
        "airline_id",
        "source_airport_id",
        "destination_airport_id",
        "codeshare",
        "stops",
        (COALESCE("equipment", ''))
    )
    WHERE "active" = true
      AND "flight_number" IS NULL;