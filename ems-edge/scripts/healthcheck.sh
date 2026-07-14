#!/usr/bin/env bash
# =============================================================================
# healthcheck.sh — end-to-end health of the ems-edge node
# Verifies: Docker | Mosquitto | Telegraf | Gateway reachable | MQTT publishing
# Exit code 0 = all healthy, non-zero = at least one check failed.
# =============================================================================
set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# Load .env so we can read gateway/broker coordinates
set -a
# shellcheck disable=SC1091
[[ -f .env ]] && source .env
set +a

GATEWAY_IP="${GATEWAY_IP:-192.168.6.56}"
GATEWAY_PORT="${GATEWAY_PORT:-4196}"
PLANT_ID="${PLANT_ID:-plant01}"
# From the HOST we reach the broker on localhost, not the compose service name.
HOST_MQTT_HOST="localhost"
HOST_MQTT_PORT="${MQTT_PORT:-1883}"

FAIL=0
pass() { printf '  \033[32m✔\033[0m %s\n' "$1"; }
fail() { printf '  \033[31mx\033[0m %s\n' "$1"; FAIL=1; }

echo "=============================================="
echo " ems-edge health check  (plant: ${PLANT_ID})"
echo "=============================================="

# 1) Docker daemon --------------------------------------------------------------
echo "[1/5] Docker engine"
if docker info >/dev/null 2>&1; then pass "Docker daemon is running"; else fail "Docker daemon NOT reachable"; fi

# 2) Mosquitto container --------------------------------------------------------
echo "[2/5] Mosquitto container"
if [[ "$(docker inspect -f '{{.State.Running}}' ems-mosquitto 2>/dev/null)" == "true" ]]; then
  pass "ems-mosquitto is running"
else
  fail "ems-mosquitto is NOT running"
fi

# 3) Telegraf container ---------------------------------------------------------
echo "[3/5] Telegraf container"
if [[ "$(docker inspect -f '{{.State.Running}}' ems-telegraf 2>/dev/null)" == "true" ]]; then
  pass "ems-telegraf is running"
else
  fail "ems-telegraf is NOT running"
fi

# 4) Gateway reachability (TCP to X5050) ---------------------------------------
echo "[4/5] Gateway ${GATEWAY_IP}:${GATEWAY_PORT}"
if command -v nc >/dev/null 2>&1; then
  if nc -z -w 3 "$GATEWAY_IP" "$GATEWAY_PORT" >/dev/null 2>&1; then
    pass "Gateway TCP port is open"
  else
    fail "Gateway TCP port unreachable"
  fi
else
  # Fallback: /dev/tcp (bash builtin)
  if timeout 3 bash -c "exec 3<>/dev/tcp/${GATEWAY_IP}/${GATEWAY_PORT}" >/dev/null 2>&1; then
    pass "Gateway TCP port is open (via /dev/tcp)"
  else
    fail "Gateway TCP port unreachable (install 'nc' for a reliable check)"
  fi
fi

# 5) MQTT publishing ------------------------------------------------------------
echo "[5/5] MQTT publishing on ems/${PLANT_ID}/#"
# Prefer the mosquitto_sub inside the broker container (no host deps needed).
MSG="$(docker exec ems-mosquitto \
        mosquitto_sub -h localhost -t "ems/${PLANT_ID}/#" -C 1 -W 8 2>/dev/null || true)"
if [[ -n "$MSG" ]]; then
  pass "Live message received on ems/${PLANT_ID}/#"
  echo "      sample: $(echo "$MSG" | head -c 160)"
else
  fail "No message within 8s (check gateway wiring, slave IDs, byte order)"
fi

echo "=============================================="
if [[ "$FAIL" -eq 0 ]]; then
  echo " RESULT: HEALTHY"
else
  echo " RESULT: DEGRADED — see failures above"
fi
echo "=============================================="
exit "$FAIL"
