import { SQL, FileSink } from "bun";
import type { ConnectionConfig } from "../types/index.js";
import { Grammar } from "../query/grammars/Grammar.js";
import { SQLiteGrammar } from "../query/grammars/SQLiteGrammar.js";
import { MySqlGrammar } from "../query/grammars/MySqlGrammar.js";
import { PostgresGrammar } from "../query/grammars/PostgresGrammar.js";
import { UniqueConstraintViolationError } from "./UniqueConstraintViolationError.js";
import { TransactionContext } from "./TransactionContext.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { resolveConnection } from "./ExecutionContext.js";
import { TenantContext } from "./TenantContext.js";
import { ConnectionManager } from "./ConnectionManager.js";
import { AfterCommitError } from "./AfterCommitError.js";

export interface PretendStatement {
  sql: string;
  bindings: any[];
}

interface PretendContext {
  statements: PretendStatement[];
}

const resourceScopes = new AsyncLocalStorage<ReadonlySet<Connection>>();

const pretendContext = new AsyncLocalStorage<PretendContext>();

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
  private resource?: Connection;
  private session?: Connection;
  private parent?: Connection;
  private tenantId?: string;
  private rlsScope?: { tenantId: string; setting: string; role?: string };
  private transactionFinished = false;
  private requiresTenantScope = false;
  private commitEffects: Array<Array<() => unknown | Promise<unknown>>> = [];
  private activeLeases = 0;
  private retired = false;
  private closing?: Promise<void>;
  private idleWaiters: Array<() => void> = [];
  private manualLease?: () => void;
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

  /** Shared physical pool owner, independent of tenant and session views. */
  resourceConnection(): Connection { return this.resource ?? this; }

  isBusy(): boolean { return this.resourceConnection().activeLeases > 0; }
  isRetired(): boolean { return this.resourceConnection().retired; }
  static hasActiveScope(): boolean { return !!resourceScopes.getStore()?.size; }
  static async finishDraining<T>(connections: Iterable<Connection>, callback: () => Promise<T>): Promise<T> {
    return resourceScopes.run(new Set(connections), callback);
  }
  retire(): void { this.resourceConnection().retired = true; }
  async waitForIdle(): Promise<void> {
    const root = this.resourceConnection();
    if (root.activeLeases) await new Promise<void>(resolve => root.idleWaiters.push(resolve));
  }

  private acquireLease(): () => void {
    const root = this.resourceConnection();
    if (root.retired && !resourceScopes.getStore()?.size && !this.isInTransaction()) {
      throw new Error("Connection is retired or closed; resolve a current connection before starting new work.");
    }
    root.activeLeases++;
    ConnectionManager.touchTenant(this.tenantId, root);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      ConnectionManager.touchTenant(this.tenantId, root);
      if (--root.activeLeases === 0) for (const resolve of root.idleWaiters.splice(0)) resolve();
    };
  }

  /** Hold a resource for a scope; nested operations can finish while it drains. */
  async use<T>(callback: () => T | Promise<T>): Promise<T> {
    const release = this.acquireLease();
    const active = resourceScopes.getStore();
    try {
      if (active?.has(this.resourceConnection())) return await callback();
      const scopes = new Set(active);
      scopes.add(this.resourceConnection());
      return await resourceScopes.run(scopes, callback);
    } finally { release(); }
  }

  /** Resolve the driver from a validated database URL scheme. */
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

  /** Captures SQL produced by the callback without executing any statement. */
  async pretend<T>(callback: () => T | Promise<T>): Promise<{ result: T; statements: PretendStatement[] }> {
    const active = pretendContext.getStore();
    if (active) {
      const start = active.statements.length;
      const result = await callback();
      return { result, statements: active.statements.slice(start) };
    }

    const context: PretendContext = { statements: [] };
    const result = await pretendContext.run(context, callback);
    return { result, statements: context.statements };
  }

  private isPretending(): boolean {
    return pretendContext.getStore() !== undefined;
  }

  private capturePretendStatement(sql: string, bindings?: any[]): boolean {
    const context = pretendContext.getStore();
    if (!context) return false;

    context.statements.push({ sql, bindings: [...(bindings ?? [])] });
    return true;
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
    return this.view(schema, this.tenantId);
  }

  withoutSchema(): Connection {
    if (!this.schema) return this;
    return this.view(undefined, this.tenantId);
  }

  private view(schema: string | undefined, tenantId: string | undefined): Connection {
    const connection = new Connection(this.config, { driver: this.driver, ownsDriver: false, sqliteDefaultsApplied: this.sqliteDefaultsApplied });
    connection.schema = schema;
    connection.tenantId = tenantId;
    connection.rlsScope = this.rlsScope;
    connection.resource = this.resource ?? this;
    connection.parent = this;
    connection.session = this.session ?? ((this.isInTransaction() || this.dedicated) ? this : undefined);
    connection.dedicated = this.dedicated;
    connection.requiresTenantScope = this.requiresTenantScope;
    connection.logQueries = this.logQueries;
    return connection;
  }

  withTenantId(tenantId: string): Connection {
    return this.tenantId === tenantId ? this : this.view(this.schema, tenantId);
  }

  getTenantId(): string | undefined { return this.tenantId; }

  sharesResource(other: Connection): boolean {
    return (this.resource ?? this).driver === (other.resource ?? other).driver;
  }

  reusableConnection(): Connection {
    if ((this.transactionFinished || this.session?.transactionFinished) && this.parent) {
      const active = TenantContext.current()?.connection ?? TransactionContext.current();
      if ((this.requiresTenantScope || this.session?.requiresTenantScope) && (!active || active.getTenantId() !== this.tenantId)) {
        throw new Error(`Reenter tenant "${this.tenantId ?? "scoped session"}" before reusing an object from a finished RLS/search_path scope.`);
      }
      let parent = this.parent.reusableConnection();
      if (this.tenantId !== undefined) parent = parent.withTenantId(this.tenantId);
      return this.schema ? parent.withSchema(this.schema) : parent;
    }
    return this;
  }

  async afterCommit(callback: () => unknown | Promise<unknown>): Promise<void> {
    return resolveConnection(this).registerCommitEffect(callback);
  }

  private async registerCommitEffect(callback: () => unknown | Promise<unknown>): Promise<void> {
    if (this.session) return this.session.registerCommitEffect(callback);
    if (this.isInTransaction()) {
      (this.commitEffects.at(-1) ?? (this.commitEffects[0] = [])).push(callback);
    } else {
      await callback();
    }
  }

  private async drainCommitEffects(): Promise<void> {
    const effects = this.commitEffects.flat();
    this.commitEffects = [];
    if (!effects.length) return;
    const errors: unknown[] = [];
    await TransactionContext.without(() => TenantContext.asLandlord(async () => {
      for (const effect of effects) {
        try { await effect(); } catch (error) { errors.push(error); }
      }
    }));
    if (errors.length) throw new AfterCommitError(errors);
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
    return this.session?.getDriver() ?? this.reservedDriver ?? this.driver;
  }

  // ---------------------------------------------------------------------------
  // WORKAROUND(bun-mysql-eventloop) — delete once Bun fixes the upstream bug.
  // Full story, repro, probe and removal checklist: .tmp_hacks/bun-mysql-event-loop.md
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

  /** Driver metadata only: MySQL reports changed rows; other drivers may count matched rows. */
  affectedRows(result: any): number {
    // WORKAROUND(bun-sql-write-count): see .tmp_hacks/bun-sql-write-count.md.
    return Number((this.driverName === "mysql" ? result?.affectedRows : result?.count) ?? 0);
  }

  async query(sqlString: string, bindings?: any[]): Promise<any[]> {
    const connection = resolveConnection(this);
    return await connection.use(() => connection.execute(sqlString, bindings));
  }

  async run(sqlString: string, bindings?: any[]): Promise<any> {
    const connection = resolveConnection(this);
    return await connection.use(() => connection.execute(sqlString, bindings));
  }

  /** MySQL's result metadata rounds large AUTO_INCREMENT ids; read the exact id on the same session. */
  async runAndGetMysqlInsertId(sqlString: string, bindings?: any[]): Promise<any> {
    const effective = resolveConnection(this);
    if (effective !== this) return effective.runAndGetMysqlInsertId(sqlString, bindings);
    return this.use(() => this.mysqlInsertId(sqlString, bindings));
  }

  private async mysqlInsertId(sqlString: string, bindings?: any[]): Promise<any> {
    if (this.driverName !== "mysql") {
      throw new Error("runAndGetMysqlInsertId() is only supported on MySQL connections.");
    }

    const normalizedBindings = this.normalizeBindings(bindings);
    if (this.capturePretendStatement(sqlString, normalizedBindings)) return null;

    const execute = async (driver: SQL) => {
      const hasDate = this.carriesDate(bindings);
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
    const normalizedBindings = this.normalizeBindings(bindings);
    if (this.capturePretendStatement(sqlString, normalizedBindings)) return [];

    await this.ensureSqliteDefaults();
    if (this.driverName === "mysql" && /^\s*SET\s+(?:SESSION\s+)?(?:@@session\.)?time_zone\b/i.test(sqlString)) {
      this.mysqlUtcChecked = false;
    }
    const hasDate = this.carriesDate(bindings);
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
    return resolveConnection(this).beginTransactionBody();
  }

  private async beginTransactionBody(): Promise<void> {
    if (this.session) return this.session.beginTransactionBody();
    if (this.isPretending()) return;
    if (this.transactionDepth === 0 && !this.transactionActive) {
      this.manualLease = this.acquireLease();
      try {
        await this.ensureSqliteDefaults();
        await this.reserveRootTransaction();
        await this.keepEventLoopAlive(() => this.getDriver().unsafe("BEGIN"));
      } catch (error) {
        this.releaseReservedDriver();
        throw error;
      }
      this.transactionActive = true;
      this.transactionRoot = true;
      this.transactionDepth = 1;
      this.commitEffects = [[]];
      this.armAbandonedTimer();
      return;
    }

    await this.keepEventLoopAlive(() => this.getDriver().unsafe(`SAVEPOINT orm_trans_${++this.savepointId}`));
    this.transactionDepth++;
    this.commitEffects.push([]);
  }

  private releaseReservedDriver(): void {
    this.clearAbandonedTimer();
    this.manualLease?.();
    this.manualLease = undefined;
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
          this.commitEffects = [];
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
    const connection = resolveConnection(this);
    return connection.use(() => connection.commitTransaction());
  }

  private async commitTransaction(): Promise<void> {
    if (this.session) return this.session.commitTransaction();
    if (this.isPretending()) return;
    if (this.transactionDepth <= 0) return;
    if (this.transactionDepth === 1 && this.transactionRoot) {
      try {
        await this.keepEventLoopAlive(() => this.getDriver().unsafe("COMMIT"));
      } catch (error) {
        this.commitEffects = [];
        await this.keepEventLoopAlive(() => this.getDriver().unsafe("ROLLBACK")).catch(() => null);
        throw this.normalizeDriverError(error);
      } finally {
        this.transactionDepth = 0;
        this.transactionActive = false;
        this.transactionRoot = false;
        this.releaseReservedDriver();
      }
      await this.drainCommitEffects();
    } else {
      await this.keepEventLoopAlive(() => this.getDriver().unsafe(`RELEASE SAVEPOINT orm_trans_${this.savepointId--}`));
      this.transactionDepth--;
      const effects = this.commitEffects.pop() ?? [];
      (this.commitEffects.at(-1) ?? (this.commitEffects[0] = [])).push(...effects);
    }
  }

  async rollback(): Promise<void> {
    return resolveConnection(this).rollbackTransaction();
  }

  private async rollbackTransaction(): Promise<void> {
    if (this.session) return this.session.rollbackTransaction();
    if (this.isPretending()) return;
    if (this.transactionDepth <= 0) return;
    if (this.transactionDepth === 1 && this.transactionRoot) {
      try {
        await this.keepEventLoopAlive(() => this.getDriver().unsafe("ROLLBACK"));
      } finally {
        this.transactionDepth = 0;
        this.transactionActive = false;
        this.transactionRoot = false;
        this.commitEffects = [];
        this.releaseReservedDriver();
      }
    } else {
      await this.keepEventLoopAlive(() => this.getDriver().unsafe(`ROLLBACK TO SAVEPOINT orm_trans_${this.savepointId}`));
      await this.keepEventLoopAlive(() => this.getDriver().unsafe(`RELEASE SAVEPOINT orm_trans_${this.savepointId--}`));
      this.transactionDepth--;
      this.commitEffects.pop();
    }
  }

  transactionConnection(): Connection | undefined {
    return this.session?.transactionConnection() ?? (this.transactionActive || this.transactionDepth > 0 ? this : undefined);
  }

  isInTransaction(): boolean {
    return this.session?.isInTransaction() ?? (this.transactionActive || this.transactionDepth > 0);
  }

  async transaction<T>(callback: (connection: Connection) => T | Promise<T>): Promise<T> {
    const effective = resolveConnection(this);
    return effective.use(() => effective.runTransaction(callback));
  }

  private async runTransaction<T>(callback: (connection: Connection) => T | Promise<T>): Promise<T> {
    if (this.session) return TenantContext.withConnection(this.session, () => this.session!.transaction(tx => {
      const scoped = tx.view(this.schema, this.tenantId);
      return TenantContext.withConnection(scoped, () => callback(scoped));
    }));
    if (this.isPretending()) return await TransactionContext.run(this, () => callback(this));
    await this.ensureSqliteDefaults();
    if (this.isInTransaction()) {
      if (this.ownsDriver && this.transactionRoot) {
        throw new Error("transaction() was called while a manual beginTransaction() is still open on this connection. Commit or roll back first.");
      }
      const savepointName = `orm_trans_${++this.savepointId}`;
      const driver = this.getDriver() as SQL & { savepoint?: <R>(fn: () => Promise<R>) => Promise<R> };
      this.transactionDepth++;
      this.commitEffects.push([]);
      try {
        let result: T;
        if (typeof driver.savepoint === "function") {
          result = await this.keepEventLoopAlive(() => driver.savepoint!(() => TransactionContext.run(this, () => callback(this))));
        } else {
          await this.executeStatement(driver, `SAVEPOINT ${savepointName}`);
          try {
            result = await TransactionContext.run(this, () => callback(this));
            await this.executeStatement(driver, `RELEASE SAVEPOINT ${savepointName}`);
          } catch (error) {
            await this.executeStatement(driver, `ROLLBACK TO SAVEPOINT ${savepointName}`).catch(() => null);
            await this.executeStatement(driver, `RELEASE SAVEPOINT ${savepointName}`).catch(() => null);
            throw error;
          }
        }
        const effects = this.commitEffects.pop()!;
        (this.commitEffects.at(-1) ?? (this.commitEffects[0] = [])).push(...effects);
        return result;
      } catch (error) {
        this.commitEffects.pop();
        throw this.normalizeDriverError(error);
      } finally {
        this.transactionDepth--;
        this.savepointId--;
      }
    }

    // Native callbacks own their transaction handle. Cached schema views must
    // not hold mutable transaction state shared by concurrent requests.
    if (!this.dedicated && typeof this.driver.begin === "function") {
      let transaction: Connection | undefined;
      let result: T;
      try {
        result = await this.keepEventLoopAlive(() => this.driver.begin(async sql => {
          const connection = new Connection(this.config, { driver: sql as unknown as SQL, schema: this.schema, ownsDriver: false, sqliteDefaultsApplied: true });
          transaction = connection;
          connection.resource = this.resource ?? this;
          connection.parent = this;
          connection.tenantId = this.tenantId;
          connection.rlsScope = this.rlsScope;
          connection.logQueries = this.logQueries;
          connection.transactionActive = true;
          connection.dedicated = true;
          connection.commitEffects = [[]];
          return await TransactionContext.run(connection, () => TenantContext.withConnection(connection, () => callback(connection)));
        }));
      } catch (error) {
        if (transaction) transaction.commitEffects = [];
        throw this.normalizeDriverError(error);
      } finally {
        if (transaction) {
          transaction.transactionActive = false;
          transaction.transactionFinished = true;
        }
      }
      await transaction?.drainCommitEffects();
      return result;
    }

    // Dedicated reserved sessions (and test/custom drivers without begin()).
    await this.beginTransaction();
    let result: T;
    try {
      result = await TransactionContext.run(this, () => TenantContext.withConnection(this, () => callback(this)));
    } catch (error) {
      await this.rollback().catch(() => null);
      throw this.normalizeDriverError(error);
    }
    await this.commit();
    return result;
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
    const effective = resolveConnection(this);
    const scope = effective.rlsScope;
    if (scope) {
      if (scope.tenantId !== tenantId || scope.setting !== setting || scope.role !== role) {
        throw new Error("Cannot change tenant, setting or role inside an active RLS scope.");
      }
      return await callback(effective);
    }
    if (effective.isInTransaction()) {
      throw new Error("Cannot enter an RLS tenant scope inside an existing transaction.");
    }
    const originalTenantId = effective.tenantId;
    const originalRequiresScope = effective.requiresTenantScope;
    let borrowed = false;
    try {
      return await effective.transaction(async (connection) => {
        borrowed = connection === effective;
        connection.tenantId ??= tenantId;
        connection.rlsScope = { tenantId, setting, role };
        connection.requiresTenantScope = true;
        if (role) {
          await connection.run(`SET LOCAL ROLE ${connection.quoteIdentifier(role)}`);
        }
        await connection.run(`SELECT set_config(${connection.getGrammar().placeholder(1)}, ${connection.getGrammar().placeholder(2)}, true)`, [setting, tenantId]);
        return await callback(connection);
      });
    } finally {
      // Dedicated sessions survive the transaction; their logical identity
      // must be restored together with PostgreSQL's SET LOCAL state.
      if (borrowed) {
        effective.tenantId = originalTenantId;
        effective.rlsScope = undefined;
        effective.requiresTenantScope = originalRequiresScope;
      }
    }
  }

  async withSearchPath<T>(schema: string, callback: (connection: Connection) => T | Promise<T>): Promise<T> {
    return this.use(() => this.runWithSearchPath(schema, callback));
  }

  private async runWithSearchPath<T>(schema: string, callback: (connection: Connection) => T | Promise<T>): Promise<T> {
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
    connection.resource = this.resource ?? this;
    connection.parent = this;
    connection.tenantId = this.tenantId;
    connection.logQueries = this.logQueries;
    connection.dedicated = true;
    connection.requiresTenantScope = true;
    return await TenantContext.withConnection(connection, async () => {
      try {
        await connection.run(`SET search_path TO ${connection.quoteIdentifier(schema)}`);
        return await callback(connection);
      } finally {
        try {
          if (connection.isInTransaction()) throw new Error("search_path scope exited with an open transaction; session discarded.");
          await connection.run("RESET search_path");
        } catch (error) {
          // Bun ReservedSQL.close() closes this physical session, not its pool.
          // Never release a session whose state could not be restored.
          await reserved.close({ timeout: 0 });
          connection.clearAbandonedTimer();
          connection.manualLease?.();
          connection.manualLease = undefined;
          connection.commitEffects = [];
          connection.transactionActive = false;
          connection.transactionDepth = 0;
          connection.transactionFinished = true;
          throw error;
        }
        await reserved.release?.();
        connection.transactionFinished = true;
      }
    });
  }

  async close(): Promise<void> {
    if (!this.ownsDriver) return;
    if (this.closing) return this.closing;
    this.retired = true;
    this.closing = (async () => {
      if (this.activeLeases) await new Promise<void>(resolve => this.idleWaiters.push(resolve));
      this.releaseReservedDriver();
      await this.keepEventLoopAlive(() => this.driver.close());
    })();
    try { await this.closing; } catch (error) { this.closing = undefined; throw error; }
  }
}
