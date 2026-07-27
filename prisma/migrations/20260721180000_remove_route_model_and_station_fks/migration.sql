-- Verify that legacy uniqueness can be restored without discarding data.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "train_stops"
        GROUP BY "train_id", "sequence"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Cannot restore train_stops (train_id, sequence) uniqueness: duplicates exist';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "train_connections"
        GROUP BY "train_id", "sequence"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Cannot restore train_connections (train_id, sequence) uniqueness: duplicates exist';
    END IF;
END;
$$;

-- Remove route-version references and their dependent indexes/FKs.
ALTER TABLE "train_schedule_imports"
    DROP CONSTRAINT IF EXISTS "train_schedule_imports_route_id_fkey";
ALTER TABLE "train_connections"
    DROP CONSTRAINT IF EXISTS "train_connections_route_id_fkey";
ALTER TABLE "train_stops"
    DROP CONSTRAINT IF EXISTS "train_stops_route_id_fkey";

DROP INDEX IF EXISTS "train_schedule_imports_route_id_idx";
DROP INDEX IF EXISTS "train_connections_route_sequence_key";
DROP INDEX IF EXISTS "train_stops_route_station_sequence_idx";
DROP INDEX IF EXISTS "train_stops_route_sequence_key";

ALTER TABLE "train_schedule_imports" DROP COLUMN IF EXISTS "route_id";
ALTER TABLE "train_connections" DROP COLUMN IF EXISTS "route_id";
ALTER TABLE "train_stops" DROP COLUMN IF EXISTS "route_id";

DROP TABLE IF EXISTS "train_routes";

-- The station master is intentionally incomplete during ETL. Service endpoint
-- codes remain unconstrained business identifiers until a later migration.
ALTER TABLE "train_services"
    DROP CONSTRAINT IF EXISTS "train_services_source_station_id_fkey",
    DROP CONSTRAINT IF EXISTS "train_services_destination_station_id_fkey";

DROP INDEX IF EXISTS "train_services_source_station_id_idx";
DROP INDEX IF EXISTS "train_services_destination_station_id_idx";

ALTER TABLE "train_services"
    DROP COLUMN IF EXISTS "source_station_id",
    DROP COLUMN IF EXISTS "destination_station_id";

-- Normalization is performed by ETL. Remove database triggers and functions.
DROP TRIGGER IF EXISTS "railway_stations_normalize_station_code_trigger"
    ON "railway_stations";
DROP TRIGGER IF EXISTS "train_services_normalize_station_codes_trigger"
    ON "train_services";
DROP FUNCTION IF EXISTS "normalize_railway_station_code"();
DROP FUNCTION IF EXISTS "normalize_train_service_station_codes"();

-- Restore the original route-variant uniqueness model.
CREATE UNIQUE INDEX IF NOT EXISTS "train_stops_train_sequence_key"
    ON "train_stops" ("train_id", "sequence");
CREATE UNIQUE INDEX IF NOT EXISTS "train_connections_train_sequence_key"
    ON "train_connections" ("train_id", "sequence");
