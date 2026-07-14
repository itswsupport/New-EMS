import { readFileSync } from "node:fs";
import { DomainError } from "@ems/common";
import { envSchema, type AppEnv } from "./env.schema.js";

/**
 * Resolve Docker-secret indirection: for any KEY, if KEY is unset but KEY_FILE
 * points at a readable file, load the trimmed file contents as KEY. This lets
 * `DATABASE_URL_FILE=/run/secrets/db_url` work with zero code elsewhere.
 */
function resolveSecretFiles(raw: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (key.endsWith("_FILE")) {
      const target = key.slice(0, -"_FILE".length);
      if (raw[target] === undefined) {
        out[target] = readFileSync(value, "utf8").trim();
      }
    } else {
      out[key] = value;
    }
  }
  return out;
}

let cached: AppEnv | undefined;

/** Parse + validate the environment ONCE. Throws a CONFIG_ERROR on any problem. */
export function loadEnv(raw: NodeJS.ProcessEnv = process.env): AppEnv {
  if (cached) return cached;
  const merged = resolveSecretFiles(raw);
  const parsed = envSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new DomainError("CONFIG_ERROR", `Invalid environment: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test-only: clear the memoized env so a fresh parse can run. */
export function resetEnvCache(): void {
  cached = undefined;
}
