import { redis } from "bun";
import { Connection } from "../connection/Connection.js";
import { ConnectionManager } from "../connection/ConnectionManager.js";
import type { TenantResolver } from "../connection/ConnectionManager.js";
import { Cache, RedisCacheStore } from "../cache/index.js";
import type { CacheStore } from "../cache/index.js";
import { Model } from "../model/Model.js";
import { Schema } from "../schema/Schema.js";
import { Migrator, type MigratorOptions } from "../migration/Migrator.js";
import { SeederRunner } from "../seeding/Seeder.js";
import { TenantContext } from "../connection/TenantContext.js";
import type { ModelDeclaration } from "../typegen/TypeGenerator.js";
import type { ConnectionConfig } from "../types/index.js";
import { Queue } from "../queue/Queue.js";
import { DatabaseQueueDriver } from "../queue/DatabaseQueueDriver.js";
import { RedisQueueDriver, resolveQueueRedisClient } from "../queue/RedisQueueDriver.js";
import type { QueueDriver } from "../queue/QueueDriver.js";
import { Search, resolveSearchEngine } from "../search/SearchManager.js";
import type { SearchConfig } from "../search/SearchManager.js";

export interface ModelsPath {
  landlord?: string | string[];
  tenant?: string | string[];
}

export interface OrmConfig {
  connection: ConnectionConfig;
  migrationsPath?: string | string[];
  seedersPath?: string | string[];
  migrations?: {
    landlord?: string | string[];
    tenant?: string | string[];
    createIfMissing?: boolean | {
      database?: boolean;
      schema?: boolean;
    };
  };
  tenancy?: {
    resolveTenant?: TenantResolver;
    listTenants?: () => string[] | Promise<string[]>;
    /** Default idle TTL (ms) for tenant contexts that own a connection pool. Reclaims idle per-tenant pools. */
    idleTimeoutMs?: number;
    /** Enable the background sweep that closes expired tenant pools. Interval in ms (default 60000 when true). */
    sweep?: boolean | number;
  };
  modelsPath?: string | string[] | ModelsPath;
  policyPath?: string | string[];
  typeDeclarations?: Record<string, string | ModelDeclaration>;
  typeDeclarationImportPrefix?: string;
  typeDeclarationSingularModels?: boolean;
  typeStubs?: boolean;
  /**
   * Query logging. `bindings` opts into logging the parameter values, which are
   * hidden by default because they contain credentials and PII.
   */
  log?: boolean | { file?: string; console?: boolean; bindings?: boolean };
  transactions?: {
    /** Safety net (ms): a manual beginTransaction() with no commit/rollback within this window is auto-rolled-back and its pooled connection released. Opt-in. */
    abandonedTimeoutMs?: number;
  };
  cache?: {
    store?: CacheStore;
    prefix?: string;
    defaultTtl?: number;
  };
  queue?: {
    driver?: "db" | "redis" | QueueDriver;
    defaultQueue?: string;
    workers?: number;
    jobsPath?: string | string[];
    /** Visibility timeout: a reserved job not completed within this window is redelivered. */
    retryAfterSeconds?: number;
    /**
     * Delay (seconds) before a failed job becomes available again. Defaults to
     * 0, which retries immediately — raise it to avoid hammering a dependency
     * that is already failing.
     */
    retryDelaySeconds?: number;
    pollIntervalMs?: number;
    table?: string;
    failedTable?: string;
    connection?: ConnectionConfig;
    /** Redis server for the `redis` driver. Omit to use Bun's default client (`REDIS_URL`). */
    redis?: { url?: string };
  };
  commands?: {
    commandsPath?: string | string[];
  };
  search?: SearchConfig;
}

export interface ConfiguredOrm {
  config: OrmConfig;
  connection: Connection;
  migrator(scope?: "landlord" | "tenant", overrides?: MigratorOptions): Migrator;
  seeder(): SeederRunner;
  migrate(scope?: "landlord" | "tenant", overrides?: MigratorOptions): Promise<void>;
  rollback(steps?: number, scope?: "landlord" | "tenant"): Promise<void>;
  fresh(scope?: "landlord" | "tenant"): Promise<void>;
  seed(): Promise<void>;
}

