import { TenantContext } from "../connection/TenantContext.js";
import { TransactionContext } from "../connection/TransactionContext.js";
import type { ModelConstructor } from "../model/Model.js";
import { Connection } from "../connection/Connection.js";
import type { ConnectionConfig } from "../types/index.js";
import type { SearchCapabilities, SearchCapability, SearchEngine, SearchMultiResult, SearchableRecord } from "./SearchEngine.js";
import type { SearchBuilder } from "./SearchBuilder.js";
import { MeilisearchEngine } from "./engines/MeilisearchEngine.js";
import { PostgresFTSEngine } from "./engines/PostgresFTSEngine.js";
import { SqliteFTS5Engine } from "./engines/SqliteFTS5Engine.js";
import { attachSearchObserver, detachSearchObservers } from "./SearchObserver.js";
import {
  applySearchableStatics,
  Searchable,
  type SearchableInstance,
  type SearchableModelConstructor,
  type SearchableModelStatics,
  type SearchableOptions,
} from "./Searchable.js";

export interface SearchBatchConfig {
  /** Flush when this many distinct records have accumulated. */
  maxItems?: number;
  /** Flush after this many milliseconds since the first buffered record. */
  maxMs?: number;
}

export type SearchEngineName =
  | "meilisearch"
  | "meili"
  | "pg"
  | "postgres"
  | "postgres-fts"
  | "sqlite"
  | "sqlite-fts5";

type MeilisearchEngineName = "meilisearch" | "meili";
type PostgresSearchEngineName = "pg" | "postgres" | "postgres-fts";
type SqliteSearchEngineName = "sqlite" | "sqlite-fts5";

interface BaseSearchConfig {
  queue?: { connection?: string; name?: string };
  chunk?: number;
  batch?: SearchBatchConfig;
  /**
   * When set, every call to `Model.searchableAs()` runs through this hook
   * to produce a tenant-scoped index name (e.g. `posts_tenant_42`). The
   * hook receives the base index name (`searchIndex ?? getTable()`) and the
   * active tenant id from `TenantContext.current()`. Return the base name
   * unchanged for tenants that should share the global index, or null tenants.
   *
   * Example:
   * ```ts
   * tenantScope: (base, tenantId) => tenantId ? `${base}_t_${tenantId}` : base
   * ```
   *
   * The resolved name is baked into `SearchableRecord.index` at observer
   * dispatch time, and read by `SearchBuilder` at query time, so both the
   * sync side (observer/queue) and the read side (search) stay aligned.
   */
  tenantScope?: (baseIndex: string, tenantId: string | null) => string;

  /**
   * Source of tenant ids for batch operations (`Search.indexesForAllTenants`,
   * `search:list-indexes --all-tenants`). Typically wired from
   * `OrmConfig.tenancy.listTenants` at configure time.
   */
  listTenants?: () => string[] | Promise<string[]>;
}

export type SearchConfig =
  | (BaseSearchConfig & {
    engine: MeilisearchEngineName;
    /** Meilisearch host. Falls back to MEILISEARCH_HOST / MEILI_HOST. */
    host?: string;
    /** Meilisearch API key. Falls back to MEILISEARCH_API_KEY / MEILI_KEY / MEILI_MASTER_KEY. */
    apiKey?: string;
  })
  | (BaseSearchConfig & {
    engine: PostgresSearchEngineName | SqliteSearchEngineName;
    /** Dedicated DB connection for the built-in PostgreSQL/SQLite aliases. */
    connection?: Connection | ConnectionConfig;
  })
  | (BaseSearchConfig & {
    engine: SearchEngine;
  });

type ResolvedSearchConfig = Omit<SearchConfig, "engine"> & { engine: SearchEngine };

let currentConfig: ResolvedSearchConfig | null = null;
const observed = new Set<ModelConstructor>();
const pending = new Set<ModelConstructor>();

