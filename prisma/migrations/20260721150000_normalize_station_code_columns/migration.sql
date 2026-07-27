-- Rename legacy endpoint-code columns in place. Data and ID relationships are preserved.
ALTER TABLE "train_services"
    RENAME COLUMN "station_from_code" TO "source_station_code";
ALTER TABLE "train_services"
    RENAME COLUMN "station_to_code" TO "destination_station_code";

-- Normalize existing station identifiers. When case-folding exposes a legacy
-- collision, retain the preferred row and give later rows a stable ID suffix.
WITH ranked_codes AS (
    SELECT
        station."id",
        UPPER(BTRIM(station."station_code")) AS normalized_code,
        ROW_NUMBER() OVER (
            PARTITION BY UPPER(BTRIM(station."station_code"))
            ORDER BY station."train_available" DESC, station."id"
        ) AS collision_rank
    FROM "railway_stations" AS station
    WHERE station."station_code" IS NOT NULL
)
UPDATE "railway_stations" AS station
SET "station_code" = CASE
        WHEN ranked.collision_rank = 1 THEN ranked.normalized_code
        ELSE ranked.normalized_code || '-' || station."id"::TEXT
    END,
    "updated_at" = CURRENT_TIMESTAMP
FROM ranked_codes AS ranked
WHERE ranked."id" = station."id"
  AND station."station_code" IS DISTINCT FROM CASE
        WHEN ranked.collision_rank = 1 THEN ranked.normalized_code
        ELSE ranked.normalized_code || '-' || station."id"::TEXT
      END;

UPDATE "train_services"
SET "source_station_code" = UPPER(BTRIM("source_station_code")),
    "destination_station_code" = UPPER(BTRIM("destination_station_code")),
    "updated_at" = CURRENT_TIMESTAMP
WHERE ("source_station_code" IS NOT NULL
       AND "source_station_code" IS DISTINCT FROM UPPER(BTRIM("source_station_code")))
   OR ("destination_station_code" IS NOT NULL
       AND "destination_station_code" IS DISTINCT FROM UPPER(BTRIM("destination_station_code")));

-- Normalize all future writes, including non-importer SQL clients.
CREATE FUNCTION "normalize_railway_station_code"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."station_code" IS NOT NULL THEN
        NEW."station_code" := UPPER(BTRIM(NEW."station_code"));
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "railway_stations_normalize_station_code_trigger"
BEFORE INSERT OR UPDATE OF "station_code"
ON "railway_stations"
FOR EACH ROW
EXECUTE FUNCTION "normalize_railway_station_code"();

CREATE FUNCTION "normalize_train_service_station_codes"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."source_station_code" IS NOT NULL THEN
        NEW."source_station_code" := UPPER(BTRIM(NEW."source_station_code"));
    END IF;
    IF NEW."destination_station_code" IS NOT NULL THEN
        NEW."destination_station_code" := UPPER(BTRIM(NEW."destination_station_code"));
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "train_services_normalize_station_codes_trigger"
BEFORE INSERT OR UPDATE OF "source_station_code", "destination_station_code"
ON "train_services"
FOR EACH ROW
EXECUTE FUNCTION "normalize_train_service_station_codes"();

ALTER TABLE "railway_stations"
    ADD CONSTRAINT "railway_stations_station_code_normalized_check"
    CHECK (
        "station_code" IS NULL
        OR ("station_code" = UPPER(BTRIM("station_code")) AND BTRIM("station_code") <> '')
    ) NOT VALID;

ALTER TABLE "train_services"
    ADD CONSTRAINT "train_services_source_station_code_normalized_check"
    CHECK (
        "source_station_code" IS NULL
        OR ("source_station_code" = UPPER(BTRIM("source_station_code"))
            AND BTRIM("source_station_code") <> '')
    ) NOT VALID,
    ADD CONSTRAINT "train_services_destination_station_code_normalized_check"
    CHECK (
        "destination_station_code" IS NULL
        OR ("destination_station_code" = UPPER(BTRIM("destination_station_code"))
            AND BTRIM("destination_station_code") <> '')
    ) NOT VALID;

ALTER TABLE "railway_stations"
    VALIDATE CONSTRAINT "railway_stations_station_code_normalized_check";
ALTER TABLE "train_services"
    VALIDATE CONSTRAINT "train_services_source_station_code_normalized_check";
ALTER TABLE "train_services"
    VALIDATE CONSTRAINT "train_services_destination_station_code_normalized_check";
