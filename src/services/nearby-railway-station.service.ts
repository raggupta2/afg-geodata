import { BoundedAsyncTtlCache } from "../cache/bounded-async-ttl-cache";
import {
    findNearbyRailwayStations,
    NearbyRailwayStation,
    StationCandidateRole
} from "../repositories/nearby-railway-station.repository";

const nearbyStationCache = new BoundedAsyncTtlCache<NearbyRailwayStation[]>(
    5 * 60 * 1000,
    5_000
);

function coordinateCachePart(value: number): string {
    // About one metre of precision; enough to reuse repeated client searches
    // without materially changing the geodesic distance.
    return value.toFixed(5);
}

export async function getNearbyRailwayStations(
    latitude: number,
    longitude: number,
    radiusKm: number,
    limit: number,
    role: StationCandidateRole
): Promise<NearbyRailwayStation[]> {
    const cacheKey = [
        role,
        coordinateCachePart(latitude),
        coordinateCachePart(longitude),
        radiusKm.toFixed(2),
        limit
    ].join(":");

    return nearbyStationCache.getOrLoad(
        cacheKey,
        () => findNearbyRailwayStations(
            latitude,
            longitude,
            radiusKm,
            limit,
            role
        )
    );
}
