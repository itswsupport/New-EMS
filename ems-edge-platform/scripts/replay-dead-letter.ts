/**
 * replay-dead-letter.ts — re-insert telemetry that was dead-lettered during a DB
 * outage (batches that survived retries but couldn't be written).
 *
 * Reads the NDJSON at DB_DEAD_LETTER_PATH — one JSON TelemetryRecord per line, as
 * written by DatabaseWriter#deadLetter — inserts it in batches via the repository
 * (skipDuplicates: true → ON CONFLICT DO NOTHING on the (device_id, timestamp)
 * unique index, so replay is idempotent and safe to re-run), then archives the
 * file to *.replayed-<epoch> so it is not replayed twice.
 *
 *   node --import tsx scripts/replay-dead-letter.ts [path]
 *
 * Safe while the app is running: duplicate rows are skipped by the unique index.
 */
import { existsSync, readFileSync, renameSync } from "node:fs";
import { argv } from "node:process";
import { loadEnv } from "@ems/config";
import { createDatabaseClient, PrismaTelemetryRepository } from "@ems/database";
import type { TelemetryRecord } from "@ems/telemetry";

const BATCH = 500;

async function main(): Promise<void> {
  const env = loadEnv();
  const path = argv[2] ?? env.DB_DEAD_LETTER_PATH;

  if (!existsSync(path)) {
    console.log(`no dead-letter file at ${path} — nothing to replay`);
    return;
  }
  const lines = readFileSync(path, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    console.log(`dead-letter file ${path} is empty — nothing to replay`);
    return;
  }

  // Each line is JSON.stringify(TelemetryRecord); timestamp round-trips as ISO.
  const records: TelemetryRecord[] = lines.map((line) => {
    const r = JSON.parse(line) as TelemetryRecord & { timestamp: string };
    return { ...r, timestamp: new Date(r.timestamp) };
  });

  const db = createDatabaseClient(env.DATABASE_URL);
  const repo = new PrismaTelemetryRepository(db);
  let inserted = 0;
  try {
    for (let i = 0; i < records.length; i += BATCH) {
      inserted += await repo.insertMany(records.slice(i, i + BATCH));
    }
  } finally {
    await db.$disconnect();
  }

  const archived = `${path}.replayed-${Date.now()}`;
  renameSync(path, archived);
  console.log(
    `replayed ${records.length} record(s): ${inserted} inserted, ` +
      `${records.length - inserted} already present. archived → ${archived}`,
  );
}

main().catch((e) => {
  console.error("replay failed:", (e as Error).message);
  process.exit(1);
});
