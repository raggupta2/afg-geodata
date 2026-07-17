import { ApiError } from "../errors/api.error";

export type NearbyQuery = {
    latitude: number;
    longitude: number;
};

const queryNumber = (value: unknown): number | undefined => {
    if (typeof value !== "string" || !value.trim()) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
};

export const parseNearbyQuery = (query: Record<string, unknown>): NearbyQuery | null => {
    const hasLatitude = query.latitude !== undefined;
    const hasLongitude = query.longitude !== undefined;

    if (!hasLatitude && !hasLongitude) return null;

    const latitude = queryNumber(query.latitude);
    const longitude = queryNumber(query.longitude);

    if (latitude === undefined || longitude === undefined) {
        throw new ApiError(400, "Provide valid latitude and longitude values together.");
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        throw new ApiError(400, "Latitude must be between -90 and 90 and longitude between -180 and 180.");
    }

    return { latitude, longitude };
};
