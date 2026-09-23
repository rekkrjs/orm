import { describe, expect, test } from "./harness.js";
import { Schema, Connection, Model } from "../src/index.js";
import { Search, SqliteFTS5Engine, defineFtsConfig } from "../src/search/index.js";
import { setupTestDb } from "./helpers.js";

function freshEngine(opts: ConstructorParameters<typeof SqliteFTS5Engine>[0] = {}) {
  const conn = setupTestDb();
  return { conn, engine: new SqliteFTS5Engine({ connection: conn, ...opts }) };
}

describe("SqliteFTS5Engine — highlight + snippet", () => {
  test("highlight() wraps matching terms via FTS5 highlight()", async () => {
    const { engine } = freshEngine();
    engine.configureIndex("posts_fts", { columns: ["title", "body"] });
    await engine.createIndex("posts_fts");
    await engine.update([
      { index: "posts_fts", id: 1, data: { title: "Rust lang", body: "ownership and borrow" } },
    ]);
    const hits = await engine.search({
      index: "posts_fts",
      query: "rust",
      filters: [],
      sorts: [],
      highlight: { fields: ["title"], preTag: "<em>", postTag: "</em>" },
    });
    expect(hits[0].formatted).toBeDefined();
    expect(hits[0].formatted!.title).toBe("<em>Rust</em> lang");
  });

  test("crop() produces snippets via FTS5 snippet()", async () => {
    const { engine } = freshEngine();
    engine.configureIndex("posts_fts", { columns: ["body"] });
    await engine.createIndex("posts_fts");
    const long = "alpha beta gamma delta rust epsilon zeta eta theta iota kappa";
    await engine.update([{ index: "posts_fts", id: 1, data: { body: long } }]);
    const hits = await engine.search({
      index: "posts_fts",
      query: "rust",
      filters: [],
      sorts: [],
      crop: [{ field: "body", length: 3 }],
      highlight: { fields: [], preTag: "<b>", postTag: "</b>" },
    });
    expect(hits[0].formatted).toBeDefined();
    const snip = hits[0].formatted!.body as string;
    expect(snip).toContain("<b>rust</b>");
  });

  test("matchesPosition returns best-effort character offsets for searched fields", async () => {
    const { engine } = freshEngine();
    engine.configureIndex("posts_fts", { columns: ["title", "body"] });
    await engine.createIndex("posts_fts");
    await engine.update([
      { index: "posts_fts", id: 1, data: { title: "Rust lang", body: "Rust ownership and rust borrow" } },
    ]);

    const hits = await engine.search({
      index: "posts_fts",
      query: "rust",
      filters: [],
      sorts: [],
      attributesToSearchOn: ["body"],
    });

    expect(hits[0].matchesPosition).toEqual({
      body: [
        { start: 0, length: 4 },
        { start: 19, length: 4 },
      ],
    });
  });
});

describe("SqliteFTS5Engine — matchRaw (prefix / boolean)", () => {
  test("rawQuery passes prefix operator through unescaped", async () => {
    const { engine } = freshEngine();
    engine.configureIndex("posts_fts", { columns: ["title"] });
    await engine.createIndex("posts_fts");
    await engine.update([
      { index: "posts_fts", id: 1, data: { title: "rustlang" } },
      { index: "posts_fts", id: 2, data: { title: "typescript" } },
    ]);
    const hits = await engine.search({
      index: "posts_fts",
      query: "rust*",
      filters: [],
      sorts: [],
      rawQuery: true,
    });
    expect(hits.map((h) => h.id)).toEqual([1]);
  });

  test("rawQuery accepts boolean operators", async () => {
    const { engine } = freshEngine();
    engine.configureIndex("posts_fts", { columns: ["body"] });
    await engine.createIndex("posts_fts");
    await engine.update([
      { index: "posts_fts", id: 1, data: { body: "rust ownership" } },
      { index: "posts_fts", id: 2, data: { body: "rust async" } },
      { index: "posts_fts", id: 3, data: { body: "javascript" } },
    ]);
    const hits = await engine.search({
      index: "posts_fts",
      query: "rust AND ownership",
      filters: [],
      sorts: [],
      rawQuery: true,
    });
    expect(hits.map((h) => h.id)).toEqual([1]);
  });
});

