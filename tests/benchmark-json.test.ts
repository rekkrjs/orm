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

/** The shipped default: timestamps on, so two columns carry date casts. */
class TimestampedJsonBenchUser extends Model {
  static table = "fast_json_bench_users";
  static casts = { active: "boolean" };
}

/** Control for the row above: the same five columns, without the date casts. */
class UncastJsonBenchUser extends Model {
  static table = "fast_json_bench_users";
  static timestamps = false;
  static casts = { active: "boolean" };
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
      table.timestamps();
    });
    await new Builder(connection, "fast_json_bench_users").insert(
      Array.from({ length: 500 }, (_, index) => ({
        name: `User ${index.toString().padStart(3, "0")}`,
        active: index % 2,
        created_at: new Date(1700000000000 + index * 1000).toISOString(),
        updated_at: new Date(1700000000000 + index * 2000).toISOString(),
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
      .get()).toArray() as Array<{ id: number; name: string; active: number }>;
    const direct = () => FastJsonBenchUser.select("id", "name", "active").orderBy("id").rawJson();
    const general = () => GeneralJsonBenchUser.select("id", "name", "active").orderBy("id").rawJson();
    // SQLite returns date columns as strings; MySQL and PostgreSQL return Dates,
    // which is where this shape costs the most.
    const timestamped = () => TimestampedJsonBenchUser
      .select("id", "name", "active", "created_at", "updated_at").orderBy("id").rawJson();
    const uncast = () => UncastJsonBenchUser
      .select("id", "name", "active", "created_at", "updated_at").orderBy("id").rawJson();
    const rawFive = async () => (await new Builder(connection, "fast_json_bench_users")
      .select("id", "name", "active", "created_at", "updated_at")
      .orderBy("id")
      .get()).toArray() as Array<{ id: number; name: string; active: number; created_at: string; updated_at: string }>;
    const hydrated = async () => (await FastJsonBenchUser.select("id", "name", "active").orderBy("id").get()).toJSON();
    const fallback = () => HydratedJsonBenchUser.select("id", "name", "active").orderBy("id").json();

    const rawValue = await raw();
    const expected = rawValue.map((row) => ({ ...row, active: Boolean(row.active) }));
    const directValue = await direct();
    const generalValue = await general();
    const hydratedValue = await hydrated();
    const fallbackValue = await fallback();
    const timestampedValue = await timestamped();
    const uncastValue = await uncast();
    const expectedFive = (await rawFive()).map((row) => ({ ...row, active: Boolean(row.active) }));

    expect(directValue).toEqual(expected);
    expect(generalValue).toEqual(expected);
    expect(hydratedValue).toEqual(expected);
    expect(fallbackValue).toEqual(expected);
    // The stored timestamps are canonical ISO, so casting them changes nothing:
    // the five-column rows must match their uncast control exactly.
    expect(uncastValue).toEqual(expectedFive);
    expect(timestampedValue).toEqual(expectedFive);
    expect(Object.getPrototypeOf(directValue)).toBe(Array.prototype);
    expect(directValue).not.toBeInstanceOf(Collection);

    console.log(`response bytes: ${JSON.stringify(rawValue).length}`);
    const compiledPlan = createRawJsonPlan(FastJsonBenchUser, Model);
    const generalPlan = createRawJsonPlan(GeneralJsonBenchUser, Model);
    await measure("serializeRawJsonRow()", () =>
      rawValue.map((row) => serializeRawJsonRow(row, compiledPlan)), 100);
    await measure("serializeRawJsonRow() with hidden filtering", () =>
      rawValue.map((row) => serializeRawJsonRow(row, generalPlan)), 100);
    await measure("DB.table().get().toArray()", raw);
    await measure("Model.rawJson()", direct);
    await measure("Model.rawJson() with hidden filtering", general);
    await measure("Model.rawJson() 5 columns, no date casts", uncast);
    await measure("Model.rawJson() 5 columns with timestamps", timestamped);
    await measure("Model.get().toJSON()", hydrated);
    await measure("fallback Model.json()", fallback);
    measureEncoding("JSON.stringify(raw)", rawValue);
    measureEncoding("JSON.stringify(timestamped)", timestampedValue);
    measureEncoding("JSON.stringify(direct)", directValue);
    measureEncoding("JSON.stringify(hydrated)", hydratedValue);
    measureEncoding("JSON.stringify(fallback)", fallbackValue);
  });
});
