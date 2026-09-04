import type { RedisClient } from "bun";
import type { CacheRememberOptions, CacheStore } from "./CacheStore.js";

export interface RedisCacheStoreOptions { prefix?: string; }
type RedisLike = Pick<RedisClient, "get" | "del" | "scan" | "send">;

// One script owns the value and both directions of its tag associations.
// Sorted tag members expire with their values; finite tag indexes expire at
// their last member's deadline. Multi-key scripts require standalone Redis.
const MUTATE = `
local base = ARGV[1]
local function remove(key)
  local meta = base .. 'cache-tags:' .. key
  for _, tag in ipairs(redis.call('SMEMBERS', meta)) do
    redis.call('ZREM', base .. 'tag:' .. tag, key)
  end
  redis.call('DEL', base .. 'cache:' .. key, meta)
end
local key = ARGV[3]
if ARGV[2] == 'tag' then
  local index = base .. 'tag:' .. key
  for _, member in ipairs(redis.call('ZRANGE', index, 0, -1)) do
    if redis.call('SISMEMBER', base .. 'cache-tags:' .. member, key) == 1 then remove(member) end
  end
  redis.call('DEL', index)
  return 1
end
remove(key)
if ARGV[2] == 'forget' then return 1 end
local value = base .. 'cache:' .. key
local meta = base .. 'cache-tags:' .. key
local ttl = tonumber(ARGV[5])
local time = redis.call('TIME')
local now = tonumber(time[1]) * 1000 + math.floor(tonumber(time[2]) / 1000)
local deadline = ttl > 0 and now + ttl or '+inf'
redis.call('SET', value, ARGV[4])
if ttl > 0 then redis.call('PEXPIRE', value, ttl) end
for i = 6, #ARGV do
  local tag = ARGV[i]
  local index = base .. 'tag:' .. tag
  redis.call('SADD', meta, tag)
  redis.call('ZREMRANGEBYSCORE', index, '-inf', now)
  redis.call('ZADD', index, deadline, key)
  local last = redis.call('ZREVRANGE', index, 0, 0, 'WITHSCORES')[2]
  if last == 'inf' then redis.call('PERSIST', index)
  else redis.call('PEXPIREAT', index, math.ceil(tonumber(last))) end
end
if ttl > 0 then redis.call('PEXPIRE', meta, ttl) end
return 1
`;

export class RedisCacheStore implements CacheStore {
  private readonly prefix: string;
  constructor(private readonly client: RedisLike, options: RedisCacheStoreOptions = {}) {
    this.prefix = options.prefix ?? "orm:";
  }

  async lookup<T = unknown>(key: string): Promise<{ hit: boolean; value: T | null }> {
    const value = await this.client.get(`${this.prefix}cache:${key}`);
    if (value === null) return { hit: false, value: null };
    try { return { hit: true, value: JSON.parse(value) as T }; }
    catch { return { hit: false, value: null }; }
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    return (await this.lookup<T>(key)).value;
  }

  private async mutate(operation: string, key: string, ...args: string[]): Promise<void> {
    await this.client.send("EVAL", [MUTATE, "0", this.prefix, operation, key, ...args]);
  }

  async set<T = unknown>(key: string, value: T, options: CacheRememberOptions = {}): Promise<void> {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new TypeError("Cache values must be JSON-serializable.");
    const tags = typeof options.tags === "string" ? [options.tags] : options.tags ?? [];
    await this.mutate("set", key, serialized, String(Math.max(0, Math.ceil((options.ttl ?? 0) * 1000))), ...new Set(tags));
  }

  async forget(key: string): Promise<void> { await this.mutate("forget", key); }
  async forgetTag(tag: string): Promise<void> { await this.mutate("tag", tag); }
  async forgetTags(tags: string[]): Promise<void> {
    for (const tag of tags) await this.forgetTag(tag);
  }

  async flush(): Promise<void> {
    let cursor = "0";
    do {
      const [next, keys] = await this.client.scan(cursor, "MATCH", `${this.prefix}*`);
      if (keys.length) await this.client.del(...keys);
      cursor = next;
    } while (cursor !== "0");
  }
}