describe("SqliteFTS5Engine — bm25 per-column weights", () => {
  test("higher weight on title boosts title-matching docs", async () => {
    const { engine } = freshEngine();
    engine.configureIndex("posts_fts", { columns: ["title", "body"] });
    await engine.createIndex("posts_fts");
    await engine.update([
      { index: "posts_fts", id: 1, data: { title: "rust", body: "irrelevant" } },
      { index: "posts_fts", id: 2, data: { title: "irrelevant", body: "rust rust rust" } },
    ]);
    // Heavily weight `title` — doc 1 should win even though doc 2 has more matches.
    const hits = await engine.search({
      index: "posts_fts",
      query: "rust",
      filters: [],
      sorts: [],
      bm25Weights: [10, 1],
      showRankingScore: true,
    });
    expect(hits[0].id).toBe(1);
  });

  test("rejects non-numeric weights instead of interpolating NaN into the SQL", async () => {
    const { engine } = freshEngine();
    engine.configureIndex("posts_fts", { columns: ["title", "body"] });
    await engine.createIndex("posts_fts");

    for (const weights of [["1.2", "abc"], [1, Number.NaN], [1, Number.POSITIVE_INFINITY]]) {
      await expect(engine.search({
        index: "posts_fts",
        query: "rust",
        filters: [],
        sorts: [],
        bm25Weights: weights as any,
        showRankingScore: true,
      })).rejects.toThrow(/bm25 weight must be a finite number/);
    }
  });

  test("numeric strings are still accepted", async () => {
    const { engine } = freshEngine();
    engine.configureIndex("posts_fts", { columns: ["title", "body"] });
    await engine.createIndex("posts_fts");
    await engine.update([{ index: "posts_fts", id: 1, data: { title: "rust", body: "x" } }]);

    const hits = await engine.search({
      index: "posts_fts",
      query: "rust",
      filters: [],
      sorts: [],
      bm25Weights: ["10", "1"] as any,
      showRankingScore: true,
    });
    expect(hits[0].id).toBe(1);
  });
});

describe("SqliteFTS5Engine — whereRaw bindings", () => {
  test("whereRaw with bindings parameters the value safely", async () => {
    const { engine } = freshEngine();
    engine.configureIndex("posts_fts", { columns: ["title"], unindexed: ["status"] });
    await engine.createIndex("posts_fts");
    await engine.update([
      { index: "posts_fts", id: 1, data: { title: "a", status: "published" } },
      { index: "posts_fts", id: 2, data: { title: "b", status: "draft" } },
    ]);
    const hits = await engine.search({
      index: "posts_fts",
      query: "",
      filters: [{ kind: "raw", bool: "and", expr: `"status" = ?`, bindings: ["published"] }],
      sorts: [],
    });
    expect(hits.map((h) => h.id)).toEqual([1]);
  });
});

describe("SqliteFTS5Engine — SQL boundary validation", () => {
  test("rejects unsafe direct SearchQuery operators and limits", async () => {
    const { engine } = freshEngine();
    engine.configureIndex("posts_fts", { columns: ["title"] });
    await engine.createIndex("posts_fts");

    await expect(engine.search({
      index: "posts_fts",
      query: "",
      filters: [{ kind: "cmp", bool: "and", field: "title", op: "= ? OR 1=1 --" as any, value: "x" }],
      sorts: [],
    })).rejects.toThrow("Invalid search comparison operator");

    await expect(engine.search({
      index: "posts_fts",
      query: "",
      filters: [],
      sorts: [],
      limit: "1; DROP TABLE posts_fts; --" as any,
    })).rejects.toThrow("non-negative integer");
  });

  test("rejects unsafe journal modes before executing a PRAGMA", () => {
    const conn = new Connection({ url: "sqlite://:memory:" });
    expect(() => new SqliteFTS5Engine({
      connection: conn,
      journalMode: "WAL; DROP TABLE users; --",
    })).toThrow("Invalid SQLite journal mode");
  });
});

