import { z } from "zod";
import { ApiError } from "../errors/api.error";

const iataCodeSchema = z.string()
    .trim()
    .length(3, "Airport codes must contain exactly 3 characters.")
    .regex(/^[A-Za-z0-9]+$/, "Airport codes may contain only letters and numbers.")
    .transform(value => value.toUpperCase());

const travelDateSchema = z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Travel date must use YYYY-MM-DD format.")
    .refine(value => {
        const parsed = new Date(`${value}T00:00:00.000Z`);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    }, "Travel date must be a valid calendar date.");

const flightSearchQuerySchema = z.object({
    from: iataCodeSchema,
    to: iataCodeSchema,
    date: travelDateSchema
});

export type FlightSearchQuery = {
    from: string;
    to: string;
    date: string;
};

export function parseFlightSearchQuery(query: unknown): FlightSearchQuery {
    const result = flightSearchQuerySchema.safeParse(query);
    if (!result.success) {
        throw new ApiError(
            400,
            "Invalid flight search parameters.",
            z.flattenError(result.error).fieldErrors
        );
    }

    if (result.data.from === result.data.to) {
        throw new ApiError(400, "Source and destination airports must be different.");
    }

    return result.data;
}
