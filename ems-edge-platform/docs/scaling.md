# Scaling & Performance Tuning

## Scale axes

| Axis | Approach |
|------|----------|
| **More meters per gateway** | add `[[device]]` entries to `devices.yaml`; poller iterates them. |
| **More gateways per node** | the listener accepts up to `MAX_CONNECTIONS`; each gets its own poller. |
| **More nodes** | one process per plant/edge host; unique `PLANT_ID`/`TENANT_ID`. Stateless — scale horizontally behind the shared DB tier. |
| **Write throughput** | tune `DB_BATCH_SIZE`/`DB_FLUSH_INTERVAL_MS`; raise DB `connection_limit`. |

## Throughput math

`records/s ≈ (devices × cycles/s)`. At 3 meters × 0.2 Hz = 0.6 rec/s per node.
The batch writer flushes ≤ every 2s, so a single node comfortably handles
thousands of meters. Bottleneck at scale is the **DB tier**, addressed below.

## Database at millions of rows/day

1. **Partition `energy_telemetry` by time.**
   - *TimescaleDB*: `SELECT create_hypertable('energy_telemetry','timestamp');`
     then native compression + retention policies.
   - *Vanilla PG*: `PARTITION BY RANGE (timestamp)` monthly; `pg_partman` to
     automate; `BRIN` index on `timestamp` for cheap range scans.
2. **Right-size indexes.** The three composite indexes cover device/tenant/plant
   queries; drop unused ones to speed inserts.
3. **Connection pooling.** Native pool via `connection_limit` in `DATABASE_URL`;
   add **PgBouncer** (transaction mode) in front for many nodes.
4. **COPY path.** For extreme volume, swap `TelemetryRepository` for a COPY-based
   adapter — interface unchanged.

## When to introduce a broker

The in-memory queue is bounded and durable-on-shutdown, but a node crash loses
its in-flight buffer. Move to **Kafka/NATS/Redis Streams** when you need:
- cross-process durability / replay,
- fan-out to multiple consumers (analytics, Timescale, lake),
- back-pressure decoupling ingestion from storage.

The queue is a port — see [kafka-migration.md](kafka-migration.md). No pipeline
code changes.

## Tuning checklist
- `POLL_INTERVAL_MS` vs `MODBUS_TIMEOUT_MS`: keep `timeout < interval / reads`.
- Watch `ems_batch_flush_duration_seconds` and `ems_queue_depth`; rising depth ⇒
  DB can't keep up → partition/pool/broker.
- Watch `ems_dead_lettered_total`; nonzero ⇒ DB outages, replay the NDJSON file.
- Node: pin CPU/mem via compose `deploy.resources.limits` (already set).
