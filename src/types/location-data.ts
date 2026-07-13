export type RawUserDataInput = {
    session_key?: string;
    latitude?: number;
    longitude?: number;
    datetime?: string;
    fingerprint?: string;
    browser_fingerprint?: string;
    fingerprintSha?: string;
    browser_language?: string;
    page_language?: string;
    timezone?: string;
    email?: string;
    ward?: string;
    mandal?: string;
    district?: string;
    pincode?: string;
    state?: string;
    device_type?: string;
    source?: string;
    probability?: number;
};

export type PersistedRawUserDataInput = Omit<RawUserDataInput, "fingerprint" | "browser_fingerprint"> & {
    session_key: string;
    fingerprintSha?: string;
};

export type CuratedDataInput = PersistedRawUserDataInput & {
    curation_version?: string;
};

export type CuratedGeoResult = {
    session_key: string;
    latitude: unknown;
    longitude: unknown;
    email: string | null;
    state: string | null;
    district: string | null;
    pincode: string | null;
    distance_meters: number;
};
