import { SQL, FileSink } from "bun";
import type { ConnectionConfig } from "../types/index.js";
import { Grammar } from "../query/grammars/Grammar.js";
import { SQLiteGrammar } from "../query/grammars/SQLiteGrammar.js";
import { MySqlGrammar } from "../query/grammars/MySqlGrammar.js";
import { PostgresGrammar } from "../query/grammars/PostgresGrammar.js";
import { UniqueConstraintViolationError } from "./UniqueConstraintViolationError.js";

function isUniqueConstraintViolation(
  driverName: "sqlite" | "mysql" | "postgres",
  error: unknown,
): boolean {
  switch (driverName) {
    case "sqlite":
      return error instanceof SQL.SQLiteError && (
        error.code === "SQLITE_CONSTRAINT_UNIQUE" ||
        error.code === "SQLITE_CONSTRAINT_PRIMARYKEY"
      );
    case "postgres":
      return error instanceof SQL.PostgresError && (
        // Bun 1.4 reports the server SQLSTATE in errno while code stays generic.
        error.code === "23505" || error.errno === "23505"
      );
    case "mysql":
      return error instanceof SQL.MySQLError && (
        error.code === "ER_DUP_ENTRY" || error.errno === 1062
      );
  }
}

export class Connection {
  /** Every driver the ORM has a grammar for. Anything else is rejected up front. */
  static readonly SUPPORTED_DRIVERS = ["sqlite", "mysql", "postgres"] as const;
  readonly driver: SQL;
  private driverName: "sqlite" | "mysql" | "postgres";
  private grammar: Grammar;
  private config: ConnectionConfig;
  private schema?: string;
  private ownsDriver: boolean;
  private transactionDepth = 0;
  private transactionActive = false;
  private transactionRoot = false;
  private savepointId = 0;
  private dedicated = false;
  private reservedDriver?: SQL & { release?: () => void };
  private abandonedTimer?: ReturnType<typeof setTimeout>;
  private sqliteDefaultsApplied = false;
  private sqliteDefaultsPromise?: Promise<void>;
  private mysqlUtcChecked = false;
  /** When set (ms), a manual beginTransaction() with no commit/rollback within this window is auto-rolled-back and its pooled connection released. Opt-in. */
  static abandonedTransactionTimeoutMs?: number;
  static logQueries = false;
  static queryLogFile?: string;
  static logToConsole: boolean = true;
  /**
   * Whether query logs include the binding values. Off by default: bindings
   * carry password hashes, tokens and PII straight into the console and the log
   * file. Enable it deliberately (`log: { bindings: true }`) for local debugging.
   */
  static logBindings = false;
  private static _logWriter?: FileSink;
  private static _logWriterDate?: string;
  static defaultPostgresPoolMax = 10;
  logQueries?: boolean;

  constructor(config: ConnectionConfig, options: { driver?: SQL; schema?: string; ownsDriver?: boolean; sqliteDefaultsApplied?: boolean } = {}) {
    this.config = config;
    this.schema = options.schema || ("schema" in config ? config.schema : undefined);
    this.ownsDriver = options.ownsDriver ?? !options.driver;
    let url: string | undefined;
    if ("url" in config && config.url) {
      url = config.url;
      this.driverName = Connection.driverFromUrl(url);
    } else if ("driver" in config) {
      if (!Connection.SUPPORTED_DRIVERS.includes(config.driver as any)) {
        throw new Error(
          `"${config.driver}" is not a supported database driver. Use one of: ${Connection.SUPPORTED_DRIVERS.join(", ")}.`
        );
      }
      this.driverName = config.driver;
      if (config.driver === "sqlite") {
        url = `sqlite://${config.filename || config.database || ":memory:"}`;
      }
    } else {
      throw new Error("Invalid connection configuration. Provide a url or driver config.");
    }

    this.driver = options.driver || (() => {
      if (this.driverName === "sqlite") {
        return new SQL(url!);
      }

      const prepare = config.prepare ?? (this.driverName === "postgres" ? false : undefined);
      const max = config.max ?? (this.driverName === "postgres" ? Connection.defaultPostgresPoolMax : undefined);
      const bigint = config.bigint;
      if ("driver" in config) {
        return new SQL({
          adapter: config.driver,
          ...(config.host !== undefined ? { hostname: config.host } : {}),
          port: config.port,
          database: config.database,
          username: config.username,
          password: config.password,
          ...(max !== undefined ? { max } : {}),
          ...(prepare !== undefined ? { prepare } : {}),
          ...(bigint !== undefined ? { bigint } : {}),
        });
      }
      return new SQL({
        url: url!,
        ...(max !== undefined ? { max } : {}),
        ...(prepare !== undefined ? { prepare } : {}),
        ...(bigint !== undefined ? { bigint } : {}),
      });
    })();

    switch (this.driverName) {
      case "sqlite":
        this.grammar = new SQLiteGrammar();
        break;
      case "mysql":
        this.grammar = new MySqlGrammar();
        break;
      case "postgres":
        this.grammar = new PostgresGrammar();
        break;
    }
    this.sqliteDefaultsApplied =
      this.driverName !== "sqlite" ||
      options.sqliteDefaultsApplied === true;
  }

