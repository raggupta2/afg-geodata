import { prisma } from "../config/database";
import { PersistedRawUserDataInput } from "../types/location-data";

export async function createRawUserData(data: PersistedRawUserDataInput) {
    const latitude = data.latitude ?? null;
    const longitude = data.longitude ?? null;

    const rows = await prisma.$queryRaw<Array<{ id: bigint; session_key: string }>>`
        INSERT INTO "UserData" (
            "session_key",
            "latitude",
            "longitude",
            "location",
            "datetime",
            "fingerprintSha",
            "browser_language",
            "page_language",
            "timezone",
            "email",
            "ward",
            "mandal",
            "district",
            "pincode",
            "state",
            "device_type",
            "source",
            "probability"
        )
        VALUES (
            ${data.session_key}::uuid,
            ${latitude},
            ${longitude},
            CASE
                WHEN ${latitude}::numeric IS NULL OR ${longitude}::numeric IS NULL THEN NULL
                ELSE ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography
            END,
            ${data.datetime ?? null},
            ${data.fingerprintSha ?? null},
            ${data.browser_language ?? null},
            ${data.page_language ?? null},
            ${data.timezone ?? null},
            ${data.email ?? null},
            ${data.ward ?? null},
            ${data.mandal ?? null},
            ${data.district ?? null},
            ${data.pincode ?? null},
            ${data.state ?? null},
            ${data.device_type ?? null},
            ${data.source ?? null},
            ${data.probability ?? null}
        )
        RETURNING "id", "session_key"
    `;

    return rows[0];
}

export async function findRawUserDataBySessionKey(session_key: string) {
    return prisma.userData.findMany({
        where: { session_key },
        orderBy: { created_at: "desc" }
    });
}
