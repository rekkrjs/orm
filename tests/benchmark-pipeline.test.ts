import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Connection, Model } from "../src/index.js";
import { modelProxyHandler } from "../src/model/ModelBase.js";

class PipelinePost extends Model {
  static override table = "benchmark_pipeline_posts";
  static override casts = {
    views: "integer",
    score: "number",
    published: "boolean",
    metadata: "json",
  };
}

const sizes = [1, 25, 200, 20_000] as const;
let consumed = 0;

function median(samples: number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

async function measure(callback: () => unknown | Promise<unknown>, size: number): Promise<number> {
  const warmups = size === 20_000 ? 3 : 7;
  const rounds = size === 20_000 ? 9 : 31;
  for (let index = 0; index < warmups; index++) await callback();

  const samples: number[] = [];
  for (let index = 0; index < rounds; index++) {
    const start = performance.now();
    const value: any = await callback();
    samples.push(performance.now() - start);
    consumed += typeof value === "string" ? value.length : Number(value?.length ?? 0);
  }
  return median(samples);
}

async function countTraps(
  label: string,
  rows: number,
  callback: () => unknown | Promise<unknown>,
): Promise<void> {
  const original = modelProxyHandler.get!;
  const perProperty = new Map<string, number>();
  let total = 0;
  modelProxyHandler.get = function (target, property, receiver) {
    total++;
    if (typeof property === "string") {
      perProperty.set(property, (perProperty.get(property) ?? 0) + 1);
    }
    return original.call(this, target, property, receiver);
  };
  try {
    await callback();
  } finally {
    modelProxyHandler.get = original;
  }

  const top = [...perProperty]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 12)
    .map(([property, count]) => `${property}:${(count / rows).toFixed(2)}`)
    .join(",");
  console.log(`PIPELINE_TRAPS phase=${label} rows=${rows} total=${total} perRow=${(total / rows).toFixed(2)} top=${top}`);
}

describe("Benchmark: query to model JSON pipeline", () => {
  const connection = new Connection({ url: "sqlite://:memory:" });

  const modelQuery = (limit: number) => PipelinePost.query().orderBy("id").limit(limit);
  const rawSql = (limit: number) => `
    SELECT id, title, body, author, views, score, published, metadata, created_at, updated_at
    FROM benchmark_pipeline_posts ORDER BY id LIMIT ${limit}
  `;

  beforeAll(async () => {
    Model.setConnection(connection);
    await connection.run(`
      CREATE TABLE benchmark_pipeline_posts (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        author TEXT NOT NULL,
        views INTEGER NOT NULL,
        score REAL NOT NULL,
        published INTEGER NOT NULL,
        metadata TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    await connection.run(`
      WITH RECURSIVE sequence(value) AS (
        SELECT 1
        UNION ALL
        SELECT value + 1 FROM sequence WHERE value < 20000
      )
      INSERT INTO benchmark_pipeline_posts
        (id, title, body, author, views, score, published, metadata, created_at, updated_at)
      SELECT
        value,
        'Post ' || value,
        'Body ' || value,
        'Author ' || (value % 100),
        value * 3,
        value / 10.0,
        value % 2,
        '{"index":' || value || '}',
        '2026-01-02 03:04:05',
        '2026-01-03 04:05:06'
      FROM sequence
    `);
  });

  afterAll(async () => {
    expect(consumed).toBeGreaterThan(0);
    await connection.close();
  });

  test("prints median phase timings and proxy traps", async () => {
    const expected = (await modelQuery(200).get()).toJSON();
    expect(await modelQuery(200).rawJson()).toEqual(expected);

    for (const size of sizes) {
      const hydrated = await modelQuery(size).get();
      const direct = await modelQuery(size).rawJson();
      const driver = await measure(() => connection.query(rawSql(size)), size);
      const get = await measure(() => modelQuery(size).get(), size);
      const serialize = await measure(() => hydrated.toJSON(), size);
      const getJson = await measure(async () => (await modelQuery(size).get()).toJSON(), size);
      const rawJson = await measure(() => modelQuery(size).rawJson(), size);
      const stringify = await measure(() => JSON.stringify(direct), size);

      console.log([
        `PIPELINE rows=${size}`,
        `driver_ms=${driver.toFixed(4)}`,
        `get_ms=${get.toFixed(4)}`,
        `serialize_ms=${serialize.toFixed(4)}`,
        `getJson_ms=${getJson.toFixed(4)}`,
        `rawJson_ms=${rawJson.toFixed(4)}`,
        `stringify_ms=${stringify.toFixed(4)}`,
      ].join(" "));
    }

    const rows = 20_000;
    await countTraps("get", rows, () => modelQuery(rows).get());
    const hydrated = await modelQuery(rows).get();
    await countTraps("toJSON", rows, () => hydrated.toJSON());
  }, 30_000);
});