  /**
   * A URL's scheme picks the driver. An unknown one is an error rather than a
   * silent fallback: `maria://…` used to be treated as PostgreSQL and failed
   * later, deep inside the driver, with nothing pointing at the URL.
   */
  private static driverFromUrl(url: string): "sqlite" | "mysql" | "postgres" {
    const separator = url.indexOf(":");
    const scheme = (separator === -1 ? url : url.slice(0, separator)).toLowerCase();
    switch (scheme) {
      case "sqlite":
        return "sqlite";
      case "mysql":
        return "mysql";
      case "postgres":
      case "postgresql":
        return "postgres";
      default:
        throw new Error(
          `"${scheme}" is not a supported database URL scheme. Use one of: sqlite://, mysql://, postgres://, postgresql://.`
        );
    }
  }

  getDriverName(): "sqlite" | "mysql" | "postgres" {
    return this.driverName;
  }

  getGrammar(): Grammar {
    return this.grammar;
  }

  getSchema(): string | undefined {
    return this.schema;
  }

  getConfig(): ConnectionConfig {
    return this.config;
  }

  static isSafeIdentifier(value: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
  }

  static assertSafeIdentifier(value: string, label: string = "identifier"): void {
    if (!this.isSafeIdentifier(value)) {
      throw new Error(`Invalid ${label}: ${value}`);
    }
  }

  static assertSafeQualifiedIdentifier(value: string, label: string = "identifier"): void {
    const parts = value.split(".");
    if (parts.length === 0 || parts.some((part) => !this.isSafeIdentifier(part))) {
      throw new Error(`Invalid ${label}: ${value}`);
    }
  }

  withSchema(schema: string): Connection {
    Connection.assertSafeIdentifier(schema, "schema name");
    if (this.schema === schema) return this;
    const conn = new Connection(this.config, { driver: this.driver, schema, ownsDriver: false, sqliteDefaultsApplied: this.sqliteDefaultsApplied });
    conn.logQueries = this.logQueries;
    return conn;
  }

  withoutSchema(): Connection {
    if (!this.schema) return this;
    const conn = new Connection(this.config, { driver: this.driver, ownsDriver: false, sqliteDefaultsApplied: this.sqliteDefaultsApplied });
    conn.logQueries = this.logQueries;
    return conn;
  }

  qualifyTable(table: string): string {
    if (table.includes(".")) {
      Connection.assertSafeQualifiedIdentifier(table, "qualified table name");
      return table;
    }
    Connection.assertSafeIdentifier(table, "table name");
    if (!this.schema || this.driverName === "sqlite") return table;
    return `${this.schema}.${table}`;
  }

  quoteIdentifier(value: string): string {
    return `"${value.replace(/"/g, '""')}"`;
  }

  private getDriver(): SQL {
    return this.reservedDriver || this.driver;
  }

