# TimescaleDB Migration Runbook (Path A)

Backup-first, zero-data-loss migration of `energy_telemetry` to a TimescaleDB
hypertable. Grounded in the current deployment:

| Fact | Value |
|---|---|
| Host / stack | `192.168.100.30` : `/opt/New-EMS` |
| Postgres container | `ems-postgres` (network `ems-net`, volume `ems-pgdata`) |
| Current image | `pgvector/pgvector:pg16` (Postgres **16.14**) |
| Target image | `timescale/timescaledb-ha:pg16` (bundles timescaledb + pgvector) |
| DB / user | `ems` / `ems` |
| Rows to preserve | ~2.5M in `energy_telemetry` (record the exact count at step 0) |

**Strategy:** dump → restore into a **new** container + **new** volume; the old
container/volume stays untouched as an instant rollback. Cut over only after
verification. Same PG major (16→16) makes the restore clean.

> Run in a maintenance window (~20–40 min). Stop the poller during cutover so no
> readings are lost mid-migration.

---

## Prepared repo artifacts (committed ahead of time)

The risky bits are pre-built so the maintenance window is just "run these", not
"write SQL live":

| Artifact | Role |
|---|---|
| `schema.prisma` — `@@id([id, timestamp])` on `EnergyTelemetry` | composite PK so the table can be a hypertable |
| `migrations/0006_telemetry_composite_pk` | applies that PK swap (safe on plain PG too — a normal deploy before cutover is fine) |
| `packages/database/prisma/sql/timescale.sql` | extension + `create_hypertable` + 15-min continuous aggregate + compression + retention. **Not** a Prisma migration (needs the timescale image + runs outside a transaction) — run via `psql` at cutover |
| `docker-compose.timescale.yml` | swaps the `postgres` service to `timescaledb-ha:pg16` on a **new** volume (`pgdata_ts`); old `pgdata` stays for rollback |

**Compose-based cutover** (the app connects by service name `postgres`, so there is no connection-string change):

```bash
cd /opt/New-EMS/ems-edge-platform
C="docker compose -f docker-compose.yml -f docker-compose.prod.yml"

# 0-1  backup (see steps 0-1 below) — keep until step 7 passes
# 2    stop writers
$C stop app migrate
# 3    authoritative dump from the CURRENT postgres, then stop it
$C exec postgres pg_dump -U ems -d ems -Fc -f /tmp/ems_final.dump
docker cp ems-postgres:/tmp/ems_final.dump /opt/New-EMS/backups/
$C stop postgres

# 4    start the NEW timescale postgres on the NEW volume (old pgdata untouched)
$C -f docker-compose.timescale.yml up -d postgres

# 5    extensions + restore
$C exec postgres psql -U ems -d ems -c "CREATE EXTENSION IF NOT EXISTS timescaledb; CREATE EXTENSION IF NOT EXISTS vector;"
docker cp /opt/New-EMS/backups/ems_final.dump ems-postgres:/tmp/ems.dump
$C exec postgres pg_restore -U ems -d ems --no-owner --if-exists --clean /tmp/ems.dump

# 6    composite PK (migration 0006) + hypertable/aggregates/policies
$C -f docker-compose.timescale.yml run --rm migrate            # applies 0006
$C exec -T postgres psql -U ems -d ems < packages/database/prisma/sql/timescale.sql

# 7    VERIFY row counts == step 0 (gate). If not, STOP and roll back.
$C exec postgres psql -U ems -d ems -c "SELECT count(*), max(\"timestamp\") FROM energy_telemetry;"
$C exec postgres psql -U ems -d ems -c "SELECT hypertable_name, num_chunks FROM timescaledb_information.hypertables;"

# 8    resume writers on the new DB
$C -f docker-compose.timescale.yml up -d app
```

**Rollback (any failure):** drop the `-f docker-compose.timescale.yml` flag and
`$C up -d postgres app` — the old `pgdata` volume was never touched.

