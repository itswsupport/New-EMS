-- reader-role.sql — least-privilege DB role for the DASHBOARD (ems-ui).
--
-- WHY: today the UI connects as the schema-owning superuser `ems`, so any UI
-- compromise / SQL-injection / RCE has full read+write on every tenant, can run
-- DDL (DROP/ALTER), and — being superuser — COPY ... PROGRAM = command execution
-- on the DB host (audit CRIT). This role removes that blast radius.
--
-- RUN once as the DB owner, then point the UI's DATABASE_URL at ems_reader:
--   1) set a strong password below (replace CHANGE_ME), then
--   2) docker exec -i ems-postgres psql -U ems -d ems < reader-role.sql
--   3) UI secret: postgres://ems_reader:<pw>@<host>:5432/ems
--   4) leave the EDGE writer on its own (narrower) role — do NOT switch it.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ems_reader') THEN
    CREATE ROLE ems_reader LOGIN;
  END IF;
END $$;

ALTER ROLE ems_reader PASSWORD 'CHANGE_ME';   -- <<< set a strong, unique value
ALTER ROLE ems_reader NOSUPERUSER NOCREATEDB NOCREATEROLE;

-- Read-only on the schema + the tables the dashboard reads.
GRANT USAGE ON SCHEMA public TO ems_reader;
GRANT SELECT ON energy_telemetry, plant, tenant, device TO ems_reader;
-- telemetry_15min exists only after the Timescale cutover; ignore the error if not.
GRANT SELECT ON telemetry_15min TO ems_reader;

-- The Device Tree editor is the ONLY write path in the UI — it mutates `device`
-- (rename / hide / re-parent / add / remove). Grant just that, nothing else.
GRANT INSERT, UPDATE, DELETE ON device TO ems_reader;

-- Deliberately NOT granted: every other table, ALL DDL, and superuser — so a
-- compromised dashboard cannot drop/alter tables, read server files, or execute
-- shell via COPY ... PROGRAM.

-- ── NEXT STEP — per-tenant isolation via RLS (needs auth first) ──────────────
-- Cannot be enforced yet: the dashboard has no user identity to scope rows by
-- (audit CRIT: no dashboard auth). Once auth sets a per-connection tenant/plant,
-- e.g. `SET app.tenant_id = '<id>'`, enable RLS:
--
--   ALTER TABLE energy_telemetry ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY tenant_read ON energy_telemetry FOR SELECT TO ems_reader
--     USING (tenant_id = current_setting('app.tenant_id', true));
--   -- repeat for plant / tenant / device, plus a write policy for device.
--
-- Until then, this role alone removes the superuser blast radius — the bulk of
-- the risk — without waiting on the auth work.
