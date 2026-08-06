-- Additive phase-one multimodal schema. Existing railway tables are retained.

CREATE TABLE "transport_cities" (
    "id" BIGSERIAL PRIMARY KEY,
    "provider_city_id" BIGINT,
    "iata_code" VARCHAR(3) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "country_code" CHAR(2) NOT NULL DEFAULT 'IN',
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "timezone" VARCHAR(100) NOT NULL DEFAULT 'Asia/Kolkata',
    "geom" geography(Point,4326),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transport_cities_country_check" CHECK ("country_code" = 'IN')
);

CREATE UNIQUE INDEX "transport_cities_provider_city_id_key" ON "transport_cities"("provider_city_id");
CREATE UNIQUE INDEX "transport_cities_iata_code_key" ON "transport_cities"("iata_code");
CREATE INDEX "transport_cities_geom_idx" ON "transport_cities" USING GIST ("geom");

CREATE TABLE "transport_hubs" (
    "id" BIGSERIAL PRIMARY KEY,
    "city_id" BIGINT,
    "hub_type" VARCHAR(20) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "timezone" VARCHAR(100) NOT NULL DEFAULT 'Asia/Kolkata',
    "geom" geography(Point,4326),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transport_hubs_city_id_fkey" FOREIGN KEY ("city_id")
        REFERENCES "transport_cities"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "transport_hubs_type_check" CHECK ("hub_type" IN ('RAILWAY_STATION', 'AIRPORT'))
);

CREATE UNIQUE INDEX "transport_hubs_type_code_key" ON "transport_hubs"("hub_type", "code");
CREATE INDEX "transport_hubs_city_type_active_idx" ON "transport_hubs"("city_id", "hub_type", "active");
CREATE INDEX "transport_hubs_geom_idx" ON "transport_hubs" USING GIST ("geom");

