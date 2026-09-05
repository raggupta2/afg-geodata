import { z } from "zod";
import { ApiError } from "../errors/api.error";
import {
    RAILWAY_DIRECT_SEARCH_RESULT_LIMIT,
    JourneySearchInput,
    JourneySearchOptions
} from "../types/journey-search";

const coordinateSchema = z.object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    label: z.string().trim().min(1).max(150).optional()
}).strict();

function isCalendarDate(value: string): boolean {
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

const offsetDateTimeSchema = z.string()
    .trim()
    .refine(
        isOffsetDateTime,
        "departureAt must be a valid ISO datetime with Z or a UTC offset."
    );

const dateSchema = z.string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "departureDate must use YYYY-MM-DD format.")
    .refine(isCalendarDate, "departureDate must be a valid calendar date.");

const optionSchema = z.object({
    sourceRadiusKm: z.number().finite().min(5).max(300).default(200),
    destinationRadiusKm: z.number().finite().min(5).max(150).default(50),
    sourceCandidateLimit: z.number().int().min(2).max(30).default(6),
    destinationCandidateLimit: z.number().int().min(1).max(15).default(4),
    boardingStationLimit: z.number().int().min(1).max(10).default(5),
    routesPerBoardingStation: z.number().int().min(1).max(5).default(3),
    resultLimit: z.number().int().min(1).max(RAILWAY_DIRECT_SEARCH_RESULT_LIMIT)
        .default(RAILWAY_DIRECT_SEARCH_RESULT_LIMIT),
    sortBy: z.enum(["transfers", "duration", "departure", "arrival"])
        .default("transfers")
}).strict();

const searchSchema = z.object({
    origin: coordinateSchema,
    destination: coordinateSchema,
    departureDate: dateSchema.optional(),
    departureAt: offsetDateTimeSchema.optional(),
    options: z.preprocess(value => value ?? {}, optionSchema)
}).strict().superRefine((value, context) => {
    const suppliedFields = Number(value.departureDate !== undefined)
        + Number(value.departureAt !== undefined);
    if (suppliedFields !== 1) {
        context.addIssue({
            code: "custom",
            path: ["departureDate"],
            message: "Provide exactly one of departureDate or departureAt."
        });
    }
});

export function parseJourneySearch(input: unknown): JourneySearchInput {
    const result = searchSchema.safeParse(input);
    if (!result.success) {
        throw new ApiError(
            400,
            "Invalid railway journey search parameters.",
            z.flattenError(result.error).fieldErrors
        );
    }

    return {
        ...result.data,
        options: result.data.options as JourneySearchOptions
    } as JourneySearchInput;
}
