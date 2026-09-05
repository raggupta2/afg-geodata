CREATE INDEX IF NOT EXISTS "aviation_flights_active_departure_route_idx"
    ON "aviation_flight_instances" (
        "departure_at",
        "departure_airport_id",
        "arrival_airport_id",
        "id"
    )
    WHERE "active" = TRUE;

CREATE INDEX IF NOT EXISTS "aviation_flights_active_airport_departure_idx"
    ON "aviation_flight_instances" (
        "departure_airport_id",
        "departure_at",
        "id"
    )
    WHERE "active" = TRUE;

CREATE INDEX IF NOT EXISTS "aviation_airlines_service_type_id_idx"
    ON "aviation_airlines" ("service_type", "id");

CREATE INDEX IF NOT EXISTS "hub_transfer_links_active_nearest_idx"
    ON "hub_transfer_links" (
        "from_hub_id",
        "aerial_distance_km",
        "id"
    )
    WHERE "active" = TRUE;