// Records carry their destination; timer callbacks must not inherit another tenant.
type BufferedRecord = { record: SearchableRecord; tenantId?: string; engine: SearchEngine; operation: "update" | "delete" };
let buffer = new Map<string, BufferedRecord>();
let flushing: Promise<void> | undefined;
let batchGeneration = 0;
let batchTimer: ReturnType<typeof setTimeout> | null = null;
let exitHookInstalled = false;

function batchingEnabled(): boolean {
  return Boolean(currentConfig?.batch && !currentConfig.queue);
}

function backgroundFlush(): void {
  void flushPending().catch(error => {
    console.error("Search batch delivery failed; records retained for retry:", error);
    if (buffer.size) scheduleFlush();
  });
}

function scheduleFlush(): void {
  if (batchTimer || !currentConfig?.batch) return;
  batchTimer = setTimeout(backgroundFlush, currentConfig.batch.maxMs ?? 500);
  batchTimer.unref?.();
}

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.once("beforeExit", () => { void flushPending().catch(error => console.error("Search final flush failed:", error)); });
}

function enqueue(record: SearchableRecord, operation: "update" | "delete"): boolean {
  if (!batchingEnabled()) return false;
  const tenantId = TenantContext.current()?.tenantId;
  const key = JSON.stringify([tenantId, record.index, record.id]);
  buffer.set(key, { record: structuredClone(record), tenantId, engine: currentConfig!.engine, operation });
  if (buffer.size >= (currentConfig?.batch?.maxItems ?? 100)) backgroundFlush();
  else scheduleFlush();
  return true;
}

async function flushPending(): Promise<void> {
  if (flushing) await flushing;
  if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
  if (!buffer.size) return;
  const batch = buffer;
  buffer = new Map();
  const generation = batchGeneration;
  const deliver = async () => {
    // ponytail: default batches hold 100 records; use keyed groups if large
    // multi-tenant batches make this linear group search a measured cost.
    const groups: Array<Array<[string, BufferedRecord]>> = [];
    for (const entry of batch) {
      const item = entry[1];
      const group = groups.find(g => g[0]![1].engine === item.engine && g[0]![1].tenantId === item.tenantId && g[0]![1].operation === item.operation);
      if (group) group.push(entry); else groups.push([entry]);
    }
    const errors: unknown[] = [];
    for (const group of groups) {
      const first = group[0]![1];
      const run = () => first.engine[first.operation](group.map(([, item]) => item.record));
      try {
        await TransactionContext.without(() => TenantContext.asLandlord(() => first.tenantId === undefined ? run() : TenantContext.run(first.tenantId, run)));
      } catch (error) {
        errors.push(error);
        if (generation === batchGeneration) for (const [key, item] of group) {
          if (!buffer.has(key)) buffer.set(key, item);
        }
      }
    }
    if (errors.length) throw new AggregateError(errors, "Search batch delivery failed");
  };
  flushing = deliver();
  try { await flushing; } finally { flushing = undefined; }
}

function attachIfReady(modelClass: ModelConstructor): void {
  if (observed.has(modelClass)) return;
  if (currentConfig) {
    attachSearchObserver(modelClass);
    observed.add(modelClass);
  } else {
    pending.add(modelClass);
  }
}

const defaultCapabilities: SearchCapabilities = {
  nativeMultiSearch: false,
  indexSettings: false,
  matchesPosition: false,
  highlight: false,
  crop: false,
  facets: false,
  minScore: false,
  searchOn: false,
  rawQuery: false,
  typoTolerance: false,
  vector: false,
  hybrid: false,
};

function engineCapabilities(engine: SearchEngine): SearchCapabilities {
  return engine.capabilities ? engine.capabilities() : { ...defaultCapabilities };
}

function env(name: string): string | undefined {
  return typeof process !== "undefined" ? process.env?.[name] : undefined;
}

function resolveConnection(connection: Connection | ConnectionConfig | undefined): Connection | undefined {
  if (!connection) return undefined;
  return connection instanceof Connection ? connection : new Connection(connection);
}

