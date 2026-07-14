# ems-edge — Deployment

## 1. Target host prerequisites

- Linux edge host (x86-64 or ARM64) — e.g. industrial PC, IPC, or gateway.
- Docker Engine 24+ with the Compose v2 plugin (`docker compose version`).
- Network leg on the OT subnet that can reach `192.168.6.56:4196`.
- Time synced (NTP) — timestamps in payloads depend on it.

## 2. First-time bring-up

```bash
git clone <your-repo> ems-edge && cd ems-edge
cp .env .env            # review values; set PLANT_ID / TENANT_ID / GATEWAY_IP
./scripts/start.sh
./scripts/healthcheck.sh
```

## 3. Per-site customization

Only `.env` changes between sites:

| Variable      | Change per site |
|---------------|-----------------|
| `GATEWAY_IP`  | ✔ gateway address on that plant's OT subnet |
| `PLANT_ID`    | ✔ unique site id → drives topics + client id |
| `TENANT_ID`   | ✔ customer/company id |
| `POLL_INTERVAL` | usually kept at `5s` |

## 4. Fleet rollout options

- **Ansible:** template `.env`, `docker compose up -d` across the inventory.
- **GitOps (per-edge branch/dir):** commit `.env` per node; agent pulls + applies.
- **Azure IoT Edge / AWS Greengrass / Balena:** wrap the two services as edge
  modules; push updates through the platform's deployment manifest.

## 5. Production hardening (do before go-live)

1. **Broker auth:** disable anonymous, add `password_file` + ACLs (README §Security).
2. **TLS:** add an 8883 listener with `cafile/certfile/keyfile`; point Telegraf's
   `outputs.mqtt` at `ssl://mosquitto:8883` with a CA.
3. **Secrets:** move any credential out of `.env` into Docker secrets / a vault.
   `.env` should stay non-secret operational config only.
4. **Log rotation:** container logs are capped (`max-size`/`max-file`); rotate
   the bind-mounted `logs/` via host `logrotate`.
5. **Resource limits:** add `deploy.resources.limits` (CPU/mem) per service.
6. **Monitoring:** export Telegraf internal metrics + container health to your
   central observability stack.

## 6. Upgrades

```bash
# Pin new image tags in .env, then:
docker compose pull
./scripts/restart.sh
./scripts/healthcheck.sh
```

## 7. Backup

- `data/mosquitto/` — broker persistence (retained/queued messages).
- `configs/` and `.env` — the entire node definition. Keep in version control.
