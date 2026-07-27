ALTER TABLE "train_services"
    ADD COLUMN "station_from_code" VARCHAR(20),
    ADD COLUMN "station_to_code" VARCHAR(20),
    ADD COLUMN "owner_code" VARCHAR(20),
    ADD COLUMN "route_number" VARCHAR(20),
    ADD COLUMN "runs_mask" SMALLINT NOT NULL DEFAULT 127,
    ADD COLUMN "source_updated_at" TIMESTAMP(3);

ALTER TABLE "train_services"
    ADD CONSTRAINT "train_services_runs_mask_check" CHECK ("runs_mask" BETWEEN 0 AND 127);
CREATE INDEX "train_services_active_runs_idx" ON "train_services" ("active", "runs_mask");

ALTER TABLE "train_stops"
    ADD COLUMN "arrival_minute" INTEGER,
    ADD COLUMN "departure_minute" INTEGER,
    ADD COLUMN "distance_km" DECIMAL(10,2),
    ADD COLUMN "halt_minutes" INTEGER,
    ADD COLUMN "boarding_allowed" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "alighting_allowed" BOOLEAN NOT NULL DEFAULT true;

UPDATE "train_stops"
SET "arrival_minute" = CASE WHEN "arrival_time" IS NULL THEN NULL ELSE "day_offset" * 1440 + (EXTRACT(EPOCH FROM "arrival_time") / 60)::INTEGER END,
    "departure_minute" = CASE WHEN "departure_time" IS NULL THEN NULL ELSE "day_offset" * 1440 + (EXTRACT(EPOCH FROM "departure_time") / 60)::INTEGER END;

ALTER TABLE "train_stops"
    ADD CONSTRAINT "train_stops_arrival_minute_nonnegative_check" CHECK ("arrival_minute" IS NULL OR "arrival_minute" >= 0),
    ADD CONSTRAINT "train_stops_departure_minute_nonnegative_check" CHECK ("departure_minute" IS NULL OR "departure_minute" >= 0),
    ADD CONSTRAINT "train_stops_distance_nonnegative_check" CHECK ("distance_km" IS NULL OR "distance_km" >= 0),
    ADD CONSTRAINT "train_stops_halt_nonnegative_check" CHECK ("halt_minutes" IS NULL OR "halt_minutes" >= 0);

CREATE INDEX "train_stops_departure_lookup_idx" ON "train_stops" ("station_id", "departure_minute", "train_id") WHERE "departure_minute" IS NOT NULL AND "boarding_allowed" = true;
CREATE INDEX "train_stops_arrival_lookup_idx" ON "train_stops" ("station_id", "arrival_minute", "train_id") WHERE "arrival_minute" IS NOT NULL AND "alighting_allowed" = true;

CREATE TABLE "train_connections" (
    "id" BIGSERIAL NOT NULL,
    "train_id" BIGINT NOT NULL,
    "from_stop_id" BIGINT NOT NULL,
    "to_stop_id" BIGINT NOT NULL,
    "from_station_id" BIGINT NOT NULL,
    "to_station_id" BIGINT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "departure_minute" INTEGER NOT NULL,
    "arrival_minute" INTEGER NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    CONSTRAINT "train_connections_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "train_connections_sequence_positive_check" CHECK ("sequence" > 0),
    CONSTRAINT "train_connections_time_order_check" CHECK ("arrival_minute" > "departure_minute"),
    CONSTRAINT "train_connections_duration_positive_check" CHECK ("duration_minutes" > 0)
);

CREATE UNIQUE INDEX "train_connections_train_sequence_key" ON "train_connections" ("train_id", "sequence");
CREATE INDEX "train_connections_departure_idx" ON "train_connections" ("from_station_id", "departure_minute");
CREATE INDEX "train_connections_arrival_idx" ON "train_connections" ("to_station_id", "arrival_minute");
CREATE INDEX "train_connections_train_idx" ON "train_connections" ("train_id", "sequence");

ALTER TABLE "train_connections"
    ADD CONSTRAINT "train_connections_train_id_fkey" FOREIGN KEY ("train_id") REFERENCES "train_services"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "train_connections_from_stop_id_fkey" FOREIGN KEY ("from_stop_id") REFERENCES "train_stops"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "train_connections_to_stop_id_fkey" FOREIGN KEY ("to_stop_id") REFERENCES "train_stops"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "train_connections_from_station_id_fkey" FOREIGN KEY ("from_station_id") REFERENCES "railway_stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "train_connections_to_station_id_fkey" FOREIGN KEY ("to_station_id") REFERENCES "railway_stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "train_connections" ("train_id", "from_stop_id", "to_stop_id", "from_station_id", "to_station_id", "sequence", "departure_minute", "arrival_minute", "duration_minutes")
SELECT current_stop."train_id", current_stop."id", next_stop."id", current_stop."station_id", next_stop."station_id", current_stop."sequence", current_stop."departure_minute", next_stop."arrival_minute", next_stop."arrival_minute" - current_stop."departure_minute"
FROM "train_stops" current_stop
JOIN "train_stops" next_stop ON next_stop."train_id" = current_stop."train_id" AND next_stop."sequence" = current_stop."sequence" + 1
WHERE current_stop."departure_minute" IS NOT NULL AND next_stop."arrival_minute" IS NOT NULL AND next_stop."arrival_minute" > current_stop."departure_minute";

CREATE TABLE "train_schedule_imports" (
    "id" BIGSERIAL NOT NULL,
    "source_file" TEXT NOT NULL,
    "checksum" CHAR(64) NOT NULL,
    "train_number" VARCHAR(20) NOT NULL,
    "source_updated_at" TIMESTAMP(3),
    "stop_count" INTEGER NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "train_schedule_imports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "train_schedule_imports_stop_count_positive_check" CHECK ("stop_count" > 0)
);

CREATE UNIQUE INDEX "train_schedule_imports_source_file_key" ON "train_schedule_imports" ("source_file");
CREATE INDEX "train_schedule_imports_checksum_idx" ON "train_schedule_imports" ("checksum");
CREATE INDEX "train_schedule_imports_train_number_idx" ON "train_schedule_imports" ("train_number");