function resolveMigrationPath(config: OrmConfig, scope: "landlord" | "tenant"): string | string[] {
  if (config.migrations) {
    const grouped = config.migrations[scope];
    if (grouped) return grouped;
    throw new Error(`No migration path configured for scope "${scope}".`);
  }
  if (config.migrationsPath) return config.migrationsPath;
  throw new Error(`No migration path configured for scope "${scope}".`);
}

let configuredConnection: Connection | undefined;
let reconfiguring = false;
let cleanupOwned: Array<() => unknown | Promise<unknown>> = [];

function prepare(config: OrmConfig) {
  const owned: Connection[] = [];
  const cleanup: typeof cleanupOwned = [];
  try {
    const connection = new Connection(config.connection);
    owned.push(connection);
    let queue: QueueDriver | undefined;
    if (config.queue) {
      if (config.queue.driver === "redis") {
        const client = resolveQueueRedisClient(config.queue.redis?.url);
        if (config.queue.redis?.url) cleanup.push(() => (client as any).close());
        queue = new RedisQueueDriver(client, { prefix: config.cache?.prefix ? `${config.cache.prefix}queue:` : undefined });
      } else if (!config.queue.driver || config.queue.driver === "db") {
        const db = config.queue.connection ? new Connection(config.queue.connection) : connection;
        if (db !== connection) owned.push(db);
        queue = new DatabaseQueueDriver(db, { table: config.queue.table, failedTable: config.queue.failedTable });
      } else queue = config.queue.driver;
    }
    let search: SearchConfig | undefined;
    if (config.search) {
      const input = { ...config.search };
      if ("connection" in input && input.connection && !(input.connection instanceof Connection)) {
        const db = new Connection(input.connection);
        owned.push(db);
        input.connection = db;
      }
      const engine = resolveSearchEngine(input);
      const { connection: _, host: _host, apiKey: _key, ...rest } = input as any;
      search = { ...rest, engine, listTenants: input.listTenants ?? config.tenancy?.listTenants };
    }
    return { connection, owned, cleanup, queue, search };
  } catch (error) {
    void Promise.allSettled([...owned.map(connection => connection.close()), ...cleanup.map(fn => Promise.resolve().then(fn))]);
    throw error;
  }
}

export function configureOrm(config: OrmConfig): ConfiguredOrm {
  if (reconfiguring || ConnectionManager.hasTenantState() || (configuredConnection && !configuredConnection.isRetired())) {
    throw new Error("ORM is already configured. Await reconfigureOrm(config) to replace it.");
  }
  return install(config, prepare(config));
}

export async function reconfigureOrm(config: OrmConfig): Promise<ConfiguredOrm> {
  if (reconfiguring) throw new Error("ORM reconfiguration is already in progress.");
  if (Connection.hasActiveScope()) throw new Error("Reconfigure outside active ORM scopes.");
  const prepared = prepare(config); // Validation leaves the current state intact on failure.
  reconfiguring = true;
  try {
    await ConnectionManager.closeAll({ beforeClose: () => Search.flushPending() });
    const results = await Promise.allSettled(cleanupOwned.map(fn => Promise.resolve().then(fn)));
    const errors = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    if (errors.length) throw new AggregateError(errors.map(r => r.reason), "ORM resource cleanup failed; retry reconfigureOrm().");
    cleanupOwned = [];
    configuredConnection = undefined;
    return install(config, prepared);
  } catch (error) {
    await Promise.allSettled([...prepared.owned.map(connection => connection.close()), ...prepared.cleanup.map(fn => Promise.resolve().then(fn))]);
    throw error;
  } finally { reconfiguring = false; }
}

