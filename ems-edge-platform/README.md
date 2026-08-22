# ems-edge-platform

Enterprise **IIoT Edge Ingestion Platform** for a multi-tenant Energy Management
System. It **listens** for SenseLive X5050 gateways (which run as **TCP clients**),
acts as the Modbus master over each accepted socket, decodes Rishabh LM1360 meter
registers into typed telemetry, batches it, and writes it to PostgreSQL — with
pgvector provisioned for the AI/RAG roadmap.

Built with **clean/hexagonal architecture**: pure domain/infra packages behind
interfaces, wired in a single composition root, every layer independently testable.

- **Node 22 · TypeScript (strict, no `any`) · pnpm workspaces**
- **Fastify · Zod · Pino · Prisma · PostgreSQL + pgvector · prom-client · Vitest**

---

## Contents
- [Architecture](#architecture) · [docs/architecture.md](docs/architecture.md)
- [The ingestion pipeline](#the-ingestion-pipeline)
- [Quick start](#quick-start)
- [Configuration](#configuration) · [docs/configuration.md](docs/configuration.md)
- [HTTP API](#http-api)
- [Testing](#testing)
- [Operations](#operations)
- [Further docs](#further-docs)

---

## Architecture

```
              ┌─────────────────────── ems-edge-platform (one process) ──────────────────────┐
 X5050  TCP   │  apps/gateway-listener            packages (hexagonal core)      apps/api     │
 gateway ───► │  ┌───────────┐  ┌──────────┐      ┌────────┐ ┌─────────┐        ┌──────────┐  │
 (client)  :4196 │Connection │─►│  Poller  │─────►│ queue  │►│ database│──────► │ Fastify   │  │
              │  │(frames)   │  │(decode/  │ sink │(batch) │ │(writer) │  DB    │ REST +    │  │
              │  └───────────┘  │ parse/   │      └────────┘ └────┬────┘        │ /metrics  │  │
              │                 │ validate/│                      │             └──────────┘  │
              │                 │ map)     │                      ▼                            │
              └─────────────────┴──────────┴────────────► PostgreSQL 16 + pgvector ◄───────────┘
```

**Dependency rule:** `apps/*` depend on `packages/*` (interfaces); packages never
depend on apps and never on each other's concretions. The only place concrete
classes are constructed is [apps/ingestion-service/src/app.ts](apps/ingestion-service/src/app.ts).

## The ingestion pipeline

Exactly the required chain, each stage its own testable unit:

| Stage | Where | Testable via |
|-------|-------|--------------|
| TCP connection | `gateway-listener/connection.ts` | `tests/integration/tcp-listener.test.ts` |
| Frame decoder | `modbus/frame-decoder.ts` | `tests/unit/frame-decoder.test.ts` |
| Modbus parser | `modbus/rtu-codec.ts` (+`crc16.ts`) | `tests/unit/rtu-codec.test.ts`, `crc16.test.ts` |
| Register decoder | `modbus/register-decoder.ts` | `tests/unit/register-decoder.test.ts` |
| Validation | `telemetry/validation.ts` | `tests/unit/mapper.test.ts` |
| Telemetry mapper | `telemetry/mapper.ts` | `tests/unit/mapper.test.ts` |
| Batch queue | `queue/in-memory-batch-queue.ts` | `tests/unit/batch-queue.test.ts` |
| Database writer | `database/batch-writer.ts` | `tests/unit/batch-writer.test.ts` |

> **Why we LISTEN (not connect):** the X5050 is configured as a **TCP client**, so
> it dials us. The backend exposes a TCP listener on **4196** and, per accepted
> socket, becomes the Modbus master issuing FC03 reads. See
> [docs/architecture.md](docs/architecture.md#transport-model).

## Quick start

### With Docker (recommended)
```bash
cp .env.example .env
mkdir -p secrets && cp secrets/db_password.txt.example secrets/db_password.txt   # set a real password
docker compose up -d --build          # postgres -> migrate (schema+pgvector) -> app
./scripts/healthcheck.sh
```

### Local dev (no hardware) with the mock gateway
```bash
pnpm install
pnpm prisma:generate
# point DATABASE_URL at a local postgres, then:
pnpm dev &                             # start the platform
node --import tsx scripts/mock-gateway.ts 127.0.0.1 4196   # simulate an X5050
curl -s localhost:8080/statistics | jq
```

## Configuration

12-Factor — everything via env (see [.env.example](.env.example) and
[docs/configuration.md](docs/configuration.md)). Register maps are **data**, not
code: [config/devices.yaml](config/devices.yaml). Secrets use Docker Secrets or
the `*_FILE` convention; nothing sensitive is committed.

| Key | Default | Purpose |
|-----|---------|---------|
| `GATEWAY_LISTEN_PORT` | 4196 | TCP listener for gateways |
| `POLL_INTERVAL_MS` | 5000 | Modbus poll cadence |
| `MODBUS_BYTE_ORDER` | ABCD | float32 word/byte order (commissioning knob) |
| `DB_BATCH_SIZE` / `DB_FLUSH_INTERVAL_MS` | 500 / 2000 | flush at N rows **or** N ms |
| `PG_VECTOR_DIMENSION` | 1536 | embedding dim — **not** hardcoded in schema |

## HTTP API

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | liveness (process up) |
| `GET /ready` | readiness (DB + listener reachable) |
| `GET /metrics` | Prometheus exposition |
| `GET /connections` | live gateway connections |
| `GET /statistics` | rollups: records/sec, queue depth, errors |
| `GET /version` | build/version/commit |
| `GET /config` | effective **non-secret** config |

## Testing

```bash
pnpm typecheck        # strict TS, no 'any'
pnpm test             # unit + integration (Vitest)
pnpm test:coverage
```
Unit: CRC, float decoding, framing, batch queue, mapper, writer retry/dead-letter.
Integration: real TCP listener + mock gateway socket; poller end-to-end decode.

## Operations

```bash
docker compose logs -f app          # structured JSON logs
docker compose exec app node --import tsx scripts/... # ad-hoc
./scripts/healthcheck.sh
```
Batch metrics logged at `info` (`rows`, `batch_ms`, `rows_per_sec`); per-record
detail at `debug`. Every line carries `connection_id`/`tenant_id`/`plant_id`/`device_id`
when in scope.

## Further docs
- **[docs/COMMISSIONING-PLAYBOOK.md](docs/COMMISSIONING-PLAYBOOK.md) — add a meter / new plant / new brand: the hard-won lessons (read before touching a live register map)**
- **[docs/server-setup.md](docs/server-setup.md) — host it on a real plant server (start here to deploy)**
- [docs/architecture.md](docs/architecture.md) — layers, transport model, DDD
- [docs/sequence.md](docs/sequence.md) — connection & poll sequence diagrams
- [docs/database.md](docs/database.md) — schema, indexes, pgvector
- [docs/configuration.md](docs/configuration.md) — every env var
- [docs/deployment.md](docs/deployment.md) — Docker, secrets, migrations
- [docs/scaling.md](docs/scaling.md) — horizontal scale, partitioning, tuning
- [docs/operations.md](docs/operations.md) — backup, DR, troubleshooting
- [docs/kafka-migration.md](docs/kafka-migration.md) — swapping the queue for Kafka
