import { afterAll, beforeAll, describe, expect, test, evalCommand, isBun, ormModule, runProcess, sleep, writeText } from "./harness.js";
import { isUniqueConstraintViolation } from "../src/connection/UniqueConstraintViolationError.js";
import { PermissiveModel } from "./helpers.js";
import { mkdtemp, readdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import {
  Builder,
  Connection,
  DB,
  Migrator,
  Model,
  Schema,
  TransactionContext,
  UniqueConstraintViolationError,
  backedEnum,
  type QueryEvent,
} from "../src/index.js";
import { createDriverContext, serverUrl, type ServerDriver } from "./driver-harness.js";
import { primaryKeyColumn } from "../src/model/PrimaryKeyResolution.js";
import { shouldGeneratePrimaryKeyForColumn } from "../src/utils.js";

type ContractDriver = "sqlite" | ServerDriver;

interface ContractContext {
  connection: Connection;
  dispose(): Promise<void>;
}

class ContractUser extends PermissiveModel {
  static table = "contract_users";
  static timestamps = false;

  posts() {
    return this.hasMany(ContractPost, "user_id");
  }
}

class ContractPost extends PermissiveModel {
  static table = "contract_posts";
  static timestamps = false;

  user() {
    return this.belongsTo(ContractUser, "user_id");
  }
}

class ContractDefault extends PermissiveModel {
  declare id: number;
  declare value: string | null;
  static table = "contract_defaults";
  static timestamps = false;
}

class ContractBulkStamped extends PermissiveModel {
  declare id: number;
  static table = "contract_bulk_stamped";
  static softDeletes = true;
}

class ContractInsertStamped extends PermissiveModel {
  declare id: number;
  static table = "contract_insert_stamped";
}

class ContractBulkOwner extends PermissiveModel {
  declare id: number;
  static table = "contract_bulk_owners";
}

class ContractBulkLimit extends PermissiveModel {
  static table = "contract_bulk_limits";
  static timestamps = false;
}

// saveMany() inserts in bulk only when the model generates its keys; with an
// auto-increment key it inserts row by row to read each id back.
class ContractBulkLimitUuid extends PermissiveModel {
  static table = "contract_bulk_limits_uuid";
  static timestamps = false;
  static override keyType = "uuid" as const;
}

class ContractBulkAtomic extends PermissiveModel {
  static table = "contract_bulk_atomic";
  static timestamps = false;
}

class ContractBulkAtomicUuid extends PermissiveModel {
  static table = "contract_bulk_atomic_uuid";
  static timestamps = false;
  static override keyType = "uuid" as const;
}

class ContractAggregate extends PermissiveModel {
  static table = "contract_aggregates";
  static timestamps = false;
}

// Builder.json() serializes eager graphs of simple models from driver rows: a
// BIGINT parent key next to an INTEGER foreign key is where drivers differ.
class ContractEagerAuthor extends PermissiveModel {
  static table = "contract_eager_authors";
  static timestamps = false;
  static casts = { active: "boolean", meta: "json", rating: "decimal:2" };

  books() {
    return this.hasMany(ContractEagerBook, "author_id");
  }
}

class ContractEagerBook extends PermissiveModel {
  static table = "contract_eager_books";
  static timestamps = false;
  static casts = { in_print: "boolean" };

  author() {
    return this.belongsTo(ContractEagerAuthor, "author_id");
  }
}

class ContractUniqueRecord extends PermissiveModel {
  static table = "contract_unique_records";
  static timestamps = false;
}

const ContractJsonState = backedEnum({ Ready: "ready", Paused: "paused" });

class ContractFastJson extends PermissiveModel {
  static override table = "contract_fast_json";
  static override timestamps = false;
  static override casts = {
    active: "boolean",
    happened_at: "datetime",
    metadata: "json",
    state: ContractJsonState,
  };
}

class ContractCalendarDay extends PermissiveModel {
  static override table = "contract_calendar_days";
  static override casts = { born_on: "date", seen_at: "datetime" };
}

class ContractKeyed extends PermissiveModel {
  declare id: string | number;
  static override table = "contract_keyed";
  static override timestamps = false;
}

/** The same table keyed two ways, in raw DDL: a database-assigned integer, or a UUID the ORM generates. */
const KEYED_DDL: Record<ContractDriver, { integer: string; uuid: string }> = {
  sqlite: {
    integer: "CREATE TABLE contract_keyed (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)",
    uuid: "CREATE TABLE contract_keyed (id VARCHAR(36) PRIMARY KEY, name TEXT)",
  },
  mysql: {
    integer: "CREATE TABLE contract_keyed (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(50))",
    uuid: "CREATE TABLE contract_keyed (id VARCHAR(36) PRIMARY KEY, name VARCHAR(50))",
  },
  postgres: {
    integer: "CREATE TABLE contract_keyed (id SERIAL PRIMARY KEY, name VARCHAR(50))",
    uuid: "CREATE TABLE contract_keyed (id VARCHAR(36) PRIMARY KEY, name VARCHAR(50))",
  },
};

class ContractListened extends PermissiveModel {
  static override table = "contract_listened";
  static override timestamps = false;
}

class ContractZoneless extends PermissiveModel {
  static override table = "contract_zoneless";
  static override timestamps = false;
  static override casts = { seen_at: "datetime" };
}

class ContractStamped extends PermissiveModel {
  static override table = "contract_stamped";
  static override softDeletes = true;
}

class ContractCast extends PermissiveModel {
  declare id: number;
  declare flag: boolean;
  declare flag_alias: boolean;
  declare count: number;
  declare count_alias: number;
  declare numeric: number;
  declare price: string;
  declare ratio: number;
  declare measure: number;
  declare label: string;
  declare meta: { b: number; a: number[]; s: string; n: null };
  declare details: { source: string };
  declare tags: string[];
  declare secret: string;
  declare born_on: Date | string; // Written as the day, read as a Date.
  declare seen_at: Date | null;
  declare stamped_at: Date;
  static override table = "contract_casts";
  static override timestamps = false;
  static override casts = {
    flag: "boolean", flag_alias: "bool", count: "integer", count_alias: "int", numeric: "number",
    price: "decimal:2", ratio: "float", measure: "double", label: "string",
    meta: "json", details: "object", tags: "array", secret: "base64",
    born_on: "date", seen_at: "datetime", stamped_at: "timestamp",
  };
}

/** One value per built-in cast, plus two uncast columns whose driver types differ. */
const CAST_INPUT = {
  flag: true, flag_alias: false, count: 42, count_alias: -7, numeric: 1.25,
  price: "1234.50", ratio: 3.14159, measure: 1234567.891,
  label: "ñandúÄÖüß€", // Ten characters: the column's limit.
  meta: { b: 1, a: [1, 2], s: "ñ€😀", n: null }, details: { source: "revisión" },
  tags: ["x", "y"], secret: "héllo ✓",
  born_on: "2024-01-15", seen_at: new Date(Date.UTC(2024, 0, 15, 12, 0, 0, 123)),
  stamped_at: new Date(Date.UTC(2024, 0, 16, 3, 4, 5, 678)),
  owner_id: 5, payload: new Uint8Array([0, 1, 127, 128, 255]),
};

/** What each cast promises in JSON (docs/models.md, "Built-in casts"). */
const CAST_JSON = {
  flag: true, flag_alias: false, count: 42, count_alias: -7, numeric: 1.25,
  price: "1234.50", ratio: 3.14159, measure: 1234567.891, label: "ñandúÄÖüß€",
  meta: { b: 1, a: [1, 2], s: "ñ€😀", n: null }, details: { source: "revisión" },
  tags: ["x", "y"], secret: "héllo ✓",
  born_on: "2024-01-15", seen_at: "2024-01-15T12:00:00.123Z",
  stamped_at: "2024-01-16T03:04:05.678Z",
  owner_id: 5, payload: { type: "Buffer", data: [0, 1, 127, 128, 255] },
};

/** The same table with no casts: rawJson() hands its rows back almost as the driver returned them. */
class ContractUncast extends PermissiveModel {
  static override table = "contract_casts";
  static override timestamps = false;
}

/** A value as JSON text would carry it, so that a Buffer compares by its bytes. */
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value));

async function createContext(driver: ContractDriver): Promise<ContractContext> {
  if (driver !== "sqlite") return await createDriverContext(driver);
  const connection = new Connection({ url: "sqlite://:memory:" });
  Model.setConnection(connection);
  Schema.setConnection(connection);
  return { connection, dispose: () => connection.close() };
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected promise to reject");
}

const BunSQL = isBun ? (await import("bun")).SQL : undefined;

/** The cause is the driver's own error, carrying the database's own conflict code. */
function expectDriverUniqueCause(driver: ContractDriver, error: unknown): void {
  expect(error).toBeInstanceOf(UniqueConstraintViolationError);
  const cause = (error as Error).cause;
  expect(cause).toBeInstanceOf(Error);
  expect(cause).not.toBeInstanceOf(UniqueConstraintViolationError);
  expect(isUniqueConstraintViolation(driver, cause)).toBe(true);
  if (BunSQL) expect(cause).toBeInstanceOf({ sqlite: BunSQL.SQLiteError, mysql: BunSQL.MySQLError, postgres: BunSQL.PostgresError }[driver]);
}

/** A value as `type:content`, so that 1 and "1", or a Date and its ISO string, never compare equal. */
function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value !== "object") return `${typeof value}:${String(value)}`;
  const content = value instanceof Date ? value.toISOString() : ArrayBuffer.isView(value) ? `bytes(${(value as Uint8Array).length})` : JSON.stringify(value);
  return `${value.constructor?.name}:${content}`;
}

