import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { pathToFileURL } from "url";
import { Connection } from "../src/index.js";

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const cli = join(import.meta.dir, "..", "bin", "orm.ts");
const ormEntry = pathToFileURL(join(import.meta.dir, "..", "src", "index.ts")).href;

async function runCli(project: string, args: string[], env: Record<string, string> = {}): Promise<CliResult> {
  const child = Bun.spawn(["bun", cli, ...args], {
    cwd: project,
    env: { ...process.env, NODE_ENV: "test", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe.serial("production migration protection and locking", () => {
  let project: string;
  let database: string;

  async function hasTable(table: string): Promise<boolean> {
    const connection = new Connection({ url: `sqlite://${database}` });
    try {
      const rows = await connection.query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        [table],
      );
      return rows.length > 0;
    } finally {
      await connection.close();
    }
  }

  async function userVersion(): Promise<number> {
    const connection = new Connection({ url: `sqlite://${database}` });
    try {
      const rows = await connection.query("PRAGMA user_version");
      return Number(rows[0]?.user_version);
    } finally {
      await connection.close();
    }
  }

  async function observedMigrationLock(): Promise<number> {
    const connection = new Connection({ url: `sqlite://${database}` });
    try {
      const rows = await connection.query("SELECT lock_present FROM production_guard");
      return Number(rows[0]?.lock_present);
    } finally {
      await connection.close();
    }
  }

  beforeAll(async () => {
    project = await mkdtemp(join(process.cwd(), "tests", ".tmp-production-migrations-"));
    database = join(project, "app.sqlite");
    const migrations = join(project, "migrations");
    await mkdir(migrations);
    await writeFile(join(project, "orm.config.ts"), `
export default {
  connection: { url: ${JSON.stringify(`sqlite://${database}`)} },
  migrationsPath: ${JSON.stringify(migrations)},
};
`);
    await writeFile(join(migrations, "20260827000000_create_production_guard.ts"), `
import { Migration, Schema } from ${JSON.stringify(ormEntry)};
export default class ProductionGuardMigration extends Migration {
  async up() {
    const derived = Schema.getConnection().withSchema("pretend_guard");
    await derived.query("PRAGMA user_version(7)");
    await Schema.create("production_guard", (table) => {
      table.increments("id");
      table.integer("lock_present");
    });
    await Schema.getConnection().run(
      "INSERT INTO production_guard (lock_present) SELECT COUNT(*) FROM migration_locks WHERE name = ?",
      ["migrations:default"],
    );
  }
  async down() { await Schema.dropIfExists("production_guard"); }
}
`);
  });

  afterAll(async () => {
    await rm(project, { recursive: true, force: true });
  });

  test("protects mutating commands while status stays unguarded and pretend stays read-only", async () => {
    const production = { NODE_ENV: "production" };

    const migrateHelp = await runCli(project, ["migrate", "--help"]);
    const rollbackHelp = await runCli(project, ["migrate:rollback", "--help"]);
    const refreshHelp = await runCli(project, ["migrate:refresh", "--help"]);
    expect(migrateHelp.stdout).toContain("--pretend");
    expect(migrateHelp.stdout).toContain("--force");
    expect(migrateHelp.stdout).toContain("Usage: orm migrate");
    expect(migrateHelp.stdout).not.toContain("orm run migrate");
    expect(migrateHelp.stdout).not.toContain("--isolated");
    expect(rollbackHelp.stdout).toContain("--pretend");
    expect(rollbackHelp.stdout).not.toContain("--steps");
    expect(refreshHelp.stdout).toContain("--seed");
    expect(refreshHelp.stdout).toContain("--seeder=<value>");

    const blockedMigrate = await runCli(project, ["migrate"], production);
    expect(blockedMigrate.exitCode).toBe(1);
    expect(blockedMigrate.stderr).toContain("Pass --force");
    expect(await hasTable("production_guard")).toBe(false);

    const pretend = await runCli(project, ["migrate", "--pretend", "--json"], production);
    expect(pretend.exitCode).toBe(0);
    const pretendResult = JSON.parse(pretend.stdout).pretend;
    expect(pretendResult).toHaveLength(1);
    expect(pretendResult[0].statements.map((statement: any) => statement.sql)).toEqual([
      "PRAGMA user_version(7)",
      expect.stringContaining("CREATE TABLE"),
      expect.stringContaining("INSERT INTO production_guard"),
    ]);
    expect(await hasTable("production_guard")).toBe(false);
    expect(await hasTable("migrations")).toBe(false);
    expect(await userVersion()).toBe(0);

    const status = await runCli(project, ["migrate:status", "--json"], production);
    expect(status.exitCode).toBe(0);

    expect((await runCli(project, ["migrate", "--force"], production)).exitCode).toBe(0);
    expect(await hasTable("production_guard")).toBe(true);
    expect(await hasTable("migration_locks")).toBe(true);
    expect(await observedMigrationLock()).toBe(1);

    const rollbackPretend = await runCli(
      project,
      ["migrate:rollback", "--pretend", "--json"],
      production,
    );
    expect(rollbackPretend.exitCode).toBe(0);
    expect(JSON.parse(rollbackPretend.stdout).pretend[0].direction).toBe("down");
    expect(await hasTable("production_guard")).toBe(true);

    for (const command of ["migrate:rollback", "migrate:reset", "migrate:refresh", "migrate:fresh"]) {
      const blocked = await runCli(project, [command], production);
      expect(blocked.exitCode).toBe(1);
      expect(blocked.stderr).toContain("Database migration cancelled");
      expect(await hasTable("production_guard")).toBe(true);

      const forced = await runCli(project, [command, "--force"], production);
      expect(forced.exitCode).toBe(0);
      const removesSchema = command === "migrate:rollback" || command === "migrate:reset";
      expect(await hasTable("production_guard")).toBe(!removesSchema);
      if (!removesSchema) expect(await observedMigrationLock()).toBe(1);
      if (removesSchema) {
        expect((await runCli(project, ["migrate", "--force"], production)).exitCode).toBe(0);
      }
    }
  }, 30_000);
});

describe.serial("canonical migration generator", () => {
  let project: string;
  let migrations: string;

  beforeAll(async () => {
    project = await mkdtemp(join(process.cwd(), "tests", ".tmp-make-migration-"));
    migrations = join(project, "migrations");
    await mkdir(migrations);
    await writeFile(join(project, "orm.config.ts"), `
export default {
  connection: { url: "sqlite://${join(project, "app.sqlite")}" },
  migrationsPath: ${JSON.stringify(migrations)},
};
`);
  });

  afterAll(async () => {
    await rm(project, { recursive: true, force: true });
  });

  test("keeps make:migration canonical and infers create and add-to-table stubs", async () => {
    const created = await runCli(project, ["make:migration", "create_accounts_table"]);
    const altered = await runCli(project, ["make:migration", "add_status_to_accounts_table", "--model"]);
    expect([created.exitCode, altered.exitCode]).toEqual([0, 0]);
    expect(altered.stderr).toContain("--model only applies to create_<table>_table migrations");

    const files = (await readdir(migrations)).sort();
    expect(files).toHaveLength(2);
    expect(files[0]).toMatch(/^\d{14}_add_status_to_accounts_table\.ts$|^\d{14}_create_accounts_table\.ts$/);
    expect(files.every((file) => /^\d{14}_.+\.ts$/.test(file))).toBe(true);

    const createFile = files.find((file) => file.endsWith("_create_accounts_table.ts"))!;
    const alterFile = files.find((file) => file.endsWith("_add_status_to_accounts_table.ts"))!;
    expect(await Bun.file(join(migrations, createFile)).text()).toContain('Schema.create("accounts"');
    const alterSource = await Bun.file(join(migrations, alterFile)).text();
    expect(alterSource.match(/Schema\.table\("accounts"/g)).toHaveLength(2);

    const help = await runCli(project, ["--help"]);
    expect(help.stdout).toContain("make:migration");
    expect(help.stdout).not.toContain("migrate:make");
    const removed = await runCli(project, ["migrate:make", "legacy_name"]);
    expect(removed.exitCode).toBe(1);
    expect(removed.stderr).toContain("Unknown command");
  });
});
