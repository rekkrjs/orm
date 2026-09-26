import { createRequire } from "node:module";
import { afterAll, describe, expect, isBun, test } from "./harness.js";
import { Builder, Connection, DB, Model, Schema } from "../src/index.js";
import { createDriverContext, mysqlUrl, postgresUrl, type DriverContext } from "./driver-harness.js";

const runIfMySql = mysqlUrl ? test.serial : test.skip;
const runIfNodeMySql = mysqlUrl && !isBun ? test.serial : test.skip;
const runIfPostgres = postgresUrl ? test.serial : test.skip;

/**
 * A server whose sessions start at +02:00, for the mysql2 pools created during
 * the callback. The test servers are UTC, and changing their global default
 * would reach every suite running beside this one; a listener registered ahead
 * of the ORM's runs first on each new session, as a server default does.
 */
async function withSkewedMysqlServer<T>(callback: () => Promise<T>): Promise<T> {
  const mysql = createRequire(import.meta.url)("mysql2/promise");
  const createPool = mysql.createPool;
  mysql.createPool = (options: unknown) => {
    const pool = createPool(options);
    pool.pool.prependListener("connection", (session: any) => session.query("SET time_zone = '+02:00'"));
    return pool;
  };
  try {
    return await callback();
  } finally {
    mysql.createPool = createPool;
  }
}

const contexts: DriverContext[] = [];

async function context(driver: "mysql" | "postgres"): Promise<DriverContext> {
  const created = await createDriverContext(driver);
  contexts.push(created);
  return created;
}

class Reading extends Model {
  static override table = "readings";
  static override fillable = ["label", "taken_at"];
  static override casts = { taken_at: "datetime" };
}

class CamelReading extends Model {
  static override table = "camel_readings";
  static override fillable = ["label"];
  static override createdAtColumn = "createdAt";
  static override updatedAtColumn = "updatedAt";
}

class CalendarReading extends Model {
  static override table = "calendar_readings";
  static override fillable = ["label", "observed_on"];
  static override casts = { observed_on: "date" };
  static override timestamps = false;
}

async function expectPortableCalendarDate(connection: Connection): Promise<void> {
  CalendarReading.connection = connection;
  await Schema.create("calendar_readings", (table) => {
    table.increments("id");
    table.string("label", 20);
    table.date("observed_on");
  }, connection);

  const created = await CalendarReading.create({
    label: "one",
    observed_on: new Date("2026-08-26T23:45:12.345Z"),
  } as any);
  expect(created.$attributes.observed_on).toBe("2026-08-26");

  const reloaded = await CalendarReading.where("label", "one").first();
  expect((reloaded as any).observed_on.toISOString()).toBe("2026-08-26T00:00:00.000Z");
  expect(JSON.parse(JSON.stringify(reloaded!.toJSON())).observed_on).toBe("2026-08-26");
}

