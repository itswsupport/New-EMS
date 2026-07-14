#!/usr/bin/env bash
# =============================================================================
# migrate.sh — idempotent schema provisioning, run by the `migrate` compose job.
#   1) inject the DB password from a Docker secret (if present)
#   2) prisma migrate deploy      -> energy_telemetry + indexes
#   3) apply-sql.ts               -> pgvector ext + plant_knowledge_base (dim cfg)
# =============================================================================
set -euo pipefail

# Substitute the __PW__ placeholder with the mounted secret, if provided.
if [[ -f /run/secrets/db_password && -n "${DATABASE_URL:-}" ]]; then
  PW="$(cat /run/secrets/db_password)"
  export DATABASE_URL="${DATABASE_URL//__PW__/$PW}"
fi

: "${DATABASE_URL:?DATABASE_URL must be set}"
export PG_VECTOR_DIMENSION="${PG_VECTOR_DIMENSION:-1536}"

echo "[migrate] generating Prisma client..."
pnpm prisma:generate

echo "[migrate] applying Prisma migrations (energy_telemetry)..."
pnpm prisma:migrate

echo "[migrate] provisioning pgvector + knowledge base (dim=${PG_VECTOR_DIMENSION})..."
node --import tsx scripts/apply-sql.ts

echo "[migrate] done."
