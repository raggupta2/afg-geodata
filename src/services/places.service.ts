import { ApiError } from "../errors/api.error";
import { logger } from "../config/logger";
import {
    AddressDetails,
    AddressDetailsInput,
    AddressSuggestion,
    AddressSuggestionsInput
} from "../types/places";

const AUTOCOMPLETE_URL = "https://maps.googleapis.com/maps/api/place/autocomplete/json";
const DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json";
const REQUEST_TIMEOUT_MS = 5_000;
const DETAILS_FIELDS = "place_id,formatted_address,name,geometry/location";

type GooglePrediction = {
    place_id: string;
    description: string;
    structured_formatting?: {
        main_text?: string;
        secondary_text?: string;
    };
};

type GoogleAutocompleteResponse = {
    status: string;
    predictions?: GooglePrediction[];
    error_message?: string;
};

type GoogleDetailsResponse = {
    status: string;
    result?: {
        place_id: string;
        formatted_address: string;
        name?: string;
        geometry?: { location?: { lat?: number; lng?: number } };
    };
    error_message?: string;
};

function requireApiKey(): string {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
        logger.error("GOOGLE_PLACES_API_KEY is not configured");
        throw new ApiError(500, "Address search is not configured.");
    }
    return apiKey;
}

async function fetchGooglePlaces<T>(url: URL): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
            logger.error({ status: response.status }, "Google Places API HTTP error");
            throw new ApiError(502, "Address search is temporarily unavailable.");
        }
        return await response.json() as T;
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

const RECOVERABLE_STATUSES = new Set(["OK", "ZERO_RESULTS"]);

export async function searchAddressSuggestions(
    input: AddressSuggestionsInput
): Promise<AddressSuggestion[]> {
    const apiKey = requireApiKey();

    const url = new URL(AUTOCOMPLETE_URL);
    url.searchParams.set("input", input.input);
    url.searchParams.set("key", apiKey);
    if (input.sessionToken) url.searchParams.set("sessiontoken", input.sessionToken);

    const body = await fetchGooglePlaces<GoogleAutocompleteResponse>(url);

    if (!RECOVERABLE_STATUSES.has(body.status)) {
        logger.error({ status: body.status }, "Google Places autocomplete returned an error status");
        throw new ApiError(502, "Address search is temporarily unavailable.");
    }

    return (body.predictions ?? []).map(prediction => ({
        placeId: prediction.place_id,
        description: prediction.description,
        mainText: prediction.structured_formatting?.main_text ?? prediction.description,
        secondaryText: prediction.structured_formatting?.secondary_text ?? null
    }));
}

export async function getAddressDetails(
    input: AddressDetailsInput
): Promise<AddressDetails> {
    const apiKey = requireApiKey();

    const url = new URL(DETAILS_URL);
    url.searchParams.set("place_id", input.placeId);
    url.searchParams.set("fields", DETAILS_FIELDS);
    url.searchParams.set("key", apiKey);
    if (input.sessionToken) url.searchParams.set("sessiontoken", input.sessionToken);

    const body = await fetchGooglePlaces<GoogleDetailsResponse>(url);

    if (body.status !== "OK" || !body.result) {
        logger.error({ status: body.status }, "Google Places details returned an error status");
        throw new ApiError(
            body.status === "NOT_FOUND" ? 404 : 502,
            body.status === "NOT_FOUND"
                ? "The selected address could not be found."
                : "Address lookup is temporarily unavailable."
        );
    }

    const location = body.result.geometry?.location;
    if (typeof location?.lat !== "number" || typeof location?.lng !== "number") {
        throw new ApiError(502, "The selected address is missing location data.");
    }

    return {
        placeId: body.result.place_id,
        formattedAddress: body.result.formatted_address,
        name: body.result.name ?? null,
        latitude: location.lat,
        longitude: location.lng
    };
}