describe.serial("Date storage across drivers", () => {
  afterAll(async () => {
    for (const created of contexts) await created.dispose();
  });

  test("a model with a date cast can be built with no connection at all", () => {
    class Detached extends Model {
      static override table = "detached";
      static override casts = { when: "datetime" };
      static override fillable = ["when"];
    }

    // Factories and plain construction must not require a database.
    const detached = new Detached({ when: new Date("2026-08-19T14:00:00.123Z") } as any);
    expect((detached as any).when.toISOString()).toBe("2026-08-19T14:00:00.123Z");
  });

  test("SQLite preserves a calendar date through the model cast", async () => {
    const connection = new Connection({ url: "sqlite://:memory:" });
    try {
      await expectPortableCalendarDate(connection);
    } finally {
      await connection.close();
    }
  });

  runIfMySql("MySQL preserves a calendar date through the model cast", async () => {
    const { connection } = await context("mysql");
    await expectPortableCalendarDate(connection);
  });

  runIfPostgres("PostgreSQL preserves a calendar date through the model cast", async () => {
    const { connection } = await context("postgres");
    await expectPortableCalendarDate(connection);
  });

  runIfMySql("MySQL stores timestamps it accepts, keeping milliseconds", async () => {
    const { connection } = await context("mysql");

    await Schema.create("readings", (table) => {
      table.increments("id");
      table.string("label", 20);
      table.dateTime("taken_at", 3);
      table.timestamps({ precision: 3 });
    }, connection);

    const taken = new Date("2026-08-19T14:00:00.123Z");
    const reading = await Reading.create({ label: "one", taken_at: taken } as any);

    expect(await Schema.getColumn("readings", "taken_at", connection))
      .toMatchObject({ type: "datetime(3)", precision: 3 });

    const rows = await connection.query("SELECT label, taken_at, created_at FROM readings");
    expect(rows).toHaveLength(1);
    // ISO-8601 is a syntax error to MySQL: this insert failing is the whole point.
    expect(new Date(rows[0].taken_at).toISOString()).toBe("2026-08-19T14:00:00.123Z");
    expect(rows[0].created_at).not.toBeNull();
    expect((reading as any).taken_at.toISOString()).toBe("2026-08-19T14:00:00.123Z");
  });

  runIfMySql("MySQL serializes configured model timestamp columns", async () => {
    const { connection } = await context("mysql");
    await connection.run(
      "CREATE TABLE camel_readings (id BIGINT AUTO_INCREMENT PRIMARY KEY, label VARCHAR(20), createdAt DATETIME(3), updatedAt DATETIME(3))"
    );

    await CamelReading.create({ label: "camel" });
    const [row] = await connection.query("SELECT createdAt, updatedAt FROM camel_readings");
    expect(row.createdAt).not.toBeNull();
    expect(row.updatedAt).not.toBeNull();
  });

  runIfMySql("MySQL accepts a fractional value on a whole-second column", async () => {
    const { connection } = await context("mysql");

    await connection.run(
      "CREATE TABLE readings (id BIGINT AUTO_INCREMENT PRIMARY KEY, label VARCHAR(20), taken_at DATETIME, created_at DATETIME, updated_at DATETIME)"
    );

    await Reading.create({ label: "coarse", taken_at: new Date("2026-08-19T14:00:00.123Z") } as any);

    const rows = await connection.query("SELECT taken_at FROM readings");
    expect(new Date(rows[0].taken_at).toISOString()).toBe("2026-08-19T14:00:00.000Z");
  });

  runIfMySql("every write path renders dates MySQL accepts", async () => {
    const { connection } = await context("mysql");
    await connection.run(
      "CREATE TABLE readings (id BIGINT AUTO_INCREMENT PRIMARY KEY, label VARCHAR(30), taken_at DATETIME(3), created_at DATETIME(3), updated_at DATETIME(3), deleted_at DATETIME(3) NULL)"
    );

    class Soft extends Model {
      static override table = "readings";
      static override fillable = ["label", "taken_at"];
      static override casts = { taken_at: "datetime" };
      static override softDeletes = true;
    }

    const taken = new Date("2026-08-19T14:00:00.123Z");

    // Each of these builds its payload somewhere different, and every one of
    // them used to die on "Incorrect datetime value".
    await Soft.insert([{ label: "insert", taken_at: taken }] as any);
    await Soft.upsert([{ label: "upsert", taken_at: taken }] as any, ["label"] as any);
    await Soft.updateOrInsert({ label: "updateOrInsert" } as any, { taken_at: taken } as any);

    const withEvents = new Soft({ label: "saveMany-events", taken_at: taken } as any);
    await (Soft as any).saveMany([withEvents]);
    const withoutEvents = new Soft({ label: "saveMany-plain", taken_at: taken } as any);
    await (Soft as any).saveMany([withoutEvents], { events: false });

    const updated = await Soft.where("label", "insert").first();
    (updated as any).taken_at = new Date("2026-08-19T15:00:00.456Z");
    await updated!.save();
    await updated!.touch();
    await updated!.increment("id", 0); // instance path adds its own updated_at
    await Soft.where("label", "upsert").increment("id", 0, { taken_at: taken } as any);
    await withEvents.delete(); // soft delete writes deleted_at

    const rows = await connection.query("SELECT label, taken_at FROM readings ORDER BY id");
    expect(rows.length).toBeGreaterThanOrEqual(5);
    for (const row of rows as any[]) {
      expect(row.taken_at).not.toBeNull();
    }
    const reread = await Soft.where("label", "insert").first();
    expect((reread as any).taken_at.toISOString()).toBe("2026-08-19T15:00:00.456Z");

    const trashed = await connection.query(
      "SELECT deleted_at FROM readings WHERE label = 'saveMany-events'"
    );
    expect(trashed[0]?.deleted_at).not.toBeNull();
  });

  runIfMySql("a TIMESTAMP column keeps the instant, checked by UNIX_TIMESTAMP", async () => {
    const { connection } = await context("mysql");
    await connection.run(
      "CREATE TABLE readings (id BIGINT AUTO_INCREMENT PRIMARY KEY, label VARCHAR(20), taken_at TIMESTAMP(3), created_at TIMESTAMP(3) NULL, updated_at TIMESTAMP(3) NULL)"
    );

    const taken = new Date("2026-08-19T14:00:00.123Z");
    await Reading.create({ label: "stamp", taken_at: taken } as any);

    // Reading the driver's value back would hide a shift; the server's own
    // notion of the instant would not.
    const rows = await connection.query("SELECT UNIX_TIMESTAMP(taken_at) AS epoch FROM readings");
    expect(Number(rows[0].epoch)).toBeCloseTo(taken.getTime() / 1000, 3);
  });

  runIfMySql("refuses a session that is not UTC instead of storing another instant", async () => {
    const { connection } = await context("mysql");

    // max: 1 makes the SET, UTC assertion and attempted query share a session.
    const { Connection: Conn } = await import("../src/index.js");
    const skewed = new Conn({ url: (connection as any).getConfig().url, max: 1 });
    await skewed.run("SET time_zone = '+02:00'");
    try {
      // Every attempt must fail. A rejected first attempt used to mark the
      // connection as checked, allowing the second one to store a shifted value.
      for (let attempt = 0; attempt < 2; attempt++) {
        await expect(
          skewed.run("SELECT ?", [new Date("2026-08-19T14:00:00.123Z")])
        ).rejects.toThrow(/time zone .* from UTC/);
      }
    } finally {
      await skewed.close();
    }
  });

  runIfMySql("timestamped MySQL create and update add no UTC or id round trip", async () => {
    const connection = new Connection({ url: mysqlUrl!, max: 1 });
    const table = `utc_fast_${process.pid}_${Date.now()}`;
    class Stamped extends Model {
      static override table = table;
      static override fillable = ["name"];
    }
    Stamped.setConnection(connection);
    const historySql = "SELECT EVENT_ID AS id, SQL_TEXT AS statement FROM performance_schema.events_statements_history WHERE THREAD_ID = PS_CURRENT_THREAD_ID() ORDER BY EVENT_ID";
    const history = () => connection.query<{ id: number; statement: string }>(historySql);

    try {
      await Schema.create(table, (column) => {
        column.increments("id");
        column.string("name");
        column.timestamps();
      }, connection);
      const beforeInsert = Math.max(0, ...(await history()).map((event) => Number(event.id)));
      const record = await Stamped.create({ name: "first" } as any);
      const insertEvents = (await history()).filter((event) => Number(event.id) > beforeInsert).map((event) => event.statement);
      expect(insertEvents.filter((sql) => /TIMESTAMPDIFF|LAST_INSERT_ID/i.test(sql))).toEqual([]);

      const beforeUpdate = Math.max(0, ...(await history()).map((event) => Number(event.id)));
      record.setAttribute("name", "updated");
      await record.save();
      const updateEvents = (await history()).filter((event) => Number(event.id) > beforeUpdate).map((event) => event.statement);
      expect(updateEvents.filter((sql) => /TIMESTAMPDIFF|LAST_INSERT_ID/i.test(sql))).toEqual([]);
      const stored = await connection.query<{ name: string }>(`SELECT name FROM ${table} WHERE id = ?`, [(record as any).id]);
      expect(stored).toEqual([{ name: "updated" }]);
      expect(await new Builder(connection, table).count()).toBe(1);
    } finally {
      await connection.run(`DROP TABLE IF EXISTS ${table}`);
      await connection.close();
    }
  });

  runIfNodeMySql("reads and writes in UTC on a server whose sessions start in another zone", async () => {
    const { connection } = await context("mysql");
    const url = (connection as any).getConfig().url;
    const noon = new Date("2026-01-15T12:00:00.000Z");
    await connection.run("CREATE TABLE stamps (id INT PRIMARY KEY, taken_at TIMESTAMP(3))");
    await connection.run("INSERT INTO stamps VALUES (1, '2026-01-15 12:00:00.000')");

    await withSkewedMysqlServer(async () => {
      const pool = new Connection({ url, max: 3 });
      const statements: string[] = [];
      const stop = DB.listen((event) => {
        if (event.connection.resourceConnection() === pool) statements.push(event.sql);
      });
      try {
        // Left at +02:00, this statement would read 14:00Z; the one that makes
        // the pool open its first session must already run in UTC.
        const [first] = await pool.query("SELECT @@session.time_zone AS tz, taken_at FROM stamps WHERE id = 1");
        expect(first.tz).toBe("+00:00");
        expect(first.taken_at.toISOString()).toBe("2026-01-15T12:00:00.000Z");

        await pool.run("INSERT INTO stamps VALUES (?, ?)", [2, noon]);
        const [stored] = await connection.query("SELECT UNIX_TIMESTAMP(taken_at) AS epoch FROM stamps WHERE id = 2");
        expect(Number(stored.epoch)).toBe(noon.getTime() / 1000);

        // Three sessions held at once: the idle one and two the pool opens for transactions.
        let arrived = 0;
        let allArrived!: () => void;
        const barrier = new Promise<void>((resolve) => { allArrived = resolve; });
        const sessions = await Promise.all([0, 1, 2].map(() => pool.transaction(async (transaction) => {
          if (++arrived === 3) allArrived();
          await barrier;
          const [row] = await transaction.query("SELECT CONNECTION_ID() AS id, @@session.time_zone AS tz, taken_at FROM stamps WHERE id = 1");
          await transaction.query("SELECT 1");
          // The simulated server default's SET and the ORM's, however many
          // statements ran: two show the simulation reached the session.
          const [sets] = await transaction.query("SHOW SESSION STATUS LIKE 'Com_set_option'");
          return { id: row.id, tz: row.tz, takenAt: row.taken_at.toISOString(), sets: sets.Value };
        })));
        expect(new Set(sessions.map((session) => session.id)).size).toBe(3);
        expect(sessions.map(({ tz, takenAt, sets }) => ({ tz, takenAt, sets }))).toEqual(
          Array(3).fill({ tz: "+00:00", takenAt: "2026-01-15T12:00:00.000Z", sets: "2" })
        );

        // Plumbing, like the UTC check: the application's statements only.
        expect(statements.filter((sql) => /^\s*SET\b/i.test(sql))).toEqual([]);
      } finally {
        stop();
        await pool.close();
      }
    });
  });

  runIfPostgres("PostgreSQL round-trips a date through the ORM's own schema", async () => {
    const { connection } = await context("postgres");

    await Schema.create("readings", (table) => {
      table.increments("id");
      table.string("label");
      table.dateTime("taken_at");
      table.timestamps();
    });

    await Reading.create({ label: "one", taken_at: new Date("2026-08-19T14:00:00.123Z") } as any);

    const reloaded = await Reading.where("label", "one").first();
    // `dateTime()` compiles to TIMESTAMP(0) here, so the column itself drops the
    // milliseconds — the instant survives to the second.
    expect((reloaded as any).taken_at.toISOString()).toBe("2026-08-19T14:00:00.000Z");
  });

  runIfPostgres("PostgreSQL persists configured model timestamp columns", async () => {
    const { connection } = await context("postgres");
    await Schema.create("camel_readings", (table) => {
      table.increments("id");
      table.string("label");
      table.timestamps("createdAt", "updatedAt");
    });

    const reading = await CamelReading.create({ label: "camel" });
    expect(reading.getAttribute("createdAt")).toBeDefined();
    expect(reading.getAttribute("updatedAt")).toBeDefined();
  });

  runIfPostgres("PostgreSQL keeps milliseconds when the column has the precision", async () => {
    const { connection } = await context("postgres");

    await Schema.create("readings", (table) => {
      table.increments("id");
      table.string("label");
      table.dateTime("taken_at", 3);
      table.timestamps({ precision: 3 });
    }, connection);

    await Reading.create({ label: "fine", taken_at: new Date("2026-08-19T14:00:00.123Z") } as any);

    expect(await Schema.getColumn("readings", "taken_at", connection))
      .toMatchObject({ type: "timestamp without time zone", precision: 3 });

    const rows = await connection.query("SELECT taken_at FROM readings");
    expect(new Date(rows[0].taken_at).toISOString()).toBe("2026-08-19T14:00:00.123Z");
  });

  runIfPostgres("raw SQL stays inside the run's schema", async () => {
    const { connection, namespace } = await context("postgres");

    // Unqualified DDL must not reach public: that is what contaminates a shared
    // database when only the ORM's own queries are schema-aware.
    await connection.run("CREATE TABLE loose_items (id INT PRIMARY KEY)");

    // Scoped to this run's namespace and public: another suite running at the
    // same time owns a namespace of its own, and its tables are none of our
    // business.
    const found = await connection.query(
      "SELECT schemaname FROM pg_tables WHERE tablename = 'loose_items' AND schemaname IN ($1, 'public')",
      [namespace]
    );
    const schemas = found.map((row: any) => row.schemaname);
    expect(schemas).toContain(namespace);
    expect(schemas).not.toContain("public");
  });
});
