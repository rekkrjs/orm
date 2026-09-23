import { describe, expect, test, beforeEach } from "./harness.js";
import { Model, Schema, Connection, ConnectionManager } from "../src/index.js";
import { Search, SqliteFTS5Engine } from "../src/search/index.js";
import { setupTestDb } from "./helpers.js";

function freshEngine(opts: ConstructorParameters<typeof SqliteFTS5Engine>[0] = {}) {
  const conn = setupTestDb();
  return { conn, engine: new SqliteFTS5Engine({ connection: conn, ...opts }) };
}

describe("SqliteFTS5Engine — direct usage", () => {
  test("createIndex builds FTS5 virtual table, update inserts, search matches by token", async () => {
    const { engine, conn } = freshEngine();
    engine.configureIndex("posts_fts", {
      columns: ["title", "body"],
      unindexed: ["status"],
    });
    await engine.createIndex("posts_fts");

    await engine.update([
      { index: "posts_fts", id: 1, data: { title: "Rust ownership rules", body: "borrow checker", status: "published" } },
      { index: "posts_fts", id: 2, data: { title: "TypeScript generics", body: "variance", status: "draft" } },
      { index: "posts_fts", id: 3, data: { title: "Async Rust", body: "tokio runtime", status: "published" } },
    ]);

    const hits = await engine.search({
      index: "posts_fts",
      query: "rust",
      filters: [],
      sorts: [],
    });
    expect(hits.length).toBe(2);
    const ids = hits.map((h) => h.id).sort();
    expect(ids).toEqual([1, 3]);
  });

  test("filter on UNINDEXED column combines with MATCH", async () => {
    const { engine } = freshEngine();
    engine.configureIndex("posts_fts", { columns: ["title"], unindexed: ["status"] });
    await engine.createIndex("posts_fts");
    await engine.update([
      { index: "posts_fts", id: 1, data: { title: "Rust", status: "published" } },
      { index: "posts_fts", id: 2, data: { title: "Rust", status: "draft" } },
    ]);

    const hits = await engine.search({
      index: "posts_fts",
      query: "rust",
      filters: [{ kind: "cmp", bool: "and", field: "status", op: "=", value: "published" }],
      sorts: [],
    });
    expect(hits.map((h) => h.id)).toEqual([1]);
  });

  test("paginate returns total + page + perPage", async () => {
    const { engine } = freshEngine();
    engine.configureIndex("notes_fts", { columns: ["body"] });
    await engine.createIndex("notes_fts");
    for (let i = 1; i <= 5; i++) {
      await engine.update([{ index: "notes_fts", id: i, data: { body: `lorem ipsum ${i}` } }]);
    }
    const page = await engine.paginate(
      { index: "notes_fts", query: "lorem", filters: [], sorts: [] },
      2,
      2,
    );
    expect(page.total).toBe(5);
    expect(page.page).toBe(2);
    expect(page.perPage).toBe(2);
    expect(page.hits).toHaveLength(2);
  });

  test("facets compute distribution", async () => {
    const { engine } = freshEngine();
    engine.configureIndex("posts_fts", { columns: ["title"], unindexed: ["status"] });
    await engine.createIndex("posts_fts");
    await engine.update([
      { index: "posts_fts", id: 1, data: { title: "a", status: "published" } },
      { index: "posts_fts", id: 2, data: { title: "b", status: "published" } },
      { index: "posts_fts", id: 3, data: { title: "c", status: "draft" } },
    ]);
    const page = await engine.paginate(
      { index: "posts_fts", query: "", filters: [], sorts: [], facets: ["status"] },
      10,
      1,
    );
    expect(page.facetDistribution).toEqual({ status: { published: 2, draft: 1 } });
  });

  test("withScore exposes ranking score, minScore floors results", async () => {
    const { engine } = freshEngine();
    engine.configureIndex("posts_fts", { columns: ["body"] });
    await engine.createIndex("posts_fts");
    await engine.update([
      { index: "posts_fts", id: 1, data: { body: "rust rust rust" } },
      { index: "posts_fts", id: 2, data: { body: "mention of rust once" } },
    ]);
    const hits = await engine.search({
      index: "posts_fts",
      query: "rust",
      filters: [],
      sorts: [],
      showRankingScore: true,
    });
    expect(hits).toHaveLength(2);
    expect(typeof hits[0].score).toBe("number");
    expect(hits[0].score!).toBeGreaterThan(hits[1].score!);
  });

  test("delete removes rows by rowid", async () => {
    const { engine } = freshEngine();
    engine.configureIndex("posts_fts", { columns: ["title"] });
    await engine.createIndex("posts_fts");
    await engine.update([
      { index: "posts_fts", id: 1, data: { title: "a" } },
      { index: "posts_fts", id: 2, data: { title: "b" } },
    ]);
    await engine.delete([{ index: "posts_fts", id: 1, data: {} }]);
    const hits = await engine.search({ index: "posts_fts", query: "", filters: [], sorts: [] });
    expect(hits.map((h) => h.id)).toEqual([2]);
  });

  test("flush empties index but keeps table", async () => {
    const { engine } = freshEngine();
    engine.configureIndex("posts_fts", { columns: ["title"] });
    await engine.createIndex("posts_fts");
    await engine.update([{ index: "posts_fts", id: 1, data: { title: "x" } }]);
    await engine.flush("posts_fts");
    const hits = await engine.search({ index: "posts_fts", query: "", filters: [], sorts: [] });
    expect(hits).toHaveLength(0);
  });

  test("deleteIndex drops the virtual table", async () => {
    const { engine, conn } = freshEngine();
    engine.configureIndex("posts_fts", { columns: ["title"] });
    await engine.createIndex("posts_fts");
    await engine.deleteIndex("posts_fts");
    const tables = await conn.query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='posts_fts'`,
    );
    expect(tables).toHaveLength(0);
  });

  test("multiSearch fans out sequentially", async () => {
    const { engine } = freshEngine();
    engine.configureIndex("posts_fts", { columns: ["body"] });
    engine.configureIndex("articles_fts", { columns: ["body"] });
    await engine.createIndex("posts_fts");
    await engine.createIndex("articles_fts");
    await engine.update([{ index: "posts_fts", id: 1, data: { body: "rust" } }]);
    await engine.update([{ index: "articles_fts", id: 2, data: { body: "rust" } }]);
    const results = await engine.multiSearch([
      { index: "posts_fts", query: "rust", filters: [], sorts: [] },
      { index: "articles_fts", query: "rust", filters: [], sorts: [] },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0].hits[0].id).toBe(1);
    expect(results[1].hits[0].id).toBe(2);
  });
});

describe("SqliteFTS5Engine — trigger mode (same-DB)", () => {
  test("triggers keep FTS table in sync with source table", async () => {
    const conn = setupTestDb();
    await Schema.create("posts", (t) => {
      t.increments("id");
      t.string("title");
      t.text("body");
    });
    const engine = new SqliteFTS5Engine({ connection: conn, useTriggers: true });
    engine.configureIndex("posts_fts", {
      columns: ["title", "body"],
      contentTable: "posts",
      contentRowid: "id",
    });
    await engine.createIndex("posts_fts");

    // Raw SQL writes — triggers should fire.
    await conn.run(`INSERT INTO posts (title, body) VALUES (?, ?)`, ["Rust async", "tokio"]);
    await conn.run(`INSERT INTO posts (title, body) VALUES (?, ?)`, ["JS notes", "promises"]);

    const hits = await engine.search({ index: "posts_fts", query: "rust", filters: [], sorts: [] });
    expect(hits.map((h) => h.id)).toEqual([1]);

    // Update fires the AU trigger
    await conn.run(`UPDATE posts SET title = ? WHERE id = ?`, ["No more rust", 1]);
    const after = await engine.search({ index: "posts_fts", query: "rust", filters: [], sorts: [] });
    expect(after.map((h) => h.id)).toEqual([1]);   // still matches body

    // Delete fires the AD trigger
    await conn.run(`DELETE FROM posts WHERE id = ?`, [1]);
    const final = await engine.search({ index: "posts_fts", query: "rust", filters: [], sorts: [] });
    expect(final).toHaveLength(0);
  });

  test("useTriggers without contentTable throws", async () => {
    const conn = setupTestDb();
    const engine = new SqliteFTS5Engine({ connection: conn, useTriggers: true });
    engine.configureIndex("x_fts", { columns: ["a"] });
    await expect(engine.createIndex("x_fts")).rejects.toThrow(/contentTable/);
  });
});

describe("SqliteFTS5Engine — shared mode + Search integration", () => {
  test("shared:true reuses default connection", async () => {
    setupTestDb();
    const engine = new SqliteFTS5Engine({ shared: true });
    engine.configureIndex("posts_fts", { columns: ["title"] });
    await engine.createIndex("posts_fts");
    await engine.update([{ index: "posts_fts", id: 1, data: { title: "Hello" } }]);
    const hits = await engine.search({ index: "posts_fts", query: "hello", filters: [], sorts: [] });
    expect(hits).toHaveLength(1);
  });

  test("rejects non-sqlite drivers at use time", async () => {
    setupTestDb();
    const engine = new SqliteFTS5Engine({ shared: true });
    engine.configureIndex("x", { columns: ["a"] });
    // Simulate a non-sqlite driver by stubbing.
    const def = ConnectionManager.getDefault()!;
    const origGet = def.getDriverName.bind(def);
    (def as any).getDriverName = () => "postgres";
    await expect(engine.search({ index: "x", query: "", filters: [], sorts: [] })).rejects.toThrow(/SQLite/);
    (def as any).getDriverName = origGet;
  });

  test("end-to-end with Search.configure + model auto-index", async () => {
    setupTestDb();
    await Schema.create("docs", (t) => {
      t.increments("id");
      t.string("title");
      t.text("body");
      t.timestamps();
    });

    const engine = new SqliteFTS5Engine({ shared: true });
    engine.configureIndex("docs_fts", { columns: ["title", "body"] });
    await engine.createIndex("docs_fts");

    class _Doc extends Model.define<{ id: number; title: string; body: string }>("docs") {
      static fillable = ["title", "body"];
    }
    const Doc = Search.register(_Doc, {
      index: "docs_fts",
      toSearchableArray: (m: any) => ({ title: m.getAttribute("title"), body: m.getAttribute("body") }),
    });

    Search.reset();
    Search.configure({ engine });
    Search.register(_Doc, {
      index: "docs_fts",
      toSearchableArray: (m: any) => ({ title: m.getAttribute("title"), body: m.getAttribute("body") }),
    });

    await Doc.create({ title: "Hello Rust", body: "ownership" } as any);
    await Doc.create({ title: "TypeScript", body: "types" } as any);

    const hits = await (Doc as any).search("rust").get();
    expect(hits).toHaveLength(1);
    expect(hits[0].getAttribute("title")).toBe("Hello Rust");
  });
});
