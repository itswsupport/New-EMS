# Phase 0 remediation — data-loss durability & DB exposure

Ready-to-apply artifacts from the whole-system audit. These are **operator
actions** (deploy / DB / secrets); each is safe and independently reversible.

---

## 1. Dead-letter durability  *(data-loss — highest priority)*

**Problem:** `DB_DEAD_LETTER_PATH=/app/logs/dead-letter.ndjson` lived on the
container's ephemeral layer with no volume. A DB outage writes retry-exhausted
batches there; the next `docker compose up` (any image/config change) **wipes
them — silent, permanent loss.**

**Fix (already in `docker-compose.yml`):** a named volume `ems-deadletter`
mounted at `/app/logs`. Apply by recreating the app:

```bash
cd /opt/New-EMS && git pull
cd ems-edge-platform
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d app
docker inspect -f '{{range .Mounts}}{{.Name}}->{{.Destination}} {{end}}' ems-app
#   expect: … ems-deadletter->/app/logs …
```

**Replay** anything already dead-lettered (idempotent — safe to re-run, and safe
while the app runs; duplicates are skipped by the new unique index):

```bash
docker compose exec app node --import tsx scripts/replay-dead-letter.ts
# reads DB_DEAD_LETTER_PATH, inserts, archives the file to *.replayed-<epoch>
```

**Alert (recommended):** page on `ems_dead_lettered_total > 0` (see §4 / Grafana).

---

## 2. Postgres volume — `!override` hardening  *(data-loss)*

**Risk:** the prod/timescale overlays remap the pgdata volume with `!override`.
If that tag is ever not honored (older Compose, a YAML typo, or the base file run
alone with the HA image), Postgres silently writes to the container's ephemeral
layer at the HA image's default PGDATA — the exact 4-day-loss failure.

**Verify after every deploy** (make this a habit / a healthcheck):

```bash
docker inspect -f '{{range .Mounts}}{{.Name}}->{{.Destination}} {{end}}' ems-postgres
#   MUST show:  ems-edge-platform_pgdata_ts->/home/postgres/pgdata/data
#   (or your named ts volume). If it shows an anonymous/other mount → STOP,
#   the DB is on ephemeral storage.
```

If it's ever wrong: stop the stack, correct the volume mapping, and restore from
the latest `scripts/backup.sh` dump onto the durable volume before restarting.

---

## 3. Reader role — stop the UI connecting as superuser  *(security CRIT)*

The dashboard connects as the schema-owning superuser `ems`. Apply the
least-privilege role (`packages/database/prisma/sql/reader-role.sql`), then point
the **UI** secret at it (the edge writer keeps its own role):

```bash
# 1) edit reader-role.sql: replace CHANGE_ME with a strong unique password
docker exec -i ems-postgres psql -U ems -d ems < packages/database/prisma/sql/reader-role.sql
# 2) update the UI's DATABASE_URL secret → postgres://ems_reader:<pw>@<host>:5432/ems
# 3) redeploy ems-ui
```

This removes the superuser blast radius (no DDL, no `COPY … PROGRAM` RCE, no
cross-table access). **Per-tenant RLS is the next step but needs dashboard auth
first** (see the scaffold at the bottom of the SQL, and audit CRIT #1).

---

## Still outstanding (larger efforts, not in this phase)

- **Dashboard authentication** + restrict the `0.0.0.0` bind (CRIT).
- **RLS** per tenant/plant (blocked on auth).
- **Alert delivery**: the Grafana contact point is a no-op webhook; wire email/
  Slack and add Prometheus alerts on `ems_queue_depth`, `ems_dead_lettered_total`,
  `ems_db_retries_total`, and ingested-vs-persisted divergence.
- Automate the Timescale hypertable/CAgg step in `migrate.sh` (currently manual).
