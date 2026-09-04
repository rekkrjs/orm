import type { CacheRememberOptions, CacheStore } from "./CacheStore.js";
import type { Connection } from "../connection/Connection.js";
import { resolveConnection } from "../connection/ExecutionContext.js";

export interface CacheConfig {
  store: CacheStore;
  prefix?: string;
  defaultTtl?: number;
}

// Separate in-memory databases are not a shared logical resource, even with identical URLs.
const memoryNamespaces = new WeakMap<Connection, string>();

export class Cache {
  /** The same stable namespace used by Builder.remember() and its tags. */
  static queryKey(key: string, connection: Connection = resolveConnection()): string {
    const config = connection.getConfig();
    const sqliteMemory = connection.getDriverName() === "sqlite" && ("url" in config
      ? config.url === "sqlite://:memory:" : !(config.filename || config.database) || (config.filename ?? config.database) === ":memory:");
    let memoryId: string | undefined;
    if (sqliteMemory) {
      const root = connection.resourceConnection();
      memoryId = memoryNamespaces.get(root);
      if (!memoryId) { memoryId = crypto.randomUUID(); memoryNamespaces.set(root, memoryId); }
    }
    const scope = JSON.stringify([connection.getTenantId() ?? null, connection.getDriverName(), config, connection.getSchema() ?? null, memoryId],
      (_, value) => value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
    return `orm:query:${new Bun.CryptoHasher("sha256").update(scope).digest("hex")}:${key}`;
  }

  static forgetQuery(key: string, connection?: Connection): Promise<void> {
    return this.forget(this.queryKey(key, connection));
  }

  static forgetQueryTag(tag: string, connection?: Connection): Promise<void> {
    return this.forgetTag(this.queryKey(tag, connection));
  }
  private static store?: CacheStore;
  private static prefix = "";
  private static defaultTtl?: number;

  static configure(config: CacheConfig): void {
    this.store = config.store;
    this.prefix = config.prefix ?? "";
    this.defaultTtl = config.defaultTtl;
  }

  static reset(): void { this.store = undefined; this.prefix = ""; this.defaultTtl = undefined; }

  static getStore(): CacheStore {
    if (!this.store) {
      throw new Error("Cache has not been configured. Import from @rekkr/orm/cache and call Cache.configure({ store }) before using cache APIs.");
    }
    return this.store;
  }

  static async get<T = unknown>(key: string): Promise<T | null> {
    return await this.getStore().get<T>(this.prefixKey(key));
  }

  /**
   * Stores are JSON-backed, and `JSON.stringify` cannot represent top-level
   * undefined, functions, or symbols. Refuse those values at the boundary.
   */
  private static assertSerializable(value: unknown): void {
    if (value === undefined || typeof value === "function" || typeof value === "symbol") {
      throw new TypeError(
        `Cache values must be JSON-serializable; received ${value === undefined ? "undefined" : typeof value}. ` +
        "Use null, or wrap the value in an object.",
      );
    }
  }

  static async set<T = unknown>(key: string, value: T, options: CacheRememberOptions = {}): Promise<void> {
    this.assertSerializable(value);
    await this.getStore().set(this.prefixKey(key), value, this.prefixOptions(options));
  }

  static async remember<T>(key: string, value: T | Promise<T> | (() => T | Promise<T>), ttl?: number): Promise<T>;
  static async remember<T>(key: string, value: T | Promise<T> | (() => T | Promise<T>), options?: CacheRememberOptions): Promise<T>;
  static async remember<T>(
    key: string,
    valueOrResolver: T | Promise<T> | (() => T | Promise<T>),
    ttlOrOptions?: number | CacheRememberOptions
  ): Promise<T> {
    const normalized = typeof ttlOrOptions === "number" ? { ttl: ttlOrOptions } : ttlOrOptions ?? {};
    const store = this.getStore();
    if (store.lookup) {
      const cached = await store.lookup<T>(this.prefixKey(key));
      if (cached.hit) return cached.value as T;
    } else {
      const cached = await this.get<T>(key);
      if (cached !== null) return cached;
    }
    const value = await (typeof valueOrResolver === "function"
      ? (valueOrResolver as () => T | Promise<T>)()
      : valueOrResolver);
    // A resolver returning undefined is a pass-through, not a cache write:
    // throwing here would break callers whose resolver legitimately has nothing
    // to return. Return null from the resolver to cache a "no value" result.
    if (value === undefined) return value as T;
    await this.set(key, value, {
      ...normalized,
      ttl: normalized.ttl ?? this.defaultTtl,
    });
    return value;
  }

  static async forget(key: string): Promise<void> {
    await this.getStore().forget(this.prefixKey(key));
  }

  static async forgetTag(tag: string): Promise<void> {
    await this.getStore().forgetTag(this.prefixKey(tag));
  }

  static async forgetTags(tags: string[]): Promise<void>;
  static async forgetTags(...tags: string[]): Promise<void>;
  static async forgetTags(...tags: [string[]] | string[]): Promise<void> {
    const list = Array.isArray(tags[0]) ? tags[0] : tags as string[];
    await this.getStore().forgetTags(list.map((tag) => this.prefixKey(tag)));
  }

  static async flush(): Promise<void> {
    await this.getStore().flush();
  }

  private static prefixKey(key: string): string {
    return this.prefix ? `${this.prefix}${key}` : key;
  }

  private static prefixOptions(options: CacheRememberOptions): CacheRememberOptions {
    const tags = typeof options.tags === "string" ? [options.tags] : options.tags;
    const normalizedTags = tags ? [...new Set(tags)] : undefined;
    return {
      ...options,
      ttl: options.ttl ?? this.defaultTtl,
      tags: normalizedTags?.map((tag) => this.prefixKey(tag)),
    };
  }
}