  // ---------------------------------------------------------------------------
  // WORKAROUND(bun-mysql-eventloop) — delete once Bun fixes the upstream bug.
  // Full story, repro, probe and removal checklist: tmp_hacks/bun-mysql-event-loop.md
  //
  // Bun 1.4.0 stops holding the event loop open for an in-flight MySQL query as
  // soon as that client's pool has had more than one connection in play — a
  // second `new SQL()`, a `reserve()`, or just two concurrent queries. Nothing
  // is wrong with the query itself: the server answers and the bytes are on the
  // socket. What is missing is the reference that tells Bun "work is still
  // pending", so the loop drains, `beforeExit` fires, and the process exits with
  // code **0** while the query's promise never settles. Everything after that
  // await — the rest of a migration, a seeder, a deploy script — silently never
  // runs, and the exit code says it all went fine.
  //
  // It reproduces without the ORM (Bun 1.4.0, MySQL 9.7):
  //
  //   const a = new SQL({ adapter: "mysql", ...creds });
  //   async function main() {
  //     await a.unsafe("SELECT 1");
  //     (await a.reserve()).release();            // or a.begin(), or a 2nd client
  //     console.log(await a.unsafe("SELECT 2"));  // never resolves
  //   }
  //   main().catch(console.error);                // no output, exit 0
  //
  // The same script with a top-level `await main()` works, because a pending
  // top-level await is itself a reference Bun counts. SQLite and PostgreSQL are
  // not affected. Upstream: oven-sh/bun#27362 documents the same timer
  // workaround for remote sequential queries; oven-sh/bun#27102 is the related
  // open connection/transaction report, not the exact local reserve repro;
  // oven-sh/bun#26235 covers the now-flaky pooled-query shape. The probe, not an
  // issue's open/closed label, is the removal gate.
  //
  // So the reference is added by hand: while any MySQL driver operation is in
  // flight, one ref'd timer sits in the loop. Its delay is the largest a timer
  // accepts, so it never fires — it exists only to be counted, and costs nothing
  // while it waits. The counter is static because the event loop is per process,
  // not per connection.
  // ---------------------------------------------------------------------------

  /** Escape hatch for the workaround below: set to false to get Bun's raw behaviour. */
  static keepMysqlEventLoopAlive = true;
  /** Largest delay a timer accepts; anything above it is clamped to 1ms and would fire. */
  private static readonly EVENT_LOOP_HOLD_MS = 2 ** 31 - 1;
  private static eventLoopHolds = 0;
  private static eventLoopHandle?: ReturnType<typeof setInterval>;

  /**
   * Runs one driver operation with the event loop pinned open for its duration.
   * No-op outside MySQL. See the WORKAROUND note above.
   */
  private async keepEventLoopAlive<T>(operation: () => PromiseLike<T>): Promise<T> {
    if (this.driverName !== "mysql" || !Connection.keepMysqlEventLoopAlive) {
      return await operation();
    }
    if (Connection.eventLoopHolds++ === 0) {
      Connection.eventLoopHandle = setInterval(() => {}, Connection.EVENT_LOOP_HOLD_MS);
    }
    try {
      return await operation();
    } finally {
      if (--Connection.eventLoopHolds <= 0) {
        Connection.eventLoopHolds = 0;
        clearInterval(Connection.eventLoopHandle);
        Connection.eventLoopHandle = undefined;
      }
    }
  }

  private async reserveRootTransaction(): Promise<void> {
    if (this.driverName === "sqlite" || this.dedicated || this.reservedDriver) return;
    if (typeof (this.driver as any).reserve !== "function") {
      throw new Error(`${this.driverName} transactions require a driver that can reserve one pooled session.`);
    }
    this.reservedDriver = await this.keepEventLoopAlive(() => (this.driver as any).reserve());
  }

  private log(sqlString: string, bindings?: any[]): void {
    if (!(this.logQueries ?? Connection.logQueries)) return;
    if (Connection.queryLogFile) {
      const date = new Date().toISOString().slice(0, 10);
      if (Connection._logWriterDate !== date) {
        Connection._logWriter?.flush();
        Connection._logWriter?.end();
        const path = `${Connection.queryLogFile}/query-${date}.log`;
        Connection._logWriter = Bun.file(path).writer();
        Connection._logWriterDate = date;
      }
      const line = `[QUERY] ${sqlString}${Connection.describeBindings(bindings)}\n`;
      Connection._logWriter!.write(line);
      Connection._logWriter!.flush();
    }
    if (Connection.logToConsole) {
      if (Connection.logBindings && bindings?.length) console.log("[QUERY]", sqlString, bindings);
      else console.log("[QUERY]", sqlString, Connection.describeBindings(bindings).trim());
    }
  }

