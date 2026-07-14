import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseWriter, type TelemetryRepository } from "@ems/database";
import type { TelemetryRecord } from "@ems/telemetry";
import { createLogger } from "@ems/logger";

const log = createLogger({ level: "silent", service: "test" });
const rec: TelemetryRecord = {
  deviceId: "m7", tenantId: "t", plantId: "p", timestamp: new Date(0),
  voltage: 230, current: null, frequency: null, powerFactor: null,
  activePower: null, reactivePower: null, apparentPower: null,
  activeEnergy: null, reactiveEnergy: null, thd: null, quality: "UNCERTAIN",
};

describe("DatabaseWriter", () => {
  it("writes a batch via insertMany once", async () => {
    const insertMany = vi.fn(async (r: readonly TelemetryRecord[]) => r.length);
    const repo: TelemetryRepository = { insertMany, count: async () => 0 };
    const writer = new DatabaseWriter(repo, log, {
      maxRetries: 2, retryBackoffMs: 1, deadLetterPath: "/tmp/x.ndjson",
    });
    await writer.flushHandler([rec, rec]);
    expect(insertMany).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures then succeeds", async () => {
    let calls = 0;
    const repo: TelemetryRepository = {
      insertMany: async (r) => {
        if (++calls < 3) throw new Error("deadlock");
        return r.length;
      },
      count: async () => 0,
    };
    const writer = new DatabaseWriter(repo, log, {
      maxRetries: 5, retryBackoffMs: 1, deadLetterPath: "/tmp/x.ndjson",
    });
    await writer.flushHandler([rec]);
    expect(calls).toBe(3);
  });

  it("dead-letters to file after exhausting retries (no data loss)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ems-dl-"));
    const dl = join(dir, "dead.ndjson");
    const repo: TelemetryRepository = {
      insertMany: async () => { throw new Error("db down"); },
      count: async () => 0,
    };
    const writer = new DatabaseWriter(repo, log, {
      maxRetries: 1, retryBackoffMs: 1, deadLetterPath: dl,
    });
    await writer.flushHandler([rec]);
    expect(existsSync(dl)).toBe(true);
    expect(readFileSync(dl, "utf8")).toContain("\"deviceId\":\"m7\"");
  });
});
