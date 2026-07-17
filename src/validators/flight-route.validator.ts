import { z } from "zod";
import { ApiError } from "../errors/api.error";
import { RouteType } from "../types/flight-route";

const airportCodeSchema = z.string()
    .trim()
    .min(3, "Airport codes must contain 3 or 4 characters.")
    .max(4, "Airport codes must contain 3 or 4 characters.")
    .regex(/^[A-Za-z0-9]+$/, "Airport codes may contain only letters and numbers.")
    .transform(value => value.toUpperCase());

const routeQuerySchema = z.object({
    source: airportCodeSchema,
    destination: airportCodeSchema,
    type: z.enum(["direct", "one-stop"]).default("direct")
});

const sourceQuerySchema = z.object({
    source: airportCodeSchema
});

export type RouteSearchQuery = {
    source: string;
    destination: string;
    type: RouteType;
};

export function parseRouteSearchQuery(query: unknown): RouteSearchQuery {
    const result = routeQuerySchema.safeParse(query);
    if (!result.success) {
        throw new ApiError(400, "Invalid route search parameters.", z.flattenError(result.error).fieldErrors);
    }

    if (result.data.source === result.data.destination) {
        throw new ApiError(400, "Source and destination airports must be different.");
    }

    return result.data;
}

export function parseSourceAirportQuery(query: unknown): { source: string } {
    const result = sourceQuerySchema.safeParse(query);
    if (!result.success) {
        throw new ApiError(400, "Invalid airport connectivity parameters.", z.flattenError(result.error).fieldErrors);
    }
    return result.data;
}

export function parseAirlineConnectivityQuery(query: unknown): Omit<RouteSearchQuery, "type"> {
    const result = routeQuerySchema.omit({ type: true }).safeParse(query);
    if (!result.success) {
        throw new ApiError(400, "Invalid airline connectivity parameters.", z.flattenError(result.error).fieldErrors);
    }

    if (result.data.source === result.data.destination) {
        throw new ApiError(400, "Source and destination airports must be different.");
    }
    return result.data;
}
