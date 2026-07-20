import { z } from "zod";
import { ApiError } from "../errors/api.error";
import { RailwayRouteType } from "../types/railway-route";

const stationCodeSchema = z.string()
    .trim()
    .min(1, "Station codes are required.")
    .max(10, "Station codes may contain at most 10 characters.")
    .regex(/^[A-Za-z0-9]+$/, "Station codes may contain only letters and numbers.")
    .transform(value => value.toUpperCase());

const railwayRouteQuerySchema = z.object({
    source: stationCodeSchema,
    destination: stationCodeSchema,
    type: z.enum(["direct", "one-stop"]).default("direct")
});

export type RailwayRouteSearchQuery = {
    source: string;
    destination: string;
    type: RailwayRouteType;
};

export function parseRailwayRouteSearchQuery(query: unknown): RailwayRouteSearchQuery {
    const result = railwayRouteQuerySchema.safeParse(query);
    if (!result.success) {
        throw new ApiError(
            400,
            "Invalid railway route search parameters.",
            z.flattenError(result.error).fieldErrors
        );
    }

    if (result.data.source === result.data.destination) {
        throw new ApiError(400, "Source and destination stations must be different.");
    }

    return result.data;
}
