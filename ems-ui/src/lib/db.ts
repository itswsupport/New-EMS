import { readFileSync } from "node:fs";
import { Pool } from "pg";

/**
 * Connection string resolution mirrors the ingestion app: a mounted secret wins
 * over an environment literal, so no credential is ever baked into an image or a
 * compose file. DATABASE_URL stays supported for local development.
 */
function connectionString(): string {
  const file = process.env.DATABASE_URL_FILE;
  if (file) {
    try {
      return readFileSync(file, "utf8").trim();
    } catch (e) {
      throw new Error(
        `DATABASE_URL_FILE is set to ${file} but could not be read: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "No database configured. Set DATABASE_URL in .env.local (dev) or mount DATABASE_URL_FILE (compose).",
    );
  }
  return url;
}

// One pool per process, created on first query rather than at import.
//
// Eager construction breaks `next build`: collecting page data imports every
// route module, and a build machine has no database. Failing lazily puts the
// error inside the request, where the page's try/catch turns it into the
// "how to connect" panel instead of a crash.
//
// The instance lives on globalThis because dev hot-reload re-evaluates modules,
// and a fresh pool per reload exhausts Postgres connections.
const globalForPg = globalThis as unknown as { emsPool?: Pool };

function getPool(): Pool {
  if (!globalForPg.emsPool) {
    globalForPg.emsPool = new Pool({
      connectionString: connectionString(),
      max: 8,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return globalForPg.emsPool;
}

export async function q<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await getPool().query(text, params as never[]);
  return res.rows as T[];
}

/** pg hands back bigint and numeric as strings. Everything downstream is a number. */
export const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);
