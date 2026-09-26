import { createRequire } from "node:module";
import type { SQLInputValue, SQLOutputValue } from "node:sqlite";
import type { ConnectionConfig } from "../../types/index.js";
import type { DriverName, ReservedSqlDriver, SqlDriver } from "./SqlDriver.js";

/**
 * Node.js adapters for the SqlDriver contract. Each one reproduces what bun:sql
 * hands back — the same JS type per column, the same write metadata, and the
 * same error codes — because generated model types and Connection's own logic
 * are written against that. tests/driver-contract.integration.test.ts holds
 * them to it.
 */

const require = createRequire(import.meta.url);

/** An optional peer dependency, with an install hint instead of MODULE_NOT_FOUND. */
function peer<T>(id: string, packageName: string, engine: string): T {
  try {
    return require(id);
  } catch (error: any) {
    if (error?.code !== "MODULE_NOT_FOUND" || !String(error.message).includes(`'${id}'`)) throw error;
    throw new Error(`${engine} on Node.js needs the "${packageName}" package. Install it next to @rekkr/orm: npm install ${packageName}`, { cause: error });
  }
}

interface NodeDriverOptions { max?: number; bigint?: boolean; prepare?: boolean }

/** Write metadata rides on the rows array, non-enumerable as in bun:sql: it never shows up when the rows are logged or compared. */
function withMeta<T extends unknown[]>(rows: T, meta: Record<string, unknown>): T {
  for (const [key, value] of Object.entries(meta)) Object.defineProperty(rows, key, { value, writable: true, configurable: true });
  return rows;
}

export function createNodeDriver(driverName: DriverName, config: ConnectionConfig, url: string | undefined, options: NodeDriverOptions = {}): SqlDriver {
  switch (driverName) {
    case "sqlite": return nodeSqliteDriver(url ?? "sqlite://:memory:", options);
    case "postgres": return nodePostgresDriver(config, url, options);
    case "mysql": return nodeMysqlDriver(config, url, options);
  }
}

/** Runs the callback between BEGIN and COMMIT on a reserved session; a session that cannot roll back is discarded. */
async function beginOnReservedSession<T>(reserve: () => Promise<ReservedSqlDriver>, callback: (transaction: SqlDriver) => Promise<T>): Promise<T> {
  const session = await reserve();
  let clean = false;
  try {
    await session.unsafe("BEGIN");
    const result = await callback(session);
    await session.unsafe("COMMIT");
    clean = true;
    return result;
  } catch (error) {
    clean = await session.unsafe("ROLLBACK").then(() => true, () => false);
    throw error;
  } finally {
    if (clean) await session.release();
    else await session.close();
  }
}

// ── SQLite: node:sqlite ──────────────────────────────────────────────────────

const BLANK_SQL = /^(?:\s|;|--[^\n]*|\/\*[\s\S]*?\*\/)*$/;
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Integers are read exactly and narrowed back to a number when it is safe to.
 * Past 2^53 a value stays a string (a bigint with `bigint: true`), as MySQL's
 * BIGINT does in this ORM, where node:sqlite would fail the whole read and
 * bun:sql rounds it.
 */
function narrowInteger(value: bigint, bigint: boolean | undefined): number | bigint | string {
  return value >= -MAX_SAFE && value <= MAX_SAFE ? Number(value) : bigint ? value : String(value);
}