CREATE TABLE "railway_station_hubs" (
    "station_id" BIGINT PRIMARY KEY,
    "hub_id" BIGINT NOT NULL,
    "mapping_method" VARCHAR(40) NOT NULL DEFAULT 'RAILWAY_BACKFILL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "railway_station_hubs_station_id_fkey" FOREIGN KEY ("station_id")
        REFERENCES "railway_station"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "railway_station_hubs_hub_id_fkey" FOREIGN KEY ("hub_id")
        REFERENCES "transport_hubs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "railway_station_hubs_hub_id_key" ON "railway_station_hubs"("hub_id");

CREATE TABLE "aviation_airports" (
    "id" BIGSERIAL PRIMARY KEY,
    "provider_airport_id" BIGINT NOT NULL,
    "hub_id" BIGINT NOT NULL,
    "iata_code" VARCHAR(3) NOT NULL,
    "icao_code" VARCHAR(4),
    "city_iata_code" VARCHAR(3),
    "country_code" CHAR(2) NOT NULL DEFAULT 'IN',
    "geoname_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "aviation_airports_hub_id_fkey" FOREIGN KEY ("hub_id")
        REFERENCES "transport_hubs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "aviation_airports_country_check" CHECK ("country_code" = 'IN')
);
CREATE UNIQUE INDEX "aviation_airports_provider_airport_id_key" ON "aviation_airports"("provider_airport_id");
CREATE UNIQUE INDEX "aviation_airports_hub_id_key" ON "aviation_airports"("hub_id");
CREATE UNIQUE INDEX "aviation_airports_iata_code_key" ON "aviation_airports"("iata_code");
CREATE INDEX "aviation_airports_country_iata_idx" ON "aviation_airports"("country_code", "iata_code");

CREATE TABLE "aviation_airlines" (
    "id" BIGSERIAL PRIMARY KEY,
    "provider_airline_id" BIGINT NOT NULL,
    "iata_code" VARCHAR(3),
    "icao_code" VARCHAR(4),
    "name" VARCHAR(200) NOT NULL,
    "callsign" VARCHAR(100),
    "country_code" CHAR(2) NOT NULL DEFAULT 'IN',
    "provider_status" VARCHAR(30),
    "service_type" VARCHAR(30),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "aviation_airlines_country_check" CHECK ("country_code" = 'IN')
);
CREATE UNIQUE INDEX "aviation_airlines_provider_airline_id_key" ON "aviation_airlines"("provider_airline_id");
CREATE INDEX "aviation_airlines_iata_idx" ON "aviation_airlines"("iata_code");
CREATE INDEX "aviation_airlines_icao_idx" ON "aviation_airlines"("icao_code");

CREATE TABLE "aviation_schedule_imports" (
    "id" BIGSERIAL PRIMARY KEY,
    "source_file" TEXT NOT NULL,
    "checksum" CHAR(64) NOT NULL,
    "source_airport_code" VARCHAR(3) NOT NULL,
    "service_date" DATE NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "accepted_rows" INTEGER NOT NULL DEFAULT 0,
    "codeshare_rows" INTEGER NOT NULL DEFAULT 0,
    "international_rows" INTEGER NOT NULL DEFAULT 0,
    "unknown_airport_rows" INTEGER NOT NULL DEFAULT 0,
    "invalid_rows" INTEGER NOT NULL DEFAULT 0,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "aviation_schedule_imports_file_key" ON "aviation_schedule_imports"("source_airport_code", "service_date", "checksum");
CREATE INDEX "aviation_schedule_imports_date_status_idx" ON "aviation_schedule_imports"("service_date", "status");

CREATE TABLE "aviation_schedule_coverage" (
    "id" BIGSERIAL PRIMARY KEY,
    "airport_id" BIGINT NOT NULL,
    "service_date" DATE NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "detail" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "aviation_schedule_coverage_airport_id_fkey" FOREIGN KEY ("airport_id")
        REFERENCES "aviation_airports"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "aviation_schedule_coverage_airport_date_key" ON "aviation_schedule_coverage"("airport_id", "service_date");
CREATE INDEX "aviation_schedule_coverage_date_status_idx" ON "aviation_schedule_coverage"("service_date", "status");

CREATE TABLE "aviation_flight_instances" (
    "id" BIGSERIAL PRIMARY KEY,
    "identity_key" VARCHAR(160) NOT NULL,
    "airline_id" BIGINT,
    "departure_airport_id" BIGINT NOT NULL,
    "arrival_airport_id" BIGINT NOT NULL,
    "service_date" DATE NOT NULL,
    "airline_iata_code" VARCHAR(3),
    "airline_icao_code" VARCHAR(4),
    "flight_number" VARCHAR(16) NOT NULL,
    "flight_iata_number" VARCHAR(16),
    "flight_icao_number" VARCHAR(20),
    "departure_at" TIMESTAMPTZ(6) NOT NULL,
    "arrival_at" TIMESTAMPTZ(6) NOT NULL,
    "departure_terminal" VARCHAR(10),
    "arrival_terminal" VARCHAR(10),
    "departure_gate" VARCHAR(10),
    "arrival_gate" VARCHAR(10),
    "aircraft_model_code" VARCHAR(20),
    "aircraft_model_text" VARCHAR(100),
    "status" VARCHAR(30),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "aviation_flight_instances_airline_id_fkey" FOREIGN KEY ("airline_id")
        REFERENCES "aviation_airlines"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "aviation_flight_instances_departure_airport_id_fkey" FOREIGN KEY ("departure_airport_id")
        REFERENCES "aviation_airports"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "aviation_flight_instances_arrival_airport_id_fkey" FOREIGN KEY ("arrival_airport_id")
        REFERENCES "aviation_airports"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "aviation_flight_instances_airports_different_check" CHECK ("departure_airport_id" <> "arrival_airport_id"),
    CONSTRAINT "aviation_flight_instances_time_check" CHECK ("arrival_at" > "departure_at")
);
CREATE UNIQUE INDEX "aviation_flight_instances_identity_key" ON "aviation_flight_instances"("identity_key");
CREATE INDEX "aviation_flights_departure_lookup_idx" ON "aviation_flight_instances"("departure_airport_id", "departure_at", "active");
CREATE INDEX "aviation_flights_arrival_lookup_idx" ON "aviation_flight_instances"("arrival_airport_id", "arrival_at", "active");
CREATE INDEX "aviation_flights_service_date_idx" ON "aviation_flight_instances"("service_date", "active");

CREATE TABLE "hub_transfer_links" (
    "id" BIGSERIAL PRIMARY KEY,
    "from_hub_id" BIGINT NOT NULL,
    "to_hub_id" BIGINT NOT NULL,
    "aerial_distance_km" DECIMAL(10,2) NOT NULL,
    "estimated_road_distance_km" DECIMAL(10,2) NOT NULL,
    "travel_minutes" INTEGER NOT NULL,
    "average_speed_kph" DECIMAL(6,2) NOT NULL,
    "detour_factor" DECIMAL(5,2) NOT NULL,
    "method" VARCHAR(50) NOT NULL DEFAULT 'AERIAL_DISTANCE_DETOUR_FACTOR',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "hub_transfer_links_from_hub_id_fkey" FOREIGN KEY ("from_hub_id")
        REFERENCES "transport_hubs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "hub_transfer_links_to_hub_id_fkey" FOREIGN KEY ("to_hub_id")
        REFERENCES "transport_hubs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "hub_transfer_links_different_hubs_check" CHECK ("from_hub_id" <> "to_hub_id"),
    CONSTRAINT "hub_transfer_links_positive_check" CHECK ("travel_minutes" > 0 AND "average_speed_kph" > 0 AND "detour_factor" >= 1)
);
CREATE UNIQUE INDEX "hub_transfer_links_pair_key" ON "hub_transfer_links"("from_hub_id", "to_hub_id");
CREATE INDEX "hub_transfer_links_from_active_idx" ON "hub_transfer_links"("from_hub_id", "active");

CREATE TABLE "journey_routing_policies" (
    "id" INTEGER PRIMARY KEY DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "road_speed_kph" DECIMAL(6,2) NOT NULL DEFAULT 30,
    "road_detour_factor" DECIMAL(5,2) NOT NULL DEFAULT 1.5,
    "initial_rail_buffer_minutes" INTEGER NOT NULL DEFAULT 30,
    "initial_flight_buffer_minutes" INTEGER NOT NULL DEFAULT 30,
    "rail_to_rail_minutes" INTEGER NOT NULL DEFAULT 10,
    "rail_to_flight_buffer_minutes" INTEGER NOT NULL DEFAULT 0,
    "flight_to_rail_exit_minutes" INTEGER NOT NULL DEFAULT 0,
    "flight_to_rail_buffer_minutes" INTEGER NOT NULL DEFAULT 0,
    "same_airport_flight_transfer_minutes" INTEGER NOT NULL DEFAULT 30,
    "maximum_transfers" INTEGER NOT NULL DEFAULT 3,
    "search_horizon_days" INTEGER NOT NULL DEFAULT 3,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "journey_routing_policies_values_check" CHECK (
        "road_speed_kph" > 0 AND "road_detour_factor" >= 1
        AND "initial_rail_buffer_minutes" >= 0
        AND "initial_flight_buffer_minutes" >= 0
        AND "rail_to_rail_minutes" >= 0
        AND "same_airport_flight_transfer_minutes" >= 0
        AND "maximum_transfers" BETWEEN 0 AND 6
        AND "search_horizon_days" BETWEEN 1 AND 7
    )
);

INSERT INTO "journey_routing_policies" ("id") VALUES (1);

INSERT INTO "transport_hubs" (
    "hub_type", "code", "name", "latitude", "longitude", "geom"
)
SELECT
    'RAILWAY_STATION',
    UPPER(BTRIM(station."station_code")),
    station."station_name",
    ST_Y(station."geom"),
    ST_X(station."geom"),
    station."geom"::geography
FROM "railway_station" station
WHERE station."station_code" IS NOT NULL
  AND station."geom" IS NOT NULL
ON CONFLICT ("hub_type", "code") DO NOTHING;

INSERT INTO "railway_station_hubs" ("station_id", "hub_id")
SELECT station."id", hub."id"
FROM "railway_station" station
JOIN "transport_hubs" hub
  ON hub."hub_type" = 'RAILWAY_STATION'
 AND hub."code" = UPPER(BTRIM(station."station_code"))
ON CONFLICT ("station_id") DO NOTHING;