Everything from here down is the same procedure spelled out manually (useful if
you are not driving it through Compose).

---

## 0. Pre-flight (record verification targets)
```bash
# on 192.168.100.30
docker exec ems-postgres psql -U ems -d ems -c \
  "SELECT count(*) rows, max(\"timestamp\") latest FROM energy_telemetry;"
docker exec ems-postgres psql -U ems -d ems -c \
  "SELECT count(*) FROM plant_knowledge_base;"   # pgvector table must survive too
docker exec ems-postgres psql -U ems -d ems -c "\dt"
df -h /var/lib/docker   # need room for dump (~1GB) + new volume (~1.2GB) alongside old
```
Write down the row count + latest timestamp — these are the cutover gate.

## 1. Back up (the safety net — keep until fully verified)
```bash
mkdir -p /opt/New-EMS/backups
docker exec ems-postgres pg_dump -U ems -d ems -Fc -f /tmp/ems.dump
docker cp ems-postgres:/tmp/ems.dump /opt/New-EMS/backups/ems_$(date +%F).dump
# sanity: the dump lists every table
docker exec ems-postgres pg_restore --list /tmp/ems.dump | grep -E "TABLE DATA" | head
```
Copy this file off the box if you can. **Do not delete it until step 8 passes.**

## 2. Stop writers (no writes during migration)
```bash
cd /opt/New-EMS
docker compose stop ingestion-service gateway-listener   # adjust to your service names
# ems-postgres stays UP; UI can stay up (read-only) or be stopped
```

## 3. Authoritative dump (after writes stopped)
```bash
docker exec ems-postgres pg_dump -U ems -d ems -Fc -f /tmp/ems_final.dump
docker cp ems-postgres:/tmp/ems_final.dump /opt/New-EMS/backups/ems_final_$(date +%F).dump
```
This dump has the last rows; it's the one you restore.

## 4. Launch the Timescale container (NEW volume, old untouched)
```bash
docker run -d --name ems-postgres-ts --network ems-net \
  -e POSTGRES_USER=ems -e POSTGRES_PASSWORD='<same-as-DATABASE_URL>' -e POSTGRES_DB=ems \
  -v ems-pgdata-ts:/home/postgres/pgdata/data \
  timescale/timescaledb-ha:pg16
```
> ⚠️ GOTCHA: the `timescaledb-ha` image's `PGDATA` is `/home/postgres/pgdata/data`
> (not `/var/lib/postgresql/data`). Mount the new volume there, as above.

Wait until healthy: `docker logs ems-postgres-ts | tail`.

## 5. Restore + extensions
```bash
docker exec ems-postgres-ts psql -U ems -d ems -c \
  "CREATE EXTENSION IF NOT EXISTS timescaledb; CREATE EXTENSION IF NOT EXISTS vector;"
docker cp /opt/New-EMS/backups/ems_final_$(date +%F).dump ems-postgres-ts:/tmp/ems.dump
docker exec ems-postgres-ts pg_restore -U ems -d ems --no-owner --if-exists --clean /tmp/ems.dump
```
The source DB has **no** hypertables, so this is an ordinary restore (no
`timescaledb_pre_restore` dance needed).

## 6. Convert the table to a hypertable
> ⚠️ GOTCHA — unique index rule: a hypertable's unique indexes/PK **must include
> the partition column** (`timestamp`). Today the PK is `energy_telemetry_pkey (id)`.
> Make it composite first, or `create_hypertable` fails:
```sql
ALTER TABLE energy_telemetry DROP CONSTRAINT energy_telemetry_pkey;
ALTER TABLE energy_telemetry ADD PRIMARY KEY (id, "timestamp");

SELECT create_hypertable('energy_telemetry', 'timestamp',
       migrate_data => true, chunk_time_interval => INTERVAL '7 days');
```
> This composite PK also needs a matching Prisma change: `@@id([id, timestamp])`
> on the `EnergyTelemetry` model (+ a no-op migration), so `prisma migrate` doesn't
> see drift. Do this in the repo alongside the cutover.

