-- Enable PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE indian_railways (
    railway_id         BIGSERIAL PRIMARY KEY,

    feature_id         BIGINT NOT NULL UNIQUE,

    railway_gauge      VARCHAR(10),
    state_name         VARCHAR(100),
    city_name          VARCHAR(100),
    track_name         VARCHAR(100),
    shape_length       DOUBLE PRECISION,

    geometry           geometry(LINESTRING, 4326) NOT NULL,

    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_indian_railways_geometry
    ON indian_railways
    USING GIST (geometry);

CREATE INDEX idx_indian_railways_feature_id
    ON indian_railways (feature_id);

CREATE INDEX idx_indian_railways_state_name
    ON indian_railways (state_name);

CREATE INDEX idx_indian_railways_city_name
    ON indian_railways (city_name);

CREATE INDEX idx_indian_railways_track_name
    ON indian_railways (track_name);

CREATE INDEX idx_indian_railways_railway_gauge
    ON indian_railways (railway_gauge);