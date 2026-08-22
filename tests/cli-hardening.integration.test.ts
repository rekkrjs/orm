import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { pathToFileURL } from "url";

interface CliResult { stdout: string; stderr: string; exitCode: number }

const cli = join(process.cwd(), "bin", "orm.ts");
let project: string;

async function runCli(args: string[], options: { input?: string; timeoutMs?: number } = {}): Promise<CliResult> {
  const proc = Bun.spawn(["bun", cli, ...args], {
    cwd: project,
    env: { ...process.env, ORM_REPL_TMPDIR: project },
    stdin: options.input === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (options.input !== undefined) {
    proc.stdin.write(options.input);
    proc.stdin.end();
  }
  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();
  const exitCode = await Promise.race([
    proc.exited,
    Bun.sleep(options.timeoutMs ?? 15_000).then(async () => { proc.kill(); return await proc.exited; }),
  ]);
  return { stdout: await stdout, stderr: await stderr, exitCode };
}

describe.serial("orm CLI hardening", () => {
  beforeAll(async () => {
    project = await mkdtemp(join(process.cwd(), "tests", ".tmp-cli-hardening-"));
    const jobs = join(project, "jobs");
    await mkdir(jobs, { recursive: true });

    await Bun.write(join(project, "orm.config.ts"), `
export default {
  connection: { url: ${JSON.stringify(`sqlite://${join(project, "app.sqlite")}`)} },
  queue: { driver: "db", pollIntervalMs: 10, jobsPath: ${JSON.stringify(jobs)} },
};
`);

    const ormUrl = pathToFileURL(join(process.cwd(), "src", "queue", "index.ts")).href;
    await Bun.write(join(jobs, "PingJob.ts"), `
import { DispatchableJob } from ${JSON.stringify(ormUrl)};
export class PingJob extends DispatchableJob { async handle() {} }
`);
  });

  afterAll(async () => {
    await rm(project, { recursive: true, force: true });
  });

  test("a non-numeric --workers is rejected instead of starting zero workers", async () => {
    const result = await runCli(["queue", "--workers=abc"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/invalid worker count/i);
    expect(result.stdout).not.toMatch(/Worker started/);
  });

  test("a zero or negative --workers is rejected too", async () => {
    for (const value of ["0", "-2"]) {
      const result = await runCli(["queue", `--workers=${value}`]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/invalid worker count/i);
    }
  });

  test("rejects values parseInt would silently truncate", async () => {
    for (const value of ["2x", "1.5", "1e3", "abc"]) {
      const result = await runCli(["queue", `--workers=${value}`]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/invalid worker count/i);
    }
  });

  test("--workers with no value is an error, not a silent fallback to the default", async () => {
    for (const args of [["queue", "--workers"], ["queue", "--workers", "--queue", "mail"]]) {
      const result = await runCli(args);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toMatch(/--workers needs a value/i);
      expect(result.stdout).not.toMatch(/Worker started/);
    }
  });

  test("refuses to start when jobsPath is configured but registers nothing", async () => {
    const empty = join(project, "empty-jobs");
    await mkdir(empty, { recursive: true });
    await Bun.write(join(project, "orm.config.ts"), `
export default {
  connection: { url: ${JSON.stringify(`sqlite://${join(project, "app.sqlite")}`)} },
  queue: { driver: "db", pollIntervalMs: 10, jobsPath: ${JSON.stringify(empty)} },
};
`);
    const result = await runCli(["queue"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/no job classes were registered/i);
  });

});
