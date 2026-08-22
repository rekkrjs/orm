import { describe, it, expect, afterEach } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { makeQueueInstallCommand } from "../src/cli/QueueInstallCommand.js";
import { CommandRunner } from "../src/commands/CommandRunner.js";
import type { OrmConfig } from "../src/config/OrmConfig.js";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "orm-queue-install-"));
  dirs.push(dir);
  return dir;
}

async function runInstall(config: OrmConfig, migrationDir: string, modelsDir: string) {
  const CommandClass = makeQueueInstallCommand(config);
  await new CommandRunner().run(CommandClass as any, [migrationDir, `--models=${modelsDir}`]);
}

async function readOnly(dir: string, suffix = ".ts"): Promise<string> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(suffix));
  expect(files).toHaveLength(1);
  return readFile(join(dir, files[0]!), "utf-8");
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("queue:install", () => {
  it("uses the default table names when the config says nothing", async () => {
    const migrationDir = await tempDir();
    const modelsDir = await tempDir();

    await runInstall({ connection: { url: "sqlite://:memory:" } } as OrmConfig, migrationDir, modelsDir);

    const migration = await readOnly(migrationDir);
    expect(migration).toContain('Schema.create("jobs"');
    expect(migration).toContain('Schema.create("failed_jobs"');
    expect(await readFile(join(modelsDir, "Job.ts"), "utf-8")).toContain('Model.define<JobAttributes>("jobs")');
  });

  it("generates the tables configured under queue.table / queue.failedTable", async () => {
    const migrationDir = await tempDir();
    const modelsDir = await tempDir();

    const config = {
      connection: { url: "sqlite://:memory:" },
      queue: { table: "background_jobs", failedTable: "dead_letter_jobs" },
    } as OrmConfig;

    await runInstall(config, migrationDir, modelsDir);

    const migration = await readOnly(migrationDir);
    expect(migration).toContain('Schema.create("background_jobs"');
    expect(migration).toContain('Schema.create("dead_letter_jobs"');
    expect(migration).toContain('Schema.dropIfExists("dead_letter_jobs")');
    expect(migration).not.toContain('"failed_jobs"');
    expect(migration).toContain("class CreateBackgroundJobsTables");

    expect(await readFile(join(modelsDir, "Job.ts"), "utf-8"))
      .toContain('Model.define<JobAttributes>("background_jobs")');
    expect(await readFile(join(modelsDir, "FailedJob.ts"), "utf-8"))
      .toContain('Model.define<FailedJobAttributes>("dead_letter_jobs")');
  });
});
