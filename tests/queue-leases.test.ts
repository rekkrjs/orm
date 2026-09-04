import { afterEach, expect, setSystemTime, test } from "bun:test";
import { RedisClient } from "bun";
import { Connection } from "../src/index.js";
import { DatabaseQueueDriver, RedisQueueDriver, type QueueDriver, Worker, DispatchableJob, registerJob } from "../src/queue/index.js";

afterEach(() => setSystemTime());
async function leaseContract(first: QueueDriver, second: QueueDriver) {
  setSystemTime(1_000_000);
  await first.dispatch("leases", "Work", '{"args":[]}', 0, 5);
  const old = (await first.reserve("leases", 10))!;
  setSystemTime(1_011_000);
  const current = (await second.reserve("leases", 10))!;
  expect(current.id).toBe(old.id);
  expect(current.reservationToken).not.toBe(old.reservationToken);
  expect(await first.complete(old.id, old.reservationToken)).toBe(false);
  expect(await first.release(old.id, old.reservationToken, 0)).toBe(false);
  expect(await first.fail(old.id, old.reservationToken, "stale failure")).toBe(false);
  expect(await first.heartbeat(old.id, old.reservationToken)).toBe(false);
  setSystemTime(1_019_000);
  expect(await second.heartbeat(current.id, current.reservationToken)).toBe(true);
  expect(await second.heartbeat(current.id, current.reservationToken)).toBe(true);
  setSystemTime(1_022_000);
  expect(await first.reserve("leases", 10)).toBeNull();
  expect(await second.complete(current.id, current.reservationToken)).toBe(true);
}

for (const [driver, url] of Object.entries({ sqlite: "sqlite://:memory:", postgres: process.env.POSTGRES_TEST_URL, mysql: process.env.MYSQL_TEST_URL })) {
  test.skipIf(!url)(`${driver}: stale reservations cannot mutate jobs; migration preserves pending work`, async () => {
    const connection = new Connection({ url: url! });
    const table = `lease_jobs_${process.pid}`;
    const failedTable = `lease_failed_${process.pid}`;
    const options = { table, failedTable };
    try {
      const first = new DatabaseQueueDriver(connection, options);
      await first.migrate();
      // Simulate an installed v2 table containing pending work.
      const g = connection.getGrammar();
      await connection.run(`ALTER TABLE ${g.wrap(table)} DROP COLUMN reservation_token`);
      await first.dispatch("pending", "Work", '{}', 0, 3);
      await first.migrate();
      expect((await first.reserve("pending", 10))?.jobClass).toBe("Work");
      await leaseContract(first, new DatabaseQueueDriver(connection, options));
      expect(await connection.query(`SELECT * FROM ${g.wrap(failedTable)}`)).toEqual([]);
    } finally {
      const g = connection.getGrammar();
      await connection.run(`DROP TABLE IF EXISTS ${g.wrap(table)}`);
      await connection.run(`DROP TABLE IF EXISTS ${g.wrap(failedTable)}`);
      await connection.close();
    }
  });
}

const redisUrl = process.env.REDIS_TEST_URL || process.env.REDIS_URL;
test.skipIf(!redisUrl)("Redis: stale reservations cannot mutate jobs", async () => {
  const client = new RedisClient(redisUrl!);
  const prefix = `orm_leases_${crypto.randomUUID()}:`;
  try {
    const first = new RedisQueueDriver(client, { prefix });
    await leaseContract(first, new RedisQueueDriver(client, { prefix }));
    expect(Number(await client.send("LLEN", [`${prefix}failed`]))).toBe(0);
  } finally {
    const keys = await client.send("KEYS", [`${prefix}*`]) as string[];
    if (keys.length) await client.send("DEL", keys);
    client.close();
  }
});

for (const loseLease of [false, true]) test(`worker stops heartbeat after ${loseLease ? "losing its lease" : "finishing"}`, async () => {
  let beats = 0;
  let complete = 0;
  let taken = false;
  class SlowLeaseJob extends DispatchableJob {
    async handle() { await Bun.sleep(90); worker.stop(); }
  }
  registerJob(SlowLeaseJob);
  const driver: QueueDriver = {
    async migrate() {}, async dispatch() {}, async size() { return 0; },
    async reserve() {
      if (taken) return null;
      taken = true;
      return { id: 1, reservationToken: "token", queue: "default", jobClass: SlowLeaseJob.name, payload: '{"args":[]}', attempts: 1, maxAttempts: 3, availableAt: 0, reservedAt: 0, createdAt: 0 };
    },
    async heartbeat(_, token) { expect(token).toBe("token"); beats++; return !loseLease; },
    async complete() { complete++; return true; }, async fail() { return false; }, async release() { return false; },
  };
  const worker = new Worker(driver, { retryAfterSeconds: 0.06 });
  await worker.run();
  if (loseLease) expect(beats).toBe(1);
  else expect(beats).toBeGreaterThan(1);
  expect(complete).toBe(loseLease ? 0 : 1);
  const count = beats;
  await Bun.sleep(45);
  expect(beats).toBe(count);
});