export function resolveSearchEngine(config: SearchConfig): SearchEngine {
  const { engine } = config;
  if (typeof engine !== "string") {
    if (
      ("connection" in config && config.connection) ||
      ("host" in config && config.host) ||
      ("apiKey" in config && config.apiKey)
    ) {
      throw new Error("Search.configure: `connection`, `host`, and `apiKey` are only supported with built-in engine aliases. Pass options to the custom engine constructor instead.");
    }
    return engine;
  }

  switch (engine) {
    case "meilisearch":
    case "meili":
      if ("connection" in config && config.connection) {
        throw new Error("Search.configure: `connection` is not supported for the Meilisearch engine alias.");
      }
      return new MeilisearchEngine({
        host: config.host ?? env("MEILISEARCH_HOST") ?? env("MEILI_HOST") ?? "http://127.0.0.1:7700",
        apiKey: config.apiKey ?? env("MEILISEARCH_API_KEY") ?? env("MEILI_KEY") ?? env("MEILI_MASTER_KEY"),
      });
    case "pg":
    case "postgres":
    case "postgres-fts":
      if (("host" in config && config.host) || ("apiKey" in config && config.apiKey)) {
        throw new Error("Search.configure: `host` and `apiKey` are only supported for the Meilisearch engine alias.");
      }
      return config.connection
        ? new PostgresFTSEngine({ connection: resolveConnection(config.connection) })
        : new PostgresFTSEngine({ shared: true });
    case "sqlite":
    case "sqlite-fts5":
      if (("host" in config && config.host) || ("apiKey" in config && config.apiKey)) {
        throw new Error("Search.configure: `host` and `apiKey` are only supported for the Meilisearch engine alias.");
      }
      return config.connection
        ? new SqliteFTS5Engine({ connection: resolveConnection(config.connection) })
        : new SqliteFTS5Engine({ shared: true });
    default:
      throw new Error(`Unknown search engine "${engine}". Expected one of: meilisearch, pg, sqlite.`);
  }
}

type SearchableClass<TBase extends ModelConstructor> = TBase
  & SearchableModelStatics<InstanceType<TBase>>
  & { new (...args: any[]): InstanceType<TBase> & SearchableInstance };

function defineSearch<TBase extends ModelConstructor>(
  modelClass: TBase,
  options?: SearchableOptions<InstanceType<TBase>>,
): SearchableClass<TBase>;
function defineSearch(
  modelClass: ModelConstructor,
  options: SearchableOptions<any> = {},
): any {
  const searchableClass = Searchable(modelClass as any, options);
  return Search.register(searchableClass as any);
}

