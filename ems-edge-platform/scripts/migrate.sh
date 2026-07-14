#!/usr/bin/env bash
# =============================================================================
# migrate.sh — idempotent schema provisioning, run by the `migrate` compose job.
#   1) resolve DATABASE_URL from the mounted secret (DATABASE_URL_FILE)
#   2) prisma migrate deploy  -> energy_telemetry + indexes
#   3) apply-sql.ts           -> pgvector ext + plant_knowledge_base (configurable dim)
#
# Safe to run on every deploy: both steps are idempotent.
# =============================================================================
set -euo pipefail

# The Prisma CLI reads DATABASE_URL from the environment, so hydrate it from the
# secret file here (the app itself does this natively via packages/config).
if [[ -n "${DATABASE_URL_FILE:-}" && -f "${DATABASE_URL_FILE}" ]]; then
  DATABASE_URL="$(cat "${DATABASE_URL_FILE}")"
  export DATABASE_URL
fi

: "${DATABASE_URL:?DATABASE_URL (or DATABASE_URL_FILE) must be set}"
export PG_VECTOR_DIMENSION="${PG_VECTOR_DIMENSION:-1536}"

echo "[migrate] generating Prisma client..."
pnpm prisma:generate

echo "[migrate] applying Prisma migrations (energy_telemetry)..."
pnpm prisma:migrate

echo "[migrate] provisioning pgvector + knowledge base (dim=${PG_VECTOR_DIMENSION})..."
node --import tsx scripts/apply-sql.ts

echo "[migrate] done."
