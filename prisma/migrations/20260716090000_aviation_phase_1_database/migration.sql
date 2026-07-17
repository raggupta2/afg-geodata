CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Shared geographic reference data for aviation, railway, and future modules.
CREATE TABLE "countries" (
    "id" BIGSERIAL NOT NULL,
    "iso_code" CHAR(2) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "countries_iso_code_format_check"
        CHECK ("iso_code" = UPPER("iso_code") AND BTRIM("iso_code") ~ '^[A-Z]{2}$'),
    CONSTRAINT "countries_name_not_blank_check"
        CHECK (BTRIM("name") <> '')
);

CREATE UNIQUE INDEX "countries_iso_code_key" ON "countries"("iso_code");
CREATE INDEX "countries_name_idx" ON "countries"("name");

CREATE TABLE "regions" (
    "id" BIGSERIAL NOT NULL,
    "country_id" BIGINT NOT NULL,
    "iso_region" VARCHAR(10) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "regions_iso_region_format_check"
        CHECK ("iso_region" = UPPER("iso_region") AND BTRIM("iso_region") ~ '^[A-Z]{2}-[A-Z0-9]{1,7}$'),
    CONSTRAINT "regions_name_not_blank_check"
        CHECK (BTRIM("name") <> ''),
    CONSTRAINT "regions_country_id_fkey"
        FOREIGN KEY ("country_id") REFERENCES "countries"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "regions_iso_region_key" ON "regions"("iso_region");
CREATE UNIQUE INDEX "regions_id_country_id_key" ON "regions"("id", "country_id");
CREATE INDEX "regions_country_name_idx" ON "regions"("country_id", "name");

-- Preserve the current OSM airport records while making the table compatible
-- with OurAirports-style CSV imports.
ALTER TABLE "airports" ALTER COLUMN "osm_id" DROP NOT NULL;
ALTER TABLE "airports"
    ADD COLUMN "source_id" BIGINT,
    ADD COLUMN "ident" VARCHAR(20),
    ADD COLUMN "country_id" BIGINT,
    ADD COLUMN "region_id" BIGINT,
    ADD COLUMN "municipality" TEXT,
    ADD COLUMN "latitude" DECIMAL(10,7),
    ADD COLUMN "longitude" DECIMAL(10,7),
    ADD COLUMN "elevation_ft" INTEGER,
    ADD COLUMN "timezone" VARCHAR(100),
    ADD COLUMN "scheduled_service" BOOLEAN NOT NULL DEFAULT false;

-- Normalize countries already present in the legacy airport table.
INSERT INTO "countries" ("iso_code", "name")
SELECT
    UPPER(BTRIM("country_code")),
    COALESCE(
        MAX(NULLIF(BTRIM("country"), '')),
        UPPER(BTRIM("country_code"))
    )
FROM "airports"
WHERE BTRIM(COALESCE("country_code", '')) ~* '^[A-Z]{2}$'
GROUP BY UPPER(BTRIM("country_code"))
ON CONFLICT ("iso_code") DO NOTHING;

UPDATE "airports" AS a
SET "country_id" = c."id"
FROM "countries" AS c
WHERE c."iso_code" = UPPER(BTRIM(a."country_code"))
  AND a."country_id" IS NULL;

UPDATE "airports"
SET
    "latitude" = ROUND(ST_Y("geom"::geometry)::numeric, 7),
    "longitude" = ROUND(ST_X("geom"::geometry)::numeric, 7),
    "elevation_ft" = CASE
        WHEN "elevation_m" IS NULL THEN NULL
        ELSE ROUND("elevation_m" * 3.28084)
    END
WHERE "geom" IS NOT NULL;

ALTER TABLE "airports"
    ADD CONSTRAINT "airports_country_id_fkey"
        FOREIGN KEY ("country_id") REFERENCES "countries"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "airports_region_id_fkey"
        FOREIGN KEY ("region_id") REFERENCES "regions"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "airports_region_country_required_check"
        CHECK ("region_id" IS NULL OR "country_id" IS NOT NULL),
    ADD CONSTRAINT "airports_region_country_fkey"
        FOREIGN KEY ("region_id", "country_id")
        REFERENCES "regions"("id", "country_id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "airports_latitude_check"
        CHECK ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90),
    ADD CONSTRAINT "airports_longitude_check"
        CHECK ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180),
    ADD CONSTRAINT "airports_elevation_ft_check"
        CHECK ("elevation_ft" IS NULL OR "elevation_ft" BETWEEN -2000 AND 100000);

