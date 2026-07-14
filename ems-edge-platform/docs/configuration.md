# Configuration Guide

All configuration is environment-based (12-Factor). The single source of truth is
the Zod schema [`packages/config/src/env.schema.ts`](../packages/config/src/env.schema.ts):
the process **refuses to start** on an invalid/missing value, with a precise message.

## Secrets

Never commit secrets. Two supported mechanisms:
1. **Docker Secrets** — mount at `/run/secrets/<name>`; compose injects the DB
   password this way (`db_password`).
2. **`*_FILE` convention** — for any `KEY`, set `KEY_FILE=/path` and the loader
   reads the file (see `resolveSecretFiles` in `env.ts`). e.g. `DATABASE_URL_FILE`.

## Reference

### Runtime
| Var | Default | Notes |
|-----|---------|-------|
| `NODE_ENV` | production | `development` enables pretty logs |
| `LOG_LEVEL` | info | trace…fatal |
| `SERVICE_NAME` | ems-edge-platform | base log/metric label |

### Gateway listener
| Var | Default | Notes |
|-----|---------|-------|
| `GATEWAY_LISTEN_HOST` | 0.0.0.0 | bind address |
| `GATEWAY_LISTEN_PORT` | 4196 | X5050 dials this |
| `MAX_CONNECTIONS` | 512 | simultaneous gateways |
| `CONNECTION_TIMEOUT_MS` | 30000 | idle socket timeout |
| `CONNECTION_RATE_LIMIT_PER_MIN` | 120 | per-IP reconnect guard |

### Modbus
| Var | Default | Notes |
|-----|---------|-------|
| `POLL_INTERVAL_MS` | 5000 | poll cadence |
| `MODBUS_TIMEOUT_MS` | 3000 | per-transaction timeout |
| `MODBUS_MAX_RETRIES` | 2 | per-register read retries |
| `MODBUS_BYTE_ORDER` | ABCD | float32 order; commissioning knob |
| `DEVICE_CONFIG_PATH` | ./config/devices.yaml | register map |

### Tenancy
| Var | Default |
|-----|---------|
| `DEFAULT_TENANT_ID` | rucha-engineers |
| `DEFAULT_PLANT_ID` | plant01 |

(Per-device `tenant`/`plant` in `devices.yaml` override these.)

### Database & writer
| Var | Default | Notes |
|-----|---------|-------|
| `DATABASE_URL` | — (required) | native Postgres; **no** Accelerate |
| `PG_VECTOR_DIMENSION` | 1536 | embedding dim |
| `DB_BATCH_SIZE` | 500 | flush at N rows |
| `DB_FLUSH_INTERVAL_MS` | 2000 | …or N ms, whichever first |
| `DB_MAX_RETRIES` | 5 | before dead-letter |
| `DB_RETRY_BACKOFF_MS` | 250 | exp backoff base |
| `DB_DEAD_LETTER_PATH` | ./logs/dead-letter.ndjson | replay file |

### API / observability / lifecycle
| Var | Default |
|-----|---------|
| `API_HOST` / `API_PORT` | 0.0.0.0 / 8080 |
| `METRICS_ENABLED` | true |
| `API_RATE_LIMIT_MAX` / `API_RATE_LIMIT_WINDOW_MS` | 300 / 60000 |
| `SHUTDOWN_TIMEOUT_MS` | 15000 |

## Device register map (`config/devices.yaml`)

Registers are **data**. `defaults` apply unless overridden per register/device.
```yaml
defaults: { functionCode: 3, datatype: float32, quantity: 2, byteOrder: ABCD }
devices:
  - id: meter07
    slave: 7
    tenant: rucha-engineers
    plant: plant01
    registers:
      voltage:       { address: 0 }
      active_power:  { address: 52 }
```
Precedence for byte order: per-register → file `defaults.byteOrder` → `MODBUS_BYTE_ORDER`.