function install(config: OrmConfig, prepared: ReturnType<typeof prepare>): ConfiguredOrm {
  const { connection } = prepared;
  Cache.reset();
  Queue.reset();
  Search.reset(true);
  ConnectionManager.disableTenantSweep();
  for (const [index, owned] of prepared.owned.entries()) ConnectionManager.add(`orm:owned:${index}`, owned, { owned: true });
  configuredConnection = connection;
  cleanupOwned = prepared.cleanup;
  ConnectionManager.setDefault(connection, { owned: true });
  Model.setConnection(connection);
  Schema.setConnection(connection);

  // install() only runs after initial-state validation or a completed shutdown.
  void ConnectionManager.setTenantResolver(config.tenancy?.resolveTenant);
  ConnectionManager.defaultTenantTtl = config.tenancy?.idleTimeoutMs ?? 300_000;
  if (config.tenancy?.resolveTenant) {

    // Defaults applied only when tenancy is in use: idle per-tenant pools
    // are reclaimed unless the app explicitly opts out.
    const sweep = config.tenancy.sweep ?? true;
    if (sweep !== false && sweep !== 0) {
      ConnectionManager.enableTenantSweep(typeof sweep === "number" ? sweep : 60_000);
    }
  }

  // Global safety net for abandoned manual transactions. Default 60s;
  // set transactions.abandonedTimeoutMs = 0 to disable.
  Connection.abandonedTransactionTimeoutMs =
    config.transactions?.abandonedTimeoutMs ?? 60_000;

  // Logging state lives on Connection statics, so every branch must set every
  // field: leaving one untouched let a previous `{ bindings: true }` (or a log
  // file path) survive into a configuration that never asked for it, and
  // silently resume writing secrets.
  const logConfig = config.log;
  if (logConfig === true) {
    Connection.logQueries = true;
    Connection.queryLogFile = undefined;
    Connection.logToConsole = true;
    Connection.logBindings = false;
  } else if (logConfig && typeof logConfig === "object") {
    Connection.logQueries = true;
    Connection.queryLogFile = logConfig.file;
    Connection.logToConsole = logConfig.console ?? false;
    Connection.logBindings = logConfig.bindings ?? false;
  } else {
    // Absent or `false`: logging off, and nothing carried over.
    Connection.logQueries = false;
    Connection.queryLogFile = undefined;
    Connection.logToConsole = true;
    Connection.logBindings = false;
  }

  if (config.cache) {
    Cache.configure({
      store: config.cache.store ?? new RedisCacheStore(redis),
      prefix: config.cache.prefix,
      defaultTtl: config.cache.defaultTtl,
    });
  }

  if (prepared.queue) Queue.configure(prepared.queue, config.queue?.defaultQueue ?? "default");
  if (prepared.search) Search.configure(prepared.search);

  const buildMigrator = (scope: "landlord" | "tenant" = "landlord", overrides: MigratorOptions = {}) => {
    const path = resolveMigrationPath(config, scope);
    const tenantConn = TenantContext.current()?.connection;
    const activeConn = tenantConn ?? connection;
    const options: MigratorOptions = {
      createIfMissing: config.migrations?.createIfMissing,
      ...overrides,
    };
    const modelPath = typeof config.modelsPath === "object" && !Array.isArray(config.modelsPath)
      ? config.modelsPath[scope]
      : config.modelsPath;
    const modelDirectories = Array.isArray(modelPath) ? modelPath : modelPath ? [modelPath] : [];
    return new Migrator(activeConn, path, {
      declarations: !config.typeStubs,
      stubs: config.typeStubs,
      modelDeclarations: config.typeDeclarations,
      modelDirectory: modelDirectories[0],
      modelDirectories: modelDirectories.length > 1 ? modelDirectories : undefined,
      modelImportPrefix: config.typeDeclarationImportPrefix,
      singularModels: config.typeDeclarationSingularModels,
      declarationDirName: "types",
    }, options);
  };

  const buildSeeder = () => {
    const tenantConn = TenantContext.current()?.connection;
    return new SeederRunner(tenantConn ?? connection);
  };

  return {
    config,
    connection,
    migrator: buildMigrator,
    seeder: buildSeeder,
    async migrate(scope = "landlord", overrides = {}) {
      await buildMigrator(scope, overrides).run();
    },
    async rollback(steps = 1, scope = "landlord") {
      await buildMigrator(scope).rollback(steps);
    },
    async fresh(scope = "landlord") {
      await buildMigrator(scope).fresh();
    },
    async seed() {
      if (!config.seedersPath) {
        throw new Error("No seedersPath configured.");
      }
      await buildSeeder().runDefault(config.seedersPath);
    },
  };
}
