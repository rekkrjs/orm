import type { ConnectionConfig } from "../../types/index.js";
import { createNodeDriver } from "./nodeDrivers.js";

/**
 * The driver surface Connection talks to. Bun's `SQL` satisfies it as it is;
 * on Node.js the adapters in nodeDrivers.ts provide it over node:sqlite, pg and
 * mysql2.
 *
 * A statement resolves to an array of rows carrying its write metadata (see
 * `WriteResult`): MySQL fills `affectedRows`, SQLite and PostgreSQL fill
 * `count`, and `Connection.affectedRows()` picks the right one.
 */
export interface SqlDriver {
  unsafe(sql: string, bindings?: unknown[]): PromiseLike<unknown>;
  /** True when each newly opened MySQL session starts in UTC. */
  mysqlUtcOnConnect?: boolean;
  /** MySQL write metadata keeps AUTO_INCREMENT ids exact, including those beyond 2^53. */
  exactMysqlInsertId?: boolean;
  /** A pooled session of its own until `release()`. SQLite has a single session and needs none. */
  reserve?(): Promise<ReservedSqlDriver>;
  /** Runs the callback in a transaction on a session of its own. Without it Connection issues BEGIN itself. */
  begin?<T>(callback: (transaction: SqlDriver) => Promise<T>): Promise<T>;
  /** Nested transaction inside begin(). Without it Connection issues SAVEPOINT itself. */
  savepoint?<T>(callback: (transaction: SqlDriver) => Promise<T>): Promise<T>;
  /** Ends the pool, or, on a reserved session, discards that session instead of returning it. */
  close(options?: { timeout?: number }): Promise<void>;
}

export interface ReservedSqlDriver extends SqlDriver {
  /** Returns the session to its pool. */
  release(): void | Promise<void>;
}

export type DriverName = "sqlite" | "mysql" | "postgres";

/** Bun's native client when running on Bun, the Node.js adapter for the engine otherwise. */
export function createDriver(driverName: DriverName, config: ConnectionConfig, url: string | undefined, defaultPostgresPoolMax: number): SqlDriver {
  // WORKAROUND(bun-sql-prepared-plan-cache): neither bun:sql nor pg recovers a
  // cached statement once ADD COLUMN changes a `SELECT *` result. See
  // .tmp_hacks/bun-sql-prepared-plan-cache.md.
  const prepare = config.prepare ?? (driverName === "postgres" ? false : undefined);
  const max = config.max ?? (driverName === "postgres" ? defaultPostgresPoolMax : undefined);
  const bigint = config.bigint;
  if (typeof Bun === "undefined") return createNodeDriver(driverName, config, url, { max, bigint, prepare });

  if (driverName === "sqlite") return new Bun.SQL(url!);
  if ("driver" in config) {
    return new Bun.SQL({
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
  return new Bun.SQL({
    url: url!,
    ...(max !== undefined ? { max } : {}),
    ...(prepare !== undefined ? { prepare } : {}),
    ...(bigint !== undefined ? { bigint } : {}),
  });
}
