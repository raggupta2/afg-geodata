-- Aviation Edge is no longer a flight source. Remove its flight schedules and
-- schedule bookkeeping; flights now come only from the flight SQLite exports
-- (src/maintenance/import-flight-sqlite.ts). Airports and airlines are kept
-- because hubs, transfer links and railway search depend on them, but their
-- Aviation Edge provider IDs are cleared.

DELETE FROM "aviation_flight_instances"
WHERE "data_source" = 'AVIATION_EDGE';

DELETE FROM "aviation_schedule_coverage" coverage
WHERE NOT EXISTS (
    SELECT 1
    FROM "aviation_schedule_imports" import
    JOIN "aviation_airports" airport ON airport."iata_code" = import."source_airport_code"
    WHERE import."data_source" = 'FLIGHT_SQLITE'
      AND airport."id" = coverage."airport_id"
      AND import."service_date" = coverage."service_date"
);

DELETE FROM "aviation_schedule_imports"
WHERE "data_source" = 'AVIATION_EDGE';

UPDATE "aviation_airports"
SET "provider_airport_id" = NULL,
    "data_source" = 'FLIGHT_SQLITE',
    "updated_at" = CURRENT_TIMESTAMP
WHERE "data_source" = 'AVIATION_EDGE'
   OR "provider_airport_id" IS NOT NULL;

UPDATE "aviation_airlines"
SET "provider_airline_id" = NULL,
    "data_source" = 'FLIGHT_SQLITE',
    "updated_at" = CURRENT_TIMESTAMP
WHERE "data_source" = 'AVIATION_EDGE'
   OR "provider_airline_id" IS NOT NULL;
