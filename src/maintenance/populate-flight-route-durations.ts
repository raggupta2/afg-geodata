import "dotenv/config";
import { prisma } from "../config/database";

type DurationCoverageRow = {
    usable_routes: number;
    missing_durations: number;
    manual: number;
    schedule: number;
    distance_estimate: number;
};

const populateFlightRouteDurations = async () =>
    prisma.$transaction(async transaction => {
        const markedManual = await transaction.$executeRawUnsafe(`
            UPDATE flight_routes
            SET duration_source = 'MANUAL'::"FlightDurationSource"
            WHERE duration_minutes IS NOT NULL
              AND duration_source IS NULL
        `);

        const distancesCalculated = await transaction.$executeRawUnsafe(`
            UPDATE flight_routes AS route
            SET distance_km = ROUND(
                (ST_Distance(source_airport.geom, destination_airport.geom) / 1000.0)::NUMERIC,
                2
            )
            FROM airports AS source_airport, airports AS destination_airport
            WHERE source_airport.id = route.source_airport_id
              AND destination_airport.id = route.destination_airport_id
              AND source_airport.geom IS NOT NULL
              AND destination_airport.geom IS NOT NULL
              AND route.distance_km IS NULL
        `);

        const schedulesApplied = await transaction.$executeRawUnsafe(`
            WITH scheduled_durations AS (
                SELECT
                    route.id AS route_id,
                    ROUND(AVG(
                        EXTRACT(EPOCH FROM (schedule.arrival_time - schedule.departure_time)) / 60.0
                    ))::INTEGER AS duration_minutes
                FROM flight_routes AS route
                JOIN airlines AS airline ON airline.id = route.airline_id
                JOIN airports AS source_airport ON source_airport.id = route.source_airport_id
                JOIN airports AS destination_airport ON destination_airport.id = route.destination_airport_id
                JOIN flight_schedules AS schedule
                  ON BTRIM(schedule.airline_code) = BTRIM(airline.iata_code)
                 AND (
                     route.flight_number IS NULL
                     OR BTRIM(schedule.flight_number) = BTRIM(route.flight_number)
                     OR BTRIM(schedule.flight_number) = CONCAT(
                         BTRIM(schedule.airline_code),
                         BTRIM(route.flight_number)
                     )
                 )
                 AND BTRIM(schedule.departure_airport) = BTRIM(
                     COALESCE(route.source_iata, source_airport.iata_code)
                 )
                 AND BTRIM(schedule.arrival_airport) = BTRIM(
                     COALESCE(route.destination_iata, destination_airport.iata_code)
                 )
                WHERE route.duration_source IS DISTINCT FROM 'MANUAL'::"FlightDurationSource"
                GROUP BY route.id
            )
            UPDATE flight_routes AS route
            SET
                duration_minutes = scheduled.duration_minutes,
                duration_source = 'SCHEDULE'::"FlightDurationSource"
            FROM scheduled_durations AS scheduled
            WHERE scheduled.route_id = route.id
              AND scheduled.duration_minutes > 0
        `);

        const estimatesApplied = await transaction.$executeRawUnsafe(`
            UPDATE flight_routes
            SET
                duration_minutes = estimate_flight_duration_minutes(distance_km),
                duration_source = 'DISTANCE_ESTIMATE'::"FlightDurationSource"
            WHERE duration_minutes IS NULL
              AND distance_km IS NOT NULL
        `);

        const coverage = await transaction.$queryRawUnsafe<DurationCoverageRow[]>(`
            SELECT
                COUNT(*) FILTER (
                    WHERE route.active
                      AND source_airport.geom IS NOT NULL
                      AND destination_airport.geom IS NOT NULL
                )::INTEGER AS usable_routes,
                COUNT(*) FILTER (
                    WHERE route.active
                      AND source_airport.geom IS NOT NULL
                      AND destination_airport.geom IS NOT NULL
                      AND route.duration_minutes IS NULL
                )::INTEGER AS missing_durations,
                COUNT(*) FILTER (WHERE duration_source = 'MANUAL')::INTEGER AS manual,
                COUNT(*) FILTER (WHERE duration_source = 'SCHEDULE')::INTEGER AS schedule,
                COUNT(*) FILTER (
                    WHERE duration_source = 'DISTANCE_ESTIMATE'
                )::INTEGER AS distance_estimate
            FROM flight_routes AS route
            JOIN airports AS source_airport ON source_airport.id = route.source_airport_id
            JOIN airports AS destination_airport ON destination_airport.id = route.destination_airport_id
        `);

        return {
            markedManual,
            distancesCalculated,
            schedulesApplied,
            estimatesApplied,
            coverage: coverage[0]
        };
    });

populateFlightRouteDurations()
    .then(result => {
        console.log(JSON.stringify(result, null, 2));
        if (result.coverage.missing_durations > 0) {
            throw new Error(
                `${result.coverage.missing_durations} usable flight routes still have no duration.`
            );
        }
    })
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
