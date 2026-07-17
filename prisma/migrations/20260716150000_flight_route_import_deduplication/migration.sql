-- Keep the oldest row when legacy/static data already contains exact
-- duplicates. Flight-numbered or enriched distance/duration records are not
-- touched by this importer-specific cleanup.
DELETE FROM "flight_routes" AS duplicate
USING "flight_routes" AS canonical
WHERE duplicate."id" > canonical."id"
  AND duplicate."active" = true
  AND canonical."active" = true
  AND duplicate."flight_number" IS NULL
  AND canonical."flight_number" IS NULL
  AND duplicate."distance_km" IS NULL
  AND canonical."distance_km" IS NULL
  AND duplicate."duration_minutes" IS NULL
  AND canonical."duration_minutes" IS NULL
  AND duplicate."airline_id" = canonical."airline_id"
  AND duplicate."source_airport_id" = canonical."source_airport_id"
  AND duplicate."destination_airport_id" = canonical."destination_airport_id"
  AND duplicate."codeshare" = canonical."codeshare"
  AND duplicate."stops" = canonical."stops"
  AND duplicate."equipment" IS NOT DISTINCT FROM canonical."equipment";

CREATE UNIQUE INDEX "flight_routes_static_route_unique_idx"
    ON "flight_routes" (
        "airline_id",
        "source_airport_id",
        "destination_airport_id",
        "codeshare",
        "stops",
        (COALESCE("equipment", ''))
    )
    WHERE "active" = true
      AND "flight_number" IS NULL
      AND "distance_km" IS NULL
      AND "duration_minutes" IS NULL;
