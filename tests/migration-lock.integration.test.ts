import { afterEach, describe, expect, test } from "bun:test";
import { Connection, ConnectionManager } from "../src/index.js";
import { acquireMigrationLock } from "../src/migration/MigrationLock.js";

const postgresUrl = process.env.POSTGRES_TEST_URL;
const mysqlUrl = process.env.MYSQL_TEST_URL;
const runIfPostgres = postgresUrl ? test.serial : test.skip;
const runIfMySql = mysqlUrl ? test.serial : test.skip;

const lockName = () => `migrations:test:${Date.now()}_${Math.random().toString(36).slice(2)}`;

describe.serial("Native migration advisory locks", () => {
  afterEach(async () => {
    await ConnectionManager.closeAll();
  });

  runIfPostgres("holds a pg advisory lock and shuts out a second migrator", async () => {
    const connection = new Connection({ url: postgresUrl! });
    const name = lockName();

    const held = await acquireMigrationLock(connection, name, { timeoutMs: 100 });
    try {
      await expect(acquireMigrationLock(connection, name, { timeoutMs: 100 })).rejects.toThrow(
        `Could not acquire migration lock "${name}"`
      );

      // The lock lives on its own session, not on the migration pool.
      const rows = await connection.query(
        "SELECT count(*)::int AS held FROM pg_locks WHERE locktype = 'advisory'"
      );
      expect(Number(rows[0]?.held)).toBeGreaterThan(0);
    } finally {
      await held.release();
    }

    // Released, so the next migrator gets straight in.
    const second = await acquireMigrationLock(connection, name, { timeoutMs: 100 });
    await second.release();
    await connection.close();
  });

  runIfPostgres("leaves no lock rows behind on postgres", async () => {
    const connection = new Connection({ url: postgresUrl! });
    const name = lockName();

    const held = await acquireMigrationLock(connection, name, { timeoutMs: 100 });
    await held.release();

    const rows = await connection.query(
      "SELECT to_regclass('migration_locks') IS NOT NULL AS present"
    );
    expect(rows[0]?.present === true || rows[0]?.present === "t").toBe(false);
    await connection.close();
  });

  runIfMySql("honours a sub-second lock timeout", async () => {
    const connection = new Connection({ url: mysqlUrl! });
    await connection.run("SET time_zone = \'+00:00\'");
    const name = lockName();

    const held = await acquireMigrationLock(connection, name, { timeoutMs: 1000 });
    try {
      // GET_LOCK's own timeout is expressed in whole seconds, so asking for 1ms
      // must not turn into a one-second wait.
      const started = Date.now();
      await expect(acquireMigrationLock(connection, name, { timeoutMs: 1 })).rejects.toThrow(
        `Could not acquire migration lock "${name}"`
      );
      expect(Date.now() - started).toBeLessThan(500);
    } finally {
      await held.release();
      await connection.close();
    }
  });

  runIfMySql("holds a GET_LOCK and shuts out a second migrator", async () => {
    const connection = new Connection({ url: mysqlUrl! });
    await connection.run("SET time_zone = \'+00:00\'");
    const name = lockName();

    const held = await acquireMigrationLock(connection, name, { timeoutMs: 1000 });
    try {
      await expect(acquireMigrationLock(connection, name, { timeoutMs: 1000 })).rejects.toThrow(
        `Could not acquire migration lock "${name}"`
      );
    } finally {
      await held.release();
    }

    const second = await acquireMigrationLock(connection, name, { timeoutMs: 1000 });
    await second.release();
    await connection.close();
  });

  runIfMySql("keeps the CLI alive until a MySQL migration command completes", async () => {
    const child = Bun.spawn([process.execPath, "run", "bin/orm.ts", "migrate"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: mysqlUrl!,
        MIGRATIONS_PATH: "tests/no_such_migrations",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("Nothing to migrate.");
  });
});
