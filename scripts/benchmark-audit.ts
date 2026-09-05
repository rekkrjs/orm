// Paired with an isolated source snapshot via BENCH_ORM_SOURCE; emits raw samples.
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { RedisClient } from "bun";

const source = resolve(process.env.BENCH_ORM_SOURCE ?? "src");
const { Connection, Model, Schema, Migrator } = await import(`${source}/index.ts`);
const { Validator } = await import(`${source}/validation/Validator.ts`);
const { RedisCacheStore } = await import(`${source}/cache/RedisCacheStore.ts`);
const results: Record<string, number[]> = {};
let consumed = 0;

async function measure(name: string, work: () => unknown | Promise<unknown>, prepare = async () => {}) {
  const samples: number[] = [];
  for (let round = -3; round < 9; round++) {
    await prepare();
    const start = performance.now();
    const result = await work();
    const elapsed = performance.now() - start;
    consumed += Number(result ?? 0);
    if (round >= 0) samples.push(elapsed);
  }
  results[name] = samples;
}

const db = new Connection({ url: "sqlite://:memory:" });
Model.setConnection(db);
Schema.setConnection(db);
class Row extends Model {
  static table = "audit_bench_rows";
  static guarded: string[] = [];
  static casts = { active: "boolean", metadata: "json" };
}
const row = { id: 1, name: "bench", active: 1, metadata: '{"items":[1,2,3]}', created_at: "2026-01-02 03:04:05", updated_at: "2026-01-03 04:05:06" };
try {
  for (const scoped of [false, true]) {
    const work = async () => {
      let total = 0;
      for (let i = 0; i < 20_000; i++) total += Row.hydrate(row).getAttribute("id");
      return total;
    };
    await measure(`hydrate-20000${scoped ? "-withoutTimestamps" : ""}`, () => scoped ? Row.withoutTimestamps(work) : work());
  }
  assert(Row.hydrate(row).getAttribute("created_at") instanceof Date);
  await Row.withoutTimestamps(async () => assert.equal(Row.hydrate(row).getAttribute("created_at"), row.created_at));

  const flat = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`field_${i}`, "hello"]));
  const flatSchema = Object.fromEntries(Object.keys(flat).map(key => [key, Validator.rule().required().string()]));
  const form = new FormData();
  for (const [key, value] of Object.entries(flat)) form.append(key, value);
  const nestedForm = new FormData();
  for (let i = 0; i < 10; i++) nestedForm.append(`items[${i}][name]`, "hello");
  const wildcardSchema = { "items.*.name": Validator.rule().required().string() };
  const nestedJson = { items: Array.from({ length: 100 }, () => ({ name: "hello" })) };
  for (const [name, input, schema, count] of [
    ["validate-json-10fields-x1000", flat, flatSchema, 1000],
    ["validate-form-10fields-x1000", form, flatSchema, 1000],
    ["validate-form-nested10-x1000", nestedForm, wildcardSchema, 1000],
    ["validate-wildcard100-x100", nestedJson, wildcardSchema, 100],
  ] as const) {
    assert(Object.keys(await Validator.make(input, schema).validate()).length > 0);
    await measure(name, async () => {
      for (let i = 0; i < count; i++) await Validator.make(input, schema).validate();
      return count;
    });
  }

  await Schema.create(Row.table, (table: any) => {
    table.increments("id"); table.string("name"); table.boolean("active"); table.text("metadata"); table.timestamps();
  });
  const records = Array.from({ length: 1000 }, () => ({ name: "bench", active: true, metadata: { items: [1, 2, 3] } }));
  for (const scoped of [false, true]) {
    const insert = async () => { await Row.insert(records); return records.length; };
    await measure(`sqlite-insert-1000${scoped ? "-withoutTimestamps" : ""}`, () => scoped ? Row.withoutTimestamps(insert) : insert(),
      () => db.run(`DELETE FROM ${Row.table}`));
    const [stored] = await db.query(`SELECT count(*) AS total, count(created_at) AS dated FROM ${Row.table}`);
    assert.equal(stored.total, 1000); assert.equal(stored.dated, scoped ? 0 : 1000);
  }
  await db.run(`DELETE FROM ${Row.table}`);
  await measure("sqlite-create-save-delete-x100", async () => {
    for (let i = 0; i < 100; i++) {
      const model = await Row.create(records[0]);
      model.setAttribute("name", "updated"); await model.save(); await model.delete();
    }
    return 100;
  });
  assert.equal((await db.query(`SELECT count(*) AS total FROM ${Row.table}`))[0].total, 0);

  const directory = resolve("tmp_agents", `bench_audit_migrations_${crypto.randomUUID()}`);
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(`${directory}/1_create.ts`, `import { Migration, Schema } from ${JSON.stringify(`${source}/index.ts`)};
export default class extends Migration {
  async up() { await Schema.create("audit_migration", t => t.integer("id")); }
  async down() { await Schema.drop("audit_migration"); }
}`);
    const migrator = new Migrator(db, directory, {}, { output() {} });
    await migrator.run();
    for (const method of ["fresh", "refresh"] as const) {
      await measure(`sqlite-migration-${method}-x10`, async () => {
        for (let i = 0; i < 10; i++) await migrator[method]();
        return 10;
      });
      assert(await Schema.hasTable("audit_migration", db));
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
} finally { await db.close(); }

assert(process.env.POSTGRES_TEST_URL && process.env.REDIS_TEST_URL, "PostgreSQL and Redis test URLs are required");
const pg = new Connection({ url: process.env.POSTGRES_TEST_URL, max: 1 });
let postgresVersion: string;
try {
  postgresVersion = (await pg.query("SELECT version() AS version"))[0].version;
  for (const nested of [false, true]) {
    const read = async (connection: any) => (await connection.query("SELECT current_setting('app.tenant_id') AS tenant"))[0].tenant;
    await measure(`postgres-withTenant${nested ? "-reentry" : ""}-x100`, async () => {
      for (let i = 0; i < 100; i++) {
        const tenant = await pg.withTenant("audit-bench", (connection: any) => nested ? connection.withTenant("audit-bench", read) : read(connection));
        assert.equal(tenant, "audit-bench");
      }
      return 100;
    });
  }
} finally { await pg.close(); }

const redis = new RedisClient(process.env.REDIS_TEST_URL);
const prefix = `audit_bench:${crypto.randomUUID()}:`;
const store = new RedisCacheStore(redis, { prefix });
const cacheKeys = Array.from({ length: 3000 }, (_, i) => `${prefix}cache:${i}`);
let redisVersion: string | undefined;
try {
  redisVersion = String(await redis.send("INFO", ["server"])).match(/redis_version:([^\r\n]+)/)?.[1];
  await measure("redis-flush-3000-cache-keys", async () => { await store.flush(); return cacheKeys.length; }, async () => {
    await redis.send("MSET", cacheKeys.flatMap(key => [key, "1"]));
  });
  assert.equal(Number(await redis.send("EXISTS", cacheKeys)), 0);
} finally { await redis.del(...cacheKeys); redis.close(); }

assert(consumed > 0);
console.log(JSON.stringify({ protocol: "audit-cost-v1", warmups: 3, samples: 9, postgresVersion, redisVersion, results }));
