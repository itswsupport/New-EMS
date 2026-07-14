# Operations: Backup, DR & Troubleshooting

## Backup strategy

| Asset | Method | Cadence |
|-------|--------|---------|
| `energy_telemetry` + `plant_knowledge_base` | `pg_dump -Fc` (or managed snapshots) | daily full + WAL archiving |
| WAL (PITR) | `archive_command` → object storage | continuous |
| Config (`.env`, `devices.yaml`) | version control | on change |
| Dead-letter files | ship `logs/dead-letter.ndjson` to durable storage | continuous |

```bash
# Logical backup
docker compose exec postgres pg_dump -U ems -Fc ems > ems_$(date +%F).dump
# Restore
docker compose exec -T postgres pg_restore -U ems -d ems --clean < ems_YYYY-MM-DD.dump
```

For high volume prefer **physical backups + PITR** (pgBackRest / managed RDS/Cloud
SQL snapshots) over nightly `pg_dump`.

## Disaster recovery

**RPO/RTO targets** drive the design:
- **RPO** — continuous WAL archiving → seconds of potential loss. In-flight edge
  buffers add ≤ `DB_FLUSH_INTERVAL_MS`; a crash mid-buffer loses at most one
  unflushed batch (mitigate with a broker — see scaling.md).
- **RTO** — restore latest base backup + replay WAL; repoint `DATABASE_URL`.

**Runbook**
1. Provision a fresh Postgres (pgvector image).
2. Restore base backup, replay WAL to target time.
3. Re-run `scripts/migrate.sh` (idempotent) to ensure schema/extension parity.
4. Point edge nodes at the recovered DB; they reconnect and resume.
5. Replay any `dead-letter.ndjson` via a loader (see below).

**Dead-letter replay** (sketch): read the NDJSON, batch, call the same
`insertMany`. Because records carry full identity + timestamp, replay is exact.

## Troubleshooting

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| No connections in `/connections` | gateway not dialing / network | verify X5050 is TCP-client to this host:4196; check OT routing |
| `ems_crc_errors_total` climbing | serial noise / wrong baud on gateway | verify 9600 8N1 on X5050; check RS-485 wiring/termination |
| Voltage absurd / NaN | wrong `MODBUS_BYTE_ORDER` | cycle ABCD→CDAB→DCBA→BADC; values become plausible |
| `quality=UNCERTAIN` often | read timeouts | raise `MODBUS_TIMEOUT_MS`/retries; check bus length/contention |
| `ems_queue_depth` rising | DB slower than ingest | partition/pool DB; consider broker (scaling.md) |
| `ems_dead_lettered_total` > 0 | DB outage exhausted retries | fix DB, replay dead-letter file |
| `/ready` = false, `database:false` | DB unreachable/credentials | check `DATABASE_URL`/secret, `pg_isready` |
| Pod restarts on deploy | failing liveness | check `/health`; inspect logs for boot config errors |

## Log-based debugging
Structured JSON; filter by bound context:
```bash
docker compose logs app | jq 'select(.connection_id=="conn_...")'
docker compose logs app | jq 'select(.msg=="batch persisted") | {rows,batch_ms,rows_per_sec}'
```
