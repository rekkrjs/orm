import { describe, expect, test, beforeEach } from "./harness.js";
import { Model, Schema, HasMany } from "../src/index.js";
import { Search } from "../src/search/index.js";
import type {
  SearchEngine,
  SearchHit,
  SearchPage,
  SearchQuery,
  SearchableRecord,
} from "../src/search/index.js";
import { setupTestDb } from "./helpers.js";

class CapturingEngine implements SearchEngine {
  lastQuery: SearchQuery | null = null;
  docs = new Map<string | number, Record<string, unknown>>();
  responder: (q: SearchQuery) => SearchHit[] = () => [];

  async update(records: SearchableRecord[]) {
    for (const r of records) this.docs.set(r.id, r.data);
  }
  async delete(records: SearchableRecord[]) {
    for (const r of records) this.docs.delete(r.id);
  }
  async search(q: SearchQuery): Promise<SearchHit[]> {
    this.lastQuery = q;
    return this.responder(q);
  }
  async paginate(q: SearchQuery, perPage: number, page: number): Promise<SearchPage> {
    const hits = await this.search(q);
    return { hits, total: hits.length, page, perPage };
  }
  async flush() { this.docs.clear(); }
  async createIndex() {} async deleteIndex() {} async updateIndexSettings() {}
  async health() { return { status: "ok" }; }
}

class Author extends Model.define<{ id: number; name: string }>("authors") {
  static fillable = ["name"];
  posts() { return new HasMany(this, Post as any, "author_id", "id"); }
}

class Post extends Model.define<{ id: number; title: string; author_id: number }>("posts") {
  static fillable = ["title", "author_id"];
  author() { return (this as any).belongsTo(Author, "author_id", "id"); }
}

async function setup(): Promise<CapturingEngine> {
  setupTestDb();
  await Schema.create("authors", (t) => { t.increments("id"); t.string("name"); t.timestamps(); });
  await Schema.create("posts", (t) => {
    t.increments("id"); t.string("title"); t.integer("author_id"); t.timestamps();
  });
  const engine = new CapturingEngine();
  Search.reset();
  Search.configure({ engine });
  Search.register(Post);
  return engine;
}

