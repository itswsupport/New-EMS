# Deployment Guide

## Prerequisites
- Docker Engine 24+ with Compose v2, on a host with a network leg on the OT subnet.
- One `db_password` secret file (`secrets/db_password.txt`).

## Stack topology (compose)
```
postgres (pgvector/pgvector:pg16, volume ems-pgdata, healthcheck)
   │  service_healthy
   ▼
migrate  (one-shot: prisma migrate deploy + apply-sql.ts, then exits)
   │  service_completed_successfully
   ▼
app      (TCP :4196 + API :8080, non-root, resource limits, healthcheck)
```

## First deploy
```bash
cp .env.example .env

# Two secrets, never committed (secrets/* is gitignored except *.example):
PW='a-strong-password'
printf '%s' "$PW" > secrets/db_password.txt
printf 'postgresql://ems:%s@postgres:5432/ems?schema=public&connection_limit=10' "$PW" \
  > secrets/database_url.txt

docker compose up -d --build
docker compose logs -f migrate     # watch schema + pgvector provisioning
./scripts/healthcheck.sh
```

> **Host is `postgres`, not `localhost`,** in `database_url.txt` — the app resolves
> the DB by its compose service name on the `ems-net` network.

## Automatic schema migration
The `migrate` job runs on every `up`:
1. `prisma migrate deploy` → `energy_telemetry` + indexes (idempotent).
2. `apply-sql.ts` → `CREATE EXTENSION vector` + `plant_knowledge_base` at the
   configured `PG_VECTOR_DIMENSION` (idempotent, `IF NOT EXISTS`).

`app` waits for the migrate job to complete successfully before starting.

## Secrets in production
- DB password: Docker/Swarm/K8s secret mounted at `/run/secrets/db_password`.
  The entrypoint composes `DATABASE_URL` from it at container start — the secret
  never appears in the image or `docker inspect` env.
- For cloud DBs, prefer `DATABASE_URL_FILE` pointing at a mounted secret.

## Kubernetes notes
- Map `/health`→livenessProbe, `/ready`→readinessProbe.
- `SIGTERM` triggers graceful drain; set `terminationGracePeriodSeconds` ≥
  `SHUTDOWN_TIMEOUT_MS/1000 + buffer`.
- Run schema provisioning as an init container or a Job with the `build` image
  target and `bash scripts/migrate.sh`.
- One Deployment per plant/gateway group; scale via `PLANT_ID` + separate configs.

## Upgrades
```bash
docker compose build app
docker compose up -d app       # rolling; graceful shutdown drains in-flight batch
```

## Fleet rollout (12 plants → hundreds of gateways)
- Bake the image once; parameterize per site with `.env` + `devices.yaml`.
- Distribute via GitOps/Ansible/Balena/K8s; see [scaling.md](scaling.md).
