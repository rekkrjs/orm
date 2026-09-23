import { afterAll, beforeAll, describe, expect, test } from "./harness.js";
import { createNodeDriver } from "../src/connection/drivers/nodeDrivers.js";
import type { SqlDriver } from "../src/connection/drivers/SqlDriver.js";
import { mysqlUrl, postgresUrl, type ServerDriver } from "./driver-harness.js";

/**
 * The Node.js adapters on their own terms, below Connection: what each one
 * guarantees and — as much — what it must leave alone. They load under Bun as
 * well, so both CI jobs run this file.
 */

const rowsOf = async (driver: SqlDriver, sql: string, bindings?: unknown[]) => (await driver.unsafe(sql, bindings)) as any[];

/** Fails instead of hanging: a pool that lost track of a session stalls rather than erroring. */
function within<T>(ms: number, promise: PromiseLike<T>): Promise<T> {
  return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`no answer within ${ms}ms`)), ms))]);
}

describe("node:sqlite adapter", () => {
  let driver: SqlDriver;
  beforeAll(() => { driver = createNodeDriver("sqlite", { url: "sqlite://:memory:" }, "sqlite://:memory:"); });
  afterAll(() => driver.close());

  test("binds booleans as 1/0 and undefined as NULL, as bun:sql does", async () => {
    expect(await rowsOf(driver, "SELECT ? AS yes, ? AS no, ? AS missing", [true, false, undefined])).toEqual([{ yes: 1, no: 0, missing: null }]);
  });

  test("hands back plain rows, with the write metadata out of enumeration", async () => {
    await driver.unsafe("CREATE TABLE plain_rows (id INTEGER PRIMARY KEY, name TEXT)");
    const write = await driver.unsafe("INSERT INTO plain_rows (name) VALUES (?), (?)", ["a", "b"]) as any;
    expect(write.count).toBe(2);
    expect(write.lastInsertRowid).toBe(2);
    expect(Object.keys(write)).toEqual([]);
    const rows = await rowsOf(driver, "SELECT * FROM plain_rows ORDER BY id");
    expect(Object.getPrototypeOf(rows[0])).toBe(Object.prototype);
    expect(Object.keys(rows)).toEqual(["0", "1"]);
  });

  test("keeps a column named __proto__ as data, as bun:sql does, without touching any prototype", async () => {
    const [scalar] = await rowsOf(driver, `SELECT 1 AS "__proto__", 2 AS b`);
    expect(Object.keys(scalar)).toEqual(["__proto__", "b"]);
    expect(Object.getOwnPropertyDescriptor(scalar, "__proto__")?.value).toBe(1);
    // A BLOB is an object, the one value an assignment would install as the row's prototype.
    const [blob] = await rowsOf(driver, `SELECT x'00' AS "__proto__", 2 AS b`);
    expect(Object.getPrototypeOf(blob)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(blob, "__proto__")?.value).toEqual(new Uint8Array([0]));
    expect(blob.b).toBe(2);
    expect(Object.keys(Object.prototype)).toEqual([]);
  });

  test("runs every statement of a script, and refuses to bind into one", async () => {
    await driver.unsafe("CREATE TABLE script_a (x); CREATE TABLE script_b (x); INSERT INTO script_b VALUES (1); -- trailing comment");
    expect(await rowsOf(driver, "SELECT count(*) AS n FROM script_b")).toEqual([{ n: 1 }]);
    await expect(driver.unsafe("INSERT INTO script_a VALUES (?); INSERT INTO script_b VALUES (?)", [1, 2])).rejects.toThrow("multi-statement");
    // Nothing of the refused script ran.
    expect(await rowsOf(driver, "SELECT count(*) AS n FROM script_a")).toEqual([{ n: 0 }]);
  });

  test("reads integers past 2^53 exactly: a string, or a bigint with bigint: true", async () => {
    const huge = 9007199254740993n;
    expect(await rowsOf(driver, "SELECT ? AS huge, ? AS negative, 5 AS small", [huge, -huge]))
      .toEqual([{ huge: "9007199254740993", negative: "-9007199254740993", small: 5 }]);
    const bigints = createNodeDriver("sqlite", { url: "sqlite://:memory:" }, "sqlite://:memory:", { bigint: true });
    try {
      expect(await rowsOf(bigints, "SELECT ? AS huge, 5 AS small", [huge])).toEqual([{ huge, small: 5 }]);
    } finally {
      await bigints.close();
    }
  });

  test("begin() commits what its callback wrote, and rolls back what it wrote before throwing", async () => {
    await driver.unsafe("CREATE TABLE begin_rows (value TEXT)");
    await driver.begin!(async (tx) => { await tx.unsafe("INSERT INTO begin_rows VALUES ('kept')"); });
    await expect(driver.begin!(async (tx) => {
      await tx.unsafe("INSERT INTO begin_rows VALUES ('discarded')");
      throw new Error("callback failed");
    })).rejects.toThrow("callback failed");
    expect(await rowsOf(driver, "SELECT value FROM begin_rows")).toEqual([{ value: "kept" }]);
  });

  test("a second begin() while one is open fails, leaving the first to finish on its own", async () => {
    await driver.unsafe("CREATE TABLE overlapping_rows (value TEXT)");
    let finishFirst!: () => void;
    const first = driver.begin!(async (tx) => {
      await tx.unsafe("INSERT INTO overlapping_rows VALUES ('first')");
      await new Promise<void>((resolve) => { finishFirst = resolve; });
    });
    // One physical connection, as in bun:sql: the second cannot open a transaction of its own.
    await expect(driver.begin!(async (tx) => { await tx.unsafe("INSERT INTO overlapping_rows VALUES ('second')"); }))
      .rejects.toThrow("cannot start a transaction within a transaction");
    finishFirst();
    await first;
    expect(await rowsOf(driver, "SELECT value FROM overlapping_rows")).toEqual([{ value: "first" }]);
  });

  test("opens read-only with ?mode=ro", async () => {
    const readOnly = createNodeDriver("sqlite", { url: "sqlite://:memory:?mode=ro" }, "sqlite://:memory:?mode=ro");
    try {
      await expect(readOnly.unsafe("CREATE TABLE refused (x)")).rejects.toThrow(/readonly/i);
    } finally {
      await readOnly.close();
    }
  });
});

