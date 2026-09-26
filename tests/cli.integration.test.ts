import { existsSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test, isBun, writeText, ormCli, ormModule, runProcess } from "./harness.js";
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

let project: string;
let databasePath: string;

async function runCli(
  args: string[],
  options: { input?: string; timeoutMs?: number; env?: Record<string, string> } = {}
): Promise<CliResult> {
  return await runProcess([...ormCli, ...args], {
    cwd: project,
    env: { ...process.env, ORM_REPL_TMPDIR: project, ...options.env },
    input: options.input,
    timeoutMs: options.timeoutMs ?? 10_000,
  });
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

    await writeText(join(project, "orm.config.ts"), `
export default {
  connection: { url: ${JSON.stringify(`sqlite://${databasePath}`)} },
  migrationsPath: ${JSON.stringify(migrations)},
  seedersPath: ${JSON.stringify(seeders)},
  commands: { commandsPath: ${JSON.stringify(commands)} },
  queue: { driver: "db", pollIntervalMs: 10 }
};
`);

    const ormUrl = pathToFileURL(ormModule("src/index.ts")).href;
    const commandsUrl = pathToFileURL(ormModule("src/commands/index.ts")).href;
    await writeText(join(migrations, "20260819000000_create_cli_items.ts"), `
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
    await writeText(join(seeders, "CliItemSeeder.ts"), `
import { Seeder } from ${JSON.stringify(ormUrl)};
export default class CliItemSeeder extends Seeder {
  async run() { await this.connection.run("INSERT INTO cli_items (name) VALUES (?)", ["seeded"]); }
}
`);
    await writeText(join(commands, "SmokeCommand.ts"), `
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
    expect(help.stderr).toBe("");
    expect(help.stdout).toContain("Usage: orm");
    expect(help.stdout).not.toContain("\x1b[");

    const seedHelp = await runCli(["db:seed", "--help"]);
    expect(seedHelp).toMatchObject({ exitCode: 0, stderr: "" });
    expect(seedHelp.stdout).toContain("--force");

    const custom = await runCli(["run", "smoke:hello", "Ada", "--loud"]);
    expect(custom.exitCode).toBe(0);
    expect(custom.stderr).toBe("");
    expect(custom.stdout).toContain("HELLO ADA");
    const customHelp = await runCli(["run", "smoke:hello", "--help"]);
    expect(customHelp).toMatchObject({ exitCode: 0, stderr: "" });
    expect(customHelp.stdout).toContain("Usage: orm run smoke:hello");

    const migrated = await runCli(["migrate"]);
    expect(migrated.exitCode).toBe(0);
    expect(migrated.stderr).toBe("");
    expect(migrated.stdout).toContain("Migrated:");

    const ranStatus = await runCli(["migrate:status"]);
    expect(ranStatus.exitCode).toBe(0);
    expect(ranStatus.stderr).toBe("");
    expect(ranStatus.stdout).toContain("Ran");

    const reset = await runCli(["migrate:reset"]);
    expect(reset.exitCode).toBe(0);
    expect(reset.stderr).toBe("");
    const pendingStatus = await runCli(["migrate:status"]);
    expect(pendingStatus).toMatchObject({ exitCode: 0, stderr: "" });
    expect(pendingStatus.stdout).toContain("Pending");

    const refreshed = await runCli(["migrate:refresh"]);
    expect(refreshed.exitCode).toBe(0);
    expect(refreshed.stderr).toBe("");
    expect(refreshed.stdout).toContain("Migrated:");

    const seeded = await runCli(["db:seed", "CliItemSeeder"]);
    expect(seeded.exitCode).toBe(0);
    expect(seeded.stderr).toBe("");
    const connection = new Connection({ url: `sqlite://${databasePath}` });
    try {
      expect(await connection.query("SELECT name FROM cli_items")).toEqual([{ name: "seeded" }]);

      const blocked = await runCli(["db:seed", "CliItemSeeder"], { env: { NODE_ENV: "production" } });
      expect(blocked.exitCode).toBe(1);
      expect(blocked.stderr).toContain("Database seeding cancelled");
      expect(await connection.query("SELECT name FROM cli_items")).toHaveLength(1);

      const forced = await runCli(["db:seed", "CliItemSeeder", "--force"], { env: { NODE_ENV: "production" } });
      expect(forced.exitCode).toBe(0);
      expect(forced.stderr).toBe("");
      expect(await connection.query("SELECT name FROM cli_items")).toHaveLength(2);
    } finally {
      await connection.close();
    }
  }, 30_000);

  test("shows queue and REPL help without starting long-running processes", async () => {
    const queueHelp = await runCli(["queue", "--help"]);
    expect(queueHelp.timedOut).toBe(false);
    expect(queueHelp.exitCode).toBe(0);
    expect(queueHelp.stderr).toBe("");
    expect(queueHelp.stdout).toContain("Start the background job worker");

    const replHelp = await runCli(["repl", "--help"]);
    expect(replHelp.timedOut).toBe(false);
    expect(replHelp.exitCode).toBe(0);
    expect(replHelp.stderr).toBe("");
    expect(replHelp.stdout).toContain("Start an interactive REPL");
  });

  test("starts and stops the database queue worker", async () => {
    // The worker runs until it is asked to stop.
    const { exitCode, stdout: output, stderr } = await runProcess([...ormCli, "queue", "--queue=smoke", "--workers=1"], { cwd: project, timeoutMs: 500 });

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
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

  // The Bun REPL runs `bun repl` over a generated bootstrap; on Node.js the REPL is in-process and has neither.
  test.skipIf(!isBun)("creates ORM_REPL_TMPDIR and keeps the transpiler cache across sessions", async () => {
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
    expect(second.stderr).toBe("");
    expect(second.stdout).toContain("REPL_SMOKE function object");
    expect((await readdir(cacheDir)).length).toBeGreaterThan(0);

    // The disposable bootstrap dirs must not survive either session.
    const leftovers = (await readdir(missingRoot)).filter((entry) => entry !== "orm-repl-cache");
    expect(leftovers).toEqual([]);
  }, 40_000);

  test("reads the project's .env files the way Bun does, and lets the environment win", async () => {
    const dir = await mkdtemp(join(process.cwd(), "tests", ".tmp-cli-dotenv-"));
    try {
      await writeText(join(dir, ".env"), `DB_DIR=${dir}\nDB_NAME=from-dotenv\nDATABASE_URL=sqlite://\${DB_DIR}/\${DB_NAME}.sqlite\nMIGRATIONS_PATH=./migrations\n`);
      await writeText(join(dir, ".env.local"), "DB_NAME=from-local\n");
      // No config file: the database comes from the environment alone. The
      // runner's own settings are left out so the project's files decide.
      const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
        !["DATABASE_URL", "DB_CONNECTION", "MIGRATIONS_PATH", "NODE_ENV", "DB_NAME", "DB_DIR"].includes(key)));

      const fromFiles = await runProcess([...ormCli, "migrate", "--json"], { cwd: dir, env: inherited });
      expect(fromFiles.exitCode).toBe(0);
      expect(fromFiles.stderr).toBe("Nothing to migrate.\n");
      expect(existsSync(join(dir, "from-local.sqlite"))).toBe(true);
      expect(existsSync(join(dir, "from-dotenv.sqlite"))).toBe(false);

      const fromEnv = await runProcess([...ormCli, "migrate", "--json"], { cwd: dir, env: { ...inherited, DB_NAME: "from-env" } });
      expect(fromEnv.exitCode).toBe(0);
      expect(fromEnv.stderr).toBe("Nothing to migrate.\n");
      expect(existsSync(join(dir, "from-env.sqlite"))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 20_000);

  // Bun transpiles TypeScript; Node.js only strips types, and says so when it cannot.
  test.skipIf(isBun)("names type stripping when a migration Node.js cannot strip will not load", async () => {
    const dir = await mkdtemp(join(process.cwd(), "tests", ".tmp-cli-strip-"));
    try {
      await writeText(join(dir, "migrations", "20260101000000_uses_an_enum.ts"), `
enum Status { Active = "active" }
export default class { async up() { return Status.Active; } async down() {} }
`);
      const result = await runProcess([...ormCli, "migrate"], {
        cwd: dir,
        env: { ...process.env, DATABASE_URL: `sqlite://${join(dir, "app.sqlite")}`, MIGRATIONS_PATH: "./migrations" },
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("20260101000000_uses_an_enum.ts could not be loaded");
      expect(result.stderr).toContain("stripping the types");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 20_000);
});
