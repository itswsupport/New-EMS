/**
 * apply-sql.ts — provisions the pgvector extension + plant_knowledge_base with a
 * CONFIGURABLE embedding dimension. Reads the .sql.template, substitutes
 * ${PG_VECTOR_DIMENSION}, and executes each statement over the native client.
 *
 * Kept free of a psql dependency so it runs inside the slim Node image.
 * Run: node --import tsx scripts/apply-sql.ts
 */
import { readFileSync } from "node:fs";
import { argv } from "node:process";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

const TEMPLATE = "packages/database/prisma/sql/01_knowledge_base.sql.template";

/**
 * Split a SQL script into executable statements.
 *
 * Line comments are stripped BEFORE splitting on `;`. Order matters: a comment
 * header sits above the first statement, so filtering "chunks that start with
 * --" after the split would silently swallow that statement along with its
 * comment (which is exactly how `CREATE EXTENSION vector` once went missing).
 */
export function splitSqlStatements(sql: string): string[] {
  return sql
    .replace(/^\s*--.*$/gm, "") // drop full-line comments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function main(): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is required");
  const dim = Number(process.env["PG_VECTOR_DIMENSION"] ?? "1536");
  if (!Number.isInteger(dim) || dim < 1) throw new Error(`invalid PG_VECTOR_DIMENSION: ${dim}`);

  const sql = readFileSync(TEMPLATE, "utf8").replaceAll("${PG_VECTOR_DIMENSION}", String(dim));
  const statements = splitSqlStatements(sql);

  const db = new PrismaClient({ datasourceUrl: url });
  try {
    for (const stmt of statements) {
      await db.$executeRawUnsafe(stmt);
    }
    process.stdout.write(`applied ${statements.length} knowledge-base statements (dim=${dim})\n`);
  } finally {
    await db.$disconnect();
  }
}

// Run only when invoked as a script — importing this module (e.g. from tests to
// exercise splitSqlStatements) must not connect to a database.
const isEntrypoint = argv[1] !== undefined && import.meta.url === pathToFileURL(argv[1]).href;
if (isEntrypoint) {
  main().catch((err) => {
    process.stderr.write(`apply-sql failed: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
