import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";
import {
    AirlineSummary,
    AirportConnection,
    AirportSummary,
    FlightItinerary,
    FlightLeg
} from "../types/flight-route";

type AirportRow = {
    id: bigint;
    code: string;
    iataCode: string | null;
    icaoCode: string | null;
    name: string;
    city: string | null;
    countryCode: string | null;
    latitude: number;
    longitude: number;
};

type DirectRouteRow = AirportRow & {
    routeId: bigint;
    destinationId: bigint;
    destinationCode: string;
    destinationIataCode: string | null;
    destinationIcaoCode: string | null;
    destinationName: string;
    destinationCity: string | null;
    destinationCountryCode: string | null;
    destinationLatitude: number;
    destinationLongitude: number;
    airlineId: bigint;
    airlineName: string;
    airlineIataCode: string | null;
    airlineIcaoCode: string | null;
    flightNumber: string | null;
    codeshare: boolean;
    equipment: string | null;
    distanceKm: number | null;
    durationMinutes: number | null;
};

type OneStopRouteRow = DirectRouteRow & {
    stopId: bigint;
    stopCode: string;
    stopIataCode: string | null;
    stopIcaoCode: string | null;
    stopName: string;
    stopCity: string | null;
    stopCountryCode: string | null;
    stopLatitude: number;
    stopLongitude: number;
    secondRouteId: bigint;
    secondAirlineId: bigint;
    secondAirlineName: string;
    secondAirlineIataCode: string | null;
    secondAirlineIcaoCode: string | null;
    secondFlightNumber: string | null;
    secondCodeshare: boolean;
    secondEquipment: string | null;
    secondDistanceKm: number | null;
    secondDurationMinutes: number | null;
};

type ConnectionRow = AirportRow & {
    airlineId: bigint;
    airlineName: string;
    airlineIataCode: string | null;
    airlineIcaoCode: string | null;
    routeCount: bigint;
};

type AirlineRow = {
    id: bigint;
    name: string;
    iataCode: string | null;
    icaoCode: string | null;
};

export type ResolvedAirport = AirportSummary & { databaseId: bigint };

const airportFromRow = (row: AirportRow): AirportSummary => ({
    id: row.id.toString(),
    code: row.code,
    iataCode: row.iataCode,
    icaoCode: row.icaoCode,
    name: row.name,
    city: row.city,
    countryCode: row.countryCode,
    latitude: row.latitude,
    longitude: row.longitude
});

const airlineFromValues = (
    id: bigint,
    name: string,
    iataCode: string | null,
    icaoCode: string | null
): AirlineSummary => ({
    id: id.toString(),
    name,
    iataCode,
    icaoCode
});

const destinationFromRow = (row: DirectRouteRow): AirportSummary => ({
    id: row.destinationId.toString(),
    code: row.destinationCode,
    iataCode: row.destinationIataCode,
    icaoCode: row.destinationIcaoCode,
    name: row.destinationName,
    city: row.destinationCity,
    countryCode: row.destinationCountryCode,
    latitude: row.destinationLatitude,
    longitude: row.destinationLongitude
});

const firstLegFromRow = (row: DirectRouteRow, destination = destinationFromRow(row)): FlightLeg => {
    const source = airportFromRow(row);
    return {
        routeId: row.routeId.toString(),
        sourceAirport: source,
        destinationAirport: destination,
        airline: airlineFromValues(
            row.airlineId,
            row.airlineName,
            row.airlineIataCode,
            row.airlineIcaoCode
        ),
        flightNumber: row.flightNumber,
        route: `${source.code} -> ${destination.code}`,
        codeshare: row.codeshare,
        equipment: row.equipment,
        distanceKm: row.distanceKm,
        durationMinutes: row.durationMinutes
    };
};

