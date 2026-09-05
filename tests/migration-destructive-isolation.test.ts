import { expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Migrator, Schema } from "../src/index.js";
import { TransactionContext } from "../src/connection/TransactionContext.js";
import { acquireMigrationLock } from "../src/migration/MigrationLock.js";
import { createDriverContext, serverUrl } from "./driver-harness.js";
import { setupTestDb, teardownTestDb } from "./helpers.js";

for (const driver of ["sqlite", "postgres", "mysql"] as const) {
  const run = driver === "sqlite" || serverUrl(driver) ? test.serial : test.skip;
  for (const operation of ["fresh", "refresh", "reset"] as const) {
    run(`${driver} ${operation} destroys nothing when a competitor holds its lock`, async () => {
      const context = driver === "sqlite" ? undefined : await createDriverContext(driver);
      const connection = context?.connection ?? setupTestDb();
      try {
        await Schema.create("survivor", table => { table.integer("id"); }, connection);
        await connection.run(`INSERT INTO ${connection.qualifyTable("survivor")} (id) VALUES (7)`);
        const migrator = new Migrator(connection, "tests/no_such_migrations", {}, { lockTimeoutMs: 1, output() {} });
        await migrator.run();
        const held = await acquireMigrationLock(connection, "migrations:default");
        try {
          const failed = await migrator[operation]().then(() => false, error => /Could not acquire migration lock/.test(error.message));
          expect(await Schema.hasTable("survivor", connection)).toBe(true);
          expect(await connection.query(`SELECT id FROM ${connection.qualifyTable("survivor")}`)).toEqual([{ id: 7 }]);
          expect(await Schema.hasTable("migrations", connection)).toBe(true);
          expect(failed).toBe(true);
        } finally { await held.release(); }
      } finally {
        if (context) await context.dispose(); else await teardownTestDb(connection);
      }
    });
  }
}

for (const operation of ["refresh", "reset", "fresh"] as const) {
  test.serial(`sqlite ${operation} keeps one lock across every batch and rebuild`, async () => {
    const connection = setupTestDb();
    const directory = join(process.cwd(), "tmp_agents", `migration_isolation_${crypto.randomUUID()}`);
    await mkdir(directory, { recursive: true });
    const migrator = new Migrator(connection, directory, {}, { output() {}, lockTimeoutMs: 1 });
    const query = connection.query.bind(connection);
    let probes = 0;
    try {
      for (const index of [1, 2]) {
        await writeFile(join(directory, `${index}_create.ts`), `
import { Migration, Schema } from "../../src/index.js";
export default class extends Migration {
  async up() { await Schema.create("batch_${index}", t => t.integer("id")); }
  async down() { await Schema.drop("batch_${index}"); }
}
`);
        await migrator.run();
      }
      connection.query = async function (sql: string, bindings?: any[]) {
        const result = await query(sql, bindings);
        // Probe the actual phase boundaries: batch selection after a rollback,
        // and migrations-table discovery after fresh has dropped the tables.
        if (!TransactionContext.current() && (sql.includes("MAX(batch)") || sql.includes("sqlite_master"))) {
          probes++;
          const competitor = await acquireMigrationLock(connection, "migrations:default", { timeoutMs: 0 }).catch(error => {
            expect(error.message).toContain('Could not acquire migration lock "migrations:default"');
            return null;
          });
          if (competitor) await competitor.release();
          expect(competitor).toBeNull();
        }
        return result;
      };
      await migrator[operation]();
      connection.query = query;
      expect(probes).toBeGreaterThanOrEqual(operation === "fresh" ? 2 : 3);
      expect(await Schema.hasTable("batch_1", connection)).toBe(operation !== "reset");
      expect(await Schema.hasTable("batch_2", connection)).toBe(operation !== "reset");
      expect(await query("SELECT name FROM migration_locks")).toEqual([]);
      const next = await acquireMigrationLock(connection, "migrations:default", { timeoutMs: 0 });
      await next.release();
    } finally {
      connection.query = query;
      await teardownTestDb(connection);
      await rm(directory, { recursive: true, force: true });
    }
  });
}