const servers: Array<{ engine: ServerDriver; url: string | undefined; session: string; kill: (id: unknown) => string; alive: (id: unknown) => string }> = [
  {
    engine: "postgres",
    url: postgresUrl,
    session: "SELECT pg_backend_pid() AS id",
    kill: (id) => `SELECT pg_terminate_backend(${Number(id)})`,
    alive: (id) => `SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid = ${Number(id)}`,
  },
  {
    engine: "mysql",
    url: mysqlUrl,
    session: "SELECT CONNECTION_ID() AS id",
    kill: (id) => `KILL ${Number(id)}`,
    alive: (id) => `SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE ID = ${Number(id)}`,
  },
];

for (const { engine, url, session, kill, alive } of servers) {
  describe.skipIf(!url)(`${engine} adapter`, () => {
    let driver: SqlDriver;
    let observer: SqlDriver;
    const table = `node_adapter_${engine}_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
    const sessionId = async (target: SqlDriver) => (await rowsOf(target, session))[0].id;
    const isAlive = async (id: unknown) => Number((await rowsOf(observer, alive(id)))[0].n) > 0;

    beforeAll(async () => {
      driver = createNodeDriver(engine, { url: url! }, url, { max: 3 });
      observer = createNodeDriver(engine, { url: url! }, url, { max: 1 });
      await driver.unsafe(`CREATE TABLE ${table} (value VARCHAR(20))`);
    });

    afterAll(async () => {
      await driver?.unsafe(`DROP TABLE IF EXISTS ${table}`).then(() => undefined, () => undefined);
      await Promise.all([driver?.close(), observer?.close()]);
    });

    test("reserve() hands out distinct sessions, and release() leaves the pool serving", async () => {
      const a = await driver.reserve!();
      const b = await driver.reserve!();
      try {
        expect(await sessionId(a)).not.toBe(await sessionId(b));
        expect(await sessionId(a)).toBe(await sessionId(a));
      } finally {
        await a.release();
        await b.release();
      }
      expect(await within(5_000, rowsOf(driver, "SELECT 1 AS one"))).toEqual([{ one: 1 }]);
    });

    test("close() on a reserved session ends that session and nothing else", async () => {
      const kept = await driver.reserve!();
      const discarded = await driver.reserve!();
      const [keptId, discardedId] = [await sessionId(kept), await sessionId(discarded)];
      await discarded.close();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(await isAlive(discardedId)).toBe(false);
      expect(await isAlive(keptId)).toBe(true);
      expect(await sessionId(kept)).toBe(keptId);
      await kept.release();
      expect(await within(5_000, rowsOf(driver, "SELECT 1 AS one"))).toEqual([{ one: 1 }]);
    });

    test("a reserved session the server killed is dropped on release, not handed out again", async () => {
      const doomed = await driver.reserve!();
      const doomedId = await sessionId(doomed);
      await observer.unsafe(kill(doomedId));
      await new Promise((resolve) => setTimeout(resolve, 100));
      await expect(within(5_000, doomed.unsafe("SELECT 1"))).rejects.toThrow();
      await doomed.release();
      // Every session the pool can give now answers, and none is the dead one.
      const sessions = await Promise.all([driver.reserve!(), driver.reserve!(), driver.reserve!()]);
      try {
        const ids = await within(5_000, Promise.all(sessions.map(sessionId)));
        expect(ids).not.toContain(doomedId);
      } finally {
        for (const reserved of sessions) await reserved.release();
      }
    });

    test("an idle pooled session the server closed is replaced, not handed out again", async () => {
      // What wait_timeout, a failover or a server restart does to a quiet pool.
      const single = createNodeDriver(engine, { url: url! }, url, { max: 1 });
      try {
        const before = await sessionId(single);
        await observer.unsafe(kill(before));
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(await within(5_000, sessionId(single))).not.toBe(before);
      } finally {
        await single.close();
      }
    });

    test("begin() works on a session of its own: invisible until committed, gone when it throws", async () => {
      await driver.unsafe(`DELETE FROM ${table}`);
      await driver.begin!(async (tx) => {
        await tx.unsafe(`INSERT INTO ${table} VALUES ('committed')`);
        expect(await rowsOf(observer, `SELECT value FROM ${table}`)).toEqual([]);
      });
      await expect(driver.begin!(async (tx) => {
        await tx.unsafe(`INSERT INTO ${table} VALUES ('rolled back')`);
        throw new Error("callback failed");
      })).rejects.toThrow("callback failed");
      expect(await rowsOf(observer, `SELECT value FROM ${table}`)).toEqual([{ value: "committed" }]);
    });

    test("two begin() entries that finish out of order commit and roll back independently", async () => {
      await driver.unsafe(`DELETE FROM ${table}`);
      let finishFirst!: () => void;
      const first = driver.begin!(async (tx) => {
        await tx.unsafe(`INSERT INTO ${table} VALUES ('first')`);
        await new Promise<void>((resolve) => { finishFirst = resolve; });
        throw new Error("first rolls back");
      });
      await driver.begin!(async (tx) => { await tx.unsafe(`INSERT INTO ${table} VALUES ('second')`); });
      finishFirst();
      await expect(first).rejects.toThrow("first rolls back");
      expect(await rowsOf(observer, `SELECT value FROM ${table}`)).toEqual([{ value: "second" }]);
    });

    test("connects from driver fields as well as from a URL", async () => {
      const parsed = new URL(url!);
      const fromFields = createNodeDriver(engine, {
        driver: engine,
        host: parsed.hostname,
        port: Number(parsed.port),
        database: decodeURIComponent(parsed.pathname.slice(1)),
        username: decodeURIComponent(parsed.username),
        password: decodeURIComponent(parsed.password),
      }, undefined, { max: 1 });
      try {
        expect(await rowsOf(fromFields, "SELECT 1 AS one")).toEqual([{ one: 1 }]);
      } finally {
        await fromFields.close();
      }
    });

    test("with bigint: true, integers past 2^53 come back as bigint", async () => {
      const bigints = createNodeDriver(engine, { url: url! }, url, { max: 1, bigint: true });
      try {
        const cast = engine === "postgres" ? "9007199254740993::int8" : "CAST(9007199254740993 AS SIGNED)";
        const [row] = await rowsOf(bigints, `SELECT ${cast} AS huge`);
        expect(row.huge).toBe(9007199254740993n);
      } finally {
        await bigints.close();
      }
    });
  });
}

describe.skipIf(!postgresUrl)("postgres adapter URL options", () => {
  test("reads sslmode with libpq's meaning, as Bun does, instead of pg's verify-full and its warning", async () => {
    const warnings: string[] = [];
    const onWarning = (warning: Error) => { warnings.push(warning.message); };
    process.on("warning", onWarning);
    const url = `${postgresUrl}${postgresUrl!.includes("?") ? "&" : "?"}sslmode=require`;
    const driver = createNodeDriver("postgres", { url }, url, { max: 1 });
    try {
      // Whether the server offers TLS or not, the mode must be read the libpq way.
      await driver.unsafe("SELECT 1").then(() => undefined, (error: Error) => {
        expect(error.message).not.toMatch(/self[- ]signed|certificate/i);
      });
      await new Promise((resolve) => setImmediate(resolve));
      expect(warnings.filter((message) => message.includes("sslmode") || message.includes("SSL modes"))).toEqual([]);
    } finally {
      process.off("warning", onWarning);
      await driver.close();
    }
  });
});

describe.skipIf(!mysqlUrl)("mysql adapter URL options", () => {
  test("reads ssl-mode itself instead of handing mysql2 a key it does not know", async () => {
    const warnings: unknown[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => { warnings.push(args.join(" ")); };
    const url = `${mysqlUrl}${mysqlUrl!.includes("?") ? "&" : "?"}ssl-mode=disabled`;
    const driver = createNodeDriver("mysql", { url }, url, { max: 1 });
    try {
      expect(await rowsOf(driver, "SELECT 1 AS one")).toEqual([{ one: 1 }]);
    } finally {
      console.warn = warn;
      await driver.close();
    }
    expect(warnings).toEqual([]);
  });
});
