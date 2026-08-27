import { describe, expect, test, beforeEach } from "bun:test";
import { Collection, Model, Schema } from "../src/index.js";
import { Search } from "../src/search/index.js";
import type { SearchEngine, SearchableRecord, SearchHit, SearchPage, SearchQuery } from "../src/search/index.js";
import { setupTestDb } from "./helpers.js";

class FakeEngine implements SearchEngine {
  updates: SearchableRecord[] = [];
  deletes: SearchableRecord[] = [];
  docs = new Map<string, Map<string | number, Record<string, unknown>>>();

  async update(records: SearchableRecord[]) {
    this.updates.push(...records);
    for (const r of records) {
      const bucket = this.docs.get(r.index) ?? new Map();
      bucket.set(r.id, r.data);
      this.docs.set(r.index, bucket);
    }
  }
  async delete(records: SearchableRecord[]) {
    this.deletes.push(...records);
    for (const r of records) this.docs.get(r.index)?.delete(r.id);
  }
  async search(q: SearchQuery): Promise<SearchHit[]> {
    const bucket = this.docs.get(q.index);
    if (!bucket) return [];
    const needle = q.query.toLowerCase();
    const hits: SearchHit[] = [];
    for (const [id, data] of bucket) {
      if (needle === "" || JSON.stringify(data).toLowerCase().includes(needle)) {
        hits.push({ id, data });
      }
    }
    return hits;
  }
  async paginate(q: SearchQuery, perPage: number, page: number): Promise<SearchPage> {
    const all = await this.search(q);
    const start = (page - 1) * perPage;
    return { hits: all.slice(start, start + perPage), total: all.length, page, perPage };
  }
  async flush(index: string) { this.docs.delete(index); }
  async createIndex() {}
  async deleteIndex(name: string) { this.docs.delete(name); }
  async updateIndexSettings() {}
  async health() { return { status: "available" }; }
}

class Post extends Model.define<{ id: number; title: string; body: string }>("posts") {
  static fillable = ["title", "body"];
}

async function setup(): Promise<FakeEngine> {
  setupTestDb();
  await Schema.create("posts", (table) => {
    table.increments("id");
    table.string("title");
    table.text("body");
    table.timestamps();
  });
  const engine = new FakeEngine();
  Search.reset();
  Search.configure({ engine });
  Search.register(Post);
  return engine;
}

describe("Search observer + builder", () => {
  beforeEach(async () => {
    Search.reset();
  });

  test("save indexes and delete removes", async () => {
    const engine = await setup();
    const post = await Post.create({ title: "Hello world", body: "Lorem" } as any);
    expect(engine.updates).toHaveLength(1);
    expect(engine.updates[0]).toMatchObject({ index: "posts", id: post.getAttribute("id" as any) });

    await post.delete();
    expect(engine.deletes).toHaveLength(1);
  });

  test("search builder hydrates ORM models in hit order", async () => {
    await setup();
    const a = await Post.create({ title: "Alpha", body: "x" } as any);
    const b = await Post.create({ title: "Beta", body: "y" } as any);
    const results = await (Post as any).search("alpha").get();
    expect(results).toBeInstanceOf(Collection);
    expect(results).toHaveLength(1);
    expect(results[0].getAttribute("id")).toBe(a.getAttribute("id" as any));
    const all = await (Post as any).search("").get();
    expect(all.map((m: any) => m.getAttribute("id"))).toEqual([
      a.getAttribute("id" as any),
      b.getAttribute("id" as any),
    ]);
  });

  test("paginate returns page metadata + hydrated data", async () => {
    await setup();
    for (let i = 0; i < 5; i++) await Post.create({ title: `Post ${i}`, body: "x" } as any);
    const page = await (Post as any).search("").paginate(2, 2);
    expect(page).toMatchObject({ total: 5, page: 2, perPage: 2 });
    expect(page.data).toBeInstanceOf(Collection);
    expect(page.data).toHaveLength(2);
  });

  test("Search.define returns typed class + lazy observer attach via configure", async () => {
    setupTestDb();
    await Schema.create("widgets", (t) => {
      t.increments("id");
      t.string("name");
      t.timestamps();
    });
    Search.reset();

    class _Widget extends Model.define<{ id: number; name: string }>("widgets") {
      static fillable = ["name"];
    }
    const Widget = Search.define(_Widget);

    const engine = new FakeEngine();
    Search.configure({ engine });

    const w = await (Widget as any).create({ name: "Foo" });
    expect(engine.updates).toHaveLength(1);
    expect(engine.updates[0].id).toBe(w.getAttribute("id"));

    const results = await (Widget as any).search("foo").get();
    expect(results).toHaveLength(1);
    expect(results[0].getAttribute("name")).toBe("Foo");
  });

  test("Search.define accepts a Model class and registers it automatically", async () => {
    setupTestDb();
    await Schema.create("comments", (t) => {
      t.increments("id");
      t.string("body");
      t.timestamps();
    });
    Search.reset();

    class _Comment extends Model.define<{ id: number; body: string }>("comments") {
      static fillable = ["body"];
    }

    const Comment = Search.define(_Comment, {
      index: "comments_v2",
      toSearchableArray: (m) => ({ body: m.getAttribute("body") }),
    });

    const engine = new FakeEngine();
    Search.configure({ engine });

    const comment = await Comment.create({ body: "Needs indexing" } as any);
    expect(engine.updates).toHaveLength(1);
    expect(engine.updates[0]).toMatchObject({
      index: "comments_v2",
      id: comment.getAttribute("id" as any),
      data: { body: "Needs indexing" },
    });
  });

  test("shouldBeSearchable=false deletes instead of indexing", async () => {
    const engine = await setup();
    (Post as any).shouldBeSearchable = (m: any) => m.getAttribute("title") !== "skip";
    const p = await Post.create({ title: "skip", body: "x" } as any);
    expect(engine.updates).toHaveLength(0);
    expect(engine.deletes.some((r) => r.id === p.getAttribute("id" as any))).toBe(true);
    (Post as any).shouldBeSearchable = () => true;
  });
});
