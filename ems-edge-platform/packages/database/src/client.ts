import { PrismaClient } from "@prisma/client";

/**
 * Native PostgreSQL client (Prisma). Accelerate is deliberately unused — the
 * DATABASE_URL points straight at Postgres and the connection pool is sized via
 * the URL (`connection_limit`). A single PrismaClient owns the pool for the
 * process; construct it once in the composition root and inject it downstream.
 */
export type Database = PrismaClient;

export function createDatabaseClient(datasourceUrl: string): Database {
  return new PrismaClient({
    datasourceUrl,
    log: [
      { level: "warn", emit: "event" },
      { level: "error", emit: "event" },
    ],
  });
}
