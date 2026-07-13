import { z } from "zod";
import { RawUserDataInput } from "../types/location-data";

export type IgnoredField = {
    field: string;
    reason: string;
};

export type SanitizedCollectInput = {
    data: RawUserDataInput;
    ignoredFields: IgnoredField[];
};

type StoredFieldName = keyof RawUserDataInput;
type IncomingFieldName = StoredFieldName | "type";
type FieldValidator = (value: unknown) => string | number | Date | undefined;

const uuidSchema = z.string().uuid();
const emailSchema = z.string().email();

const fieldValidators: Record<IncomingFieldName, FieldValidator> = {
    session_key: validateUuid,
    latitude: validateLatitude,
    longitude: validateLongitude,
    datetime: validateDatetime,
    fingerprint: validateNonBlankString,
    browser_fingerprint: validateNonBlankString,
    fingerprintSha: validateNonBlankString,
    browser_language: validateNonBlankString,
    page_language: validateNonBlankString,
    timezone: validateNonBlankString,
    email: validateEmail,
    ward: validateNonBlankString,
    mandal: validateNonBlankString,
    district: validateNonBlankString,
    pincode: validateNonBlankString,
    state: validateNonBlankString,
    device_type: validateNonBlankString,
    type: validateNonBlankString,
    source: validateNonBlankString,
    probability: validateProbability
};

const knownFields = new Set(Object.keys(fieldValidators));

function validateNonBlankString(value: unknown): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }

    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
}

function validateFiniteNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function validateLatitude(value: unknown): number | undefined {
    const numberValue = validateFiniteNumber(value);
    return numberValue !== undefined && numberValue >= -90 && numberValue <= 90 ? numberValue : undefined;
}

function validateLongitude(value: unknown): number | undefined {
    const numberValue = validateFiniteNumber(value);
    return numberValue !== undefined && numberValue >= -180 && numberValue <= 180 ? numberValue : undefined;
}

function validateProbability(value: unknown): number | undefined {
    const numberValue = validateFiniteNumber(value);
    return numberValue !== undefined && numberValue >= 0 && numberValue <= 1 ? numberValue : undefined;
}

function validateUuid(value: unknown): string | undefined {
    const text = validateNonBlankString(value);
    return text && uuidSchema.safeParse(text).success ? text : undefined;
}

function validateEmail(value: unknown): string | undefined {
    const text = validateNonBlankString(value);
    return text && emailSchema.safeParse(text).success ? text : undefined;
}

function validateDatetime(value: unknown): Date {
    const date = new Date(value as any);

    // invalid/missing -> current datetime
    return isNaN(date.getTime()) ? new Date() : date;
}


function reasonForValue(value: unknown): string {
    if (value === null) {
        return "value is null";
    }

    if (value === undefined) {
        return "value is missing";
    }

    if (typeof value === "string" && value.trim() === "") {
        return "value is empty";
    }

    return `invalid ${Array.isArray(value) ? "array" : typeof value} value`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function storageFieldFor(field: IncomingFieldName): StoredFieldName {
    return field === "type" ? "device_type" : field;
}

export function sanitizeCollectInput(input: unknown): SanitizedCollectInput {
    const data: RawUserDataInput = {};
    const ignoredFields: IgnoredField[] = [];

    if (!isRecord(input)) {
        return {
            data,
            ignoredFields: input === undefined
                ? []
                : [{ field: "body", reason: "request body must be an object" }]
        };
    }

    for (const [field, value] of Object.entries(input)) {
        if (!knownFields.has(field)) {
            ignoredFields.push({ field, reason: "unsupported field" });
            continue;
        }

        const fieldName = field as IncomingFieldName;
        const sanitizedValue = fieldValidators[fieldName](value);

        if (sanitizedValue === undefined) {
            ignoredFields.push({ field, reason: reasonForValue(value) });
            continue;
        }

        const storageField = storageFieldFor(fieldName);
        if (storageField === "device_type" && data.device_type !== undefined && fieldName === "type") {
            ignoredFields.push({ field, reason: "device_type already provided" });
            continue;
        }

        data[storageField] = sanitizedValue as never;
    }

    return { data, ignoredFields };
}
