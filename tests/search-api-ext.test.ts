import { describe, expect, test, beforeEach } from "./harness.js";
import { Model, Schema } from "../src/index.js";
import { Search } from "../src/search/index.js";
import type {
  FacetDistribution,
  SearchEngine,
  SearchHit,
  SearchMultiResult,
  SearchPage,
  SearchQuery,
  SearchableRecord,
} from "../src/search/index.js";
import { setupTestDb } from "./helpers.js";

class CapturingEngine implements SearchEngine {
  lastQuery: SearchQuery | null = null;
  lastMulti: SearchQuery[] | null = null;
  docs = new Map<string | number, Record<string, unknown>>();
  pageImpl: (q: SearchQuery, perPage: number, page: number) => SearchPage = (q, perPage, page) => ({
    hits: [], total: 0, page, perPage,
  });
  multiImpl?: (q: SearchQuery[]) => SearchMultiResult[];
  searchImpl: (q: SearchQuery) => SearchHit[] = () => [];

  async update(records: SearchableRecord[]) {
    for (const r of records) this.docs.set(r.id, r.data);
  }
  async delete() {}
  async search(q: SearchQuery) { this.lastQuery = q; return this.searchImpl(q); }
  async paginate(q: SearchQuery, perPage: number, page: number) {
    this.lastQuery = q;
    return this.pageImpl(q, perPage, page);
  }
  async multiSearch(q: SearchQuery[]) {
    this.lastMulti = q;
    return this.multiImpl ? this.multiImpl(q) : q.map((x) => ({ index: x.index, hits: [], total: 0 }));
  }
  async flush() {} async createIndex() {} async deleteIndex() {} async updateIndexSettings() {}
}

class _Post extends Model.define<{ id: number; title: string; status: string; rank: number }>("posts_ext") {
  static fillable = ["title", "status", "rank"];
}
const Post = Search.register(_Post, { index: "posts_ext" });

class _Article extends Model.define<{ id: number; body: string }>("articles_ext") {
  static fillable = ["body"];
}
const Article = Search.register(_Article, { index: "articles_ext" });

async function setup(): Promise<CapturingEngine> {
  setupTestDb();
  await Schema.create("posts_ext", (t) => {
    t.increments("id"); t.string("title"); t.string("status"); t.integer("rank"); t.timestamps();
  });
  await Schema.create("articles_ext", (t) => {
    t.increments("id"); t.text("body"); t.timestamps();
  });
  const engine = new CapturingEngine();
  Search.reset();
  Search.configure({ engine });
  Search.register(_Post, { index: "posts_ext" });
  Search.register(_Article, { index: "articles_ext" });
  return engine;
}

describe("SearchBuilder extended API", () => {
  beforeEach(() => Search.reset());

  test("facets + minScore + searchOn + highlight + crop + withScore propagate to query", async () => {
    const engine = await setup();
    await (Post as any).search("rust")
      .facet("status")
      .facets("rank")
      .minScore(0.4)
      .searchOn("title")
      .boost("title")
      .highlight("title")
      .highlightTags("<em>", "</em>")
      .crop("title", 80)
      .withScore()
      .raw();

    const q = engine.lastQuery!;
    expect(q.facets).toEqual(["status", "rank"]);
    expect(q.minScore).toBe(0.4);
    expect(q.attributesToSearchOn).toEqual(["title"]);
    expect(q.highlight).toMatchObject({ fields: ["title"], preTag: "<em>", postTag: "</em>" });
    expect(q.crop).toEqual([{ field: "title", length: 80 }]);
    expect(q.showRankingScore).toBe(true);
  });

  test("multi-sort via chained orderBy + thenBy preserves order", async () => {
    const engine = await setup();
    await (Post as any).search("")
      .orderBy("rank", "desc")
      .thenBy("status", "asc")
      .raw();
    expect(engine.lastQuery!.sorts).toEqual([
      { field: "rank", direction: "desc" },
      { field: "status", direction: "asc" },
    ]);
  });

  test("paginate exposes facetDistribution when engine returns it", async () => {
    const engine = await setup();
    const dist: FacetDistribution = { status: { published: 5, draft: 2 } };
    engine.pageImpl = (_q, perPage, page) => ({ hits: [], total: 7, page, perPage, facetDistribution: dist });

    const result = await (Post as any).search("").facet("status").paginate(10, 1);
    expect(result.facetDistribution).toEqual(dist);
    expect(result.total).toBe(7);
  });

  test("facetDistribution() shortcut requests zero hits", async () => {
    const engine = await setup();
    engine.pageImpl = (q, perPage, page) => ({
      hits: [],
      total: 0,
      page,
      perPage,
      facetDistribution: { status: { published: 3 } },
    });
    const fd = await (Post as any).search("").facet("status").facetDistribution();
    expect(fd).toEqual({ status: { published: 3 } });
    expect(engine.lastQuery!.limit).toBe(0);
  });

  test("fetch() returns SearchFetchResult with facets + total", async () => {
    const engine = await setup();
    const p = await Post.create({ title: "a", status: "published", rank: 1 } as any);
    engine.pageImpl = () => ({
      hits: [{ id: p.getAttribute("id" as any), data: {}, score: 0.9 }],
      total: 1,
      page: 1,
      perPage: 10,
      facetDistribution: { status: { published: 1 } },
    });
    const r = await (Post as any).search("a").facet("status").fetch(10);
    expect(r.total).toBe(1);
    expect(r.facetDistribution).toEqual({ status: { published: 1 } });
    expect(r.data).toHaveLength(1);
  });

  test("Search.multi routes through engine.multiSearch when available", async () => {
    const engine = await setup();
    engine.multiImpl = (qs) => qs.map((q, i) => ({
      index: q.index,
      hits: [{ id: i + 1, data: { idx: q.index } }],
      total: 1,
    }));

    const [postResults, articleResults] = await Search.multi([
      (Post as any).search("rust"),
      (Article as any).search("rust"),
    ]);
    expect(postResults.index).toBe("posts_ext");
    expect(articleResults.index).toBe("articles_ext");
    expect(postResults.hits[0].data).toEqual({ idx: "posts_ext" });
    expect(engine.lastMulti).toHaveLength(2);
  });

  test("Search.multi falls back to sequential search when engine has no multiSearch", async () => {
    setupTestDb();
    await Schema.create("posts_ext", (t) => { t.increments("id"); t.string("title"); t.string("status"); t.integer("rank"); t.timestamps(); });
    await Schema.create("articles_ext", (t) => { t.increments("id"); t.text("body"); t.timestamps(); });
    Search.reset();
    let calls = 0;
    const engine: SearchEngine = {
      async update() {}, async delete() {},
      async search(q) { calls++; return [{ id: calls, data: { from: q.index } }]; },
      async paginate(q, perPage, page) { return { hits: [], total: 0, page, perPage }; },
      async flush() {}, async createIndex() {}, async deleteIndex() {}, async updateIndexSettings() {},
    };
    Search.configure({ engine });
    Search.register(_Post, { index: "posts_ext" });
    Search.register(_Article, { index: "articles_ext" });

    const results = await Search.multi([
      (Post as any).search("a"),
      (Article as any).search("b"),
    ]);
    expect(calls).toBe(2);
    expect(results).toHaveLength(2);
    expect(results[0].hits[0].data).toEqual({ from: "posts_ext" });
  });
});
