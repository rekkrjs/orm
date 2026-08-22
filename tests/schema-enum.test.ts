import { describe, expect, test } from "bun:test";
import { Blueprint, MySqlGrammar, PostgresGrammar, SQLiteGrammar, Schema } from "../src/index.js";
import { setupTestDb, teardownTestDb } from "./helpers.js";

function enumBlueprint(): Blueprint {
  const blueprint = new Blueprint("audiences");
  blueprint.enum("audience", ["teachers", "children's"]).default("teachers");
  return blueprint;
}

describe("enum schema definitions", () => {
  test("validates and freezes a copied value list", () => {
    const values = ["draft", "published"];
    const blueprint = new Blueprint("articles");
    blueprint.enum("state", values);
    values.push("archived");

    expect(blueprint.columns[0]!.values).toEqual(["draft", "published"]);
    expect(Object.isFrozen(blueprint.columns[0]!.values)).toBe(true);
    expect(() => new Blueprint("articles").enum("state", [])).toThrow(
      'Enum column "articles.state" requires at least one value.',
    );
    expect(() => (new Blueprint("articles").enum as any)("state", ["draft", 1])).toThrow(
      'Enum column "articles.state" values must all be strings.',
    );
    expect(() => new Blueprint("articles").enum("state", [""])).toThrow(
      'Enum column "articles.state" must not contain an empty value.',
    );
    expect(() => new Blueprint("articles").enum("state", ["x".repeat(256)])).toThrow(
      'Enum column "articles.state" values must not exceed 255 characters.',
    );
    expect(() => new Blueprint("articles").enum("state", ["😀".repeat(255)])).not.toThrow();
    expect(() => new Blueprint("articles").enum("state", ["draft\0published"])).toThrow(
      'Enum column "articles.state" must not contain NUL characters because PostgreSQL text cannot store them.',
    );
    expect(() => new Blueprint("articles").enum("state", ["draft "])).toThrow(
      'Enum column "articles.state" must not contain a value with trailing spaces because MySQL removes them.',
    );
    expect(() => new Blueprint("articles").enum("state", ["draft", "draft"])).toThrow(
      'Enum column "articles.state" contains duplicate value "draft".',
    );

    const nativeCollation = new Blueprint("articles");
    nativeCollation.enum("state", ["open", "OPEN"]);
    expect(nativeCollation.columns[0]!.values).toEqual(["open", "OPEN"]);
  });

  test("validates literal defaults after all column modifiers", () => {
    const valid = new Blueprint("articles");
    valid.enum("state", ["draft", "published"]).default("draft");
    expect(() => new SQLiteGrammar().compileCreate(valid, "articles")).not.toThrow();

    const nullable = new Blueprint("articles");
    nullable.enum("state", ["draft", "published"]).default(null).nullable();
    expect(() => new SQLiteGrammar().compileCreate(nullable, "articles")).not.toThrow();

    const required = new Blueprint("articles");
    required.enum("state", ["draft", "published"]).default(null);
    expect(() => new SQLiteGrammar().compileCreate(required, "articles")).toThrow(
      'Invalid enum default for "articles.state": NULL requires a nullable column.',
    );

    const invalid = new Blueprint("articles");
    invalid.enum("state", ["draft", "published"]);
    expect(() => invalid.default("archived")).toThrow(
      'Invalid enum default for "articles.state"',
    );
    expect(() => invalid.default(Schema.raw("CURRENT_USER"))).toThrow(
      'Invalid enum default for "articles.state"',
    );

    const objectDefault = new Blueprint("articles");
    objectDefault.enum("state", ["draft", "published"]);
    expect(() => objectDefault.default({ state: "draft" })).toThrow("an object value");

    const generated = new Blueprint("articles");
    expect(() => generated.enum("state", ["draft", "published"]).defaultUuid()).toThrow(
      'Invalid enum default for "articles.state"',
    );

    const tampered = new Blueprint("articles");
    tampered.enum("state", ["draft", "published"]);
    tampered.columns[0]!.defaultUuid = true;
    expect(() => new SQLiteGrammar().compileCreate(tampered, "articles")).toThrow(
      'Invalid enum default for "articles.state"',
    );

    const missingDefaultValues = new Blueprint("articles");
    missingDefaultValues.enum("state", ["draft"]);
    missingDefaultValues.columns[0]!.values = undefined;
    expect(() => missingDefaultValues.default("draft")).toThrow(
      'Enum column "articles.state" requires at least one value.',
    );

    const missingUuidValues = new Blueprint("articles");
    missingUuidValues.enum("state", ["draft"]);
    missingUuidValues.columns[0]!.values = undefined;
    expect(() => missingUuidValues.defaultUuid()).toThrow(
      'Enum column "articles.state" requires at least one value.',
    );
  });
});

