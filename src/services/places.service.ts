import { ApiError } from "../errors/api.error";
import { logger } from "../config/logger";
import {
    AddressDetails,
    AddressDetailsInput,
    AddressSuggestion,
    AddressSuggestionsInput
} from "../types/places";

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const DETAILS_BASE_URL = "https://places.googleapis.com/v1/places";
const REQUEST_TIMEOUT_MS = 5_000;
const DETAILS_FIELD_MASK = "id,formattedAddress,displayName,location";

type GooglePlacePrediction = {
    placePrediction?: {
        placeId?: string;
        text?: { text?: string };
        structuredFormat?: {
            mainText?: { text?: string };
            secondaryText?: { text?: string };
        };
    };
};

type GoogleAutocompleteResponse = {
    suggestions?: GooglePlacePrediction[];
};

type GoogleDetailsResponse = {
    id?: string;
    formattedAddress?: string;
    displayName?: { text?: string };
    location?: { latitude?: number; longitude?: number };
};

type GoogleApiErrorBody = {
    error?: {
        code?: number;
        message?: string;
        status?: string;
    };
};

function requireApiKey(): string {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
        logger.error("GOOGLE_PLACES_API_KEY is not configured");
        throw new ApiError(500, "Address search is not configured.");
    }
    return apiKey;
}

async function fetchGooglePlaces<T>(url: string | URL, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(url, { ...init, signal: controller.signal });
        const body = await response.json() as T & GoogleApiErrorBody;

        if (!response.ok) {
            logger.error(
                {
                    httpStatus: response.status,
                    status: body?.error?.status,
                    errorMessage: body?.error?.message
                },
                "Google Places API returned an error"
            );
            throw new ApiError(
                response.status === 404 ? 404 : 502,
                response.status === 404
                    ? "The selected address could not be found."
                    : "Address search is temporarily unavailable."
            );
        }

        return body;
    } catch (error) {
        if (error instanceof ApiError) throw error;
        if ((error as Error)?.name === "AbortError") {
            throw new ApiError(504, "Address search timed out. Please try again.");
        }
        logger.error({ error }, "Google Places API request failed");
        throw new ApiError(502, "Address search is temporarily unavailable.");
    } finally {
        clearTimeout(timeout);
    }
}

export async function searchAddressSuggestions(
    input: AddressSuggestionsInput
): Promise<AddressSuggestion[]> {
    const apiKey = requireApiKey();

    const body = await fetchGooglePlaces<GoogleAutocompleteResponse>(AUTOCOMPLETE_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey
        },
        body: JSON.stringify({
            input: input.input,
            ...(input.sessionToken ? { sessionToken: input.sessionToken } : {})
        })
    });

    return (body.suggestions ?? [])
        .filter(suggestion => Boolean(suggestion.placePrediction?.placeId))
        .map(suggestion => {
            const prediction = suggestion.placePrediction!;
            const description = prediction.text?.text ?? "";
            return {
                placeId: prediction.placeId!,
                description,
                mainText: prediction.structuredFormat?.mainText?.text ?? description,
                secondaryText: prediction.structuredFormat?.secondaryText?.text ?? null
            };
        });
}

export async function getAddressDetails(
    input: AddressDetailsInput
): Promise<AddressDetails> {
    const apiKey = requireApiKey();

    const url = new URL(`${DETAILS_BASE_URL}/${encodeURIComponent(input.placeId)}`);
    if (input.sessionToken) url.searchParams.set("sessionToken", input.sessionToken);

    const body = await fetchGooglePlaces<GoogleDetailsResponse>(url, {
        method: "GET",
        headers: {
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": DETAILS_FIELD_MASK
        }
    });

    const location = body.location;
    if (typeof location?.latitude !== "number" || typeof location?.longitude !== "number") {
        throw new ApiError(502, "The selected address is missing location data.");
    }
    if (!body.id || !body.formattedAddress) {
        throw new ApiError(502, "The selected address is missing required data.");
    }

    return {
        placeId: body.id,
        formattedAddress: body.formattedAddress,
        name: body.displayName?.text ?? null,
        latitude: location.latitude,
        longitude: location.longitude
    };
}
