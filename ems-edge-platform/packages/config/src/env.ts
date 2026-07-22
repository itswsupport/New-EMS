import { readFileSync } from "node:fs";
import { DomainError } from "@ems/common";
import { envSchema, type AppEnv } from "./env.schema.js";

/**
 * Only KEY_FILE indirection for KEYs the app actually consumes is honoured.
 * This prevents hijacking unrelated `*_FILE` environment variables that share
 * the container's environment — most notably Docker Compose's own COMPOSE_FILE,
 * whose value is a list of compose files, NOT a secret path.
 */
const SECRET_TARGET_KEYS: ReadonlySet<string> = new Set(Object.keys(envSchema.shape));

/** Read one secret file, or throw a CONFIG_ERROR that names the exact fix. */
function readSecretFile(target: string, path: string): string {
  try {
    return readFileSync(path, "utf8").trim();
  } catch (cause) {
    const e = cause as NodeJS.ErrnoException;
    // The container runs as non-root (uid 1000). Compose bind-mounts file secrets
    // preserving HOST ownership/mode, so a root-owned 0600 secret is unreadable
    // in here — the most common deploy failure, so state the fix explicitly.
    const hint =
      e.code === "EACCES"
        ? " — the secret is not readable by the container's non-root user." +
          " Fix on the host: chmod 0444 on the secret file (and chmod 0700 on" +
          " the secrets/ directory to keep other host users out)."
        : e.code === "ENOENT"
          ? " — file not found; check the secret is declared in docker-compose.yml."
          : "";
    throw new DomainError("CONFIG_ERROR", `Cannot read secret for ${target} from ${path}${hint}`, {
      code: e.code ?? "UNKNOWN",
    });
  }
}

/**
 * Resolve Docker-secret indirection: for a config KEY, `KEY_FILE=/run/secrets/x`
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
    const target = key.endsWith("_FILE") ? key.slice(0, -"_FILE".length) : null;
    // Treat KEY_FILE as a secret ONLY when KEY is a config key we use. Any other
    // *_FILE var (COMPOSE_FILE, etc.) is passed through untouched and ignored.
    if (target !== null && SECRET_TARGET_KEYS.has(target)) {
      fromFiles[target] = readSecretFile(target, value);
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
