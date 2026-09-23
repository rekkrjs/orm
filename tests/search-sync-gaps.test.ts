import { describe, expect, test, beforeEach } from "./harness.js";
import { Model, Schema, ObserverRegistry } from "../src/index.js";
import { Search } from "../src/search/index.js";
import type { SearchEngine, SearchableRecord } from "../src/search/index.js";
import { setupTestDb } from "./helpers.js";

class TrackingEngine implements SearchEngine {
  updates: SearchableRecord[] = [];
  deletes: SearchableRecord[] = [];
  flushed: string[] = [];
  calls = 0;

  async update(r: SearchableRecord[]) { this.calls++; this.updates.push(...r); }
  async delete(r: SearchableRecord[]) { this.calls++; this.deletes.push(...r); }
  async search() { return []; }
  async paginate() { return { hits: [], total: 0, page: 1, perPage: 10 }; }
  async flush(index: string) { this.flushed.push(index); }
  async createIndex() {} async deleteIndex() {} async updateIndexSettings() {}
}

describe("Model.trashed() + ObserverRegistry.hasAny()", () => {
  test("trashed() returns false when soft deletes disabled", () => {
    class Foo extends Model.define<{ id: number }>("foos") {
      static softDeletes = false;
    }
    const m = new Foo();
    expect(m.trashed()).toBe(false);
  });

  test("trashed() reflects deleted_at attribute when soft deletes enabled", () => {
    class Foo extends Model.define<{ id: number; deleted_at: string | null }>("foos") {
      static softDeletes = true;
    }
    const m = new Foo();
    expect(m.trashed()).toBe(false);
    (m as any).setAttribute("deleted_at", new Date().toISOString());
    expect(m.trashed()).toBe(true);
  });

  test("ObserverRegistry.hasAny / hasFor", () => {
    class Bar extends Model.define<{ id: number }>("bars") {}
    expect(ObserverRegistry.hasAny(Bar as any)).toBe(false);
    ObserverRegistry.register(Bar as any, { async saved() {} });
    expect(ObserverRegistry.hasAny(Bar as any)).toBe(true);
    expect(ObserverRegistry.hasFor("saved", Bar as any)).toBe(true);
    expect(ObserverRegistry.hasFor("updated", Bar as any)).toBe(false);
    ObserverRegistry.unregister(Bar as any);
  });
});

describe("Bulk path observer dispatch", () => {
  class _Item extends Model.define<{ id: number; name: string }>("items") {
    static fillable = ["name"];
  }
  const Item = Search.register(_Item, { index: "items" });

  async function setup(): Promise<TrackingEngine> {
    setupTestDb();
    await Schema.create("items", (t) => { t.increments("id"); t.string("name"); t.timestamps(); });
    const engine = new TrackingEngine();
    Search.reset();
    Search.configure({ engine });
    Search.register(_Item, { index: "items" });
    return engine;
  }

  beforeEach(() => Search.reset());

  test("Model.insert([...]) dispatches per-row created+saved when observers attached", async () => {
    const engine = await setup();
    await (Item as any).insert([
      { name: "a" }, { name: "b" }, { name: "c" },
    ]);
    expect(engine.updates).toHaveLength(3);
    const names = engine.updates.map((r) => (r.data as any).name).sort();
    expect(names).toEqual(["a", "b", "c"]);
  });

  test("Model.insert with events: false skips observer dispatch", async () => {
    const engine = await setup();
    await (Item as any).insert([{ name: "x" }, { name: "y" }], { events: false });
    expect(engine.updates).toHaveLength(0);
  });

  test("Builder.update() dispatches updated+saved on affected rows only", async () => {
    const engine = await setup();
    const a = await Item.create({ name: "alpha" } as any);
    const b = await Item.create({ name: "beta" } as any);
    engine.updates.length = 0;

    await (Item as any).where("id", a.getAttribute("id" as any)).update({ name: "alpha2" });
    expect(engine.updates).toHaveLength(1);
    expect((engine.updates[0].data as any).name).toBe("alpha2");
    expect(engine.updates[0].id).toBe(a.getAttribute("id" as any));
  });

  test("Builder.delete() dispatches deleted on each removed row", async () => {
    const engine = await setup();
    const a = await Item.create({ name: "x" } as any);
    const b = await Item.create({ name: "y" } as any);
    engine.deletes.length = 0;

    await (Item as any).where("id", a.getAttribute("id" as any)).delete();
    expect(engine.deletes).toHaveLength(1);
    expect(engine.deletes[0].id).toBe(a.getAttribute("id" as any));
  });
});

