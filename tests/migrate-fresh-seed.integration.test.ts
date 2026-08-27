import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "fs";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
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

describe.serial("migration seeding", () => {
  let project: string;
  let migrations: string;
  let seeders: string;
  let landlordDatabase: string;
  let tenantDatabase: string;
  let seedMarker: string;

  async function runCli(args: string[], env: Record<string, string> = {}): Promise<CliResult> {
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

  async function itemNames(database: string): Promise<string[]> {
    const connection = new Connection({ url: `sqlite://${database}` });
    try {
      const rows = await connection.query<{ name: string }>("SELECT name FROM fresh_seed_items ORDER BY id");
      return rows.map((row) => row.name);
    } finally {
      await connection.close();
    }
  }

  beforeAll(async () => {
    project = await mkdtemp(join(process.cwd(), "tests", ".tmp-fresh-seed-"));
    migrations = join(project, "migrations");
    seeders = join(project, "seeders");
    landlordDatabase = join(project, "landlord.sqlite");
    tenantDatabase = join(project, "tenant-acme.sqlite");
    seedMarker = join(project, "seed-ran");
    await Promise.all([mkdir(migrations), mkdir(seeders)]);

    await writeFile(join(project, "orm.config.ts"), `
export default {
  connection: { url: ${JSON.stringify(`sqlite://${landlordDatabase}`)} },
  migrationsPath: ${JSON.stringify(migrations)},
  seedersPath: ${JSON.stringify(seeders)},
  tenancy: {
    listTenants: () => ["acme"],
    resolveTenant: (tenantId: string) => ({
      strategy: "database",
      name: "fresh-seed:" + tenantId,
      config: { url: ${JSON.stringify(`sqlite://${tenantDatabase}`)} },
    }),
  },
};
`);

    await writeFile(join(migrations, "20260827000000_create_fresh_seed_items.ts"), `
import { Migration, Schema } from ${JSON.stringify(ormEntry)};
export default class CreateFreshSeedItems extends Migration {
  async up() {
    await Schema.create("fresh_seed_items", (table) => {
      table.increments("id");
      table.string("name");
    });
  }
  async down() { await Schema.dropIfExists("fresh_seed_items"); }
}
`);

    await writeFile(join(seeders, "DatabaseSeeder.ts"), `
import { Seeder } from ${JSON.stringify(ormEntry)};
export default class DatabaseSeeder extends Seeder {
  async run() {
    console.log("default seeder output");
    process.stdout.write("default seeder raw output\\n");
    await Bun.write(Bun.stdout, "default seeder Bun output\\n");
    process.once("beforeExit", () => console.log("default seeder late output"));
    await Bun.write(${JSON.stringify(seedMarker)}, "ran");
    await this.connection.run("INSERT INTO fresh_seed_items (name) VALUES (?)", ["default"]);
  }
}
`);

    await writeFile(join(seeders, "UserSeeder.ts"), `
import { Seeder } from ${JSON.stringify(ormEntry)};
export default class UserSeeder extends Seeder {
  async run() {
    await this.connection.run("INSERT INTO fresh_seed_items (name) VALUES (?)", ["user"]);
  }
}
`);

    await writeFile(join(seeders, "FailingSeeder.ts"), `
import { Seeder } from ${JSON.stringify(ormEntry)};
export default class FailingSeeder extends Seeder {
  async run() { throw new Error("seeder exploded"); }
}
`);
  });

  afterAll(async () => {
    await rm(project, { recursive: true, force: true });
  });

  test("--seed runs the default seeder after migrations", async () => {
    const result = await runCli(["migrate:fresh", "--seed"]);

    expect(result.exitCode).toBe(0);
    expect(await itemNames(landlordDatabase)).toEqual(["default"]);
  });

  test("help advertises the seeding options", async () => {
    const result = await runCli(["migrate:fresh", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--seed");
    expect(result.stdout).toContain("--seeder=<value>");
    expect(result.stdout).toContain("--force");
  });

  test("--seeder runs only the selected seeder", async () => {
    const result = await runCli(["migrate:fresh", "--seed", "--seeder=UserSeeder"]);

    expect(result.exitCode).toBe(0);
    expect(await itemNames(landlordDatabase)).toEqual(["user"]);
  });

  test("migrate:refresh runs the default seeder after migrations", async () => {
    const result = await runCli(["migrate:refresh", "--seed"]);

    expect(result.exitCode).toBe(0);
    expect(await itemNames(landlordDatabase)).toEqual(["default"]);
  });

  test("migrate:refresh runs only the selected seeder", async () => {
    const result = await runCli(["migrate:refresh", "--seed", "--seeder=UserSeeder"]);

    expect(result.exitCode).toBe(0);
    expect(await itemNames(landlordDatabase)).toEqual(["user"]);
  });

  test("does not seed when a migration fails", async () => {
    const failingMigration = join(migrations, "20260827000001_fail.ts");
    await rm(seedMarker, { force: true });
    await writeFile(failingMigration, `
import { Migration } from ${JSON.stringify(ormEntry)};
export default class FailingMigration extends Migration {
  async up() { throw new Error("migration exploded"); }
  async down() {}
}
`);

    try {
      const result = await runCli(["migrate:fresh", "--seed"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("migration exploded");
      expect(existsSync(seedMarker)).toBe(false);
    } finally {
      await rm(failingMigration, { force: true });
    }
  });

  test("does not seed when refresh rollback fails", async () => {
    const failingRollback = join(migrations, "20260827000001_fail_down.ts");
    await writeFile(failingRollback, `
import { Migration, Schema } from ${JSON.stringify(ormEntry)};
export default class FailingRollback extends Migration {
  async up() { await Schema.create("refresh_rollback_failure", (table) => table.increments("id")); }
  async down() { throw new Error("rollback exploded"); }
}
`);

    try {
      expect((await runCli(["migrate"])).exitCode).toBe(0);
      await rm(seedMarker, { force: true });
      const result = await runCli(["migrate:refresh", "--seed"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("rollback exploded");
      expect(existsSync(seedMarker)).toBe(false);
    } finally {
      await rm(failingRollback, { force: true });
    }
  });

  test("returns a non-zero exit code when the seeder fails", async () => {
    const result = await runCli(["migrate:fresh", "--seed", "--seeder=FailingSeeder"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("seeder exploded");
  });

  test("rejects --seeder without --seed", async () => {
    const result = await runCli(["migrate:fresh", "--seeder=UserSeeder"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("--seeder requires --seed");

    const refresh = await runCli(["migrate:refresh", "--seeder=UserSeeder"]);
    expect(refresh.exitCode).toBe(1);
    expect(refresh.stdout).toBe("");
    expect(refresh.stderr).toContain("--seeder requires --seed");
  });

  test("passes landlord and tenant targets to migrations and seeding", async () => {
    const landlord = await runCli(["migrate:fresh", "--seed", "--seeder=UserSeeder", "--landlord"]);
    const tenant = await runCli(["migrate:fresh", "--seed", "--seeder=UserSeeder", "--tenant=acme"]);
    const tenants = await runCli(["migrate:fresh", "--seed", "--seeder=UserSeeder", "--tenants"]);

    expect([landlord.exitCode, tenant.exitCode, tenants.exitCode]).toEqual([0, 0, 0]);
    expect(await itemNames(landlordDatabase)).toEqual(["user"]);
    expect(await itemNames(tenantDatabase)).toEqual(["user"]);

    const refreshedTenant = await runCli(["migrate:refresh", "--seed", "--tenant=acme"]);
    expect(refreshedTenant.exitCode).toBe(0);
    expect(await itemNames(tenantDatabase)).toEqual(["default"]);
  });

  test("--json emits one document for migrations and seeding", async () => {
    const result = await runCli(["migrate:fresh", "--seed", "--json"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(result.stdout)).toEqual({
      applied: ["migrations/20260827000000_create_fresh_seed_items.ts"],
      seeded: true,
    });
    expect(result.stdout).not.toContain("default seeder");
    expect(result.stderr).toContain("default seeder output");
    expect(result.stderr).toContain("default seeder late output");

    const refresh = await runCli(["migrate:refresh", "--seed", "--seeder=UserSeeder", "--json"]);
    const payload = JSON.parse(refresh.stdout);
    expect(refresh.stdout.trim().split("\n")).toHaveLength(1);
    expect(payload.seeded).toBe(true);
    expect(payload.rolledBack).toHaveLength(1);
    expect(payload.applied).toHaveLength(1);
  });

  test("production seeding remains guarded and --force bypasses the prompt", async () => {
    const before = await itemNames(landlordDatabase);
    const blocked = await runCli(
      ["migrate:fresh", "--seed", "--seeder=UserSeeder"],
      { NODE_ENV: "production" },
    );
    expect(blocked.exitCode).toBe(1);
    expect(blocked.stderr).toContain("Database migration cancelled");
    expect(await itemNames(landlordDatabase)).toEqual(before);

    const forced = await runCli(
      ["migrate:fresh", "--seed", "--seeder=UserSeeder", "--force"],
      { NODE_ENV: "production" },
    );
    expect(forced.exitCode).toBe(0);
    expect(await itemNames(landlordDatabase)).toEqual(["user"]);
  });
});
