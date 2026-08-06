import "dotenv/config";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";

type UnknownRecord = Record<string, any>;

type ImportOptions = {
    root: string;
    from?: string;
    to?: string;
    airport?: string;
    staticOnly: boolean;
};

const INDIA_TIMEZONE = "Asia/Kolkata";
const INDIA_OFFSET = "+05:30";

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
    return {
        root: values.get("root")
            ?? process.env.AVIATION_EDGE_DATA_ROOT
            ?? "D:\\Nikesh\\aviation-edge-api-data",
        from: values.get("from"),
        to: values.get("to"),
        airport: values.get("airport")?.toUpperCase(),
        staticOnly: process.argv.includes("--static-only")
    };
}

function normalizedCode(value: unknown, maximum = 20): string | null {
    if (typeof value !== "string") return null;
    const code = value.trim().toUpperCase();
    return code ? code.slice(0, maximum) : null;
}

function normalizedText(value: unknown, maximum: number): string | null {
    if (typeof value !== "string") return null;
    const text = value.trim();
    return text ? text.slice(0, maximum) : null;
}

function numberValue(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function bigintValue(value: unknown): bigint | null {
    const parsed = numberValue(value);
    return parsed === null ? null : BigInt(Math.trunc(parsed));
}

async function findStaticFile(directory: string, prefix: string): Promise<string> {
    const entries = await fs.readdir(directory);
    const match = entries.find(entry => entry.startsWith(prefix) && entry.endsWith(".json"));
    if (!match) throw new Error(`Static data file '${prefix}*.json' was not found.`);
    return path.join(directory, match);
}

async function readJson(file: string): Promise<unknown> {
    return JSON.parse(await fs.readFile(file, "utf8"));
}

async function importCities(staticDirectory: string): Promise<number> {
    const file = await findStaticFile(staticDirectory, "cityDatabase_");
    const records = await readJson(file);
    if (!Array.isArray(records)) throw new Error("The city database must contain an array.");
    let imported = 0;
    for (const record of records as UnknownRecord[]) {
        if (normalizedCode(record.codeIso2Country, 2) !== "IN") continue;
        const iataCode = normalizedCode(record.codeIataCity, 3);
        const name = normalizedText(record.nameCity, 150);
        const latitude = numberValue(record.latitudeCity);
        const longitude = numberValue(record.longitudeCity);
        if (!iataCode || !name || latitude === null || longitude === null) continue;
        await prisma.transportCity.upsert({
            where: { iataCode },
            create: {
                providerCityId: bigintValue(record.cityId),
                iataCode,
                name,
                countryCode: "IN",
                latitude,
                longitude,
                timezone: INDIA_TIMEZONE
            },
            update: {
                providerCityId: bigintValue(record.cityId),
                name,
                latitude,
                longitude,
                timezone: INDIA_TIMEZONE
            }
        });
        imported += 1;
    }
    return imported;
}

async function importAirports(staticDirectory: string): Promise<number> {
    const file = await findStaticFile(staticDirectory, "airportDatabase_");
    const records = await readJson(file);
    if (!Array.isArray(records)) throw new Error("The airport database must contain an array.");
    const cities = new Map(
        (await prisma.transportCity.findMany()).map(city => [city.iataCode, city])
    );
    let imported = 0;
    for (const record of records as UnknownRecord[]) {
        if (normalizedCode(record.codeIso2Country, 2) !== "IN") continue;
        const providerAirportId = bigintValue(record.airportId);
        const iataCode = normalizedCode(record.codeIataAirport, 3);
        const icaoCode = normalizedCode(record.codeIcaoAirport, 4);
        const cityIataCode = normalizedCode(record.codeIataCity, 3);
        const name = normalizedText(record.nameAirport, 200);
        const latitude = numberValue(record.latitudeAirport);
        const longitude = numberValue(record.longitudeAirport);
        if (!providerAirportId || !iataCode || !name || latitude === null || longitude === null) {
            continue;
        }
        const city = cityIataCode ? cities.get(cityIataCode) : undefined;
        const hub = await prisma.transportHub.upsert({
            where: { hubType_code: { hubType: "AIRPORT", code: iataCode } },
            create: {
                cityId: city?.id,
                hubType: "AIRPORT",
                code: iataCode,
                name,
                latitude,
                longitude,
                timezone: INDIA_TIMEZONE
            },
            update: {
                cityId: city?.id,
                name,
                latitude,
                longitude,
                timezone: INDIA_TIMEZONE,
                active: true
            }
        });
        await prisma.aviationAirport.upsert({
            where: { iataCode },
            create: {
                providerAirportId,
                hubId: hub.id,
                iataCode,
                icaoCode,
                cityIataCode,
                countryCode: "IN",
                geonameId: bigintValue(record.geonameId)
            },
            update: {
                providerAirportId,
                hubId: hub.id,
                icaoCode,
                cityIataCode,
                geonameId: bigintValue(record.geonameId)
            }
        });
        imported += 1;
    }
    return imported;
}

async function importAirlines(staticDirectory: string): Promise<number> {
    const file = await findStaticFile(staticDirectory, "airlineDatabase_");
    const records = await readJson(file);
    if (!Array.isArray(records)) throw new Error("The airline database must contain an array.");
    let imported = 0;
    for (const record of records as UnknownRecord[]) {
        if (normalizedCode(record.codeIso2Country, 2) !== "IN") continue;
        const providerAirlineId = bigintValue(record.airlineId);
        const name = normalizedText(record.nameAirline, 200);
        if (!providerAirlineId || !name) continue;
        await prisma.aviationAirline.upsert({
            where: { providerAirlineId },
            create: {
                providerAirlineId,
                iataCode: normalizedCode(record.codeIataAirline, 3),
                icaoCode: normalizedCode(record.codeIcaoAirline, 4),
                name,
                callsign: normalizedText(record.callsign, 100),
                countryCode: "IN",
                providerStatus: normalizedText(record.statusAirline, 30),
                serviceType: normalizedText(record.type, 30)
            },
            update: {
                iataCode: normalizedCode(record.codeIataAirline, 3),
                icaoCode: normalizedCode(record.codeIcaoAirline, 4),
                name,
                callsign: normalizedText(record.callsign, 100),
                providerStatus: normalizedText(record.statusAirline, 30),
                serviceType: normalizedText(record.type, 30)
            }
        });
        imported += 1;
    }
    return imported;
}

function scheduleInstant(serviceDate: string, time: unknown): Date | null {
    if (typeof time !== "string" || !/^\d{2}:\d{2}$/.test(time)) return null;
    const instant = new Date(`${serviceDate}T${time}:00${INDIA_OFFSET}`);
    return Number.isFinite(instant.getTime()) ? instant : null;
}

function serviceDateValue(serviceDate: string): Date {
    return new Date(`${serviceDate}T00:00:00.000Z`);
}

async function importScheduleFile(
    file: string,
    sourceCode: string,
    serviceDate: string,
    airports: Map<string, { id: bigint }>,
    airlines: Map<string, { id: bigint }>
): Promise<{ accepted: number; skipped: boolean }> {
    const raw = await fs.readFile(file);
    const checksum = createHash("sha256").update(raw).digest("hex");
    const date = serviceDateValue(serviceDate);
    const existing = await prisma.aviationScheduleImport.findFirst({
        where: { sourceAirportCode: sourceCode, serviceDate: date, checksum }
    });
    if (existing) return { accepted: 0, skipped: true };

    const sourceAirport = airports.get(sourceCode);
    if (!sourceAirport) return { accepted: 0, skipped: true };
    const parsed = JSON.parse(raw.toString("utf8")) as unknown;
    if (!Array.isArray(parsed)) {
        const detail = parsed && typeof parsed === "object"
            ? normalizedText((parsed as UnknownRecord).error, 500)
            : "Invalid provider response";
        await prisma.aviationScheduleImport.create({
            data: {
                sourceFile: file,
                checksum,
                sourceAirportCode: sourceCode,
                serviceDate: date,
                status: "EMPTY_REPORTED",
                invalidRows: 1
            }
        });
        await prisma.aviationScheduleCoverage.upsert({
            where: { airportId_serviceDate: { airportId: sourceAirport.id, serviceDate: date } },
            create: { airportId: sourceAirport.id, serviceDate: date, status: "EMPTY_REPORTED", detail },
            update: { status: "EMPTY_REPORTED", detail }
        });
        return { accepted: 0, skipped: false };
    }

    let codeshareRows = 0;
    let internationalRows = 0;
    let unknownAirportRows = 0;
    let invalidRows = 0;
    const flights: Prisma.AviationFlightInstanceCreateManyInput[] = [];

    for (const item of parsed as UnknownRecord[]) {
        if (item.codeshared !== undefined && item.codeshared !== null) {
            codeshareRows += 1;
            continue;
        }
        const departureCode = normalizedCode(item.departure?.iataCode, 3);
        const arrivalCode = normalizedCode(item.arrival?.iataCode, 3);
        const departureAirport = departureCode ? airports.get(departureCode) : undefined;
        const arrivalAirport = arrivalCode ? airports.get(arrivalCode) : undefined;
        if (!departureAirport || !arrivalAirport) {
            unknownAirportRows += 1;
            continue;
        }
        if (departureCode !== sourceCode) {
            invalidRows += 1;
            continue;
        }
        const departureAt = scheduleInstant(serviceDate, item.departure?.scheduledTime);
        let arrivalAt = scheduleInstant(serviceDate, item.arrival?.scheduledTime);
        if (!departureAt || !arrivalAt) {
            invalidRows += 1;
            continue;
        }
        if (arrivalAt.getTime() <= departureAt.getTime()) {
            arrivalAt = new Date(arrivalAt.getTime() + 24 * 60 * 60 * 1000);
        }
        const durationMinutes = (arrivalAt.getTime() - departureAt.getTime()) / 60_000;
        if (durationMinutes < 15 || durationMinutes > 12 * 60) {
            invalidRows += 1;
            continue;
        }
        const airlineIataCode = normalizedCode(item.airline?.iataCode, 3);
        const airlineIcaoCode = normalizedCode(item.airline?.icaoCode, 4);
        const flightNumber = normalizedCode(item.flight?.number, 16)
            ?? normalizedCode(item.flight?.iataNumber, 16)
            ?? normalizedCode(item.flight?.icaoNumber, 20);
        if (!flightNumber) {
            invalidRows += 1;
            continue;
        }
        const flightIataNumber = normalizedCode(item.flight?.iataNumber, 16);
        const flightIcaoNumber = normalizedCode(item.flight?.icaoNumber, 20);
        const serviceIdentity = flightIataNumber
            ?? flightIcaoNumber
            ?? `${airlineIataCode ?? airlineIcaoCode ?? "UNKNOWN"}${flightNumber}`;
        const identityKey = [
            serviceIdentity,
            departureCode,
            arrivalCode,
            departureAt.toISOString()
        ].join("|");
        flights.push({
            identityKey,
            airlineId: airlineIataCode ? airlines.get(airlineIataCode)?.id : undefined,
            departureAirportId: departureAirport.id,
            arrivalAirportId: arrivalAirport.id,
            serviceDate: date,
            airlineIataCode,
            airlineIcaoCode,
            flightNumber,
            flightIataNumber,
            flightIcaoNumber,
            departureAt,
            arrivalAt,
            departureTerminal: normalizedText(item.departure?.terminal, 10),
            arrivalTerminal: normalizedText(item.arrival?.terminal, 10),
            departureGate: normalizedText(item.departure?.gate, 10),
            arrivalGate: normalizedText(item.arrival?.gate, 10),
            aircraftModelCode: normalizedCode(item.aircraft?.modelCode, 20),
            aircraftModelText: normalizedText(item.aircraft?.modelText, 100),
            status: normalizedText(item.status, 30),
            active: true
        });
    }

    for (let index = 0; index < flights.length; index += 500) {
        await prisma.aviationFlightInstance.createMany({
            data: flights.slice(index, index + 500),
            skipDuplicates: true
        });
    }
    const status = flights.length > 0 ? "AVAILABLE" : "EMPTY_REPORTED";
    await prisma.aviationScheduleImport.create({
        data: {
            sourceFile: file,
            checksum,
            sourceAirportCode: sourceCode,
            serviceDate: date,
            status,
            totalRows: parsed.length,
            acceptedRows: flights.length,
            codeshareRows,
            internationalRows,
            unknownAirportRows,
            invalidRows
        }
    });
    await prisma.aviationScheduleCoverage.upsert({
        where: { airportId_serviceDate: { airportId: sourceAirport.id, serviceDate: date } },
        create: { airportId: sourceAirport.id, serviceDate: date, status },
        update: { status, detail: null }
    });
    return { accepted: flights.length, skipped: false };
}

async function refreshGeographyAndTransfers(): Promise<void> {
    const radiusKm = Number(process.env.RAILWAY_CITY_MAPPING_RADIUS_KM ?? 60);
    const maximumTransferKm = Number(process.env.INTERMODAL_TRANSFER_MAX_KM ?? 100);
    await prisma.$executeRawUnsafe(`
        UPDATE transport_cities
        SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
        WHERE geom IS NULL
    `);
    await prisma.$executeRawUnsafe(`
        UPDATE transport_hubs
        SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
        WHERE geom IS NULL
    `);
    await prisma.$executeRawUnsafe(`
        WITH nearest_cities AS (
            SELECT
                hub.id AS hub_id,
                (
                    SELECT city.id
                    FROM transport_cities city
                    WHERE ST_DWithin(hub.geom, city.geom, ${radiusKm * 1000})
                    ORDER BY ST_Distance(hub.geom, city.geom)
                    LIMIT 1
                ) AS city_id
            FROM transport_hubs hub
            WHERE hub.hub_type = 'RAILWAY_STATION'
              AND hub.geom IS NOT NULL
        )
        UPDATE transport_hubs hub
        SET city_id = nearest.city_id,
            updated_at = CURRENT_TIMESTAMP
        FROM nearest_cities nearest
        WHERE nearest.hub_id = hub.id
          AND nearest.city_id IS NOT NULL
    `);
    await prisma.$executeRawUnsafe(`
        UPDATE hub_transfer_links
        SET active = false,
            updated_at = CURRENT_TIMESTAMP
    `);
    await prisma.$executeRawUnsafe(`
        WITH candidate_links AS (
            SELECT
                source.id AS from_hub_id,
                destination.id AS to_hub_id,
                source.hub_type AS from_hub_type,
                ST_Distance(source.geom, destination.geom) / 1000.0
                    AS aerial_distance_km,
                policy.road_speed_kph,
                policy.road_detour_factor,
                ROW_NUMBER() OVER (
                    PARTITION BY source.id
                    ORDER BY ST_Distance(source.geom, destination.geom)
                ) AS destination_rank
            FROM transport_hubs source
            JOIN transport_hubs destination
              ON destination.city_id = source.city_id
             AND destination.hub_type <> source.hub_type
            CROSS JOIN journey_routing_policies policy
            WHERE policy.active = true
              AND source.city_id IS NOT NULL
              AND source.geom IS NOT NULL
              AND destination.geom IS NOT NULL
              AND ST_DWithin(
                  source.geom,
                  destination.geom,
                  ${maximumTransferKm * 1000}
              )
        )
        INSERT INTO hub_transfer_links (
            from_hub_id, to_hub_id, aerial_distance_km,
            estimated_road_distance_km, travel_minutes,
            average_speed_kph, detour_factor
        )
        SELECT
            from_hub_id,
            to_hub_id,
            ROUND(aerial_distance_km::numeric, 2),
            ROUND((aerial_distance_km * road_detour_factor)::numeric, 2),
            CEIL(
                aerial_distance_km * road_detour_factor
                / road_speed_kph * 60.0
            )::integer,
            road_speed_kph,
            road_detour_factor
        FROM candidate_links
        WHERE from_hub_type = 'RAILWAY_STATION'
           OR destination_rank <= 10
        ON CONFLICT (from_hub_id, to_hub_id) DO UPDATE SET
            aerial_distance_km = EXCLUDED.aerial_distance_km,
            estimated_road_distance_km = EXCLUDED.estimated_road_distance_km,
            travel_minutes = EXCLUDED.travel_minutes,
            average_speed_kph = EXCLUDED.average_speed_kph,
            detour_factor = EXCLUDED.detour_factor,
            active = true,
            updated_at = CURRENT_TIMESTAMP
    `);
}

async function importSchedules(options: ImportOptions): Promise<{ files: number; flights: number }> {
    const dataDirectory = path.join(options.root, "data");
    const airports = new Map(
        (await prisma.aviationAirport.findMany()).map(airport => [airport.iataCode, airport])
    );
    const airlines = new Map(
        (await prisma.aviationAirline.findMany({ where: { iataCode: { not: null } }, orderBy: { id: "asc" } }))
            .map(airline => [airline.iataCode!, airline])
    );
    const directories = options.airport
        ? [options.airport]
        : (await fs.readdir(dataDirectory, { withFileTypes: true }))
            .filter(entry => entry.isDirectory())
            .map(entry => entry.name.toUpperCase())
            .sort();
    let files = 0;
    let flights = 0;
    for (const sourceCode of directories) {
        if (!airports.has(sourceCode)) continue;
        const directory = path.join(dataDirectory, sourceCode);
        let entries: string[];
        try {
            entries = await fs.readdir(directory);
        } catch {
            continue;
        }
        for (const entry of entries.filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort()) {
            const serviceDate = entry.slice(0, 10);
            if (options.from && serviceDate < options.from) continue;
            if (options.to && serviceDate > options.to) continue;
            const result = await importScheduleFile(
                path.join(directory, entry),
                sourceCode,
                serviceDate,
                airports,
                airlines
            );
            if (!result.skipped) files += 1;
            flights += result.accepted;
        }
    }
    return { files, flights };
}

async function main(): Promise<void> {
    const options = parseOptions();
    const staticDirectory = path.join(options.root, "Static Data");
    const cities = await importCities(staticDirectory);
    const airports = await importAirports(staticDirectory);
    const airlines = await importAirlines(staticDirectory);
    await refreshGeographyAndTransfers();
    const schedules = options.staticOnly
        ? { files: 0, flights: 0 }
        : await importSchedules(options);
    console.log(JSON.stringify({ cities, airports, airlines, ...schedules }, null, 2));
}

main()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
