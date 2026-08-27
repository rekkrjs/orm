import { performance } from "node:perf_hooks";
import { test } from "bun:test";
import { Connection, Model } from "../src/index.js";
import { createDriverContext, postgresUrl } from "./driver-harness.js";

class FixedCostRow extends Model {
  static table = "fixed_cost_rows";
  static timestamps = false;
  static guarded: string[] = [];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function measureSync(fn: () => unknown, iterations = 100_000, rounds = 9): number {
  for (let i = 0; i < 1_000; i++) fn();
  const samples: number[] = [];
  for (let round = 0; round < rounds; round++) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) fn();
    samples.push((performance.now() - start) * 1_000 / iterations);
  }
  return median(samples);
}

async function measureAsync(fn: () => Promise<unknown>, iterations = 500, rounds = 9): Promise<number> {
  for (let i = 0; i < 100; i++) await fn();
  const samples: number[] = [];
  for (let round = 0; round < rounds; round++) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) await fn();
    samples.push((performance.now() - start) * 1_000 / iterations);
  }
  return median(samples);
}

const run = postgresUrl ? test.serial : test.skip;

run("Benchmark: PostgreSQL point-query fixed cost and prepare", async () => {
  const context = await createDriverContext("postgres");
  const prepared = new Connection({
    url: postgresUrl!,
    schema: context.namespace,
    max: 1,
    prepare: true,
  });

  try {
    await prepared.run(`SET search_path TO "${context.namespace}"`);
    await context.connection.run("CREATE TABLE fixed_cost_rows (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
    await context.connection.run("INSERT INTO fixed_cost_rows (id, value) VALUES ($1, $2)", [1, "ready"]);

    const builder = FixedCostRow.on(context.connection).where("id", 1).limit(1);
    const toSql = measureSync(() => builder.toSql());
    const statement = "SELECT id, value FROM fixed_cost_rows WHERE id = $1";
    const rawUnprepared = await measureAsync(() => context.connection.query(statement, [1]));
    const rawPrepared = await measureAsync(() => prepared.query(statement, [1]));
    const ormUnprepared = await measureAsync(
      () => FixedCostRow.on(context.connection).where("id", 1).first(),
      250,
    );
    const ormPrepared = await measureAsync(
      () => FixedCostRow.on(prepared).where("id", 1).first(),
      250,
    );

    console.log([
      "POSTGRES_FIXED",
      `toSql_us=${toSql.toFixed(3)}`,
      `raw_unprepared_us=${rawUnprepared.toFixed(3)}`,
      `raw_prepared_us=${rawPrepared.toFixed(3)}`,
      `orm_unprepared_us=${ormUnprepared.toFixed(3)}`,
      `orm_prepared_us=${ormPrepared.toFixed(3)}`,
      `compile_pct_rtt=${(toSql / rawUnprepared * 100).toFixed(2)}`,
      `prepare_raw_delta_pct=${((rawPrepared / rawUnprepared - 1) * 100).toFixed(2)}`,
      `prepare_orm_delta_pct=${((ormPrepared / ormUnprepared - 1) * 100).toFixed(2)}`,
    ].join(" "));
  } finally {
    await prepared.close().catch(() => null);
    await context.dispose();
  }
}, 30_000);
