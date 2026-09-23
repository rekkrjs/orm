import { expect, test, describe, beforeEach, afterEach } from "./harness.js";
import { Connection } from "../src/index.js";
import { acquireMigrationLock } from "../src/migration/MigrationLock.js";
import { setupTestDb, teardownTestDb } from "./helpers.js";

const LOCK = "migrations:default";

describe("Migration lock (table fallback)", () => {
  let connection: Connection;

  beforeEach(() => {
    connection = setupTestDb();
  });

  afterEach(async () => {
    await teardownTestDb(connection);
  });

  test("release only deletes the lock it still owns", async () => {
    const handle = await acquireMigrationLock(connection, LOCK, { timeoutMs: 50 });

    // Another process took the lock over after ours was considered orphaned.
    await connection.run("UPDATE migration_locks SET owner = ? WHERE name = ?", [
      "another-process",
      LOCK,
    ]);

    await handle.release();

    const rows = await connection.query("SELECT owner FROM migration_locks WHERE name = ?", [LOCK]);
    expect(rows.length).toBe(1);
    expect(rows[0]?.owner).toBe("another-process");
  });

  test("release drops the row when it is still ours", async () => {
    const handle = await acquireMigrationLock(connection, LOCK, { timeoutMs: 50 });
    await handle.release();

    const rows = await connection.query("SELECT owner FROM migration_locks WHERE name = ?", [LOCK]);
    expect(rows.length).toBe(0);
  });

  test("creates its table on the connection it was given, not the global one", async () => {
    const other = setupTestDb(); // becomes the global Schema connection
    expect(other).not.toBe(connection);

    const handle = await acquireMigrationLock(connection, LOCK, { timeoutMs: 50 });

    const here = await connection.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migration_locks'"
    );
    const there = await other.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migration_locks'"
    );
    expect(here).toHaveLength(1);
    expect(there).toHaveLength(0);

    await handle.release();
    await teardownTestDb(other);
  });

  test("propagates non-conflict errors instead of retrying until the timeout", async () => {
    // Schema drift: the insert fails on NOT NULL, which says nothing about contention.
    await connection.run(
      "CREATE TABLE migration_locks (name TEXT PRIMARY KEY, owner TEXT, created_at TEXT, extra TEXT NOT NULL)"
    );

    const started = Date.now();
    await expect(acquireMigrationLock(connection, LOCK, { timeoutMs: 5000 })).rejects.toThrow(
      /NOT NULL constraint failed/i
    );
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test("still reports contention as a timeout when the lock is genuinely held", async () => {
    const handle = await acquireMigrationLock(connection, LOCK, { timeoutMs: 50 });

    await expect(
      acquireMigrationLock(connection, LOCK, { timeoutMs: 50, maxAgeMs: 60_000 })
    ).rejects.toThrow(`Could not acquire migration lock "${LOCK}"`);

    await handle.release();
  });
});
