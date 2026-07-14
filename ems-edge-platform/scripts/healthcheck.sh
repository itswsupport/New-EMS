#!/usr/bin/env bash
# healthcheck.sh — end-to-end probe of a running deployment.
set -uo pipefail
API="${API_URL:-http://localhost:8080}"
GW_PORT="${GATEWAY_LISTEN_PORT:-4196}"
FAIL=0
chk() { if eval "$2" >/dev/null 2>&1; then echo "  ok  $1"; else echo "  XX  $1"; FAIL=1; fi; }

echo "== ems-edge-platform health =="
chk "docker engine"        "docker info"
chk "postgres container"   "[ \"$(docker inspect -f '{{.State.Health.Status}}' ems-postgres 2>/dev/null)\" = healthy ]"
chk "app /health"          "curl -fsS $API/health"
chk "app /ready"           "curl -fsS $API/ready"
chk "gateway listener :$GW_PORT" "bash -c 'exec 3<>/dev/tcp/localhost/$GW_PORT'"
chk "metrics exposed"      "curl -fsS $API/metrics | grep -q ems_records_ingested_total"
echo "== $( [ $FAIL -eq 0 ] && echo HEALTHY || echo DEGRADED ) =="
exit "$FAIL"