export async function findAirportByCode(code: string): Promise<ResolvedAirport | null> {
    const rows = await prisma.$queryRaw<AirportRow[]>(Prisma.sql`
        SELECT
            id,
            COALESCE(iata_code, icao_code, ident) AS "code",
            iata_code AS "iataCode",
            icao_code AS "icaoCode",
            airport_name AS "name",
            COALESCE(city, municipality) AS "city",
            country_code AS "countryCode",
            COALESCE(latitude, ST_Y(geom::geometry))::double precision AS "latitude",
            COALESCE(longitude, ST_X(geom::geometry))::double precision AS "longitude"
        FROM airports
        WHERE (iata_code = ${code} OR icao_code = ${code} OR ident = ${code})
          AND COALESCE(latitude, ST_Y(geom::geometry)) IS NOT NULL
          AND COALESCE(longitude, ST_X(geom::geometry)) IS NOT NULL
        ORDER BY
            CASE WHEN iata_code = ${code} THEN 0 WHEN icao_code = ${code} THEN 1 ELSE 2 END
        LIMIT 1
    `);

    if (!rows[0]) return null;
    return { ...airportFromRow(rows[0]), databaseId: rows[0].id };
}

export async function findDirectRoutes(
    source: ResolvedAirport,
    destination: ResolvedAirport
): Promise<FlightItinerary[]> {
    const rows = await prisma.$queryRaw<DirectRouteRow[]>(Prisma.sql`
        SELECT DISTINCT ON (
            r.airline_id,
            COALESCE(r.flight_number, ''),
            COALESCE(r.equipment, ''),
            r.codeshare
        )
            s.id,
            COALESCE(s.iata_code, s.icao_code, s.ident) AS "code",
            s.iata_code AS "iataCode",
            s.icao_code AS "icaoCode",
            s.airport_name AS "name",
            COALESCE(s.city, s.municipality) AS "city",
            s.country_code AS "countryCode",
            COALESCE(s.latitude, ST_Y(s.geom::geometry))::double precision AS "latitude",
            COALESCE(s.longitude, ST_X(s.geom::geometry))::double precision AS "longitude",
            r.id AS "routeId",
            d.id AS "destinationId",
            COALESCE(d.iata_code, d.icao_code, d.ident) AS "destinationCode",
            d.iata_code AS "destinationIataCode",
            d.icao_code AS "destinationIcaoCode",
            d.airport_name AS "destinationName",
            COALESCE(d.city, d.municipality) AS "destinationCity",
            d.country_code AS "destinationCountryCode",
            COALESCE(d.latitude, ST_Y(d.geom::geometry))::double precision AS "destinationLatitude",
            COALESCE(d.longitude, ST_X(d.geom::geometry))::double precision AS "destinationLongitude",
            a.id AS "airlineId",
            a.name AS "airlineName",
            a.iata_code AS "airlineIataCode",
            a.icao_code AS "airlineIcaoCode",
            r.flight_number AS "flightNumber",
            r.codeshare,
            r.equipment,
            r.distance_km::double precision AS "distanceKm",
            r.duration_minutes AS "durationMinutes"
        FROM flight_routes r
        JOIN airports s ON s.id = r.source_airport_id
        JOIN airports d ON d.id = r.destination_airport_id
        JOIN airlines a ON a.id = r.airline_id AND a.active = true
        WHERE r.source_airport_id = ${source.databaseId}
          AND r.destination_airport_id = ${destination.databaseId}
          AND r.active = true
          AND r.stops = 0
        ORDER BY
            r.airline_id,
            COALESCE(r.flight_number, ''),
            COALESCE(r.equipment, ''),
            r.codeshare,
            r.id
    `);

    return rows.map(row => {
        const leg = firstLegFromRow(row);
        return {
            route: leg.route,
            stopAirport: null,
            airlines: [leg.airline],
            flightNumbers: [leg.flightNumber],
            totalStops: 0,
            legs: [leg]
        };
    });
}

