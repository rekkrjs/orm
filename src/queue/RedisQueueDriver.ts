import { redis, RedisClient } from "bun";
import type { JobRecord, QueueDriver } from "./QueueDriver.js";

/**
 * The client surface the driver needs.
 *
 * `send` is what carries the Lua scripts below. Every state transition a job
 * goes through touches several keys — the job hash, the pending list, the
 * delayed and reserved sorted sets — and issuing those as separate commands
 * leaves windows where a crash strands the job in none of them. Redis has no
 * rollback, so a script (which the server runs to completion, atomically) is the
 * only way to make those transitions all-or-nothing.
 */
type RedisQueueLike = Pick<
  RedisClient,
  | "incr"
  | "llen"
  | "hgetall"
  | "zcard"
  | "smembers"
  | "send"
>;

export interface RedisQueueDriverOptions {
  prefix?: string;
}

/**
 * Client the Redis queue driver should talk to. Honours `queue.redis.url` when
 * present, otherwise falls back to Bun's default client (driven by `REDIS_URL`).
 */
export function resolveQueueRedisClient(url?: string): RedisQueueLike {
  return url ? new RedisClient(url) : redis;
}

interface StoredJob {
  reservationToken: string;
  queue: string;
  jobClass: string;
  payload: string;
  attempts: string;
  maxAttempts: string;
  availableAt: string;
  createdAt: string;
}

// ── Lua scripts ──────────────────────────────────────────────────────────────
// Multi-key scripts require a standalone Redis server; Redis Cluster is unsupported.

/**
 * Publish a job: write its hash, register the queue, and make it visible on
 * exactly one of the pending list or the delayed set.
 *
 * KEYS: job, queues, pending, delayed
 * ARGV: id, queue, jobClass, payload, maxAttempts, availableAt, createdAt, delayed
 */
const DISPATCH_LUA = `
redis.call('HSET', KEYS[1],
  'queue', ARGV[2], 'jobClass', ARGV[3], 'payload', ARGV[4],
  'attempts', 0, 'maxAttempts', ARGV[5], 'availableAt', ARGV[6], 'createdAt', ARGV[7])
redis.call('SADD', KEYS[2], ARGV[2])
if ARGV[8] == '1' then
  redis.call('ZADD', KEYS[4], ARGV[6], ARGV[1])
else
  redis.call('RPUSH', KEYS[3], ARGV[1])
end
return 1
`;

/**
 * Move every due delayed job, and every reservation past its visibility
 * timeout, onto the pending list. ZREM is the arbitration point: with two
 * workers scanning at once, only the one whose ZREM returns 1 may push, so the
 * id cannot land on the list twice and run in parallel.
 *
 * KEYS: source (delayed or reserved), pending
 * ARGV: cutoff score, push side ('r' = RPUSH, 'l' = LPUSH)
 */
const MIGRATE_LUA = `
local ids = redis.call('ZRANGEBYSCORE', KEYS[1], 0, ARGV[1])
local moved = 0
for _, id in ipairs(ids) do
  if redis.call('ZREM', KEYS[1], id) == 1 then
    if ARGV[2] == 'r' then
      redis.call('RPUSH', KEYS[2], id)
    else
      redis.call('HDEL', ARGV[3] .. id, 'reservationToken')
      redis.call('LPUSH', KEYS[2], id)
    end
    moved = moved + 1
  end
end
return moved
`;

/**
 * Claim the next job: pop it, bump its attempt counter and record the
 * reservation in one step, so a crash can never leave an id off the pending
 * list without a matching reservation to time out and redeliver it.
 *
 * Orphaned ids — a hash evicted or deleted behind the driver's back — are
 * skipped rather than returned, and are already off the list.
 *
 * KEYS: pending, reserved
 * ARGV: prefix for job keys, now
 * Returns: {} when the queue is empty, otherwise {id, attempts, flattened hash}
 */
const RESERVE_LUA = `
while true do
  local id = redis.call('LPOP', KEYS[1])
  if not id then return {} end
  local jobKey = ARGV[1] .. id
  local fields = redis.call('HGETALL', jobKey)
  if #fields > 0 then
    redis.call('HSET', jobKey, 'reservationToken', ARGV[3])
    local attempts = redis.call('HINCRBY', jobKey, 'attempts', 1)
    redis.call('ZADD', KEYS[2], ARGV[2], id)
    local result = {id, attempts}
    for i = 1, #fields do result[#result + 1] = fields[i] end
    return result
  end
end
`;

