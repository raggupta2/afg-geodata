export const AVERAGE_ROAD_SPEED_KPH = 30;
export const ROAD_DISTANCE_DETOUR_FACTOR = 1.5;
export const BOARDING_BUFFER_MINUTES = 30;

export type AccessCalculation = {
    aerialDistanceKm: number;
    estimatedRoadDistanceKm: number;
    travelMinutes: number;
};

export function calculateStationAccess(
    aerialDistanceKm: number
): AccessCalculation {
    const estimatedRoadDistanceKm = (
        aerialDistanceKm * ROAD_DISTANCE_DETOUR_FACTOR
    );
    const travelMinutes = Math.ceil(
        estimatedRoadDistanceKm / AVERAGE_ROAD_SPEED_KPH * 60
    );

    return {
        aerialDistanceKm,
        estimatedRoadDistanceKm,
        travelMinutes
    };
}
