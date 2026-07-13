import { prisma } from "../config/database";
import { CuratedDataInput, CuratedGeoResult } from "../types/location-data";

export async function upsertCuratedData(data: CuratedDataInput) {
    const latitude = data.latitude ?? null;
    const longitude = data.longitude ?? null;

    const rows = await prisma.$queryRaw<Array<{ session_key: string }>>`
        INSERT INTO "CuratedData" (
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
            "probability",
            "curation_version",
            "curated_at",
            "updated_at"
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
            ${data.probability ?? null},
            ${data.curation_version ?? null},
            NOW(),
            NOW()
        )
        ON CONFLICT ("session_key") DO UPDATE SET
            "latitude" = EXCLUDED."latitude",
            "longitude" = EXCLUDED."longitude",
            "location" = EXCLUDED."location",
            "datetime" = EXCLUDED."datetime",
            "fingerprintSha" = EXCLUDED."fingerprintSha",
            "browser_language" = EXCLUDED."browser_language",
            "page_language" = EXCLUDED."page_language",
            "timezone" = EXCLUDED."timezone",
            "email" = EXCLUDED."email",
            "ward" = EXCLUDED."ward",
            "mandal" = EXCLUDED."mandal",
            "district" = EXCLUDED."district",
            "pincode" = EXCLUDED."pincode",
            "state" = EXCLUDED."state",
            "device_type" = EXCLUDED."device_type",
            "source" = EXCLUDED."source",
            "probability" = EXCLUDED."probability",
            "curation_version" = EXCLUDED."curation_version",
            "updated_at" = NOW()
        RETURNING "session_key"
    `;

    return rows[0];
}

export async function findCuratedDataBySessionKey(session_key: string) {
    return prisma.curatedData.findUnique({
        where: { session_key }
    });
}

export async function findCuratedUsersWithinRadius(latitude:number, longitude:number, radiusMeters:number) {
    return prisma.$queryRaw<CuratedGeoResult[]>`
        SELECT
            "session_key",
            "latitude",
            "longitude",
            "email",
            "state",
            "district",
            "pincode",
            ST_Distance(
                "location",
                ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography
            ) AS "distance_meters"
        FROM "CuratedData"
        WHERE "location" IS NOT NULL
          AND ST_DWithin(
              "location",
              ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography,
              ${radiusMeters}
          )
        ORDER BY "distance_meters" ASC
    `;
}

export async function findNearestCuratedUsers(latitude:number, longitude:number, limit = 20) {
    return prisma.$queryRaw<CuratedGeoResult[]>`
        SELECT
            "session_key",
            "latitude",
            "longitude",
            "email",
            "state",
            "district",
            "pincode",
            ST_Distance(
                "location",
                ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography
            ) AS "distance_meters"
        FROM "CuratedData"
        WHERE "location" IS NOT NULL
        ORDER BY "location" <-> ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)::geography
        LIMIT ${limit}
    `;
}


