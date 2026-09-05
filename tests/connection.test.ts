import { expect, test, describe } from "bun:test";
import { join } from "path";
import { Connection, TransactionContext } from "../src/index.js";
import { cleanupSqliteFile } from "./helpers.js";

describe("Connection", () => {
  test("creates connection from sqlite url", () => {
    const conn = new Connection({ url: "sqlite://:memory:" });
    expect(conn.getDriverName()).toBe("sqlite");
  });

  test("creates connection from mysql url", () => {
    const conn = new Connection({ url: "mysql://user:pass@localhost:3306/db" });
    expect(conn.getDriverName()).toBe("mysql");
  });

  test("creates connection from postgres url", () => {
    const conn = new Connection({ url: "postgres://user:pass@localhost:5432/db" });
    expect(conn.getDriverName()).toBe("postgres");
  });

  test("rejects sqlite3 URLs before handing them to Bun", () => {
    expect(() => new Connection({ url: "sqlite3://app.db" })).toThrow(
      '"sqlite3" is not a supported database URL scheme',
    );
  });

  test("creates connection from driver config (sqlite)", () => {
    const conn = new Connection({ driver: "sqlite", filename: ":memory:" });
    expect(conn.getDriverName()).toBe("sqlite");
  });

  test("passes driver config directly to Bun.SQL", async () => {
    const conn = new Connection({
      driver: "mysql",
      host: "127.0.0.1",
      port: 3306,
      database: "valdyr",
      username: "root",
      password: "con/barra?#@",
    });

    expect(conn.getDriverName()).toBe("mysql");
    expect(conn.driver.options).toMatchObject({
      adapter: "mysql",
      hostname: "127.0.0.1",
      port: 3306,
      database: "valdyr",
      username: "root",
      password: "con/barra?#@",
    });
    await conn.close();
  });

  test("leaves omitted driver fields to Bun's environment resolution", async () => {
    const previous = { PGHOST: process.env.PGHOST, PGDATABASE: process.env.PGDATABASE };
    process.env.PGHOST = "db.internal";
    process.env.PGDATABASE = "envdb";

    try {
      const fromEnv = new Connection({ driver: "postgres" });
      expect(fromEnv.driver.options).toMatchObject({
        adapter: "postgres",
        hostname: "db.internal",
        database: "envdb",
      });
      await fromEnv.close();

      const explicit = new Connection({ driver: "postgres", host: "127.0.0.1" });
      expect(explicit.driver.options).toMatchObject({
        hostname: "127.0.0.1",
        database: "envdb",
      });
      await explicit.close();
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test("applies SQLite foreign keys, WAL, and synchronous NORMAL before first statement", async () => {
    const calls: string[] = [];
    const driver = {
      unsafe(sql: string) {
        calls.push(sql);
        return [];
      },
    };
    const conn = new Connection({ url: "sqlite://app.db" }, { driver: driver as any });

    await conn.query("SELECT 1");
    await conn.run("SELECT 2");

    expect(calls).toEqual([
      "PRAGMA foreign_keys=ON",
      "PRAGMA journal_mode=WAL",
      "PRAGMA synchronous=NORMAL",
      "PRAGMA busy_timeout=5000",
      "SELECT 1",
      "SELECT 2",
    ]);
  });

  test("SQLite defaults are visible through PRAGMA reads on file-backed databases", async () => {
    const dbPath = join(process.cwd(), "tests", `temp_connection_${Date.now()}.sqlite`);
    const conn = new Connection({ url: `sqlite://${dbPath}` });

    try {
      await conn.query("SELECT 1");

      const journalMode = await conn.query("PRAGMA journal_mode");
      const synchronous = await conn.query("PRAGMA synchronous");
      const foreignKeys = await conn.query("PRAGMA foreign_keys");

      const busyTimeout = await conn.query("PRAGMA busy_timeout");

      expect(journalMode[0].journal_mode).toBe("wal");
      expect(synchronous[0].synchronous).toBe(1);
      expect(foreignKeys[0].foreign_keys).toBe(1);
      // Concurrent processes on one file (e.g. the SQLite queue driver) should
      // wait out a short lock instead of erroring with SQLITE_BUSY.
      expect(busyTimeout[0].timeout).toBe(5000);
    } finally {
      await conn.close();
      await cleanupSqliteFile(dbPath);
    }
  });

  test("allows SQLite defaults to be disabled or customized", async () => {
    const disabledCalls: string[] = [];
    const disabled = new Connection(
      { url: "sqlite://app.db", sqlitePragmas: false },
      { driver: { unsafe: (sql: string) => (disabledCalls.push(sql), []) } as any },
    );
    await disabled.query("SELECT 1");
    expect(disabledCalls).toEqual(["SELECT 1"]);

    const customCalls: string[] = [];
    const custom = new Connection(
      {
        url: "sqlite://app.db",
        sqlitePragmas: { journalMode: "DELETE", synchronous: "FULL" },
      },
      { driver: { unsafe: (sql: string) => (customCalls.push(sql), []) } as any },
    );
    await custom.query("SELECT 1");
    expect(customCalls).toEqual([
      "PRAGMA foreign_keys=ON",
      "PRAGMA journal_mode=DELETE",
      "PRAGMA synchronous=FULL",
      "PRAGMA busy_timeout=5000",
      "SELECT 1",
    ]);

    const foreignKeysDisabledCalls: string[] = [];
    const foreignKeysDisabled = new Connection(
      { url: "sqlite://app.db", sqlitePragmas: { foreignKeys: false } },
      { driver: { unsafe: (sql: string) => (foreignKeysDisabledCalls.push(sql), []) } as any },
    );
    await foreignKeysDisabled.query("SELECT 1");
    expect(foreignKeysDisabledCalls).not.toContain("PRAGMA foreign_keys=ON");
  });

  test("runs and queries sql", async () => {
    const conn = new Connection({ url: "sqlite://:memory:" });
    await conn.run("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
    await conn.run("INSERT INTO test (name) VALUES ('Alice')");
    const rows = await conn.query("SELECT * FROM test WHERE name = 'Alice'");
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Alice");
  });

  test("normalizes Date bindings to ISO strings", async () => {
    const calls: any[][] = [];
    const driver = {
      unsafe(_sql: string, bindings?: any[]) {
        calls.push(bindings ?? []);
        return [];
      },
    };
    const conn = new Connection({ url: "postgres://user:pass@localhost:5432/db" }, { driver: driver as any });
    const date = new Date("2026-05-17T00:00:00.000+08:00");

    await conn.query("SELECT $1", [date, [date]]);

    expect(calls[0]).toEqual([
      "2026-05-16T16:00:00.000Z",
      ["2026-05-16T16:00:00.000Z"],
    ]);
  });

  test("supports transactions", async () => {
    const conn = new Connection({ url: "sqlite://:memory:" });
    await conn.run("CREATE TABLE tx_test (id INTEGER PRIMARY KEY)");
    await conn.beginTransaction();
    await conn.run("INSERT INTO tx_test (id) VALUES (1)");
    await conn.rollback();
    const rows = await conn.query("SELECT * FROM tx_test");
    expect(rows).toHaveLength(0);
  });

  test("supports nested transactions with savepoints", async () => {
    const conn = new Connection({ url: "sqlite://:memory:" });
    await conn.run("CREATE TABLE nested_tx_test (id INTEGER PRIMARY KEY)");

    await conn.beginTransaction();
    await conn.run("INSERT INTO nested_tx_test (id) VALUES (1)");
    await conn.beginTransaction();
    await conn.run("INSERT INTO nested_tx_test (id) VALUES (2)");
    await conn.rollback();
    await conn.commit();

    const rows = await conn.query("SELECT * FROM nested_tx_test ORDER BY id");
    expect(rows.map((row) => row.id)).toEqual([1]);
  });

  test("manual MySQL transactions reserve one pooled session", async () => {
    const calls: string[] = [];
    const reserved = {
      unsafe(sql: string) { calls.push(`reserved:${sql}`); return []; },
      release() { calls.push("RELEASE"); },
    };
    const pool = {
      async reserve() { calls.push("RESERVE"); return reserved; },
      unsafe(sql: string) { calls.push(`pool:${sql}`); return []; },
    };
    const conn = new Connection(
      { url: "mysql://user:pass@localhost:3306/db" },
      { driver: pool as any }
    );

    await conn.beginTransaction();
    await conn.run("INSERT INTO widgets (id) VALUES (1)");
    await conn.rollback();

    expect(calls).toEqual([
      "RESERVE",
      "reserved:BEGIN",
      "reserved:INSERT INTO widgets (id) VALUES (1)",
      "reserved:ROLLBACK",
      "RELEASE",
    ]);
  });

  test("opens a root transaction before nested savepoints on borrowed postgres connections", async () => {
    const calls: string[] = [];
    const reserved = {
      unsafe(sql: string) {
        calls.push(sql);
        return [];
      },
      release() {
        calls.push("RELEASE");
      },
    };
    const driver = {
      async reserve() {
        calls.push("RESERVE");
        return reserved;
      },
      unsafe(sql: string) {
        calls.push(sql);
        return [];
      },
    };
    const conn = new Connection({ url: "postgres://user:pass@localhost:5432/db" }, { driver: driver as any });

    await conn.transaction(async (tx) => {
      expect(TransactionContext.current()).toBe(tx);
      expect(tx.isInTransaction()).toBe(true);
      await tx.transaction(async () => {});
    });

    expect(calls).toEqual([
      "RESERVE",
      "BEGIN",
      "SAVEPOINT orm_trans_1",
      "RELEASE SAVEPOINT orm_trans_1",
      "COMMIT",
      "RELEASE",
    ]);
  });

  test("keeps driver.begin() callback connections on savepoints", async () => {
    const calls: string[] = [];
    const txDriver = {
      unsafe(sql: string) {
        calls.push(sql);
        return [];
      },
    };
    const driver = {
      async begin<T>(callback: (sql: any) => Promise<T> | T) {
        calls.push("BEGIN_BLOCK");
        return await callback(txDriver as any);
      },
    };
    const conn = new Connection({ url: "postgres://user:pass@localhost:5432/db" }, { driver: driver as any, ownsDriver: true });

    await conn.transaction(async (tx) => {
      expect(tx.isInTransaction()).toBe(true);
      await tx.beginTransaction();
      await tx.commit();
    });

    expect(calls).toEqual(["BEGIN_BLOCK", "SAVEPOINT orm_trans_1", "RELEASE SAVEPOINT orm_trans_1"]);
  });

  test("starts transactions directly on dedicated search_path connections", async () => {
    const calls: string[] = [];
    const reserved = {
      unsafe(sql: string) {
        calls.push(sql);
        return [];
      },
      release() {
        calls.push("RELEASE");
      },
    };
    const driver = {
      async reserve() {
        calls.push("RESERVE");
        return reserved;
      },
    };
    const conn = new Connection({ url: "postgres://user:pass@localhost:5432/db" }, { driver: driver as any, ownsDriver: true });

    await conn.withSearchPath("tenant_demo", async (tenantConnection) => {
      await tenantConnection.transaction(async () => {});
    });

    expect(calls).toEqual([
      "RESERVE",
      `SET search_path TO "tenant_demo"`,
      "BEGIN",
      "COMMIT",
      "RESET search_path",
      "RELEASE",
    ]);
  });

  test("resets and releases search_path sessions when the callback throws", async () => {
    const calls: string[] = [];
    const reserved = {
      unsafe(sql: string) { calls.push(sql); return []; },
      release() { calls.push("RELEASE"); },
    };
    const driver = { reserve: async () => reserved };
    const conn = new Connection(
      { url: "postgres://user:pass@localhost:5432/db" },
      { driver: driver as any, ownsDriver: true }
    );

    await expect(conn.withSearchPath("tenant_demo", async () => {
      throw new Error("callback failed");
    })).rejects.toThrow("callback failed");

    expect(calls).toEqual([
      `SET search_path TO "tenant_demo"`,
      "RESET search_path",
      "RELEASE",
    ]);
  });

  test("rejects unsafe PostgreSQL tenant setting names", async () => {
    const conn = new Connection({ url: "postgres://user:pass@localhost:5432/db" });

    await expect(
      conn.withTenant("tenant-1", async () => { throw new Error("Unsafe setting reached callback"); }, "app.tenant_id; RESET search_path; --")
    ).rejects.toThrow("Invalid PostgreSQL setting name");
  });

  test("sets a safe tenant role and rejects unsafe role names", async () => {
    const calls: string[] = [];
    let tenant: string | undefined;
    const txDriver = { unsafe: (sql: string, bindings?: any[]) => {
      calls.push(sql);
      if (sql.includes("set_config")) tenant = bindings?.[1];
      return sql.includes("current_setting") ? [{ tenant }] : [];
    } };
    const driver = { begin: (callback: (sql: any) => any) => callback(txDriver) };
    const conn = new Connection(
      { url: "postgres://user:pass@localhost:5432/db" },
      { driver: driver as any, ownsDriver: true }
    );

    await conn.withTenant("tenant-1", async scoped => {
      expect(scoped.getTenantId()).toBe("tenant-1");
      expect(await scoped.query("SELECT current_setting('app.tenant_id') AS tenant")).toEqual([{ tenant: "tenant-1" }]);
    }, "app.tenant_id", "tenant_reader");
    expect(calls[0]).toBe('SET LOCAL ROLE "tenant_reader"');

    await expect(
      conn.withTenant("tenant-1", async () => { throw new Error("Unsafe role reached callback"); }, "app.tenant_id", 'reader"; RESET ROLE; --')
    ).rejects.toThrow("Invalid role name");
  });

  test("auto-rolls-back and releases an abandoned manual transaction", async () => {
    const calls: string[] = [];
    const reserved = {
      unsafe(sql: string) { calls.push(sql); return []; },
      release() { calls.push("RELEASE"); },
    };
    const driver = {
      async reserve() { calls.push("RESERVE"); return reserved; },
      unsafe(sql: string) { calls.push(sql); return []; },
    };
    const conn = new Connection(
      { url: "postgres://user:pass@localhost:5432/db" },
      { driver: driver as any }
    );

    const previous = Connection.abandonedTransactionTimeoutMs;
    Connection.abandonedTransactionTimeoutMs = 50;
    try {
      await conn.beginTransaction();
      expect(conn.isInTransaction()).toBe(true);
      // Never commit/rollback. Wait past the safety window.
      await new Promise((r) => setTimeout(r, 120));

      expect(conn.isInTransaction()).toBe(false);
      expect(calls).toContain("ROLLBACK");
      expect(calls).toContain("RELEASE");

      // Slot reclaimed: a fresh transaction works.
      await conn.beginTransaction();
      expect(conn.isInTransaction()).toBe(true);
      await conn.commit();
    } finally {
      Connection.abandonedTransactionTimeoutMs = previous;
    }
  });

  test("does not fire the abandoned-transaction timer when committed in time", async () => {
    const calls: string[] = [];
    const reserved = {
      unsafe(sql: string) { calls.push(sql); return []; },
      release() { calls.push("RELEASE"); },
    };
    const driver = {
      async reserve() { calls.push("RESERVE"); return reserved; },
      unsafe(sql: string) { calls.push(sql); return []; },
    };
    const conn = new Connection(
      { url: "postgres://user:pass@localhost:5432/db" },
      { driver: driver as any }
    );

    const previous = Connection.abandonedTransactionTimeoutMs;
    Connection.abandonedTransactionTimeoutMs = 50;
    try {
      await conn.beginTransaction();
      await conn.commit();
      await new Promise((r) => setTimeout(r, 120));
      // Exactly one ROLLBACK-free lifecycle, single RELEASE, no spurious rollback.
      expect(calls).toEqual(["RESERVE", "BEGIN", "COMMIT", "RELEASE"]);
    } finally {
      Connection.abandonedTransactionTimeoutMs = previous;
    }
  });
});

describe("SQLite busy_timeout", () => {
  test("can be tuned or disabled through sqlitePragmas", async () => {
    const tuned: string[] = [];
    const conn = new Connection(
      { url: "sqlite://app.db", sqlitePragmas: { busyTimeoutMs: 250 } },
      { driver: { unsafe: (sql: string) => (tuned.push(sql), []) } as any },
    );
    await conn.query("SELECT 1");
    expect(tuned).toContain("PRAGMA busy_timeout=250");

    const off: string[] = [];
    const disabled = new Connection(
      { url: "sqlite://app.db", sqlitePragmas: { busyTimeoutMs: 0 } },
      { driver: { unsafe: (sql: string) => (off.push(sql), []) } as any },
    );
    await disabled.query("SELECT 1");
    expect(off.some((sql) => sql.startsWith("PRAGMA busy_timeout"))).toBe(false);
  });

  test("rejects a non-integer timeout rather than emitting it", async () => {
    const conn = new Connection(
      { url: "sqlite://app.db", sqlitePragmas: { busyTimeoutMs: 1.5 } },
      { driver: { unsafe: () => [] } as any },
    );
    await expect(conn.query("SELECT 1")).rejects.toThrow(/busy_timeout/);
  });
});

describe("transaction() and a manual beginTransaction()", () => {
  test("refuses to open BEGIN inside an open manual transaction", async () => {
    const conn = new Connection({ url: "sqlite://:memory:" });
    try {
      await conn.run("CREATE TABLE tx_guard (id INTEGER PRIMARY KEY)");
      await conn.beginTransaction();
      // Previously this issued a second BEGIN on the same connection.
      await expect(conn.transaction(async () => {})).rejects.toThrow(/manual beginTransaction/);
      await conn.rollback();
    } finally {
      await conn.close();
    }
  });

  test("works normally once the manual transaction is closed", async () => {
    const conn = new Connection({ url: "sqlite://:memory:" });
    try {
      await conn.run("CREATE TABLE tx_ok (id INTEGER PRIMARY KEY)");
      await conn.beginTransaction();
      await conn.run("INSERT INTO tx_ok (id) VALUES (1)");
      await conn.commit();

      await conn.transaction(async (tx) => { await tx.run("INSERT INTO tx_ok (id) VALUES (2)"); });
      expect(await conn.query("SELECT id FROM tx_ok ORDER BY id")).toEqual([{ id: 1 }, { id: 2 }] as any);
    } finally {
      await conn.close();
    }
  });

  test("nested transaction() calls still work through savepoints", async () => {
    const conn = new Connection({ url: "sqlite://:memory:" });
    try {
      await conn.run("CREATE TABLE tx_nested (id INTEGER PRIMARY KEY)");
      await conn.transaction(async (tx) => {
        await tx.run("INSERT INTO tx_nested (id) VALUES (1)");
        await tx.transaction(async (inner) => { await inner.run("INSERT INTO tx_nested (id) VALUES (2)"); });
      });
      expect(await conn.query("SELECT id FROM tx_nested ORDER BY id")).toEqual([{ id: 1 }, { id: 2 }] as any);
    } finally {
      await conn.close();
    }
  });
});
