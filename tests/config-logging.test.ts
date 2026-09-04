import { describe, test, expect, afterEach } from "bun:test";
import { Connection, ConnectionManager } from "../src/index.js";
import { reconfigureOrm } from "../src/config/OrmConfig.js";

const base = { connection: { url: "sqlite://:memory:" } } as any;

afterEach(async () => {
  await ConnectionManager.closeAll();
  Connection.logQueries = false;
  Connection.logBindings = false;
  Connection.queryLogFile = undefined;
  Connection.logToConsole = true;
});

describe("query logging configuration", async () => {
  test("bindings are hidden unless asked for", async () => {
    await reconfigureOrm({ ...base, log: { console: true } });
    expect(Connection.logBindings).toBe(false);

    await reconfigureOrm({ ...base, log: { console: true, bindings: true } });
    expect(Connection.logBindings).toBe(true);
  });

  test("a later configuration cannot inherit bindings: true", async () => {
    // Logging state lives on statics; leaving a field untouched let a previous
    // opt-in survive into a config that never asked for it and quietly resume
    // writing credentials to the log.
    await reconfigureOrm({ ...base, log: { console: true, bindings: true, file: "/tmp/orm-log-test" } });
    expect(Connection.logBindings).toBe(true);

    await reconfigureOrm({ ...base, log: true });
    expect(Connection.logBindings).toBe(false);
    expect(Connection.queryLogFile).toBeUndefined();
  });

  test("omitting log entirely turns logging off rather than keeping the old state", async () => {
    await reconfigureOrm({ ...base, log: { console: true, bindings: true } });
    await reconfigureOrm({ ...base });
    expect(Connection.logQueries).toBe(false);
    expect(Connection.logBindings).toBe(false);
  });

  test("log: false turns logging off", async () => {
    await reconfigureOrm({ ...base, log: true });
    await reconfigureOrm({ ...base, log: false });
    expect(Connection.logQueries).toBe(false);
    expect(Connection.logBindings).toBe(false);
  });

  test("a logged query reports the binding count instead of the values", async () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
    try {
      await reconfigureOrm({ ...base, log: { console: true } });
      const conn = new Connection({ url: "sqlite://:memory:" });
      conn.logQueries = true;
      await conn.run("CREATE TABLE secrets (id INTEGER PRIMARY KEY, token TEXT)");
      await conn.run("INSERT INTO secrets (token) VALUES (?)", ["s3cr3t-token"]);
      await conn.close();
    } finally {
      console.log = original;
    }

    const insert = lines.find((line) => line.includes("INSERT INTO secrets"));
    expect(insert).toBeDefined();
    expect(insert).not.toContain("s3cr3t-token");
    expect(insert).toContain("1 binding hidden");
  });

  test("bindings: true logs the values", async () => {
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
    try {
      await reconfigureOrm({ ...base, log: { console: true, bindings: true } });
      const conn = new Connection({ url: "sqlite://:memory:" });
      conn.logQueries = true;
      await conn.run("CREATE TABLE secrets2 (id INTEGER PRIMARY KEY, token TEXT)");
      await conn.run("INSERT INTO secrets2 (token) VALUES (?)", ["visible-token"]);
      await conn.close();
    } finally {
      console.log = original;
    }

    expect(lines.find((line) => line.includes("INSERT INTO secrets2"))).toContain("visible-token");
  });
});
