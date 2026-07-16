import type { FastifyInstance } from "fastify";
import type { AppEnv } from "@ems/config";
import { loadDeviceConfig } from "@ems/config";
import { createLogger, type Logger } from "@ems/logger";
import { Metrics, StatsStore } from "@ems/observability";
import { InMemoryBatchQueue } from "@ems/queue";
import {
  createDatabaseClient,
  DatabaseWriter,
  PrismaTelemetryRepository,
  type Database,
} from "@ems/database";
import type { TelemetryRecord } from "@ems/telemetry";
import { GatewayServer } from "@ems/gateway-listener";
import { buildApiServer, type VersionInfo } from "@ems/api";
import { buildPipelineHooks, buildWriterObserver } from "./hooks.js";
import { SystemReadiness } from "./readiness.js";
import { toSafeConfigView } from "./safe-config.js";

export interface App {
  start(): Promise<void>;
  stop(reason: string): Promise<void>;
  readonly logger: Logger;
}

/**
 * Composition root. This is the ONLY place concrete classes are constructed and
 * wired; every other module depends on interfaces. Reading top-to-bottom shows
 * the whole dependency graph and the exact ingestion pipeline:
 *   TCP → Connection → Poller(decode/parse/validate/map) → BatchQueue → Writer → DB
 */
export function createApp(env: AppEnv): App {
  const logger = createLogger({
    level: env.LOG_LEVEL,
    service: env.SERVICE_NAME,
    pretty: env.NODE_ENV === "development",
  });
  const metrics = new Metrics();
  const stats = new StatsStore();

  const devices = loadDeviceConfig(env.DEVICE_CONFIG_PATH, {
    tenant: env.DEFAULT_TENANT_ID,
    plant: env.DEFAULT_PLANT_ID,
    byteOrder: env.MODBUS_BYTE_ORDER,
  });
  logger.info({ devices: devices.length }, "device register map loaded");

  // --- Persistence side: Writer <- Queue ------------------------------------
  const db: Database = createDatabaseClient(env.DATABASE_URL);
  const repository = new PrismaTelemetryRepository(db);
  const writer = new DatabaseWriter(
    repository,
    logger,
    {
      maxRetries: env.DB_MAX_RETRIES,
      retryBackoffMs: env.DB_RETRY_BACKOFF_MS,
      deadLetterPath: env.DB_DEAD_LETTER_PATH,
    },
    buildWriterObserver(metrics, stats),
  );
  const queue = new InMemoryBatchQueue<TelemetryRecord>(writer.flushHandler, {
    maxBatchSize: env.DB_BATCH_SIZE,
    flushIntervalMs: env.DB_FLUSH_INTERVAL_MS,
  });
  stats.bindQueueDepth(() => queue.size());

  // --- Ingestion side: Gateway listener + poller ----------------------------
  const hooks = buildPipelineHooks(metrics, stats);
  const sink = async (record: TelemetryRecord): Promise<void> => {
    await queue.enqueue(record);
    metrics.queueDepth.set(queue.size());
  };

  const gateway = new GatewayServer(
    {
      host: env.GATEWAY_LISTEN_HOST,
      port: env.GATEWAY_LISTEN_PORT,
      maxConnections: env.MAX_CONNECTIONS,
      connectionTimeoutMs: env.CONNECTION_TIMEOUT_MS,
      rateLimitPerMin: env.CONNECTION_RATE_LIMIT_PER_MIN,
      intervalMs: env.POLL_INTERVAL_MS,
      timeoutMs: env.MODBUS_TIMEOUT_MS,
      maxRetries: env.MODBUS_MAX_RETRIES,
      framing: env.MODBUS_FRAMING,
    },
    {
      devices,
      sink,
      hooks,
      log: logger,
      onOpen: (id, remote) => {
        stats.connectionOpened(id, remote);
        metrics.connectionsAccepted.inc();
        metrics.activeConnections.set(gateway.activeConnections());
      },
      onClose: (id, reason) => {
        stats.connectionClosed(id);
        metrics.connectionsClosed.inc({ reason });
        metrics.activeConnections.set(gateway.activeConnections());
      },
    },
  );

  // --- HTTP API -------------------------------------------------------------
  const version: VersionInfo = {
    service: env.SERVICE_NAME,
    version: process.env["APP_VERSION"] ?? "1.0.0",
    nodeVersion: process.version,
    commit: process.env["GIT_COMMIT"] ?? "unknown",
  };
  const readiness = new SystemReadiness(db, () => gateway.activeConnections() >= 0);
  let api: FastifyInstance | null = null;

  return {
    logger,

    async start(): Promise<void> {
      await gateway.listen();
      api = await buildApiServer(
        {
          host: env.API_HOST,
          port: env.API_PORT,
          metricsEnabled: env.METRICS_ENABLED,
          rateLimitMax: env.API_RATE_LIMIT_MAX,
          rateLimitWindowMs: env.API_RATE_LIMIT_WINDOW_MS,
        },
        {
          log: logger,
          metrics,
          readiness,
          stats: { listConnections: () => stats.listConnections(), statistics: () => stats.snapshot() },
          version,
          safeConfig: toSafeConfigView(env),
        },
      );
      await api.listen({ host: env.API_HOST, port: env.API_PORT });
      logger.info({ apiPort: env.API_PORT }, "HTTP API listening");
    },

    // Ordered shutdown: stop accepting/polling → drain queue → close DB → close API.
    async stop(reason: string): Promise<void> {
      logger.info({ reason }, "shutdown initiated");
      await gateway.close();
      await queue.close(); // flushes remaining buffered records
      await db.$disconnect();
      if (api) await api.close();
      logger.info("shutdown complete");
    },
  };
}
