import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm } from "fs/promises";
import { join } from "path";
import { pathToFileURL } from "url";
import { Connection } from "../src/index.js";

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
}

const cli = join(process.cwd(), "bin", "orm.ts");
let project: string;
let databasePath: string;

async function runCli(
  args: string[],
  options: { input?: string; timeoutMs?: number; env?: Record<string, string> } = {}
): Promise<CliResult> {
  const proc = Bun.spawn(["bun", cli, ...args], {
    cwd: project,
    env: {
      ...process.env,
      ORM_REPL_TMPDIR: project,
      ...options.env,
    },
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
  let timedOut = false;
  const exitCode = await Promise.race([
    proc.exited,
    Bun.sleep(options.timeoutMs ?? 10_000).then(async () => {
      timedOut = true;
      proc.kill();
      return await proc.exited;
    }),
  ]);
  return { stdout: await stdout, stderr: await stderr, exitCode, timedOut };
}

describe.serial("orm CLI integration", () => {
  beforeAll(async () => {
    project = await mkdtemp(join(process.cwd(), "tests", ".tmp-cli-"));
    databasePath = join(project, "app.sqlite");
    const migrations = join(project, "migrations");
    const seeders = join(project, "seeders");
    const commands = join(project, "commands");
    await Promise.all([
      mkdir(migrations, { recursive: true }),
      mkdir(seeders, { recursive: true }),
      mkdir(commands, { recursive: true }),
    ]);

    await Bun.write(join(project, "orm.config.ts"), `
export default {
  connection: { url: ${JSON.stringify(`sqlite://${databasePath}`)} },
  migrationsPath: ${JSON.stringify(migrations)},
  seedersPath: ${JSON.stringify(seeders)},
  commands: { commandsPath: ${JSON.stringify(commands)} },
  queue: { driver: "db", pollIntervalMs: 10 }
};
`);

    const ormUrl = pathToFileURL(join(process.cwd(), "src", "index.ts")).href;
    const commandsUrl = pathToFileURL(join(process.cwd(), "src", "commands", "index.ts")).href;
    await Bun.write(join(migrations, "20260819000000_create_cli_items.ts"), `
import { Migration, Schema } from ${JSON.stringify(ormUrl)};
export default class CreateCliItems extends Migration {
  async up() {
    await Schema.create("cli_items", (table) => {
      table.increments("id");
      table.string("name");
    });
  }
  async down() { await Schema.dropIfExists("cli_items"); }
}
`);
    await Bun.write(join(seeders, "CliItemSeeder.ts"), `
import { Seeder } from ${JSON.stringify(ormUrl)};
export default class CliItemSeeder extends Seeder {
  async run() { await this.connection.run("INSERT INTO cli_items (name) VALUES (?)", ["seeded"]); }
}
`);
    await Bun.write(join(commands, "SmokeCommand.ts"), `
import { Command } from ${JSON.stringify(commandsUrl)};
export default class SmokeCommand extends Command.define("smoke:hello {name} {--loud}") {
  async handle() {
    const greeting = "hello " + this.argument("name");
    this.info(this.option("loud") ? greeting.toUpperCase() : greeting);
  }
}
`);
  });

  afterAll(async () => {
    await rm(project, { recursive: true, force: true });
  });

  test("runs help, application commands, migrations, and seeders as subprocesses", async () => {
    const help = await runCli(["--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("Usage: orm");
    expect(help.stdout).not.toContain("\x1b[");

    const custom = await runCli(["run", "smoke:hello", "Ada", "--loud"]);
    expect(custom.exitCode).toBe(0);
    expect(custom.stdout).toContain("HELLO ADA");

    const migrated = await runCli(["migrate"]);
    expect(migrated.exitCode).toBe(0);
    expect(migrated.stdout).toContain("Migrated:");

    const ranStatus = await runCli(["migrate:status"]);
    expect(ranStatus.exitCode).toBe(0);
    expect(ranStatus.stdout).toContain("Ran");

    const reset = await runCli(["migrate:reset"]);
    expect(reset.exitCode).toBe(0);
    const pendingStatus = await runCli(["migrate:status"]);
    expect(pendingStatus.stdout).toContain("Pending");

    const refreshed = await runCli(["migrate:refresh"]);
    expect(refreshed.exitCode).toBe(0);
    expect(refreshed.stdout).toContain("Migrated:");

    const seeded = await runCli(["db:seed", "CliItemSeeder"]);
    expect(seeded.exitCode).toBe(0);
    const connection = new Connection({ url: `sqlite://${databasePath}` });
    try {
      const rows = await connection.query("SELECT name FROM cli_items");
      expect(rows).toEqual([{ name: "seeded" }]);
    } finally {
      await connection.close();
    }
  }, 30_000);

  test("shows queue and REPL help without starting long-running processes", async () => {
    const queueHelp = await runCli(["queue", "--help"]);
    expect(queueHelp.timedOut).toBe(false);
    expect(queueHelp.exitCode).toBe(0);
    expect(queueHelp.stdout).toContain("Start the background job worker");

    const replHelp = await runCli(["repl", "--help"]);
    expect(replHelp.timedOut).toBe(false);
    expect(replHelp.exitCode).toBe(0);
    expect(replHelp.stdout).toContain("Start an interactive REPL");
  });

  test("starts and stops the database queue worker", async () => {
    const proc = Bun.spawn(["bun", cli, "queue", "--queue=smoke", "--workers=1"], {
      cwd: project,
      env: process.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(proc.stdout).text();
    const stderr = new Response(proc.stderr).text();
    await Bun.sleep(500);
    proc.kill("SIGTERM");
    const exitCode = await proc.exited;
    const output = await stdout;

    expect(exitCode).toBe(0);
    expect(await stderr).toBe("");
    expect(output).toContain("[Queue] Worker started. queue=smoke concurrency=1");
    expect(output).toContain("[Queue] Worker stopped.");
  }, 5_000);

  test("boots the interactive REPL and evaluates a piped command", async () => {
    const repl = await runCli(["repl"], {
      input: `console.log("REPL_SMOKE", typeof Model, typeof connection)\n.exit\n`,
      timeoutMs: 15_000,
    });

    expect(repl.timedOut).toBe(false);
    expect(repl.exitCode).toBe(0);
    expect(repl.stderr).toBe("");
    expect(repl.stdout).toContain("ORM REPL ready.");
    expect(repl.stdout).toContain("REPL_SMOKE function object");
  }, 20_000);

  test("creates ORM_REPL_TMPDIR and keeps the transpiler cache across sessions", async () => {
    const missingRoot = join(project, "missing-repl-root", "nested");
    const runRepl = () =>
      runCli(["repl"], {
        input: `console.log("REPL_SMOKE", typeof Model, typeof connection)\n.exit\n`,
        timeoutMs: 15_000,
        env: { ORM_REPL_TMPDIR: missingRoot },
      });

    const first = await runRepl();
    expect(first.timedOut).toBe(false);
    expect(first.stderr).toBe("");
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain("REPL_SMOKE function object");

    const cacheDir = join(missingRoot, "orm-repl-cache");
    const cachedAfterFirst = await readdir(cacheDir);
    expect(cachedAfterFirst.length).toBeGreaterThan(0);

    const second = await runRepl();
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain("REPL_SMOKE function object");
    expect((await readdir(cacheDir)).length).toBeGreaterThan(0);

    // The disposable bootstrap dirs must not survive either session.
    const leftovers = (await readdir(missingRoot)).filter((entry) => entry !== "orm-repl-cache");
    expect(leftovers).toEqual([]);
  }, 40_000);
});