/**
 * Return a job to the queue: clear the reservation and republish it, either
 * immediately or after a delay.
 *
 * KEYS: job, reserved, pending, delayed
 * ARGV: id, availableAt, delayed
 */
const RELEASE_LUA = `
if redis.call('HGET', KEYS[1], 'reservationToken') ~= ARGV[4] then return 0 end
redis.call('HDEL', KEYS[1], 'reservationToken')
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('HSET', KEYS[1], 'availableAt', ARGV[2])
if ARGV[3] == '1' then
  redis.call('ZADD', KEYS[4], ARGV[2], ARGV[1])
else
  redis.call('LPUSH', KEYS[3], ARGV[1])
end
return 1
`;

/**
 * Acknowledge a finished job: drop the reservation and the hash together.
 *
 * KEYS: job, reserved
 * ARGV: id
 */
const COMPLETE_LUA = `
if redis.call('HGET', KEYS[1], 'reservationToken') ~= ARGV[2] then return 0 end
redis.call('ZREM', KEYS[2], ARGV[1])
return redis.call('DEL', KEYS[1])
`;

/**
 * Bury a job: record it on the failed list and remove it from the queue in one
 * step, so it can never be both failed and still reserved.
 *
 * KEYS: job, reserved, failed
 * ARGV: id, exception, failedAt
 */
const FAIL_LUA = `
if redis.call('HGET', KEYS[1], 'reservationToken') ~= ARGV[4] then return 0 end
local fields = redis.call('HGETALL', KEYS[1])
if #fields == 0 then return 0 end
local job = {}
for i = 1, #fields, 2 do job[fields[i]] = fields[i + 1] end
if not job['jobClass'] then return 0 end
redis.call('RPUSH', KEYS[3], cjson.encode({
  queue = job['queue'], jobClass = job['jobClass'], payload = job['payload'],
  exception = ARGV[2], failedAt = tonumber(ARGV[3]),
}))
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('DEL', KEYS[1])
return 1
`;

export class RedisQueueDriver implements QueueDriver {
  private prefix: string;

  constructor(private client: RedisQueueLike, options: RedisQueueDriverOptions = {}) {
    this.prefix = options.prefix ?? "orm:queue:";
  }

  // No DDL needed for Redis
  async migrate(): Promise<void> {}

  /** Runs a script; `keys` and `argv` are stringified for the wire protocol. */
  private eval(script: string, keys: string[], argv: (string | number)[]): Promise<any> {
    return this.client.send("EVAL", [
      script,
      String(keys.length),
      ...keys,
      ...argv.map(String),
    ]);
  }

  async dispatch(queue: string, jobClass: string, payload: string, delaySeconds: number, maxAttempts: number): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const availableAt = now + delaySeconds;
    const id = await this.client.incr(this.key("id"));

