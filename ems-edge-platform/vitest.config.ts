import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Path aliases mirror tsconfig.base.json so tests resolve @ems/* packages
 * without a build step. Kept in one place; apps/packages import by alias.
 */
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@ems/common": r("./packages/common/src/index.ts"),
      "@ems/config": r("./packages/config/src/index.ts"),
      "@ems/logger": r("./packages/logger/src/index.ts"),
      "@ems/modbus": r("./packages/modbus/src/index.ts"),
      "@ems/telemetry": r("./packages/telemetry/src/index.ts"),
      "@ems/queue": r("./packages/queue/src/index.ts"),
      "@ems/database": r("./packages/database/src/index.ts"),
      "@ems/observability": r("./packages/observability/src/index.ts"),
      "@ems/gateway-listener": r("./apps/gateway-listener/src/index.ts"),
      "@ems/api": r("./apps/api/src/index.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts", "packages/**/*.test.ts", "apps/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["packages/**/src/**", "apps/**/src/**"],
      exclude: ["**/index.ts", "**/*.d.ts", "**/generated/**"],
    },
  },
});
