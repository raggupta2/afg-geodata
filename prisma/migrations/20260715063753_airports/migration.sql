CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE "airports" (
    "id" BIGSERIAL NOT NULL,
    "osm_id" BIGINT NOT NULL,
    "osm_type" VARCHAR(20),
    "airport_name" TEXT NOT NULL,
    "iata_code" VARCHAR(10),
    "icao_code" VARCHAR(10),
    "airport_type" VARCHAR(100),
    "airport_class" VARCHAR(50),
    "city" TEXT,
    "country" TEXT,
    "country_code" CHAR(2),
    "region" TEXT,
    "operator" TEXT,
    "operator_type" VARCHAR(50),
    "owner" TEXT,
    "elevation_m" INTEGER,
    "geom" geography(Point,4326),

    -- merged columns
    "alt_name" TEXT,
    "short_name" TEXT,
    "int_name" TEXT,
    "image" TEXT,
    "ref" VARCHAR(10),

    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "airports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "airports_city_idx" ON "airports"("city");
CREATE INDEX "airports_country_idx" ON "airports"("country_code");

CREATE UNIQUE INDEX "airports_osm_unique"
ON "airports"("osm_id", "osm_type");

CREATE UNIQUE INDEX "airports_iata_code_unique"
ON "airports"("iata_code")
WHERE "iata_code" IS NOT NULL;

CREATE UNIQUE INDEX "airports_icao_code_unique"
ON "airports"("icao_code")
WHERE "icao_code" IS NOT NULL;

CREATE INDEX "airports_geom_idx"
ON "airports" USING GIST ("geom");

CREATE INDEX "airports_name_search_idx"
ON "airports"
USING GIN (to_tsvector('english', "airport_name"));


CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_airports_updated_at
BEFORE UPDATE ON "airports"
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();