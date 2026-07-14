/**
 * apply-sql.ts — provisions the pgvector extension + plant_knowledge_base with a
 * CONFIGURABLE embedding dimension. Reads the .sql.template, substitutes
 * ${PG_VECTOR_DIMENSION}, and executes each statement over the native client.
 *
 * Kept dependency-free of psql so it runs inside the slim Node image.
 * Run: node --import tsx scripts/apply-sql.ts
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const TEMPLATE = "packages/database/prisma/sql/01_knowledge_base.sql.template";

async function main(): Promise<void> {
  const url = process.env["DATABASE_URL"];
  if (!url) throw new Error("DATABASE_URL is required");
  const dim = Number(process.env["PG_VECTOR_DIMENSION"] ?? "1536");
  if (!Number.isInteger(dim) || dim < 1) throw new Error(`invalid PG_VECTOR_DIMENSION: ${dim}`);

  const sql = readFileSync(TEMPLATE, "utf8").replaceAll("${PG_VECTOR_DIMENSION}", String(dim));
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

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

main().catch((err) => {
  process.stderr.write(`apply-sql failed: ${(err as Error).message}\n`);
  process.exit(1);
});
