-- =============================================================================
-- TimescaleDB conversion — run MANUALLY at cutover, AFTER:
--   1. the image is timescale/timescaledb-ha:pg16 (bundles timescaledb + pgvector)
--   2. the dump has been restored into the new DB
--   3. migration 0006 (composite PK id, timestamp) has been applied
--
-- Run with psql so each statement autocommits (the continuous-aggregate view
-- CANNOT be created inside a transaction — do NOT wrap this in BEGIN/COMMIT,
-- and it is deliberately NOT a Prisma migration):
--   docker exec -i ems-postgres psql -U ems -d ems -f - < timescale.sql
--
-- Idempotent where Timescale allows; safe to re-run.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Convert the raw table to a hypertable (7-day chunks). migrate_data moves the
-- existing ~2.6M rows into chunks in place.
SELECT create_hypertable('energy_telemetry', 'timestamp',
       migrate_data      => true,
       chunk_time_interval => INTERVAL '7 days',
       if_not_exists     => true);

-- ---- Continuous aggregate: the 15-minute rollup the dashboards should read ---
-- (avg/min/max power, energy delta, PF, voltage, THD) per plant + device.
CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_15min
WITH (timescaledb.continuous) AS
SELECT time_bucket('15 minutes', "timestamp")      AS bucket,
       plant_id,
       device_id,
       avg(active_power)                           AS avg_active_power,
       max(active_power)                           AS max_active_power,
       min(active_power)                           AS min_active_power,
       max(active_energy) - min(active_energy)     AS wh_delta,
       avg(power_factor)                           AS avg_power_factor,
       avg(voltage)                                AS avg_voltage,
       avg(current_thd)                            AS avg_current_thd,
       count(*)                                    AS samples
FROM energy_telemetry
GROUP BY 1, 2, 3
WITH NO DATA;

-- Backfill history once, then keep it fresh automatically.
CALL refresh_continuous_aggregate('telemetry_15min', NULL, NULL);
SELECT add_continuous_aggregate_policy('telemetry_15min',
       start_offset      => INTERVAL '3 days',
       end_offset        => INTERVAL '15 minutes',
       schedule_interval => INTERVAL '15 minutes',
       if_not_exists     => true);

-- ---- Compression: shrink chunks older than 30 days (~10x) -------------------
ALTER TABLE energy_telemetry SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'plant_id, device_id',
  timescaledb.compress_orderby   = '"timestamp" DESC'
);
SELECT add_compression_policy('energy_telemetry', INTERVAL '30 days', if_not_exists => true);

-- ---- Retention: drop raw rows older than 1 year (aggregates persist) --------
SELECT add_retention_policy('energy_telemetry', INTERVAL '1 year', if_not_exists => true);

-- After this runs, repoint the dashboard rollup queries in
-- ems-ui/src/lib/queries.ts at telemetry_15min for the big read-speed win.
