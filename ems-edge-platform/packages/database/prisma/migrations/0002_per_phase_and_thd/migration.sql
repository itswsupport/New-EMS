-- STEP 2: per-phase electrical values + power-quality (THD).
-- Additive & nullable — existing rows keep NULL for the new columns, so this
-- migration is safe to apply online with no backfill.
ALTER TABLE "energy_telemetry"
  ADD COLUMN "voltage_l1"       DOUBLE PRECISION,
  ADD COLUMN "voltage_l2"       DOUBLE PRECISION,
  ADD COLUMN "voltage_l3"       DOUBLE PRECISION,
  ADD COLUMN "current_l1"       DOUBLE PRECISION,
  ADD COLUMN "current_l2"       DOUBLE PRECISION,
  ADD COLUMN "current_l3"       DOUBLE PRECISION,
  ADD COLUMN "active_power_l1"  DOUBLE PRECISION,
  ADD COLUMN "active_power_l2"  DOUBLE PRECISION,
  ADD COLUMN "active_power_l3"  DOUBLE PRECISION,
  ADD COLUMN "power_factor_l1"  DOUBLE PRECISION,
  ADD COLUMN "power_factor_l2"  DOUBLE PRECISION,
  ADD COLUMN "power_factor_l3"  DOUBLE PRECISION,
  ADD COLUMN "voltage_thd"      DOUBLE PRECISION,
  ADD COLUMN "current_thd"      DOUBLE PRECISION;