  /** Bindings for a log line: the values only when explicitly opted in. */
  private static describeBindings(bindings?: any[]): string {
    if (!bindings?.length) return "";
    if (Connection.logBindings) return ` ${JSON.stringify(bindings)}`;
    return ` (${bindings.length} binding${bindings.length === 1 ? "" : "s"} hidden)`;
  }

  private normalizeBinding(value: any): any {
    if (value instanceof Date) {
      return this.driverName === "mysql" ? value : value.toISOString();
    }
    if (Array.isArray(value)) return value.map((item) => this.normalizeBinding(item));
    return value;
  }

  private normalizeBindings(bindings?: any[]): any[] | undefined {
    return bindings?.map((binding) => this.normalizeBinding(binding));
  }

  private normalizeDriverError(error: unknown): unknown {
    return isUniqueConstraintViolation(this.driverName, error)
      ? new UniqueConstraintViolationError({ cause: error })
      : error;
  }

  private async executeStatement(driver: SQL, sqlString: string, bindings?: any[]): Promise<any> {
    try {
      return await this.keepEventLoopAlive(() => driver.unsafe(sqlString, bindings));
    } catch (error) {
      throw this.normalizeDriverError(error);
    }
  }

  async query(sqlString: string, bindings?: any[]): Promise<any[]> {
    return (await this.execute(sqlString, bindings)) as any[];
  }

  async run(sqlString: string, bindings?: any[]): Promise<any> {
    return await this.execute(sqlString, bindings);
  }

  /** MySQL's result metadata rounds large AUTO_INCREMENT ids; read the exact id on the same session. */
  async runAndGetMysqlInsertId(sqlString: string, bindings?: any[]): Promise<any> {
    if (this.driverName !== "mysql") {
      throw new Error("runAndGetMysqlInsertId() is only supported on MySQL connections.");
    }

    const execute = async (driver: SQL) => {
      const hasDate = this.carriesDate(bindings);
      const normalizedBindings = this.normalizeBindings(bindings);
      this.log(sqlString, normalizedBindings);
      if (hasDate) await this.assertMysqlUtc(driver, this.dedicated || !!this.reservedDriver);
      await this.executeStatement(driver, sqlString, normalizedBindings);
      const rows = await this.executeStatement(driver, "SELECT LAST_INSERT_ID() AS orm_insert_id") as any[];
      return rows[0]?.orm_insert_id ?? null;
    };

    await this.ensureSqliteDefaults();
    const driver = this.getDriver();
    if (this.transactionActive || this.dedicated || this.reservedDriver || typeof (driver as any).reserve !== "function") {
      return await execute(driver);
    }

    const reserved = await this.keepEventLoopAlive(() => (driver as any).reserve()) as SQL & { release?: () => void };
    try {
      return await execute(reserved);
    } finally {
      reserved.release?.();
    }
  }

  private async execute(sqlString: string, bindings?: any[]): Promise<any> {
    await this.ensureSqliteDefaults();
    if (this.driverName === "mysql" && /^\s*SET\s+(?:SESSION\s+)?(?:@@session\.)?time_zone\b/i.test(sqlString)) {
      this.mysqlUtcChecked = false;
    }
    const hasDate = this.carriesDate(bindings);
    const normalizedBindings = this.normalizeBindings(bindings);
    this.log(sqlString, normalizedBindings);

    const driver = this.getDriver();
    if (this.driverName !== "mysql" || !hasDate) {
      return await this.executeStatement(driver, sqlString, normalizedBindings);
    }

    // A pool may hand two consecutive queries to different sessions. Reserve
    // one so the UTC assertion and the date-bearing query cannot be separated.
    if (!this.transactionActive && !this.dedicated && !this.reservedDriver && typeof (driver as any).reserve === "function") {
      const reserved = await this.keepEventLoopAlive(() => (driver as any).reserve()) as SQL & { release?: () => void };
      try {
        await this.assertMysqlUtc(reserved);
        return await this.executeStatement(reserved, sqlString, normalizedBindings);
      } finally {
        reserved.release?.();
      }
    }

    await this.assertMysqlUtc(driver, this.dedicated || !!this.reservedDriver);
    return await this.executeStatement(driver, sqlString, normalizedBindings);
  }

  /** Whether a binding contains a semantic date rather than date-looking text. */
  private carriesDate(bindings?: any[]): boolean {
    const containsDate = (value: any): boolean =>
      value instanceof Date || (Array.isArray(value) && value.some(containsDate));
    return (bindings ?? []).some(containsDate);
  }