// ponytail: synchronous and unpooled, like better-sqlite3; each call blocks the
// event loop for the statement's duration. Fine for SQLite's workloads.
function nodeSqliteDriver(url: string, { bigint }: NodeDriverOptions): SqlDriver {
  const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
  const [path, query] = url.replace(/^sqlite:(?:\/\/)?/, "").split("?", 2);
  const db = new DatabaseSync(path || ":memory:", {
    open: false,
    readOnly: new URLSearchParams(query).get("mode") === "ro",
    // As bun:sql's SQLite: foreign keys are left to the ORM's own PRAGMA, and
    // a double-quoted name that matches no column reads as a string literal.
    enableForeignKeyConstraints: false,
    enableDoubleQuotedStringLiterals: true,
  });
  // As bun:sql, the file is opened now but a failure is reported by the first
  // statement: `orm make:migration` builds a Connection before it creates the
  // database's directory, and never runs a statement on it.
  let openError: unknown;
  try {
    db.open();
  } catch (error) {
    openError = error;
  }
  const open = () => {
    if (openError) throw openError;
    return db;
  };

  const driver: SqlDriver = {
    async unsafe(sql, bindings = []) {
      // node:sqlite binds neither booleans nor undefined; bun:sql sends 1/0 and NULL.
      const params = bindings.map((value) => value === undefined ? null : typeof value === "boolean" ? Number(value) : value) as SQLInputValue[];
      const statement = open().prepare(sql);
      statement.setReadBigInts(true);
      // prepare() compiles the first statement only and would drop the rest of a script silently.
      const tail = sql.slice(sql.indexOf(statement.sourceSQL) + statement.sourceSQL.length);
      if (!BLANK_SQL.test(tail)) {
        if (params.length) throw new Error("SQLite cannot bind parameters to a multi-statement SQL string; run the statements one at a time.");
        db.exec(sql);
        return withMeta([], { count: 0 });
      }
      const columns = statement.columns().map((column) => column.name);
      if (columns.length) {
        // Read as arrays and built into plain objects here: node:sqlite's own rows
        // have a null prototype, and copying them costs a third of the read.
        // A repeated name is set once, at its last position with its last value, as bun:sql does.
        const kept = columns.flatMap((name, i) => columns.lastIndexOf(name) === i ? [i] : []);
        statement.setReturnArrays(true);
        const rows = (statement.all(...params) as unknown as SQLOutputValue[][]).map((values) => {
          const row: Record<string, unknown> = {};
          for (const i of kept) {
            let value = values[i];
            if (typeof value === "bigint") value = narrowInteger(value, bigint);
            // Defined, not assigned: assigning "__proto__" drops the column, or with a BLOB swaps the row's prototype.
            if (columns[i] === "__proto__") Object.defineProperty(row, "__proto__", { value, enumerable: true, writable: true, configurable: true });
            else row[columns[i]!] = value;
          }
          return row;
        });
        return withMeta(rows, { count: rows.length });
      }
      const { changes, lastInsertRowid } = statement.run(...params);
      return withMeta([], { count: Number(changes), lastInsertRowid: narrowInteger(BigInt(lastInsertRowid), true) });
    },
    // One physical connection, as in bun:sql: a second begin() while one is
    // open fails with "cannot start a transaction within a transaction".
    async begin(callback) {
      open().exec("BEGIN");
      try {
        const result = await callback(driver);
        db.exec("COMMIT");
        return result;
      } catch (error) {
        if (db.isTransaction) db.exec("ROLLBACK");
        throw error;
      }
    },
    async close() {
      if (db.isOpen) db.close();
    },
  };
  return driver;
}

// ── PostgreSQL: pg ───────────────────────────────────────────────────────────

// @ts-ignore -- an optional peer: a project that typechecks this source (a git install) may not have it.
type Pg = typeof import("pg");
type PgQueryable = { query(query: string | { name: string; text: string }, values?: any[]): Promise<any> };

async function pgRun(target: PgQueryable, sql: string, bindings: any[] = [], nameFor?: (sql: string) => string | undefined): Promise<any> {
  // Without bindings pg uses the simple protocol, which (like bun:sql) runs a
  // multi-statement string and answers with one result per statement.
  const values = bindings.length ? bindings.map((value) => value ?? null) : undefined;
  // A named statement is parsed and planned once per session, as with bun:sql's prepare: true.
  const name = values && nameFor?.(sql);
  const result = await target.query(name ? { name, text: sql } : sql, values);
  const rows = (single: any) => withMeta(single.rows, { count: single.rowCount ?? 0, command: single.command });
  return Array.isArray(result) ? result.map(rows) : rows(result);
}

