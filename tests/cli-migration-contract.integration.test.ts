import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { Connection } from "../src/index.js";

/**
 * The migration commands, driven the way a tool driving them would: as
 * subprocesses, reading stdout. Run against every driver that is reachable,
 * because the CLI has been broken on one driver while green on another —
 * see .tmp_hacks/bun-mysql-event-loop.md.
 *
 * The load-bearing assertion in every case is the pair "exit code 0 **and**
 * output": a command that says it succeeded and printed nothing is the exact
 * failure this suite exists to catch.
 */
type Driver = "sqlite" | "mysql" | "postgres";

const urls: Record<Driver, string | undefined> = {
  sqlite: "sqlite",
  mysql: process.env.MYSQL_TEST_URL,
  postgres: process.env.POSTGRES_TEST_URL,
};

const cli = join(import.meta.dir, "..", "bin", "orm.ts");
const ormEntry = join(import.meta.dir, "..", "src", "index.js");

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(project: string, args: string[], env: Record<string, string> = {}): Promise<CliResult> {
  const child = Bun.spawn(["bun", cli, ...args], {
    cwd: project,
    // The CLI must resolve its config from the project, never from the
    // repository's own .env, or the test would migrate the wrong database.
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", ...env },
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

function migrationSource(table: string): string {
  return `
import { Migration, Blueprint, Builder, Schema } from ${JSON.stringify(ormEntry)};

export default class extends Migration {
  async up() {
    await Schema.create(${JSON.stringify(table)}, (t: Blueprint) => {
      t.increments("id");
      t.string("name");
    });
    const connection = Schema.getConnection();
    await connection.query(
      "SELECT " + connection.getGrammar().placeholder(1) + " AS inspected",
      [9007199254740993n],
    );
    await new Builder(connection, connection.qualifyTable(${JSON.stringify(table)})).insert({ name: "fixture" });
  }
  async down() { await Schema.dropIfExists(${JSON.stringify(table)}); }
}
`;
}

/** A migration that writes to stdout itself — the thing --json must not let through. */
function noisyMigrationSource(table: string): string {
  return `
import { Migration, Blueprint, Schema } from ${JSON.stringify(ormEntry)};

export default class extends Migration {
  async up() {
    console.log("creating " + ${JSON.stringify(table)});
    console.count("migration count");
    console.table([{ table: ${JSON.stringify(table)} }]);
    process.stdout.write("raw write from a migration\\n");
    await Bun.write(Bun.stdout, "native Bun stdout from a migration\\n");
    process.once("beforeExit", () => console.log("late output from a migration"));
    await Schema.create(${JSON.stringify(table)}, (t: Blueprint) => { t.increments("id"); });
  }
  async down() { await Schema.dropIfExists(${JSON.stringify(table)}); }
}
`;
}

/** A database (MySQL) or schema (PostgreSQL) of this test's own, dropped afterwards. */
async function createNamespace(driver: Driver, project: string): Promise<{ connection: string; dispose: () => Promise<void> }> {
  const namespace = `orm_cli_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;

  if (driver === "sqlite") {
    return { connection: `{ url: "sqlite://${join(project, "app.sqlite")}" }`, dispose: async () => {} };
  }

  const url = urls[driver]!;
  const admin = new Connection({ url });
  const drop = async (statement: string) => {
    const cleaner = new Connection({ url });
    try { await cleaner.run(statement); } finally { await cleaner.close().catch(() => null); }
  };

  if (driver === "mysql") {
    try { await admin.run(`CREATE DATABASE \`${namespace}\``); } finally { await admin.close().catch(() => null); }
    const target = new URL(url);
    target.pathname = `/${namespace}`;
    return {
      connection: `{ url: ${JSON.stringify(target.toString())} }`,
      dispose: () => drop(`DROP DATABASE IF EXISTS \`${namespace}\``),
    };
  }

  try { await admin.run(`CREATE SCHEMA "${namespace}"`); } finally { await admin.close().catch(() => null); }
  return {
    connection: `{ url: ${JSON.stringify(url)}, schema: ${JSON.stringify(namespace)} }`,
    dispose: () => drop(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`),
  };
}

for (const driver of ["sqlite", "mysql", "postgres"] as Driver[]) {
  const available = Boolean(urls[driver]);
  const it = available ? test.serial : test.skip;

  describe.serial(`orm migration CLI over ${driver}`, () => {
    let project: string;
    let migrations: string;
    let dispose: () => Promise<void> = async () => {};

    beforeAll(async () => {
      if (!available) return;
      project = await mkdtemp(join(process.cwd(), "tests", `.tmp-cli-${driver}-`));
      migrations = join(project, "database", "migrations");
      await mkdir(migrations, { recursive: true });
      const namespace = await createNamespace(driver, project);
      dispose = namespace.dispose;
      await writeFile(join(project, "orm.config.ts"), `
export default {
  connection: ${namespace.connection},
  migrationsPath: "./database/migrations",
};
`);
      await writeFile(join(migrations, "20260101000000_create_widgets_table.ts"), migrationSource("cli_widgets"));
      await writeFile(join(migrations, "20260102000000_create_gadgets_table.ts"), migrationSource("cli_gadgets"));
    });

    afterAll(async () => {
      if (!available) return;
      await dispose().catch(() => null);
      await rm(project, { recursive: true, force: true });
    });

    it("reports pending migrations as JSON on stdout", async () => {
      const result = await runCli(project, ["migrate:status", "--json"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).not.toBe("");
      const payload = JSON.parse(result.stdout);
      expect(payload.migrations.map((row: any) => row.status)).toEqual(["Pending", "Pending"]);
      expect(payload.migrations.map((row: any) => row.batch)).toEqual([null, null]);
      expect(payload.migrations[0].migration).toBe("database/migrations/20260101000000_create_widgets_table.ts");
    });

    it("pretends pending migrations with dialect SQL and bindings without mutations", async () => {
      const emptyRollback = await runCli(project, ["migrate:rollback", "--pretend", "--json"]);
      expect(emptyRollback.exitCode).toBe(0);
      expect(JSON.parse(emptyRollback.stdout)).toEqual({ pretend: [] });

      const result = await runCli(project, ["migrate", "--pretend", "--json"], { NODE_ENV: "production" });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim().split("\n")).toHaveLength(1);
      const payload = JSON.parse(result.stdout);
      expect(payload.pretend).toHaveLength(2);
      expect(payload.pretend.map((item: any) => item.direction)).toEqual(["up", "up"]);

      const statements = payload.pretend[0].statements;
      const quote = driver === "mysql" ? "`" : '"';
      expect(statements[0].sql).toStartWith("CREATE TABLE ");
      expect(statements[0].sql).toContain(`${quote}cli_widgets${quote}`);
      expect(statements[1].sql).toContain(driver === "postgres" ? "SELECT $1" : "SELECT ?");
      expect(statements[1].bindings).toEqual(["9007199254740993"]);
      expect(statements[2].sql).toContain(
        driver === "postgres" ? "VALUES ($1)" : "VALUES (?)",
      );
      expect(statements[2].bindings).toEqual(["fixture"]);

      const stillPending = JSON.parse((await runCli(project, ["migrate:status", "--json"])).stdout);
      expect(stillPending.migrations.map((row: any) => row.status)).toEqual(["Pending", "Pending"]);

      const plain = await runCli(project, ["migrate", "--pretend"]);
      expect(plain.stdout).toContain("(up)");
      expect(plain.stdout).toContain('Bindings: ["9007199254740993"]');
      expect(plain.stdout).toContain("Bindings: [\"fixture\"]");
    });

    it("migrates, keeping progress out of the JSON on stdout", async () => {
      const result = await runCli(project, ["migrate", "--json"]);

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual({
        applied: [
          "database/migrations/20260101000000_create_widgets_table.ts",
          "database/migrations/20260102000000_create_gadgets_table.ts",
        ],
      });
      expect(result.stdout).not.toContain("Migrating:");
      expect(result.stderr).toContain("Migrating: database/migrations/20260101000000_create_widgets_table.ts");
    });

    it("reports the batch each migration ran in", async () => {
      const { stdout, exitCode } = await runCli(project, ["migrate:status", "--json"]);

      expect(exitCode).toBe(0);
      const rows = JSON.parse(stdout).migrations;
      expect(rows.map((row: any) => row.status)).toEqual(["Ran", "Ran"]);
      expect(rows.map((row: any) => row.batch)).toEqual([1, 1]);
    });

    it("refuses to migrate over a migration that changed, unless told to", async () => {
      const file = join(migrations, "20260101000000_create_widgets_table.ts");
      const original = await Bun.file(file).text();
      await writeFile(file, `${original}\n// edited after it ran\n`);

      try {
        const refused = await runCli(project, ["migrate"]);
        expect(refused.exitCode).toBe(1);
        expect(refused.stderr).toContain("has changed since it ran");
        expect(refused.stdout).toBe("");

        const explicitlyRefused = await runCli(project, ["migrate", "--allow-changed=false"]);
        expect(explicitlyRefused.exitCode).toBe(1);
        expect(explicitlyRefused.stderr).toContain("has changed since it ran");

        const forced = await runCli(project, ["migrate", "--allow-changed", "--json"]);
        expect(forced.exitCode).toBe(0);
        expect(JSON.parse(forced.stdout)).toEqual({ applied: [] });
        expect(forced.stderr).toContain("changed migration(s) left untouched");
      } finally {
        await writeFile(file, original);
      }
    });

    it("rolls back the number of batches asked for", async () => {
      await writeFile(join(migrations, "20260103000000_create_sprockets_table.ts"), migrationSource("cli_sprockets"));
      const second = await runCli(project, ["migrate", "--json"]);
      expect(JSON.parse(second.stdout).applied).toHaveLength(1);

      const one = await runCli(project, ["migrate:rollback", "--json"]);
      expect(one.exitCode).toBe(0);
      expect(JSON.parse(one.stdout)).toEqual({
        rolledBack: ["database/migrations/20260103000000_create_sprockets_table.ts"],
      });

      await runCli(project, ["migrate", "--json"]);
      const two = await runCli(project, ["migrate:rollback", "--step=2", "--json"]);
      expect(two.exitCode).toBe(0);
      expect(JSON.parse(two.stdout).rolledBack).toHaveLength(3);

      const empty = await runCli(project, ["migrate:rollback", "--json"]);
      expect(empty.exitCode).toBe(0);
      expect(JSON.parse(empty.stdout)).toEqual({ rolledBack: [] });
      expect(empty.stderr).toContain("Nothing to rollback.");
    });

    it("keeps a migration's own stdout out of the JSON document", async () => {
      const noisy = join(migrations, "20260104000000_create_noisy_table.ts");
      await writeFile(noisy, noisyMigrationSource("cli_noisy"));

      try {
        const result = await runCli(project, ["migrate", "--json"]);

        expect(result.exitCode).toBe(0);
        // Parses, because none of the migration's own output reached stdout.
        expect(JSON.parse(result.stdout).applied).toContain(
          "database/migrations/20260104000000_create_noisy_table.ts",
        );
        expect(result.stdout).not.toContain("creating cli_noisy");
        expect(result.stdout).not.toContain("raw write from a migration");
        expect(result.stdout).not.toContain("native Bun stdout");
        expect(result.stdout).not.toContain("late output");
        // Relayed, not swallowed.
        expect(result.stderr).toContain("creating cli_noisy");
        expect(result.stderr).toContain("migration count: 1");
        expect(result.stderr).toContain("raw write from a migration");
        expect(result.stderr).toContain("native Bun stdout from a migration");
        expect(result.stderr).toContain("late output from a migration");
      } finally {
        await runCli(project, ["migrate:rollback", "--json"]);
        await rm(noisy, { force: true });
      }
    });

    it("reports what reset, fresh and refresh did", async () => {
      await runCli(project, ["migrate", "--json"]);

      const reset = await runCli(project, ["migrate:reset", "--json"]);
      expect(reset.exitCode).toBe(0);
      expect(JSON.parse(reset.stdout).rolledBack).toHaveLength(3);

      const fresh = await runCli(project, ["migrate:fresh", "--json"]);
      expect(fresh.exitCode).toBe(0);
      expect(JSON.parse(fresh.stdout).applied).toHaveLength(3);

      const refresh = await runCli(project, ["migrate:refresh", "--json"]);
      expect(refresh.exitCode).toBe(0);
      const payload = JSON.parse(refresh.stdout);
      expect(payload.rolledBack).toHaveLength(3);
      expect(payload.applied).toHaveLength(3);

      const secondReset = await runCli(project, ["migrate:reset", "--json"]);
      expect(JSON.parse(secondReset.stdout).rolledBack).toHaveLength(3);

      // Empty is still the command's own shape, never a missing key.
      const nothingLeft = await runCli(project, ["migrate:reset", "--json"]);
      expect(JSON.parse(nothingLeft.stdout)).toEqual({ rolledBack: [] });
    });

    it("pretends only the rollback batches selected by --step", async () => {
      await runCli(project, ["migrate", "--json"]);
      const extra = join(migrations, "20260104500000_create_pretend_batch_table.ts");
      await writeFile(extra, migrationSource("cli_pretend_batch"));
      await runCli(project, ["migrate", "--json"]);

      try {
        const result = await runCli(project, ["migrate:rollback", "--pretend", "--step=1", "--json"]);
        expect(result.exitCode).toBe(0);
        const payload = JSON.parse(result.stdout);
        expect(payload.pretend).toHaveLength(1);
        expect(payload.pretend[0].migration).toBe("database/migrations/20260104500000_create_pretend_batch_table.ts");
        expect(payload.pretend[0].direction).toBe("down");

        const status = JSON.parse((await runCli(project, ["migrate:status", "--json"])).stdout);
        expect(status.migrations.every((row: any) => row.status === "Ran")).toBe(true);
      } finally {
        await runCli(project, ["migrate:rollback", "--step=1", "--json"]);
        await rm(extra, { force: true });
      }
    });

    it("takes its configuration from --config", async () => {
      await mkdir(join(project, "config"), { recursive: true });
      const moved = join(project, "config", "database.ts");
      await writeFile(moved, `console.log("output while loading explicit config");\n${await Bun.file(join(project, "orm.config.ts")).text()}`);
      await rm(join(project, "orm.config.ts"));

      try {
        const withoutConfig = await runCli(project, ["migrate:status", "--json"]);
        expect(withoutConfig.exitCode).toBe(1);

        const withConfig = await runCli(project, ["--config", "config/database.ts", "migrate:status", "--json=true"]);
        expect(withConfig.exitCode).toBe(0);
        expect(JSON.parse(withConfig.stdout).migrations).toHaveLength(3);
        expect(withConfig.stderr).toContain("output while loading explicit config");
      } finally {
        await writeFile(join(project, "orm.config.ts"), await Bun.file(moved).text());
      }
    });
  });
}