  /**
   * ORM renders dates in UTC. MySQL reads a datetime literal in the session's
   * time zone, so on a session that is not UTC a TIMESTAMP column silently
   * stores a different instant than the one handed to it — and a DATETIME
   * column disagrees with it. An explicit offset in the literal fixes TIMESTAMP
   * and breaks DATETIME, and `SET time_zone` only reaches one connection of the
   * pool, so the honest move is to say so instead of storing the wrong moment.
   */
  private async assertMysqlUtc(driver: SQL, cache: boolean = false): Promise<void> {
    if (cache && this.mysqlUtcChecked) return;
    const rows = (await this.keepEventLoopAlive(() =>
      driver.unsafe("SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) AS offset_seconds")
    )) as any[];
    const offset = Number(rows?.[0]?.offset_seconds ?? 0);
    if (offset === 0) {
      if (cache) this.mysqlUtcChecked = true;
      return;
    }
    throw new Error(
      `MySQL session time zone is ${offset > 0 ? "+" : ""}${(offset / 3600).toFixed(2)}h from UTC. ` +
        `ORM stores dates in UTC, and a TIMESTAMP column would keep a different instant than the one you wrote. ` +
        `Set the server or connection to time_zone = '+00:00'.`
    );
  }

  private async ensureSqliteDefaults(): Promise<void> {
    if (this.sqliteDefaultsApplied || this.driverName !== "sqlite") return;
    if (!this.sqliteDefaultsPromise) {
      this.sqliteDefaultsPromise = this.applySqliteDefaults();
    }
    await this.sqliteDefaultsPromise;
  }

  private async applySqliteDefaults(): Promise<void> {
    const pragmas = this.config.sqlitePragmas;
    if (pragmas === false) {
      this.sqliteDefaultsApplied = true;
      return;
    }

    const journalMode = pragmas?.journalMode ?? "WAL";
    const synchronous = pragmas?.synchronous ?? "NORMAL";
    const foreignKeys = pragmas?.foreignKeys ?? true;
    // Without this, two processes on the same file (the SQLite queue driver is
    // exactly that) surface a raw SQLITE_BUSY on the first contended write
    // instead of waiting out a short lock.
    const busyTimeoutMs = pragmas?.busyTimeoutMs ?? 5000;

    if (foreignKeys) {
      const sql = "PRAGMA foreign_keys=ON";
      this.log(sql);
      await this.getDriver().unsafe(sql);
    }

    if (journalMode !== false) {
      const sql = `PRAGMA journal_mode=${this.sanitizeSqlitePragmaValue(journalMode, "journal_mode")}`;
      this.log(sql);
      await this.getDriver().unsafe(sql);
    }

    if (synchronous !== false) {
      const sql = `PRAGMA synchronous=${this.sanitizeSqlitePragmaValue(synchronous, "synchronous")}`;
      this.log(sql);
      await this.getDriver().unsafe(sql);
    }

    if (busyTimeoutMs > 0) {
      if (!Number.isInteger(busyTimeoutMs)) {
        throw new Error(`Invalid SQLite busy_timeout value: ${busyTimeoutMs}`);
      }
      const sql = `PRAGMA busy_timeout=${busyTimeoutMs}`;
      this.log(sql);
      await this.getDriver().unsafe(sql);
    }

    this.sqliteDefaultsApplied = true;
  }

  private sanitizeSqlitePragmaValue(value: string, pragma: string): string {
    if (!/^[A-Za-z0-9_]+$/.test(value)) {
      throw new Error(`Invalid SQLite ${pragma} value: ${value}`);
    }
    return value;
  }

  async beginTransaction(): Promise<void> {
    await this.ensureSqliteDefaults();
    if (this.transactionDepth === 0 && !this.transactionActive) {
      await this.reserveRootTransaction();
      try {
        await this.keepEventLoopAlive(() => this.getDriver().unsafe("BEGIN"));
      } catch (error) {
        this.releaseReservedDriver();
        throw error;
      }
      this.transactionActive = true;
      this.transactionRoot = true;
      this.transactionDepth = 1;
      this.armAbandonedTimer();
      return;
    }

    await this.keepEventLoopAlive(() => this.getDriver().unsafe(`SAVEPOINT orm_trans_${++this.savepointId}`));
    this.transactionDepth++;
  }

