import { createHash } from "node:crypto";
import { TenantContext } from "../connection/TenantContext.js";
import { Connection } from "../connection/Connection.js";
import { UniqueConstraintViolationError } from "../connection/UniqueConstraintViolationError.js";
import { Builder } from "../query/Builder.js";
import { Blueprint } from "../schema/Blueprint.js";
import { Schema } from "../schema/Schema.js";

export interface MigrationLockOptions {
  /** How long to wait for a busy lock before giving up. Default 30s. */
  timeoutMs?: number;
  /**
   * Table fallback (SQLite) only: age at which a lock row left behind by a dead
   * process is considered orphaned and can be taken over. Raise it above the
   * runtime of your slowest migration. Default 15 minutes.
   */
  maxAgeMs?: number;
}

export interface MigrationLockHandle {
  release(): Promise<void>;
}

export const MIGRATION_LOCKS_TABLE = "migration_locks";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_AGE_MS = 15 * 60_000;
const RETRY_INTERVAL_MS = 50;
const MAX_CONSECUTIVE_TAKEOVERS = 5;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function timeoutError(name: string, timeoutMs: number, cause?: unknown): Error {
  return new Error(
    `Could not acquire migration lock "${name}" within ${timeoutMs}ms.`,
    cause === undefined ? undefined : { cause }
  );
}

/**
 * Only a primary key conflict means "someone else holds the lock". A connection
 * drop, a missing table or a permissions error must surface as itself: retrying
 * those for the whole timeout and then blaming lock contention sends whoever is
 * debugging to the wrong place.
 */
const UNIQUE_VIOLATION_CODES = new Set([
  "SQLITE_CONSTRAINT_PRIMARYKEY",
  "SQLITE_CONSTRAINT_UNIQUE",
  "23505", // PostgreSQL unique_violation
  "ER_DUP_ENTRY", // MySQL
  "1062", // MySQL errno
]);

function isUniqueViolation(error: unknown): boolean {
  if (error instanceof UniqueConstraintViolationError) return true;
  const candidate = error as { code?: unknown; errno?: unknown; message?: unknown } | null | undefined;

  const code = candidate?.code;
  if (code !== undefined && code !== null) return UNIQUE_VIOLATION_CODES.has(String(code));

  const errno = candidate?.errno;
  if (typeof errno === "number") {
    // SQLITE_CONSTRAINT_UNIQUE / SQLITE_CONSTRAINT_PRIMARYKEY / ER_DUP_ENTRY
    return errno === 2067 || errno === 1555 || errno === 1062;
  }

  // Last resort for drivers that report neither: match the wording, not the driver.
  return /unique constraint failed|duplicate key value|duplicate entry/i.test(
    String(candidate?.message ?? "")
  );
}

/**
 * Acquires the migration lock.
 *
 * PostgreSQL and MySQL use native session-scoped advisory locks held on a
 * dedicated connection: if the process dies the server drops the session and
 * the lock goes with it, so nothing has to be cleaned up by hand. SQLite has no
 * advisory locks, so it falls back to a row in `migration_locks` that is
 * released on exit and, failing that, taken over once it is older than
 * `maxAgeMs`.
 */
export async function acquireMigrationLock(
  connection: Connection,
  name: string,
  options: MigrationLockOptions = {}
): Promise<MigrationLockHandle> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  switch (connection.getDriverName()) {
    case "postgres":
      return acquirePostgresLock(connection, name, timeoutMs);
    case "mysql":
      return acquireMySqlLock(connection, name, timeoutMs);
    default:
      return acquireTableLock(connection, name, timeoutMs, options.maxAgeMs ?? DEFAULT_MAX_AGE_MS);
  }
}

/**
 * Lock identity. PostgreSQL advisory locks are already scoped to the current
 * database, MySQL's are server-wide, so the database name is folded in there.
 * Credentials are deliberately left out: two apps pointing at the same database
 * with different users must contend for the same lock.
 */
