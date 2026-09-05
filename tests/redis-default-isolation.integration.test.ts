import { expect, test } from "bun:test";
import { RedisClient } from "bun";
import { RedisCacheStore } from "../src/cache/RedisCacheStore.js";
import { RedisQueueDriver } from "../src/queue/RedisQueueDriver.js";
import { Queue } from "../src/queue/Queue.js";
import { resolveJob } from "../src/queue/Job.js";
import { MakeSearchableJob } from "../src/search/jobs/MakeSearchableJob.js";
import { Search, SqliteFTS5Engine } from "../src/search/index.js";
import { setupTestDb, teardownTestDb } from "./helpers.js";

const url = process.env.REDIS_TEST_URL || process.env.REDIS_URL;
const run = url ? test.serial : test.skip;

run("default Redis cache flush preserves queue leases, failures, delayed jobs and queued search", async () => {
  const redis = new RedisClient(url!);
  const db = setupTestDb();
  const name = `audit_${crypto.randomUUID()}`;
  const store = new RedisCacheStore(redis);
  const queue = new RedisQueueDriver(redis);
  const engine = new SqliteFTS5Engine({ connection: db });
  const foreign = [`orm:foreign:${name}`, `outside:${name}`, `orm:cache-other:${name}`];
  const ids: number[] = [];
  let failedEntry: string | undefined;
  await redis.connect();
  try {
    Queue.configure(queue);
    Search.configure({ engine });
    engine.configureIndex("audit_search", { columns: ["title"] });
    await engine.createIndex("audit_search");
    await store.set(name, "cached", { tags: name });
    for (const key of foreign) await redis.set(key, "survives");
    await queue.dispatch(name, "Reserved", "{}", 0, 3);
    const reserved = (await queue.reserve(name, 90))!;
    ids.push(reserved.id);
    await queue.dispatch(name, "Failed", "{}", 0, 3);
    const failed = (await queue.reserve(name, 90))!;
    ids.push(failed.id);
    await queue.fail(failed.id, failed.reservationToken, name);
    failedEntry = (await redis.send("LRANGE", ["orm:queue:failed", "0", "-1"])).find((entry: string) => JSON.parse(entry).exception === name);
    await queue.dispatch(name, "Delayed", "{}", 3600, 3);
    ids.push(Number(await redis.get("orm:queue:id")));
    await Queue.dispatch(new MakeSearchableJob({ index: "audit_search", id: 1, data: { title: "survivor" } }), { queue: name });
    ids.push(Number(await redis.get("orm:queue:id")));
    const size = await queue.size(name);

    await store.flush();
    expect(await store.get(name)).toBeNull();
    expect(await redis.send("EXISTS", [`orm:cache-tags:${name}`, `orm:tag:${name}`])).toBe(0);
    expect(await queue.size(name)).toBe(size);
    for (const key of foreign) expect(await redis.get(key)).toBe("survives");
    expect(await queue.heartbeat(reserved.id, reserved.reservationToken)).toBe(true);
    expect(await redis.send("LRANGE", ["orm:queue:failed", "0", "-1"])).toContain(failedEntry);
    const job = (await queue.reserve(name, 90))!;
    expect(job?.jobClass).toBe("MakeSearchableJob");
    const Job = resolveJob(job.jobClass)!;
    await new Job(...JSON.parse(job.payload).args).handle();
    expect(await queue.complete(job.id, job.reservationToken)).toBe(true);
    expect(await engine.search({ index: "audit_search", query: "survivor", filters: [], sorts: [] })).toHaveLength(1);

    await store.set(name, "still cached");
    await engine.flush("audit_search");
    await engine.deleteIndex("audit_search");
    expect(await store.get(name)).toBe("still cached");
    expect(await queue.heartbeat(reserved.id, reserved.reservationToken)).toBe(true);
    expect(await queue.complete(reserved.id, reserved.reservationToken)).toBe(true);
    expect(await store.get(name)).toBe("still cached");
    expect(await queue.reserve(name, 90)).toBeNull(); // delayed job remains delayed
    expect(await queue.size(name)).toBe(1);
  } finally {
    await store.forget(name);
    await store.forgetTag(name);
    await redis.del(...foreign, ...ids.map(id => `orm:queue:job:${id}`), `orm:queue:pending:${name}`, `orm:queue:reserved:${name}`, `orm:queue:delayed:${name}`);
    await redis.send("SREM", ["orm:queue:queues", name]);
    if (failedEntry) await redis.send("LREM", ["orm:queue:failed", "1", failedEntry]);
    Search.reset(); Queue.reset();
    redis.close();
    await teardownTestDb(db);
  }
});
