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
import { Search } from "../search/SearchManager.js";
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

export function configureOrm(config: OrmConfig): ConfiguredOrm {
  // Snapshot the previous default BEFORE we touch anything else, so we can
  // tear it down AFTER the new defaults are installed. Calling closeAll() up
  // front would synchronously clear defaultConnection and tenantResolver
  // before the new ones are set — a tiny window where any concurrent request
  // would fail with "No connection set on model X". Order matters here.
  const previousDefault = ConnectionManager.getDefault();

  const connection = new Connection(config.connection);
  ConnectionManager.setDefault(connection);
  Model.setConnection(connection);
  Schema.setConnection(connection);

  if (config.tenancy?.resolveTenant) {
    ConnectionManager.setTenantResolver(config.tenancy.resolveTenant);

    // Defaults applied only when tenancy is in use: idle per-tenant pools
    // are reclaimed unless the app explicitly opts out.
    ConnectionManager.defaultTenantTtl =
      config.tenancy.idleTimeoutMs ?? 300_000;

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

  if (config.queue) {
    let driver: QueueDriver;
    if (config.queue.driver === "db" || config.queue.driver === "redis") {
      if (config.queue.driver === "db") {
        const dbConnection = config.queue.connection
          ? new Connection(config.queue.connection)
          : connection;
        driver = new DatabaseQueueDriver(dbConnection, {
          table: config.queue.table,
          failedTable: config.queue.failedTable,
        });
      } else {
        driver = new RedisQueueDriver(resolveQueueRedisClient(config.queue.redis?.url), {
          prefix: config.cache?.prefix ? `${config.cache.prefix}queue:` : undefined,
        });
      }
    } else {
      driver = config.queue.driver ?? new DatabaseQueueDriver(connection, {
        table: config.queue.table,
        failedTable: config.queue.failedTable,
      });
    }
    Queue.configure(driver, config.queue.defaultQueue ?? "default");
  }

  if (config.search) {
    Search.configure({
      ...config.search,
      // Pull tenant lister from search-specific config, otherwise inherit the
      // global tenancy lister so `search:list-indexes --all-tenants` works
      // without duplicating config.
      listTenants: config.search.listTenants ?? config.tenancy?.listTenants,
    });
  }

  // Tear down the previous default in the background — new defaults are
  // already live, so no request can see a missing connection.
  if (previousDefault && previousDefault !== connection) {
    void previousDefault.close().catch(() => {});
  }

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
