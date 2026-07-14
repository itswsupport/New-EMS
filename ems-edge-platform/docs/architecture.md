# Architecture

## Principles applied

| Principle | How it shows up here |
|-----------|----------------------|
| **Hexagonal (ports & adapters)** | Domain/infra live in `packages/*` behind interfaces (`BatchQueue`, `TelemetryRepository`, `Transactor`, `ReadinessProbe`). Adapters (Prisma, in-memory queue, TCP socket) are swappable. |
| **Clean Architecture** | Dependencies point inward: apps → packages; packages never import apps. |
| **SOLID** | Single-responsibility files (<400 lines), DIP via injected interfaces, OCP for the queue (Redis/Kafka without touching callers). |
| **DDD** | Ubiquitous language (`TelemetryRecord`, `Quality`, `Device`), value objects (branded `TenantId`/`DeviceId`), the ingestion domain isolated from transport/persistence. |
| **12-Factor** | Config from env (`packages/config`), stateless process, logs to stdout, disposability via graceful shutdown. |
| **Design patterns** | Repository (`*Repository`), Strategy (byte-order decode, swappable queue), Factory (`createLogger`, `createApp`, `createDatabaseClient`), Dependency Injection (composition root). |

## Package map

```
packages/
  common/         Result, DomainError taxonomy, branded ids, backoff — zero deps
  config/         Zod env schema, YAML device-map loader (register maps as data)
  logger/         Pino structured logging, bound-context child loggers
  modbus/         CRC16, RTU codec, stream frame decoder, register/float decoder
  telemetry/      TelemetryRecord model, plausibility validation, reading→record mapper
  queue/          BatchQueue port + in-memory adapter (500-rows / 2s flush)
  database/       Prisma client, TelemetryRepository, DatabaseWriter, KnowledgeRepository
  observability/  prom-client Metrics registry + StatsStore snapshots
apps/
  gateway-listener/  TCP server, Connection (framing), DevicePoller (Modbus master)
  api/               Fastify REST surface (health/ready/metrics/…)
  ingestion-service/ composition root: wires everything, owns lifecycle/shutdown
```

## Transport model

The SenseLive X5050 is configured as a **TCP client** in `Modbus TCP → RTU`
transparent mode. Consequences that shaped the design:

1. **We LISTEN.** `GatewayServer` binds `0.0.0.0:4196` and accepts many gateways.
2. **We are the MASTER.** On each accepted socket, `DevicePoller` issues FC03
   read requests every `POLL_INTERVAL_MS` and decodes responses.
3. **RTU framing over TCP.** The gateway forwards raw RTU bytes (with CRC-16).
   RTU has no length prefix, so `Connection` frames by *expected length* — the
   poller knows each request's response size — and validates CRC before parsing.
4. **Serial bus = one transaction at a time.** Behind the gateway is a single
   RS-485 line; `Connection.transact()` enforces a single in-flight request.

## Quality semantics

Every record gets a `Quality` (`GOOD`/`UNCERTAIN`/`BAD`), OPC-UA style:
- **GOOD** — all configured registers decoded.
- **UNCERTAIN** — partial cycle (some reads failed/timed out).
- **BAD** — nothing decoded, or a physically implausible value (kept, not dropped).

This preserves the "no data loss" guarantee while making data-quality queryable.

## Error taxonomy & flow

`packages/common/errors.ts` defines stable `ErrorCode`s (`CRC_ERROR`,
`MODBUS_EXCEPTION`, `REGISTER_DECODE_ERROR`, `DB_WRITE_ERROR`, …). The hot path
returns `Result<T,E>` rather than throwing, so each stage decides: retry (CRC),
mark UNCERTAIN (timeout), downgrade to BAD (out-of-range), or dead-letter (DB).

## Concurrency & back-pressure

- **Poll overlap guard** — a cycle never starts if the previous is still running.
- **Serialized flush** — the batch queue chains flush handlers so DB writes never
  overlap and ordering holds.
- **Async back-pressure** — enqueue yields when the buffer exceeds a cap, so a
  slow/unavailable DB throttles ingestion instead of exhausting memory.
- **Dead-letter** — a batch that exhausts retries is appended to an NDJSON file
  for replay; it is never silently discarded.
