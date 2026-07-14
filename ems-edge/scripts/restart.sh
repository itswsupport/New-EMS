#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# restart.sh — restart services, reloading config changes
# -----------------------------------------------------------------------------
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "[ems-edge] Restarting stack..."
# `up -d` re-reads compose + .env and recreates only what changed.
docker compose up -d --force-recreate

docker compose ps
echo "[ems-edge] Restarted."
