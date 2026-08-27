import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { Connection, Migrator, Model, Schema } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

const DIR = join(process.cwd(), "tests", "temp_migrations_concurrency");

describe("Concurrent migrators", () => {
  beforeAll(async () => {
    await rm(DIR, { recursive: true, force: true });
    await mkdir(DIR, { recursive: true });
    await writeFile(
      join(DIR, "20260101000000_create_widgets.ts"),
      `
import { Migration, Schema } from "../../src/index.js";
export default class CreateWidgets extends Migration {
  async up(): Promise<void> {
    const gate = (globalThis as any)[Symbol.for("orm.test.migrationGate")];
    if (gate) await gate();
    await Schema.create("concurrent_widgets", (table) => {
      table.increments("id");
      table.string("name");
    });
  }
  async down(): Promise<void> {
    await Schema.dropIfExists("concurrent_widgets");
  }
}
`
    );
  });

  afterAll(async () => {
    await rm(DIR, { recursive: true, force: true });
  });

  test("two migrators starting on an empty database do not collide", async () => {
    const connection = setupTestDb();

    const migrators = [0, 1].map(
      () => new Migrator(connection, DIR, {}, { lockTimeoutMs: 5_000 })
    );

    // Neither the migrations table, the lock table, nor the migration itself
    // may be created twice.
    await Promise.all(migrators.map((migrator) => migrator.run()));

    const applied = await connection.query("SELECT migration FROM migrations");
    expect(applied).toHaveLength(1);
    expect(await Schema.hasTable("concurrent_widgets")).toBe(true);

    // The lock was released by whoever won.
    const locks = await connection.query("SELECT name FROM migration_locks");
    expect(locks).toHaveLength(0);
  });

  test("migrators on independent databases each prepare their own", async () => {
    const first = new Connection({ url: "sqlite://:memory:" });
    const second = new Connection({ url: "sqlite://:memory:" });

    Model.setConnection(second);
    Schema.setConnection(second);

    const migrators = [first, second].map(
      (connection) => new Migrator(connection, DIR, {}, { lockTimeoutMs: 5_000 })
    );

    let arrivals = 0;
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => { openGate = resolve; });
    (globalThis as any)[Symbol.for("orm.test.migrationGate")] = async () => {
      arrivals++;
      if (arrivals === migrators.length) openGate();
      await gate;
    };
    try {
      await Promise.all(migrators.map((migrator) => migrator.run()));
    } finally {
      delete (globalThis as any)[Symbol.for("orm.test.migrationGate")];
    }

    for (const connection of [first, second]) {
      const applied = await connection.query("SELECT migration FROM migrations");
      expect(applied).toHaveLength(1);
      const tables = await connection.query(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('migrations', 'migration_locks', 'concurrent_widgets') ORDER BY name"
      );
      expect(tables.map((row: any) => row.name)).toEqual([
        "concurrent_widgets",
        "migration_locks",
        "migrations",
      ]);
    }

    await first.close();
    await second.close();
  });

  test("two tenants bootstrapping the shared migrations table do not collide", async () => {
    const connection = setupTestDb();
    const empty = join(process.cwd(), "tests", "temp_migrations_concurrency_empty");
    await mkdir(empty, { recursive: true });

    try {
      // Different tenants take different locks, so only a tenant-independent
      // lock keeps them from both creating "migrations" and its index.
      await Promise.all(
        ["alpha", "beta"].map((tenantId) =>
          new Migrator(connection, empty, {}, { tenantId, lockTimeoutMs: 5_000 }).run()
        )
      );

      const indexes = await connection.query(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'migrations'"
      );
      expect(indexes.length).toBeGreaterThan(0);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  test("a third migrator over a prepared database still finds nothing to do", async () => {
    const connection = setupTestDb();
    await new Migrator(connection, DIR, {}, { lockTimeoutMs: 5_000 }).run();

    const later = [0, 1].map(
      () => new Migrator(connection, DIR, {}, { lockTimeoutMs: 5_000 })
    );
    await Promise.all(later.map((migrator) => migrator.run()));

    const applied = await connection.query("SELECT migration FROM migrations");
    expect(applied).toHaveLength(1);
  });
});
