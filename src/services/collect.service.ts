import crypto from "crypto";
import { logger } from "../config/logger";
import { createRawUserData } from "../repositories/user-data.repository";
import { PersistedRawUserDataInput, RawUserDataInput } from "../types/location-data";

function generateId(value:string): string {
    const hash = crypto
        .createHash("sha256")
        .update(value, "utf8")
        .digest();

    const hash96 = hash.subarray(0, 12);
    return hash96.toString("base64url");
}

function normalizeFingerprintSha(data:RawUserDataInput): string | undefined {
    const fingerprintValue = data.fingerprintSha ?? data.browser_fingerprint ?? data.fingerprint;
    return fingerprintValue ? generateId(fingerprintValue) : undefined;
}

function withSessionKey(data:RawUserDataInput): PersistedRawUserDataInput {
    return {
        ...data,
        session_key: data.session_key?.trim() || crypto.randomUUID(),
        fingerprintSha: normalizeFingerprintSha(data)
    };
}

export async function saveUserData(data:RawUserDataInput){
    const rawData = withSessionKey(data);
    const result = await createRawUserData(rawData);

    logger.info({ id: result.id.toString(), session_key: result.session_key }, "raw user data created");

    return result;
}
