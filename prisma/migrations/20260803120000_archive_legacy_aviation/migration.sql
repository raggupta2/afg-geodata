-- Retire the legacy aviation schema without destroying imported data.
-- The application and Prisma schema no longer reference these objects. They
-- are moved out of public so replacement multimodal models can use clean names.
-- Railway tables and data are not affected by this migration.

CREATE SCHEMA IF NOT EXISTS "legacy_aviation";

ALTER TABLE IF EXISTS public."flight_schedule_templates"
    SET SCHEMA "legacy_aviation";
ALTER TABLE IF EXISTS public."flight_schedules"
    SET SCHEMA "legacy_aviation";
ALTER TABLE IF EXISTS public."flight_routes"
    SET SCHEMA "legacy_aviation";
ALTER TABLE IF EXISTS public."airport_frequencies"
    SET SCHEMA "legacy_aviation";
ALTER TABLE IF EXISTS public."runways"
    SET SCHEMA "legacy_aviation";
ALTER TABLE IF EXISTS public."navigation_aids"
    SET SCHEMA "legacy_aviation";
ALTER TABLE IF EXISTS public."airlines"
    SET SCHEMA "legacy_aviation";
ALTER TABLE IF EXISTS public."airports"
    SET SCHEMA "legacy_aviation";
ALTER TABLE IF EXISTS public."regions"
    SET SCHEMA "legacy_aviation";
ALTER TABLE IF EXISTS public."countries"
    SET SCHEMA "legacy_aviation";

DO $$
BEGIN
    IF to_regprocedure(
        'public.estimate_flight_duration_minutes(numeric)'
    ) IS NOT NULL THEN
        ALTER FUNCTION public.estimate_flight_duration_minutes(NUMERIC)
            SET SCHEMA "legacy_aviation";
    END IF;

    IF to_regprocedure('public.update_updated_at_column()') IS NOT NULL THEN
        ALTER FUNCTION public.update_updated_at_column()
            SET SCHEMA "legacy_aviation";
    END IF;
END
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_type type
        JOIN pg_namespace namespace ON namespace.oid = type.typnamespace
        WHERE namespace.nspname = 'public'
          AND type.typname = 'FlightDurationSource'
    ) THEN
        ALTER TYPE public."FlightDurationSource"
            SET SCHEMA "legacy_aviation";
    END IF;
END
$$;
