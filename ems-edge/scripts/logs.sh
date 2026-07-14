#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# logs.sh — follow container logs
# Usage: ./scripts/logs.sh [service]   e.g. ./scripts/logs.sh telegraf
# -----------------------------------------------------------------------------
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

SERVICE="${1:-}"

if [[ -n "$SERVICE" ]]; then
  docker compose logs -f --tail=100 "$SERVICE"
else
  docker compose logs -f --tail=100
fi
