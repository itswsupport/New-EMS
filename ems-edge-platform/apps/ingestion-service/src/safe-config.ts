import type { AppEnv } from "@ems/config";
import type { SafeConfigView } from "@ems/api";

/**
 * Whitelist of NON-secret config surfaced by GET /config. DATABASE_URL and any
 * secret is deliberately excluded — the endpoint must never leak credentials.
 */
export function toSafeConfigView(env: AppEnv): SafeConfigView {
  return {
    NODE_ENV: env.NODE_ENV,
    LOG_LEVEL: env.LOG_LEVEL,
    SERVICE_NAME: env.SERVICE_NAME,
    GATEWAY_LISTEN_HOST: env.GATEWAY_LISTEN_HOST,
    GATEWAY_LISTEN_PORT: env.GATEWAY_LISTEN_PORT,
    MAX_CONNECTIONS: env.MAX_CONNECTIONS,
    POLL_INTERVAL_MS: env.POLL_INTERVAL_MS,
    MODBUS_TIMEOUT_MS: env.MODBUS_TIMEOUT_MS,
    MODBUS_BYTE_ORDER: env.MODBUS_BYTE_ORDER,
    DEVICE_CONFIG_PATH: env.DEVICE_CONFIG_PATH,
    DEFAULT_TENANT_ID: env.DEFAULT_TENANT_ID,
    DEFAULT_PLANT_ID: env.DEFAULT_PLANT_ID,
    DB_BATCH_SIZE: env.DB_BATCH_SIZE,
    DB_FLUSH_INTERVAL_MS: env.DB_FLUSH_INTERVAL_MS,
    PG_VECTOR_DIMENSION: env.PG_VECTOR_DIMENSION,
    API_PORT: env.API_PORT,
    METRICS_ENABLED: env.METRICS_ENABLED,
  };
}
