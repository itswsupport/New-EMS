import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv, resetEnvCache } from "@ems/config";

const BASE = {
  DATABASE_URL: "postgresql://ems:pw@localhost:5432/ems?schema=public",
};

afterEach(() => resetEnvCache());

describe("env secret-file resolution", () => {
  it("resolves KEY_FILE for a config key (DATABASE_URL_FILE)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ems-secret-"));
    const file = join(dir, "db_url");
    writeFileSync(file, "postgresql://ems:pw@postgres:5432/ems?schema=public\n");
    const env = loadEnv({ DATABASE_URL_FILE: file });
    expect(env.DATABASE_URL).toBe("postgresql://ems:pw@postgres:5432/ems?schema=public");
  });

  it("IGNORES unrelated *_FILE vars like Docker Compose's COMPOSE_FILE", () => {
    // Regression: COMPOSE_FILE once got treated as a secret path and crashed boot.
    const env = loadEnv({
      ...BASE,
      COMPOSE_FILE: "docker-compose.yml:docker-compose.prod.yml:docker-compose.grafana.yml",
    });
    // Must parse without throwing; COMPOSE_FILE is simply not a config key.
    expect(env.DATABASE_URL).toContain("postgresql://");
  });

  it("mounted secret overrides a plain env value of the same key", () => {
    const dir = mkdtempSync(join(tmpdir(), "ems-secret-"));
    const file = join(dir, "db_url");
    writeFileSync(file, "postgresql://ems:pw@postgres:5432/ems?schema=public");
    const env = loadEnv({ DATABASE_URL: BASE.DATABASE_URL, DATABASE_URL_FILE: file });
    expect(env.DATABASE_URL).toContain("@postgres:5432"); // file wins over localhost
  });
});
