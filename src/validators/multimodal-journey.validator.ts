import { z } from "zod";
import { ApiError } from "../errors/api.error";
import { MultimodalSearchInput } from "../types/multimodal-journey";

const coordinates = z.object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    label: z.string().trim().min(1).max(150).optional()
}).strict();

function isCalendarDate(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day;
}

const departureAt = z.string().trim().refine(
    isCalendarDate,
    "departureAt must be a valid calendar date in YYYY-MM-DD format."
);

const options = z.object({
    sourceRailRadiusKm: z.number().finite().min(5).max(300).default(200),
    sourceAirportRadiusKm: z.number().finite().min(5).max(300).default(300),
    destinationRailRadiusKm: z.number().finite().min(5).max(150).default(50),
    destinationAirportRadiusKm: z.number().finite().min(5).max(200).default(100),
    candidatesPerMode: z.number().int().min(1).max(10).default(5),
    maximumTransfers: z.number().int().min(0).max(6).optional(),
    resultLimit: z.number().int().min(1).max(60).default(50)
}).strict();

const schema = z.object({
    origin: coordinates,
    destination: coordinates,
    departureAt,
    options: z.preprocess(value => value ?? {}, options)
}).strict();

export function parseMultimodalSearch(input: unknown): MultimodalSearchInput {
    const result = schema.safeParse(input);
    if (!result.success) {
        throw new ApiError(
            400,
            "Invalid multimodal journey search parameters.",
            z.flattenError(result.error).fieldErrors
        );
    }
    return result.data as MultimodalSearchInput;
}
