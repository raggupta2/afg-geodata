import { JourneyRoutingPolicy } from "@prisma/client";

export type AccessCalculation = {
    aerialDistanceKm: number;
    estimatedRoadDistanceKm: number;
    travelMinutes: number;
};

export function calculateStationAccess(
    aerialDistanceKm: number,
    policy: JourneyRoutingPolicy
): AccessCalculation {
    const roadDetourFactor = Number(policy.roadDetourFactor);
    const roadSpeedDistanceThresholdKm = Number(
        policy.roadSpeedDistanceThresholdKm
    );
    const estimatedRoadDistanceKm = aerialDistanceKm * roadDetourFactor;
    const roadSpeedKph = estimatedRoadDistanceKm > roadSpeedDistanceThresholdKm
        ? Number(policy.longDistanceRoadSpeedKph)
        : Number(policy.roadSpeedKph);
    const travelMinutes = Math.ceil(
        estimatedRoadDistanceKm / roadSpeedKph * 60
    );

    return {
        aerialDistanceKm,
        estimatedRoadDistanceKm,
        travelMinutes
    };
}