function databaseName(connection: Connection): string {
  const config = connection.getConfig() as Record<string, any>;
  if (config.database) return String(config.database);
  if (config.filename) return String(config.filename);
  if (config.url) {
    try {
      return new URL(String(config.url)).pathname.replace(/^\//, "");
    } catch {
      return String(config.url);
    }
  }
  return "";
}

/** A single-connection session, independent from the pool the migrations run on. */
function dedicatedSession(connection: Connection): Connection {
  const config = connection.getConfig() as Record<string, any>;
  const session = new Connection({ ...config, max: 1 } as any);
  session.logQueries = false;
  return session;
}

function isTruthyResult(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}

async function acquirePostgresLock(
  connection: Connection,
  name: string,
  timeoutMs: number
): Promise<MigrationLockHandle> {
  // pg advisory locks take a signed 64-bit key, so hash the lock name down to one.
  const digest = createHash("sha256").update(`orm|${connection.getSchema() ?? ""}|${name}`).digest();
  const key = digest.readBigInt64BE(0).toString();
  const session = dedicatedSession(connection);
  const started = Date.now();

  try {
    while (true) {
      const rows = await TenantContext.asLandlord(() => session.query(`SELECT pg_try_advisory_lock(${key}) AS locked`));
      if (isTruthyResult(rows?.[0]?.locked)) {
        return {
          release: async () => {
            try {
              await TenantContext.asLandlord(() => session.query(`SELECT pg_advisory_unlock(${key})`));
            } finally {
              await session.close();
            }
          },
        };
      }
      if (Date.now() - started >= timeoutMs) throw timeoutError(name, timeoutMs);
      await sleep(RETRY_INTERVAL_MS);
    }
  } catch (error) {
    await session.close().catch(() => null);
    throw error;
  }
}

async function acquireMySqlLock(
  connection: Connection,
  name: string,
  timeoutMs: number
): Promise<MigrationLockHandle> {
  // GET_LOCK names are server-wide and capped at 64 characters.
  const digest = createHash("sha256").update(`${databaseName(connection)}|${connection.getSchema() ?? ""}|${name}`).digest("hex");
  const lockName = `orm:${digest.slice(0, 40)}`;
  const session = dedicatedSession(connection);

  const started = Date.now();

  try {
    // GET_LOCK's own timeout is in whole seconds, so it would turn a 1ms wait
    // into a 1s one. Poll with an immediate-return lock attempt instead.
    while (!isTruthyResult((await TenantContext.asLandlord(() => session.query("SELECT GET_LOCK(?, 0) AS locked", [lockName])))?.[0]?.locked)) {
      if (Date.now() - started >= timeoutMs) throw timeoutError(name, timeoutMs);
      await sleep(RETRY_INTERVAL_MS);
    }
    return {
      release: async () => {
        try {
          await TenantContext.asLandlord(() => session.query("SELECT RELEASE_LOCK(?)", [lockName]));
        } finally {
          await session.close();
        }
      },
    };
  } catch (error) {
    await session.close().catch(() => null);
    throw error;
  }
}

/**
 * CREATE TABLE IF NOT EXISTS rather than hasTable + create: the whole point of
 * this table is to arbitrate between concurrent migrators, so creating it must
 * not be a race of its own.
 */
async function ensureLocksTable(connection: Connection): Promise<void> {
  await Schema.createIfNotExists(
    MIGRATION_LOCKS_TABLE,
    (table: Blueprint) => {
      table.string("name").primary();
      table.string("owner");
      table.string("created_at");
    },
    // On the migrator's own connection, not the global one: two migrators over
    // two databases would otherwise create the table in whichever database the
    // global Schema happens to point at.
    connection
  );
}

async function acquireTableLock(
  connection: Connection,
  name: string,
  timeoutMs: number,
  maxAgeMs: number
): Promise<MigrationLockHandle> {
  await ensureLocksTable(connection);
  const table = connection.qualifyTable(MIGRATION_LOCKS_TABLE);
  const owner = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const started = Date.now();
  let takeovers = 0;

  while (true) {
    try {
      await new Builder(connection, table).insert({
        name,
        owner,
        created_at: new Date().toISOString(),
      });
      return registerTableLock(async () => {
        await new Builder(connection, table).where("name", name).where("owner", owner).delete();
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      if ((await takeOverIfOrphaned(connection, table, name, maxAgeMs)) && takeovers++ < MAX_CONSECUTIVE_TAKEOVERS) {
        continue;
      }
      if (Date.now() - started >= timeoutMs) throw timeoutError(name, timeoutMs, error);
      await sleep(RETRY_INTERVAL_MS);
    }
  }
}

/**
 * Deletes the lock row only if it is still the exact row we inspected and it is
 * older than `maxAgeMs`. Matching on owner + created_at keeps two processes from
 * both deleting the row and one of them wiping a lock the other just took.
 */
async function takeOverIfOrphaned(
  connection: Connection,
  table: string,
  name: string,
  maxAgeMs: number
): Promise<boolean> {
  const row = (await new Builder(connection, table).where("name", name).first()) as
    | { owner?: string; created_at?: string }
    | null;
  if (!row) return true;

  const createdAt = Date.parse(String(row.created_at));
  if (!Number.isFinite(createdAt) || Date.now() - createdAt < maxAgeMs) return false;

  await new Builder(connection, table)
    .where("name", name)
    .where("owner", row.owner)
    .where("created_at", row.created_at)
    .delete();
  return true;
}

/**
 * Best-effort release of table locks when the process is asked to stop. Native
 * advisory locks don't need this: the database releases them when the session
 * drops.
 */
const heldTableLocks = new Set<() => Promise<void>>();
let exitHandlers: Array<[string, (...args: any[]) => void]> = [];

function registerTableLock(release: () => Promise<void>): MigrationLockHandle {
  heldTableLocks.add(release);
  attachExitHandlers();
  return {
    release: async () => {
      heldTableLocks.delete(release);
      detachExitHandlersIfIdle();
      await release();
    },
  };
}

async function releaseHeldTableLocks(): Promise<void> {
  await Promise.all([...heldTableLocks].map((release) => release().catch(() => null)));
}

function attachExitHandlers(): void {
  if (exitHandlers.length) return;

  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    const handler = () => {
      process.off(signal, handler);
      void releaseHeldTableLocks().finally(() => {
        // Nothing else is listening, so restore the default signal behaviour we
        // suppressed just by being registered.
        if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
      });
    };
    process.on(signal, handler);
    exitHandlers.push([signal, handler]);
  }

  const beforeExit = () => {
    void releaseHeldTableLocks();
  };
  process.on("beforeExit", beforeExit);
  exitHandlers.push(["beforeExit", beforeExit]);
}

function detachExitHandlersIfIdle(): void {
  if (heldTableLocks.size) return;
  for (const [event, handler] of exitHandlers) process.off(event as any, handler);
  exitHandlers = [];
}
