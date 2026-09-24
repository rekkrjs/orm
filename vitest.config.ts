import { defineConfig } from "vitest/config";

// The Node.js runner for the suite; under Bun `bun test` runs the same files.
// See tests/harness.ts.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/benchmark*"],
    setupFiles: ["tests/invariants.ts"],
    // UTC unless TZ is set, like bun test. CI also runs the suite in zones
    // around the world (.github/workflows/test.yml): no result may depend on it.
    env: { TZ: process.env.TZ ?? "UTC" },
  },
});
