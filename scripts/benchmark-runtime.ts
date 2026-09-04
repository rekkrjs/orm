// Isolated runtime workloads; run sequentially, outside the concurrent test suite.
import { createHash } from "node:crypto";
import { cpus, platform, arch, release, totalmem } from "node:os";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { RedisClient } from "bun";
import assert from "node:assert/strict";

const source = resolve(process.env.BENCH_ORM_SOURCE ?? "src");
const { Connection, ConnectionManager, Model, DB, ObserverRegistry } = await import(`${source}/index.ts`) as typeof import("../src/index.js");
const { DatabaseQueueDriver, RedisQueueDriver } = await import(`${source}/queue/index.ts`);
const samples = 200, concurrency = 8, repetitions = 3;
const results: Record<string, unknown>[] = [];
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
async function sourceHash() {
  const files = Array.from(new Bun.Glob("**/*.ts").scanSync(source)).sort();
  const digest = createHash("sha256");
  for (const file of files) digest.update(file).update(await Bun.file(`${source}/${file}`).text());
  return digest.digest("hex");
}
function summary(times: number[], elapsed: number) {
  times.sort((a, b) => a - b);
  return { operations: times.length, elapsedMs: elapsed, operationsPerSecond: times.length * 1000 / elapsed,
    medianMs: times[Math.floor(times.length / 2)], p95Ms: times[Math.ceil(times.length * .95) - 1], p99Ms: times[Math.ceil(times.length * .99) - 1] };
}
async function measure(name: string, operation: (i: number) => Promise<unknown>, parallel = 1, count = samples) {
  const times: number[] = [];
  let next = 0;
  const start = performance.now();
  await Promise.all(Array.from({ length: parallel }, async () => {
    while (next < count) { const i = next++; const start = performance.now(); await operation(i); times.push(performance.now() - start); }
  }));
  return { name, concurrency: parallel, ...summary(times, performance.now() - start) };
}

if (process.argv.includes("--memory")) {
  const db = new Connection({ url: "sqlite://:memory:" });
  Model.setConnection(db);
  class Item extends Model { static table = "memory_items"; static timestamps = false; static casts = { value: "json", amount: "decimal:2", active: "boolean" }; }
  await db.run("CREATE TABLE memory_items (id integer PRIMARY KEY, value text, amount text, active integer)");
  await db.transaction(async () => { for (let i = 0; i < 2_000; i++) await db.run("INSERT INTO memory_items VALUES (?, ?, ?, ?)", [i, '{"items":[1,2,3]}', "123.45", 1]); });
  for (let i = 0; i < 5; i++) JSON.stringify(await Item.query().get());
  Bun.gc(true);
  const before = process.memoryUsage();
  let peakHeapUsed = before.heapUsed;
  const start = performance.now();
  for (let i = 0; i < 30; i++) { JSON.stringify(await Item.query().get()); peakHeapUsed = Math.max(peakHeapUsed, process.memoryUsage().heapUsed); }
  const elapsedMs = performance.now() - start;
  const gcStart = performance.now(); Bun.gc(true); const explicitGcMs = performance.now() - gcStart;
  console.log(JSON.stringify({ before, afterGc: process.memoryUsage(), peakHeapUsed, peakRssBytes: process.resourceUsage().maxRSS * 1024, elapsedMs, explicitGcMs, rows: 2_000, rounds: 30 }));
  await db.close();
  process.exit(0);
}

