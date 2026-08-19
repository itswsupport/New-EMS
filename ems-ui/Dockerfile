# =============================================================================
# EMS UI — Next.js standalone build.
# Multi-stage so the runtime image carries no toolchain and no dev dependencies.
# =============================================================================

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# next.config.mjs sets output:"standalone", so this is the whole server.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# Never run the web tier as root; it holds a live database credential.
USER node

EXPOSE 3000
CMD ["node", "server.js"]