function nodePostgresDriver(config: ConnectionConfig, url: string | undefined, { max, bigint, prepare }: NodeDriverOptions): SqlDriver {
  const pg = peer<Pg>("pg", "pg", "PostgreSQL");
  // ponytail: the first 1000 distinct statements get a name and the rest run
  // unnamed, which bounds what each session holds on the server; an LRU with
  // DEALLOCATE if an app's hot set outgrows it.
  const names = new Map<string, string>();
  const nameFor = prepare ? (sql: string) => {
    let name = names.get(sql);
    if (name === undefined && names.size < 1000) names.set(sql, name = `orm_${names.size}`);
    return name;
  } : undefined;
  const parseTimestamptz = pg.types.getTypeParser(pg.types.builtins.TIMESTAMPTZ);
  // bun:sql reads zone-less timestamps and dates as UTC; pg reads them in the process time zone.
  const asUtc = (offset: string) => (value: string) =>
    parseTimestamptz(/infinity$/.test(value) ? value : value.replace(/( BC)?$/, `${offset}$1`));
  const types = {
    getTypeParser(oid: number, format?: any): any {
      switch (oid) {
        case pg.types.builtins.INT8: if (bigint) return BigInt; break;
        case pg.types.builtins.TIMESTAMP: return asUtc("+00");
        case pg.types.builtins.DATE: return asUtc(" 00:00:00+00");
        case pg.types.builtins.INTERVAL: return String;
      }
      return pg.types.getTypeParser(oid, format);
    },
  };
  // sslmode with libpq's meaning, as bun:sql and psql read it: pg 8 takes
  // `require` for `verify-full`, and warns on stderr that it does.
  const connectionString = url && /[?&]sslmode=/i.test(url) && !/[?&]uselibpqcompat=/i.test(url) ? `${url}&uselibpqcompat=true` : url;
  const pool = new pg.Pool({
    ...(connectionString
      ? { connectionString }
      : "driver" in config ? { host: config.host, port: config.port, database: config.database, user: config.username, password: config.password } : {}),
    max,
    types,
    // As bun:sql: a pooled session lives until the pool ends — a session-level
    // advisory lock (the migration lock) must not vanish after 10s idle — and
    // an idle pool does not keep the process alive.
    idleTimeoutMillis: 0,
    allowExitOnIdle: true,
  });
  // The pool drops an idle client the server closed; unobserved, that error would crash the process.
  pool.on("error", () => {});

  // A session is checked out by hand rather than through pool.query(), which
  // destroys its session on *any* error: one failed statement would silently
  // drop search_path, SET values and advisory locks, where bun:sql keeps them.
  // pg-pool still discards a session whose connection is gone.
  const checkout = async () => {
    const client = await pool.connect();
    // A checked-out client that loses its socket emits "error"; the failing query already reports it.
    const onError = () => {};
    client.on("error", onError);
    return { client, done: (discard: boolean) => { client.off("error", onError); client.release(discard); } };
  };

  const reserve = async (): Promise<ReservedSqlDriver> => {
    const { client, done } = await checkout();
    return {
      unsafe: (sql, bindings) => pgRun(client, sql, bindings, nameFor),
      release: () => done(false),
      close: async () => done(true),
    };
  };

  return {
    async unsafe(sql, bindings) {
      const { client, done } = await checkout();
      try {
        return await pgRun(client, sql, bindings, nameFor);
      } finally {
        done(false);
      }
    },
    reserve,
    begin: (callback) => beginOnReservedSession(reserve, callback),
    close: () => pool.end(),
  };
}

// ── MySQL: mysql2 ────────────────────────────────────────────────────────────

// @ts-ignore -- an optional peer: a project that typechecks this source (a git install) may not have it.
type Mysql = typeof import("mysql2/promise");
type MysqlQueryable = { query(sql: string): Promise<[any, any]>; execute(sql: string, values: any[]): Promise<[any, any]> };

async function mysqlRun(target: MysqlQueryable, sql: string, bindings: any[] = []): Promise<any> {
  // Server-side prepared statements whenever there are bindings, as bun:sql
  // does. Client-side escaping breaks under NO_BACKSLASH_ESCAPES, and the
  // statements that cannot be prepared (SAVEPOINT, BEGIN) take no bindings.
  let result;
  try {
    [result] = bindings.length
      ? await target.execute(sql, bindings.map((value) => value ?? null))
      : await target.query(sql);
  } catch (error) {
    // With trace: false the stack ends in mysql2's packet parser. Captured
    // again here, on the error path only, it carries the awaiting callers, as pg's does.
    if (error instanceof Error) Error.captureStackTrace(error);
    throw error;
  }
  return Array.isArray(result)
    ? withMeta(result, { count: result.length })
    : withMeta([], { count: 0, affectedRows: result.affectedRows, lastInsertRowid: result.insertId });
}

/** URL options mysql2 would otherwise warn about or misread (`ssl-mode` is not one of its keys). */
function mysqlUrlOptions(url: string) {
  const parsed = new URL(url);
  const sslMode = (parsed.searchParams.get("ssl-mode") ?? parsed.searchParams.get("sslmode"))?.toLowerCase();
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : undefined,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.slice(1)) || undefined,
    ...(sslMode?.startsWith("verify") ? { ssl: {} } : sslMode === "require" || sslMode === "required" ? { ssl: { rejectUnauthorized: false } } : {}),
  };
}