for (const [driver, url] of Object.entries({ sqlite: "sqlite://:memory:", postgres: process.env.POSTGRES_TEST_URL, mysql: process.env.MYSQL_TEST_URL })) {
  if (!url) throw new Error(`Missing ${driver} service URL; no benchmark skips allowed`);
  const db = new Connection({ url, max: 4 });
  const suffix = `${process.pid}`;
  const table = `bench_runtime_${suffix}`, jobs = `bench_jobs_${suffix}`, failed = `bench_failed_${suffix}`;
  const castTable = `bench_casts_${suffix}`, childTable = `bench_children_${suffix}`;
  Model.setConnection(db);
  ConnectionManager.add("bench", db);
  await ConnectionManager.setTenantResolver(() => ({ strategy: "database", name: "bench", config: { url } }));
  class Item extends Model { static table = table; static timestamps = false; static guarded: string[] = []; }
  class Child extends Model { static table = childTable; static timestamps = false; }
  class CastRow extends Model {
    static table = castTable; static timestamps = false;
    static casts = { amount: "decimal:2", metadata: "json", active: "boolean", created_at: "datetime" };
    details() { return this.hasMany(Child, "parent_id"); }
  }
  class OverrideRow extends CastRow { castAttribute(key: string, value: any) { return super.castAttribute(key, value); } }
  let observed = 0;
  const observer = { saved() { observed++; }, deleted() { observed++; } };
  try {
    const version = (await db.query(driver === "sqlite" ? "SELECT sqlite_version() AS version" : "SELECT version() AS version"))[0].version;
    await db.run(`CREATE TABLE ${table} (id integer PRIMARY KEY, value integer)`);
    await db.run(`INSERT INTO ${table} VALUES (0, 0)`);
    await db.run(`CREATE TABLE ${castTable} (id integer PRIMARY KEY, amount text, metadata text, active integer, created_at text)`);
    await db.run(`CREATE TABLE ${childTable} (id integer PRIMARY KEY, parent_id integer)`);
    await DB.table(castTable).insert(Array.from({ length: 25 }, (_, i) => ({ id: i, amount: "123.45", metadata: i % 2 ? '{"a":[1,2]}' : null, active: i % 2, created_at: "2026-01-02 03:04:05" })));
    await DB.table(childTable).insert(Array.from({ length: 50 }, (_, i) => ({ id: i, parent_id: i % 25 })));
    assert.deepEqual((await OverrideRow.query().orderBy("id").get()).toJSON(), (await CastRow.query().orderBy("id").get()).toJSON());
    assert.equal((await CastRow.query().with("details").first())!.details.length, 2);
    for (let i = 0; i < 30; i++) await DB.table(table).where("id", 0).get();
    const queue = new DatabaseQueueDriver(db, { table: jobs, failedTable: failed });
    await queue.migrate();
    for (let run = 1; run <= repetitions; run++) {
      const metrics = [];
      metrics.push(await measure("point", () => DB.table(table).where("id", 0).get()));
      metrics.push(await measure("tenant-point", () => DB.tenant("a", () => DB.table(table).where("id", 0).get())));
      metrics.push(await measure("tenant-transaction-point", () => DB.tenant("a", () => DB.transaction(() => DB.table(table).where("id", 0).get()))));
      metrics.push(await measure("pool-contention", () => DB.table(table).where("id", 0).get(), concurrency));
      for (const [name, query] of [
        ["heterogeneous-casts-25", () => CastRow.query().orderBy("id")],
        ["cast-override-25", () => OverrideRow.query().orderBy("id")],
        ["partial-casts-25", () => CastRow.query().select("id", "amount")],
        ["eager-casts-25", () => CastRow.query().with("details")],
      ] as const) metrics.push(await measure(name, async () => JSON.stringify(await query().get())));
      for (const withObserver of [false, true]) {
        if (withObserver) ObserverRegistry.register(Item, observer);
        metrics.push(await measure(`create-save-delete${withObserver ? "-observers" : ""}`, async i => {
          const item = await Item.create({ id: i + 1, value: 1 }); (item as any).value = 2; await item.save(); await item.delete();
        }));
        if (withObserver) ObserverRegistry.unregister(Item);
      }
      metrics.push(await measure("bulk-insert-update-delete-25", async () => {
        await DB.table(table).insert(Array.from({ length: 25 }, (_, i) => ({ id: i + 1, value: 1 })));
        await DB.table(table).where("id", ">", 0).update({ value: 2 });
        await DB.table(table).where("id", ">", 0).delete();
      }, 1, 30));
      for (let i = 0; i < samples; i++) await queue.dispatch("bench", "Job", '{"args":[]}', 0, 3);
      const seen = new Set();
      metrics.push(await measure("queue-reserve-complete", async () => {
        let job;
        while (!(job = await queue.reserve("bench", 60))) await Bun.sleep(1);
        if (seen.has(job.id)) throw new Error("Duplicate reservation"); seen.add(job.id);
        await queue.complete(job.id, job.reservationToken);
      }, concurrency));
      if (await queue.size("bench") !== 0 || seen.size !== samples) throw new Error("Queue benchmark lost jobs");
      results.push({ driver, serverVersion: version, poolMax: 4, run, metrics });
    }
    if (observed !== samples * 3 * repetitions) throw new Error(`Observer contract changed: ${observed}`);
  } finally {
    for (const name of [table, jobs, failed, castTable, childTable]) await db.run(`DROP TABLE IF EXISTS ${name}`);
    await ConnectionManager.closeAll(); await db.close();
  }
}
const redisUrl = process.env.REDIS_TEST_URL;
if (!redisUrl) throw new Error("REDIS_TEST_URL required");
const redis = new RedisClient(redisUrl), prefix = `bench_runtime_${crypto.randomUUID()}:`;
try {
  const driver = new RedisQueueDriver(redis, { prefix });
  const serverVersion = String(await redis.send("INFO", ["server"])).match(/redis_version:([^\r\n]+)/)?.[1];
  for (let run = 1; run <= repetitions; run++) {
    for (let i = 0; i < samples; i++) await driver.dispatch("bench", "Job", '{"args":[]}', 0, 3);
    const seen = new Set();
    const metric = await measure("queue-reserve-complete", async () => {
      const job = await driver.reserve("bench", 60);
      if (!job || seen.has(job.id)) throw new Error("Missing or duplicate Redis reservation"); seen.add(job.id);
      await driver.complete(job.id, job.reservationToken);
    }, concurrency);
    if (await driver.size("bench") !== 0) throw new Error("Redis jobs remain");
    results.push({ driver: "redis", serverVersion, run, metrics: [metric] });
  }
} finally {
  const keys = await redis.send("KEYS", [`${prefix}*`]) as string[];
  if (keys.length) await redis.send("DEL", keys);
  redis.close();
}
const memory = [];
for (let run = 0; run < repetitions; run++) {
  const child = Bun.spawn([process.execPath, import.meta.path, "--memory"], { stdout: "pipe", stderr: "pipe", env: process.env });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (code) throw new Error(err);
  memory.push(JSON.parse(out));
}
const git = (...args: string[]) => Bun.spawnSync(["git", ...args]).stdout.toString().trim();
const createdAt = new Date().toISOString();
const record = { protocol: "orm-runtime-v2", createdAt, sourceSha256: await sourceHash(), harnessSha256: hash(await Bun.file(import.meta.path).text()),
  sourceLabel: process.env.BENCH_SOURCE_LABEL ?? "worktree", commit: git("rev-parse", "HEAD"), dirtyPaths: git("status", "--porcelain"),
  bun: { version: Bun.version, revision: Bun.revision }, machine: { platform: platform(), arch: arch(), release: release(), cpu: cpus()[0]?.model, totalmem: totalmem() },
  samples, repetitions, results, memory };
await mkdir("benchmarks/runtime", { recursive: true });
const path = `benchmarks/runtime/${createdAt.replaceAll(":", "-")}-${record.sourceLabel}.json`;
await Bun.write(path, JSON.stringify(record, null, 2) + "\n");
console.log(path);
