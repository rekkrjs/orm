import { join } from "node:path";
import { expect, isBun, runProcess, test } from "./harness.js";

// The suite refuses to run with a server URL unset (tests/invariants.ts): a
// test whose URL is unset skips itself, and a run that skipped every server
// test would otherwise come out green.
const root = join(import.meta.dirname, "..");
const probe = "tests/iso-formatter.test.ts"; // No server tests of its own.
const runner = isBun ? [process.execPath, "test", probe] : [process.execPath, join(root, "node_modules/vitest/vitest.mjs"), "run", probe];

function runSuite(env: Record<string, string>) {
  // Without the parent vitest's own variables the child is a run of its own.
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("VITEST")));
  // Empty rather than unset: neither runner lets .env replace a variable the environment already has.
  return runProcess(runner, { cwd: root, env: { ...inherited, ...env }, timeoutMs: 60_000 });
}

test("a run with a server URL unset fails and names only that one", async () => {
  const result = await runSuite({ MYSQL_TEST_URL: "", ORM_TEST_SKIP_SERVERS: "" });
  expect(result.exitCode).not.toBe(0);
  expect(`${result.stdout}${result.stderr}`.match(/([A-Z_]+(?:, [A-Z_]+)*) unset: the tests/)?.[1]).toBe("MYSQL_TEST_URL");
}, 60_000);

test("ORM_TEST_SKIP_SERVERS=1 lets that run go ahead", async () => {
  const result = await runSuite({ MYSQL_TEST_URL: "", ORM_TEST_SKIP_SERVERS: "1" });
  expect(result.stderr + result.stdout).not.toContain("unset: the tests");
  expect(result.exitCode).toBe(0);
}, 60_000);
