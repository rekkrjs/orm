import { afterAll, beforeAll, describe, expect, test, evalCommand, ormModule, runProcess, sleep } from "./harness.js";
import { pathToFileURL } from "node:url";
import { resolveRedisClient } from "../src/queue/RedisQueueDriver.js";
import { Cache } from "../src/cache/Cache.js";
import { RedisCacheStore } from "../src/cache/RedisCacheStore.js";
import { RedisQueueDriver } from "../src/queue/RedisQueueDriver.js";

const redisUrl = process.env.REDIS_TEST_URL || process.env.REDIS_URL;
const runIfRedis = redisUrl ? test.serial : test.skip;
const prefix = `orm:test:${process.pid}:${Math.random().toString(36).slice(2)}:`;
let redis: ReturnType<typeof resolveRedisClient>;

async function clearPrefix(): Promise<void> {
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", `${prefix}*`);
    if (keys.length > 0) await redis.del(...keys);
    cursor = next;
  } while (cursor !== "0");
}

describe.serial("live Redis integration", () => {
  beforeAll(async () => {
    if (!redisUrl) return;
    redis = resolveRedisClient(redisUrl);
  });

  afterAll(async () => {
    if (!redis) return;
    await clearPrefix();
    await redis.close();
  });

  runIfRedis("stores TTL values and invalidates exact tags", async () => {
    const store = new RedisCacheStore(redis, { prefix });
    Cache.configure({ store, prefix: "app:" });

    let resolutions = 0;
    const first = await Cache.remember("profile", async () => ({ value: ++resolutions }), {
      ttl: 30,
      tags: ["users", "active"],
    });
    const second = await Cache.remember("profile", async () => ({ value: ++resolutions }), 30);

    expect(first).toEqual({ value: 1 });
    expect(second).toEqual({ value: 1 });
    expect(resolutions).toBe(1);
    const ttl = Number(await redis.send("TTL", [`${prefix}cache:app:profile`]));
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30);

    await Cache.set("other", { value: 2 }, { tags: ["other"] });
    await Cache.forgetTag("users");
    expect(await Cache.get("profile")).toBeNull();
    expect(await Cache.get<{ value: number }>("other")).toEqual({ value: 2 });
  });

  runIfRedis("handles named, delayed, retried, and concurrently reserved jobs", async () => {
    const driver = new RedisQueueDriver(redis, { prefix: `${prefix}queue:` });
    await driver.dispatch("emails", "Immediate", JSON.stringify({ args: ["a@example.test"] }), 0, 3);

    const reservations = await Promise.all([
      driver.reserve("emails", 90),
      driver.reserve("emails", 90),
    ]);
    const jobs = reservations.filter((job) => job !== null);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.jobClass).toBe("Immediate");

    await driver.release(jobs[0]!.id, jobs[0]!.reservationToken, 0);
    const retried = await driver.reserve("emails", 90);
    expect(retried?.attempts).toBe(2);
    await driver.complete(retried!.id, retried!.reservationToken);

    await driver.dispatch("reports", "Delayed", "{}", 1, 2);
    expect(await driver.reserve("reports", 90)).toBeNull();
    await sleep(1_100);
    const delayed = await driver.reserve("reports", 90);
    expect(delayed?.jobClass).toBe("Delayed");
    await driver.fail(delayed!.id, delayed!.reservationToken, "expected failure");

    const failed = await redis.send("LRANGE", [`${prefix}queue:failed`, "0", "-1"]) as string[];
    expect(JSON.parse(failed[0]).exception).toBe("expected failure");
    expect(await driver.size()).toBe(0);
  });
  runIfRedis("atomic tag replacement, expiration, null hits and invalidation races", async () => {
    const store = new RedisCacheStore(redis, { prefix: `${prefix}atomic:` });
    Cache.configure({ store });
    await Cache.set("null", null);
    expect(await Cache.remember("null", () => "wrong")).toBeNull();
    await store.set("replaced", 1, { tags: ["old", "second"] });
    await store.set("replaced", 2, { tags: "new" });
    await store.forgetTag("old");
    expect(await store.get<number>("replaced")).toBe(2);
    expect(await redis.send("EXISTS", [`${prefix}atomic:tag:second`])).toBe(0);
    await store.set("expires", 1, { ttl: 0.01, tags: "short" });
    await sleep(30);
    expect(await redis.send("EXISTS", [`${prefix}atomic:tag:short`, `${prefix}atomic:cache-tags:expires`])).toBe(0);
    for (let i = 0; i < 20; i++) {
      await Promise.all([store.set("racing", i, { tags: "race" }), store.forgetTag("race")]);
      // Whichever operation wins, a subsequent invalidation cannot miss a value.
      await store.forgetTag("race");
      expect(await store.get("racing")).toBeNull();
    }
    await store.flush();
  });

  runIfRedis("lets a process that used the default client exit, but not before a command settles", async () => {
    const script = `
      const { resolveRedisClient } = await import(${JSON.stringify(pathToFileURL(ormModule("src/queue/RedisQueueDriver.ts")).href)});
      const client = resolveRedisClient();
      await client.send("PING", []);
      // Floated, not awaited: nothing but the command itself may hold the process open.
      client.send("PING", []).then((reply) => console.log("settled", reply));
    `;
    const result = await runProcess(evalCommand(script), { env: { ...process.env, REDIS_URL: redisUrl }, timeoutMs: 10_000 });
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe("settled PONG");
    expect(result.exitCode).toBe(0);
  }, 15_000);

  runIfRedis("holds the process open until close() settles, on a used and on a never-used client", async () => {
    const script = `
      const { resolveRedisClient } = await import(${JSON.stringify(pathToFileURL(ormModule("src/queue/RedisQueueDriver.ts")).href)});
      const used = resolveRedisClient(${JSON.stringify(redisUrl)});
      await used.send("PING", []);
      await used.close();
      console.log("used closed");
      await resolveRedisClient(${JSON.stringify(redisUrl)}).close();
      console.log("idle closed");
    `;
    const result = await runProcess(evalCommand(script), { timeoutMs: 10_000 });
    expect(result.timedOut).toBe(false);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim().split("\n")).toEqual(["used closed", "idle closed"]);
    expect(result.exitCode).toBe(0);
  }, 15_000);
});