describe("SearchBuilder filter compilation + execution", () => {
  beforeEach(() => Search.reset());

  test("where with op + whereNot + whereIn + whereNotIn", async () => {
    const engine = await setup();
    await (Post as any).search("foo")
      .where("status", "published")
      .where("rank", ">", 5)
      .whereNot("type", "draft")
      .whereIn("tag", ["a", "b"])
      .whereNotIn("category", ["x"])
      .raw();

    const filters = engine.lastQuery!.filters;
    expect(filters[0]).toMatchObject({ kind: "cmp", bool: "and", field: "status", op: "=", value: "published" });
    expect(filters[1]).toMatchObject({ kind: "cmp", op: ">", value: 5 });
    expect(filters[2]).toMatchObject({ kind: "cmp", op: "!=", value: "draft" });
    expect(filters[3]).toMatchObject({ kind: "in", values: ["a", "b"] });
    expect(filters[4]).toMatchObject({ kind: "in", values: ["x"], negate: true });
  });

  test("rejects unsafe operators and numeric SQL clauses at runtime", async () => {
    await setup();
    const search = (Post as any).search("");

    expect(() => search.where("rank", "= ? OR 1=1 --", 0)).toThrow("Invalid search comparison operator");
    expect(() => search.orderBy("rank", "desc; DROP TABLE posts; --")).toThrow("Invalid search order direction");
    expect(() => search.take("1; DROP TABLE posts; --")).toThrow("non-negative integer");
    expect(() => search.facetRange("rank", [0, "1); DROP TABLE posts; --"])).toThrow("finite number");
  });

  test("whereBetween + whereNotBetween + whereNull + whereRaw", async () => {
    const engine = await setup();
    await (Post as any).search("")
      .whereBetween("price", [10, 99])
      .whereNotBetween("rank", [0, 1])
      .whereNull("deleted_at")
      .whereNotNull("published_at")
      .whereExists("title")
      .whereRaw('_geoRadius(48, 2, 1000)')
      .raw();

    const f = engine.lastQuery!.filters;
    expect(f[0]).toMatchObject({ kind: "between", from: 10, to: 99 });
    expect(f[1]).toMatchObject({ kind: "between", negate: true });
    expect(f[2]).toMatchObject({ kind: "null" });
    expect(f[3]).toMatchObject({ kind: "null", negate: true });
    expect(f[4]).toMatchObject({ kind: "exists" });
    expect(f[5]).toMatchObject({ kind: "raw", expr: '_geoRadius(48, 2, 1000)' });
  });

  test("orWhere + nested group callback", async () => {
    const engine = await setup();
    await (Post as any).search("")
      .where("status", "published")
      .orWhere("featured", true)
      .where((q: any) => {
        q.where("rank", ">", 10).orWhere("priority", "=", "high");
      })
      .raw();

    const f = engine.lastQuery!.filters;
    expect(f[0].bool).toBe("and");
    expect(f[1].bool).toBe("or");
    expect(f[2]).toMatchObject({ kind: "group", bool: "and" });
    expect((f[2] as any).filters[1]).toMatchObject({ bool: "or", field: "priority" });
  });

  test("retrieve/display fields are carried on raw query", async () => {
    const engine = await setup();
    await (Post as any).search("foo")
      .retrieve("title")
      .display("title", "author_id")
      .raw();

    expect(engine.lastQuery!.attributesToRetrieve).toEqual(["title", "author_id"]);
  });

  test("cursor streams pages until short batch", async () => {
    const engine = await setup();
    const post1 = await Post.create({ title: "a", author_id: 1 } as any);
    const post2 = await Post.create({ title: "b", author_id: 1 } as any);
    const post3 = await Post.create({ title: "c", author_id: 1 } as any);

    const pages = [
      [{ id: post1.getAttribute("id" as any), data: {} }, { id: post2.getAttribute("id" as any), data: {} }],
      [{ id: post3.getAttribute("id" as any), data: {} }],
    ];
    engine.responder = () => pages.shift() ?? [];

    const collected: any[] = [];
    for await (const row of (Post as any).search("").cursor(2)) collected.push(row.getAttribute("id"));
    expect(collected).toEqual([
      post1.getAttribute("id" as any),
      post2.getAttribute("id" as any),
      post3.getAttribute("id" as any),
    ]);
  });

  test("simplePaginate sets hasMore via fetch-extra-row", async () => {
    const engine = await setup();
    const p1 = await Post.create({ title: "a", author_id: 1 } as any);
    const p2 = await Post.create({ title: "b", author_id: 1 } as any);
    const p3 = await Post.create({ title: "c", author_id: 1 } as any);
    engine.responder = () => [
      { id: p1.getAttribute("id" as any), data: {} },
      { id: p2.getAttribute("id" as any), data: {} },
      { id: p3.getAttribute("id" as any), data: {} },
    ];
    const page = await (Post as any).search("").simplePaginate(2, 1);
    expect(page.data).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect(engine.lastQuery!.limit).toBe(3);
    expect(engine.lastQuery!.offset).toBe(0);
  });

  test("rawPaginate returns engine page metadata without hydration", async () => {
    const engine = await setup();
    engine.responder = () => [
      { id: 1, data: { title: "Jane Doe" } },
      { id: 2, data: { title: "John Doe" } },
    ];

    const page = await (Post as any).search("doe").rawPaginate(10, 2);

    expect(page.page).toBe(2);
    expect(page.perPage).toBe(10);
    expect(page.total).toBe(2);
    expect(page.hits).toEqual([
      { id: 1, data: { title: "Jane Doe" } },
      { id: 2, data: { title: "John Doe" } },
    ]);
  });

  test(".with() eager-loads relations during hydration", async () => {
    const engine = await setup();
    const author = await Author.create({ name: "A" } as any);
    const post = await Post.create({ title: "x", author_id: author.getAttribute("id" as any) } as any);
    engine.responder = () => [{ id: post.getAttribute("id" as any), data: {} }];

    const results = await (Post as any).search("").with("author").get();
    expect(results).toHaveLength(1);
    expect(results[0].$relations?.author?.getAttribute("name")).toBe("A");
  });
});
