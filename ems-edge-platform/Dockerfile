# =============================================================================
# Multi-stage Dockerfile — ems-edge-platform
# Stage 1 (deps)    : install ALL workspace deps (cached on lockfile change)
# Stage 2 (build)   : generate Prisma client + typecheck (fail build on type error)
# Stage 3 (runtime) : slim image, non-root, prod deps only, runs via tsx
# =============================================================================

# ---- Stage 1: dependencies --------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* .npmrc ./
# Copy every workspace manifest so pnpm can resolve the graph before sources.
COPY packages/ ./packages/
COPY apps/ ./apps/
RUN pnpm install --frozen-lockfile || pnpm install

# ---- Stage 2: build / verify ------------------------------------------------
FROM deps AS build
WORKDIR /app
COPY . .
# Generate the typed Prisma client, then typecheck the whole repo.
RUN pnpm prisma:generate && pnpm typecheck

# ---- Stage 3: runtime -------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN corepack enable

# Copy resolved node_modules (incl. generated Prisma client) and sources.
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