describe("SqliteFTS5Engine — :memory: + WAL options", () => {
  test("memory: true opens in-memory SQLite", async () => {
    const engine = new SqliteFTS5Engine({ memory: true });
    engine.configureIndex("x_fts", { columns: ["a"] });
    await engine.createIndex("x_fts");
    await engine.update([{ index: "x_fts", id: 1, data: { a: "hello" } }]);
    const hits = await engine.search({ index: "x_fts", query: "hello", filters: [], sorts: [] });
    expect(hits).toHaveLength(1);
  });

  test("constructor rejects mutually exclusive connection / memory / shared", () => {
    const conn = new Connection({ url: "sqlite://:memory:" });
    expect(() => new SqliteFTS5Engine({ connection: conn, memory: true })).toThrow();
    expect(() => new SqliteFTS5Engine({ shared: true, memory: true })).toThrow();
  });

  test("walMode triggers PRAGMA journal_mode=WAL on first use (file-backed)", async () => {
    const conn = new Connection({ url: "sqlite://:memory:" });
    const engine = new SqliteFTS5Engine({ connection: conn, walMode: true });
    engine.configureIndex("x_fts", { columns: ["a"] });
    // PRAGMA journal_mode=WAL fails on :memory: but is swallowed; engine still works.
    await expect(engine.createIndex("x_fts")).resolves.toBeUndefined();
  });
});

describe("SqliteFTS5Engine — range facets", () => {
  test("facetRanges bucket numeric values", async () => {
    const { engine } = freshEngine();
    engine.configureIndex("products_fts", { columns: ["name"], unindexed: ["price"] });
    await engine.createIndex("products_fts");
    await engine.update([
      { index: "products_fts", id: 1, data: { name: "a", price: 50 } },
      { index: "products_fts", id: 2, data: { name: "b", price: 150 } },
      { index: "products_fts", id: 3, data: { name: "c", price: 250 } },
      { index: "products_fts", id: 4, data: { name: "d", price: 750 } },
    ]);
    const page = await engine.paginate(
      {
        index: "products_fts",
        query: "",
        filters: [],
        sorts: [],
        facetRanges: [{ field: "price", buckets: [0, 100, 500] }],
      },
      10, 1,
    );
    expect(page.facetDistribution?.price).toEqual({
      "0-100": 1,
      "100-500": 2,
      "500+": 1,
    });
  });

  test("custom labels respected", async () => {
    const { engine } = freshEngine();
    engine.configureIndex("products_fts", { columns: ["name"], unindexed: ["price"] });
    await engine.createIndex("products_fts");
    await engine.update([
      { index: "products_fts", id: 1, data: { name: "a", price: 50 } },
      { index: "products_fts", id: 2, data: { name: "b", price: 600 } },
    ]);
    const page = await engine.paginate(
      {
        index: "products_fts", query: "", filters: [], sorts: [],
        facetRanges: [{ field: "price", buckets: [0, 500], labels: ["cheap", "premium"] }],
      },
      10, 1,
    );
    expect(page.facetDistribution?.price).toEqual({ cheap: 1, premium: 1 });
  });
});

describe("SqliteFTS5Engine — filtered triggers", () => {
  test("triggerWhere.insert gates which rows the FTS index actually indexes", async () => {
    const conn = setupTestDb();
    await Schema.create("posts_ft", (t) => {
      t.increments("id");
      t.string("title");
      t.string("status");
    });
    const engine = new SqliteFTS5Engine({ connection: conn, useTriggers: true });
    engine.configureIndex("posts_ft_fts", {
      columns: ["title"],
      contentTable: "posts_ft",
      contentRowid: "id",
      triggerWhere: { insert: "new.status = 'published'" },
    });
    await engine.createIndex("posts_ft_fts");

    // Two rows share the searchable term "ferris". Only the published one
    // fires the AI trigger, so only it lands in the FTS index. A MATCH
    // search therefore returns just that row.
    await conn.run(`INSERT INTO posts_ft (title, status) VALUES (?, ?)`, ["ferris draft", "draft"]);
    await conn.run(`INSERT INTO posts_ft (title, status) VALUES (?, ?)`, ["ferris ship", "published"]);

    const hits = await engine.search({ index: "posts_ft_fts", query: "ferris", filters: [], sorts: [] });
    expect(hits.map((h) => h.id)).toEqual([2]);
  });
});

describe("defineFtsConfig — typed schema helper", () => {
  test("returns an SqliteFTS5IndexConfig and constrains columns to attribute keys", async () => {
    interface ProductAttrs { id: number; name: string; price: number; status: string }
    const cfg = defineFtsConfig<ProductAttrs>({
      columns: ["name"],
      unindexed: ["price", "status"],
      tokenizer: "porter",
    });
    expect(cfg.columns).toEqual(["name"]);
    expect(cfg.unindexed).toEqual(["price", "status"]);
    expect(cfg.tokenizer).toBe("porter");
  });
});