export async function findOneStopRoutes(
    source: ResolvedAirport,
    destination: ResolvedAirport
): Promise<FlightItinerary[]> {
    const rows = await prisma.$queryRaw<OneStopRouteRow[]>(Prisma.sql`
        SELECT DISTINCT ON (
            r1.destination_airport_id,
            r1.airline_id,
            COALESCE(r1.flight_number, ''),
            r2.airline_id,
            COALESCE(r2.flight_number, ''),
            COALESCE(r1.equipment, ''),
            COALESCE(r2.equipment, '')
        )
            s.id,
            COALESCE(s.iata_code, s.icao_code, s.ident) AS "code",
            s.iata_code AS "iataCode",
            s.icao_code AS "icaoCode",
            s.airport_name AS "name",
            COALESCE(s.city, s.municipality) AS "city",
            s.country_code AS "countryCode",
            COALESCE(s.latitude, ST_Y(s.geom::geometry))::double precision AS "latitude",
            COALESCE(s.longitude, ST_X(s.geom::geometry))::double precision AS "longitude",
            r1.id AS "routeId",
            stop.id AS "stopId",
            COALESCE(stop.iata_code, stop.icao_code, stop.ident) AS "stopCode",
            stop.iata_code AS "stopIataCode",
            stop.icao_code AS "stopIcaoCode",
            stop.airport_name AS "stopName",
            COALESCE(stop.city, stop.municipality) AS "stopCity",
            stop.country_code AS "stopCountryCode",
            COALESCE(stop.latitude, ST_Y(stop.geom::geometry))::double precision AS "stopLatitude",
            COALESCE(stop.longitude, ST_X(stop.geom::geometry))::double precision AS "stopLongitude",
            d.id AS "destinationId",
            COALESCE(d.iata_code, d.icao_code, d.ident) AS "destinationCode",
            d.iata_code AS "destinationIataCode",
            d.icao_code AS "destinationIcaoCode",
            d.airport_name AS "destinationName",
            COALESCE(d.city, d.municipality) AS "destinationCity",
            d.country_code AS "destinationCountryCode",
            COALESCE(d.latitude, ST_Y(d.geom::geometry))::double precision AS "destinationLatitude",
            COALESCE(d.longitude, ST_X(d.geom::geometry))::double precision AS "destinationLongitude",
            a1.id AS "airlineId",
            a1.name AS "airlineName",
            a1.iata_code AS "airlineIataCode",
            a1.icao_code AS "airlineIcaoCode",
            r1.flight_number AS "flightNumber",
            r1.codeshare,
            r1.equipment,
            r1.distance_km::double precision AS "distanceKm",
            r1.duration_minutes AS "durationMinutes",
            r2.id AS "secondRouteId",
            a2.id AS "secondAirlineId",
            a2.name AS "secondAirlineName",
            a2.iata_code AS "secondAirlineIataCode",
            a2.icao_code AS "secondAirlineIcaoCode",
            r2.flight_number AS "secondFlightNumber",
            r2.codeshare AS "secondCodeshare",
            r2.equipment AS "secondEquipment",
            r2.distance_km::double precision AS "secondDistanceKm",
            r2.duration_minutes AS "secondDurationMinutes"
        FROM flight_routes r1
        JOIN flight_routes r2
          ON r2.source_airport_id = r1.destination_airport_id
         AND r2.active = true
         AND r2.stops = 0
        JOIN airports s ON s.id = r1.source_airport_id
        JOIN airports stop ON stop.id = r1.destination_airport_id
        JOIN airports d ON d.id = r2.destination_airport_id
        JOIN airlines a1 ON a1.id = r1.airline_id AND a1.active = true
        JOIN airlines a2 ON a2.id = r2.airline_id AND a2.active = true
        WHERE r1.source_airport_id = ${source.databaseId}
          AND r2.destination_airport_id = ${destination.databaseId}
          AND r1.active = true
          AND r1.stops = 0
          AND r1.destination_airport_id <> ${source.databaseId}
          AND r1.destination_airport_id <> ${destination.databaseId}
          AND r2.destination_airport_id <> r1.source_airport_id
        ORDER BY
            r1.destination_airport_id,
            r1.airline_id,
            COALESCE(r1.flight_number, ''),
            r2.airline_id,
            COALESCE(r2.flight_number, ''),
            COALESCE(r1.equipment, ''),
            COALESCE(r2.equipment, ''),
            r1.id,
            r2.id
    `);

    return rows.map(row => {
        const stop: AirportSummary = {
            id: row.stopId.toString(),
            code: row.stopCode,
            iataCode: row.stopIataCode,
            icaoCode: row.stopIcaoCode,
            name: row.stopName,
            city: row.stopCity,
            countryCode: row.stopCountryCode,
            latitude: row.stopLatitude,
            longitude: row.stopLongitude
        };
        const destinationAirport = destinationFromRow(row);
        const firstLeg = firstLegFromRow(row, stop);
        const secondAirline = airlineFromValues(
            row.secondAirlineId,
            row.secondAirlineName,
            row.secondAirlineIataCode,
            row.secondAirlineIcaoCode
        );
        const secondLeg: FlightLeg = {
            routeId: row.secondRouteId.toString(),
            sourceAirport: stop,
            destinationAirport,
            airline: secondAirline,
            flightNumber: row.secondFlightNumber,
            route: `${stop.code} -> ${destinationAirport.code}`,
            codeshare: row.secondCodeshare,
            equipment: row.secondEquipment,
            distanceKm: row.secondDistanceKm,
            durationMinutes: row.secondDurationMinutes
        };

        const airlines = firstLeg.airline.id === secondAirline.id
            ? [firstLeg.airline]
            : [firstLeg.airline, secondAirline];

        return {
            route: `${firstLeg.sourceAirport.code} -> ${stop.code} -> ${destinationAirport.code}`,
            stopAirport: stop,
            airlines,
            flightNumbers: [firstLeg.flightNumber, secondLeg.flightNumber],
            totalStops: 1,
            legs: [firstLeg, secondLeg]
        };
    });
}

