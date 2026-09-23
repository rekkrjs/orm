import { afterAll, beforeAll, describe, expect, test } from "./harness.js";
import { PermissiveModel } from "./helpers.js";
import { Builder, Connection, Model, Schema } from "../src/index.js";
import { createDriverContext, postgresUrl, type DriverContext } from "./driver-harness.js";

const run = postgresUrl ? test.serial : test.skip;

class PostgresExactValue extends PermissiveModel {
  declare id: string;
  declare amount: string;
  static override table = "postgres_exact_values";
  static override timestamps = false;
  static override casts = { amount: "decimal:10" };
}

class PostgresNativeValue extends PermissiveModel {
  declare id: number;
  declare metadata: any;
  declare tags: any;
  declare active: boolean | null;
  declare day_value: Date | null;
  declare note: string | null;
  static override table = "postgres_native_values";
  static override timestamps = false;
  static override casts = {
    metadata: "json",
    tags: "json",
    active: "boolean",
    day_value: "date",
  };
}

class PostgresPageItem extends PermissiveModel {
  declare id: number;
  declare bucket: number;
  declare label: string;
  static override table = "postgres_page_items";
  static override timestamps = false;
}

describe.serial("PostgreSQL native contracts", () => {
  let context: DriverContext;

  beforeAll(async () => {
    if (!postgresUrl) return;
    context = await createDriverContext("postgres");
  });

  afterAll(async () => {
    await context?.dispose();
  });

  run("preserves BIGINT ids, NUMERIC casts, and exact numeric aggregates", async () => {
    const connection = context.connection;
    await Schema.create("postgres_exact_values", (table) => {
      table.bigIncrements("id");
      table.decimal("amount", 30, 10);
    }, connection);
    await connection.run(
      `ALTER TABLE ${connection.qualifyTable("postgres_exact_values")} ALTER COLUMN "id" RESTART WITH 9007199254740993`
    );

    const first = await PostgresExactValue.create({ amount: "12345678901234567890.1234567890" });
    const second = await PostgresExactValue.create({ amount: "1.8765432110" });

    expect(first.id).toBe("9007199254740993");
    expect(second.id).toBe("9007199254740994");
    expect(first.amount).toBe("12345678901234567890.1234567890");
    expect((await PostgresExactValue.find(first.id))?.amount).toBe("12345678901234567890.1234567890");
    expect(await PostgresExactValue.sum("amount")).toBe("12345678901234567892.0000000000");
    expect(await PostgresExactValue.avg("amount")).toBe("6172839450617283946.0000000000");
    expect(await PostgresExactValue.where("id", second.id).min("amount")).toBe("1.8765432110");
    expect(await PostgresExactValue.where("id", second.id).max("amount")).toBe("1.8765432110");

    const config = connection.getConfig();
    if (!("url" in config)) throw new Error("Expected URL-based PostgreSQL test connection.");
    const bigintConnection = new Connection({
      url: config.url,
      schema: context.namespace,
      bigint: true,
      max: 1,
    });
    try {
      const [row] = await bigintConnection.query("SELECT 9007199254740993::bigint AS exact_id");
      expect(row.exact_id).toBe(9007199254740993n);
    } finally {
      await bigintConnection.close();
    }
  });

  run("round-trips JSON/JSONB, nulls, booleans, dates, defaults, and nested dirty changes", async () => {
    const connection = context.connection;
    await Schema.create("postgres_native_values", (table) => {
      table.id();
      table.json("metadata").default({});
      table.jsonb("tags").default([]);
      table.boolean("active").nullable();
      table.date("day_value").nullable();
      table.string("note").nullable();
    }, connection);

    const created = await PostgresNativeValue.create({
      metadata: { exact_id: "9007199254740993", nested: { enabled: true } },
      tags: ["á", "β"],
      active: true,
      day_value: new Date("2026-08-19T00:00:00.000Z"),
      note: null,
    });
    const defaults = await PostgresNativeValue.create({ active: null, day_value: null, note: null });

    const raw = (await connection.query(
      `SELECT metadata, tags, active, day_value, note FROM ${connection.qualifyTable("postgres_native_values")} WHERE id = $1`,
      [created.id]
    ))[0];
    expect(raw.metadata).toEqual({ exact_id: "9007199254740993", nested: { enabled: true } });
    expect(raw.tags).toEqual(["á", "β"]);
    expect(raw.active).toBe(true);
    expect(raw.day_value).toBeInstanceOf(Date);
    expect(raw.note).toBeNull();

    const defaulted = await PostgresNativeValue.find(defaults.id);
    expect(defaulted!.metadata).toEqual({});
    expect(defaulted!.tags).toEqual([]);
    expect(defaulted!.active).toBeNull();
    expect(defaulted!.day_value).toBeNull();
    expect(await PostgresNativeValue.whereNull("note").count()).toBe(2);
    expect(await PostgresNativeValue.whereJsonContains("tags", "β").count()).toBe(1);
    expect(await PostgresNativeValue.whereJsonLength("tags", 2).count()).toBe(1);

    const found = await PostgresNativeValue.find(created.id);
    expect(found!.toJSON().metadata).toEqual(raw.metadata);
    found!.metadata.nested.enabled = false;
    expect(found!.isDirty()).toBe(true);
    await found!.save();
    expect((await PostgresNativeValue.find(created.id))!.metadata.nested.enabled).toBe(false);

    await PostgresNativeValue.insert({
      metadata: { bulk: true },
      tags: [],
      active: false,
      day_value: null,
      note: "bulk",
    });
    expect((await PostgresNativeValue.where("note", "bulk").first())!.active).toBe(false);
  });

  run("enforces and introspects indexes, unique constraints, and foreign keys", async () => {
    const connection = context.connection;
    await Schema.create("postgres_contract_parents", (table) => {
      table.id();
      table.string("name");
    }, connection);
    await Schema.create("postgres_contract_children", (table) => {
      table.id();
      table.foreignId("parent_id").nullable().constrained(
        "postgres_contract_parents",
        "id",
        "postgres_contract_children_parent_id_foreign"
      ).cascadeOnDelete();
      table.string("email").unique();
      table.string("code");
      table.decimal("amount", 30, 10);
      table.index(["parent_id", "email"], "postgres_children_parent_email_index");
      table.uniqueIndex(["parent_id", "code"], "postgres_children_parent_code_unique");
    }, connection);

    const parentId = await new Builder(connection, "postgres_contract_parents").insertGetId({ name: "parent" });
    await new Builder(connection, "postgres_contract_children").insert({
      parent_id: parentId,
      email: "one@example.test",
      code: "one",
      amount: "12345678901234567890.1234567890",
    });

    await expect(new Builder(connection, "postgres_contract_children").insert({
      parent_id: parentId,
      email: "one@example.test",
      code: "two",
      amount: "1.0000000000",
    })).rejects.toThrow();
    await expect(new Builder(connection, "postgres_contract_children").insert({
      parent_id: "999999999",
      email: "missing@example.test",
      code: "missing",
      amount: "1.0000000000",
    })).rejects.toThrow();

    const columns = await Schema.getColumns("postgres_contract_children", connection);
    expect(columns.find((column) => column.name === "amount")).toMatchObject({
      precision: 30,
      scale: 10,
      unsigned: false,
      nullable: false,
    });
    const indexes = await Schema.getIndexes("postgres_contract_children", connection);
    expect(indexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "postgres_contract_children_email_unique", columns: ["email"], unique: true }),
      expect.objectContaining({ name: "postgres_children_parent_email_index", columns: ["parent_id", "email"], unique: false }),
      expect.objectContaining({ name: "postgres_children_parent_code_unique", columns: ["parent_id", "code"], unique: true }),
    ]));
    const foreignKeys = await Schema.getForeignKeys("postgres_contract_children", connection);
    expect(foreignKeys).toContainEqual(expect.objectContaining({
      name: "postgres_contract_children_parent_id_foreign",
      columns: ["parent_id"],
      references: ["id"],
      onTable: "postgres_contract_parents",
      onDelete: "cascade",
    }));

    class PostgresContractChild extends PermissiveModel {
      static override table = "postgres_contract_children";
      static override timestamps = false;
    }
    const blueprint = await PostgresContractChild.schema().introspect().blueprint;
    expect(blueprint.columns.find((column) => column.name === "amount")).toMatchObject({
      type: "decimal",
      precision: 30,
      scale: 10,
    });
    expect(blueprint.columns.find((column) => column.name === "email")?.unique).toBe(true);
    expect(blueprint.indexes).toContainEqual(expect.objectContaining({ name: "postgres_children_parent_email_index" }));
    expect(blueprint.foreignKeys).toContainEqual(expect.objectContaining({
      name: "postgres_contract_children_parent_id_foreign",
    }));

    await new Builder(connection, "postgres_contract_parents").where("id", parentId).delete();
    expect(await new Builder(connection, "postgres_contract_children").count()).toBe(0);

    await Schema.table("postgres_contract_children", (table) => {
      table.dropUnique("postgres_contract_children_email_unique");
      table.dropIndex("postgres_children_parent_email_index");
      table.dropForeign("postgres_contract_children_parent_id_foreign");
    }, connection);
    expect(await Schema.hasIndex("postgres_contract_children", "postgres_contract_children_email_unique", connection)).toBe(false);
    expect(await Schema.hasIndex("postgres_contract_children", "postgres_children_parent_email_index", connection)).toBe(false);
    expect(await Schema.hasForeignKey("postgres_contract_children", ["parent_id"], connection)).toBe(false);
  });

  run("paginates stable duplicate sort keys and serializes concurrent upserts", async () => {
    const connection = context.connection;
    await Schema.create("postgres_page_items", (table) => {
      table.id();
      table.integer("bucket");
      table.string("label");
    }, connection);
    await PostgresPageItem.insert(Array.from({ length: 25 }, (_, index) => ({
      bucket: index % 3,
      label: `item-${index + 1}`,
    })));

    const page = await PostgresPageItem.orderBy("bucket").paginate(10, 2);
    expect(page.total).toBe(25);
    expect(page.data).toHaveLength(10);

    const first = await PostgresPageItem.orderBy("bucket").cursorPaginate(8);
    const second = await PostgresPageItem.orderBy("bucket").cursorPaginate(8, first.next_cursor);
    const firstIds = first.data.map((item) => String(item.id));
    const secondIds = second.data.map((item) => String(item.id));
    expect(new Set([...firstIds, ...secondIds]).size).toBe(16);

    await Schema.create("postgres_concurrent_values", (table) => {
      table.id();
      table.string("external_key").unique();
      table.integer("value");
    }, connection);
    const config = connection.getConfig();
    if (!("url" in config)) throw new Error("Expected URL-based PostgreSQL test connection.");
    const pooled = new Connection({ url: config.url, schema: context.namespace, max: 5 });
    const concurrentTable = pooled.qualifyTable("postgres_concurrent_values");
    try {
      await Promise.all(Array.from({ length: 24 }, (_, value) =>
        new Builder(pooled, concurrentTable).upsert(
          { external_key: "shared", value },
          "external_key",
          ["value"]
        )
      ));
      expect(await new Builder(pooled, concurrentTable).where("external_key", "shared").count()).toBe(1);
    } finally {
      await pooled.close();
    }
  });
});
