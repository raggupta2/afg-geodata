-- Railway-only naming migration. Table and column renames preserve rows,
-- foreign keys, defaults, indexes, and constraint definitions in place.

ALTER TABLE "railway_stations" RENAME TO "railway_station";
ALTER TABLE "train_services" RENAME TO "train";
ALTER TABLE "indian_railways" RENAME TO "railway_track";

ALTER SEQUENCE IF EXISTS "railway_stations_id_seq"
    RENAME TO "railway_station_id_seq";
ALTER SEQUENCE IF EXISTS "train_services_id_seq"
    RENAME TO "train_id_seq";
ALTER SEQUENCE IF EXISTS "indian_railways_railway_id_seq"
    RENAME TO "railway_track_id_seq";

-- Preserve deprecated Hindi station names for the rollback window before
-- removing the column from the active station schema.
CREATE TABLE "railway_station_name_archive" (
    "station_id" BIGINT NOT NULL,
    "name_hi" TEXT NOT NULL,
    "archived" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "railway_station_name_archive_pkey"
        PRIMARY KEY ("station_id"),
    CONSTRAINT "railway_station_name_archive_station_id_fkey"
        FOREIGN KEY ("station_id") REFERENCES "railway_station"("id")
        ON UPDATE CASCADE ON DELETE CASCADE
);

INSERT INTO "railway_station_name_archive" ("station_id", "name_hi")
SELECT "id", "station_name_hi"
FROM "railway_station"
WHERE "station_name_hi" IS NOT NULL;

ALTER TABLE "railway_station" DROP COLUMN "station_name_hi";

ALTER TABLE "railway_station" RENAME COLUMN "created_at" TO "created";
ALTER TABLE "railway_station" RENAME COLUMN "updated_at" TO "updated";

ALTER TABLE "train" RENAME COLUMN "created_at" TO "created";
ALTER TABLE "train" RENAME COLUMN "updated_at" TO "updated";

ALTER TABLE "train_stops" RENAME COLUMN "created_at" TO "created";
ALTER TABLE "train_stops" RENAME COLUMN "updated_at" TO "updated";

ALTER TABLE "train_endpoints" RENAME COLUMN "created_at" TO "created";
ALTER TABLE "train_endpoints" RENAME COLUMN "updated_at" TO "updated";

ALTER TABLE "railway_track" RENAME COLUMN "railway_id" TO "id";
ALTER TABLE "railway_track" RENAME COLUMN "feature_id" TO "source_feature_id";
ALTER TABLE "railway_track" RENAME COLUMN "railway_gauge" TO "track_gauge";
ALTER TABLE "railway_track" RENAME COLUMN "state_name" TO "state";
ALTER TABLE "railway_track" RENAME COLUMN "city_name" TO "city";
ALTER TABLE "railway_track" RENAME COLUMN "shape_length" TO "source_length";
ALTER TABLE "railway_track" RENAME COLUMN "geometry" TO "geom";
ALTER TABLE "railway_track" RENAME COLUMN "created_at" TO "created";

-- Rename table-owned constraints so database metadata follows the new schema.
ALTER TABLE "railway_station"
    RENAME CONSTRAINT "railway_stations_pkey"
    TO "railway_station_pkey";
ALTER TABLE "railway_station"
    RENAME CONSTRAINT "railway_stations_station_code_normalized_check"
    TO "railway_station_station_code_normalized_check";
ALTER TABLE "railway_station"
    RENAME CONSTRAINT "railway_stations_created_at_not_null"
    TO "railway_station_created_not_null";
ALTER TABLE "railway_station"
    RENAME CONSTRAINT "railway_stations_updated_at_not_null"
    TO "railway_station_updated_not_null";
ALTER TABLE "railway_station"
    RENAME CONSTRAINT "railway_stations_geom_not_null"
    TO "railway_station_geom_not_null";
ALTER TABLE "railway_station"
    RENAME CONSTRAINT "railway_stations_id_not_null"
    TO "railway_station_id_not_null";
ALTER TABLE "railway_station"
    RENAME CONSTRAINT "railway_stations_station_name_not_null"
    TO "railway_station_station_name_not_null";
ALTER TABLE "railway_station"
    RENAME CONSTRAINT "railway_stations_train_available_not_null"
    TO "railway_station_train_available_not_null";