  private releaseReservedDriver(): void {
    this.clearAbandonedTimer();
    this.reservedDriver?.release?.();
    this.reservedDriver = undefined;
    this.mysqlUtcChecked = false;
  }

  private armAbandonedTimer(): void {
    const ms = Connection.abandonedTransactionTimeoutMs;
    if (!ms || !this.reservedDriver) return;
    const timer = setTimeout(() => {
      // Still in the same root transaction with a reserved driver: caller
      // never committed or rolled back. Force-rollback and release the slot.
      if (!this.transactionActive || !this.reservedDriver) return;
      void Promise.resolve()
        .then(() => this.keepEventLoopAlive(() => this.getDriver().unsafe("ROLLBACK")))
        .catch(() => null)
        .finally(() => {
          this.transactionDepth = 0;
          this.transactionActive = false;
          this.transactionRoot = false;
          this.releaseReservedDriver();
        });
    }, ms);
    (timer as any).unref?.();
    this.abandonedTimer = timer;
  }

  private clearAbandonedTimer(): void {
    if (this.abandonedTimer) {
      clearTimeout(this.abandonedTimer);
      this.abandonedTimer = undefined;
    }
  }

  async commit(): Promise<void> {
    if (this.transactionDepth <= 0) return;
    if (this.transactionDepth === 1 && this.transactionRoot) {
      try {
        await this.keepEventLoopAlive(() => this.getDriver().unsafe("COMMIT"));
      } catch (error) {
        await this.keepEventLoopAlive(() => this.getDriver().unsafe("ROLLBACK")).catch(() => null);
        throw this.normalizeDriverError(error);
      } finally {
        this.transactionDepth = 0;
        this.transactionActive = false;
        this.transactionRoot = false;
        this.releaseReservedDriver();
      }
    } else {
      await this.keepEventLoopAlive(() => this.getDriver().unsafe(`RELEASE SAVEPOINT orm_trans_${this.savepointId--}`));
      this.transactionDepth--;
    }
  }

  async rollback(): Promise<void> {
    if (this.transactionDepth <= 0) return;
    if (this.transactionDepth === 1 && this.transactionRoot) {
      try {
        await this.keepEventLoopAlive(() => this.getDriver().unsafe("ROLLBACK"));
      } finally {
        this.transactionDepth = 0;
        this.transactionActive = false;
        this.transactionRoot = false;
        this.releaseReservedDriver();
      }
    } else {
      await this.keepEventLoopAlive(() => this.getDriver().unsafe(`ROLLBACK TO SAVEPOINT orm_trans_${this.savepointId}`));
      await this.keepEventLoopAlive(() => this.getDriver().unsafe(`RELEASE SAVEPOINT orm_trans_${this.savepointId--}`));
      this.transactionDepth--;
    }
  }

  isInTransaction(): boolean {
    return this.transactionActive || this.transactionDepth > 0;
  }

