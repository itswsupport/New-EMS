-- Move energy_telemetry's primary key from (id) to (id, timestamp).
--
-- WHY: TimescaleDB requires every unique index (including the PK) to contain the
-- partition column. Converting energy_telemetry to a hypertable (see
-- packages/database/prisma/sql/timescale.sql) needs the PK to include "timestamp".
--
-- SAFE ON PLAIN POSTGRES: this is an ordinary PK swap — it applies cleanly on the
-- current pgvector image too, so a normal deploy before the Timescale cutover is
-- fine. `id` stays sequence-backed (BigInt autoincrement) and unique in practice.
ALTER TABLE energy_telemetry DROP CONSTRAINT energy_telemetry_pkey;
ALTER TABLE energy_telemetry ADD CONSTRAINT energy_telemetry_pkey PRIMARY KEY (id, "timestamp");
