/**
 * Acceptance harness for the hydration/serialization work in the 3.0.0 plan (§6).
 *
 * It measures two things the pipeline benchmark does not:
 *
 *   1. CEILING — the model path expressed as a factor over native driver rows
 *      + JSON.stringify, measured end to end. This is a lower-work reference:
 *      it does not cast JSON, booleans or dates. Only model/rawJson outputs are
 *      equivalent. Both milliseconds and factors vary with machine/runtime.
 *
 *   2. CASTPLAN — per-row call counts for the cast machinery the profile named
 *      as the ORM's biggest cost (`assertSupportedStringCast` at 17.9% of self
 *      time, reached through `getCastDefinition`). These are per-class constants
 *      recomputed per attribute per row. The compiled-plan work (§6.3 P1-P3)
 *      should drive them toward zero; this is how you prove it did.
 *
 * Record with `bun run bench:record`. The old .baseline.txt used a different
 * protocol (sum of separate medians through Connection.query), not comparable.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Connection, Model } from "../src/index.js";

class PlanPost extends Model {
  static override table = "benchmark_plan_posts";
  static override casts = {
    views: "integer",
    score: "number",
    published: "boolean",
    metadata: "json",
  };
}

const ROWS = 20_000;
let consumed = 0;

function median(samples: number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

async function measure(callback: () => unknown | Promise<unknown>): Promise<number> {
  for (let index = 0; index < 3; index++) await callback();
  const samples: number[] = [];
  for (let index = 0; index < 9; index++) {
    const start = performance.now();
    const value: any = await callback();
    samples.push(performance.now() - start);
    consumed += typeof value === "string" ? value.length : Number(value?.length ?? 0);
  }
  return median(samples);
}

/** Count calls to instrumented ModelCore methods while the callback runs. */
async function countCastWork(callback: () => unknown | Promise<unknown>): Promise<Record<string, number>> {
  const targets = ["getCastDefinition", "castAttribute", "getAttributeFromTarget"];
  const counts: Record<string, number> = {};
  const originals: Record<string, any> = {};

  for (const name of targets) {
    let holder: any = PlanPost.prototype;
    while (holder && !Object.getOwnPropertyDescriptor(holder, name)) holder = Object.getPrototypeOf(holder);
    if (!holder) continue;
    counts[name] = 0;
    originals[name] = { holder, fn: holder[name] };
    holder[name] = function (this: any, ...args: any[]) {
      counts[name]!++;
      return originals[name].fn.apply(this, args);
    };
  }
  try {
    await callback();
  } finally {
    for (const name of Object.keys(originals)) {
      originals[name].holder[name] = originals[name].fn;
    }
  }
  return counts;
}

describe("Benchmark: hydration plan (3.0.0 §6)", () => {
  const connection = new Connection({ url: "sqlite://:memory:" });
  const columns = "id, title, body, author, views, score, published, metadata, created_at, updated_at";
  const rawSql = `SELECT ${columns} FROM benchmark_plan_posts ORDER BY id`;

  beforeAll(async () => {
    Model.setConnection(connection);
    await connection.run(`
      CREATE TABLE benchmark_plan_posts (
        id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, author TEXT NOT NULL,
        views INTEGER NOT NULL, score REAL NOT NULL, published INTEGER NOT NULL,
        metadata TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      )
    `);
    await connection.run(`
      WITH RECURSIVE sequence(value) AS (
        SELECT 1 UNION ALL SELECT value + 1 FROM sequence WHERE value < ${ROWS}
      )
      INSERT INTO benchmark_plan_posts
        (id, title, body, author, views, score, published, metadata, created_at, updated_at)
      SELECT value, 'Post ' || value, 'Body ' || value, 'Author ' || (value % 100),
             value * 3, value / 10.0, value % 2, '{"index":' || value || '}',
             '2026-01-02 03:04:05', '2026-01-03 04:05:06'
      FROM sequence
    `);
  });

  afterAll(async () => {
    expect(consumed).toBeGreaterThan(0);
    await connection.close();
  });

  test("model path as a factor over the raw-row ceiling", async () => {
    const rawRows = await connection.query(rawSql);
    expect(rawRows.length).toBe(ROWS);
    const expected = JSON.stringify((await PlanPost.query().orderBy("id").get()).toJSON());
    expect(JSON.stringify(await PlanPost.query().orderBy("id").rawJson())).toBe(expected);
    const first = JSON.parse(expected)[0];
    expect(first.metadata).toEqual({ index: 1 });
    expect(first.published).toBe(true);
    expect(first.created_at).toBe("2026-01-02T03:04:05.000Z");

    const driver = await measure(() => connection.driver.unsafe(rawSql));
    const stringify = await measure(() => JSON.stringify(rawRows));
    const ceiling = await measure(async () => JSON.stringify(await connection.driver.unsafe(rawSql)));

    const modelPath = await measure(async () =>
      JSON.stringify((await PlanPost.query().orderBy("id").get()).toJSON()));
    const rawJsonPath = await measure(async () =>
      JSON.stringify(await PlanPost.query().orderBy("id").rawJson()));

    console.log([
      `CEILING rows=${ROWS}`,
      `driver_ms=${driver.toFixed(4)}`,
      `stringify_ms=${stringify.toFixed(4)}`,
      `ceiling_ms=${ceiling.toFixed(4)}`,
      `model_ms=${modelPath.toFixed(4)}`,
      `rawJson_ms=${rawJsonPath.toFixed(4)}`,
      `model_factor=${(modelPath / ceiling).toFixed(2)}`,
      `rawJson_factor=${(rawJsonPath / ceiling).toFixed(2)}`,
    ].join(" "));

    // Guard rails, not performance targets. Compare saved runs on the same
    // runtime/machine; a factor alone can hide a slower native reference.
    expect(modelPath / ceiling).toBeLessThan(12);
    expect(rawJsonPath / ceiling).toBeLessThan(3);
  });

  test("per-row cast work during hydration and serialization", async () => {
    const query = () => PlanPost.query().orderBy("id");

    const hydrate = await countCastWork(async () => { await query().get(); });
    const hydrated = await query().get();
    const serialize = await countCastWork(() => { hydrated.toJSON(); });

    const line = (phase: string, counts: Record<string, number>) =>
      console.log([
        `CASTPLAN phase=${phase} rows=${ROWS}`,
        ...Object.entries(counts).map(([name, n]) => `${name}=${(n / ROWS).toFixed(2)}/row`),
      ].join(" "));

    line("get", hydrate);
    line("toJSON", serialize);

    // Diagnostic counts, not proof of equivalent behavior or zero validation.
    // Overrides/custom casts may still need these hooks after optimization.
    expect(Object.keys(hydrate).length).toBeGreaterThan(0);
    expect(Object.keys(serialize).length).toBeGreaterThan(0);
  });
});
