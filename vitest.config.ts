import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// The Node.js runner for the suite; under Bun `bun test` runs the same files.
// See tests/harness.ts.
export default defineConfig(({ mode }) => ({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/benchmark*"],
    setupFiles: ["tests/invariants.ts"],
    env: {
      // .env as bun test reads it, with its ${VAR} references expanded, which
      // Node's own --env-file does not do. The process environment wins.
      ...loadEnv(mode, import.meta.dirname, ""),
      // UTC unless TZ is set, like bun test. CI also runs the suite in zones
      // around the world (.github/workflows/test.yml): no result may depend on it.
      TZ: process.env.TZ ?? "UTC",
    },
  },
}));
