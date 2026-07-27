DROP INDEX "train_services_train_number_key";

UPDATE "train_services" SET "route_number" = '1' WHERE "route_number" IS NULL;
ALTER TABLE "train_services" ALTER COLUMN "route_number" SET DEFAULT '1';
ALTER TABLE "train_services" ALTER COLUMN "route_number" SET NOT NULL;
CREATE UNIQUE INDEX "train_services_train_number_route_key" ON "train_services" ("train_number", "route_number");

ALTER TABLE "train_schedule_imports" ADD COLUMN "route_number" VARCHAR(20) NOT NULL DEFAULT '1';
DROP INDEX "train_schedule_imports_source_file_key";
CREATE UNIQUE INDEX "train_schedule_imports_source_route_key" ON "train_schedule_imports" ("source_file", "route_number");

DELETE FROM "train_connections";
INSERT INTO "train_connections" ("train_id", "from_stop_id", "to_stop_id", "from_station_id", "to_station_id", "sequence", "departure_minute", "arrival_minute", "duration_minutes")
SELECT current_stop."train_id", current_stop."id", next_stop."id", current_stop."station_id", next_stop."station_id", current_stop."sequence", current_stop."departure_minute", next_stop."arrival_minute", next_stop."arrival_minute" - current_stop."departure_minute"
FROM "train_stops" current_stop
JOIN LATERAL (
    SELECT candidate.* FROM "train_stops" candidate
    WHERE candidate."train_id" = current_stop."train_id"
      AND candidate."sequence" > current_stop."sequence"
    ORDER BY candidate."sequence" LIMIT 1
) next_stop ON true
WHERE current_stop."departure_minute" IS NOT NULL AND next_stop."arrival_minute" IS NOT NULL AND next_stop."arrival_minute" > current_stop."departure_minute";
