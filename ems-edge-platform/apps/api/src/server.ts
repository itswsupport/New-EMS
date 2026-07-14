import Fastify, { type FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { Logger } from "@ems/logger";
import type { Metrics } from "@ems/observability";
import type {
  ReadinessProbe,
  SafeConfigView,
  StatsProvider,
  VersionInfo,
} from "./types.js";

export interface ApiOptions {
  readonly host: string;
  readonly port: number;
  readonly metricsEnabled: boolean;
  readonly rateLimitMax: number;
  readonly rateLimitWindowMs: number;
}

export interface ApiDeps {
  readonly log: Logger;
  readonly metrics: Metrics;
  readonly readiness: ReadinessProbe;
  readonly stats: StatsProvider;
  readonly version: VersionInfo;
  readonly safeConfig: SafeConfigView;
}

/**
 * HTTP API — operational surface for orchestrators, dashboards, and humans.
 * Fastify is chosen for its low overhead and first-class JSON schema support.
 * All handlers are thin: they read from injected providers and never touch the
 * ingestion internals directly.
 */
export async function buildApiServer(
  opts: ApiOptions,
  deps: ApiDeps,
): Promise<FastifyInstance> {
  // Fastify's own logger is disabled: this service logs deliberately via Pino in
  // the pipeline, and health/metric scrapes would otherwise be very noisy.
  const app = Fastify({ logger: false, trustProxy: true });
  deps.log.debug("building HTTP API");

  await app.register(rateLimit, {
    max: opts.rateLimitMax,
    timeWindow: opts.rateLimitWindowMs,
  });

  // ---- Liveness: is the process up? (never checks dependencies) --------------
  app.get("/health", async (_req, reply) => {
    const alive = deps.readiness.isAlive();
    return reply.code(alive ? 200 : 503).send({ status: alive ? "ok" : "down" });
  });

  // ---- Readiness: can we serve? (DB + listener reachable) --------------------
  app.get("/ready", async (_req, reply) => {
    const { ready, details } = await deps.readiness.checkReady();
    return reply.code(ready ? 200 : 503).send({ ready, details });
  });

  // ---- Prometheus scrape endpoint -------------------------------------------
  app.get("/metrics", async (_req, reply) => {
    if (!opts.metricsEnabled) return reply.code(404).send({ error: "metrics disabled" });
    reply.header("Content-Type", deps.metrics.contentType);
    return reply.send(await deps.metrics.render());
  });

  // ---- Live gateway connections ---------------------------------------------
  app.get("/connections", async () => ({
    connections: deps.stats.listConnections(),
  }));

  // ---- Rollup statistics -----------------------------------------------------
  app.get("/statistics", async () => deps.stats.statistics());

  // ---- Build/version info ----------------------------------------------------
  app.get("/version", async () => deps.version);

  // ---- Effective (non-secret) config ----------------------------------------
  app.get("/config", async () => deps.safeConfig);

  return app;
}
