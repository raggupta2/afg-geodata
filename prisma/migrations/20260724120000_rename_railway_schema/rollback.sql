-- Manual rollback for 20260724120000_rename_railway_schema.
-- Run only after stopping writers that use the renamed railway schema.

ALTER INDEX "railway_station_station_code_key"
    RENAME TO "railway_stations_station_code_key";

ALTER INDEX "train_train_number_route_key"
    RENAME TO "train_services_train_number_route_key";
ALTER INDEX "train_active_idx"
    RENAME TO "train_services_active_idx";
ALTER INDEX "train_active_runs_idx"
    RENAME TO "train_services_active_runs_idx";

ALTER INDEX "idx_railway_track_source_feature_id"
    RENAME TO "idx_indian_railways_feature_id";
ALTER INDEX "idx_railway_track_geom"
    RENAME TO "idx_indian_railways_geometry";
ALTER INDEX "idx_railway_track_track_gauge"
    RENAME TO "idx_indian_railways_railway_gauge";
ALTER INDEX "idx_railway_track_state"
    RENAME TO "idx_indian_railways_state_name";
ALTER INDEX "idx_railway_track_city"
    RENAME TO "idx_indian_railways_city_name";
ALTER INDEX "idx_railway_track_track_name"
    RENAME TO "idx_indian_railways_track_name";

ALTER TABLE "railway_station"
    RENAME CONSTRAINT "railway_station_pkey"
    TO "railway_stations_pkey";
ALTER TABLE "railway_station"
    RENAME CONSTRAINT "railway_station_station_code_normalized_check"
    TO "railway_stations_station_code_normalized_check";
ALTER TABLE "railway_station"
    RENAME CONSTRAINT "railway_station_created_not_null"
    TO "railway_stations_created_at_not_null";
ALTER TABLE "railway_station"
    RENAME CONSTRAINT "railway_station_updated_not_null"
    TO "railway_stations_updated_at_not_null";
ALTER TABLE "railway_station"
    RENAME CONSTRAINT "railway_station_geom_not_null"
    TO "railway_stations_geom_not_null";
ALTER TABLE "railway_station"
    RENAME CONSTRAINT "railway_station_id_not_null"
    TO "railway_stations_id_not_null";
ALTER TABLE "railway_station"
    RENAME CONSTRAINT "railway_station_station_name_not_null"
    TO "railway_stations_station_name_not_null";
ALTER TABLE "railway_station"
    RENAME CONSTRAINT "railway_station_train_available_not_null"
    TO "railway_stations_train_available_not_null";

ALTER TABLE "train"
    RENAME CONSTRAINT "train_pkey"
    TO "train_services_pkey";
ALTER TABLE "train"
    RENAME CONSTRAINT "train_number_not_blank_check"
    TO "train_services_number_not_blank_check";
ALTER TABLE "train"
    RENAME CONSTRAINT "train_name_not_blank_check"
    TO "train_services_name_not_blank_check";
ALTER TABLE "train"
    RENAME CONSTRAINT "train_runs_mask_check"
    TO "train_services_runs_mask_check";
ALTER TABLE "train"
    RENAME CONSTRAINT "train_active_not_null"
    TO "train_services_active_not_null";
ALTER TABLE "train"
    RENAME CONSTRAINT "train_created_not_null"
    TO "train_services_created_at_not_null";
ALTER TABLE "train"
    RENAME CONSTRAINT "train_id_not_null"
    TO "train_services_id_not_null";
ALTER TABLE "train"
    RENAME CONSTRAINT "train_route_number_not_null"
    TO "train_services_route_number_not_null";
ALTER TABLE "train"
    RENAME CONSTRAINT "train_runs_mask_not_null"
    TO "train_services_runs_mask_not_null";
ALTER TABLE "train"
    RENAME CONSTRAINT "train_train_name_not_null"
    TO "train_services_train_name_not_null";
ALTER TABLE "train"
    RENAME CONSTRAINT "train_train_number_not_null"
    TO "train_services_train_number_not_null";