export async function findDirectConnections(
    source: ResolvedAirport
): Promise<AirportConnection[]> {
    const rows = await prisma.$queryRaw<ConnectionRow[]>(Prisma.sql`
        SELECT
            d.id,
            COALESCE(d.iata_code, d.icao_code, d.ident) AS "code",
            d.iata_code AS "iataCode",
            d.icao_code AS "icaoCode",
            d.airport_name AS "name",
            COALESCE(d.city, d.municipality) AS "city",
            d.country_code AS "countryCode",
            COALESCE(d.latitude, ST_Y(d.geom::geometry))::double precision AS "latitude",
            COALESCE(d.longitude, ST_X(d.geom::geometry))::double precision AS "longitude",
            a.id AS "airlineId",
            a.name AS "airlineName",
            a.iata_code AS "airlineIataCode",
            a.icao_code AS "airlineIcaoCode",
            COUNT(DISTINCT (r.airline_id, COALESCE(r.flight_number, ''))) AS "routeCount"
        FROM flight_routes r
        JOIN airports d ON d.id = r.destination_airport_id
        JOIN airlines a ON a.id = r.airline_id AND a.active = true
        WHERE r.source_airport_id = ${source.databaseId}
          AND r.active = true
          AND r.stops = 0
          AND r.destination_airport_id <> ${source.databaseId}
          AND COALESCE(d.latitude, ST_Y(d.geom::geometry)) IS NOT NULL
          AND COALESCE(d.longitude, ST_X(d.geom::geometry)) IS NOT NULL
        GROUP BY d.id, a.id
        ORDER BY d.airport_name, a.name
    `);

    const connections = new Map<string, AirportConnection>();
    for (const row of rows) {
        const id = row.id.toString();
        const existing = connections.get(id);
        const airline = airlineFromValues(
            row.airlineId,
            row.airlineName,
            row.airlineIataCode,
            row.airlineIcaoCode
        );
        if (existing) {
            existing.airlines.push(airline);
            existing.routeCount += Number(row.routeCount);
        } else {
            connections.set(id, {
                airport: airportFromRow(row),
                airlines: [airline],
                routeCount: Number(row.routeCount)
            });
        }
    }
    return [...connections.values()];
}

export async function findAirlinesForRoute(
    source: ResolvedAirport,
    destination: ResolvedAirport
): Promise<AirlineSummary[]> {
    const rows = await prisma.$queryRaw<AirlineRow[]>(Prisma.sql`
        SELECT DISTINCT
            a.id,
            a.name,
            a.iata_code AS "iataCode",
            a.icao_code AS "icaoCode"
        FROM flight_routes r
        JOIN airlines a ON a.id = r.airline_id
        WHERE r.source_airport_id = ${source.databaseId}
          AND r.destination_airport_id = ${destination.databaseId}
          AND r.active = true
          AND r.stops = 0
          AND a.active = true
        ORDER BY a.name
    `);

    return rows.map(row => airlineFromValues(row.id, row.name, row.iataCode, row.icaoCode));
}


