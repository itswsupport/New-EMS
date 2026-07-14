# Server Setup — On-Prem Edge Node (Ubuntu/Debian)

Step-by-step runbook to host `ems-edge-platform` on a Linux server inside the
plant. Assumes SSH + sudo/root.

> **THE ONE CONSTRAINT THAT DRIVES EVERYTHING**
> The SenseLive X5050 is a **TCP client** — it *dials into* this server on
> **port 4196**. So the server must sit on a network the gateway can reach
> (same subnet as `192.168.6.56`, or routable to it). The gateway initiates;
> we listen. Get this wrong and nothing else matters.

Placeholders used below — substitute your real values:

| Placeholder | Meaning | Example |
|---|---|---|
| `EDGE_IP` | this server's static IP on the OT subnet | `192.168.6.10` |
| `GATEWAY_IP` | the X5050 | `192.168.6.56` |

---

## Step 1 — Provision the server

Minimum for one plant (3 meters @ 5 s is trivial load; size for headroom + DB):

| Resource | Minimum | Recommended |
|---|---|---|
| CPU | 2 cores | 4 cores |
| RAM | 4 GB | 8 GB |
| Disk | 40 GB SSD | 100 GB SSD (telemetry grows) |
| OS | Ubuntu 22.04 / 24.04 LTS (or Debian 12) | same |
| Network | one NIC on the OT subnet | + separate NIC for IT/uplink |

Set a **static IP** (`EDGE_IP`) — the gateway will be configured to dial it, so
it must never change via DHCP.

```bash
# Verify basics
hostnamectl
ip -4 addr show          # confirm EDGE_IP is present
timedatectl              # NTP must be active — telemetry timestamps depend on it
```

## Step 2 — Prove the gateway is reachable (do this FIRST)

Do not proceed until this passes. If the server can't see the gateway, the
gateway can't see the server.

```bash
sudo apt-get update && sudo apt-get install -y iputils-ping netcat-openbsd
ping -c 3 GATEWAY_IP
```

## Step 3 — Install Docker Engine (free, Apache-2.0)

**Not Docker Desktop** — that's the one component with a paid licence for large
companies. Docker *Engine* on Linux is free at any scale.

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin

sudo systemctl enable --now docker
docker --version && docker compose version   # compose v2 (space, not hyphen)
```

## Step 4 — Deploy the code

```bash
sudo mkdir -p /opt/ems-edge-platform
sudo chown "$USER":"$USER" /opt/ems-edge-platform

# From your machine (or git clone if you've pushed it):
#   rsync -av --exclude node_modules --exclude .env --exclude secrets \
#     ./ems-edge-platform/ user@EDGE_IP:/opt/ems-edge-platform/
cd /opt/ems-edge-platform
```

## Step 5 — Configure

```bash
cp .env.example .env
nano .env
```
Set at minimum:
```ini
GATEWAY_LISTEN_PORT=4196
POLL_INTERVAL_MS=5000
MODBUS_BYTE_ORDER=ABCD        # commissioning knob — see Step 9
PLANT_ID=plant01              # UNIQUE per site
TENANT_ID=rucha-engineers
```

Register map — confirm slaves/addresses match the meters:
```bash
nano config/devices.yaml
```

## Step 6 — Create the secrets (never committed)

```bash
mkdir -p secrets
PW="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"   # strong, random

printf '%s' "$PW" > secrets/db_password.txt
printf 'postgresql://ems:%s@postgres:5432/ems?schema=public&connection_limit=10' "$PW" \
  > secrets/database_url.txt

