ALTER TABLE "train_services"
    ADD COLUMN "source_station_id" BIGINT,
    ADD COLUMN "destination_station_id" BIGINT;

UPDATE "train_services" AS service
SET "source_station_id" = station."id"
FROM "railway_stations" AS station
WHERE service."source_station_code" IS NOT NULL
  AND station."station_code" = UPPER(BTRIM(service."source_station_code"));

UPDATE "train_services" AS service
SET "destination_station_id" = station."id"
FROM "railway_stations" AS station
WHERE service."destination_station_code" IS NOT NULL
  AND station."station_code" = UPPER(BTRIM(service."destination_station_code"));

ALTER TABLE "train_services"
    ADD CONSTRAINT "train_services_source_station_id_fkey"
        FOREIGN KEY ("source_station_id")
        REFERENCES "railway_stations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID,
    ADD CONSTRAINT "train_services_destination_station_id_fkey"
        FOREIGN KEY ("destination_station_id")
        REFERENCES "railway_stations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "train_services"
    VALIDATE CONSTRAINT "train_services_source_station_id_fkey";
ALTER TABLE "train_services"
    VALIDATE CONSTRAINT "train_services_destination_station_id_fkey";

CREATE INDEX IF NOT EXISTS "train_services_source_station_id_idx"
    ON "train_services" ("source_station_id");
CREATE INDEX IF NOT EXISTS "train_services_destination_station_id_idx"
    ON "train_services" ("destination_station_id");

ALTER TABLE "train_services"
    DROP CONSTRAINT IF EXISTS "train_services_source_station_code_normalized_check",
    DROP CONSTRAINT IF EXISTS "train_services_destination_station_code_normalized_check";

ALTER TABLE "train_services"
    DROP COLUMN "source_station_code",
    DROP COLUMN "destination_station_code";
