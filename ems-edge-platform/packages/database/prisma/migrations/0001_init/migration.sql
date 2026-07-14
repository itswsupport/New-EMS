-- Baseline: energy_telemetry time-series table + primary query indexes.
CREATE TABLE "energy_telemetry" (
    "id"              BIGSERIAL        NOT NULL,
    "device_id"       TEXT             NOT NULL,
    "tenant_id"       TEXT             NOT NULL,
    "plant_id"        TEXT             NOT NULL,
    "timestamp"       TIMESTAMPTZ(6)   NOT NULL,
    "voltage"         DOUBLE PRECISION,
    "current"         DOUBLE PRECISION,
    "frequency"       DOUBLE PRECISION,
    "power_factor"    DOUBLE PRECISION,
    "active_power"    DOUBLE PRECISION,
    "reactive_power"  DOUBLE PRECISION,
    "apparent_power"  DOUBLE PRECISION,
    "active_energy"   DOUBLE PRECISION,
    "reactive_energy" DOUBLE PRECISION,
    "thd"             DOUBLE PRECISION,
    "quality"         VARCHAR(16)      NOT NULL,
    "created_at"      TIMESTAMPTZ(6)   NOT NULL DEFAULT now(),

    CONSTRAINT "energy_telemetry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_telemetry_device_ts" ON "energy_telemetry" ("device_id", "timestamp");
CREATE INDEX "idx_telemetry_tenant_ts" ON "energy_telemetry" ("tenant_id", "timestamp");
CREATE INDEX "idx_telemetry_plant_ts"  ON "energy_telemetry" ("plant_id", "timestamp");