/**
 * Driver-independent: how the CLI reacts to arguments and configuration it
 * cannot use. Everything here must fail loudly — an exit code, a message on
 * stderr, and nothing on stdout — rather than dump a stack trace or, worse,
 * succeed quietly.
 */
describe.serial("orm CLI configuration and argument errors", () => {
  let configured: string;
  let bare: string;

  beforeAll(async () => {
    configured = await mkdtemp(join(process.cwd(), "tests", ".tmp-cli-args-"));
    await mkdir(join(configured, "database", "migrations"), { recursive: true });
    await writeFile(join(configured, "orm.config.ts"), `
export default {
  connection: { url: "sqlite://${join(configured, "app.sqlite")}" },
  migrationsPath: "./database/migrations",
};
`);
    // No config file here, so the environment is the only source of truth.
    bare = await mkdtemp(join(process.cwd(), "tests", ".tmp-cli-bare-"));
  });

  afterAll(async () => {
    await rm(configured, { recursive: true, force: true });
    await rm(bare, { recursive: true, force: true });
  });

  test.serial("rejects a --step that is not a batch count", async () => {
    const result = await runCli(configured, ["migrate:rollback", "--step=abc", "--json"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--step must be a positive whole number of batches");
  });

  test.serial("treats --json=false as false", async () => {
    const result = await runCli(configured, ["migrate:status", "--json=false"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain('"migrations"');
  });

  test.serial("rejects invalid explicit boolean values before loading config", async () => {
    const result = await runCli(configured, ["migrate:status", "--json=maybe"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain('--json must be true or false, got "maybe"');
  });

  test.serial("names the supported drivers when DB_CONNECTION is not one", async () => {
    const result = await runCli(bare, ["migrate:status"], { DB_CONNECTION: "maria", DB_DATABASE: "x" });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("is not a supported driver");
    expect(result.stderr).toContain("sqlite, mysql, postgres");
    expect(result.stderr).not.toContain("at <anonymous>");
  });

  test.serial("names the supported schemes when the URL is not one", async () => {
    const result = await runCli(bare, ["migrate:status"], { DATABASE_URL: "maria://root@127.0.0.1:3306/x" });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("is not a supported database URL scheme");
    expect(result.stderr).not.toContain("at <anonymous>");
  });

  test.serial("still reports a missing configuration as a configuration problem", async () => {
    const result = await runCli(bare, ["migrate:status"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("No orm.config.ts found.");
  });
});
