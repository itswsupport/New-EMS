import { readFileSync } from "node:fs";
import { DomainError } from "@ems/common";
import { envSchema, type AppEnv } from "./env.schema.js";

/**
 * Resolve Docker-secret indirection: for any KEY, `KEY_FILE=/run/secrets/x`
 * loads the trimmed file contents as KEY.
 *
 * PRECEDENCE: a mounted secret file WINS over a plain env value of the same key.
 * This is deliberate — in Docker the app inherits a developer-oriented `.env`
 * (e.g. DATABASE_URL pointing at localhost), and the mounted secret must
 * override it with the real in-network URL + password. An explicitly mounted
 * secret is always the more specific, more trustworthy source.
 */
function resolveSecretFiles(raw: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  const fromFiles: Record<string, string> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (key.endsWith("_FILE")) {
      const target = key.slice(0, -"_FILE".length);
      fromFiles[target] = readFileSync(value, "utf8").trim();
    } else {
      out[key] = value;
    }
  }
  // Secret files applied last so they override any plain env of the same name.
  return { ...out, ...fromFiles };
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
