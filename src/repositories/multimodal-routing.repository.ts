import { Prisma } from "@prisma/client";
import { prisma } from "../config/database";

export type RoutingHub = {
    id: string;
    cityId: string | null;
    cityName: string | null;
    type: "RAILWAY_STATION" | "AIRPORT";
    code: string;
    name: string;
    latitude: number;
    longitude: number;
    timezone: string;
    stationId: string | null;
    airportId: string | null;
};

export type NearbyRoutingHub = RoutingHub & { aerialDistanceKm: number };

type NearbyHubRow = {
    id: bigint;
    cityId: bigint | null;
    cityName: string | null;
    hubType: "RAILWAY_STATION" | "AIRPORT";
    code: string;
    name: string;
    latitude: number;
    longitude: number;
    timezone: string;
    stationId: bigint | null;
    airportId: bigint | null;
    aerialDistanceKm: number;
};

function mapHub(row: NearbyHubRow): NearbyRoutingHub {
    return {
        id: row.id.toString(),
        cityId: row.cityId?.toString() ?? null,
        cityName: row.cityName,
        type: row.hubType,
        code: row.code,
        name: row.name,
        latitude: row.latitude,
        longitude: row.longitude,
        timezone: row.timezone,
        stationId: row.stationId?.toString() ?? null,
        airportId: row.airportId?.toString() ?? null,
        aerialDistanceKm: row.aerialDistanceKm
    };
}

export async function findNearbyRoutingHubs(
    latitude: number,
    longitude: number,
    railRadiusKm: number,
    airportRadiusKm: number,
    limitPerMode: number,
    includeAllAirportsWithinRadius = false
): Promise<NearbyRoutingHub[]> {
    const rows = await prisma.$queryRaw<NearbyHubRow[]>(Prisma.sql`
        WITH origin AS (
            SELECT ST_SetSRID(
                ST_MakePoint(${longitude}, ${latitude}), 4326
            )::geography AS point
        ), ranked AS (
            SELECT
                hub.id,
                hub.city_id AS "cityId",
                city.name AS "cityName",
                hub.hub_type AS "hubType",
                hub.code,
                hub.name,
                hub.latitude::double precision AS latitude,
                hub.longitude::double precision AS longitude,
                hub.timezone,
                station.station_id AS "stationId",
                airport.id AS "airportId",
                (ST_Distance(hub.geom, origin.point) / 1000.0)::double precision
                    AS "aerialDistanceKm",
                ROW_NUMBER() OVER (
                    PARTITION BY hub.hub_type
                    ORDER BY ST_Distance(hub.geom, origin.point), hub.code
                ) AS mode_rank
            FROM transport_hubs hub
            CROSS JOIN origin
            LEFT JOIN transport_cities city ON city.id = hub.city_id
            LEFT JOIN railway_station_hubs station ON station.hub_id = hub.id
            LEFT JOIN aviation_airports airport ON airport.hub_id = hub.id
            WHERE hub.active = true
              AND hub.geom IS NOT NULL
              AND (
                  (hub.hub_type = 'RAILWAY_STATION' AND ST_DWithin(
                      hub.geom, origin.point, ${railRadiusKm * 1000}
                  ))
                  OR
                  (hub.hub_type = 'AIRPORT' AND ST_DWithin(
                      hub.geom, origin.point, ${airportRadiusKm * 1000}
                  ))
              )
        )
        SELECT *
        FROM ranked
        WHERE mode_rank <= ${limitPerMode}
           OR ("hubType" = 'AIRPORT' AND ${includeAllAirportsWithinRadius})
        ORDER BY "aerialDistanceKm", code
    `);
    return rows.map(mapHub);
}

export async function loadRoutingHubs(): Promise<Map<string, RoutingHub>> {
    const hubs = await prisma.transportHub.findMany({
        where: { active: true },
        select: {
            id: true,
            cityId: true,
            hubType: true,
            code: true,
            name: true,
            latitude: true,
            longitude: true,
            timezone: true,
            city: { select: { name: true } },
            railwayStationMapping: { select: { stationId: true } },
            airport: { select: { id: true } }
        }
    });
    return new Map(hubs.map(hub => [hub.id.toString(), {
        id: hub.id.toString(),
        cityId: hub.cityId?.toString() ?? null,
        cityName: hub.city?.name ?? null,
        type: hub.hubType as RoutingHub["type"],
        code: hub.code,
        name: hub.name,
        latitude: Number(hub.latitude),
        longitude: Number(hub.longitude),
        timezone: hub.timezone,
        stationId: hub.railwayStationMapping?.stationId.toString() ?? null,
        airportId: hub.airport?.id.toString() ?? null
    }]));
}

export async function loadRoutingPolicy() {
    const policy = await prisma.journeyRoutingPolicy.findFirst({
        where: { active: true },
        orderBy: { version: "desc" }
    });
    if (!policy) throw new Error("No active journey routing policy is configured.");
    return policy;
}

type TransferLinkRow = Prisma.HubTransferLinkGetPayload<{
    select: {
        fromHubId: true;
        toHubId: true;
        aerialDistanceKm: true;
        estimatedRoadDistanceKm: true;
        travelMinutes: true;
    };
}>;

