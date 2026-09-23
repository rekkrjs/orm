import { defineConfig } from "vitest/config";

// The Node.js runner for the suite; under Bun `bun test` runs the same files.
// See tests/harness.ts.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/benchmark*"],
    setupFiles: ["tests/invariants.ts"],
    // bun test runs in UTC unless TZ is set; the suite is written against that.
    env: { TZ: process.env.TZ ?? "UTC" },
  },
});
