-- Add a first-class "area"/zone label to devices, plant-scoped like everything
-- else in the registry. Nullable + additive: existing rows are unaffected and
-- the poller ignores it (area is topology/UI metadata, not a read plan).
ALTER TABLE device ADD COLUMN IF NOT EXISTS area text;