const describeRow = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, describeValue(value)]));

/** Runs with the process in another time zone; `bun test` and the vitest config both start in UTC. */
async function inTimeZone<T>(zone: string, callback: () => Promise<T>): Promise<T> {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    expect(new Date(Date.UTC(2024, 0, 15, 12)).getTimezoneOffset()).not.toBe(0);
    return await callback();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

/**
 * The values contract, which generated model types (TypeMapper) are written
 * against: one JavaScript type per column type, whichever runtime and driver
 * decodes it. Literals, so that decoding is all that is being tested.
 */
const COLUMN_TYPES: Record<ContractDriver, { ddl: string; insert: string; expected: Record<string, string>; count: string }> = {
  sqlite: {
    ddl: "CREATE TABLE contract_column_types (tag TEXT, i INTEGER, r REAL, s TEXT, b BLOB, n INTEGER, big INTEGER)",
    insert: "INSERT INTO contract_column_types VALUES ('row', 5, 1.5, 'x', x'78', NULL, 9007199254740993)",
    expected: {
      tag: "string:row", i: "number:5", r: "number:1.5", s: "string:x", b: "Uint8Array:bytes(1)", n: "null",
      // Past 2^53 bun:sql rounds; the Node.js adapter keeps the exact value, as a string (docs/installation.md).
      big: isBun ? "number:9007199254740992" : "string:9007199254740993",
    },
    count: "number:1",
  },
  postgres: {
    ddl: `CREATE TABLE contract_column_types (tag TEXT, i2 SMALLINT, i4 INTEGER, i8 BIGINT, i8_small BIGINT, num NUMERIC(10,2),
      f8 DOUBLE PRECISION, f4 REAL, b BOOLEAN, ts TIMESTAMP(3), tstz TIMESTAMPTZ(3), d DATE, t TIME, j JSON, jb JSONB, by BYTEA,
      u UUID, ai INTEGER[], iv INTERVAL)`,
    insert: `INSERT INTO contract_column_types VALUES ('row', 1, 2, 9007199254740993, 5, 1.50, 1.5, 1.5, true,
      '2024-01-15 12:00:00.123', '2024-01-15 12:00:00.123+00', '2024-01-15', '12:34:56', '{"a":1}', '{"a":1}', 'x',
      '00000000-0000-0000-0000-000000000001', '{1,2}', '1 day')`,
    expected: {
      tag: "string:row", i2: "number:1", i4: "number:2", i8: "string:9007199254740993", i8_small: "string:5", num: "string:1.50",
      f8: "number:1.5", f4: "number:1.5", b: "boolean:true",
      ts: "Date:2024-01-15T12:00:00.123Z", tstz: "Date:2024-01-15T12:00:00.123Z", d: "Date:2024-01-15T00:00:00.000Z",
      t: "string:12:34:56", j: 'Object:{"a":1}', jb: 'Object:{"a":1}', by: "Buffer:bytes(1)",
      u: "string:00000000-0000-0000-0000-000000000001", ai: "Array:[1,2]", iv: "string:1 day",
    },
    count: "string:1",
  },
  mysql: {
    ddl: `CREATE TABLE contract_column_types (tag VARCHAR(8), big BIGINT, big_small BIGINT, dec_ DECIMAL(10,2), dt DATETIME(3),
      ts TIMESTAMP(3) NULL, d DATE, t TIME, j JSON, flag TINYINT(1), i INT, db DOUBLE, fl FLOAT, bl BLOB)`,
    insert: `INSERT INTO contract_column_types VALUES ('row', 9007199254740993, 5, 12.50, '2024-01-15 12:00:00.123',
      '2024-01-15 12:00:00.123', '2024-01-15', '12:34:56', '{"a": 1}', 1, 7, 1.5, 1.5, 'x')`,
    expected: {
      tag: "string:row", big: "string:9007199254740993", big_small: "number:5", dec_: "string:12.50",
      dt: "Date:2024-01-15T12:00:00.123Z", ts: "Date:2024-01-15T12:00:00.123Z", d: "Date:2024-01-15T00:00:00.000Z",
      t: "string:12:34:56", j: 'Object:{"a":1}', flag: "number:1", i: "number:7", db: "number:1.5", fl: "number:1.5",
      bl: "Buffer:bytes(1)",
    },
    count: "number:1",
  },
};

/** Where an instant written as a Date lands, read back as the database's own text. */
const INSTANTS: Record<ContractDriver, { ddl: string; read: string; stored: string }> = {
  sqlite: {
    ddl: "CREATE TABLE contract_instants (id INTEGER PRIMARY KEY, at TEXT)",
    read: "SELECT at AS wall_clock FROM contract_instants",
    stored: "2024-01-15T12:00:00.123Z",
  },
  postgres: {
    ddl: "CREATE TABLE contract_instants (id SERIAL PRIMARY KEY, at TIMESTAMP(3))",
    read: "SELECT to_char(at, 'YYYY-MM-DD HH24:MI:SS.MS') AS wall_clock FROM contract_instants",
    stored: "2024-01-15 12:00:00.123",
  },
  mysql: {
    ddl: "CREATE TABLE contract_instants (id INT AUTO_INCREMENT PRIMARY KEY, at DATETIME(3))",
    read: "SELECT CAST(at AS CHAR) AS wall_clock FROM contract_instants",
    stored: "2024-01-15 12:00:00.123",
  },
};

/** Session state to set, and read back, on one connection. */
const SESSION_STATE: Record<ContractDriver, { set: string; read: string }> = {
  sqlite: { set: "CREATE TEMP TABLE contract_session_marker (kept TEXT)", read: "SELECT count(*) AS marker FROM contract_session_marker" },
  postgres: { set: "SET application_name = 'orm_contract_marker'", read: "SELECT current_setting('application_name') AS marker" },
  mysql: { set: "SET @orm_contract_marker = 'kept'", read: "SELECT @orm_contract_marker AS marker" },
};

const SLEEP_SQL: Record<ContractDriver, string> = {
  sqlite: "SELECT 1 AS slept",
  postgres: "SELECT pg_sleep(0.3) AS slept",
  mysql: "SELECT SLEEP(0.3) AS slept",
};

for (const driver of ["sqlite", "mysql", "postgres"] as const) {
  const run = driver === "sqlite" || serverUrl(driver) ? test.serial : test.skip;

  describe.serial(`${driver} driver contract`, () => {
    let context: ContractContext;

    beforeAll(async () => {
      if (driver !== "sqlite" && !serverUrl(driver)) return;
      context = await createContext(driver);
    });

    afterAll(async () => {
      await context?.dispose();
    });

    run("runs callback transactions inside a test transaction and rolls back everything", async () => {
      const connection = context.connection;
      await Schema.create("contract_test_transactions", (table) => {
        table.integer("id").primary();
      }, connection);

      await connection.beginTransaction();
      try {
        await DB.table("contract_test_transactions").insert({ id: 1 });
        await DB.transaction(async () => {
          await DB.table("contract_test_transactions").insert({ id: 2 });
          await DB.transaction(async () => {
            await DB.table("contract_test_transactions").insert({ id: 3 });
          });
        });
        await expect(DB.transaction(async () => {
          await DB.table("contract_test_transactions").insert({ id: 4 });
          throw new Error("inner failure");
        })).rejects.toThrow("inner failure");
        expect(await DB.table("contract_test_transactions").orderBy("id").pluck("id")).toEqual([1, 2, 3]);
      } finally {
        await connection.rollback();
      }
      expect(await DB.table("contract_test_transactions").count()).toBe(0);

      if (driver === "sqlite") return;
      const second = new Connection(connection.getConfig());
      let ready = 0;
      let release!: () => void;
      const bothReady = new Promise<void>((resolve) => { release = resolve; });
      let firstDone!: () => void;
      const firstFinished = new Promise<void>((resolve) => { firstDone = resolve; });
      const runTest = async (session: Connection, id: number) => {
        await session.beginTransaction();
        try {
          await TransactionContext.run(session, async () => {
            await DB.transaction(async () => {
              await DB.table("contract_test_transactions").insert({ id });
            });
            if (++ready === 2) release();
            await bothReady;
            expect(await DB.table("contract_test_transactions").orderBy("id").pluck("id")).toEqual([id]);
            if (id === 2) {
              await firstFinished;
              expect(await DB.table("contract_test_transactions").orderBy("id").pluck("id")).toEqual([2]);
            }
          });
        } finally {
          await session.rollback();
          if (id === 1) firstDone();
        }
      };
      const tests = [runTest(connection, 1), runTest(second, 2)];
      try {
        await Promise.all(tests);
        expect(await DB.table("contract_test_transactions").count()).toBe(0);
      } finally {
        release();
        firstDone();
        await Promise.allSettled(tests);
        await second.close();
      }
    });

    // As in Eloquent: sum() of nothing is 0, while avg(), min() and max() of
    // nothing are SQL's NULL, so "no data" never reads as an average of zero.
    run("eager json() from driver rows matches the hydrated graph", async () => {
      const connection = context.connection;
      await Schema.create("contract_eager_authors", (table) => {
        table.bigIncrements("id");
        table.string("name", 20);
        table.boolean("active");
        table.json("meta");
        table.decimal("rating", 8, 2);
      }, connection);
      await Schema.create("contract_eager_books", (table) => {
        table.increments("id");
        table.integer("author_id").nullable();
        table.string("title", 20);
        table.boolean("in_print");
      }, connection);
      await ContractEagerAuthor.insert([
        { name: "Núñez Ångström", active: true, meta: { tags: ["á", "ß"] }, rating: "4.50" },
        { name: "Zoë", active: false, meta: {}, rating: "0.00" },
        { name: "12345678901234567890", active: true, meta: { nested: { deep: [1] } }, rating: "999999.99" },
      ]);
      const [first, , third] = await ContractEagerAuthor.orderBy("id").pluck("id");
      await ContractEagerBook.insert([
        { author_id: Number(first), title: "Á", in_print: true },
        { author_id: Number(third), title: "Ω", in_print: false },
        { author_id: Number(first), title: "B", in_print: false },
        { author_id: null, title: "Orphan", in_print: true },
      ]);

      const statements: string[] = [];
      const stop = DB.listen((event) => { statements.push(event.sql); });
      try {
        for (const query of [
          () => ContractEagerAuthor.with("books").orderBy("id"),
          () => ContractEagerBook.with("author").orderBy("id"),
        ]) {
          statements.length = 0;
          const json = await query().json();
          const direct = [...statements];
          statements.length = 0;
          const expected = (await query().get()).toJSON();
          expect(JSON.stringify(json)).toBe(JSON.stringify(expected));
          expect(direct).toEqual(statements);
          expect(direct).toHaveLength(2);
        }
      } finally {
        stop();
      }
      const authors = await ContractEagerAuthor.with("books").orderBy("id").json() as any[];
      expect(authors.map((author) => [author.name, author.active, author.rating, author.books.map((book: any) => book.title)]))
        .toEqual([
          ["Núñez Ångström", true, "4.50", ["Á", "B"]],
          ["Zoë", false, "0.00", []],
          ["12345678901234567890", true, "999999.99", ["Ω"]],
        ]);
      expect(authors[0].meta).toEqual({ tags: ["á", "ß"] });
      const books = await ContractEagerBook.with("author").orderBy("id").json() as any[];
      expect(books.map((book) => book.author?.name ?? null))
        .toEqual(["Núñez Ångström", "12345678901234567890", "Núñez Ångström", null]);
    });

    run("aggregates over no rows or only NULLs follow Eloquent", async () => {
      await Schema.create("contract_aggregates", (table) => {
        table.increments("id");
        table.string("kind");
        table.integer("score").nullable();
      }, context.connection);
      await ContractAggregate.insert([
        { kind: "scored", score: 10 },
        { kind: "scored", score: 20 },
        { kind: "blank", score: null },
      ]);
      const none = () => ContractAggregate.where("kind", "missing");
      const blank = () => ContractAggregate.where("kind", "blank");

      expect(await none().avg("score")).toBeNull();
      expect(await none().average("score")).toBeNull();
      expect(await blank().avg("score")).toBeNull();
      expect(await none().sum("score")).toBe(0);
      expect(await blank().sum("score")).toBe(0);
      expect(await none().min("score")).toBeNull();
      expect(await none().max("score")).toBeNull();
      expect(await none().count()).toBe(0);
      expect(await none().exists()).toBe(false);
      expect(await ContractAggregate.where("kind", "missing").avg("score")).toBeNull();

      // With rows the value is the database's own: a number or a decimal string.
      expect(Number(await ContractAggregate.where("kind", "scored").avg("score"))).toBe(15);
      expect(Number(await ContractAggregate.avg("score"))).toBe(15);
    });

    // 8,000 rows of 9 columns bind 72,000 parameters: past SQLite's standard
    // 32,766 (node:sqlite; Bun's build allows more) and the 65,535 of
    // PostgreSQL and MySQL. Model bulk writes default to chunks of 100 rows.
    run("model upsert() and saveMany() split large batches into chunks of 100 rows", async () => {
      const connection = context.connection;
      await Schema.create("contract_bulk_limits", (table) => {
        table.increments("id");
        table.string("code").unique();
        for (let i = 0; i < 8; i++) table.integer(`c${i}`);
      }, connection);
      await Schema.create("contract_bulk_limits_uuid", (table) => {
        table.uuid("id").primary();
        for (let i = 0; i < 8; i++) table.integer(`c${i}`);
      }, connection);
      const columns = (n: number) => ({ c0: n, c1: n, c2: n, c3: n, c4: n, c5: n, c6: n, c7: n });
      const row = (code: string, n: number) => ({ code, ...columns(n) });
      const inserts: string[] = [];
      const stop = DB.listen((event) => { if (/^\s*insert/i.test(event.sql)) inserts.push(event.sql); });
      try {
        await ContractBulkLimit.upsert(Array.from({ length: 8_000 }, (_, n) => row(`u${n}`, n)), "code");
        expect(inserts).toHaveLength(80);
        await ContractBulkLimit.upsert(Array.from({ length: 250 }, (_, n) => row(`u${n}`, -n)), "code", ["c0"]);
        expect(inserts).toHaveLength(83);
        await ContractBulkLimitUuid.saveMany(
          Array.from({ length: 8_000 }, (_, n) => new ContractBulkLimitUuid(columns(n))),
          { events: false },
        );
        expect(inserts).toHaveLength(163);
        await ContractBulkLimit.upsert([row("u7999", 1), row("u0", 2)], "code", ["c1"], { chunkSize: 1 });
        expect(inserts).toHaveLength(165);
      } finally {
        stop();
      }
      expect(await ContractBulkLimit.query().count()).toBe(8_000);
      expect(await ContractBulkLimit.where("c0", "<", 0).count()).toBe(249);
      const pick = async (code: string) => {
        const found = (await ContractBulkLimit.where("code", code).firstOrFail()) as any;
        return [found.c0, found.c1, found.c2];
      };
      expect(await pick("u249")).toEqual([-249, 249, 249]);
      expect(await pick("u250")).toEqual([250, 250, 250]);
      expect(await pick("u7999")).toEqual([7999, 1, 7999]);
      expect(await pick("u0")).toEqual([0, 2, 0]);
      expect(await ContractBulkLimitUuid.query().count()).toBe(8_000);
      expect(await ContractBulkLimitUuid.query().distinct().count("id")).toBe(8_000);
      expect(await ContractBulkLimitUuid.where("c0", 7999).where("c7", 7999).count()).toBe(1);
    });

    // As knex's batchInsert does, a batch split into several statements runs
    // in one transaction, or a savepoint inside one already open: a chunk that
    // fails takes the earlier chunks with it and nothing else.
    run("a model bulk write split into chunks is all or nothing", async () => {
      const connection = context.connection;
      await Schema.create("contract_bulk_atomic", (table) => {
        table.increments("id");
        table.string("code").unique();
        table.integer("n");
      }, connection);
      await Schema.create("contract_bulk_atomic_uuid", (table) => {
        table.uuid("id").primary();
        table.string("code");
        table.integer("n");
      }, connection);
      // Row 150 falls in the second chunk and breaks the NOT NULL on n.
      const rows = (prefix: string) => Array.from({ length: 250 }, (_, i) => ({ code: `${prefix}${i}`, n: i === 150 ? null : i }));
      await ContractBulkAtomic.insert([{ code: "kept", n: -1 }]);

      await expect(ContractBulkAtomic.insert(rows("i"), { events: false })).rejects.toThrow();
      await expect(ContractBulkAtomic.upsert(rows("u"), "code")).rejects.toThrow();
      const uuidModels = rows("s").map((row) => new ContractBulkAtomicUuid(row));
      await expect(ContractBulkAtomicUuid.saveMany(uuidModels, { events: false })).rejects.toThrow();
      // An auto-increment key inserts row by row: three models, three statements.
      const serialModels = [{ code: "a1", n: 1 }, { code: "a2", n: 2 }, { code: "a3", n: null }]
        .map((row) => new ContractBulkAtomic(row));
      await expect(ContractBulkAtomic.saveMany(serialModels, { events: false })).rejects.toThrow();
      expect(await ContractBulkAtomic.query().pluck("code")).toEqual(["kept"]);
      expect(await ContractBulkAtomicUuid.query().count()).toBe(0);

      // No model claims a row the rollback removed, so fixing the bad one and
      // saving again inserts them all instead of updating rows that are gone.
      for (const model of [...uuidModels, ...serialModels]) {
        expect(model.$exists).toBe(false);
        expect(model.getAttribute("id")).toBeUndefined();
      }
      uuidModels[150]!.setAttribute("n", 150);
      serialModels[2]!.setAttribute("n", 3);
      await ContractBulkAtomicUuid.saveMany(uuidModels, { events: false });
      await ContractBulkAtomic.saveMany(serialModels, { events: false });
      expect(await ContractBulkAtomicUuid.query().count()).toBe(250);
      expect(await ContractBulkAtomicUuid.where("code", "s150").value("n")).toBe(150);
      expect(await ContractBulkAtomic.query().orderBy("n").pluck("code")).toEqual(["kept", "a1", "a2", "a3"]);
      await ContractBulkAtomic.whereIn("code", ["a1", "a2", "a3"]).delete();

      // Inside a transaction the batch rolls back to its savepoint: the
      // caller's own writes before and after it survive the commit.
      await DB.transaction(async () => {
        await ContractBulkAtomic.insert([{ code: "before", n: -2 }]);
        await expect(ContractBulkAtomic.upsert(rows("t"), "code")).rejects.toThrow();
        await ContractBulkAtomic.insert([{ code: "after", n: -3 }]);
      });
      expect(await ContractBulkAtomic.query().orderBy("n", "desc").pluck("code")).toEqual(["kept", "before", "after"]);

      // A caller's rollback also undoes a batch that succeeded.
      await expect(DB.transaction(async () => {
        await ContractBulkAtomic.upsert(rows("r").map((row) => ({ ...row, n: 7 })), "code");
        expect(await ContractBulkAtomic.query().count()).toBe(253);
        throw new Error("caller rolls back");
      })).rejects.toThrow("caller rolls back");
      expect(await ContractBulkAtomic.query().count()).toBe(3);

      // A batch that fits in one chunk is one statement, atomic on its own.
      await ContractBulkAtomic.upsert(rows("c").slice(0, 100), "code");
      expect(await ContractBulkAtomic.query().count()).toBe(103);
    });

    run("supports schema changes, CRUD, relations, dates, JSON, upserts, and transactions", async () => {
      const connection = context.connection;

      await Schema.create("contract_users", (table) => {
        table.increments("id");
        table.string("email").unique();
        table.string("name");
        table.json("tags");
        table.timestamp("joined_at");
      }, connection);
      await Schema.create("contract_posts", (table) => {
        table.increments("id");
        table.integer("user_id").unsigned().index();
        table.string("title");
        table.foreign("user_id").references("id").on("contract_users").cascadeOnDelete();
      }, connection);

      await Schema.table("contract_users", (table) => {
        table.string("nickname").nullable();
      }, connection);
      await Schema.table("contract_users", (table) => {
        table.renameColumn("nickname", "display_name");
      }, connection);

      expect(await Schema.hasColumn("contract_users", "display_name", connection)).toBe(true);
      expect(await Schema.hasIndex("contract_posts", ["user_id"])).toBe(true);
      expect(await Schema.hasForeignKey("contract_posts", ["user_id"])).toBe(true);

      const joinedAt = new Date("2026-08-19T10:11:12.345Z");
      const user = await ContractUser.create({
        email: "ada@example.test",
        name: "Ada",
        tags: JSON.stringify(["bun", "orm"]),
        joined_at: joinedAt,
      });
      const post = await ContractPost.create({ user_id: user.getAttribute("id"), title: "First" });

      expect((await ContractUser.find(user.getAttribute("id")))?.getAttribute("name")).toBe("Ada");
      expect((await user.posts().get()).map((row) => row.getAttribute("title"))).toEqual(["First"]);
      expect((await post.user().get())?.getAttribute("email")).toBe("ada@example.test");
      expect(await ContractUser.whereDate("joined_at", "2026-08-19").count()).toBe(1);
      expect(await ContractUser.whereJsonContains("tags", "orm").count()).toBe(1);

      await new Builder(connection, "contract_users").insertOrIgnore({
        email: "ada@example.test",
        name: "Ignored",
        tags: "[]",
        joined_at: joinedAt,
      });
      expect(await ContractUser.where("email", "ada@example.test").count()).toBe(1);

      await new Builder(connection, "contract_users").upsert({
        email: "ada@example.test",
        name: "Ada Updated",
        tags: JSON.stringify(["orm"]),
        joined_at: joinedAt,
      }, "email", ["name", "tags"]);
      expect((await ContractUser.where("email", "ada@example.test").first())?.getAttribute("name")).toBe("Ada Updated");

      await expect(connection.transaction(async (transaction) => {
        await new Builder(transaction, "contract_users").insert({
          email: "rollback@example.test",
          name: "Rollback",
          tags: "[]",
          joined_at: joinedAt,
        });
        throw new Error("rollback contract");
      })).rejects.toThrow("rollback contract");
      expect(await ContractUser.where("email", "rollback@example.test").count()).toBe(0);

      user.setAttribute("name", "Saved");
      await user.save();
      expect((await ContractUser.find(user.getAttribute("id")))?.getAttribute("name")).toBe("Saved");
      await post.delete();
      expect(await ContractPost.find(post.getAttribute("id"))).toBeNull();
    });

    if (driver !== "sqlite") {
      run("change replaces a column definition without adding it again", async () => {
        const connection = context.connection;
        await Schema.create("contract_changed_columns", (table) => {
          table.increments("id");
          table.string("name");
          table.timestamp("deleted_at").nullable().useCurrent();
        }, connection);

        await Schema.table("contract_changed_columns", (table) => {
          table.timestamp("deleted_at").nullable().default(null).change();
        }, connection);

        await new Builder(connection, "contract_changed_columns").insert({ name: "active" });
        expect((await new Builder(connection, "contract_changed_columns").first())!.deleted_at).toBeNull();
      });

      run("change retypes a column whose old default cannot cast to the new type", async () => {
        const connection = context.connection;
        await Schema.create("contract_retyped_columns", (table) => {
          table.increments("id");
          table.integer("code").default(0);
        }, connection);

        // The old DEFAULT 0 is an integer literal: Postgres aborts the type
        // change unless it is dropped before ALTER COLUMN ... TYPE runs.
        await Schema.table("contract_retyped_columns", (table) => {
          table.string("code", 10).nullable().change();
        }, connection);

        await new Builder(connection, "contract_retyped_columns").insert({ code: "A-1" });
        const row = (await new Builder(connection, "contract_retyped_columns").first())!;
        expect(row.code).toBe("A-1");
      });
    }

    run("normalizes only unique violations across every write path", async () => {
      const connection = context.connection;
      await Schema.create("contract_unique_records", (table) => {
        table.increments("id");
        table.string("email").unique();
        table.string("required_value");
      }, connection);

      const first = await ContractUniqueRecord.on(connection).create({
        email: `first-${driver}@example.test`,
        required_value: "first",
      });

      const directlyCreated = await ContractUniqueRecord.on(connection).createOrFirst({
        email: `create-or-first-${driver}@example.test`,
      }, {
        required_value: "created",
      });
      const recovered = await ContractUniqueRecord.on(connection).createOrFirst({
        email: `create-or-first-${driver}@example.test`,
      }, {
        required_value: "must not overwrite",
      });
      expect(recovered.getAttribute("id")).toBe(directlyCreated.getAttribute("id"));
      expect(recovered.getAttribute("required_value")).toBe("created");

      await connection.transaction(async (transaction) => {
        await ContractUniqueRecord.on(transaction).createOrFirst({
          email: `create-or-first-${driver}@example.test`,
        }, {
          required_value: "savepoint conflict",
        });
        await ContractUniqueRecord.on(transaction).createOrFirst({
          email: `after-savepoint-${driver}@example.test`,
        }, {
          required_value: "transaction remains usable",
        });
      });
      expect(await ContractUniqueRecord.on(connection).where("email", `after-savepoint-${driver}@example.test`).count()).toBe(1);

      const config = connection.getConfig();
      const concurrentConnection = driver === "sqlite"
        ? connection
        : new Connection({ ...config, max: 5 });
      try {
        const concurrent = await Promise.all(Array.from({ length: 16 }, () =>
          ContractUniqueRecord.on(concurrentConnection).createOrFirst({
            email: `concurrent-create-or-first-${driver}@example.test`,
          }, {
            required_value: "winner",
          })
        ));
        expect(new Set(concurrent.map((record) => record.getAttribute("id"))).size).toBe(1);
        expect(await ContractUniqueRecord.on(connection)
          .where("email", `concurrent-create-or-first-${driver}@example.test`)
          .count()).toBe(1);
      } finally {
        if (concurrentConnection !== connection) await concurrentConnection.close();
      }

      // On MySQL this model path goes through runAndGetMysqlInsertId() on a
      // reserved session, which must classify the failed INSERT before trying
      // to read LAST_INSERT_ID().
      expectDriverUniqueCause(driver, await caught(ContractUniqueRecord.on(connection).create({
        email: `first-${driver}@example.test`,
        required_value: "model duplicate",
      })));
      expectDriverUniqueCause(driver, await caught(new Builder(connection, "contract_unique_records").insert({
        email: `first-${driver}@example.test`,
        required_value: "builder duplicate",
      })));
      const duplicatePrimary = driver === "postgres"
        ? connection.run(
            `INSERT INTO ${connection.getGrammar().wrap(connection.qualifyTable("contract_unique_records"))} ` +
              `("id", "email", "required_value") OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3)`,
            [first.getAttribute("id"), `primary-${driver}@example.test`, "primary duplicate"],
          )
        : new Builder(connection, "contract_unique_records").insert({
            id: first.getAttribute("id"),
            email: `primary-${driver}@example.test`,
            required_value: "primary duplicate",
          });
      expectDriverUniqueCause(driver, await caught(duplicatePrimary));

      const second = await ContractUniqueRecord.on(connection).create({
        email: `second-${driver}@example.test`,
        required_value: "second",
      });
      expectDriverUniqueCause(driver, await caught(
        ContractUniqueRecord.on(connection)
          .where("id", second.getAttribute("id"))
          .update({ email: `first-${driver}@example.test` })
      ));

      const before = await ContractUniqueRecord.on(connection).count();
      await ContractUniqueRecord.on(connection).insertOrIgnore({
        email: `first-${driver}@example.test`,
        required_value: "ignored",
      });
      expect(await ContractUniqueRecord.on(connection).count()).toBe(before);

      const notNull = await caught(new Builder(connection, "contract_unique_records").insert({
        email: `missing-${driver}@example.test`,
      }));
      expect(notNull).not.toBeInstanceOf(UniqueConstraintViolationError);
      expect(notNull).toBeInstanceOf(Error);
      expect(isUniqueConstraintViolation(driver, notNull)).toBe(false);
      if (BunSQL) expect(notNull).toBeInstanceOf({ sqlite: BunSQL.SQLiteError, mysql: BunSQL.MySQLError, postgres: BunSQL.PostgresError }[driver]);

      if (driver === "postgres") {
        const table = connection.getGrammar().wrap(connection.qualifyTable("contract_deferred_unique"));
        await connection.run(
          `CREATE TABLE ${table} (email TEXT, UNIQUE (email) DEFERRABLE INITIALLY DEFERRED)`,
        );

        const callbackError = await caught(connection.transaction(async (transaction) => {
          await new Builder(transaction, "contract_deferred_unique").insert({ email: "callback@example.test" });
          await new Builder(transaction, "contract_deferred_unique").insert({ email: "callback@example.test" });
        }));
        expectDriverUniqueCause(driver, callbackError);

        await connection.beginTransaction();
        await new Builder(connection, "contract_deferred_unique").insert({ email: "manual@example.test" });
        await new Builder(connection, "contract_deferred_unique").insert({ email: "manual@example.test" });
        expectDriverUniqueCause(driver, await caught(connection.commit()));

        expect(await new Builder(connection, "contract_deferred_unique").count()).toBe(0);
      }
    });

    run("keeps raw and nested query values out of SQL text", async () => {
      const connection = context.connection;
      const malicious = "CURRENT_TIMESTAMP OR 1=1 --";

      const nested = new Builder(connection, "contract_users").where("name", malicious);
      expect(await new Builder(connection, "contract_users").fromSub(nested, "filtered").count()).toBe(0);

      const selected = await new Builder(connection, "contract_users")
        .selectRaw("? AS marker", [malicious])
        .whereRaw("name = ?", ["Saved"])
        .first();
      expect((selected as any)?.marker).toBe(malicious);

      expect(() => new Builder(connection, "contract_users").where("name", "= ? OR 1=1 --", "missing")).toThrow("Invalid query operator");
    });

    run("distinguishes undefined from null and keeps database defaults", async () => {
      const connection = context.connection;
      await Schema.create("contract_defaults", (table) => {
        table.increments("id");
        table.string("value").nullable().default("database");
      }, connection);

      const omitted = await ContractDefault.create({ value: undefined });
      const explicitNull = await ContractDefault.create({ value: null });
      await new Builder(connection, "contract_defaults").insertOrIgnore({ value: undefined });
      await omitted.update({ value: undefined });

      expect((await ContractDefault.find(omitted.id))!.value).toBe("database");
      expect((await ContractDefault.find(explicitNull.id))!.value).toBeNull();
      expect(await ContractDefault.where("value", "database").count()).toBe(2);
    });

    // Eloquent's query update(), increment() and decrement() set updated_at
    // unless given one; soft delete and restore() go through update().
    run("sets updated_at on query writes and keeps one passed in", async () => {
      const connection = context.connection;
      await Schema.create("contract_bulk_owners", (table) => {
        table.increments("id");
        table.string("name");
        table.timestamps();
      }, connection);
      await Schema.create("contract_bulk_stamped", (table) => {
        table.increments("id");
        table.integer("owner_id");
        table.string("name");
        table.integer("count").default(0);
        table.timestamps();
        table.softDeletes();
      }, connection);

      const old = new Date("2024-01-01T00:00:00.000Z");
      const passed = new Date("2024-06-01T12:00:00.500Z");
      const owner = await ContractBulkOwner.create({ name: "ñandú", created_at: old, updated_at: old });
      const other = await ContractBulkOwner.create({ name: "other", created_at: old, updated_at: old });
      const target = await ContractBulkStamped.create({ owner_id: owner.id, name: "target", created_at: old, updated_at: old });
      const sibling = await ContractBulkStamped.create({ owner_id: other.id, name: "sibling", created_at: old, updated_at: old });
      const read = async (id: number) => (await ContractBulkStamped.withTrashed().findOrFail(id)) as any;
      const stamp = async (id: number) => ((await read(id)).updated_at as Date).getTime();
      const onTarget = () => ContractBulkStamped.withTrashed().where("id", target.id);
      const expectStamped = async (write: () => Promise<unknown>) => {
        await onTarget().update({ updated_at: old });
        expect(await stamp(target.id)).toBe(old.getTime());
        const before = Date.now();
        await write();
        const stamped = await stamp(target.id);
        expect(stamped).toBeGreaterThanOrEqual(before);
        expect(stamped).toBeLessThanOrEqual(Date.now());
      };

      await expectStamped(() => onTarget().update({ name: "updated" }));
      await expectStamped(() => onTarget().increment("count", 3));
      await expectStamped(() => onTarget().decrement("count"));
      await expectStamped(() => ContractBulkStamped.where("id", target.id).delete());
      expect((await read(target.id)).deleted_at.getTime()).toBe(await stamp(target.id));
      await expectStamped(() => ContractBulkStamped.onlyTrashed().restore());
      if (driver === "mysql") {
        // UPDATE a JOIN b: both tables have updated_at, so it must be qualified.
        await expectStamped(() => ContractBulkStamped.query()
          .updateFrom("contract_bulk_owners", "contract_bulk_owners.id", "=", "contract_bulk_stamped.owner_id")
          .where("contract_bulk_owners.name", "ñandú")
          .update({ "contract_bulk_stamped.name": "joined" }));
      }

      await onTarget().update({ name: "passed", updated_at: passed });
      expect(await stamp(target.id)).toBe(passed.getTime());
      await onTarget().increment("count", 1, { updated_at: old });
      expect(await stamp(target.id)).toBe(old.getTime());

      const final = await read(target.id);
      expect(final.name).toBe("passed");
      expect(final.count).toBe(3);
      expect(final.deleted_at).toBeNull();
      expect(final.created_at.getTime()).toBe(old.getTime());
      const untouched = await read(sibling.id);
      expect([untouched.name, untouched.count, untouched.deleted_at]).toEqual(["sibling", 0, null]);
      expect(untouched.updated_at.getTime()).toBe(old.getTime());
      for (const id of [owner.id, other.id]) {
        const row = (await ContractBulkOwner.findOrFail(id)) as any;
        expect(row.updated_at.getTime()).toBe(old.getTime());
      }
    });

    run("sets timestamps on model inserts and upserts and keeps ones passed in", async () => {
      const connection = context.connection;
      await Schema.create("contract_insert_stamped", (table) => {
        table.increments("id");
        table.string("slug").unique();
        table.string("name");
        table.timestamps();
      }, connection);

      const old = new Date("2024-01-01T00:00:00.000Z");
      const read = async (slug: string) => (await ContractInsertStamped.where("slug", slug).firstOrFail()) as any;
      const expectNow = (value: Date, before: number) => {
        expect(value.getTime()).toBeGreaterThanOrEqual(before);
        expect(value.getTime()).toBeLessThanOrEqual(Date.now());
      };

      const before = Date.now();
      await ContractInsertStamped.insertGetId({ slug: "get-id", name: "ñandú" });
      await ContractInsertStamped.insertOrIgnore([{ slug: "ignore", name: "n" }, { slug: "kept", name: "n", created_at: old, updated_at: old }]);
      await ContractInsertStamped.query().upsert({ slug: "upsert", name: "n" }, "slug", ["name"]);
      for (const slug of ["get-id", "ignore", "upsert"]) {
        const row = await read(slug);
        expectNow(row.created_at, before);
        expectNow(row.updated_at, before);
      }
      const kept = await read("kept");
      expect([kept.created_at.getTime(), kept.updated_at.getTime()]).toEqual([old.getTime(), old.getTime()]);

      await ContractInsertStamped.query().upsert({ slug: "kept", name: "updated" }, "slug", ["name"]);
      const updated = await read("kept");
      expect(updated.name).toBe("updated");
      expect(updated.created_at.getTime()).toBe(old.getTime());
      expectNow(updated.updated_at, before);

      await ContractInsertStamped.query().insert({ slug: "raw", name: "n" });
      const raw = await read("raw");
      expect([raw.created_at, raw.updated_at]).toEqual([null, null]);
      expect(await ContractInsertStamped.count()).toBe(5);
      expect((await read("get-id")).name).toBe("ñandú");
    });

    run("keeps direct query JSON equal to hydrated JSON across driver values", async () => {
      const connection = context.connection;
      await Schema.create("contract_fast_json", (table) => {
        table.increments("id");
        table.boolean("active");
        table.timestamp("happened_at");
        table.json("metadata");
        table.string("state");
      }, connection);

      await ContractFastJson.on(connection).insert({
        active: true,
        happened_at: "2026-08-20T10:11:12.000Z",
        metadata: JSON.stringify({ driver, nested: [1, 2] }),
        state: ContractJsonState.Ready,
      });

      const direct = await ContractFastJson.on(connection).rawJson();
      const hydrated = (await ContractFastJson.on(connection).get()).toJSON();
      expect(direct).toEqual(hydrated);
      expect(direct[0]).toMatchObject({
        active: true,
        metadata: { driver, nested: [1, 2] },
        state: "ready",
      });
      expect((direct[0] as any).happened_at).toBe("2026-08-20T10:11:12.000Z");
    });

    run("paginates joined and grouped queries with having bindings", async () => {
      const connection = context.connection;
      await Schema.create("contract_page_users", (table) => {
        table.increments("id");
        table.string("name");
      }, connection);
      await Schema.create("contract_page_posts", (table) => {
        table.increments("id");
        table.integer("user_id");
        table.boolean("published");
      }, connection);
      const users = new Builder(connection, "contract_page_users");
      const adaId = await users.insertGetId({ name: "Ada" });
      const graceId = await users.insertGetId({ name: "Grace" });
      await new Builder(connection, "contract_page_posts").insert([
        { user_id: adaId, published: true },
        { user_id: adaId, published: true },
        { user_id: graceId, published: false },
      ]);

      const page = await new Builder(connection, "contract_page_users")
        .select("contract_page_users.id", "contract_page_users.name")
        .join("contract_page_posts", "contract_page_users.id", "=", "contract_page_posts.user_id")
        .where("contract_page_posts.published", true)
        .groupBy("contract_page_users.id", "contract_page_users.name")
        .havingRaw("COUNT(contract_page_posts.id) >= ?", [2])
        .paginate(10, 1);

      expect(page.total).toBe(1);
      expect(page.data).toHaveLength(1);
      expect((page.data[0] as any).name).toBe("Ada");
    });

    run("enforces SET NULL, RESTRICT, and ON UPDATE CASCADE foreign keys", async () => {
      const connection = context.connection;
      await Schema.create("contract_fk_parents", (table) => {
        table.bigInteger("id").unsigned().primary();
        table.string("name");
      }, connection);
      await Schema.create("contract_fk_nullable", (table) => {
        table.id();
        table.foreignId("parent_id").nullable().constrained("contract_fk_parents")
          .onDelete("set null").onUpdate("cascade");
      }, connection);
      await Schema.create("contract_fk_restricted", (table) => {
        table.id();
        table.foreignId("parent_id").constrained("contract_fk_parents").onDelete("restrict");
      }, connection);

      const parents = new Builder(connection, "contract_fk_parents");
      const mutableId = 100;
      const restrictedId = 200;
      const updatedId = 101;
      await parents.insert([
        { id: mutableId, name: "mutable" },
        { id: restrictedId, name: "restricted" },
      ]);
      await new Builder(connection, "contract_fk_nullable").insert({ parent_id: mutableId });
      await new Builder(connection, "contract_fk_restricted").insert({ parent_id: restrictedId });

      await parents.clone().where("id", mutableId).update({ id: updatedId });
      expect(Number((await new Builder(connection, "contract_fk_nullable").first())!.parent_id)).toBe(updatedId);
      await parents.clone().where("id", updatedId).delete();
      expect((await new Builder(connection, "contract_fk_nullable").first())!.parent_id).toBeNull();
      await expect(parents.clone().where("id", restrictedId).delete()).rejects.toThrow();
    });

    if (driver === "mysql") {
      run("manual pooled transactions stay on one MySQL session", async () => {
        const config = context.connection.getConfig();
        if (!("url" in config)) throw new Error("Expected URL-based MySQL test connection.");
        await Schema.create("contract_manual_transactions", (table) => {
          table.increments("id");
          table.string("value");
        }, context.connection);
        const pooled = new Connection({ url: config.url, max: 5 });
        try {
          await pooled.beginTransaction();
          const before = (await pooled.query("SELECT CONNECTION_ID() AS id"))[0].id;
          await pooled.run("INSERT INTO contract_manual_transactions (value) VALUES (?)", ["rollback"]);
          const after = (await pooled.query("SELECT CONNECTION_ID() AS id"))[0].id;
          expect(after).toBe(before);
          await pooled.rollback();
          expect(await new Builder(context.connection, "contract_manual_transactions").count()).toBe(0);
        } finally {
          if (pooled.isInTransaction()) await pooled.rollback().catch(() => null);
          await pooled.close();
        }
      });
    }

    run("runs and rolls back migrations", async () => {
      const migrations = await mkdtemp(join(process.cwd(), "tests", ".tmp-driver-contract-"));
      const ormUrl = pathToFileURL(join(process.cwd(), "src", "index.ts")).href;
      const migrationPath = join(migrations, "20260819000000_create_contract_migrated.ts");
      await writeText(migrationPath, `
import { Migration, Schema } from ${JSON.stringify(ormUrl)};
export default class CreateContractMigrated extends Migration {
  async up() {
    await Schema.create("contract_migrated", (table) => {
      table.increments("id");
      table.string("value");
    });
  }
  async down() {
    await Schema.dropIfExists("contract_migrated");
  }
}
`);

      try {
        const migrator = new Migrator(context.connection, migrations);
        await migrator.run();
        expect(await Schema.hasTable("contract_migrated", context.connection)).toBe(true);
        expect((await migrator.status())[0]?.status).toBe("Ran");
        await migrator.rollback();
        expect(await Schema.hasTable("contract_migrated", context.connection)).toBe(false);
      } finally {
        await rm(migrations, { recursive: true, force: true });
      }
    });

    run("decodes each column type to the same JavaScript value, in any process time zone", async () => {
      const { ddl, insert, expected, count } = COLUMN_TYPES[driver];
      const connection = context.connection;
      await connection.run(ddl);
      await connection.run(insert);
      const placeholder = connection.getGrammar().placeholder(1);
      await inTimeZone("Asia/Kathmandu", async () => {
        // Both wire paths: MySQL decodes text-protocol and prepared results separately.
        const literal = (await connection.query("SELECT * FROM contract_column_types"))[0];
        const bound = (await connection.query(`SELECT * FROM contract_column_types WHERE tag = ${placeholder}`, ["row"]))[0];
        expect(describeRow(literal)).toEqual(expected);
        expect(describeRow(bound)).toEqual(expected);
      });
      expect(describeValue((await connection.query("SELECT COUNT(*) AS n FROM contract_column_types"))[0].n)).toBe(count);
    });

    // Every built-in cast, through the columns the schema builder creates:
    // what the model holds after create() is what it reads back, the three
    // JSON paths agree, and handing it the same values again changes nothing.
    run("round-trips every built-in cast through the model with nothing left pending", async () => {
      const connection = context.connection;
      await Schema.create("contract_casts", (table) => {
        table.increments("id");
        table.boolean("flag");
        table.boolean("flag_alias");
        table.integer("count");
        table.integer("count_alias");
        table.double("numeric");
        table.decimal("price", 10, 2);
        table.float("ratio");
        table.double("measure");
        table.string("label", 10);
        table.json("meta");
        table.json("details");
        table.jsonb("tags");
        table.text("secret");
        table.date("born_on");
        table.dateTime("seen_at", 3).nullable();
        table.timestamp("stamped_at", 3);
        table.bigInteger("owner_id");
        table.binary("payload");
      }, connection);

      const created = await ContractCast.create({ ...CAST_INPUT });
      expect(asJson(created.toJSON())).toEqual({ id: created.id, ...CAST_JSON });
      expect(created.getDirty()).toEqual({});

      const found = await ContractCast.findOrFail(created.id);
      // An uncast BIGINT arrives from PostgreSQL as text, as its drivers hand it over.
      const stored = { id: created.id, ...CAST_JSON, owner_id: driver === "postgres" ? "5" : 5 };
      expect(found.getDirty()).toEqual({});
      expect([found.flag, found.flag_alias, found.count, found.count_alias, found.numeric,
        found.price, found.ratio, found.measure, found.label, found.meta, found.details, found.tags, found.secret])
        .toEqual([true, false, 42, -7, 1.25, "1234.50", 3.14159, 1234567.891,
          "ñandúÄÖüß€", CAST_INPUT.meta, CAST_INPUT.details, ["x", "y"], "héllo ✓"]);
      expect([found.born_on, found.seen_at, found.stamped_at])
        .toEqual([new Date(Date.UTC(2024, 0, 15)), CAST_INPUT.seen_at, CAST_INPUT.stamped_at]);
      // Reading a json cast caches a mutable object; reading alone is no change.
      expect(found.getDirty()).toEqual({});
      expect(asJson(found.toJSON())).toEqual(stored);
      expect(asJson(await ContractCast.query().whereKey(created.id).rawJson())).toEqual([stored]);
      expect(asJson(await ContractCast.query().whereKey(created.id).json())).toEqual([stored]);
      expect(asJson(await ContractUncast.query().select("payload").whereKey(created.id).rawJson())).toEqual([{ payload: CAST_JSON.payload }]);

      // The same values again, the JSON with its keys in another order: no
      // write, so no updated_at bump and no observer, where a driver hands back
      // true for 1, 12.5 for "12.50", or a JSON object reordered.
      const statements: string[] = [];
      const stop = DB.listen((event) => { statements.push(event.sql); });
      try {
        found.fill({ ...CAST_INPUT, meta: { n: null, s: "ñ€😀", a: [1, 2], b: 1 }, payload: new Uint8Array(CAST_INPUT.payload) });
        expect(found.getDirty()).toEqual({});
        await found.save();
        expect(statements).toEqual([]);

        found.meta.b = 2;
        found.tags.push("z");
        found.flag = false;
        expect(Object.keys(found.getDirty()).sort()).toEqual(["flag", "meta", "tags"]);
        await found.save();
        expect(statements.filter((sql) => /^\s*update/i.test(sql))).toHaveLength(1);
        expect(found.getDirty()).toEqual({});
      } finally {
        stop();
      }
      const saved = await ContractCast.findOrFail(created.id);
      expect(asJson(saved.toJSON())).toEqual({ ...stored, flag: false, meta: { ...CAST_JSON.meta, b: 2 }, tags: ["x", "y", "z"] });

      // Native Date rows must not mistake null for the Unix epoch.
      const epoch = await ContractCast.create({ ...CAST_INPUT, seen_at: new Date(0) });
      const loadedEpoch = await ContractCast.findOrFail(epoch.id);
      expect(loadedEpoch.seen_at).toEqual(new Date(0));
      loadedEpoch.seen_at = null;
      expect(loadedEpoch.getDirty()).toEqual({ seen_at: null });
      await loadedEpoch.save();
      expect((await ContractCast.findOrFail(epoch.id)).seen_at).toBeNull();
    });

    run("binds a plain object as JSON, and an array as JSON or, on PostgreSQL, as an array", async () => {
      const connection = context.connection;
      await Schema.create("contract_loose", (table) => {
        table.increments("id");
        table.json("doc").nullable();
        table.text("note").nullable();
      }, connection);
      const loose = () => new Builder(connection, "contract_loose");
      const object = { b: 1, a: "ñ\"\\" };
      await loose().insert({ doc: object, note: object });
      await loose().insert({ note: ["a", 'b"c', null] });
      const [withObject, withArray] = await connection.query("SELECT doc, note FROM contract_loose ORDER BY id");
      // A JSON column comes back parsed from MySQL and PostgreSQL, as text from SQLite.
      expect(driver === "sqlite" ? JSON.parse(withObject.doc) : withObject.doc).toEqual(object);
      // A text column holds the JSON, never "[object Object]".
      expect(JSON.parse(withObject.note)).toEqual(object);
      expect(withArray.note).toBe(driver === "postgres" ? '{"a","b\\"c",NULL}' : '["a","b\\"c",null]');
    });

    run("stores a Date as its UTC wall clock whatever the process time zone", async () => {
      const { ddl, read, stored } = INSTANTS[driver];
      const connection = context.connection;
      const instant = new Date("2024-01-15T12:00:00.123Z");
      await connection.run(ddl);
      await inTimeZone("America/New_York", async () => {
        await new Builder(connection, "contract_instants").insert({ at: instant });
        expect((await connection.query(read))[0].wall_clock).toBe(stored);
        const [row] = await new Builder(connection, "contract_instants").get();
        expect(new Date((row as any).at).toISOString()).toBe(instant.toISOString());
      });
    });

    // DB.listen reports the application's statements: not the transaction
    // control, savepoints and checks the ORM runs around them on each driver.
    run("reports each application statement once, and nothing the ORM runs on its own", async () => {
      const connection = context.connection;
      await Schema.create("contract_listened", (table) => {
        table.increments("id");
        table.string("email").unique();
        table.timestamp("seen_at", 3).nullable();
      }, connection);
      const events: QueryEvent[] = [];
      // The connection is live: whether it is in a transaction is read on arrival.
      const inTransaction = new Map<QueryEvent, boolean>();
      const stop = DB.listen((event) => {
        events.push(event);
        inTransaction.set(event, event.connection.isInTransaction());
      });
      try {
        // A Date makes MySQL check the session is UTC, and create() reads
        // LAST_INSERT_ID there; PostgreSQL uses RETURNING instead.
        await ContractListened.create({ email: "ada@example.com", seen_at: new Date("2024-01-15T12:00:00.000Z") });
        await connection.transaction(async (tx) => {
          await tx.query("SELECT 1 AS one");
          await tx.transaction(async (inner) => { await inner.query("SELECT 2 AS two"); });
        });
        await connection.beginTransaction();
        await connection.query("SELECT 3 AS three");
        await connection.rollback();
        await connection.pretend(async () => { await connection.query("SELECT 4 AS four"); });
        const duplicate = await caught(ContractListened.create({ email: "ada@example.com" }));

        // Plumbing never shows: transaction control, savepoints, connection
        // pragmas, MySQL's UTC check and LAST_INSERT_ID.
        const plumbing = /^\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b|PRAGMA (foreign_keys|journal_mode|synchronous|busy_timeout)|LAST_INSERT_ID|TIMESTAMPDIFF/i;
        expect(events.map((event) => event.sql).filter((sql) => plumbing.test(sql))).toEqual([]);
        // create() also reads the primary key's column, a real query that is
        // reported like any other; how many it runs is not what this pins.
        const statements = events.filter((event) => !/table_info|information_schema/i.test(event.sql));
        expect(statements.map((event) => event.sql.split(/\s+/)[0]!.toUpperCase())).toEqual(["INSERT", "SELECT", "SELECT", "SELECT", "INSERT"]);
        expect(statements.slice(0, 4).map((event) => event.error)).toEqual([undefined, undefined, undefined, undefined]);
        expect(duplicate).toBeInstanceOf(UniqueConstraintViolationError);
        expect(statements[4]!.error).toBe(duplicate);
        for (const event of events) {
          expect(event.durationMs).toBeGreaterThanOrEqual(0);
          expect(event.connection.resourceConnection()).toBe(connection.resourceConnection());
        }
        // Inside a transaction the event names the session that ran it.
        expect(statements.map((event) => inTransaction.get(event))).toEqual([false, true, true, true, false]);
      } finally {
        stop();
      }
    });

    // create() decides how to fill and read back the key from the key column.
    // It reads that column once per table, and again whenever this process may
    // have changed the table: through the schema builder, raw DDL, or a
    // transaction whose schema change was committed or undone.
    run("reads a table's primary key column once, and again after this process changes the table", async () => {
      const connection = context.connection;
      const { integer, uuid } = KEYED_DDL[driver];
      const isUuid = (id: unknown) => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id);
      const statements: string[] = [];
      const stop = DB.listen((event) => { statements.push(event.sql); });
      const lookups = () => statements.filter((sql) => /table_info|information_schema/i.test(sql)).length;
      try {
        await Schema.create("contract_keyed", (table) => {
          table.increments("id");
          table.string("name");
        }, connection);
        statements.length = 0;
        for (const name of ["a", "b", "c"]) await ContractKeyed.create({ name });
        await connection.transaction(async () => { await ContractKeyed.create({ name: "in a transaction" }); });
        expect(lookups()).toBe(1);
        expect(statements.filter((sql) => /^\s*insert/i.test(sql))).toHaveLength(4);

        // Re-keyed through the schema builder: the ORM now generates a UUID.
        await Schema.drop("contract_keyed");
        await Schema.create("contract_keyed", (table) => {
          table.string("id", 36).primary();
          table.string("name");
        }, connection);
        expect(isUuid((await ContractKeyed.create({ name: "d" })).id)).toBe(true);

        // Re-keyed through raw DDL: the database assigns the key again.
        await connection.run("DROP TABLE contract_keyed");
        await connection.run(integer);
        const numbered = await ContractKeyed.create({ name: "e" });
        expect(isUuid(numbered.id)).toBe(false);
        expect(Number(numbered.id)).toBeGreaterThan(0);

        // MySQL commits DDL on the spot; elsewhere a rolled-back change is undone,
        // and what create() learned inside that transaction goes with it.
        if (driver !== "mysql") {
          const undo = new Error("undo the re-key");
          const rolledBack = await caught(connection.transaction(async (tx) => {
            await tx.run("DROP TABLE contract_keyed");
            await tx.run(uuid);
            expect(isUuid((await ContractKeyed.create({ name: "inside" })).id)).toBe(true);
            throw undo;
          }));
          expect(rolledBack).toBe(undo);
          expect(isUuid((await ContractKeyed.create({ name: "f" })).id)).toBe(false);

          // The same through a manual transaction.
          await connection.beginTransaction();
          await connection.run("DROP TABLE contract_keyed");
          await connection.run(uuid);
          expect(isUuid((await ContractKeyed.create({ name: "manual" })).id)).toBe(true);
          await connection.rollback();
          expect(isUuid((await ContractKeyed.create({ name: "g" })).id)).toBe(false);
        }
      } finally {
        stop();
      }
    });

    if (driver === "postgres") {
      // Schema-per-tenant: the same unqualified table name in two schemas of one
      // database. The remembered key column belongs to the schema it came from.
      run("keeps two schemas' key columns apart for the same table name", async () => {
        const connection = context.connection;
        const schemas = { assigned: `keyed_int_${process.pid}`, generated: `keyed_uuid_${process.pid}` };
        try {
          await connection.run(`CREATE SCHEMA "${schemas.assigned}"`);
          await connection.run(`CREATE SCHEMA "${schemas.generated}"`);
          await connection.run(`CREATE TABLE "${schemas.assigned}".keyed_rows (id SERIAL PRIMARY KEY)`);
          await connection.run(`CREATE TABLE "${schemas.generated}".keyed_rows (id VARCHAR(36) PRIMARY KEY)`);
          const assigned = connection.withSchema(schemas.assigned);
          const generated = connection.withSchema(schemas.generated);
          for (let round = 0; round < 2; round++) {
            expect(shouldGeneratePrimaryKeyForColumn(await primaryKeyColumn(assigned, "keyed_rows", "id"))).toBe(false);
            expect(shouldGeneratePrimaryKeyForColumn(await primaryKeyColumn(generated, "keyed_rows", "id"))).toBe(true);
          }
        } finally {
          await connection.run(`DROP SCHEMA IF EXISTS "${schemas.assigned}" CASCADE`);
          await connection.run(`DROP SCHEMA IF EXISTS "${schemas.generated}" CASCADE`);
        }
      });
    }

    if (driver !== "sqlite") {
      // Whether a statement is reported is decided when it starts: one already
      // running when the first listener arrives stays unreported, and each of
      // two overlapping statements carries its own duration.
      run("decides at the start of each statement, and times overlapping ones apart", async () => {
        const connection = context.connection;
        const sleeping = connection.query(SLEEP_SQL[driver]);
        await sleep(100);
        const events: QueryEvent[] = [];
        const stop = DB.listen((event) => { events.push(event); });
        try {
          await sleeping;
          expect(events).toEqual([]);

          await Promise.all([connection.query(SLEEP_SQL[driver]), connection.query(SLEEP_SQL[driver])]);
          expect(events.map((event) => event.sql)).toEqual([SLEEP_SQL[driver], SLEEP_SQL[driver]]);
          for (const event of events) expect(event.durationMs).toBeGreaterThanOrEqual(250);
        } finally {
          stop();
        }
      });
    }

    // Date-time text without a zone is UTC: the ORM stores it that way and
    // SQLite's CURRENT_TIMESTAMP writes it that way. The engine alone reads it
    // in the process's local time.
    run("reads and writes zone-less date-time text as UTC, whatever the process time zone", async () => {
      await Schema.create("contract_zoneless", (table) => {
        table.increments("id");
        table.dateTime("seen_at", 3);
      }, context.connection);
      const noon = "2026-08-27T12:00:00.000Z";
      await inTimeZone("America/New_York", async () => {
        // Text written by something other than the model, through the model,
        // and through the model's query builder.
        await new Builder(context.connection, "contract_zoneless").insert({ seen_at: "2026-08-27 12:00:00" });
        await ContractZoneless.create({ seen_at: "2026-08-27 12:00:00" });
        await ContractZoneless.query().insert({ seen_at: "2026-08-27 12:00:00" });

        const rows = await ContractZoneless.query().orderBy("id").get();
        expect(rows.map((row: any) => (row.seen_at as Date).toISOString())).toEqual([noon, noon, noon]);
        const direct = await ContractZoneless.query().orderBy("id").rawJson();
        expect(direct.map((row: any) => row.seen_at)).toEqual([noon, noon, noon]);
        // Decoding the value is not a change: the text and its Date name one instant.
        expect(rows.map((row: any) => row.isDirty())).toEqual([false, false, false]);
      });
    });

    // At the default precision the model's Date milliseconds used to be rounded
    // by PostgreSQL and MySQL, so the saved model and the stored row disagreed.
    run("keeps model timestamps equal in memory and in storage at the default precision", async () => {
      await Schema.create("contract_stamped", (table) => {
        table.increments("id");
        table.string("name");
        table.timestamps();
        table.softDeletes();
      }, context.connection);
      const iso = (model: any, key: string) => (model[key] as Date).toISOString();
      // A Date lands on .000 once in a thousand; three rounds make a false pass negligible.
      for (const name of ["a", "b", "c"]) {
        const model = await ContractStamped.create({ name });
        const created = (await ContractStamped.find((model as any).id))!;
        expect([iso(created, "created_at"), iso(created, "updated_at")])
          .toEqual([iso(model, "created_at"), iso(model, "updated_at")]);

        (model as any).name = `${name}-renamed`;
        await model.save();
        expect(iso((await ContractStamped.find((model as any).id))!, "updated_at")).toBe(iso(model, "updated_at"));

        await model.delete();
        const trashed = (await ContractStamped.withTrashed().find((model as any).id))!;
        expect(iso(trashed, "deleted_at")).toBe(iso(model, "deleted_at"));
        // Untouched by the later writes: created_at still matches what create() held.
        expect(iso(trashed, "created_at")).toBe(iso(created, "created_at"));
      }
    });

    // A `date` is a calendar day. As an instant, its UTC midnight is the day
    // before for anyone west of UTC who formats it in local time.
    run("serializes a date cast as its calendar day, whatever the process time zone", async () => {
      await Schema.create("contract_calendar_days", (table) => {
        table.increments("id");
        table.date("born_on");
        table.dateTime("seen_at", 3);
        table.timestamps();
      }, context.connection);
      const midnight = new Date("2024-01-15T00:00:00.000Z");
      await inTimeZone("America/New_York", async () => {
        await ContractCalendarDay.create({ born_on: midnight, seen_at: midnight });
        const model = (await ContractCalendarDay.query().first())!;
        const hydrated = model.toJSON() as Record<string, any>;
        const [direct] = await ContractCalendarDay.query().rawJson() as Record<string, any>[];

        for (const json of [hydrated, model.json() as Record<string, any>, direct!]) {
          expect(json.born_on).toBe("2024-01-15");
          // Untouched: a datetime and the timestamps keep the whole instant.
          expect(json.seen_at).toBe("2024-01-15T00:00:00.000Z");
          expect(json.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        }
        expect(JSON.stringify(direct)).toBe(JSON.stringify(hydrated));
        // Reading the attribute still gives the Date at UTC midnight.
        expect(((model as any).born_on as Date).toISOString()).toBe(midnight.toISOString());
      });
    });

    run("keeps a session's state after one of its statements fails", async () => {
      const url = driver === "sqlite" ? "sqlite://:memory:" : serverUrl(driver)!;
      const session = new Connection({ url, max: 1 });
      try {
        await session.run(SESSION_STATE[driver].set);
        const before = (await session.query(SESSION_STATE[driver].read))[0].marker;
        await expect(session.query("SELECT * FROM contract_no_such_table")).rejects.toThrow();
        await expect(session.run("THIS IS NOT SQL")).rejects.toThrow();
        // search_path, SET values and advisory locks live here; a pool that
        // swapped the session after an error would lose them without a word.
        expect((await session.query(SESSION_STATE[driver].read))[0].marker).toEqual(before);
      } finally {
        await session.close();
      }
    });

    if (driver === "mysql") {
      // A session in another zone stores a bound Date at the wrong TIMESTAMP
      // instant and reads every TIMESTAMP shifted. bun:sql sets UTC as each
      // connection opens since Bun 1.4.1 (oven-sh/bun#40439); the mysql2
      // adapter matches it. The test server is UTC already, so the session's
      // own statement history is what shows the SET.
      run("opens every pooled session in UTC, before its first statement", async () => {
        const SET_UTC = "SET time_zone = '+00:00'";
        const HISTORY = "SELECT SQL_TEXT AS sql_text FROM performance_schema.events_statements_history WHERE THREAD_ID = PS_CURRENT_THREAD_ID() ORDER BY EVENT_ID";
        const history = async (connection: Connection) => (await connection.query(HISTORY)).map((row: any) => row.sql_text);

        const pooled = new Connection({ url: serverUrl(driver)!, max: 1 });
        try {
          await pooled.query("SELECT 1 AS one");
          expect(await history(pooled)).toEqual([SET_UTC, "SELECT 1 AS one"]);
        } finally {
          await pooled.close();
        }

        // Transactions take their sessions through a reservation instead; two at once are two new sessions.
        const reserved = new Connection({ url: serverUrl(driver)!, max: 2 });
        try {
          let arrived = 0;
          let allArrived!: () => void;
          const barrier = new Promise<void>((resolve) => { allArrived = resolve; });
          const sessions = await Promise.all([0, 1].map(() => reserved.transaction(async (transaction) => {
            if (++arrived === 2) allArrived();
            await barrier;
            const [session] = await transaction.query("SELECT CONNECTION_ID() AS id, @@session.time_zone AS tz");
            return { ...session, statements: await history(transaction) };
          })));
          expect(new Set(sessions.map((session) => session.id)).size).toBe(2);
          for (const { tz, statements } of sessions) {
            expect(tz).toBe("+00:00");
            expect(statements[0]).toBe(SET_UTC);
            expect(statements.filter((sql: string) => /^\s*SET\b/i.test(sql))).toEqual([SET_UTC]);
          }
        } finally {
          await reserved.close();
        }
      });
    }

    if (driver === "sqlite") {
      // `orm make:migration` builds its Connection before it creates the database's directory.
      run("reports a file it cannot open on the first statement, not when the connection is built", async () => {
        const dir = await mkdtemp(join(tmpdir(), "orm-sqlite-open-"));
        try {
          const unopenable = new Connection({ url: `sqlite://${join(dir, "missing", "app.db")}` });
          try {
            await expect(unopenable.query("SELECT 1 AS one")).rejects.toThrow("unable to open database file");
            // The failed open created neither the directory nor the file.
            expect(await readdir(dir)).toEqual([]);
          } finally {
            await unopenable.close();
          }
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      });
    }

    if (driver !== "sqlite") {
      run("resolves omitted driver fields from the adapter's environment variables", async () => {
        const parsed = new URL(serverUrl(driver)!);
        const names = driver === "postgres"
          ? { host: "PGHOST", port: "PGPORT", user: "PGUSER", password: "PGPASSWORD", database: "PGDATABASE" }
          : { host: "MYSQL_HOST", port: "MYSQL_PORT", user: "MYSQL_USER", password: "MYSQL_PASSWORD", database: "MYSQL_DATABASE" };
        const values = {
          host: parsed.hostname,
          port: parsed.port,
          user: decodeURIComponent(parsed.username),
          password: decodeURIComponent(parsed.password),
          database: decodeURIComponent(parsed.pathname.slice(1)),
        };
        const previous = Object.fromEntries(Object.values(names).map((name) => [name, process.env[name]]));
        for (const [field, name] of Object.entries(names)) process.env[name] = values[field as keyof typeof values];
        // No TLS here, unlike CI's MySQL URL: MySQL 8 accepts it because this suite's context already
        // authenticated this user over TLS, which primes caching_sha2_password's fast path.
        const fromEnv = new Connection({ driver, max: 1 } as any);
        try {
          const current = driver === "postgres" ? "SELECT current_database() AS name" : "SELECT DATABASE() AS name";
          expect((await fromEnv.query(current))[0].name).toBe(values.database);
        } finally {
          await fromEnv.close();
          for (const [name, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
          }
        }
      });
    }

    run("lets an unclosed connection's process exit, but not before a query in flight settles", async () => {
      const url = driver === "sqlite" ? "sqlite://:memory:" : serverUrl(driver)!;
      const script = `
        const { Connection } = await import(${JSON.stringify(pathToFileURL(ormModule("src/index.ts")).href)});
        const connection = new Connection({ url: process.env.CONTRACT_URL });
        await connection.query("SELECT 1 AS one");
        // Floated, not awaited: nothing but the query itself may hold the process open.
        connection.query(${JSON.stringify(SLEEP_SQL[driver])}).then(() => console.log("settled"));
      `;
      const result = await runProcess(evalCommand(script), { env: { ...process.env, CONTRACT_URL: url }, timeoutMs: 10_000 });
      expect(result.timedOut).toBe(false);
      expect(result.stderr).toBe("");
      expect(result.stdout.trim()).toBe("settled");
      expect(result.exitCode).toBe(0);
    }, 15_000);
  });
}
