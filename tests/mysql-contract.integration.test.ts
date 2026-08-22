import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PermissiveModel } from "./helpers.js";
import { Builder, Connection, Model, Schema } from "../src/index.js";
import { createDriverContext, mysqlUrl, type DriverContext } from "./driver-harness.js";

const run = mysqlUrl ? test.serial : test.skip;

class MysqlExactValue extends PermissiveModel {
  static override table = "mysql_exact_values";
  static override timestamps = false;
  static override casts = { amount: "decimal:10" };
}

class MysqlNativeValue extends PermissiveModel {
  static override table = "mysql_native_values";
  static override timestamps = false;
  static override casts = {
    payload: "json",
    active: "boolean",
    day_value: "date",
  };
}

class MysqlPageItem extends PermissiveModel {
  static override table = "mysql_page_items";
  static override timestamps = false;
}

describe.serial("MySQL native contracts", () => {
  let context: DriverContext;

  beforeAll(async () => {
    if (!mysqlUrl) return;
    context = await createDriverContext("mysql");
  });

  afterAll(async () => {
    await context?.dispose();
  });

  run("preserves BIGINT ids, DECIMAL casts, and exact numeric aggregates", async () => {
    const connection = context.connection;
    await Schema.create("mysql_exact_values", (table) => {
      table.bigIncrements("id");
      table.decimal("amount", 30, 10);
    }, connection);
    await connection.run("ALTER TABLE `mysql_exact_values` AUTO_INCREMENT = 9007199254740993");

    const first = await MysqlExactValue.create({ amount: "12345678901234567890.1234567890" });
    const second = await MysqlExactValue.create({ amount: "1.8765432110" });

    expect(first.id).toBe("9007199254740993");
    expect(second.id).toBe("9007199254740994");
    expect(first.amount).toBe("12345678901234567890.1234567890");
    expect((await MysqlExactValue.find(first.id))?.amount).toBe("12345678901234567890.1234567890");
    expect(await MysqlExactValue.sum("amount")).toBe("12345678901234567892.0000000000");
    expect(await MysqlExactValue.avg("amount")).toBe("6172839450617283946.00000000000000");
    expect(await MysqlExactValue.where("id", second.id).min("amount")).toBe("1.8765432110");
    expect(await MysqlExactValue.where("id", second.id).max("amount")).toBe("1.8765432110");

    const config = connection.getConfig();
    if (!("url" in config)) throw new Error("Expected URL-based MySQL test connection.");
    const bigintConnection = new Connection({ url: config.url, bigint: true, max: 1 });
    try {
      const [row] = await bigintConnection.query("SELECT CAST(9007199254740993 AS UNSIGNED) AS exact_id");
      expect(row.exact_id).toBe(9007199254740993n);
    } finally {
      await bigintConnection.close();
    }
  });

  run("round-trips JSON, nulls, booleans, dates, defaults, and nested dirty changes", async () => {
    const connection = context.connection;
    await Schema.create("mysql_native_values", (table) => {
      table.id();
      table.json("payload").default({});
      table.boolean("active").nullable();
      table.date("day_value").nullable();
      table.string("note").nullable();
    }, connection);

    const created = await MysqlNativeValue.create({
      payload: { labels: ["á", "β"], exact_id: "9007199254740993", nested: { enabled: true } },
      active: true,
      day_value: new Date("2026-08-19T00:00:00.000Z"),
      note: null,
    });
    const defaults = await MysqlNativeValue.create({ active: null, day_value: null, note: null });

    const raw = (await connection.query(
      "SELECT payload, active, day_value, note FROM `mysql_native_values` WHERE id = ?",
      [created.id]
    ))[0];
    expect(raw.payload).toEqual({
      labels: ["á", "β"],
      exact_id: "9007199254740993",
      nested: { enabled: true },
    });
    expect(raw.active).toBe(1);
    expect(raw.day_value).toBeInstanceOf(Date);
    expect(raw.note).toBeNull();

    const defaulted = await MysqlNativeValue.find(defaults.id);
    expect(defaulted!.payload).toEqual({});
    expect(defaulted!.active).toBeNull();
    expect(defaulted!.day_value).toBeNull();
    expect(await MysqlNativeValue.whereNull("note").count()).toBe(2);
    expect(await MysqlNativeValue.whereJsonContains("payload", { nested: { enabled: true } }).count()).toBe(1);
    expect(await MysqlNativeValue.whereJsonLength("payload", 3).count()).toBe(1);

    const found = await MysqlNativeValue.find(created.id);
    expect(found!.toJSON().payload).toEqual(raw.payload);
    found!.payload.nested.enabled = false;
    expect(found!.isDirty()).toBe(true);
    await found!.save();
    expect((await MysqlNativeValue.find(created.id))!.payload.nested.enabled).toBe(false);
  });

  run("enforces and introspects indexes, unique constraints, and foreign keys", async () => {
    const connection = context.connection;
    await Schema.create("mysql_contract_parents", (table) => {
      table.id();
      table.string("name");
    }, connection);
    await Schema.create("mysql_contract_children", (table) => {
      table.id();
      table.foreignId("parent_id").nullable().constrained(
        "mysql_contract_parents",
        "id",
        "mysql_contract_children_parent_id_foreign"
      ).cascadeOnDelete();
      table.string("email").unique();
      table.string("code");
      table.decimal("amount", 30, 10).unsigned();
      table.index(["parent_id", "email"], "mysql_children_parent_email_index");
      table.uniqueIndex(["parent_id", "code"], "mysql_children_parent_code_unique");
    }, connection);

    const parentId = await new Builder(connection, "mysql_contract_parents").insertGetId({ name: "parent" });
    await new Builder(connection, "mysql_contract_children").insert({
      parent_id: parentId,
      email: "one@example.test",
      code: "one",
      amount: "12345678901234567890.1234567890",
    });

    await expect(new Builder(connection, "mysql_contract_children").insert({
      parent_id: parentId,
      email: "one@example.test",
      code: "two",
      amount: "1.0000000000",
    })).rejects.toThrow();
    await expect(new Builder(connection, "mysql_contract_children").insert({
      parent_id: "999999999",
      email: "missing@example.test",
      code: "missing",
      amount: "1.0000000000",
    })).rejects.toThrow();

    const columns = await Schema.getColumns("mysql_contract_children", connection);
    const amount = columns.find((column) => column.name === "amount");
    expect(amount).toMatchObject({ precision: 30, scale: 10, unsigned: true, nullable: false });

    const indexes = await Schema.getIndexes("mysql_contract_children", connection);
    expect(indexes).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "mysql_contract_children_email_unique", columns: ["email"], unique: true }),
      expect.objectContaining({ name: "mysql_children_parent_email_index", columns: ["parent_id", "email"], unique: false }),
      expect.objectContaining({ name: "mysql_children_parent_code_unique", columns: ["parent_id", "code"], unique: true }),
    ]));
    const foreignKeys = await Schema.getForeignKeys("mysql_contract_children", connection);
    expect(foreignKeys).toContainEqual(expect.objectContaining({
      name: "mysql_contract_children_parent_id_foreign",
      columns: ["parent_id"],
      references: ["id"],
      onTable: "mysql_contract_parents",
      onDelete: "cascade",
    }));

    class MysqlContractChild extends PermissiveModel {
      static override table = "mysql_contract_children";
      static override timestamps = false;
    }
    const blueprint = await MysqlContractChild.schema().introspect().blueprint;
    expect(blueprint.columns.find((column) => column.name === "amount")).toMatchObject({
      type: "decimal",
      precision: 30,
      scale: 10,
      unsigned: true,
    });
    expect(blueprint.columns.find((column) => column.name === "email")?.unique).toBe(true);
    expect(blueprint.indexes).toContainEqual(expect.objectContaining({ name: "mysql_children_parent_email_index" }));
    expect(blueprint.foreignKeys).toContainEqual(expect.objectContaining({
      name: "mysql_contract_children_parent_id_foreign",
    }));

    await new Builder(connection, "mysql_contract_parents").where("id", parentId).delete();
    expect(await new Builder(connection, "mysql_contract_children").count()).toBe(0);

    await Schema.table("mysql_contract_children", (table) => {
      table.dropUnique("mysql_contract_children_email_unique");
      table.dropIndex("mysql_children_parent_email_index");
      table.dropForeign("mysql_contract_children_parent_id_foreign");
    }, connection);
    expect(await Schema.hasIndex("mysql_contract_children", "mysql_contract_children_email_unique", connection)).toBe(false);
    expect(await Schema.hasIndex("mysql_contract_children", "mysql_children_parent_email_index", connection)).toBe(false);
    expect(await Schema.hasForeignKey("mysql_contract_children", ["parent_id"], connection)).toBe(false);
  });

  run("round-trips enum and default backslashes with NO_BACKSLASH_ESCAPES", async () => {
    const connection = context.connection;
    const [session] = await connection.query("SELECT @@SESSION.sql_mode AS sql_mode");
    const [database] = await connection.query(
      "SELECT default_character_set_name AS charset, default_collation_name AS collation " +
        "FROM information_schema.schemata WHERE schema_name = DATABASE()",
    );
    if (!database) throw new Error("MySQL did not report the current database charset.");
    Connection.assertSafeIdentifier(database.charset, "database charset");
    Connection.assertSafeIdentifier(database.collation, "database collation");

    try {
      await connection.run(
        `ALTER DATABASE \`${context.namespace}\` CHARACTER SET latin1 COLLATE latin1_swedish_ci`,
      );
      await connection.run("SET SESSION sql_mode = 'NO_BACKSLASH_ESCAPES'");
      await Schema.create("mysql_enum_paths", (table) => {
        table.id();
        table.enum("value", ["é\\path", "x\\' OR 1=1 #"]).default("é\\path");
        table.string("path").default("é\\path");
        table.json("payload").default({ path: "é\\b" });
      }, connection);

      await connection.run("INSERT INTO `mysql_enum_paths` (`value`) VALUES (?)", ["x\\' OR 1=1 #"]);
      await connection.run("INSERT INTO `mysql_enum_paths` (`id`) VALUES (?)", [2]);

      expect(await connection.query("SELECT `value`, `path`, `payload` FROM `mysql_enum_paths` ORDER BY `id`"))
        .toEqual([
          { value: "x\\' OR 1=1 #", path: "é\\path", payload: { path: "é\\b" } },
          { value: "é\\path", path: "é\\path", payload: { path: "é\\b" } },
        ]);
    } finally {
      await connection.run("SET SESSION sql_mode = ?", [session?.sql_mode ?? ""]);
      await connection.run(
        `ALTER DATABASE \`${context.namespace}\` CHARACTER SET ${database.charset} COLLATE ${database.collation}`,
      );
    }
  });

  run("paginates stable duplicate sort keys and serializes concurrent upserts", async () => {
    const connection = context.connection;
    await Schema.create("mysql_page_items", (table) => {
      table.id();
      table.integer("bucket");
      table.string("label");
    }, connection);
    await MysqlPageItem.insert(Array.from({ length: 25 }, (_, index) => ({
      bucket: index % 3,
      label: `item-${index + 1}`,
    })));

    const page = await MysqlPageItem.orderBy("bucket").paginate(10, 2);
    expect(page.total).toBe(25);
    expect(page.data).toHaveLength(10);

    const first = await MysqlPageItem.orderBy("bucket").cursorPaginate(8);
    const second = await MysqlPageItem.orderBy("bucket").cursorPaginate(8, first.next_cursor);
    const firstIds = first.data.map((item) => String(item.id));
    const secondIds = second.data.map((item) => String(item.id));
    expect(new Set([...firstIds, ...secondIds]).size).toBe(16);

    await Schema.create("mysql_concurrent_values", (table) => {
      table.id();
      table.string("external_key").unique();
      table.integer("value");
    }, connection);
    const config = connection.getConfig();
    if (!("url" in config)) throw new Error("Expected URL-based MySQL test connection.");
    const pooled = new Connection({ url: config.url, max: 5 });
    try {
      await Promise.all(Array.from({ length: 24 }, (_, value) =>
        new Builder(pooled, "mysql_concurrent_values").upsert(
          { external_key: "shared", value },
          "external_key",
          ["value"]
        )
      ));
      expect(await new Builder(pooled, "mysql_concurrent_values").where("external_key", "shared").count()).toBe(1);
    } finally {
      await pooled.close();
    }
  });
});