ALTER TABLE "train"
    RENAME CONSTRAINT "train_updated_not_null"
    TO "train_services_updated_at_not_null";

ALTER TABLE "train_stops"
    RENAME CONSTRAINT "train_stops_created_not_null"
    TO "train_stops_created_at_not_null";
ALTER TABLE "train_stops"
    RENAME CONSTRAINT "train_stops_updated_not_null"
    TO "train_stops_updated_at_not_null";

ALTER TABLE "train_endpoints"
    RENAME CONSTRAINT "train_endpoints_created_not_null"
    TO "train_endpoints_created_at_not_null";
ALTER TABLE "train_endpoints"
    RENAME CONSTRAINT "train_endpoints_updated_not_null"
    TO "train_endpoints_updated_at_not_null";

ALTER TABLE "railway_track"
    RENAME CONSTRAINT "railway_track_pkey"
    TO "indian_railways_pkey";
ALTER TABLE "railway_track"
    RENAME CONSTRAINT "railway_track_source_feature_id_key"
    TO "indian_railways_feature_id_key";
ALTER TABLE "railway_track"
    RENAME CONSTRAINT "railway_track_id_not_null"
    TO "indian_railways_railway_id_not_null";
ALTER TABLE "railway_track"
    RENAME CONSTRAINT "railway_track_source_feature_id_not_null"
    TO "indian_railways_feature_id_not_null";
ALTER TABLE "railway_track"
    RENAME CONSTRAINT "railway_track_geom_not_null"
    TO "indian_railways_geometry_not_null";
ALTER TABLE "railway_track"
    RENAME CONSTRAINT "railway_track_created_not_null"
    TO "indian_railways_created_at_not_null";

ALTER TABLE "railway_station" ADD COLUMN "station_name_hi" TEXT;

UPDATE "railway_station" AS station
SET "station_name_hi" = archive."name_hi"
FROM "railway_station_name_archive" AS archive
WHERE archive."station_id" = station."id";

DROP TABLE "railway_station_name_archive";

ALTER TABLE "railway_station" RENAME COLUMN "created" TO "created_at";
ALTER TABLE "railway_station" RENAME COLUMN "updated" TO "updated_at";

ALTER TABLE "train" RENAME COLUMN "created" TO "created_at";
ALTER TABLE "train" RENAME COLUMN "updated" TO "updated_at";

ALTER TABLE "train_stops" RENAME COLUMN "created" TO "created_at";
ALTER TABLE "train_stops" RENAME COLUMN "updated" TO "updated_at";

ALTER TABLE "train_endpoints" RENAME COLUMN "created" TO "created_at";
ALTER TABLE "train_endpoints" RENAME COLUMN "updated" TO "updated_at";

ALTER TABLE "railway_track" RENAME COLUMN "id" TO "railway_id";
ALTER TABLE "railway_track" RENAME COLUMN "source_feature_id" TO "feature_id";
ALTER TABLE "railway_track" RENAME COLUMN "track_gauge" TO "railway_gauge";
ALTER TABLE "railway_track" RENAME COLUMN "state" TO "state_name";
ALTER TABLE "railway_track" RENAME COLUMN "city" TO "city_name";
ALTER TABLE "railway_track" RENAME COLUMN "source_length" TO "shape_length";
ALTER TABLE "railway_track" RENAME COLUMN "geom" TO "geometry";
ALTER TABLE "railway_track" RENAME COLUMN "created" TO "created_at";

ALTER TABLE "railway_station" RENAME TO "railway_stations";
ALTER TABLE "train" RENAME TO "train_services";
ALTER TABLE "railway_track" RENAME TO "indian_railways";

ALTER SEQUENCE IF EXISTS "railway_station_id_seq"
    RENAME TO "railway_stations_id_seq";
ALTER SEQUENCE IF EXISTS "train_id_seq"
    RENAME TO "train_services_id_seq";
ALTER SEQUENCE IF EXISTS "railway_track_id_seq"
    RENAME TO "indian_railways_railway_id_seq";
