-- CreateTable
CREATE TABLE "railway_stations" (
    "id" BIGSERIAL NOT NULL,
    "station_code" TEXT,
    "station_name" TEXT NOT NULL,
    "station_name_hi" TEXT,
    "network" TEXT,
    "operator" TEXT,
    "railway_type" TEXT,
    "public_transport_type" TEXT,
    "internet_access" TEXT,
    "train_available" BOOLEAN NOT NULL DEFAULT false,
    "geom" geometry(Point,4326) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "railway_stations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "railway_stations_station_code_key" ON "railway_stations"("station_code");