function nodeMysqlDriver(config: ConnectionConfig, url: string | undefined, { max, bigint }: NodeDriverOptions): SqlDriver {
  const mysql = peer<Mysql>("mysql2/promise", "mysql2", "MySQL");
  const env = process.env;
  const pool = mysql.createPool({
    ...(url
      ? mysqlUrlOptions(url)
      // Omitted fields come from the environment, as bun:sql resolves them (pg reads its PG* variables itself).
      : "driver" in config ? {
          host: config.host ?? env.MYSQL_HOST,
          port: config.port ?? (env.MYSQL_PORT ? Number(env.MYSQL_PORT) : undefined),
          database: config.database ?? env.MYSQL_DATABASE,
          user: config.username ?? env.MYSQL_USER ?? "root",
          password: config.password ?? env.MYSQL_PASSWORD,
        } : {}),
    connectionLimit: max ?? 10,
    // As bun:sql: dates travel as UTC whatever the process time zone, BIGINT
    // stays exact (a string past 2^53, a bigint with `bigint: true`), and a
    // write counts the rows it changed rather than the rows it matched
    // (.tmp_hacks/bun-sql-write-count.md).
    timezone: "Z",
    supportBigNumbers: true,
    bigNumberStrings: false,
    flags: ["-FOUND_ROWS"],
    // mysql2 captures a stack trace on every query to decorate errors that
    // never come: a quarter of the CPU of a point query. Errors keep message and code.
    trace: false,
    ...(bigint
      ? { typeCast: (field: any, next: () => unknown) => {
          if (field.type !== "LONGLONG") return next();
          const value = field.string();
          return value === null ? null : Number.isSafeInteger(Number(value)) ? Number(value) : BigInt(value);
        } }
      : {}),
  });

  // As bun:sql, an idle pool does not keep the process alive; a connection in use does.
  pool.pool.on("acquire", (connection: any) => connection.stream?.ref());
  pool.pool.on("release", (connection: any) => connection.stream?.unref());
  // As bun:sql since Bun 1.4.1, every connection opens in UTC, whatever the
  // server's default: the dates above travel as UTC wall clocks, and a session
  // in another zone would store them at the wrong TIMESTAMP instant and shift
  // every TIMESTAMP it reads. "connection" is emitted before the connection is
  // handed out, so the SET is queued ahead of its first statement; a connection
  // whose SET failed is discarded, failing that statement.
  pool.pool.on("connection", (connection: any) => {
    connection.query("SET time_zone = '+00:00'", (error: unknown) => { if (error) connection.destroy(); });
  });

  const reserve = async (): Promise<ReservedSqlDriver> => {
    const connection = await pool.getConnection();
    return {
      unsafe: (sql, bindings) => mysqlRun(connection, sql, bindings),
      release: () => connection.release(),
      close: async () => connection.destroy(),
    };
  };

  return {
    mysqlUtcOnConnect: true,
    exactMysqlInsertId: true,
    unsafe: (sql, bindings) => mysqlRun(pool, sql, bindings),
    reserve,
    begin: (callback) => beginOnReservedSession(reserve, callback),
    close: () => pool.end(),
  };
}

// ── Redis: ioredis ───────────────────────────────────────────────────────────

/**
 * ioredis behind the surface the Redis queue driver and cache store use. Like
 * Bun's client it holds the event loop open only while a command is in flight:
 * an idle ioredis socket would keep a script or CLI command that touched the
 * cache from ever exiting.
 */
export function createNodeRedisClient(url?: string) {
  const ioredis = peer<any>("ioredis", "ioredis", "Redis");
  const client = new (ioredis.default ?? ioredis)(url ?? process.env.REDIS_URL ?? process.env.VALKEY_URL ?? "redis://localhost:6379", { lazyConnect: true });
  let pending = 0;
  client.on("connect", () => { if (!pending) client.stream.unref(); });
  const hold = async <T>(command: () => Promise<T>): Promise<T> => {
    if (pending++ === 0) client.stream?.ref();
    try {
      return await command();
    } finally {
      if (--pending === 0) client.stream?.unref();
    }
  };
  return {
    get: (key: string): Promise<string | null> => hold(() => client.get(key)),
    del: (...keys: string[]): Promise<number> => hold(() => client.del(...keys)),
    scan: (cursor: string, match: "MATCH", pattern: string): Promise<[string, string[]]> => hold(() => client.scan(cursor, match, pattern)),
    incr: (key: string): Promise<number> => hold(() => client.incr(key)),
    llen: (key: string): Promise<number> => hold(() => client.llen(key)),
    hgetall: (key: string): Promise<Record<string, string>> => hold(() => client.hgetall(key)),
    zcard: (key: string): Promise<number> => hold(() => client.zcard(key)),
    smembers: (key: string): Promise<string[]> => hold(() => client.smembers(key)),
    send: (command: string, args: string[]): Promise<any> => hold(() => client.call(command, ...args)),
    // Held like any command: with the socket unref'd, Node would exit mid-QUIT and never settle the await.
    close: async (): Promise<void> => { await hold(() => client.quit()); },
  };
}
