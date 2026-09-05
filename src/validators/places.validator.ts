import { z } from "zod";
import { ApiError } from "../errors/api.error";
import { AddressDetailsInput, AddressSuggestionsInput } from "../types/places";

const sessionTokenSchema = z.string().trim().min(1).max(100).optional();

const suggestionsSchema = z.object({
    input: z.string().trim().min(2).max(200),
    sessiontoken: sessionTokenSchema
}).strict();

const detailsSchema = z.object({
    placeId: z.string().trim().min(1).max(300),
    sessiontoken: sessionTokenSchema
}).strict();

export function parseAddressSuggestionsQuery(query: unknown): AddressSuggestionsInput {
    const result = suggestionsSchema.safeParse(query);
    if (!result.success) {
        throw new ApiError(
            400,
            "Invalid address suggestion request. Provide at least 2 characters of input.",
            z.flattenError(result.error).fieldErrors
        );
    }
    return { input: result.data.input, sessionToken: result.data.sessiontoken };
}

export function parseAddressDetailsQuery(query: unknown): AddressDetailsInput {
    const result = detailsSchema.safeParse(query);
    if (!result.success) {
        throw new ApiError(
            400,
            "Invalid address details request. A placeId is required.",
            z.flattenError(result.error).fieldErrors
        );
    }
    return { placeId: result.data.placeId, sessionToken: result.data.sessiontoken };
}