describe("Static helpers: makeAllSearchable / removeAllFromSearch", () => {
  class _Doc extends Model.define<{ id: number; body: string }>("docs") {
    static fillable = ["body"];
  }
  const Doc = Search.register(_Doc, { index: "docs" });

  async function setup(): Promise<TrackingEngine> {
    setupTestDb();
    await Schema.create("docs", (t) => { t.increments("id"); t.text("body"); t.timestamps(); });
    const engine = new TrackingEngine();
    Search.reset();
    Search.configure({ engine });
    Search.register(_Doc, { index: "docs" });
    return engine;
  }

  beforeEach(() => Search.reset());

  test("makeAllSearchable indexes all rows in chunks", async () => {
    const engine = await setup();
    for (let i = 0; i < 5; i++) await Doc.create({ body: `b${i}` } as any);
    engine.updates.length = 0;

    await Doc.makeAllSearchable(2);
    expect(engine.updates).toHaveLength(5);
  });

  test("removeAllFromSearch flushes the index", async () => {
    const engine = await setup();
    await Doc.removeAllFromSearch();
    expect(engine.flushed).toEqual(["docs"]);
  });
});

describe("Batch coalescing", () => {
  class _Note extends Model.define<{ id: number; body: string }>("notes") {
    static fillable = ["body"];
  }
  const Note = Search.register(_Note, { index: "notes" });

  beforeEach(() => Search.reset());

  test("buffers updates and flushes once when maxItems hits", async () => {
    setupTestDb();
    await Schema.create("notes", (t) => { t.increments("id"); t.text("body"); t.timestamps(); });
    const engine = new TrackingEngine();
    Search.configure({ engine, batch: { maxItems: 3, maxMs: 60_000 } });
    Search.register(_Note, { index: "notes" });

    await Note.create({ body: "1" } as any);
    await Note.create({ body: "2" } as any);
    expect(engine.calls).toBe(0);   // still buffered
    await Note.create({ body: "3" } as any);
    // maxItems reached → flush is fire-and-forget; await microtask
    await new Promise((r) => setTimeout(r, 10));
    expect(engine.calls).toBe(1);
    expect(engine.updates).toHaveLength(3);
  });

  test("dedupes same record updated multiple times within window", async () => {
    setupTestDb();
    await Schema.create("notes", (t) => { t.increments("id"); t.text("body"); t.timestamps(); });
    const engine = new TrackingEngine();
    Search.configure({ engine, batch: { maxItems: 100, maxMs: 60_000 } });
    Search.register(_Note, { index: "notes" });

    const note = await Note.create({ body: "v1" } as any);
    note.setAttribute("body", "v2");
    await note.save();
    note.setAttribute("body", "v3");
    await note.save();
    expect(engine.calls).toBe(0);

    await Search.flushPending();
    expect(engine.calls).toBe(1);
    expect(engine.updates).toHaveLength(1);
    expect((engine.updates[0].data as any).body).toBe("v3");
  });

  test("flushes on timer when maxItems not reached", async () => {
    setupTestDb();
    await Schema.create("notes", (t) => { t.increments("id"); t.text("body"); t.timestamps(); });
    const engine = new TrackingEngine();
    Search.configure({ engine, batch: { maxItems: 100, maxMs: 50 } });
    Search.register(_Note, { index: "notes" });

    await Note.create({ body: "x" } as any);
    expect(engine.calls).toBe(0);
    await new Promise((r) => setTimeout(r, 90));
    expect(engine.calls).toBe(1);
    expect(engine.updates).toHaveLength(1);
  });

  test("delete after update collapses to one delete", async () => {
    setupTestDb();
    await Schema.create("notes", (t) => { t.increments("id"); t.text("body"); t.timestamps(); });
    const engine = new TrackingEngine();
    Search.configure({ engine, batch: { maxItems: 100, maxMs: 60_000 } });
    Search.register(_Note, { index: "notes" });

    const note = await Note.create({ body: "x" } as any);
    await note.delete();
    await Search.flushPending();
    expect(engine.updates).toHaveLength(0);
    expect(engine.deletes).toHaveLength(1);
  });
});
