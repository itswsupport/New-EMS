import { z } from "zod";

/**
 * 12-Factor config: the process is configured ENTIRELY by the environment.
 * This schema is the single source of truth for every knob. Parsing fails fast
 * at boot with a precise message if anything is missing/mistyped — no service
 * ever starts in a half-configured state.
 *
 * Secrets support Docker's `*_FILE` convention (see loadEnv): if DATABASE_URL is
 * absent but DATABASE_URL_FILE points at a mounted secret, we read the file.
 */
const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const int = (def: number, min = 0) =>
  z.coerce.number().int().min(min).default(def);

export const envSchema = z.object({
  // Runtime
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  SERVICE_NAME: z.string().default("ems-edge-platform"),

  // Gateway TCP listener
  GATEWAY_LISTEN_HOST: z.string().default("0.0.0.0"),
  GATEWAY_LISTEN_PORT: int(4196, 1),
  MAX_CONNECTIONS: int(512, 1),
  CONNECTION_TIMEOUT_MS: int(30_000, 1000),
  CONNECTION_RATE_LIMIT_PER_MIN: int(120, 1),

  // Modbus
  POLL_INTERVAL_MS: int(5000, 100),
  MODBUS_TIMEOUT_MS: int(3000, 100),
  MODBUS_MAX_RETRIES: int(2, 0),
  MODBUS_BYTE_ORDER: z.enum(["ABCD", "BADC", "CDAB", "DCBA"]).default("ABCD"),
  // "tcp" = Modbus TCP/MBAP (gateway in "Modbus TCP to RTU" conversion mode);
  // "rtu" = transparent RTU-over-TCP passthrough. See docs/architecture.md.
  MODBUS_FRAMING: z.enum(["tcp", "rtu"]).default("tcp"),

  // Device map
  DEVICE_CONFIG_PATH: z.string().default("./config/devices.yaml"),

  // Tenancy defaults
  DEFAULT_TENANT_ID: z.string().default("rucha-engineers"),
  DEFAULT_PLANT_ID: z.string().default("plant01"),

  // Database
  DATABASE_URL: z.string().url(),
  PG_VECTOR_DIMENSION: int(1536, 1),

  // Batch writer
  DB_BATCH_SIZE: int(500, 1),
  DB_FLUSH_INTERVAL_MS: int(2000, 100),
  DB_MAX_RETRIES: int(5, 0),
  DB_RETRY_BACKOFF_MS: int(250, 10),
  DB_DEAD_LETTER_PATH: z.string().default("./logs/dead-letter.ndjson"),

  // HTTP API
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: int(8080, 1),
  METRICS_ENABLED: bool.default("true"),
  API_RATE_LIMIT_MAX: int(300, 1),
  API_RATE_LIMIT_WINDOW_MS: int(60_000, 1000),

  // Lifecycle
  SHUTDOWN_TIMEOUT_MS: int(15_000, 1000),
});

export type AppEnv = z.infer<typeof envSchema>;
