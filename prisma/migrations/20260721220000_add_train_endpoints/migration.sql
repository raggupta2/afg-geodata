CREATE TABLE "train_endpoints" (
    "train_id" BIGINT NOT NULL,
    "source_station_id" BIGINT NOT NULL,
    "destination_station_id" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "train_endpoints_pkey" PRIMARY KEY ("train_id"),
    CONSTRAINT "train_endpoints_train_id_fkey"
        FOREIGN KEY ("train_id") REFERENCES "train_services"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "train_endpoints_source_station_id_fkey"
        FOREIGN KEY ("source_station_id") REFERENCES "railway_stations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "train_endpoints_destination_station_id_fkey"
        FOREIGN KEY ("destination_station_id") REFERENCES "railway_stations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

-- train_stops is authoritative. Derive endpoints from its ordered sequence.
INSERT INTO "train_endpoints" (
    "train_id", "source_station_id", "destination_station_id"
)
SELECT
    service."id",
    source_stop."station_id",
    destination_stop."station_id"
FROM "train_services" AS service
JOIN LATERAL (
    SELECT stop."station_id"
    FROM "train_stops" AS stop
    WHERE stop."train_id" = service."id"
    ORDER BY stop."sequence" ASC
    LIMIT 1
) AS source_stop ON true
JOIN LATERAL (
    SELECT stop."station_id"
    FROM "train_stops" AS stop
    WHERE stop."train_id" = service."id"
    ORDER BY stop."sequence" DESC
    LIMIT 1
) AS destination_stop ON true;

CREATE INDEX IF NOT EXISTS "train_endpoints_source_station_id_idx"
    ON "train_endpoints" ("source_station_id", "train_id");
CREATE INDEX IF NOT EXISTS "train_endpoints_destination_station_id_idx"
    ON "train_endpoints" ("destination_station_id", "train_id");

ALTER TABLE "train_services"
    DROP CONSTRAINT IF EXISTS "train_services_source_station_id_fkey",
    DROP CONSTRAINT IF EXISTS "train_services_destination_station_id_fkey";

DROP INDEX IF EXISTS "train_services_source_station_id_idx";
DROP INDEX IF EXISTS "train_services_destination_station_id_idx";

ALTER TABLE "train_services"
    DROP COLUMN "source_station_id",
    DROP COLUMN "destination_station_id";
