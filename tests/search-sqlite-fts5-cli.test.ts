import { describe, expect, test, beforeEach } from "./harness.js";
import { Model, Schema, ConnectionManager } from "../src/index.js";
import { Search, SqliteFTS5Engine } from "../src/search/index.js";
import { setupTestDb } from "./helpers.js";

describe("SqliteFTS5Engine — optimize / rebuild / integrityCheck", () => {
  beforeEach(() => Search.reset());

  test("optimize emits the FTS5 optimize command", async () => {
    const conn = setupTestDb();
    const engine = new SqliteFTS5Engine({ connection: conn });
    engine.configureIndex("posts_fts", { columns: ["title"] });
    await engine.createIndex("posts_fts");
    await engine.update([{ index: "posts_fts", id: 1, data: { title: "a" } }]);
    await engine.update([{ index: "posts_fts", id: 2, data: { title: "b" } }]);
    await expect(engine.optimize("posts_fts")).resolves.toBeUndefined();
  });

  test("rebuild throws a clear error when contentTable is missing", async () => {
    const conn = setupTestDb();
    const engine = new SqliteFTS5Engine({ connection: conn });
    engine.configureIndex("posts_fts", { columns: ["title"] });
    await engine.createIndex("posts_fts");
    await expect(engine.rebuild("posts_fts")).rejects.toThrow(/contentTable/);
  });

  test("integrityCheck completes on a healthy index", async () => {
    const conn = setupTestDb();
    const engine = new SqliteFTS5Engine({ connection: conn });
    engine.configureIndex("posts_fts", { columns: ["title"] });
    await engine.createIndex("posts_fts");
    await engine.update([{ index: "posts_fts", id: 1, data: { title: "ok" } }]);
    await expect(engine.integrityCheck("posts_fts")).resolves.toBeUndefined();
  });

  test("optimize/rebuild reject non-SQLite engine connections", async () => {
    const conn = setupTestDb();
    const engine = new SqliteFTS5Engine({ connection: conn });
    engine.configureIndex("x", { columns: ["a"] });
    await engine.createIndex("x");
    (conn as any).getDriverName = () => "postgres";
    await expect(engine.optimize("x")).rejects.toThrow(/SQLite/);
    await expect(engine.rebuild("x")).rejects.toThrow(/SQLite/);
  });
});

describe("SqliteFTS5Engine.diagnostics()", () => {
  beforeEach(() => Search.reset());

  test("reports SQLite pragmas + per-index row counts", async () => {
    const conn = setupTestDb();
    const engine = new SqliteFTS5Engine({ connection: conn });
    engine.configureIndex("notes_fts", { columns: ["body"] });
    await engine.createIndex("notes_fts");
    for (let i = 1; i <= 3; i++) {
      await engine.update([{ index: "notes_fts", id: i, data: { body: `r${i}` } }]);
    }
    const d = await engine.diagnostics();
    expect(d.driver).toBe("sqlite");
    expect(typeof d.page_count).toBe("number");
    expect(typeof d.page_size).toBe("number");
    expect(typeof d.size_bytes).toBe("number");
    expect(d.indexes).toEqual(["notes_fts"]);
    expect((d.index_rows as any).notes_fts).toBe(3);
  });
});

describe("Search.register auto-discovery of `fts` config", () => {
  beforeEach(() => Search.reset());

  test("model.searchFtsConfig stores schema and engine picks it up via configureIndex", async () => {
    const conn = setupTestDb();
    await Schema.create("widgets", (t) => {
      t.increments("id");
      t.string("title");
      t.text("body");
      t.string("status");
      t.timestamps();
    });

    class _Widget extends Model.define<{ id: number; title: string; body: string; status: string }>("widgets") {
      static fillable = ["title", "body", "status"];
    }
    const Widget = Search.register(_Widget, {
      index: "widgets_fts",
      fts: {
        columns: ["title", "body"],
        unindexed: ["status"],
      },
      toSearchableArray: (m: any) => ({
        title: m.getAttribute("title"),
        body: m.getAttribute("body"),
        status: m.getAttribute("status"),
      }),
    });

    expect((Widget as any).searchFtsConfig).toEqual({ columns: ["title", "body"], unindexed: ["status"] });

    // Simulate what search:create-index does: pick up the schema, configure, create.
    const engine = new SqliteFTS5Engine({ connection: conn });
    Search.configure({ engine });
    Search.register(_Widget, {
      index: "widgets_fts",
      fts: { columns: ["title", "body"], unindexed: ["status"] },
      toSearchableArray: (m: any) => ({
        title: m.getAttribute("title"),
        body: m.getAttribute("body"),
        status: m.getAttribute("status"),
      }),
    });

    const ftsConfig = (Widget as any).searchFtsConfig;
    expect(engine.hasConfig("widgets_fts")).toBe(false);
    engine.configureIndex("widgets_fts", ftsConfig);
    expect(engine.hasConfig("widgets_fts")).toBe(true);
    await engine.createIndex("widgets_fts");

    await Widget.create({ title: "Hello Rust", body: "ownership", status: "published" } as any);
    const hits = await (Widget as any).search("rust").where("status", "published").get();
    expect(hits).toHaveLength(1);
  });
});