CREATE UNIQUE INDEX "airports_source_id_key" ON "airports"("source_id");
CREATE UNIQUE INDEX "airports_ident_unique"
    ON "airports"("ident") WHERE "ident" IS NOT NULL;
CREATE INDEX "airports_country_id_idx" ON "airports"("country_id");
CREATE INDEX "airports_region_id_idx" ON "airports"("region_id");
CREATE INDEX "airports_scheduled_service_idx"
    ON "airports"("scheduled_service") WHERE "scheduled_service" = true;
CREATE INDEX "airports_name_trgm_idx"
    ON "airports" USING GIN ("airport_name" gin_trgm_ops);

CREATE TABLE "runways" (
    "id" BIGSERIAL NOT NULL,
    "source_id" BIGINT,
    "airport_id" BIGINT NOT NULL,
    "length_ft" INTEGER,
    "width_ft" INTEGER,
    "surface" VARCHAR(100),
    "lighted" BOOLEAN NOT NULL DEFAULT false,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "le_ident" VARCHAR(20),
    "he_ident" VARCHAR(20),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "runways_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "runways_airport_id_fkey"
        FOREIGN KEY ("airport_id") REFERENCES "airports"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "runways_length_ft_check"
        CHECK ("length_ft" IS NULL OR "length_ft" > 0),
    CONSTRAINT "runways_width_ft_check"
        CHECK ("width_ft" IS NULL OR "width_ft" > 0)
);

CREATE UNIQUE INDEX "runways_source_id_key" ON "runways"("source_id");
CREATE INDEX "runways_airport_id_idx" ON "runways"("airport_id");

