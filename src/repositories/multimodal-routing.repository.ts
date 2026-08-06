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
        include: { city: true, railwayStationMapping: true, airport: true }
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

export async function loadTransferLinks() {
    return prisma.hubTransferLink.findMany({ where: { active: true } });
}

export async function loadFlightInstances(start: Date, end: Date) {
    return prisma.aviationFlightInstance.findMany({
        where: {
            active: true,
            departureAt: { gte: start, lte: end },
            airline: { serviceType: "scheduled" }
        },
        include: {
            airline: true,
            departureAirport: { include: { hub: true } },
            arrivalAirport: { include: { hub: true } }
        },
        orderBy: { departureAt: "asc" }
    });
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
