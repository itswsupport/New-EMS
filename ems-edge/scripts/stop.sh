#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# stop.sh — stop and remove the ems-edge containers (data/logs are preserved)
# -----------------------------------------------------------------------------
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

echo "[ems-edge] Stopping stack..."
docker compose down

echo "[ems-edge] Stopped. Volumes on ./data and ./logs are retained."
