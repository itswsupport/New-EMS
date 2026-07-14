import { loadEnv } from "@ems/config";
import { createApp } from "./app.js";

/**
 * Process entrypoint. Responsibilities kept minimal by design:
 *   1. Load + validate config (fail fast on bad env).
 *   2. Build and start the app (composition root).
 *   3. Install signal + crash handlers for a graceful, bounded shutdown.
 *
 * SIGTERM (Docker/K8s stop) triggers an ordered drain so no buffered telemetry
 * is lost; a hard timeout guarantees the process still exits if a dependency hangs.
 */
async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = createApp(env);

  let shuttingDown = false;
  const shutdown = async (reason: string, code: number): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    const hardTimeout = setTimeout(() => {
      app.logger.fatal({ reason }, "shutdown timed out — forcing exit");
      process.exit(1);
    }, env.SHUTDOWN_TIMEOUT_MS);
    hardTimeout.unref();

    try {
      await app.stop(reason);
      clearTimeout(hardTimeout);
      process.exit(code);
    } catch (err) {
      app.logger.fatal({ reason, err: (err as Error).message }, "error during shutdown");
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM", 0));
  process.on("SIGINT", () => void shutdown("SIGINT", 0));
  process.on("uncaughtException", (err) => {
    app.logger.fatal({ err: err.message, stack: err.stack }, "uncaught exception");
    void shutdown("uncaughtException", 1);
  });
  process.on("unhandledRejection", (reason) => {
    app.logger.fatal({ reason: String(reason) }, "unhandled rejection");
    void shutdown("unhandledRejection", 1);
  });

  await app.start();
  app.logger.info("ems-edge-platform started");
}

bootstrap().catch((err) => {
  // Boot failed before the logger exists — write raw JSON to stderr and exit.
  process.stderr.write(
    JSON.stringify({ level: "fatal", msg: "bootstrap failed", error: (err as Error).message }) + "\n",
  );
  process.exit(1);
});
