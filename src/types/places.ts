export type AddressSuggestion = {
    placeId: string;
    description: string;
    mainText: string;
    secondaryText: string | null;
};

export type AddressSuggestionsInput = {
    input: string;
    sessionToken?: string;
};

export type AddressDetails = {
    placeId: string;
    formattedAddress: string;
    name: string | null;
    latitude: number;
    longitude: number;
};

export type AddressDetailsInput = {
    placeId: string;
    sessionToken?: string;
};
