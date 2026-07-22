-- Maximum (apparent-power) demand — the utility-billed kVA demand.
-- Register 102 on the Rishabh LM1360 (confirmed frozen/peak-held across scans).
-- Additive & nullable; safe to apply online with no backfill.
ALTER TABLE "energy_telemetry"
  ADD COLUMN "maximum_demand" DOUBLE PRECISION;
