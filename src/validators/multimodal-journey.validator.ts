import { z } from "zod";
import { ApiError } from "../errors/api.error";
import { JOURNEY_RESULT_LIMIT } from "../types/journey-search";
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

function isOffsetDateTime(value: string): boolean {
    const match = value.match(
        /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/i
    );
    return match !== null
        && isCalendarDate(match[1])
        && Number.isFinite(Date.parse(value));
}

const departureAt = z.string().trim().refine(
    value => isCalendarDate(value) || isOffsetDateTime(value),
    "departureAt must be a valid calendar date or an ISO datetime with Z or a UTC offset."
).transform(value => isCalendarDate(value)
    ? `${value}T00:00:00+05:30`
    : value
);

const options = z.object({
    sourceRailRadiusKm: z.number().finite().min(5).max(300).default(200),
    sourceAirportRadiusKm: z.number().finite().min(5).max(300).default(300),
    destinationRailRadiusKm: z.number().finite().min(5).max(150).default(50),
    destinationAirportRadiusKm: z.number().finite().min(5).max(200).default(100),
    candidatesPerMode: z.number().int().min(1).max(10).default(5),
    maximumTransfers: z.number().int().min(0).max(6).optional(),
    journeyTypes: z.array(z.enum([
        "RAIL_ONLY",
        "FLIGHT_ONLY",
        "RAIL_TO_FLIGHT",
        "FLIGHT_TO_RAIL"
    ])).min(1).max(4).optional(),
    resultOffset: z.number().int().min(0).max(49).optional(),
    pageSize: z.number().int().min(1).max(20).optional(),
    resultLimit: z.number().int().min(1).max(50)
        .default(JOURNEY_RESULT_LIMIT),
    sortBy: z.enum(["transfers", "duration", "departure", "arrival"])
        .default("transfers")
}).strict().transform(value => ({
    ...value,
    resultOffset: value.resultOffset === undefined
        ? undefined
        : Math.min(value.resultOffset, JOURNEY_RESULT_LIMIT),
    pageSize: value.pageSize === undefined
        ? undefined
        : Math.min(value.pageSize, JOURNEY_RESULT_LIMIT),
    resultLimit: Math.min(value.resultLimit, JOURNEY_RESULT_LIMIT)
}));

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
