import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PermissiveModel } from "./helpers.js";
import { Connection, Model, Schema, TypeMapper } from "../src/index.js";

class SqliteNativeValue extends PermissiveModel {
  static override table = "sq_contract_native_values";
  static override timestamps = false;
  static override casts = {
    metadata: "json",
    tags: "json",
    active: "boolean",
    day_value: "date",
  };
}

class SqliteExactText extends PermissiveModel {
  static override table = "sq_contract_exact_text";
  static override timestamps = false;
  static override primaryKey = "exact_id";
  static override incrementing = false;
  static override keyType = "string" as const;
  static override casts = { exact_id: "string", amount: "decimal:10" };
}

describe("SQLite storage contracts", () => {
  let connection: Connection;

  beforeAll(async () => {
    connection = new Connection({ url: "sqlite://:memory:" });
    Model.setConnection(connection);
    Schema.setConnection(connection);
    await Schema.create("sq_contract_native_values", (table) => {
      table.id();
      table.json("metadata").default({});
      table.json("tags").default([]);
      table.boolean("active").nullable();
      table.date("day_value").nullable();
      table.string("note").nullable();
    }, connection);
    await Schema.create("sq_contract_exact_text", (table) => {
      table.string("exact_id").primary();
      table.string("amount");
    }, connection);
  });

  afterAll(async () => {
    await connection.close();
  });

  test("serializes JSON defaults and round-trips JSON, nulls, booleans, and dates", async () => {
    const created = await SqliteNativeValue.create({
      metadata: { exact_id: "9007199254740993", nested: { enabled: true } },
      tags: ["á", "β"],
      active: true,
      day_value: new Date("2026-08-19T00:00:00.000Z"),
      note: null,
    });
    const defaults = await SqliteNativeValue.create({ active: null, day_value: null, note: null });

    const raw = (await connection.query(
      "SELECT metadata, tags, active, day_value, note FROM sq_contract_native_values WHERE id = ?",
      [created.id]
    ))[0];
    expect(raw.metadata).toBe('{"exact_id":"9007199254740993","nested":{"enabled":true}}');
    expect(raw.tags).toBe('["á","β"]');
    expect(raw.active).toBe(1);
    expect(raw.day_value).toBe("2026-08-19");
    expect(raw.note).toBeNull();

    const defaulted = await SqliteNativeValue.find(defaults.id);
    expect(defaulted!.metadata).toEqual({});
    expect(defaulted!.tags).toEqual([]);
    expect(defaulted!.active).toBeNull();
    expect(defaulted!.day_value).toBeNull();
    expect(await SqliteNativeValue.whereJsonContains("tags", "β").count()).toBe(1);
    expect(await SqliteNativeValue.whereJsonLength("tags", 2).count()).toBe(1);

    const found = await SqliteNativeValue.find(created.id);
    found!.metadata.nested.enabled = false;
    expect(found!.isDirty()).toBe(true);
    await found!.save();
    expect((await SqliteNativeValue.find(created.id))!.metadata.nested.enabled).toBe(false);
  });

  test("keeps arbitrary-size identifiers and decimals exact when stored as TEXT", async () => {
    const record = await SqliteExactText.create({
      exact_id: "9007199254740993",
      amount: "12345678901234567890.1234567890",
    });
    const found = await SqliteExactText.find("9007199254740993");

    expect(record.exact_id).toBe("9007199254740993");
    expect(found!.exact_id).toBe("9007199254740993");
    expect(found!.amount).toBe("12345678901234567890.1234567890");
  });

  test("type mapping describes SQLite's native numeric and text representations", () => {
    expect(TypeMapper.sqlToTsType("INTEGER", false, "sqlite")).toBe("number");
    expect(TypeMapper.sqlToTsType("REAL", true, "sqlite")).toBe("number | null");
    expect(TypeMapper.sqlToTsType("TEXT", false, "sqlite")).toBe("string");
  });
});
