-- Nearby-station searches use geography so distances and radius filters are
-- measured in metres. The expression index matches the query cast.
CREATE INDEX IF NOT EXISTS "railway_station_geom_geography_idx"
    ON "railway_station"
    USING GIST ((geom::geography));
