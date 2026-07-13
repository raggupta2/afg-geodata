CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- CreateTable
CREATE TABLE "UserData" (
    "id" BIGSERIAL NOT NULL,
    "session_key" UUID NOT NULL,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "location" geography(Point,4326),
    "datetime" TIMESTAMP(3),
    "fingerprintSha" CHAR(16),
    "browser_language" TEXT,
    "page_language" TEXT,
    "timezone" TEXT,
    "email" TEXT,
    "ward" TEXT,
    "mandal" TEXT,
    "district" TEXT,
    "pincode" TEXT,
    "state" TEXT,
    "device_type" TEXT,
    "source" TEXT,
    "probability" DECIMAL(5,4),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CuratedData" (
    "session_key" UUID NOT NULL,
    "latitude" DECIMAL(10,7),
    "longitude" DECIMAL(10,7),
    "location" geography(Point,4326),
    "datetime" TIMESTAMP(3),
    "fingerprintSha" CHAR(16),
    "browser_language" TEXT,
    "page_language" TEXT,
    "timezone" TEXT,
    "email" TEXT,
    "ward" TEXT,
    "mandal" TEXT,
    "district" TEXT,
    "pincode" TEXT,
    "state" TEXT,
    "device_type" TEXT,
    "source" TEXT,
    "probability" DECIMAL(5,4),
    "curation_version" TEXT,
    "curated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CuratedData_pkey" PRIMARY KEY ("session_key")
);

-- CreateIndex
CREATE INDEX "UserData_session_key_idx" ON "UserData"("session_key");

-- CreateIndex
CREATE INDEX "UserData_fingerprintSha_idx" ON "UserData"("fingerprintSha");

-- CreateIndex
CREATE INDEX "UserData_email_idx" ON "UserData"("email");

-- CreateIndex
CREATE INDEX "UserData_state_idx" ON "UserData"("state");

-- CreateIndex
CREATE INDEX "UserData_district_idx" ON "UserData"("district");

-- CreateIndex
CREATE INDEX "UserData_pincode_idx" ON "UserData"("pincode");

-- CreateIndex
CREATE INDEX "UserData_updated_at_idx" ON "UserData"("updated_at");

-- CreateIndex
CREATE INDEX "idx_user_data_location" ON "UserData" USING GIST ("location");

-- CreateIndex
CREATE INDEX "CuratedData_fingerprintSha_idx" ON "CuratedData"("fingerprintSha");

-- CreateIndex
CREATE INDEX "CuratedData_email_idx" ON "CuratedData"("email");

-- CreateIndex
CREATE INDEX "CuratedData_state_idx" ON "CuratedData"("state");

-- CreateIndex
CREATE INDEX "CuratedData_district_idx" ON "CuratedData"("district");

-- CreateIndex
CREATE INDEX "CuratedData_pincode_idx" ON "CuratedData"("pincode");

-- CreateIndex
CREATE INDEX "CuratedData_updated_at_idx" ON "CuratedData"("updated_at");

-- CreateIndex
CREATE INDEX "idx_curated_location" ON "CuratedData" USING GIST ("location");
