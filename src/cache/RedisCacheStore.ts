import type { RedisClient } from "bun";
import type { CacheRememberOptions, CacheStore } from "./CacheStore.js";

export interface RedisCacheStoreOptions {
  prefix?: string;
}

type RedisLike = Pick<RedisClient, "get" | "set" | "del" | "sadd" | "smembers" | "scan">;

export class RedisCacheStore implements CacheStore {
  private readonly prefix: string;

  constructor(private readonly client: RedisLike, options: RedisCacheStoreOptions = {}) {
    this.prefix = options.prefix ?? "orm:";
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const value = await this.client.get(this.valueKey(key));
    if (value === null) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      // Corrupt entry (see MemoryCacheStore.get): miss and drop it.
      await this.forget(key);
      return null;
    }
  }

  async set<T = unknown>(key: string, value: T, options: CacheRememberOptions = {}): Promise<void> {
    const cacheKey = this.valueKey(key);
    const serialized = JSON.stringify(value);
    if (options.ttl && options.ttl > 0) {
      await this.client.set(cacheKey, serialized, "EX", options.ttl);
    } else {
      await this.client.set(cacheKey, serialized);
    }

    const tags = typeof options.tags === "string" ? [options.tags] : options.tags ?? [];
    for (const tag of tags) {
      await this.client.sadd(this.tagKey(tag), cacheKey);
    }
  }

  async forget(key: string): Promise<void> {
    await this.client.del(this.valueKey(key));
  }

  async forgetTag(tag: string): Promise<void> {
    const tagKey = this.tagKey(tag);
    const keys = await this.client.smembers(tagKey);
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
    await this.client.del(tagKey);
  }

  async forgetTags(tags: string[]): Promise<void> {
    for (const tag of tags) {
      await this.forgetTag(tag);
    }
  }

  async flush(): Promise<void> {
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [nextCursor, matched] = await this.client.scan(cursor, "MATCH", `${this.prefix}*`);
      keys.push(...matched);
      cursor = nextCursor;
    } while (cursor !== "0");

    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }

  private valueKey(key: string): string {
    return `${this.prefix}cache:${key}`;
  }

  private tagKey(tag: string): string {
    return `${this.prefix}tag:${tag}`;
  }
}