ALTER TABLE "train"
    RENAME CONSTRAINT "train_services_pkey"
    TO "train_pkey";
ALTER TABLE "train"
    RENAME CONSTRAINT "train_services_number_not_blank_check"
    TO "train_number_not_blank_check";
ALTER TABLE "train"
    RENAME CONSTRAINT "train_services_name_not_blank_check"
    TO "train_name_not_blank_check";
ALTER TABLE "train"
    RENAME CONSTRAINT "train_services_runs_mask_check"
    TO "train_runs_mask_check";
ALTER TABLE "train"
    RENAME CONSTRAINT "train_services_active_not_null"
    TO "train_active_not_null";
ALTER TABLE "train"
    RENAME CONSTRAINT "train_services_created_at_not_null"
    TO "train_created_not_null";
ALTER TABLE "train"
    RENAME CONSTRAINT "train_services_id_not_null"
    TO "train_id_not_null";
ALTER TABLE "train"
    RENAME CONSTRAINT "train_services_route_number_not_null"
    TO "train_route_number_not_null";
ALTER TABLE "train"
    RENAME CONSTRAINT "train_services_runs_mask_not_null"
    TO "train_runs_mask_not_null";
ALTER TABLE "train"
    RENAME CONSTRAINT "train_services_train_name_not_null"
    TO "train_train_name_not_null";
ALTER TABLE "train"
    RENAME CONSTRAINT "train_services_train_number_not_null"
    TO "train_train_number_not_null";
ALTER TABLE "train"
    RENAME CONSTRAINT "train_services_updated_at_not_null"
    TO "train_updated_not_null";

ALTER TABLE "train_stops"
    RENAME CONSTRAINT "train_stops_created_at_not_null"
    TO "train_stops_created_not_null";
ALTER TABLE "train_stops"
    RENAME CONSTRAINT "train_stops_updated_at_not_null"
    TO "train_stops_updated_not_null";

ALTER TABLE "train_endpoints"
    RENAME CONSTRAINT "train_endpoints_created_at_not_null"
    TO "train_endpoints_created_not_null";
ALTER TABLE "train_endpoints"
    RENAME CONSTRAINT "train_endpoints_updated_at_not_null"
    TO "train_endpoints_updated_not_null";

ALTER TABLE "railway_track"
    RENAME CONSTRAINT "indian_railways_pkey"
    TO "railway_track_pkey";
ALTER TABLE "railway_track"
    RENAME CONSTRAINT "indian_railways_feature_id_key"
    TO "railway_track_source_feature_id_key";
ALTER TABLE "railway_track"
    RENAME CONSTRAINT "indian_railways_railway_id_not_null"
    TO "railway_track_id_not_null";
ALTER TABLE "railway_track"
    RENAME CONSTRAINT "indian_railways_feature_id_not_null"
    TO "railway_track_source_feature_id_not_null";
ALTER TABLE "railway_track"
    RENAME CONSTRAINT "indian_railways_geometry_not_null"
    TO "railway_track_geom_not_null";
ALTER TABLE "railway_track"
    RENAME CONSTRAINT "indian_railways_created_at_not_null"
    TO "railway_track_created_not_null";

-- Constraint-backed indexes follow their renamed constraints. Rename only
-- independently-created indexes here.
ALTER INDEX "railway_stations_station_code_key"
    RENAME TO "railway_station_station_code_key";

ALTER INDEX "train_services_train_number_route_key"
    RENAME TO "train_train_number_route_key";
ALTER INDEX "train_services_active_idx"
    RENAME TO "train_active_idx";
ALTER INDEX "train_services_active_runs_idx"
    RENAME TO "train_active_runs_idx";

ALTER INDEX "idx_indian_railways_feature_id"
    RENAME TO "idx_railway_track_source_feature_id";
ALTER INDEX "idx_indian_railways_geometry"
    RENAME TO "idx_railway_track_geom";
ALTER INDEX "idx_indian_railways_railway_gauge"
    RENAME TO "idx_railway_track_track_gauge";
ALTER INDEX "idx_indian_railways_state_name"
    RENAME TO "idx_railway_track_state";
ALTER INDEX "idx_indian_railways_city_name"
    RENAME TO "idx_railway_track_city";
ALTER INDEX "idx_indian_railways_track_name"
    RENAME TO "idx_railway_track_track_name";
