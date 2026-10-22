import "dotenv/config";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import initSqlJs, { type Database } from "sql.js";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import { linkAirportHubs, refreshGeographyAndTransfers } from "./transport-hub-links";

// Imports flights from the project's own flight SQLite export (one file per
// collection run) into aviation_flight_instances. Re-running with a newer
// export updates the same rows: flights are matched by identity key, flights
// missing from a re-collected route and date are deactivated (never deleted),
// and every fare observation is kept for future pricing.

type ImportOptions = {
    file: string;
    force: boolean;
    dryRun: boolean;
    refreshAllTransferLinks: boolean;
};

type SqliteValue = string | number | bigint | null;
type SqliteRow = Record<string, SqliteValue>;

type SourceAirport = {
    iataCode: string;
    name: string;
    latitude: number;
    longitude: number;
    timezone: string;
};

type SourceFlight = {
    sqliteId: number;
    provider: string;
    sourceRecordId: string | null;
    originCode: string | null;
    destinationCode: string | null;
    departureDate: string | null;
    airlineCode: string | null;
    airlineName: string | null;
    flightNumber: string | null;
    segmentOriginCode: string | null;
    segmentDestinationCode: string | null;
    departureLocal: string | null;
    departureUtc: string | null;
    arrivalUtc: string | null;
    aircraftType: string | null;
};

type SourceFare = {
    flightId: number;
    provider: string;
    fareFamily: string | null;
    cabinClass: string | null;
    baseFare: number | null;
    taxes: number | null;
    fees: number | null;
    totalPrice: number | null;
    currency: string | null;
    passengerCount: number | null;
    baggageDetails: string | null;
    cabinBaggage: string | null;
    refundability: string | null;
    changeCancelConditions: string | null;
    fareRules: string | null;
    bookingUrl: string | null;
    collectedAt: string | null;
};

type RowTally = {
    total: number;
    international: number;
    invalid: number;
};

type SourceData = {
    airports: SourceAirport[];
    flights: SourceFlight[];
    fares: SourceFare[];
    coveredRoutes: { originCode: string; destinationCode: string; serviceDate: string }[];
    tallies: Map<string, RowTally>;
};

type PreparedFlight = {
    identityKey: string;
    sqliteIds: number[];
    provider: string;
    sourceRecordId: string | null;
    originCode: string;
    destinationCode: string;
    serviceDate: string;
    airlineCode: string;
    airlineName: string | null;
    flightNumber: string;
    departureAt: Date;
    arrivalAt: Date;
    aircraftType: string | null;
};

const DATA_SOURCE = "FLIGHT_SQLITE";
const INDIA_TIMEZONE = "Asia/Kolkata";
const MINIMUM_FLIGHT_MINUTES = 15;
const MAXIMUM_FLIGHT_MINUTES = 12 * 60;
const TRANSACTION_TIMEOUT_MS = 10 * 60 * 1000;

const REQUIRED_COLUMNS: Record<string, string[]> = {
    providers: ["id", "name"],
    airports: ["iata_code", "name", "country_code", "latitude", "longitude", "timezone", "is_active"],
    search_sessions: ["provider_id", "origin_code", "destination_code", "departure_date", "collection_status"],
    flights: [
        "id", "provider_id", "source_record_id", "origin_code", "destination_code",
        "departure_date", "stops", "validation_status"
    ],
    flight_segments: [
        "flight_id", "segment_number", "airline_name", "airline_code", "flight_number",
        "origin_code", "destination_code", "departure_local", "departure_utc", "arrival_utc",
        "aircraft_type"
    ],
    fares: [
        "flight_id", "provider_id", "fare_family", "cabin_class", "base_fare", "taxes", "fees",
        "total_price", "currency", "passenger_count", "baggage_details", "cabin_baggage",
        "refundability", "change_cancel_conditions", "fare_rules", "booking_url", "collected_at"
    ]
};