export async function loadTransferLinks(limitPerHub: number) {
    return prisma.$queryRaw<TransferLinkRow[]>(Prisma.sql`
        SELECT
            candidate.from_hub_id AS "fromHubId",
            candidate.to_hub_id AS "toHubId",
            candidate.aerial_distance_km AS "aerialDistanceKm",
            candidate.estimated_road_distance_km AS "estimatedRoadDistanceKm",
            candidate.travel_minutes AS "travelMinutes"
        FROM transport_hubs from_hub
        CROSS JOIN LATERAL (
            SELECT
                link.from_hub_id,
                link.to_hub_id,
                link.aerial_distance_km,
                link.estimated_road_distance_km,
                link.travel_minutes
            FROM hub_transfer_links link
            JOIN transport_hubs to_hub
              ON to_hub.id = link.to_hub_id
             AND to_hub.active = TRUE
            WHERE link.active = TRUE
              AND link.from_hub_id = from_hub.id
            ORDER BY link.aerial_distance_km, link.id
            LIMIT ${limitPerHub}
        ) candidate
        WHERE from_hub.active = TRUE
        ORDER BY candidate.from_hub_id, candidate.aerial_distance_km
    `);
}

type FlightInstanceRow = {
    id: bigint;
    identityKey: string;
    flightNumber: string;
    flightIataNumber: string | null;
    flightIcaoNumber: string | null;
    departureAt: Date;
    arrivalAt: Date;
    departureTerminal: string | null;
    arrivalTerminal: string | null;
    airlineName: string;
    serviceType: string;
    departureHubId: bigint;
    arrivalHubId: bigint;
};

export async function loadFlightInstances(
    start: Date,
    end: Date,
    maximumPerDepartureAirport = 150
) {
    const rows = await prisma.$queryRaw<FlightInstanceRow[]>(Prisma.sql`
        SELECT
            candidate.id,
            candidate.identity_key AS "identityKey",
            candidate.flight_number AS "flightNumber",
            candidate.flight_iata_number AS "flightIataNumber",
            candidate.flight_icao_number AS "flightIcaoNumber",
            candidate.departure_at AS "departureAt",
            candidate.arrival_at AS "arrivalAt",
            candidate.departure_terminal AS "departureTerminal",
            candidate.arrival_terminal AS "arrivalTerminal",
            candidate.airline_name AS "airlineName",
            candidate.service_type AS "serviceType",
            departure_airport.hub_id AS "departureHubId",
            candidate.arrival_hub_id AS "arrivalHubId"
        FROM aviation_airports departure_airport
        JOIN transport_hubs departure_hub
          ON departure_hub.id = departure_airport.hub_id
         AND departure_hub.active = TRUE
        CROSS JOIN LATERAL (
            SELECT
                flight.id,
                flight.identity_key,
                flight.flight_number,
                flight.flight_iata_number,
                flight.flight_icao_number,
                flight.departure_at,
                flight.arrival_at,
                flight.departure_terminal,
                flight.arrival_terminal,
                arrival_hub.id AS arrival_hub_id,
                airline.name AS airline_name,
                airline.service_type
            FROM aviation_flight_instances flight
            JOIN aviation_airlines airline
              ON airline.id = flight.airline_id
             AND airline.service_type = 'scheduled'
            JOIN aviation_airports arrival_airport
              ON arrival_airport.id = flight.arrival_airport_id
            JOIN transport_hubs arrival_hub
              ON arrival_hub.id = arrival_airport.hub_id
             AND arrival_hub.active = TRUE
            WHERE flight.departure_airport_id = departure_airport.id
              AND flight.active = TRUE
              AND flight.departure_at >= ${start}
              AND flight.departure_at <= ${end}
            ORDER BY flight.departure_at, flight.id
            LIMIT ${maximumPerDepartureAirport}
        ) candidate
        ORDER BY candidate.departure_at, candidate.id
    `);
    return rows.map(row => ({
        id: row.id,
        identityKey: row.identityKey,
        flightNumber: row.flightNumber,
        flightIataNumber: row.flightIataNumber,
        flightIcaoNumber: row.flightIcaoNumber,
        departureAt: row.departureAt,
        arrivalAt: row.arrivalAt,
        departureTerminal: row.departureTerminal,
        arrivalTerminal: row.arrivalTerminal,
        airline: {
            name: row.airlineName,
            serviceType: row.serviceType
        },
        departureAirport: { hub: { id: row.departureHubId } },
        arrivalAirport: { hub: { id: row.arrivalHubId } }
    }));
}

export async function hasScheduledFlightInstances(
    start: Date,
    end: Date
): Promise<boolean> {
    const flight = await prisma.aviationFlightInstance.findFirst({
        where: {
            active: true,
            departureAt: { gte: start, lte: end },
            airline: { serviceType: "scheduled" }
        },
        select: { id: true }
    });
    return flight !== null;
}

export async function loadCoverageSummary(start: Date, end: Date) {
    const [rows, airportCount] = await Promise.all([
        prisma.aviationScheduleCoverage.groupBy({
            by: ["status"],
            where: { serviceDate: { gte: start, lte: end } },
            _count: { _all: true }
        }),
        prisma.aviationAirport.count()
    ]);
    return {
        counts: new Map(rows.map(row => [row.status, row._count._all])),
        airportCount
    };
}
