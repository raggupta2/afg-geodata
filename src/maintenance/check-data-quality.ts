import "dotenv/config";
import { prisma } from "../config/database";

type DuplicateSummary = {
    duplicate_groups: number;
    extra_records: number;
    scheduled_duplicate_groups: number;
};

type CriticalSummary = {
    missing_route_durations: number;
    invalid_route_airport_references: number;
    invalid_schedule_airport_references: number;
};

type DuplicateExample = {
    normalized_name: string;
    latitude: string;
    longitude: string;
    record_count: number;
    airport_ids: string[];
};

const runChecks = async () => {
    const duplicates = await prisma.$queryRawUnsafe<DuplicateSummary[]>(`
        WITH normalized_airports AS (
            SELECT
                id,
                scheduled_service,
                LOWER(BTRIM(
                    REPLACE(REPLACE(REPLACE(REPLACE(
                        airport_name,
                        '[Duplicate]', ''),
                        '[duplicate]', ''),
                        '(Duplicate)', ''),
                        '(duplicate)', '')
                )) AS normalized_name,
                ROUND(ST_Y(geom::geometry)::NUMERIC, 6) AS latitude,
                ROUND(ST_X(geom::geometry)::NUMERIC, 6) AS longitude
            FROM airports
            WHERE geom IS NOT NULL
        ), duplicate_groups AS (
            SELECT
                normalized_name,
                latitude,
                longitude,
                COUNT(*)::INTEGER AS record_count,
                BOOL_OR(scheduled_service) AS has_scheduled_service
            FROM normalized_airports
            GROUP BY normalized_name, latitude, longitude
            HAVING COUNT(*) > 1
        )
        SELECT
            COUNT(*)::INTEGER AS duplicate_groups,
            COALESCE(SUM(record_count - 1), 0)::INTEGER AS extra_records,
            COUNT(*) FILTER (WHERE has_scheduled_service)::INTEGER
                AS scheduled_duplicate_groups
        FROM duplicate_groups
    `);

    const duplicateExamples = await prisma.$queryRawUnsafe<DuplicateExample[]>(`
        WITH normalized_airports AS (
            SELECT
                id,
                LOWER(BTRIM(
                    REPLACE(REPLACE(REPLACE(REPLACE(
                        airport_name,
                        '[Duplicate]', ''),
                        '[duplicate]', ''),
                        '(Duplicate)', ''),
                        '(duplicate)', '')
                )) AS normalized_name,
                ROUND(ST_Y(geom::geometry)::NUMERIC, 6) AS latitude,
                ROUND(ST_X(geom::geometry)::NUMERIC, 6) AS longitude
            FROM airports
            WHERE geom IS NOT NULL
        )
        SELECT
            normalized_name,
            latitude::TEXT,
            longitude::TEXT,
            COUNT(*)::INTEGER AS record_count,
            ARRAY_AGG(id::TEXT ORDER BY id) AS airport_ids
        FROM normalized_airports
        GROUP BY normalized_name, latitude, longitude
        HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC, normalized_name
        LIMIT 10
    `);

    const critical = await prisma.$queryRawUnsafe<CriticalSummary[]>(`
        SELECT
            (
                SELECT COUNT(*)::INTEGER
                FROM flight_routes AS route
                JOIN airports AS source_airport
                  ON source_airport.id = route.source_airport_id
                JOIN airports AS destination_airport
                  ON destination_airport.id = route.destination_airport_id
                WHERE route.active
                  AND source_airport.geom IS NOT NULL
                  AND destination_airport.geom IS NOT NULL
                  AND (
                      route.duration_minutes IS NULL
                      OR route.duration_source IS NULL
                  )
            ) AS missing_route_durations,
            (
                SELECT COUNT(*)::INTEGER
                FROM flight_routes AS route
                LEFT JOIN airports AS source_airport
                  ON source_airport.id = route.source_airport_id
                LEFT JOIN airports AS destination_airport
                  ON destination_airport.id = route.destination_airport_id
                WHERE source_airport.id IS NULL
                   OR destination_airport.id IS NULL
            ) AS invalid_route_airport_references,
            (
                SELECT COUNT(*)::INTEGER
                FROM flight_schedules AS schedule
                WHERE NOT EXISTS (
                    SELECT 1 FROM airports
                    WHERE BTRIM(iata_code) = BTRIM(schedule.departure_airport)
                )
                   OR NOT EXISTS (
                    SELECT 1 FROM airports
                    WHERE BTRIM(iata_code) = BTRIM(schedule.arrival_airport)
                )
            ) AS invalid_schedule_airport_references
    `);

    const report = {
        duplicateAirports: duplicates[0],
        duplicateExamples,
        critical: critical[0]
    };
    console.log(JSON.stringify(report, null, 2));

    const criticalFailureCount =
        report.critical.missing_route_durations +
        report.critical.invalid_route_airport_references +
        report.critical.invalid_schedule_airport_references;

    if (criticalFailureCount > 0) {
        throw new Error(`${criticalFailureCount} critical data-quality violations found.`);
    }

    if (report.duplicateAirports.duplicate_groups > 0) {
        console.warn(
            "Potential duplicate airports remain; review the reported coordinate/name groups."
        );
    }
};

runChecks()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
