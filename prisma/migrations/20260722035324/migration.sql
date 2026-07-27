-- DropForeignKey
ALTER TABLE "airports" DROP CONSTRAINT "airports_region_country_fkey";

-- DropIndex
DROP INDEX "airports_geom_idx";

-- DropIndex
DROP INDEX "airports_name_trgm_idx";

-- CreateTable
CREATE TABLE "flight_schedule_templates" (
    "id" BIGINT,
    "airline_code" CHAR(2),
    "airline_name" TEXT,
    "flight_number" VARCHAR(8),
    "departure_airport" CHAR(3),
    "arrival_airport" CHAR(3),
    "departure_terminal" VARCHAR(5),
    "arrival_terminal" VARCHAR(5),
    "departure_time" TIMESTAMPTZ(6),
    "arrival_time" TIMESTAMPTZ(6),
    "aircraft_type" VARCHAR(20),
    "frequency" VARCHAR(20),
    "status" VARCHAR(20),
    "created_at" TIMESTAMP(3)
);
