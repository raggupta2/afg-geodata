ALTER TABLE "flight_routes"
    ADD COLUMN "flight_number" VARCHAR(12);

ALTER TABLE "flight_routes"
    ADD CONSTRAINT "flight_routes_flight_number_not_blank_check"
        CHECK ("flight_number" IS NULL OR BTRIM("flight_number") <> '');
