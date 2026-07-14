# =============================================================================
# Multi-stage Dockerfile — ems-edge-platform
# Stage 0 (base)    : node + OpenSSL (Prisma's engines REQUIRE libssl; the slim
#                     image ships without it and Prisma fails at runtime)
# Stage 1 (deps)    : install workspace deps (cached on lockfile change)
# Stage 2 (build)   : generate Prisma client + typecheck (type error = failed build)
# Stage 3 (runtime) : slim, non-root, runs via tsx
# =============================================================================

# ---- Stage 0: base image with OpenSSL ---------------------------------------
FROM node:22-bookworm-slim AS base
# Prisma needs libssl/openssl; ca-certificates for TLS to managed Postgres.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# ---- Stage 1: dependencies --------------------------------------------------
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
# Copy every workspace manifest so pnpm can resolve the graph before sources.
COPY packages/ ./packages/
COPY apps/ ./apps/
# Strict: a stale lockfile must FAIL the build, never silently re-resolve.
RUN pnpm install --frozen-lockfile

# ---- Stage 2: build / verify ------------------------------------------------
FROM deps AS build
COPY . .
# Generate the typed Prisma client, then typecheck the whole repo.
RUN pnpm prisma:generate && pnpm typecheck

# ---- Stage 3: runtime -------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production

# Resolved node_modules (incl. generated Prisma client) + sources.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps ./apps
COPY --from=build /app/config ./config
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/tsconfig.base.json ./tsconfig.json

# Runtime data dir (dead-letter file) owned by the non-root user.
RUN mkdir -p /app/logs && chown -R node:node /app
USER node

# gateway TCP listener + HTTP API
EXPOSE 4196 8080

# tsx runs TS directly with tsconfig path aliases resolved — no separate emit.
CMD ["node", "--import", "tsx", "apps/ingestion-service/src/main.ts"]
