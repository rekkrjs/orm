import { afterEach, describe, expect, test } from "bun:test";
import {
  Blueprint,
  Builder,
  Schema,
  type FullTextOptions,
  type PostgresFullTextLanguage,
} from "../src/index.js";
import { MySqlGrammar as MySqlQueryGrammar } from "../src/query/grammars/MySqlGrammar.js";
import { PostgresGrammar as PostgresQueryGrammar } from "../src/query/grammars/PostgresGrammar.js";
import { MySqlGrammar as MySqlSchemaGrammar } from "../src/schema/grammars/MySqlGrammar.js";
import { PostgresGrammar as PostgresSchemaGrammar } from "../src/schema/grammars/PostgresGrammar.js";
import { SQLiteGrammar as SQLiteSchemaGrammar } from "../src/schema/grammars/SQLiteGrammar.js";
import { PermissiveModel, setupTestDb, teardownTestDb } from "./helpers.js";

const sqliteConnections: ReturnType<typeof setupTestDb>[] = [];

function sqlite() {
  const connection = setupTestDb();
  sqliteConnections.push(connection);
  return connection;
}

afterEach(async () => {
  await Promise.all(sqliteConnections.splice(0).map(teardownTestDb));
});

describe("Full-text query grammars", () => {
  test("MySQL compiles every supported Laravel mode and keeps the term bound", () => {
    const grammar = new MySqlQueryGrammar();
    const bind = () => "?";

    expect(grammar.compileFullText(["`title`", "`body`"], "secret", {}, bind)).toBe(
      "MATCH (`title`, `body`) AGAINST (? IN NATURAL LANGUAGE MODE)",
    );
    expect(grammar.compileFullText(["`body`"], "+bun -legacy", { mode: "boolean" }, bind)).toBe(
      "MATCH (`body`) AGAINST (? IN BOOLEAN MODE)",
    );
    expect(grammar.compileFullText(["`body`"], "database", { expanded: true }, bind)).toBe(
      "MATCH (`body`) AGAINST (? IN NATURAL LANGUAGE MODE WITH QUERY EXPANSION)",
    );
    expect(() => grammar.compileFullText(["`body`"], "x", { mode: "boolean", expanded: true }))
      .toThrow("cannot combine boolean mode with query expansion");
    for (const mode of ["phrase", "websearch", "raw"] as const) {
      expect(() => grammar.compileFullText(["`body`"], "x", { mode })).toThrow(`does not support ${mode} mode`);
    }
    expect(() => grammar.compileFullText(["`body`"], "x", { language: "english" }))
      .toThrow("does not support language or vector options");
  });

  test("PostgreSQL modes use one null-safe expression and the selected language", () => {
    const grammar = new PostgresQueryGrammar();
    const columns = ['"title"', '"body"'];
    const vector = "to_tsvector('spanish', coalesce(\"title\", '')) || to_tsvector('spanish', coalesce(\"body\", ''))";
    const functions = new Map<FullTextOptions["mode"], string>([
      [undefined, "plainto_tsquery"],
      ["phrase", "phraseto_tsquery"],
      ["websearch", "websearch_to_tsquery"],
      ["raw", "to_tsquery"],
    ]);

    for (const [mode, fn] of functions) {
      const options: FullTextOptions = { language: "spanish", ...(mode ? { mode } : {}) };
      expect(grammar.compileFullText(columns, "secreto", options, () => "$1")).toBe(
        `${vector} @@ ${fn}('spanish', $1)`,
      );
    }
    expect(grammar.compileFullText(['"search_vector"'], "bun", { vector: true }, () => "$1")).toBe(
      `"search_vector" @@ plainto_tsquery('english', $1)`,
    );
    expect(() => grammar.compileFullText(columns, "x", { mode: "boolean" })).toThrow("does not support boolean mode");
    expect(() => grammar.compileFullText(columns, "x", { expanded: true })).toThrow("query expansion");
  });

  test("Builder validates input, snapshots options, and preserves the legacy connector overload", () => {
    const connection = sqlite();
    const options: FullTextOptions = {};
    const query = new Builder(connection, "articles").whereFullText("body", "bun", options);
    (options as any).mode = "boolean";

    expect(query.toSql()).toContain(`"body" LIKE ? ESCAPE '\\'`);
    expect(query.bindings).toEqual(["%bun%"]);
    expect(new Builder(connection, "articles").whereFullText("body", "bun", "or", true).toSql())
      .toContain("WHERE NOT (");
    expect(() => new Builder(connection, "articles").whereFullText("body", "bun", "xor" as any))
      .toThrow("Invalid query boolean");
    expect(() => new Builder(connection, "articles").whereFullText([], "bun")).toThrow("at least one column");
    expect(() => new Builder(connection, "articles").whereFullText(["body", ""], "bun")).toThrow("non-empty strings");
    expect(() => new Builder(connection, "articles").whereFullText("body) OR 1=1 --" as any, "bun"))
      .toThrow("Invalid full-text column");
    expect(() => new Builder(connection, "articles").whereFullText("body", "   ")).toThrow("non-empty string");
    expect(() => new Builder(connection, "articles").whereFullText("body", "bun", { mode: "invalid" } as any))
      .toThrow("Invalid full-text mode");
    expect(() => new Builder(connection, "articles").whereFullText("body", "bun", { language: "klingon" } as any))
      .toThrow("Invalid PostgreSQL full-text language");
    expect(() => new Builder(connection, "articles").whereFullText("body", "bun", { surprise: true } as any))
      .toThrow("Unknown full-text option");
  });

  test("SQLite fallback treats wildcard characters literally and keeps OR grouping", async () => {
    const connection = sqlite();
    await Schema.create("articles", (table) => {
      table.id();
      table.string("title");
      table.text("body").nullable();
      table.boolean("published");
    }, connection);
    await new Builder(connection, "articles").insert([
      { title: "literal percent", body: "value 100% ready", published: true },
      { title: "literal underscore", body: "snake_case", published: true },
      { title: "literal slash", body: "c:\\temp", published: true },
      { title: "wildcard traps", body: "value 1000 ready snakeXcase c:temp", published: true },
      { title: "other column", body: null, published: false },
    ]);

    for (const [term, title] of [["100%", "literal percent"], ["snake_case", "literal underscore"], ["c:\\temp", "literal slash"]]) {
      const rows = await new Builder(connection, "articles").whereFullText("body", term).get();
      expect(rows.map((row: any) => row.title)).toEqual([title]);
    }
    const grouped = await new Builder(connection, "articles")
      .where("published", true)
      .whereFullText(["title", "body"], "other column")
      .get();
    expect(grouped).toHaveLength(0);
    const either = await new Builder(connection, "articles")
      .where("published", false)
      .orWhereFullText(["title", "body"], "snake_case")
      .orderBy("id")
      .get();
    expect(either.map((row: any) => row.title)).toEqual(["literal underscore", "other column"]);

    const compiled = new Builder(connection, "articles").whereFullText(["title", "body"], "x%_'\\");
    expect(compiled.toSql()).not.toContain("x%_");
    expect(compiled.bindings).toEqual(["%x\\%\\_'\\\\%", "%x\\%\\_'\\\\%"]);
    expect(() => new Builder(connection, "articles").whereFullText("body", "bun", { mode: "boolean" }).toSql())
      .toThrow("does not support full-text options");
  });
});

