import { pino, type Logger, type LoggerOptions } from "pino";

/**
 * Structured JSON logging (Pino). Two design rules enforced here:
 *
 *  1. CONTEXT IS BOUND, NOT REPEATED. The pipeline binds identity fields
 *     (connection_id, tenant_id, plant_id, device_id) via child loggers so every
 *     downstream line carries them automatically. Call sites pass only the delta.
 *
 *  2. MESSAGE + FIELDS, NEVER INTERPOLATION. `log.info({ records }, "flushed")`
 *     keeps logs queryable in Loki/Elastic. String templates are banned.
 */
export type { Logger } from "pino";

export interface LogIdentity {
  readonly connection_id?: string;
  readonly tenant_id?: string;
  readonly plant_id?: string;
  readonly device_id?: string;
}

export interface CreateLoggerOptions {
  readonly level: string;
  readonly service: string;
  /** Pretty-print for local dev; JSON in production (default). */
  readonly pretty?: boolean;
}

/** Root logger. One per process; everything else is a child of this. */
export function createLogger(opts: CreateLoggerOptions): Logger {
  const base: LoggerOptions = {
    level: opts.level,
    base: { service: opts.service, pid: process.pid },
    // ISO timestamps read better than epoch-ms in a log aggregator.
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label) => ({ level: label }),
    },
    // Never leak secrets even if accidentally attached to a log object.
    redact: {
      paths: ["password", "*.password", "DATABASE_URL", "*.DATABASE_URL", "authorization"],
      censor: "[REDACTED]",
    },
  };

  if (opts.pretty) {
    return pino({
      ...base,
      transport: { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss.l" } },
    });
  }
  return pino(base);
}

/** Bind identity fields onto a child logger so they appear on every line. */
export function withIdentity(logger: Logger, identity: LogIdentity): Logger {
  return logger.child(identity);
}
