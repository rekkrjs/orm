import type * as BunTest from "bun:test";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:os";
import { dirname, join } from "node:path";

/**
 * The suite's test API on either runtime. Tests are written against bun:test
 * and import it from here: under Bun this is bun:test itself, under Node.js it
 * is vitest (see vitest.config.ts), which implements the same Jest-style API.
 */
export const isBun = typeof Bun !== "undefined";

async function load(): Promise<typeof BunTest> {
  if (isBun) return await import("bun:test");
  const vitest = await import("vitest");
  // vitest runs a file's tests in order unless they opt into `.concurrent`, so `.serial` is the plain API.
  for (const api of [vitest.test, vitest.it, vitest.describe]) Object.assign(api, { serial: api });
  return {
    ...vitest,
    // Without fake timers vitest mocks Date only, as bun:test does; no argument restores the clock.
    setSystemTime: (time?: number | Date) => { time === undefined ? vitest.vi.useRealTimers() : vitest.vi.setSystemTime(time); },
    mock: vitest.vi.fn,
  } as unknown as typeof BunTest;
}

export const { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock, setSystemTime, test } = await load();

const root = join(import.meta.dirname, "..");

/**
 * An ORM module path as a subprocess must import it: the TypeScript source
 * under Bun, the build under Node.js (which neither maps `.js` specifiers to
 * `.ts` files nor should load a second copy of the ORM next to the CLI's).
 */
export function ormModule(source: string): string {
  return join(root, isBun ? source : source.replace(/^src\//, "dist/src/").replace(/\.ts$/, ".js"));
}

/** The `orm` CLI as a command line for the current runtime. */
export const ormCli: string[] = isBun ? [process.execPath, join(root, "bin", "orm.ts")] : [process.execPath, join(root, "dist", "bin", "orm.js")];

/** The current runtime running a script given as a string. */
export const evalCommand = (script: string): string[] => [process.execPath, "-e", script];

export interface ProcessResult { stdout: string; stderr: string; exitCode: number; timedOut: boolean }

/** Runs a command to completion. At `timeoutMs` it is sent SIGTERM and reported as timed out. */
export function runProcess(
  command: string[],
  options: { cwd?: string; env?: Record<string, string | undefined>; input?: string; timeoutMs?: number } = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0]!, command.slice(1), {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout!.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr!.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, options.timeoutMs);
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? 128 + (signal ? constants.signals[signal] : 0), timedOut });
    });
    if (options.input !== undefined) child.stdin!.end(options.input);
  });
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const readText = (path: string): Promise<string> => readFile(path, "utf8");

/** Bun.write's contract: missing parent directories are created. */
export async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