# PERMISSIONS MATTER — read this before changing them.
chmod 0700 secrets          # host: only root can even enter the directory
chmod 0444 secrets/*.txt    # container: readable by the non-root app user
```

> ### ⚠️ Why `0444` and not `0600`
> The app container runs as the **non-root `node` user (uid 1000)** and Postgres
> runs as `postgres` (uid 999). Compose bind-mounts file secrets into the
> container **preserving the host's ownership and mode**. A root-owned `0600`
> secret is therefore *unreadable inside the container*, and the app crash-loops
> with `EACCES: permission denied, open '/run/secrets/database_url'`.
>
> The security boundary is the **directory**, not the file: `secrets/` at `0700`
> root-owned means no other host user can traverse into it, while the Docker
> daemon (root) can still mount the file in. That gives you both a readable
> secret inside the container and a protected one on the host.

> The DB host is **`postgres`** (the compose service name), *not* `localhost` —
> the app reaches it over the internal `ems-net` network.

## Step 7 — Firewall: only the gateway may reach 4196

The Modbus listener has no authentication (Modbus has none). Lock it to the
gateway's IP. The HTTP API is already bound to loopback by the prod overlay.

```bash
sudo apt-get install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from 192.168.6.0/24 to any port 22 proto tcp   # SSH from plant LAN
sudo ufw allow from GATEWAY_IP to any port 4196 proto tcp     # ONLY the X5050
sudo ufw enable
sudo ufw status verbose
```
> Port **8080 is deliberately absent** — `docker-compose.prod.yml` binds it to
> `127.0.0.1`. Reach it via SSH tunnel: `ssh -L 8080:localhost:8080 user@EDGE_IP`.

## Step 8 — Launch

```bash
cd /opt/ems-edge-platform
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

docker compose logs -f migrate      # expect: migrations applied + pgvector dim=1536
docker compose ps                   # expect: ems-app + ems-postgres = healthy
```

Auto-start on reboot:
```bash
sudo cp deploy/ems-edge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ems-edge
systemctl status ems-edge
```

## Step 9 — Point the gateway at the server, then commission

On the **X5050 web UI**:

| Setting | Value |
|---|---|
| Work mode | **TCP Client** |
| Remote server IP | `EDGE_IP` ← this server |
| Remote server port | `4196` |
| Serial | 9600 / 8 / None / 1 |
| Protocol | Modbus TCP → RTU |

Then verify the connection landed and data is sane:
```bash
curl -s localhost:8080/connections | jq   # expect 1 connection from GATEWAY_IP
curl -s localhost:8080/statistics  | jq   # recordsIngested climbing, crcErrors 0

docker compose exec -T postgres psql -U ems -d ems -c \
 "SELECT device_id, quality, round(voltage::numeric,1) v, round(current::numeric,2) a,
         round(active_power::numeric,1) w
  FROM energy_telemetry ORDER BY id DESC LIMIT 6;"
```

**Commissioning the byte order** — the one thing that can't be pre-validated.
If voltage reads `0`, `NaN`, or something absurd like `1e38`, the float word
order is wrong. Cycle it:
```bash
sed -i 's/MODBUS_BYTE_ORDER=.*/MODBUS_BYTE_ORDER=CDAB/' .env
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d app
# try in order: ABCD -> CDAB -> DCBA -> BADC until volts read ~230-240
```
Sanity target: **voltage ≈ 230–240 V, frequency ≈ 50 Hz**.

## Step 10 — Backups + monitoring

```bash
sudo mkdir -p /opt/ems-backups && sudo chown "$USER":"$USER" /opt/ems-backups
chmod +x scripts/backup.sh
crontab -e
# 0 2 * * * /opt/ems-edge-platform/scripts/backup.sh >> /var/log/ems-backup.log 2>&1
```

Watch these three metrics (`/metrics`, scraped locally by Prometheus):

| Metric | Meaning if it moves |
|---|---|
| `ems_crc_errors_total` | RS-485 wiring/noise or wrong baud on the gateway |
| `ems_queue_depth` | DB can't keep up — partition/pool (see scaling.md) |
| `ems_dead_lettered_total` | DB outage exhausted retries — **replay the NDJSON** |

## Step 11 — Verify the whole node

```bash
./scripts/healthcheck.sh
```

---

## Rollout to the other 11 plants

The image is identical everywhere. **Only three things change per site:**

1. `.env` → `PLANT_ID`, and `GATEWAY_IP` if you're polling outward
2. `config/devices.yaml` → that plant's meters/slave IDs
3. `secrets/*` → a fresh DB password per node

Everything else (image, compose, systemd unit, firewall rules) is copy-paste.
Automate with Ansible once site #2 is proven by hand.

## Common problems

| Symptom | Cause | Fix |
|---|---|---|
| `/connections` empty | gateway not dialing in | X5050 must be **TCP Client** → `EDGE_IP:4196`; check `ufw` allows GATEWAY_IP |
| Connection appears then drops | idle timeout / gateway reset | raise `CONNECTION_TIMEOUT_MS`; check cabling |
| Voltage absurd / NaN | wrong byte order | cycle `MODBUS_BYTE_ORDER` (Step 9) |
| `crcErrors` climbing | serial noise, wrong baud, no termination | verify 9600 8N1 on gateway; 120Ω at both bus ends |
| `quality=UNCERTAIN` | read timeouts on some registers | raise `MODBUS_TIMEOUT_MS` / `MODBUS_MAX_RETRIES` |
| `ems-app` crash-loops, `EACCES ... /run/secrets/...` | secret is root-owned `0600`; container runs as non-root | `chmod 0444 secrets/*.txt` + `chmod 0700 secrets` (see Step 6) |
| App can't reach DB but Postgres is healthy | `.env` `DATABASE_URL` points at `localhost` | the mounted `DATABASE_URL_FILE` secret overrides it — check it says `@postgres:5432`, not `@localhost` |
| Port already allocated | another service on the host owns it (e.g. Jenkins on 8080) | set `API_HOST_PORT=8081` — the container port is unchanged |
| `/ready` → `database:false` | DB down or bad secret | `docker compose logs postgres`; re-check `secrets/database_url.txt` |
| Stack gone after reboot | systemd unit not enabled | `sudo systemctl enable --now ems-edge` |
