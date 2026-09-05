-- =============================================================================
-- 0004_plant_registry — multi-plant data segregation, DB-first.
--
-- Introduces the tenant -> plant -> device registry (the DB becomes the source
-- of truth for plants and devices) and segregates energy_telemetry by plant.
--
-- Device ROWS are loaded by scripts/import-devices.ts (parses config/devices.yaml
-- so the register maps stay exact); this migration only creates the schema and
-- seeds the current world (rucha-group / plant01). RLS is enabled later, in the
-- same wave as the UI reader-role + connection switch, so the running dashboard
-- (which connects as the table owner today) is not emptied mid-rollout.
-- =============================================================================

-- ---- Registry tables --------------------------------------------------------
CREATE TABLE "tenant" (
  "id"         text PRIMARY KEY,
  "name"       text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "plant" (
  "id"               text PRIMARY KEY,
  "tenant_id"        text NOT NULL REFERENCES "tenant"("id"),
  "name"             text NOT NULL,
  "timezone"         text NOT NULL DEFAULT 'Asia/Kolkata',
  "tariff_kvah"      numeric(10,4),
  "contract_kva"     numeric(10,2),
  "demand_block_min" integer NOT NULL DEFAULT 30,
  "created_at"       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX "idx_plant_tenant" ON "plant" ("tenant_id");

-- Folds in BOTH the devices.yaml device list AND the device_topology overlay
-- (parent/rename/hide/virtual are now columns), scoped by (plant_id, device_id).
CREATE TABLE "device" (
  "plant_id"     text NOT NULL REFERENCES "plant"("id"),
  "device_id"    text NOT NULL,
  "tenant_id"    text NOT NULL,
  "slave"        integer,
  "parent_id"    text,
  "display_name" text,
  "registers"    jsonb NOT NULL DEFAULT '{}'::jsonb,
  "byte_order"   text,
  "hidden"       boolean NOT NULL DEFAULT false,
  "is_virtual"   boolean NOT NULL DEFAULT false,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("plant_id", "device_id")
);
CREATE INDEX "idx_device_plant" ON "device" ("plant_id");

-- ---- Seed the current world -------------------------------------------------
-- The tenant id MUST equal the tenant_id already stamped on every telemetry row
-- (from devices.yaml: 'rucha-engineers'), so the plant→tenant FK and future
-- tenant-level RLS line up with existing data.
INSERT INTO "tenant" ("id", "name") VALUES ('rucha-engineers', 'Rucha Engineers')
  ON CONFLICT ("id") DO NOTHING;

INSERT INTO "plant" ("id", "tenant_id", "name", "timezone", "tariff_kvah", "contract_kva", "demand_block_min")
  VALUES ('plant01', 'rucha-engineers', 'Plant 01', 'Asia/Kolkata', 10.5, 300, 30)
  ON CONFLICT ("id") DO NOTHING;

-- ---- Telemetry segregation: composite index + FK to plant --------------------
CREATE INDEX "idx_telemetry_plant_device_ts"
  ON "energy_telemetry" ("plant_id", "device_id", "timestamp");

-- NOT VALID keeps the ADD lock brief on a growing table; VALIDATE then scans
-- without an exclusive lock. All existing plant_ids are 'plant01', now seeded.
ALTER TABLE "energy_telemetry"
  ADD CONSTRAINT "fk_telemetry_plant" FOREIGN KEY ("plant_id") REFERENCES "plant"("id") NOT VALID;
ALTER TABLE "energy_telemetry" VALIDATE CONSTRAINT "fk_telemetry_plant";
