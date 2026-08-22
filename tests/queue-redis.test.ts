import { describe, it, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import { RedisClient } from "bun";
import { RedisQueueDriver } from "../src/queue/RedisQueueDriver.js";

// The driver drives every state transition through Lua, because Redis has no
// rollback and a job that is popped but not yet reserved is a lost job. Lua can
// only be exercised by a real server, so these tests need one — an in-process
// mock would just be re-testing a reimplementation of the scripts.
//
// Gated the same way as tests/redis.integration.test.ts: set REDIS_TEST_URL (or
// REDIS_URL) to a throwaway server to run them. Setting it is an explicit
// opt-in, so an unreachable server fails loudly rather than skipping silently.
const url = process.env.REDIS_TEST_URL || process.env.REDIS_URL;
let client: RedisClient | undefined;

beforeAll(async () => {
  if (!url) return;
  client = new RedisClient(url);
  await client.connect();
});

// A namespace of its own per run, so a suite can never sweep another's keys.
const prefix = `orm_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}:`;

async function flushNamespace(): Promise<void> {
  if (!client) return;
  const keys = (await client.send("KEYS", [`${prefix}*`])) as string[];
  if (keys.length > 0) await client.send("DEL", keys);
}

afterAll(async () => {
  if (!client) return;
  await flushNamespace();
  client.close();
});

describe.skipIf(!url)("RedisQueueDriver", () => {
  let driver: RedisQueueDriver;

  beforeEach(async () => {
    await flushNamespace();
    driver = new RedisQueueDriver(client!, { prefix });
  });

  it("migrate() is a no-op", async () => {
    await driver.migrate();
  });

  it("dispatches and reserves a job", async () => {
    await driver.dispatch("default", "SendEmail", JSON.stringify({ args: ["a@b.com"] }), 0, 3);
    const job = await driver.reserve("default", 90);
    expect(job).not.toBeNull();
    expect(job!.jobClass).toBe("SendEmail");
    expect(job!.queue).toBe("default");
    expect(job!.attempts).toBe(1);
    expect(JSON.parse(job!.payload).args).toEqual(["a@b.com"]);
  });

  it("returns null when queue empty", async () => {
    expect(await driver.reserve("default", 90)).toBeNull();
  });

  it("does not reserve same job twice", async () => {
    await driver.dispatch("default", "SendEmail", "{}", 0, 3);
    expect(await driver.reserve("default", 90)).not.toBeNull();
    expect(await driver.reserve("default", 90)).toBeNull();
  });

  it("complete() removes job data", async () => {
    await driver.dispatch("default", "SendEmail", "{}", 0, 3);
    const job = await driver.reserve("default", 90);
    await driver.complete(job!.id);
    expect(await driver.size("default")).toBe(0);
    expect(await client!.send("EXISTS", [`${prefix}job:${job!.id}`])).toBe(0);
    expect(await client!.send("ZCARD", [`${prefix}reserved:default`])).toBe(0);
  });

  it("fail() writes to failed list and removes job", async () => {
    await driver.dispatch("default", "SendEmail", "{}", 0, 3);
    const job = await driver.reserve("default", 90);
    await driver.fail(job!.id, "Error: SMTP timeout");

    const failed = (await client!.send("LRANGE", [`${prefix}failed`, "0", "-1"])) as string[];
    expect(failed).toHaveLength(1);
    const record = JSON.parse(failed[0]!);
    expect(record.jobClass).toBe("SendEmail");
    expect(record.queue).toBe("default");
    expect(record.exception).toBe("Error: SMTP timeout");
    expect(typeof record.failedAt).toBe("number");

    expect(await client!.send("EXISTS", [`${prefix}job:${job!.id}`])).toBe(0);
    expect(await client!.send("ZCARD", [`${prefix}reserved:default`])).toBe(0);
  });

  it("release() with no delay puts the job back on the pending list", async () => {
    await driver.dispatch("default", "SendEmail", "{}", 0, 3);
    const job = await driver.reserve("default", 90);
    await driver.release(job!.id, 0);

    expect(await client!.send("LLEN", [`${prefix}pending:default`])).toBe(1);
    expect(await client!.send("ZCARD", [`${prefix}reserved:default`])).toBe(0);

    const again = await driver.reserve("default", 90);
    expect(again!.id).toBe(job!.id);
    expect(again!.attempts).toBe(2);
  });

  it("release() with a delay goes to the delayed set", async () => {
    await driver.dispatch("default", "SendEmail", "{}", 0, 3);
    const job = await driver.reserve("default", 90);
    await driver.release(job!.id, 60);

    expect(await client!.send("ZCARD", [`${prefix}delayed:default`])).toBe(1);
    expect(await client!.send("LLEN", [`${prefix}pending:default`])).toBe(0);
    expect(await driver.reserve("default", 90)).toBeNull();
  });

  it("dispatch() with a delay goes to the delayed set, not pending", async () => {
    await driver.dispatch("default", "LazyJob", "{}", 60, 3);
    expect(await driver.size("default")).toBe(1);
    expect(await client!.send("LLEN", [`${prefix}pending:default`])).toBe(0);
    expect(await driver.reserve("default", 90)).toBeNull();
  });

  it("delayed jobs migrate to pending once they are due", async () => {
    await driver.dispatch("default", "ReadyJob", "{}", 60, 3);
    // Backdate the score so the job is due.
    const due = Math.floor(Date.now() / 1000) - 10;
    const [id] = (await client!.send("ZRANGE", [`${prefix}delayed:default`, "0", "-1"])) as string[];
    await client!.send("ZADD", [`${prefix}delayed:default`, String(due), id!]);

    const job = await driver.reserve("default", 90);
    expect(job).not.toBeNull();
    expect(job!.jobClass).toBe("ReadyJob");
    expect(await client!.send("ZCARD", [`${prefix}delayed:default`])).toBe(0);
  });

  it("timed-out reserved jobs get re-queued", async () => {
    await driver.dispatch("default", "StuckJob", "{}", 0, 3);
    const job = await driver.reserve("default", 90);

    const expired = Math.floor(Date.now() / 1000) - 200;
    await client!.send("ZADD", [`${prefix}reserved:default`, String(expired), String(job!.id)]);

    const reReserved = await driver.reserve("default", 90);
    expect(reReserved).not.toBeNull();
    expect(reReserved!.id).toBe(job!.id);
    expect(reReserved!.attempts).toBe(2);
  });

  it("respects named queues", async () => {
    await driver.dispatch("emails", "SendEmail", "{}", 0, 3);
    await driver.dispatch("reports", "GenReport", "{}", 0, 3);
    expect((await driver.reserve("emails", 90))?.jobClass).toBe("SendEmail");
    expect((await driver.reserve("reports", 90))?.jobClass).toBe("GenReport");
  });

  it("size() counts pending + delayed", async () => {
    await driver.dispatch("default", "A", "{}", 0, 3);
    await driver.dispatch("default", "B", "{}", 60, 3);
    expect(await driver.size("default")).toBe(2);
  });

  it("size() without a queue sums all queues", async () => {
    await driver.dispatch("a", "A", "{}", 0, 3);
    await driver.dispatch("b", "B", "{}", 0, 3);
    expect(await driver.size()).toBe(2);
  });

  it("stores custom maxAttempts", async () => {
    await driver.dispatch("default", "FragileJob", "{}", 0, 1);
    const job = await driver.reserve("default", 90);
    expect(job!.maxAttempts).toBe(1);
  });

  it("tracks queue names in the queues set", async () => {
    await driver.dispatch("critical", "A", "{}", 0, 3);
    expect(await client!.send("SMEMBERS", [`${prefix}queues`])).toContain("critical");
  });
});

describe.skipIf(!url)("RedisQueueDriver atomicity", () => {
  let driver: RedisQueueDriver;

  beforeEach(async () => {
    await flushNamespace();
    driver = new RedisQueueDriver(client!, { prefix });
  });

  it("dispatch publishes the hash and the listing together", async () => {
    await driver.dispatch("default", "SendEmail", "{}", 0, 3);
    // Before, HSET / SADD / RPUSH were three round trips: a crash in between
    // left a hash nothing referenced, or a listed id with no hash.
    const [id] = (await client!.send("LRANGE", [`${prefix}pending:default`, "0", "-1"])) as string[];
    expect(id).toBeDefined();
    expect(await client!.send("EXISTS", [`${prefix}job:${id}`])).toBe(1);
    expect(await client!.send("SMEMBERS", [`${prefix}queues`])).toContain("default");
  });

  it("a reserved job is always recoverable through its reservation", async () => {
    await driver.dispatch("default", "SendEmail", "{}", 0, 3);
    const job = await driver.reserve("default", 90);

    // The id is off the pending list, so the reservation is the only thing that
    // can bring it back. LPOP and ZADD must therefore land together.
    expect(await client!.send("LLEN", [`${prefix}pending:default`])).toBe(0);
    expect(await client!.send("ZSCORE", [`${prefix}reserved:default`, String(job!.id)])).not.toBeNull();
  });

  it("does not hand the same delayed job to two concurrent workers", async () => {
    await driver.dispatch("default", "SendEmail", "{}", 60, 3);
    const due = Math.floor(Date.now() / 1000) - 60;
    const [id] = (await client!.send("ZRANGE", [`${prefix}delayed:default`, "0", "-1"])) as string[];
    await client!.send("ZADD", [`${prefix}delayed:default`, String(due), id!]);

    const [a, b] = await Promise.all([
      driver.reserve("default", 90),
      driver.reserve("default", 90),
    ]);

    expect([a, b].filter((job) => job !== null)).toHaveLength(1);
    expect(await client!.send("LLEN", [`${prefix}pending:default`])).toBe(0);
  });

  it("does not requeue a timed-out job twice", async () => {
    await driver.dispatch("default", "SendEmail", "{}", 0, 3);
    expect(await driver.reserve("default", 90)).not.toBeNull();

    const [a, b] = await Promise.all([
      driver.reserve("default", 0),
      driver.reserve("default", 0),
    ]);

    expect([a, b].filter((job) => job !== null)).toHaveLength(1);
    expect(await client!.send("LLEN", [`${prefix}pending:default`])).toBe(0);
  });

  it("four concurrent workers reserve four distinct jobs, never the same one", async () => {
    for (let i = 0; i < 4; i++) await driver.dispatch("default", `Job${i}`, "{}", 0, 3);

    const claimed = await Promise.all(
      Array.from({ length: 4 }, () => driver.reserve("default", 90)),
    );

    const ids = claimed.map((job) => job?.id).filter((id) => id !== undefined);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });

  it("skips orphaned ids instead of reporting an empty queue", async () => {
    await driver.dispatch("default", "Ghost", "{}", 0, 3);
    await driver.dispatch("default", "Real", "{}", 0, 3);
    const [ghostId] = (await client!.send("LRANGE", [`${prefix}pending:default`, "0", "0"])) as string[];
    await client!.send("DEL", [`${prefix}job:${ghostId}`]);

    const job = await driver.reserve("default", 90);
    expect(job?.jobClass).toBe("Real");
  });

  it("release clears the reservation and republishes in one step", async () => {
    await driver.dispatch("default", "SendEmail", "{}", 0, 3);
    const job = await driver.reserve("default", 90);
    await driver.release(job!.id, 0);

    // Never both reserved and pending, and never neither.
    expect(await client!.send("ZCARD", [`${prefix}reserved:default`])).toBe(0);
    expect(await client!.send("LLEN", [`${prefix}pending:default`])).toBe(1);
  });

  it("release on a job that no longer exists is a no-op", async () => {
    await driver.dispatch("default", "SendEmail", "{}", 0, 3);
    const job = await driver.reserve("default", 90);
    await driver.complete(job!.id);
    await driver.release(job!.id, 0);

    expect(await client!.send("LLEN", [`${prefix}pending:default`])).toBe(0);
  });

  it("fail buries the job and clears its reservation together", async () => {
    await driver.dispatch("default", "SendEmail", "{}", 0, 3);
    const job = await driver.reserve("default", 90);
    await driver.fail(job!.id, "boom");

    expect(await client!.send("LLEN", [`${prefix}failed`])).toBe(1);
    expect(await client!.send("ZCARD", [`${prefix}reserved:default`])).toBe(0);
    expect(await client!.send("EXISTS", [`${prefix}job:${job!.id}`])).toBe(0);
  });
});
