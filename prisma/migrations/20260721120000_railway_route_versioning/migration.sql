-- Add internal station identities without removing the public/business codes.
ALTER TABLE "train_services"
    ADD COLUMN "source_station_id" BIGINT,
    ADD COLUMN "destination_station_id" BIGINT;

UPDATE "train_services" AS service
SET "source_station_id" = source_station."id"
FROM "railway_stations" AS source_station
WHERE service."station_from_code" IS NOT NULL
  AND UPPER(BTRIM(source_station."station_code")) = UPPER(BTRIM(service."station_from_code"));

UPDATE "train_services" AS service
SET "destination_station_id" = destination_station."id"
FROM "railway_stations" AS destination_station
WHERE service."station_to_code" IS NOT NULL
  AND UPPER(BTRIM(destination_station."station_code")) = UPPER(BTRIM(service."station_to_code"));

ALTER TABLE "train_services"
    ADD CONSTRAINT "train_services_source_station_id_fkey"
        FOREIGN KEY ("source_station_id") REFERENCES "railway_stations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID,
    ADD CONSTRAINT "train_services_destination_station_id_fkey"
        FOREIGN KEY ("destination_station_id") REFERENCES "railway_stations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "train_services"
    VALIDATE CONSTRAINT "train_services_source_station_id_fkey";
ALTER TABLE "train_services"
    VALIDATE CONSTRAINT "train_services_destination_station_id_fkey";

CREATE INDEX IF NOT EXISTS "train_services_source_station_id_idx"
    ON "train_services" ("source_station_id");
CREATE INDEX IF NOT EXISTS "train_services_destination_station_id_idx"
    ON "train_services" ("destination_station_id");