    await this.eval(
      DISPATCH_LUA,
      [this.jobKey(id), this.key("queues"), this.pendingKey(queue), this.delayedKey(queue)],
      [id, queue, jobClass, payload, maxAttempts, availableAt, now, delaySeconds > 0 ? 1 : 0],
    );
  }

  async reserve(queue: string, retryAfterSeconds: number): Promise<JobRecord | null> {
    const now = Math.floor(Date.now() / 1000);

    await this.migrateDelayed(queue, now);
    await this.requeueTimedOut(queue, now, retryAfterSeconds);

    const token = crypto.randomUUID();
    const result = (await this.eval(
      RESERVE_LUA,
      [this.pendingKey(queue), this.reservedKey(queue)],
      [this.jobKeyPrefix(), now, token],
    )) as unknown[] | null;

    if (!result || result.length === 0) return null;

    const id = Number(result[0]);
    const attempts = Number(result[1]);
    const fields = flattenedHashToObject(result.slice(2)) as unknown as StoredJob;
    if (!fields.jobClass) return null;

    return this.toJobRecord(id, { ...fields, reservationToken: token }, attempts);
  }

  async complete(id: number, token: string): Promise<boolean> {
    const fields = (await this.client.hgetall(this.jobKey(id))) as unknown as StoredJob | undefined;
    return Number(await this.eval(
      COMPLETE_LUA,
      [this.jobKey(id), this.reservedKey(fields?.queue ?? "default")],
      [id, token],
    )) > 0;
  }

  async fail(id: number, token: string, exception: string): Promise<boolean> {
    const fields = (await this.client.hgetall(this.jobKey(id))) as unknown as StoredJob | undefined;
    if (!fields?.jobClass) return false;

    return Number(await this.eval(
      FAIL_LUA,
      [this.jobKey(id), this.reservedKey(fields.queue), this.key("failed")],
      [id, exception, Math.floor(Date.now() / 1000), token],
    )) > 0;
  }

  async release(id: number, token: string, delaySeconds: number): Promise<boolean> {
    const fields = (await this.client.hgetall(this.jobKey(id))) as unknown as StoredJob | undefined;
    if (!fields?.queue) return false;

    const availableAt = Math.floor(Date.now() / 1000) + delaySeconds;
    return Number(await this.eval(
      RELEASE_LUA,
      [this.jobKey(id), this.reservedKey(fields.queue), this.pendingKey(fields.queue), this.delayedKey(fields.queue)],
      [id, availableAt, delaySeconds > 0 ? 1 : 0, token],
    )) > 0;
  }

  async heartbeat(id: number, token: string): Promise<boolean> {
    const fields = await this.client.hgetall(this.jobKey(id)) as unknown as StoredJob;
    if (!fields?.queue) return false;
    return Number(await this.eval(`
      if redis.call('HGET', KEYS[1], 'reservationToken') ~= ARGV[2] or not redis.call('ZSCORE', KEYS[2], ARGV[1]) then return 0 end
      redis.call('ZADD', KEYS[2], ARGV[3], ARGV[1])
      return 1`, [this.jobKey(id), this.reservedKey(fields.queue)], [id, token, Math.floor(Date.now() / 1000)])) > 0;
  }

  async size(queue?: string): Promise<number> {
    if (queue) {
      return this.queueSize(queue);
    }

    const queues = await this.client.smembers(this.key("queues"));
    let total = 0;
    for (const q of queues) {
      total += await this.queueSize(q);
    }
    return total;
  }

  private async queueSize(queue: string): Promise<number> {
    const pending = await this.client.llen(this.pendingKey(queue));
    const delayed = await this.client.zcard(this.delayedKey(queue));
    return pending + delayed;
  }

  private async migrateDelayed(queue: string, now: number): Promise<void> {
    await this.eval(MIGRATE_LUA, [this.delayedKey(queue), this.pendingKey(queue)], [now, "r"]);
  }

  private async requeueTimedOut(queue: string, now: number, retryAfterSeconds: number): Promise<void> {
    const cutoff = now - retryAfterSeconds;
    await this.eval(MIGRATE_LUA, [this.reservedKey(queue), this.pendingKey(queue)], [cutoff, "l", this.jobKeyPrefix()]);
  }

  private toJobRecord(id: number, fields: StoredJob, attempts: number): JobRecord {
    return {
      id,
      reservationToken: fields.reservationToken,
      queue: fields.queue,
      jobClass: fields.jobClass,
      payload: fields.payload,
      attempts,
      maxAttempts: parseInt(fields.maxAttempts, 10),
      availableAt: parseInt(fields.availableAt, 10),
      reservedAt: Math.floor(Date.now() / 1000),
      createdAt: parseInt(fields.createdAt, 10),
    };
  }

  private key(suffix: string): string {
    return `${this.prefix}${suffix}`;
  }

  private jobKeyPrefix(): string {
    return `${this.prefix}job:`;
  }

  private jobKey(id: number): string {
    return `${this.jobKeyPrefix()}${id}`;
  }

  private pendingKey(queue: string): string {
    return `${this.prefix}pending:${queue}`;
  }

  private delayedKey(queue: string): string {
    return `${this.prefix}delayed:${queue}`;
  }

  private reservedKey(queue: string): string {
    return `${this.prefix}reserved:${queue}`;
  }
}

/** HGETALL comes back as a flat [field, value, ...] array from a script. */
function flattenedHashToObject(flat: unknown[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < flat.length - 1; i += 2) {
    out[String(flat[i])] = String(flat[i + 1]);
  }
  return out;
}