describe("enum schema grammars", () => {
  test("quotes MySQL enum values with the shared literal renderer", () => {
    expect(new MySqlGrammar().compileCreate(enumBlueprint(), "audiences")).toBe(
      "CREATE TABLE `audiences` (\n" +
        "    `audience` ENUM('teachers', 'children''s') NOT NULL DEFAULT 'teachers'\n" +
        ")",
    );
  });

  test("renders MySQL enum backslashes independently of escape mode", () => {
    const blueprint = new Blueprint("paths");
    blueprint.enum("value", ["path\\new", "x\\' OR 1=1 #"]).default("path\\new");

    expect(new MySqlGrammar().compileCreate(blueprint, "paths")).toBe(
      "CREATE TABLE `paths` (\n" +
        "    `value` ENUM(X'706174685c6e6577', X'785c27204f5220313d312023') " +
        "CHARACTER SET utf8mb4 NOT NULL DEFAULT _utf8mb4 X'706174685c6e6577'\n" +
        ")",
    );
  });

  test("renders MySQL string and JSON defaults independently of escape mode", () => {
    const blueprint = new Blueprint("defaults");
    blueprint.string("path").default("path\\new");
    blueprint.json("payload").default({ path: "a\\b" });

    const sql = new MySqlGrammar().compileCreate(blueprint, "defaults");
    expect(sql).toContain("`path` VARCHAR(255) NOT NULL DEFAULT _utf8mb4 X'706174685c6e6577'");
    expect(sql).toContain(
      "`payload` JSON NOT NULL DEFAULT (CONVERT(X'7b2270617468223a22615c5c62227d' USING utf8mb4))",
    );
  });

  test("adds enforced SQLite and PostgreSQL checks", () => {
    expect(new SQLiteGrammar().compileCreate(enumBlueprint(), "audiences")).toBe(
      'CREATE TABLE "audiences" (\n' +
        '    "audience" TEXT NOT NULL DEFAULT \'teachers\' CHECK ("audience" IN (\'teachers\', \'children\'\'s\'))\n' +
        ")",
    );
    expect(new PostgresGrammar().compileCreate(enumBlueprint(), "audiences")).toBe(
      'CREATE TABLE "audiences" (\n' +
        '    "audience" VARCHAR(255) NOT NULL DEFAULT \'teachers\' CHECK ("audience" IN (\'teachers\', \'children\'\'s\'))\n' +
        ")",
    );
  });

  test("keeps nullable enum columns nullable while retaining their checks", () => {
    const blueprint = new Blueprint("articles");
    blueprint.enum("state", ["draft", "published"]).nullable();

    const sqlite = new SQLiteGrammar().compileCreate(blueprint, "articles");
    const postgres = new PostgresGrammar().compileCreate(blueprint, "articles");
    expect(sqlite).toContain('"state" TEXT CHECK ("state" IN (\'draft\', \'published\'))');
    expect(postgres).toContain('"state" VARCHAR(255) CHECK ("state" IN (\'draft\', \'published\'))');
    expect(sqlite).not.toContain('"state" TEXT NOT NULL');
    expect(postgres).not.toContain('"state" VARCHAR(255) NOT NULL');
  });

  test("rejects enum change operations on every grammar", () => {
    const blueprint = new Blueprint("articles");
    blueprint.enum("state", ["draft", "published"]);
    expect(() => blueprint.change()).toThrow("is not supported portably");

    const column = blueprint.columns[0]!;
    expect(() => new MySqlGrammar().compileChange("articles", column)).toThrow("is not supported portably");
    expect(() => new PostgresGrammar().compileChange("articles", column)).toThrow("is not supported portably");
    expect(() => new SQLiteGrammar().compileChange("articles", column)).toThrow("is not supported portably");
  });
});

describe("SQLite enum constraints", () => {
  test("enforces values, apostrophes, nullability, and required columns", async () => {
    const connection = setupTestDb();
    try {
      await Schema.create("enum_constraint_values", (table) => {
        table.increments("id");
        table.enum("required_value", ["teachers", "children's"]);
        table.enum("optional_value", ["yes", "no"]).nullable();
      });

      await connection.run(
        "INSERT INTO enum_constraint_values (required_value, optional_value) VALUES (?, ?)",
        ["children's", null],
      );
      expect(await connection.query(
        "SELECT required_value, optional_value FROM enum_constraint_values",
      )).toEqual([{ required_value: "children's", optional_value: null }]);

      await expect(connection.run(
        "INSERT INTO enum_constraint_values (required_value, optional_value) VALUES (?, ?)",
        ["students", "yes"],
      )).rejects.toThrow();
      await expect(connection.run(
        "INSERT INTO enum_constraint_values (required_value, optional_value) VALUES (?, ?)",
        [null, "yes"],
      )).rejects.toThrow();
    } finally {
      await teardownTestDb(connection);
    }
  });
});
