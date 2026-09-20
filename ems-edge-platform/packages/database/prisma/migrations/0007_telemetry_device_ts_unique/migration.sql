-- Idempotent ingestion: a UNIQUE index on (device_id, "timestamp").
--
-- WHY: the composite PK is (id, "timestamp") with a sequence-backed id, so a
-- batch that COMMITTED but whose ack was lost (DB failover / network blip —
-- exactly when the writer retries) is re-inserted with FRESH ids and the PK never
-- catches it. Result: duplicate telemetry rows that over-count count(*) and skew
-- avg() in the telemetry_15min continuous aggregate — silent data corruption for
-- a billing system. The writer pairs this with createMany({ skipDuplicates: true })
-- => INSERT ... ON CONFLICT DO NOTHING, which relies on this index.
--
-- TIMESCALE: a hypertable's unique index must contain the partition column
-- ("timestamp"); (device_id, "timestamp") does, so this is legal on the hypertable
-- and on plain Postgres pre-cutover.
--
-- This SUPERSEDES the non-unique idx_telemetry_device_ts (identical columns), so
-- that redundant index is dropped — same read coverage, one fewer index to
-- maintain on every insert.
--
-- PRE-REQUISITE — no existing duplicates (verified 0 at authoring time). If a
-- future environment has some, de-dupe first (keep the lowest id per key):
--   DELETE FROM energy_telemetry a USING energy_telemetry b
--    WHERE a.device_id = b.device_id AND a."timestamp" = b."timestamp" AND a.id > b.id;
--
-- NOTE: building the index briefly blocks writes (~seconds at ~3M rows); the
-- ingestion queue buffers meanwhile. For zero write-pause, build it by hand with
-- CREATE UNIQUE INDEX CONCURRENTLY instead (that cannot run inside this migration's
-- transaction).
CREATE UNIQUE INDEX energy_telemetry_device_id_timestamp_key
  ON energy_telemetry (device_id, "timestamp");

DROP INDEX IF EXISTS idx_telemetry_device_ts;