  async transaction<T>(callback: (connection: Connection) => T | Promise<T>): Promise<T> {
    await this.ensureSqliteDefaults();
    if (!this.ownsDriver) {
      // A borrowed connection can be either transaction-rooted already or
      // still outside any transaction. Track that separately from nesting
      // depth so a root transaction starts with BEGIN and nested calls use
      // SAVEPOINTs.
      if (!this.transactionActive) {
        await this.reserveRootTransaction();
        try {
          await this.keepEventLoopAlive(() => this.getDriver().unsafe("BEGIN"));
        } catch (error) {
          this.releaseReservedDriver();
          throw error;
        }
        this.transactionActive = true;
        this.transactionRoot = true;
        this.transactionDepth = 1;
        try {
          const result = await callback(this);
          await this.keepEventLoopAlive(() => this.getDriver().unsafe("COMMIT"));
          return result;
        } catch (error) {
          await this.keepEventLoopAlive(() => this.getDriver().unsafe("ROLLBACK")).catch(() => null);
          throw this.normalizeDriverError(error);
        } finally {
          this.transactionDepth = 0;
          this.transactionActive = false;
          this.transactionRoot = false;
          this.releaseReservedDriver();
        }
      }
      const savepointName = `orm_trans_${++this.savepointId}`;
      await this.keepEventLoopAlive(() => this.getDriver().unsafe(`SAVEPOINT ${savepointName}`));
      this.transactionDepth++;
      try {
        const result = await callback(this);
        await this.keepEventLoopAlive(() => this.getDriver().unsafe(`RELEASE SAVEPOINT ${savepointName}`));
        return result;
      } catch (error) {
        await this.keepEventLoopAlive(() => this.getDriver().unsafe(`ROLLBACK TO SAVEPOINT ${savepointName}`)).catch(() => null);
        await this.keepEventLoopAlive(() => this.getDriver().unsafe(`RELEASE SAVEPOINT ${savepointName}`)).catch(() => null);
        this.savepointId--;
        throw this.normalizeDriverError(error);
      } finally {
        this.transactionDepth--;
      }
    }
    // Owned connection, root transaction. Only a manual beginTransaction() can
    // have marked this connection active here (a nested transaction() runs on
    // the borrowed connection handed to the callback, which uses savepoints).
    // driver.begin() would issue BEGIN inside the open BEGIN, so refuse rather
    // than emit a statement the server will reject or silently flatten.
    if (this.transactionActive || this.transactionDepth > 0) {
      throw new Error(
        "transaction() was called while a manual beginTransaction() is still open on this connection. " +
        "Commit or roll back first, or run the work through the connection the callback receives.",
      );
    }

    try {
      return await this.keepEventLoopAlive(() => this.driver.begin(async (sql) => {
        const connection = new Connection(this.config, {
          driver: sql as unknown as SQL,
          schema: this.schema,
          ownsDriver: false,
          sqliteDefaultsApplied: true,
        });
        connection.logQueries = this.logQueries;
        connection.transactionActive = true;
        connection.transactionRoot = false;
        connection.dedicated = true;
        try {
          return await callback(connection);
        } finally {
          connection.transactionActive = false;
        }
      }));
    } catch (error) {
      throw this.normalizeDriverError(error);
    }
  }

  async withTenant<T>(
    tenantId: string,
    callback: (connection: Connection) => T | Promise<T>,
    setting: string = "app.tenant_id",
    role?: string
  ): Promise<T> {
    if (this.driverName !== "postgres") {
      return await this.transaction(callback);
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(setting)) {
      throw new Error(`Invalid PostgreSQL setting name: ${setting}`);
    }
    if (role) {
      Connection.assertSafeIdentifier(role, "role name");
    }
    return await this.transaction(async (connection) => {
      if (role) {
        await connection.run(`SET LOCAL ROLE ${connection.quoteIdentifier(role)}`);
      }
      await connection.run(`SELECT set_config(${connection.getGrammar().placeholder(1)}, ${connection.getGrammar().placeholder(2)}, true)`, [setting, tenantId]);
      return await callback(connection);
    });
  }

  async withSearchPath<T>(schema: string, callback: (connection: Connection) => T | Promise<T>): Promise<T> {
    if (this.driverName !== "postgres") {
      throw new Error("search_path schema switching is only supported for PostgreSQL connections.");
    }
    Connection.assertSafeIdentifier(schema, "schema name");
    // Reserve a dedicated connection (no surrounding transaction) and set the
    // search_path at session scope. Avoids pinning the request inside one long
    // transaction (lock hold / idle-in-transaction). The connection is still
    // dedicated for the callback's duration, then reset and released.
    const reserved = (await (this.driver as any).reserve()) as SQL & { release?: () => void };
    // Set the connection schema to the target so introspection
    // (information_schema / pg_catalog queries that filter by schema name)
    // resolves the tenant schema, not the base one. SET search_path below
    // remains as a fallback for any raw SQL the ORM does not qualify.
    const connection = new Connection(this.config, {
      driver: reserved as unknown as SQL,
      schema,
      ownsDriver: false,
    });
    connection.logQueries = this.logQueries;
    connection.dedicated = true;
    try {
      await connection.run(`SET search_path TO ${connection.quoteIdentifier(schema)}`);
      return await callback(connection);
    } finally {
      await connection.run("RESET search_path").catch(() => null);
      reserved.release?.();
    }
  }

  async close(): Promise<void> {
    this.releaseReservedDriver();
    if (this.ownsDriver) {
      await this.keepEventLoopAlive(() => this.driver.close());
    }
  }
}
