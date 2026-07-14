# ems-edge

Production-ready **Industrial IoT Edge Node** for an Enterprise Energy
Management System (EMS).

It reads Modbus TCP energy-meter data from a **SenseLive X5050** gateway,
converts it into structured **JSON**, and publishes it to a local **MQTT**
broker — ready for secure cloud transmission. Designed to be replicated across
hundreds of gateways by changing only `.env`.

---

## Table of contents

1. [Architecture](#architecture)
2. [Prerequisites](#prerequisites)
3. [Installation](#installation)
4. [Configuration](#configuration)
5. [Running](#running)
6. [Stopping](#stopping)
7. [Restarting](#restarting)
8. [Viewing logs](#viewing-logs)
9. [Health checks](#health-checks)
10. [Modbus testing](#modbus-testing)
11. [MQTT testing](#mqtt-testing)
12. [Expected output](#expected-output)
13. [Troubleshooting](#troubleshooting)
14. [Securing the broker](#securing-the-broker-production)
15. [Project layout](#project-layout)

---

## Architecture

```
LM1360 meters ──RTU 9600 8N1──► SenseLive X5050 ──Modbus TCP :4196──► Telegraf
   SID 7/10/11                     192.168.6.56                          │ JSON
                                                                          ▼
                                                                     Mosquitto :1883
                                                                          │ MQTT
                                                                          ▼
                                             ems/plant01/meter07 | meter10 | meter11
```

Two containers on a private `ems-net` bridge network:

| Service    | Image                 | Purpose                                     |
|------------|-----------------------|---------------------------------------------|
| Mosquitto  | `eclipse-mosquitto:2` | Local MQTT broker (persistence + logging)   |
| Telegraf   | `telegraf:1.30`       | Modbus poll → JSON → MQTT publish (5 s)      |

Full details in [`docs/architecture.md`](docs/architecture.md),
[`docs/network.md`](docs/network.md), and
[`docs/deployment.md`](docs/deployment.md).

---

## Prerequisites

- Linux host (or Windows/macOS with Docker Desktop for dev).
- **Docker Engine 24+** with the **Compose v2** plugin
  (`docker compose version`).
- Network access from the host to the gateway at `192.168.6.56:4196`.
- Meters wired to the X5050 and answering on slave IDs `7`, `10`, `11`.

---

## Installation

```bash
# 1. Get the project onto the edge host
cd ems-edge

# 2. Review configuration (nothing secret here — see Configuration)
$EDITOR .env

# 3. Make scripts executable (first time only)
chmod +x scripts/*.sh
```

> On Windows dev machines, run the `.sh` scripts from **Git Bash** or **WSL**,
> or just use the `docker compose ...` commands directly.

---

## Configuration

All tunables live in [`.env`](.env):

| Variable          | Default          | Meaning                                        |
|-------------------|------------------|------------------------------------------------|
| `GATEWAY_IP`      | `192.168.6.56`   | X5050 gateway IP                               |
| `GATEWAY_PORT`    | `4196`           | X5050 Modbus TCP port                          |
| `MQTT_HOST`       | `mosquitto`      | Broker host **as seen by Telegraf** (service name) |
| `MQTT_PORT`       | `1883`           | Broker port (host-mapped **and** internal)     |
| `POLL_INTERVAL`   | `5s`             | Modbus polling / MQTT publish interval         |
| `PLANT_ID`        | `plant01`        | Site id → topic + client id                    |
| `TENANT_ID`       | `rucha-group`    | Customer/company id (tag)                       |

> **Why `MQTT_HOST=mosquitto`?** Telegraf runs *inside* the Docker network and
> reaches the broker by its service name. Host-side tools (your laptop) use
> `localhost` instead.

Meter register map & byte order live in
[`configs/telegraf/telegraf.conf`](configs/telegraf/telegraf.conf).

---

## Running

```bash
./scripts/start.sh
# equivalent to: docker compose up -d
```

Then verify:

```bash
./scripts/healthcheck.sh
```

---

## Stopping

```bash
./scripts/stop.sh
# equivalent to: docker compose down   (data/ and logs/ are preserved)
```

---

## Restarting

```bash
./scripts/restart.sh
# reloads .env + config changes: docker compose up -d --force-recreate
```

---

## Viewing logs

```bash
./scripts/logs.sh              # follow both services
./scripts/logs.sh telegraf     # follow Telegraf only
./scripts/logs.sh mosquitto    # follow Mosquitto only
```

Persistent logs on disk:

| What              | Path                          |
|-------------------|-------------------------------|
| Mosquitto log     | `logs/mosquitto/mosquitto.log`|
| Telegraf metrics  | `logs/telegraf/metrics.out`   |
| Broker persistence| `data/mosquitto/`             |

---

## Health checks

```bash
./scripts/healthcheck.sh
```

Verifies, in order:

1. Docker engine running
2. `ems-mosquitto` container running
3. `ems-telegraf` container running
4. Gateway `192.168.6.56:4196` reachable (TCP)
5. Live MQTT message present on `ems/<PLANT_ID>/#`

Exit code `0` = healthy, non-zero = degraded.

---

## Modbus testing

Confirm the gateway/meters independently of Telegraf. Run a throwaway
`modbus-cli` container **on the same network**:

```bash
# Read 2 holding registers starting at 0 (voltage) from slave 7
docker run --rm --network ems-net dersimn/modbus-tools \
  modbus-cli --host 192.168.6.56 --port 4196 \
  --slave 7 --read-holding-registers 0 2
```

Or with `mbpoll` on the host (`apt install mbpoll`):

```bash
# Slave 7, holding registers, 32-bit float, read V/I/P/E addresses
mbpoll -a 7 -t 4:float -r 1  -c 2 192.168.6.56 -p 4196   # voltage @ 0
mbpoll -a 7 -t 4:float -r 7  -c 2 192.168.6.56 -p 4196   # current @ 6
mbpoll -a 7 -t 4:float -r 53 -c 2 192.168.6.56 -p 4196   # power   @ 52
mbpoll -a 7 -t 4:float -r 73 -c 2 192.168.6.56 -p 4196   # energy  @ 72
```

> `mbpoll` uses 1-based addressing (`-r 1` = register 0). Telegraf uses 0-based.

Dry-run Telegraf's own read cycle (no MQTT publish):

```bash
docker exec ems-telegraf telegraf --config /etc/telegraf/telegraf.conf --test
```

---

## MQTT testing

Subscribe from the host (needs `mosquitto-clients`) or via the broker container:

```bash
# Via the broker container (no host tools needed)
docker exec -it ems-mosquitto mosquitto_sub -t 'ems/#' -v

# From the host
mosquitto_sub -h localhost -p 1883 -t 'ems/#' -v
```

Publish a test message:

```bash
docker exec -it ems-mosquitto mosquitto_pub -t 'ems/plant01/test' -m 'hello'
```

---

## Expected output

Within ~5 s of start-up you should see one message per meter, per interval:

```text
ems/plant01/meter07 {"fields":{"current":4.12,"energy":15230.5,"power":985.0,"voltage":239.8},"name":"energy","tags":{"gateway":"senselive-x5050","host":"telegraf","meter":"meter07","plant":"plant01","slave_id":"7","tenant":"rucha-group"},"timestamp":1700000000000}
ems/plant01/meter10 {"fields":{"current":3.05,"energy":8123.9,"power":712.4,"voltage":241.1},"name":"energy","tags":{"meter":"meter10","slave_id":"10", ...},"timestamp":1700000000000}
ems/plant01/meter11 {"fields":{"current":5.77,"energy":20456.2,"power":1320.6,"voltage":238.6},"name":"energy","tags":{"meter":"meter11","slave_id":"11", ...},"timestamp":1700000000000}
```

> Numeric values are illustrative. If **voltage looks like `0` or a huge/NaN
> number**, it's almost always **byte order** — see Troubleshooting.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| No MQTT messages at all | Telegraf can't reach gateway | `./scripts/healthcheck.sh`; check OT network + `GATEWAY_IP`/`PORT` |
| `connection refused` in Telegraf logs | Broker not up / wrong host | Ensure `MQTT_HOST=mosquitto`; `docker compose ps` |
| Voltage = 0 / NaN / wildly wrong | Wrong **byte order** | In `telegraf.conf` change `ABCD` → `CDAB` → `DCBA` → `BADC`, restart |
| Values off by fixed factor | Meter returns scaled ints, not float | Change `data_type`/`scale` per meter datasheet |
| `modbus: exception 'illegal data address'` | Wrong register / meter not float here | Verify LM1360 map; test with `mbpoll` |
| Only some meters report | Slave offline / wiring / termination | Check RS-485 wiring, termination, slave IDs on gateway |
| Timeouts under load | RS-485 chain slow | Raise `timeout`/`busy_retries` in `telegraf.conf`, gateway response timeout |
| Permission denied on `logs/`/`data/` | Bind-mount ownership | `mkdir -p` the dirs (start.sh does this) / fix host perms |

Useful commands:

```bash
docker compose ps
./scripts/logs.sh telegraf
docker exec ems-telegraf telegraf --config /etc/telegraf/telegraf.conf --test
```

---

## Securing the broker (production)

Anonymous access is **development-only**. Before go-live:

1. **Disable anonymous + add users** — edit `configs/mosquitto/mosquitto.conf`:
   ```conf
   allow_anonymous false
   password_file /mosquitto/config/passwd
   ```
   Create the password file:
   ```bash
   docker exec -it ems-mosquitto mosquitto_passwd -c /mosquitto/config/passwd emsedge
   ```
   Add the credentials to Telegraf's `outputs.mqtt` (`username`/`password`),
   sourced from Docker secrets — **not** committed to `.env`.

2. **Enable TLS** — add an 8883 listener with `cafile`/`certfile`/`keyfile`,
   and point Telegraf at `ssl://mosquitto:8883`.

3. **Add ACLs** — scope each edge node to its own `ems/<tenant>/<plant>/#`.

See [`docs/deployment.md`](docs/deployment.md) §5 for the full checklist.

---

## Project layout

```
ems-edge/
├── docker-compose.yml
├── README.md
├── .env
├── .gitignore
├── configs/
│   ├── telegraf/telegraf.conf
│   └── mosquitto/mosquitto.conf
├── scripts/
│   ├── start.sh  stop.sh  restart.sh  logs.sh  healthcheck.sh
├── logs/            # persistent logs (gitignored)
├── data/            # broker persistence (gitignored)
└── docs/
    ├── architecture.md
    ├── network.md
    └── deployment.md
```
