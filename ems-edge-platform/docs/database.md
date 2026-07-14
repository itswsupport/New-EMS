# Database Schema

PostgreSQL 16 with the **pgvector** extension. Two concerns:
1. **`energy_telemetry`** — high-volume time-series (Prisma-managed).
2. **`plant_knowledge_base`** — AI/RAG store with a **configurable** embedding
   dimension (SQL-managed; Prisma cannot parametrize `vector(N)`).

## energy_telemetry

| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | surrogate key |
| device_id | TEXT | meter id (e.g. `meter07`) |
| tenant_id | TEXT | multi-tenant partition axis |
| plant_id | TEXT | site axis |
| timestamp | TIMESTAMPTZ | sample time (poll completion) |
| voltage … thd | DOUBLE PRECISION (nullable) | electrical measurements |
| quality | VARCHAR(16) | GOOD / UNCERTAIN / BAD |
| created_at | TIMESTAMPTZ default now() | ingestion time |

**Indexes** (the three primary query axes):
```
idx_telemetry_device_ts (device_id, timestamp)
idx_telemetry_tenant_ts (tenant_id, timestamp)
idx_telemetry_plant_ts  (plant_id,  timestamp)
```

Managed by Prisma migration `0001_init`
([packages/database/prisma/migrations](../packages/database/prisma/migrations)).
`createMany` batch inserts only — never row-by-row.

## plant_knowledge_base (pgvector / RAG)

Provisioned by
[prisma/sql/01_knowledge_base.sql.template](../packages/database/prisma/sql/01_knowledge_base.sql.template),
applied by [scripts/apply-sql.ts](../scripts/apply-sql.ts) which substitutes
`${PG_VECTOR_DIMENSION}` (default 1536) — **dimension is configuration**.

| Column | Type |
|--------|------|
| id | BIGINT IDENTITY PK |
| tenant_id | TEXT |
| document_title | TEXT |
| content_chunk | TEXT |
| metadata | JSONB |
| embedding | `vector(${PG_VECTOR_DIMENSION})` |
| created_at | TIMESTAMPTZ |

Indexes: `idx_kb_tenant (tenant_id)`, HNSW `idx_kb_embedding_hnsw` for cosine ANN.
Access via `KnowledgeRepository` (typed `$queryRaw`) — insert + cosine `searchSimilar`.

## Scaling the time-series table

For millions of rows/day, convert `energy_telemetry` to time-partitioned storage
(see [scaling.md](scaling.md)):
- **TimescaleDB hypertable** (`create_hypertable`) + compression + retention, or
- **native declarative partitioning** by month with a BRIN index on `timestamp`.

Both are drop-in behind `TelemetryRepository`; ingestion code is unaffected.