-- A service retains its public identity; each timetable revision is a route.
CREATE TABLE "train_routes" (
    "id" BIGSERIAL NOT NULL,
    "train_service_id" BIGINT NOT NULL,
    "route_number" VARCHAR(20) NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_to" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "runs_mask" SMALLINT NOT NULL DEFAULT 127,
    "source_updated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "train_routes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "train_routes_route_number_not_blank_check"
        CHECK (BTRIM("route_number") <> ''),
    CONSTRAINT "train_routes_effective_period_check"
        CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from"),
    CONSTRAINT "train_routes_runs_mask_check"
        CHECK ("runs_mask" BETWEEN 0 AND 127),
    CONSTRAINT "train_routes_train_service_id_fkey"
        FOREIGN KEY ("train_service_id") REFERENCES "train_services"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "train_routes" (
    "train_service_id", "route_number", "effective_from", "active",
    "runs_mask", "source_updated_at", "created_at", "updated_at"
)
SELECT
    service."id",
    service."route_number",
    COALESCE(service."source_updated_at", service."created_at"),
    service."active",
    service."runs_mask",
    service."source_updated_at",
    service."created_at",
    service."updated_at"
FROM "train_services" AS service;

CREATE UNIQUE INDEX IF NOT EXISTS "train_routes_active_service_route_key"
    ON "train_routes" ("train_service_id", "route_number")
    WHERE "active" = true;
CREATE INDEX IF NOT EXISTS "train_routes_service_effective_idx"
    ON "train_routes" ("train_service_id", "effective_from" DESC);
CREATE INDEX IF NOT EXISTS "train_routes_active_runs_idx"
    ON "train_routes" ("active", "runs_mask");

-- route_id is transitional: train_id remains until all legacy writers migrate.
ALTER TABLE "train_stops" ADD COLUMN "route_id" BIGINT;
ALTER TABLE "train_connections" ADD COLUMN "route_id" BIGINT;
ALTER TABLE "train_schedule_imports" ADD COLUMN "route_id" BIGINT;

UPDATE "train_stops" AS stop
SET "route_id" = route."id"
FROM "train_routes" AS route
WHERE route."train_service_id" = stop."train_id"
  AND route."active" = true;

UPDATE "train_connections" AS connection
SET "route_id" = stop."route_id"
FROM "train_stops" AS stop
WHERE stop."id" = connection."from_stop_id";

UPDATE "train_schedule_imports" AS imported
SET "route_id" = route."id"
FROM "train_services" AS service
JOIN "train_routes" AS route
  ON route."train_service_id" = service."id" AND route."active" = true
WHERE service."train_number" = imported."train_number"
  AND service."route_number" = imported."route_number";

ALTER TABLE "train_stops"
    ADD CONSTRAINT "train_stops_route_id_fkey"
        FOREIGN KEY ("route_id") REFERENCES "train_routes"("id")
        ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "train_connections"
    ADD CONSTRAINT "train_connections_route_id_fkey"
        FOREIGN KEY ("route_id") REFERENCES "train_routes"("id")
        ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "train_schedule_imports"
    ADD CONSTRAINT "train_schedule_imports_route_id_fkey"
        FOREIGN KEY ("route_id") REFERENCES "train_routes"("id")
        ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

ALTER TABLE "train_stops" VALIDATE CONSTRAINT "train_stops_route_id_fkey";
ALTER TABLE "train_connections" VALIDATE CONSTRAINT "train_connections_route_id_fkey";
ALTER TABLE "train_schedule_imports" VALIDATE CONSTRAINT "train_schedule_imports_route_id_fkey";

-- Absolute minutes require ordered route context. Normalize existing schedules
-- before adding drift-prevention checks.
WITH RECURSIVE events AS (
    SELECT stop."route_id", stop."id" AS stop_id, stop."sequence", 1 AS event_order,
           stop."day_offset" * 1440
             + (EXTRACT(EPOCH FROM stop."arrival_time") / 60)::INTEGER AS base_minute,
           'arrival'::TEXT AS event_kind
    FROM "train_stops" AS stop
    WHERE stop."arrival_time" IS NOT NULL
    UNION ALL
    SELECT stop."route_id", stop."id", stop."sequence", 2,
           stop."day_offset" * 1440
             + (EXTRACT(EPOCH FROM stop."departure_time") / 60)::INTEGER,
           'departure'::TEXT
    FROM "train_stops" AS stop
    WHERE stop."departure_time" IS NOT NULL
), ordered_events AS (
    SELECT events.*,
           ROW_NUMBER() OVER (
               PARTITION BY events."route_id" ORDER BY events."sequence", events.event_order
           ) AS event_number
    FROM events
), timeline AS (
    SELECT event.*, event.base_minute AS absolute_minute
    FROM ordered_events AS event
    WHERE event.event_number = 1
    UNION ALL
    SELECT event.*,
           event.base_minute
             + CEIL(GREATEST(0, previous.absolute_minute - event.base_minute) / 1440.0)::INTEGER * 1440
    FROM timeline AS previous
    JOIN ordered_events AS event
      ON event."route_id" = previous."route_id"
     AND event.event_number = previous.event_number + 1
), resolved_stops AS (
    SELECT stop_id,
           MAX(absolute_minute) FILTER (WHERE event_kind = 'arrival') AS arrival_minute,
           MAX(absolute_minute) FILTER (WHERE event_kind = 'departure') AS departure_minute
    FROM timeline
    GROUP BY stop_id
)
UPDATE "train_stops" AS stop
SET "arrival_minute" = resolved.arrival_minute,
    "departure_minute" = resolved.departure_minute
FROM resolved_stops AS resolved
WHERE resolved.stop_id = stop."id"
  AND (stop."arrival_minute" IS DISTINCT FROM resolved.arrival_minute
       OR stop."departure_minute" IS DISTINCT FROM resolved.departure_minute);

UPDATE "train_connections" AS connection
SET "route_id" = from_stop."route_id",
    "train_id" = from_stop."train_id",
    "from_station_id" = from_stop."station_id",
    "to_station_id" = to_stop."station_id",
    "sequence" = from_stop."sequence",
    "departure_minute" = from_stop."departure_minute",
    "arrival_minute" = to_stop."arrival_minute",
    "duration_minutes" = to_stop."arrival_minute" - from_stop."departure_minute"
FROM "train_stops" AS from_stop, "train_stops" AS to_stop
WHERE from_stop."id" = connection."from_stop_id"
  AND to_stop."id" = connection."to_stop_id";

ALTER TABLE "train_stops"
    ADD CONSTRAINT "train_stops_arrival_clock_consistency_check" CHECK (
        ("arrival_time" IS NULL AND "arrival_minute" IS NULL)
        OR ("arrival_time" IS NOT NULL AND "arrival_minute" IS NOT NULL
            AND "arrival_minute" >= "day_offset" * 1440
            AND MOD("arrival_minute", 1440)
                = (EXTRACT(EPOCH FROM "arrival_time") / 60)::INTEGER)
    ) NOT VALID,
    ADD CONSTRAINT "train_stops_departure_clock_consistency_check" CHECK (
        ("departure_time" IS NULL AND "departure_minute" IS NULL)
        OR ("departure_time" IS NOT NULL AND "departure_minute" IS NOT NULL
            AND "departure_minute" >= "day_offset" * 1440
            AND MOD("departure_minute", 1440)
                = (EXTRACT(EPOCH FROM "departure_time") / 60)::INTEGER)
    ) NOT VALID,
    ADD CONSTRAINT "train_stops_time_order_check" CHECK (
        "arrival_minute" IS NULL OR "departure_minute" IS NULL
        OR "departure_minute" >= "arrival_minute"
    ) NOT VALID,
    ADD CONSTRAINT "train_stops_halt_consistency_check" CHECK (
        "halt_minutes" IS NULL OR "arrival_minute" IS NULL OR "departure_minute" IS NULL
        OR "halt_minutes" = "departure_minute" - "arrival_minute"
    ) NOT VALID;

ALTER TABLE "train_stops" VALIDATE CONSTRAINT "train_stops_arrival_clock_consistency_check";
ALTER TABLE "train_stops" VALIDATE CONSTRAINT "train_stops_departure_clock_consistency_check";
ALTER TABLE "train_stops" VALIDATE CONSTRAINT "train_stops_time_order_check";
ALTER TABLE "train_stops" VALIDATE CONSTRAINT "train_stops_halt_consistency_check";

ALTER TABLE "train_connections"
    ADD CONSTRAINT "train_connections_duration_consistency_check"
        CHECK ("duration_minutes" = "arrival_minute" - "departure_minute") NOT VALID;
ALTER TABLE "train_connections"
    VALIDATE CONSTRAINT "train_connections_duration_consistency_check";

-- Versioning requires uniqueness per route, not per legacy train_id.
DROP INDEX IF EXISTS "train_stops_train_sequence_key";
DROP INDEX IF EXISTS "train_connections_train_sequence_key";
-- This was an exact duplicate of the former unique connection index.
DROP INDEX IF EXISTS "train_connections_train_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "train_stops_route_sequence_key"
    ON "train_stops" ("route_id", "sequence");
CREATE INDEX IF NOT EXISTS "train_stops_station_sequence_idx"
    ON "train_stops" ("station_id", "sequence");
CREATE INDEX IF NOT EXISTS "train_stops_station_departure_minute_idx"
    ON "train_stops" ("station_id", "departure_minute")
    WHERE "departure_minute" IS NOT NULL AND "boarding_allowed" = true;
CREATE INDEX IF NOT EXISTS "train_stops_route_station_sequence_idx"
    ON "train_stops" ("route_id", "station_id", "sequence");
CREATE UNIQUE INDEX IF NOT EXISTS "train_connections_route_sequence_key"
    ON "train_connections" ("route_id", "sequence");
CREATE INDEX IF NOT EXISTS "train_schedule_imports_route_id_idx"
    ON "train_schedule_imports" ("route_id");
