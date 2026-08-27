import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Builder, Collection, Connection, Model, Schema } from "../src/index.js";
import { createRawJsonPlan, serializeRawJsonRow } from "../src/model/ModelJsonRow.js";

class FastJsonBenchUser extends Model {
  static table = "fast_json_bench_users";
  static timestamps = false;
  static casts = { active: "boolean" };
}

class GeneralJsonBenchUser extends FastJsonBenchUser {
  static hidden = ["unused"];
}

class HydratedJsonBenchUser extends Model {
  static table = "fast_json_bench_users";
  static timestamps = false;
  static casts = { active: "boolean" };
}

const rounds = 101;
let consumed = 0;

function median(samples: number[]): number {
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

async function measure(
  label: string,
  callback: () => Promise<unknown[]> | unknown[],
  warmups = 5,
): Promise<number> {
  for (let index = 0; index < warmups; index++) await callback();
  const samples: number[] = [];
  for (let index = 0; index < rounds; index++) {
    const start = performance.now();
    const value = await callback();
    samples.push(performance.now() - start);
    consumed += value.length + Number((value[0] as any)?.id ?? 0);
  }
  const value = median(samples);
  console.log(`${label}: ${value.toFixed(3)} ms`);
  return value;
}

function measureEncoding(label: string, value: unknown): number {
  const samples: number[] = [];
  for (let index = 0; index < rounds; index++) {
    const start = performance.now();
    const encoded = JSON.stringify(value);
    samples.push(performance.now() - start);
    consumed += encoded.length;
  }
  const result = median(samples);
  console.log(`${label}: ${result.toFixed(3)} ms`);
  return result;
}

describe("Benchmark: model query JSON", () => {
  const connection = new Connection({ url: "sqlite://:memory:" });

  beforeAll(async () => {
    Model.setConnection(connection);
    Schema.setConnection(connection);
    await Schema.create("fast_json_bench_users", (table) => {
      table.increments("id");
      table.string("name");
      table.boolean("active");
    });
    await new Builder(connection, "fast_json_bench_users").insert(
      Array.from({ length: 500 }, (_, index) => ({
        name: `User ${index.toString().padStart(3, "0")}`,
        active: index % 2,
      })),
    );
  });

  afterAll(async () => {
    expect(consumed).toBeGreaterThan(0);
    await connection.close();
  });

  test("compares raw rows, direct JSON, hydration, fallback, and encoding", async () => {
    const raw = async () => (await new Builder(connection, "fast_json_bench_users")
      .select("id", "name", "active")
      .orderBy("id")
      .get()).toArray();
    const direct = () => FastJsonBenchUser.select("id", "name", "active").orderBy("id").rawJson();
    const general = () => GeneralJsonBenchUser.select("id", "name", "active").orderBy("id").rawJson();
    const hydrated = async () => (await FastJsonBenchUser.select("id", "name", "active").orderBy("id").get()).toJSON();
    const fallback = () => HydratedJsonBenchUser.select("id", "name", "active").orderBy("id").json();

    const rawValue = await raw();
    const expected = rawValue.map((row) => ({ ...row, active: Boolean(row.active) }));
    const directValue = await direct();
    const generalValue = await general();
    const hydratedValue = await hydrated();
    const fallbackValue = await fallback();

    expect(directValue).toEqual(expected);
    expect(generalValue).toEqual(expected);
    expect(hydratedValue).toEqual(expected);
    expect(fallbackValue).toEqual(expected);
    expect(Object.getPrototypeOf(directValue)).toBe(Array.prototype);
    expect(directValue).not.toBeInstanceOf(Collection);

    console.log(`response bytes: ${JSON.stringify(rawValue).length}`);
    const compiledPlan = createRawJsonPlan(FastJsonBenchUser, Model);
    const generalPlan = createRawJsonPlan(GeneralJsonBenchUser, Model);
    await measure("serializeRawJsonRow() compiled casts", () =>
      rawValue.map((row) => serializeRawJsonRow(row, compiledPlan)), 100);
    await measure("serializeRawJsonRow() general serializer", () =>
      rawValue.map((row) => serializeRawJsonRow(row, generalPlan)), 100);
    await measure("DB.table().get().toArray()", raw);
    await measure("Model.rawJson() compiled casts", direct);
    await measure("Model.rawJson() general serializer", general);
    await measure("Model.get().toJSON()", hydrated);
    await measure("fallback Model.json()", fallback);
    measureEncoding("JSON.stringify(raw)", rawValue);
    measureEncoding("JSON.stringify(direct)", directValue);
    measureEncoding("JSON.stringify(hydrated)", hydratedValue);
    measureEncoding("JSON.stringify(fallback)", fallbackValue);
  });
});
