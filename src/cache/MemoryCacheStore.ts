import type { CacheRememberOptions, CacheStore } from "./CacheStore.js";

interface MemoryCacheEntry {
  value: string;
  expiresAt?: number;
  tags: Set<string>;
}

/**
 * Minimum writes between opportunistic sweeps of expired entries. The real
 * interval also scales with the store size, so a sweep costs a bounded number
 * of entry visits per write however large the cache gets.
 *
 * Note this reclaims *expired* entries only. Entries written without a TTL live
 * until they are forgotten or the store is flushed: this store has no eviction
 * policy, so give long-lived caches a TTL or use a store that does.
 */
const PURGE_INTERVAL_WRITES = 64;

export class MemoryCacheStore implements CacheStore {
  private entries = new Map<string, MemoryCacheEntry>();
  private tagKeys = new Map<string, Set<string>>();
  private writesSincePurge = 0;

  async get<T = unknown>(key: string): Promise<T | null> {
    return (await this.lookup<T>(key)).value;
  }

  async lookup<T = unknown>(key: string): Promise<{ hit: boolean; value: T | null }> {
    const entry = this.entries.get(key);
    if (!entry) return { hit: false, value: null };
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      await this.forget(key);
      return { hit: false, value: null };
    }
    try {
      return { hit: true, value: JSON.parse(entry.value) as T };
    } catch {
      // Treat a corrupted entry as a miss and remove it so reads can recover.
      await this.forget(key);
      return { hit: false, value: null };
    }
  }

  async set<T = unknown>(key: string, value: T, options: CacheRememberOptions = {}): Promise<void> {
    const existing = this.entries.get(key);
    if (existing) {
      this.untag(key, existing.tags);
    }

    // Entries are only evicted when their own key is read, so a store written
    // with short TTLs and never re-read grows without bound. Sweep periodically
    // rather than on every write, which would make set() O(n).
    if (++this.writesSincePurge >= Math.max(PURGE_INTERVAL_WRITES, this.entries.size >> 2)) {
      this.writesSincePurge = 0;
      this.purgeExpired();
    }

    const optionTags = typeof options.tags === "string" ? [options.tags] : options.tags ?? [];
    const tags = new Set(optionTags);
    this.entries.set(key, {
      value: JSON.stringify(value),
      expiresAt: options.ttl ? Date.now() + options.ttl * 1000 : undefined,
      tags,
    });

    for (const tag of tags) {
      let keys = this.tagKeys.get(tag);
      if (!keys) {
        keys = new Set<string>();
        this.tagKeys.set(tag, keys);
      }
      keys.add(key);
    }
  }

  async forget(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (entry) this.untag(key, entry.tags);
    this.entries.delete(key);
  }

  /**
   * Removes a key from its tag indexes, dropping any index left empty —
   * otherwise tagKeys accumulates a growing set of dead tags whose entries
   * forgetTag() keeps re-sweeping.
   */
  private untag(key: string, tags: Iterable<string>): void {
    for (const tag of tags) {
      const keys = this.tagKeys.get(tag);
      if (!keys) continue;
      keys.delete(key);
      if (keys.size === 0) this.tagKeys.delete(tag);
    }
  }

  /** Drops every entry whose TTL has already elapsed. */
  private purgeExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
        this.untag(key, entry.tags);
        this.entries.delete(key);
      }
    }
  }

  async forgetTag(tag: string): Promise<void> {
    const keys = this.tagKeys.get(tag);
    if (!keys) return;
    for (const key of [...keys]) {
      await this.forget(key);
    }
    this.tagKeys.delete(tag);
  }

  async forgetTags(tags: string[]): Promise<void> {
    for (const tag of tags) {
      await this.forgetTag(tag);
    }
  }

  async flush(): Promise<void> {
    this.entries.clear();
    this.tagKeys.clear();
    this.writesSincePurge = 0;
  }
}