## 7. Verify (the cutover gate — must match step 0)
```bash
docker exec ems-postgres-ts psql -U ems -d ems -c \
  "SELECT count(*) rows, max(\"timestamp\") latest FROM energy_telemetry;"   # == step 0 (+ any)
docker exec ems-postgres-ts psql -U ems -d ems -c \
  "SELECT count(*) FROM plant_knowledge_base;"                                # == step 0
docker exec ems-postgres-ts psql -U ems -d ems -c \
  "SELECT hypertable_name, num_chunks FROM timescaledb_information.hypertables;"
```
If row counts don't match → STOP, do not cut over, investigate (old DB is intact).

## 8. Cut over
```bash
docker stop ems-postgres && docker rename ems-postgres ems-postgres-old
docker rename ems-postgres-ts ems-postgres          # new container now answers to the same DNS name
cd /opt/New-EMS
# make it permanent: point the compose 'ems-postgres' service at timescale/timescaledb-ha:pg16
#   and its volume at ems-pgdata-ts + PGDATA path — then:
docker compose up -d ingestion-service gateway-listener ui   # restart writers + UI
```
Because `DATABASE_URL` targets host `ems-postgres`, renaming makes everything
resolve to the new DB with no connection-string change.

## 9. Smoke test (live)
- UI loads, all pages 200, plant switch works, **latest telemetry advancing** (poller writing).
- `docker logs -f gateway-listener` shows inserts; no FK/constraint errors.

## 10. The payoff (apply AFTER cutover is stable)
```sql
-- Continuous aggregate: 15-minute rollup the dashboards read instead of raw rows
CREATE MATERIALIZED VIEW telemetry_15min
WITH (timescaledb.continuous) AS
SELECT time_bucket('15 minutes', "timestamp") AS bucket,
       plant_id, device_id,
       avg(active_power) avg_kw, max(active_power) max_kw, min(active_power) min_kw,
       max(active_energy) - min(active_energy) AS wh_delta,
       avg(power_factor) avg_pf
FROM energy_telemetry GROUP BY 1,2,3;
SELECT add_continuous_aggregate_policy('telemetry_15min',
       start_offset => INTERVAL '3 days', end_offset => INTERVAL '15 minutes',
       schedule_interval => INTERVAL '15 minutes');

-- Compression: shrink chunks older than 30 days (~10x)
ALTER TABLE energy_telemetry SET (timescaledb.compress,
       timescaledb.compress_segmentby = 'plant_id, device_id');
SELECT add_compression_policy('energy_telemetry', INTERVAL '30 days');

-- Retention: drop raw rows older than 1 year (aggregates kept longer)
SELECT add_retention_policy('energy_telemetry', INTERVAL '1 year');
```
Then repoint the dashboard rollup queries (`queries.ts`) at `telemetry_15min`.

## 11. Rollback (any failure before/at cutover — zero loss)
```bash
docker rename ems-postgres ems-postgres-ts 2>/dev/null || true   # if already renamed
docker rename ems-postgres-old ems-postgres 2>/dev/null || true
docker start ems-postgres
cd /opt/New-EMS && docker compose up -d ingestion-service gateway-listener ui
```
Old volume `ems-pgdata` was never touched. Keep it + the dumps for ~1 week, then
`docker rm ems-postgres-old && docker volume rm ems-pgdata` once confident.

---

### Note: the zero-risk alternative
None of the above is required to get the biggest read-performance win. Rollup
**tables on the current DB** (plain Postgres, no image swap, no downtime, no
data-loss exposure) remove the "GROUP BY over raw rows every request" bottleneck
by themselves. Do that first; take on this Timescale migration only when raw-data
volume/retention actually demands it.