export const Search = {
  configure(config: SearchConfig): void {
    currentConfig = { ...config, engine: resolveSearchEngine(config) };
    for (const m of pending) {
      attachSearchObserver(m);
      observed.add(m);
    }
    pending.clear();
    if (config.batch) installExitHook();
  },

  /** True when `SearchConfig.batch` is set and queue mode is off. */
  isBatching(): boolean {
    return batchingEnabled();
  },

  /** Queue a record for batched update. Returns true if buffered, false if caller should dispatch immediately. */
  enqueueUpdate(record: SearchableRecord): boolean {
    return enqueue(record, "update");
  },

  /** Queue a record for batched delete. */
  enqueueDelete(record: SearchableRecord): boolean {
    return enqueue(record, "delete");
  },

  /** Manually flush the batch buffer (also called on process beforeExit). */
  async flushPending(): Promise<void> {
    await flushPending();
  },

  register<TBase extends ModelConstructor>(
    modelClass: TBase,
    options: SearchableOptions<InstanceType<TBase>> = {},
  ): TBase & SearchableModelStatics<InstanceType<TBase>> {
    applySearchableStatics<InstanceType<TBase>>(modelClass, options);
    attachIfReady(modelClass);
    return modelClass as any;
  },

  /** Make an existing Model class searchable and register its observers. */
  define: defineSearch,

  unregister(modelClass: ModelConstructor): void {
    if (!observed.has(modelClass)) return;
    detachSearchObservers(modelClass);
    observed.delete(modelClass);
  },

  engine(): SearchEngine {
    if (!currentConfig) {
      throw new Error("Search not configured. Pass `search` to configureOrm() or call Search.configure().");
    }
    return currentConfig.engine;
  },

  capabilities(): SearchCapabilities {
    return engineCapabilities(this.engine());
  },

  supports(capability: SearchCapability): boolean {
    return Boolean(this.capabilities()[capability]);
  },

  config(): ResolvedSearchConfig | null {
    return currentConfig;
  },

  /**
   * Resolve a base index name through the configured tenant scoper. Reads
   * the active `TenantContext` when `tenantId` is omitted. Use this from
   * CLI/scripts that need the tenant-scoped name outside a model context.
   */
  indexFor(baseIndex: string, tenantId?: string | null): string {
    const cfg = currentConfig;
    if (!cfg?.tenantScope) return baseIndex;
    let active: string | null;
    if (tenantId === undefined) {
      try {
        const { TenantContext } = require("../connection/TenantContext.js");
        active = TenantContext.current()?.tenantId ?? null;
      } catch {
        active = null;
      }
    } else {
      active = tenantId;
    }
    return cfg.tenantScope(baseIndex, active);
  },

  /**
   * Batch variant of `indexFor()`. Resolves a base index name across many
   * tenants in one call. Pass `null` to include the landlord (un-scoped)
   * variant in the result map.
   *
   * ```ts
   * Search.indexesFor("posts", ["1", "2", null]);
   * // → { "1": "posts_t_1", "2": "posts_t_2", "__landlord__": "posts" }
   * ```
   */
  indexesFor(
    baseIndex: string,
    tenantIds: ReadonlyArray<string | null>,
  ): Record<string, string> {
    const cfg = currentConfig;
    const out: Record<string, string> = {};
    for (const tid of tenantIds) {
      const key = tid === null ? "__landlord__" : tid;
      out[key] = cfg?.tenantScope ? cfg.tenantScope(baseIndex, tid) : baseIndex;
    }
    return out;
  },

  /**
   * Resolve the scoped index name for every tenant returned by
   * `tenancy.listTenants` (configured on `configureOrm`). Includes the
   * landlord variant when `includeLandlord` is true.
   */
  async indexesForAllTenants(
    baseIndex: string,
    options: { includeLandlord?: boolean } = {},
  ): Promise<Record<string, string>> {
    const cfg = currentConfig;
    const tenantIds: string[] = cfg?.listTenants ? ((await cfg.listTenants()) ?? []) : [];
    const inputs: Array<string | null> = options.includeLandlord ? [null, ...tenantIds] : [...tenantIds];
    return this.indexesFor(baseIndex, inputs);
  },

  /**
   * Execute several search queries in a single round-trip. Returns raw hits
   * per builder (no ORM hydration). Falls back to sequential `engine.search()`
   * when the engine has no native `multiSearch`.
   */
  async multi(builders: SearchBuilder<any>[]): Promise<SearchMultiResult[]> {
    if (builders.length === 0) return [];
    const queries = builders.map((b) => (b as any)._toQuery());
    const engine = Search.engine();
    if (typeof engine.multiSearch === "function") {
      return engine.multiSearch(queries);
    }
    const results: SearchMultiResult[] = [];
    for (const q of queries) {
      const hits = await engine.search(q);
      results.push({ index: q.index, hits });
    }
    return results;
  },

  reset(keepRegistrations = false): void {
    const models = keepRegistrations ? [...observed, ...pending] : [];
    for (const m of observed) detachSearchObservers(m);
    observed.clear();
    pending.clear();
    if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
    batchGeneration++;
    buffer.clear();
    currentConfig = null;
    for (const model of models) pending.add(model);
  },
};

export function getSearchEngine(): SearchEngine {
  return Search.engine();
}

export function getSearchConfig(): ResolvedSearchConfig | null {
  return currentConfig;
}