function parseOptions(): ImportOptions {
    const values = new Map<string, string>();
    for (let index = 2; index < process.argv.length; index += 1) {
        const key = process.argv[index];
        const value = process.argv[index + 1];
        if (key.startsWith("--") && value && !value.startsWith("--")) {
            values.set(key.slice(2), value);
            index += 1;
        }
    }
    const file = values.get("file") ?? process.env.FLIGHT_SQLITE_FILE;
    if (!file) {
        throw new Error("Pass the flight SQLite export with --file <path> (or set FLIGHT_SQLITE_FILE).");
    }
    return {
        file: path.resolve(file),
        force: process.argv.includes("--force"),
        dryRun: process.argv.includes("--dry-run"),
        refreshAllTransferLinks: process.argv.includes("--refresh-all-transfer-links")
    };
}

function text(value: SqliteValue | undefined, maximum: number): string | null {
    if (value === null || value === undefined) return null;
    const result = String(value).trim();
    return result ? result.slice(0, maximum) : null;
}

function code(value: SqliteValue | undefined, maximum: number): string | null {
    return text(value, maximum)?.toUpperCase() ?? null;
}

function numberValue(value: SqliteValue | undefined): number | null {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function instant(value: string | null): Date | null {
    if (!value) return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function serviceDateValue(serviceDate: string): Date {
    return new Date(`${serviceDate}T00:00:00.000Z`);
}

function routeDateKey(originCode: string, destinationCode: string, serviceDate: string): string {
    return `${originCode}|${destinationCode}|${serviceDate}`;
}

function airportDateKey(airportCode: string, serviceDate: string): string {
    return `${airportCode}|${serviceDate}`;
}

function sha256Hex(data: string | Buffer): string {
    return createHash("sha256").update(data).digest("hex");
}

function queryAll(database: Database, sql: string): SqliteRow[] {
    const statement = database.prepare(sql);
    try {
        const rows: SqliteRow[] = [];
        while (statement.step()) rows.push(statement.getAsObject() as SqliteRow);
        return rows;
    } finally {
        statement.free();
    }
}

function validateSourceSchema(database: Database): void {
    const missing: string[] = [];
    for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
        const present = new Set(
            queryAll(database, `PRAGMA table_info(${table})`)
                .map(row => String(row.name))
        );
        if (present.size === 0) {
            missing.push(table);
            continue;
        }
        for (const column of columns) {
            if (!present.has(column)) missing.push(`${table}.${column}`);
        }
    }
    if (missing.length > 0) {
        throw new Error(`The flight SQLite export is missing: ${missing.join(", ")}`);
    }
}

// sql.js (WebAssembly) instead of node:sqlite so the importer runs on Node 20.
// It opens an in-memory copy of the export; the file itself is never written.
async function readSource(raw: Buffer): Promise<SourceData> {
    const SQL = await initSqlJs();
    const database = new SQL.Database(raw);
    try {
        validateSourceSchema(database);
        const airports = queryAll(database, `
            SELECT iata_code, name, latitude, longitude, timezone
            FROM airports
            WHERE country_code = 'IN' AND is_active = 1
        `).flatMap(row => {
            const iataCode = code(row.iata_code, 3);
            const name = text(row.name, 200);
            const latitude = numberValue(row.latitude);
            const longitude = numberValue(row.longitude);
            if (!iataCode || !name || latitude === null || longitude === null) return [];
            return [{
                iataCode,
                name,
                latitude,
                longitude,
                timezone: text(row.timezone, 100) ?? INDIA_TIMEZONE
            }];
        });

        // Accepted direct flights only.
        const flights = queryAll(database, `
            SELECT
                flight.id,
                provider.name AS provider,
                flight.source_record_id,
                flight.origin_code,
                flight.destination_code,
                flight.departure_date,
                segment.airline_code,
                segment.airline_name,
                segment.flight_number,
                segment.origin_code AS segment_origin_code,
                segment.destination_code AS segment_destination_code,
                segment.departure_local,
                segment.departure_utc,
                segment.arrival_utc,
                segment.aircraft_type
            FROM flights flight
            JOIN providers provider ON provider.id = flight.provider_id
            JOIN flight_segments segment
              ON segment.flight_id = flight.id
             AND segment.segment_number = 1
            WHERE flight.validation_status = 'ACCEPTED'
              AND flight.stops = 0
              AND NOT EXISTS (
                  SELECT 1 FROM flight_segments other
                  WHERE other.flight_id = flight.id AND other.segment_number > 1
              )
            ORDER BY flight.id
        `).map(row => ({
            sqliteId: Number(row.id),
            provider: text(row.provider, 50) ?? "UNKNOWN",
            sourceRecordId: text(row.source_record_id, 100),
            originCode: code(row.origin_code, 3),
            destinationCode: code(row.destination_code, 3),
            departureDate: text(row.departure_date, 10),
            airlineCode: code(row.airline_code, 3),
            airlineName: text(row.airline_name, 200),
            flightNumber: code(row.flight_number, 16),
            segmentOriginCode: code(row.segment_origin_code, 3),
            segmentDestinationCode: code(row.segment_destination_code, 3),
            departureLocal: text(row.departure_local, 40),
            departureUtc: text(row.departure_utc, 40),
            arrivalUtc: text(row.arrival_utc, 40),
            aircraftType: text(row.aircraft_type, 100)
        }));

        const fares = queryAll(database, `
            SELECT fare.*, provider.name AS provider
            FROM fares fare
            JOIN providers provider ON provider.id = fare.provider_id
            ORDER BY fare.id
        `).map(row => ({
            flightId: Number(row.flight_id),
            provider: text(row.provider, 50) ?? "UNKNOWN",
            fareFamily: text(row.fare_family, 100),
            cabinClass: text(row.cabin_class, 30),
            baseFare: numberValue(row.base_fare),
            taxes: numberValue(row.taxes),
            fees: numberValue(row.fees),
            totalPrice: numberValue(row.total_price),
            currency: code(row.currency, 3),
            passengerCount: numberValue(row.passenger_count),
            baggageDetails: text(row.baggage_details, 10_000),
            cabinBaggage: text(row.cabin_baggage, 10_000),
            refundability: text(row.refundability, 10_000),
            changeCancelConditions: text(row.change_cancel_conditions, 10_000),
            fareRules: text(row.fare_rules, 10_000),
            bookingUrl: text(row.booking_url, 10_000),
            collectedAt: text(row.collected_at, 40)
        }));

        // Only a completed search proves which flights a route has on a date.
        // Failed or "no results" pages are not trusted to remove flights.
        const coveredRoutes = queryAll(database, `
            SELECT DISTINCT origin_code, destination_code, departure_date
            FROM search_sessions
            WHERE collection_status = 'COMPLETED'
        `).flatMap(row => {
            const originCode = code(row.origin_code, 3);
            const destinationCode = code(row.destination_code, 3);
            const serviceDate = text(row.departure_date, 10);
            return originCode && destinationCode && serviceDate
                ? [{ originCode, destinationCode, serviceDate }]
                : [];
        });

        const tallies = new Map<string, RowTally>();
        for (const row of queryAll(database, `
            SELECT origin_code, departure_date, validation_status, COUNT(*) AS rows
            FROM flights
            GROUP BY origin_code, departure_date, validation_status
        `)) {
            const originCode = code(row.origin_code, 3);
            const serviceDate = text(row.departure_date, 10);
            if (!originCode || !serviceDate) continue;
            const key = airportDateKey(originCode, serviceDate);
            const tally = tallies.get(key) ?? { total: 0, international: 0, invalid: 0 };
            const rows = Number(row.rows);
            tally.total += rows;
            if (row.validation_status === "REJECTED_INTERNATIONAL") tally.international += rows;
            if (row.validation_status === "REJECTED_INVALID") tally.invalid += rows;
            tallies.set(key, tally);
        }

        return { airports, flights, fares, coveredRoutes, tallies };
    } finally {
        database.close();
    }
}

function prepareFlights(
    flights: SourceFlight[],
    airportCodes: Set<string>
): {
    prepared: Map<string, PreparedFlight>;
    duplicates: number;
    unknownAirports: Map<string, number>;
    invalid: Map<string, number>;
} {
    const prepared = new Map<string, PreparedFlight>();
    const unknownAirports = new Map<string, number>();
    const invalid = new Map<string, number>();
    let duplicates = 0;
    const count = (tally: Map<string, number>, key: string) => {
        tally.set(key, (tally.get(key) ?? 0) + 1);
    };

    for (const flight of flights) {
        const originCode = flight.segmentOriginCode;
        const destinationCode = flight.segmentDestinationCode;
        const serviceDate = flight.departureLocal?.slice(0, 10) ?? flight.departureDate;
        const tallyKey = airportDateKey(flight.originCode ?? "?", flight.departureDate ?? "?");
        if (!originCode || !destinationCode || !serviceDate || originCode === destinationCode) {
            count(invalid, tallyKey);
            continue;
        }
        if (!airportCodes.has(originCode) || !airportCodes.has(destinationCode)) {
            count(unknownAirports, tallyKey);
            continue;
        }
        if (!flight.airlineCode || !flight.flightNumber) {
            count(invalid, tallyKey);
            continue;
        }
        const departureAt = instant(flight.departureUtc);
        const arrivalAt = instant(flight.arrivalUtc);
        if (!departureAt || !arrivalAt) {
            count(invalid, tallyKey);
            continue;
        }
        const durationMinutes = (arrivalAt.getTime() - departureAt.getTime()) / 60_000;
        if (durationMinutes < MINIMUM_FLIGHT_MINUTES || durationMinutes > MAXIMUM_FLIGHT_MINUTES) {
            count(invalid, tallyKey);
            continue;
        }
        // Same identity format as the existing flight instances, so a flight
        // that is already stored is updated instead of duplicated.
        const identityKey = [
            `${flight.airlineCode}${flight.flightNumber}`,
            originCode,
            destinationCode,
            departureAt.toISOString()
        ].join("|");
        const existing = prepared.get(identityKey);
        if (existing) {
            existing.sqliteIds.push(flight.sqliteId);
            duplicates += 1;
            continue;
        }
        prepared.set(identityKey, {
            identityKey,
            sqliteIds: [flight.sqliteId],
            provider: flight.provider,
            sourceRecordId: flight.sourceRecordId,
            originCode,
            destinationCode,
            serviceDate,
            airlineCode: flight.airlineCode,
            airlineName: flight.airlineName,
            flightNumber: flight.flightNumber,
            departureAt,
            arrivalAt,
            aircraftType: flight.aircraftType
        });
    }
    return { prepared, duplicates, unknownAirports, invalid };
}

async function loadAirports(): Promise<Map<string, { id: bigint; hubId: bigint }>> {
    const airports = await prisma.aviationAirport.findMany({
        where: { countryCode: "IN" },
        select: { id: true, hubId: true, iataCode: true }
    });
    return new Map(airports.map(airport => [airport.iataCode, airport]));
}

// Adds airports that appear in the export but not in the database. Existing
// airports keep their hub, coordinates and city.
async function addMissingAirports(
    sourceAirports: SourceAirport[],
    airports: Map<string, { id: bigint; hubId: bigint }>
): Promise<string[]> {
    const added: string[] = [];
    for (const source of sourceAirports) {
        if (airports.has(source.iataCode)) continue;
        const hub = await prisma.transportHub.upsert({
            where: { hubType_code: { hubType: "AIRPORT", code: source.iataCode } },
            create: {
                hubType: "AIRPORT",
                code: source.iataCode,
                name: source.name,
                latitude: source.latitude,
                longitude: source.longitude,
                timezone: source.timezone
            },
            update: {}
        });
        const airport = await prisma.aviationAirport.create({
            data: {
                hubId: hub.id,
                iataCode: source.iataCode,
                countryCode: "IN",
                dataSource: DATA_SOURCE
            },
            select: { id: true, hubId: true }
        });
        airports.set(source.iataCode, airport);
        added.push(source.iataCode);
    }
    return added;
}

async function resolveAirlines(
    flights: PreparedFlight[],
    dryRun: boolean
): Promise<{ airlines: Map<string, bigint | null>; added: string[] }> {
    const existing = await prisma.aviationAirline.findMany({
        where: { iataCode: { not: null } },
        select: { id: true, iataCode: true, serviceType: true },
        orderBy: { id: "asc" }
    });
    // Prefer the scheduled record when a code appears more than once.
    const preferred = new Map<string, (typeof existing)[number]>();
    for (const airline of existing) {
        const iataCode = airline.iataCode as string;
        const current = preferred.get(iataCode);
        if (!current || (current.serviceType !== "scheduled" && airline.serviceType === "scheduled")) {
            preferred.set(iataCode, airline);
        }
    }
    const airlines = new Map<string, bigint | null>(
        [...preferred].map(([iataCode, airline]) => [iataCode, airline.id])
    );
    const added: string[] = [];
    for (const flight of flights) {
        if (airlines.has(flight.airlineCode)) continue;
        if (dryRun) {
            airlines.set(flight.airlineCode, null);
        } else {
            // Flights sold on the collected booking sites are scheduled
            // passenger services.
            const airline = await prisma.aviationAirline.create({
                data: {
                    iataCode: flight.airlineCode,
                    name: flight.airlineName ?? flight.airlineCode,
                    countryCode: "IN",
                    serviceType: "scheduled",
                    dataSource: DATA_SOURCE
                },
                select: { id: true }
            });
            airlines.set(flight.airlineCode, airline.id);
        }
        added.push(flight.airlineCode);
    }
    return { airlines, added };
}

function fareRows(
    flights: PreparedFlight[],
    fares: SourceFare[],
    flightIds: Map<string, bigint>
): Prisma.AviationFlightFareCreateManyInput[] {
    const faresByFlight = new Map<number, SourceFare[]>();
    for (const fare of fares) {
        const list = faresByFlight.get(fare.flightId) ?? [];
        list.push(fare);
        faresByFlight.set(fare.flightId, list);
    }
    const rows: Prisma.AviationFlightFareCreateManyInput[] = [];
    for (const flight of flights) {
        const flightInstanceId = flightIds.get(flight.identityKey);
        if (flightInstanceId === undefined) continue;
        for (const sqliteId of flight.sqliteIds) {
            for (const fare of faresByFlight.get(sqliteId) ?? []) {
                const collectedAt = instant(fare.collectedAt);
                if (!collectedAt) continue;
                const price = (value: number | null) =>
                    value !== null && value >= 0 ? new Prisma.Decimal(value.toFixed(2)) : null;
                rows.push({
                    flightInstanceId,
                    sourceFareKey: sha256Hex([
                        fare.provider,
                        flight.identityKey,
                        collectedAt.toISOString(),
                        fare.fareFamily ?? "",
                        fare.cabinClass ?? "",
                        fare.totalPrice ?? "",
                        fare.currency ?? ""
                    ].join("|")),
                    provider: fare.provider,
                    fareFamily: fare.fareFamily,
                    cabinClass: fare.cabinClass,
                    baseFare: price(fare.baseFare),
                    taxes: price(fare.taxes),
                    fees: price(fare.fees),
                    totalPrice: price(fare.totalPrice),
                    currency: fare.currency,
                    passengerCount: fare.passengerCount === null ? null : Math.trunc(fare.passengerCount),
                    baggageDetails: fare.baggageDetails,
                    cabinBaggage: fare.cabinBaggage,
                    refundability: fare.refundability,
                    changeCancelConditions: fare.changeCancelConditions,
                    fareRules: fare.fareRules,
                    bookingUrl: fare.bookingUrl,
                    collectedAt
                });
            }
        }
    }
    return rows;
}

async function main(): Promise<void> {
    const options = parseOptions();
    const raw = await fs.readFile(options.file);
    const checksum = sha256Hex(raw);
    const sourceFile = path.basename(options.file);

    if (!options.force && !options.dryRun) {
        const previous = await prisma.aviationScheduleImport.findFirst({
            where: { checksum, dataSource: DATA_SOURCE },
            select: { id: true }
        });
        if (previous) {
            console.log(JSON.stringify({ file: sourceFile, skipped: true, reason: "already imported" }, null, 2));
            return;
        }
    }

    const source = await readSource(raw);
    const airports = await loadAirports();
    const addedAirports = options.dryRun
        ? source.airports.filter(airport => !airports.has(airport.iataCode)).map(airport => airport.iataCode)
        : await addMissingAirports(source.airports, airports);
    const knownAirportCodes = new Set([...airports.keys(), ...addedAirports]);

    const { prepared, duplicates, unknownAirports, invalid } =
        prepareFlights(source.flights, knownAirportCodes);
    const flights = [...prepared.values()];
    const { airlines, added: addedAirlines } = await resolveAirlines(flights, options.dryRun);

    const coveredRoutes = source.coveredRoutes.filter(route =>
        airports.has(route.originCode) && airports.has(route.destinationCode)
    );
    const importedKeysByRoute = new Map<string, string[]>();
    for (const flight of flights) {
        const key = routeDateKey(flight.originCode, flight.destinationCode, flight.serviceDate);
        const keys = importedKeysByRoute.get(key) ?? [];
        keys.push(flight.identityKey);
        importedKeysByRoute.set(key, keys);
    }

    const summary: Record<string, unknown> = {
        file: sourceFile,
        dryRun: options.dryRun,
        sourceDirectFlights: source.flights.length,
        flights: flights.length,
        duplicateRows: duplicates,
        unknownAirportRows: [...unknownAirports.values()].reduce((sum, value) => sum + value, 0),
        invalidRows: [...invalid.values()].reduce((sum, value) => sum + value, 0),
        coveredRoutes: coveredRoutes.length,
        airportsAdded: addedAirports,
        airlinesAdded: addedAirlines
    };

    if (options.dryRun) {
        console.log(JSON.stringify(summary, null, 2));
        return;
    }

    const now = new Date();
    const writes = await prisma.$transaction(async tx => {
        const flightIds = new Map<string, bigint>();
        let created = 0;
        for (const flight of flights) {
            const departureAirport = airports.get(flight.originCode)!;
            const arrivalAirport = airports.get(flight.destinationCode)!;
            const existing = await tx.aviationFlightInstance.findUnique({
                where: { identityKey: flight.identityKey },
                select: { id: true }
            });
            const shared = {
                airlineId: airlines.get(flight.airlineCode) ?? null,
                serviceDate: serviceDateValue(flight.serviceDate),
                airlineIataCode: flight.airlineCode,
                flightNumber: flight.flightNumber,
                flightIataNumber: `${flight.airlineCode}${flight.flightNumber}`,
                arrivalAt: flight.arrivalAt,
                active: true,
                dataSource: DATA_SOURCE,
                sourceProvider: flight.provider,
                sourceRecordId: flight.sourceRecordId,
                lastSeenAt: now
            };
            const row = existing
                ? await tx.aviationFlightInstance.update({
                    where: { id: existing.id },
                    // Terminals, gates and aircraft already stored are kept
                    // unless the export provides a value.
                    data: {
                        ...shared,
                        ...(flight.aircraftType ? { aircraftModelText: flight.aircraftType } : {})
                    },
                    select: { id: true }
                })
                : await tx.aviationFlightInstance.create({
                    data: {
                        ...shared,
                        identityKey: flight.identityKey,
                        departureAirportId: departureAirport.id,
                        arrivalAirportId: arrivalAirport.id,
                        departureAt: flight.departureAt,
                        aircraftModelText: flight.aircraftType
                    },
                    select: { id: true }
                });
            if (!existing) created += 1;
            flightIds.set(flight.identityKey, row.id);
        }

        let deactivated = 0;
        for (const route of coveredRoutes) {
            const result = await tx.aviationFlightInstance.updateMany({
                where: {
                    departureAirportId: airports.get(route.originCode)!.id,
                    arrivalAirportId: airports.get(route.destinationCode)!.id,
                    serviceDate: serviceDateValue(route.serviceDate),
                    active: true,
                    identityKey: {
                        notIn: importedKeysByRoute.get(
                            routeDateKey(route.originCode, route.destinationCode, route.serviceDate)
                        ) ?? []
                    }
                },
                data: { active: false }
            });
            deactivated += result.count;
        }

        const fares = fareRows(flights, source.fares, flightIds);
        const insertedFares = fares.length === 0
            ? 0
            : (await tx.aviationFlightFare.createMany({ data: fares, skipDuplicates: true })).count;

        const airportDates = new Set<string>([
            ...source.coveredRoutes.map(route => airportDateKey(route.originCode, route.serviceDate)),
            ...flights.map(flight => airportDateKey(flight.originCode, flight.serviceDate))
        ]);
        for (const key of airportDates) {
            const [airportCode, serviceDate] = key.split("|");
            const airport = airports.get(airportCode);
            if (!airport) continue;
            const date = serviceDateValue(serviceDate);
            const accepted = flights.filter(flight =>
                flight.originCode === airportCode && flight.serviceDate === serviceDate
            ).length;
            const activeFlights = await tx.aviationFlightInstance.count({
                where: { departureAirportId: airport.id, serviceDate: date, active: true }
            });
            const status = activeFlights > 0 ? "AVAILABLE" : "EMPTY_REPORTED";
            const tally = source.tallies.get(key) ?? { total: 0, international: 0, invalid: 0 };
            const counts = {
                status,
                totalRows: tally.total,
                acceptedRows: accepted,
                internationalRows: tally.international,
                unknownAirportRows: unknownAirports.get(key) ?? 0,
                invalidRows: tally.invalid + (invalid.get(key) ?? 0),
                dataSource: DATA_SOURCE
            };
            await tx.aviationScheduleImport.upsert({
                where: {
                    sourceAirportCode_serviceDate_checksum: {
                        sourceAirportCode: airportCode,
                        serviceDate: date,
                        checksum
                    }
                },
                create: { sourceFile, checksum, sourceAirportCode: airportCode, serviceDate: date, ...counts },
                update: { sourceFile, ...counts }
            });
            const detail = `${DATA_SOURCE}: ${sourceFile}`;
            await tx.aviationScheduleCoverage.upsert({
                where: { airportId_serviceDate: { airportId: airport.id, serviceDate: date } },
                create: { airportId: airport.id, serviceDate: date, status, detail },
                update: { status, detail }
            });
        }
        return { created, updated: flights.length - created, deactivated, fares: insertedFares };
    }, { timeout: TRANSACTION_TIMEOUT_MS, maxWait: 60_000 });

    let transferLinks: number | string;
    if (options.refreshAllTransferLinks) {
        await refreshGeographyAndTransfers();
        transferLinks = "refreshed all";
    } else {
        // Only airports without transfer links yet (new airports); links of
        // established airports are left as they are.
        const unlinkedAirportHubs = await prisma.transportHub.findMany({
            where: {
                hubType: "AIRPORT",
                airport: { isNot: null },
                outgoingTransferLinks: { none: {} },
                incomingTransferLinks: { none: {} }
            },
            select: { id: true }
        });
        transferLinks = await linkAirportHubs(unlinkedAirportHubs.map(hub => hub.id));
    }

    console.log(JSON.stringify({ ...summary, ...writes, transferLinks }, null, 2));
}

main()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
