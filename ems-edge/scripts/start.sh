#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# start.sh — bring the ems-edge stack up in the background
# -----------------------------------------------------------------------------
set -euo pipefail

# Always operate from the project root, regardless of where the script is called
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# Ensure runtime dirs exist (bind mounts fail on some hosts if missing)
mkdir -p logs/mosquitto logs/telegraf data/mosquitto

echo "[ems-edge] Starting stack..."
docker compose up -d

echo "[ems-edge] Containers:"
docker compose ps
echo "[ems-edge] Up. Tail logs with:  ./scripts/logs.sh"
