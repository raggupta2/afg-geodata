ALTER TABLE "journey_routing_policies"
    ADD COLUMN "long_distance_road_speed_kph" DECIMAL(6,2) NOT NULL DEFAULT 60,
    ADD COLUMN "road_speed_distance_threshold_km" DECIMAL(6,2) NOT NULL DEFAULT 50;

ALTER TABLE "journey_routing_policies"
    DROP CONSTRAINT "journey_routing_policies_values_check";

ALTER TABLE "journey_routing_policies"
    ADD CONSTRAINT "journey_routing_policies_values_check" CHECK (
        "road_speed_kph" > 0 AND "road_detour_factor" >= 1
        AND "long_distance_road_speed_kph" > 0
        AND "road_speed_distance_threshold_km" >= 0
        AND "initial_rail_buffer_minutes" >= 0
        AND "initial_flight_buffer_minutes" >= 0
        AND "rail_to_rail_minutes" >= 0
        AND "same_airport_flight_transfer_minutes" >= 0
        AND "maximum_transfers" BETWEEN 0 AND 6
        AND "search_horizon_days" BETWEEN 1 AND 7
    );