CREATE TABLE "airport_frequencies" (
    "id" BIGSERIAL NOT NULL,
    "source_id" BIGINT,
    "airport_id" BIGINT NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "description" TEXT,
    "frequency_mhz" DECIMAL(8,3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "airport_frequencies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "airport_frequencies_airport_id_fkey"
        FOREIGN KEY ("airport_id") REFERENCES "airports"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "airport_frequencies_type_not_blank_check"
        CHECK (BTRIM("type") <> ''),
    CONSTRAINT "airport_frequencies_frequency_check"
        CHECK ("frequency_mhz" > 0)
);

CREATE UNIQUE INDEX "airport_frequencies_source_id_key" ON "airport_frequencies"("source_id");
CREATE INDEX "airport_frequencies_airport_type_idx"
    ON "airport_frequencies"("airport_id", "type");

CREATE TABLE "navigation_aids" (
    "id" BIGSERIAL NOT NULL,
    "source_id" BIGINT,
    "ident" VARCHAR(20) NOT NULL,
    "name" TEXT NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "frequency" DECIMAL(12,3),
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "elevation" INTEGER,
    "geom" geography(Point,4326),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "navigation_aids_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "navigation_aids_ident_not_blank_check"
        CHECK (BTRIM("ident") <> ''),
    CONSTRAINT "navigation_aids_latitude_check"
        CHECK ("latitude" BETWEEN -90 AND 90),
    CONSTRAINT "navigation_aids_longitude_check"
        CHECK ("longitude" BETWEEN -180 AND 180),
    CONSTRAINT "navigation_aids_frequency_check"
        CHECK ("frequency" IS NULL OR "frequency" > 0)
);

CREATE UNIQUE INDEX "navigation_aids_source_id_key" ON "navigation_aids"("source_id");
CREATE INDEX "navigation_aids_ident_idx" ON "navigation_aids"("ident");
CREATE INDEX "navigation_aids_type_idx" ON "navigation_aids"("type");
CREATE INDEX "navigation_aids_geom_idx"
    ON "navigation_aids" USING GIST ("geom");

CREATE TABLE "airlines" (
    "id" BIGSERIAL NOT NULL,
    "iata_code" VARCHAR(3),
    "icao_code" VARCHAR(4),
    "name" VARCHAR(200) NOT NULL,
    "callsign" VARCHAR(100),
    "country_id" BIGINT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "airlines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "airlines_country_id_fkey"
        FOREIGN KEY ("country_id") REFERENCES "countries"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "airlines_name_not_blank_check"
        CHECK (BTRIM("name") <> ''),
    CONSTRAINT "airlines_iata_code_format_check"
        CHECK ("iata_code" IS NULL OR BTRIM("iata_code") ~ '^[A-Z0-9]{2,3}$'),
    CONSTRAINT "airlines_icao_code_format_check"
        CHECK ("icao_code" IS NULL OR BTRIM("icao_code") ~ '^[A-Z0-9]{3,4}$')
);

CREATE UNIQUE INDEX "airlines_iata_active_unique"
    ON "airlines"("iata_code") WHERE "iata_code" IS NOT NULL AND "active" = true;
CREATE UNIQUE INDEX "airlines_icao_active_unique"
    ON "airlines"("icao_code") WHERE "icao_code" IS NOT NULL AND "active" = true;
CREATE INDEX "airlines_country_active_idx" ON "airlines"("country_id", "active");
CREATE INDEX "airlines_name_idx" ON "airlines"("name");

CREATE TABLE "flight_routes" (
    "id" BIGSERIAL NOT NULL,
    "airline_id" BIGINT NOT NULL,
    "source_airport_id" BIGINT NOT NULL,
    "destination_airport_id" BIGINT NOT NULL,
    "source_iata" VARCHAR(3),
    "destination_iata" VARCHAR(3),
    "source_icao" VARCHAR(4),
    "destination_icao" VARCHAR(4),
    "stops" SMALLINT NOT NULL DEFAULT 0,
    "codeshare" BOOLEAN NOT NULL DEFAULT false,
    "equipment" VARCHAR(100),
    "distance_km" DECIMAL(10,2),
    "duration_minutes" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flight_routes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "flight_routes_airline_id_fkey"
        FOREIGN KEY ("airline_id") REFERENCES "airlines"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "flight_routes_source_airport_id_fkey"
        FOREIGN KEY ("source_airport_id") REFERENCES "airports"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "flight_routes_destination_airport_id_fkey"
        FOREIGN KEY ("destination_airport_id") REFERENCES "airports"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "flight_routes_different_airports_check"
        CHECK ("source_airport_id" <> "destination_airport_id"),
    CONSTRAINT "flight_routes_stops_check"
        CHECK ("stops" >= 0),
    CONSTRAINT "flight_routes_distance_km_check"
        CHECK ("distance_km" IS NULL OR "distance_km" > 0),
    CONSTRAINT "flight_routes_duration_minutes_check"
        CHECK ("duration_minutes" IS NULL OR "duration_minutes" > 0)
);

CREATE INDEX "flight_routes_source_destination_active_idx"
    ON "flight_routes"("source_airport_id", "destination_airport_id", "active");
CREATE INDEX "flight_routes_destination_source_active_idx"
    ON "flight_routes"("destination_airport_id", "source_airport_id", "active");
CREATE INDEX "flight_routes_airline_route_active_idx"
    ON "flight_routes"("airline_id", "source_airport_id", "destination_airport_id", "active");
CREATE INDEX "flight_routes_distance_idx" ON "flight_routes"("distance_km");

-- Prisma's @updatedAt covers Prisma writes. These triggers also cover COPY,
-- psql, ETL workers, and any other database client.
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    table_name TEXT;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'countries',
        'regions',
        'airports',
        'runways',
        'airport_frequencies',
        'navigation_aids',
        'airlines',
        'flight_routes'
    ]
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS %I ON %I',
            'update_' || table_name || '_updated_at',
            table_name
        );
        EXECUTE format(
            'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
            'update_' || table_name || '_updated_at',
            table_name
        );
    END LOOP;
END;
$$;