describe("Full-text Schema", () => {
  test("Blueprint creates Laravel-compatible definitions and a fluent language", () => {
    const blueprint = new Blueprint("articles");
    const fluent = blueprint.fullText(["title", "body"] as const).language("spanish");
    expect(fluent.language("english")).toBe(fluent);
    expect(blueprint.indexes).toEqual([{
      name: "articles_title_body_fulltext",
      columns: ["title", "body"],
      unique: false,
      type: "fulltext",
      language: "english",
    }]);

    const explicit = new Blueprint("articles");
    explicit.fullText("body", "articles_search_fulltext");
    expect(explicit.indexes[0]?.name).toBe("articles_search_fulltext");
  });

  test("native DDL uses the exact PostgreSQL query expression", () => {
    const blueprint = new Blueprint("articles");
    blueprint.fullText(["title", "body"]).language("spanish");
    const mysqlBlueprint = new Blueprint("articles");
    mysqlBlueprint.fullText(["title", "body"]);

    expect(new MySqlSchemaGrammar().compileIndexes(mysqlBlueprint, "articles")).toEqual([
      "ALTER TABLE `articles` ADD FULLTEXT INDEX `articles_title_body_fulltext` (`title`, `body`)",
    ]);
    const pgIndex = new PostgresSchemaGrammar().compileIndexes(blueprint, "catalog.articles")[0]!;
    const pgQuery = new PostgresQueryGrammar().compileFullText(
      ['"title"', '"body"'],
      "rekkr",
      { language: "spanish" },
      () => "$1",
    );
    const expression = pgQuery.split(" @@ ")[0]!;
    expect(pgIndex).toContain(`USING GIN ((${expression}))`);
    expect(() => new MySqlSchemaGrammar().compileIndexes(blueprint, "articles"))
      .toThrow("do not support language");
    expect(() => new SQLiteSchemaGrammar().compileIndexes(mysqlBlueprint, "articles"))
      .toThrow("Use the SqliteFTS5Engine");
  });

  test("automatic long names are deterministic, portable, and reversible by columns", () => {
    const table = "articles_with_an_extremely_descriptive_and_long_table_name";
    const columns = ["descriptive_title_column", "descriptive_body_column"] as const;
    const create = new Blueprint(table);
    create.fullText(columns);
    const name = create.indexes[0]!.name;
    const drop = new Blueprint(table);
    drop.dropFullText(columns);

    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(63);
    expect(name).toMatch(/_[0-9a-f]{8}_fulltext$/);
    expect(drop.commands[0]?.parameters?.name).toBe(name);
    expect(() => create.fullText([], "empty_columns")).toThrow("at least one column");
    expect(() => create.fullText(["title", "title"])).toThrow("must not contain duplicates");
    expect(() => create.fullText("unsafe-name")).toThrow("Invalid full-text column");
    expect(() => create.fullText("title", "unsafe-name")).toThrow("Invalid full-text index name");
    expect(() => create.fullText("title", `i${"x".repeat(63)}`)).toThrow("must not exceed 63 bytes");
    expect(() => create.fullText("title").language("klingon" as any)).toThrow("Invalid PostgreSQL full-text language");
  });

  test("SQLite rejects create/createIfNotExists before writing and drop before altering", async () => {
    const connection = sqlite();
    for (const [table, create] of [
      ["native_fts_create", Schema.create.bind(Schema)],
      ["native_fts_create_if", Schema.createIfNotExists.bind(Schema)],
    ] as const) {
      await expect(create(table, (blueprint) => {
        blueprint.text("body");
        blueprint.fullText("body");
      }, connection)).rejects.toThrow("not supported by SQLite");
      expect(await Schema.hasTable(table, connection)).toBe(false);
    }

    await Schema.create("existing_articles", (table) => {
      table.id();
      table.text("body");
      table.index("body", "existing_articles_body_index");
    }, connection);
    await expect(Schema.table("existing_articles", (table) => {
      table.string("should_not_exist");
      table.dropFullText(["body"]);
    }, connection)).rejects.toThrow("not supported by SQLite");
    expect(await Schema.hasColumn("existing_articles", "should_not_exist", connection)).toBe(false);
    expect((await Schema.getIndexes("existing_articles", connection)).find((index) => index.name === "existing_articles_body_index"))
      .toMatchObject({ columns: ["body"], type: "index" });
  });
});

describe("Full-text public types", () => {
  class Article extends PermissiveModel.define<{ id: number; title: string; body: string }>("typed_articles") {}

  test("static forwarding retains model types and readonly columns", () => {
    const language: PostgresFullTextLanguage = "spanish";
    const options: FullTextOptions = { language, mode: "websearch" };

    if (false) {
      const query = Article.whereFullText(["title", "body"] as const, "rekkr", options)
        .orWhereFullText("body", "orm", { mode: "phrase" });
      query.first().then((article) => article?.title.toUpperCase());
      // @ts-expect-error PostgreSQL languages are a closed Laravel-compatible union.
      Article.whereFullText("body", "rekkr", { language: "klingon" });
      // @ts-expect-error Unsupported option names are not part of the public API.
      Article.orWhereFullText("body", "rekkr", { ranking: true });
    }
    expect(options).toEqual({ language: "spanish", mode: "websearch" });
  });
});
