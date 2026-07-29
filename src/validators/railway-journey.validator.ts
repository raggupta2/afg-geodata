import { z } from "zod";
import { ApiError } from "../errors/api.error";

const stationCodeSchema = z.string()
    .trim()
    .min(1, "Station codes are required.")
    .max(10, "Station codes may contain at most 10 characters.")
    .regex(/^[A-Za-z0-9]+$/, "Station codes may contain only letters and numbers.")
    .transform(value => value.toUpperCase());

function today(): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function isCalendarDate(value: string): boolean {
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day;
}

const dateSchema = z.string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must use YYYY-MM-DD format.")
    .refine(isCalendarDate, "Date must be a valid calendar date.")
    .default(today());

const timeSchema = z.string()
    .trim()
    .regex(
        /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/,
        "Time must use HH:mm or HH:mm:ss format."
    )
    .transform(value => value.length === 5 ? `${value}:00` : value)
    .default("00:00:00");

const railwayJourneySchema = z.object({
    departure: stationCodeSchema,
    arrival: stationCodeSchema,
    date: dateSchema,
    time: timeSchema
}).strict();

export type RailwayJourneySearchInput = {
    departure: string;
    arrival: string;
    date: string;
    time: string;
};

export function parseRailwayJourneySearch(
    input: unknown
): RailwayJourneySearchInput {
    const result = railwayJourneySchema.safeParse(input);
    if (!result.success) {
        throw new ApiError(
            400,
            "Invalid railway journey search parameters.",
            z.flattenError(result.error).fieldErrors
        );
    }

    if (result.data.departure === result.data.arrival) {
        throw new ApiError(
            400,
            "Departure and arrival stations must be different."
        );
    }

    return result.data;
}
