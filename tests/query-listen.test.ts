import { afterEach, beforeEach, describe, expect, sleep, test } from "./harness.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { subscribe, unsubscribe } from "node:diagnostics_channel";
import { Connection, DB, Model, UniqueConstraintViolationError, type QueryEvent } from "../src/index.js";
import { queryChannel } from "../src/connection/Connection.js";
import { PermissiveModel } from "./helpers.js";

class ListenedUser extends PermissiveModel {
  static override table = "listened_users";
  static override timestamps = false;
}

/** Everything a misbehaving listener could leak: console.error lines and process-level errors. */
function captureLeaks() {
  const reported: unknown[][] = [];
  const uncaught: unknown[] = [];
  const realError = console.error;
  const onUncaught = (error: unknown) => { uncaught.push(error); };
  console.error = (...args: unknown[]) => { reported.push(args); };
  process.on("uncaughtException", onUncaught);
  process.on("unhandledRejection", onUncaught);
  return {
    reported,
    uncaught,
    release() {
      console.error = realError;
      process.off("uncaughtException", onUncaught);
      process.off("unhandledRejection", onUncaught);
    },
  };
}

describe("DB.listen", () => {
  let connection: Connection;
  const stops: Array<() => void> = [];
  const listen = (listener: (event: QueryEvent) => void | Promise<void>) => {
    const stop = DB.listen(listener);
    stops.push(stop);
    return stop;
  };

  beforeEach(async () => {
    connection = new Connection({ url: "sqlite://:memory:" });
    Model.setConnection(connection);
    await connection.run("CREATE TABLE listened_users (id INTEGER PRIMARY KEY, email TEXT UNIQUE)");
  });

  afterEach(async () => {
    for (const stop of stops.splice(0)) stop();
    await connection.close();
    // Every test leaves the channel as it found it: nobody listening, no cost.
    expect(queryChannel.hasSubscribers).toBe(false);
  });

  test("reports each statement once, with its SQL, bindings, duration and connection", async () => {
    const events: QueryEvent[] = [];
    listen((event) => { events.push(event); });

    await connection.run("INSERT INTO listened_users (email) VALUES (?)", ["ada@example.com"]);
    const found = await ListenedUser.query().where("email", "ada@example.com").first();

    expect(found).not.toBeNull();
    expect(events).toHaveLength(2);
    expect(events[0]!.sql).toBe("INSERT INTO listened_users (email) VALUES (?)");
    expect(events[0]!.bindings).toEqual(["ada@example.com"]);
    expect(events[1]!.sql).toMatch(/^select /i);
    expect(events[1]!.bindings).toEqual(["ada@example.com"]);
    for (const event of events) {
      expect(event.durationMs).toBeGreaterThanOrEqual(0);
      expect(event.connection.resourceConnection()).toBe(connection);
      expect(event.error).toBeUndefined();
      expect("error" in event).toBe(false);
    }
  });

  test("reports a failed statement with the error its caller receives", async () => {
    await connection.run("INSERT INTO listened_users (email) VALUES (?)", ["ada@example.com"]);
    const events: QueryEvent[] = [];
    listen((event) => { events.push(event); });

    const error = await connection.run("INSERT INTO listened_users (email) VALUES (?)", ["ada@example.com"]).catch((caught) => caught);

    expect(error).toBeInstanceOf(UniqueConstraintViolationError);
    expect(events).toHaveLength(1);
    expect(events[0]!.error).toBe(error);
  });

  test("a listener changes no result", async () => {
    await connection.run("INSERT INTO listened_users (email) VALUES (?), (?)", ["ada@example.com", "grace@example.com"]);
    const read = () => ListenedUser.query().orderBy("id").get().then((rows) => rows.toJSON());
    const write = () => connection.run("UPDATE listened_users SET email = email");
    const unheard = [await read(), await write()];

    listen(() => {});
    expect([await read(), await write()]).toEqual(unheard);
  });

  test("a listener that throws or rejects is reported, and harms neither the query nor other listeners", async () => {
    const leaks = captureLeaks();
    try {
      const seen: string[] = [];
      listen(() => { throw new Error("sync listener failure"); });
      listen(async () => { throw new Error("async listener failure"); });
      listen((event) => { seen.push(event.sql); });

      expect(await connection.query("SELECT 1 AS one")).toEqual([{ one: 1 }]);
      await sleep(20);

      expect(seen).toEqual(["SELECT 1 AS one"]);
      expect(leaks.uncaught).toEqual([]);
      expect(leaks.reported.map(([label, error]) => [label, (error as Error).message]).sort()).toEqual([
        ["[orm] A query listener threw:", "async listener failure"],
        ["[orm] A query listener threw:", "sync listener failure"],
      ]);
    } finally {
      leaks.release();
    }
  });

  test("stopping removes only that listener, in any order, and twice is harmless", async () => {
    const heard = { first: 0, second: 0, twice: 0 };
    const stopFirst = listen(() => { heard.first++; });
    const stopSecond = listen(() => { heard.second++; });
    const twice = () => { heard.twice++; };
    const stopTwiceA = listen(twice);
    const stopTwiceB = listen(twice);

    await connection.query("SELECT 1");
    expect(heard).toEqual({ first: 1, second: 1, twice: 2 });

    // Out of order: the first registered stops first, then one of the duplicates.
    stopFirst();
    stopTwiceA();
    stopFirst();
    await connection.query("SELECT 1");
    expect(heard).toEqual({ first: 1, second: 2, twice: 3 });

    stopSecond();
    stopTwiceB();
    expect(queryChannel.hasSubscribers).toBe(false);
    await connection.query("SELECT 1");
    expect(heard).toEqual({ first: 1, second: 2, twice: 3 });
  });

  test("a listener that runs a query hears its own statement", async () => {
    const seen: string[] = [];
    let reentered = false;
    listen(async (event) => {
      seen.push(event.sql);
      if (reentered) return;
      reentered = true;
      await connection.query("SELECT 2 AS two");
    });

    await connection.query("SELECT 1 AS one");
    for (let wait = 0; seen.length < 2 && wait < 50; wait++) await sleep(5);

    expect(seen).toEqual(["SELECT 1 AS one", "SELECT 2 AS two"]);
  });

  // What APM tooling relies on: the listener sees the async context of the
  // code that ran the statement, and a query it runs joins that transaction.
  test("a listener runs in the async context of the statement it hears", async () => {
    const request = new AsyncLocalStorage<string>();
    const heard: Array<{ sql: string; request?: string; inTransaction: boolean }> = [];
    let followUp: Promise<unknown> | undefined;
    listen((event) => {
      heard.push({ sql: event.sql, request: request.getStore(), inTransaction: event.connection.isInTransaction() });
      if (event.sql === "SELECT 1 AS inside") followUp = DB.raw("SELECT 2 AS from_listener");
    });

    await request.run("request-42", () => connection.transaction(async (tx) => {
      await tx.query("SELECT 1 AS inside");
      await followUp;
    }));
    await connection.query("SELECT 3 AS outside");

    expect(heard).toEqual([
      { sql: "SELECT 1 AS inside", request: "request-42", inTransaction: true },
      { sql: "SELECT 2 AS from_listener", request: "request-42", inTransaction: true },
      { sql: "SELECT 3 AS outside", request: undefined, inTransaction: false },
    ]);
  });

  test("the channel is public: a subscriber by name gets the event DB.listen gets", async () => {
    const direct: unknown[] = [];
    const viaListen: QueryEvent[] = [];
    const onMessage = (message: unknown) => { direct.push(message); };
    subscribe("@rekkr/orm:query", onMessage);
    try {
      expect(queryChannel.hasSubscribers).toBe(true);
      listen((event) => { viaListen.push(event); });

      await connection.query("SELECT 1 AS one");

      expect(direct).toHaveLength(1);
      expect(direct[0]).toBe(viaListen[0]);
    } finally {
      unsubscribe("@rekkr/orm:query", onMessage);
    }
  });

  test("does not report what the ORM runs on its own", async () => {
    // A fresh SQLite connection applies its pragmas before the first statement.
    const fresh = new Connection({ url: "sqlite://:memory:" });
    const events: QueryEvent[] = [];
    listen((event) => { events.push(event); });
    try {
      await fresh.query("SELECT 1 AS one");
      await fresh.transaction(async (tx) => {
        await tx.query("SELECT 2 AS two");
        await tx.transaction(async (inner) => { await inner.query("SELECT 3 AS three"); });
      });
      await fresh.beginTransaction();
      await fresh.query("SELECT 4 AS four");
      await fresh.rollback();
      await fresh.beginTransaction();
      await fresh.commit();
      await fresh.pretend(async () => { await fresh.query("SELECT 5 AS five"); });

      expect(events.map((event) => event.sql)).toEqual([
        "SELECT 1 AS one", "SELECT 2 AS two", "SELECT 3 AS three", "SELECT 4 AS four",
      ]);
    } finally {
      await fresh.close();
    }
  });
});
