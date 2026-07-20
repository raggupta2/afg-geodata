CREATE TABLE "train_services" (
    "id" BIGSERIAL NOT NULL,
    "train_number" VARCHAR(20) NOT NULL,
    "train_name" VARCHAR(200) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "train_services_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "train_services_number_not_blank_check"
        CHECK (BTRIM("train_number") <> ''),
    CONSTRAINT "train_services_name_not_blank_check"
        CHECK (BTRIM("train_name") <> '')
);

CREATE TABLE "train_stops" (
    "id" BIGSERIAL NOT NULL,
    "train_id" BIGINT NOT NULL,
    "station_id" BIGINT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "arrival_time" TIME(0),
    "departure_time" TIME(0),
    "day_offset" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "train_stops_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "train_stops_sequence_positive_check" CHECK ("sequence" > 0),
    CONSTRAINT "train_stops_day_offset_nonnegative_check" CHECK ("day_offset" >= 0),
    CONSTRAINT "train_stops_time_present_check"
        CHECK ("arrival_time" IS NOT NULL OR "departure_time" IS NOT NULL)
);

CREATE UNIQUE INDEX "train_services_train_number_key"
    ON "train_services" ("train_number");
CREATE INDEX "train_services_active_idx"
    ON "train_services" ("active");

CREATE UNIQUE INDEX "train_stops_train_sequence_key"
    ON "train_stops" ("train_id", "sequence");
CREATE INDEX "train_stops_station_train_sequence_idx"
    ON "train_stops" ("station_id", "train_id", "sequence");
CREATE INDEX "train_stops_train_station_sequence_idx"
    ON "train_stops" ("train_id", "station_id", "sequence");

ALTER TABLE "train_stops"
    ADD CONSTRAINT "train_stops_train_id_fkey"
    FOREIGN KEY ("train_id") REFERENCES "train_services"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "train_stops"
    ADD CONSTRAINT "train_stops_station_id_fkey"
    FOREIGN KEY ("station_id") REFERENCES "railway_stations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
