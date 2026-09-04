import { describe, expect, test, beforeEach } from "bun:test";
import { Model, Schema, ConnectionManager, TenantContext } from "../src/index.js";
import { Search } from "../src/search/index.js";
import type { SearchEngine, SearchableRecord } from "../src/search/index.js";
import { setupTestDb } from "./helpers.js";

class TrackingEngine implements SearchEngine {
  updates: SearchableRecord[] = [];
  deletes: SearchableRecord[] = [];
  async update(r: SearchableRecord[]) { this.updates.push(...r); }
  async delete(r: SearchableRecord[]) { this.deletes.push(...r); }
  async search() { return []; }
  async paginate() { return { hits: [], total: 0, page: 1, perPage: 10 }; }
  async flush() {} async createIndex() {} async deleteIndex() {} async updateIndexSettings() {}
}

class _Post extends Model.define<{ id: number; title: string }>("posts") {
  static fillable = ["title"];
}
const Post = Search.register(_Post, { index: "posts" });

describe("Tenant-scoped index naming", () => {
  beforeEach(() => Search.reset());

  test("searchableAs() runs base name through tenantScope when TenantContext is active", async () => {
    const conn = setupTestDb();
    await Schema.create("posts", (t) => { t.increments("id"); t.string("title"); t.timestamps(); });
    await ConnectionManager.setTenantResolver(async (tenantId) => ({
      strategy: "schema",
      name: "default",
      schema: `t_${tenantId}`,
      mode: "qualify",
      connection: conn,
    } as any));

    const engine = new TrackingEngine();
    Search.configure({
      engine,
      tenantScope: (base, tenantId) => tenantId ? `${base}_t_${tenantId}` : base,
    });
    Search.register(_Post, { index: "posts" });

    // No tenant context — base name only.
    expect((Post as any).searchableAs()).toBe("posts");

    // Inside tenant context — scoped name.
    await TenantContext.run("42", async () => {
      expect((Post as any).searchableAs()).toBe("posts_t_42");
    });
  });

  test("observer dispatch bakes tenant-scoped index into the SearchableRecord", async () => {
    const conn = setupTestDb();
    await Schema.create("posts", (t) => { t.increments("id"); t.string("title"); t.timestamps(); });
    await ConnectionManager.setTenantResolver(async (tenantId) => ({
      strategy: "schema",
      name: "default",
      schema: `t_${tenantId}`,
      mode: "qualify",
      connection: conn,
    } as any));

    const engine = new TrackingEngine();
    Search.configure({
      engine,
      tenantScope: (base, tenantId) => tenantId ? `${base}_t_${tenantId}` : base,
    });
    Search.register(_Post, { index: "posts" });

    // Save without tenant → "posts"
    await Post.create({ title: "global" } as any);
    expect(engine.updates.at(-1)!.index).toBe("posts");

    // Save under tenant 7 → "posts_t_7"
    await TenantContext.run("7", async () => {
      await Post.create({ title: "tenant-7" } as any);
    });
    expect(engine.updates.at(-1)!.index).toBe("posts_t_7");
  });

  test("Search.indexFor() resolves outside of model methods", () => {
    setupTestDb();
    Search.configure({
      engine: new TrackingEngine(),
      tenantScope: (base, tid) => tid ? `${base}_t_${tid}` : base,
    });
    expect(Search.indexFor("posts", "42")).toBe("posts_t_42");
    expect(Search.indexFor("posts", null)).toBe("posts");
    expect(Search.indexFor("posts")).toBe("posts");   // no tenant context
  });

  test("no tenantScope = identity (back-compat)", async () => {
    setupTestDb();
    const engine = new TrackingEngine();
    Search.configure({ engine });
    Search.register(_Post, { index: "posts" });
    expect((Post as any).searchableAs()).toBe("posts");
  });

  test("Search.indexesFor batch-resolves multiple tenants", () => {
    setupTestDb();
    Search.configure({
      engine: new TrackingEngine(),
      tenantScope: (base, tid) => tid ? `${base}_t_${tid}` : base,
    });
    const result = Search.indexesFor("posts", ["1", "2", null]);
    expect(result).toEqual({
      "1": "posts_t_1",
      "2": "posts_t_2",
      "__landlord__": "posts",
    });
  });

  test("Search.indexesForAllTenants uses configured listTenants", async () => {
    setupTestDb();
    Search.configure({
      engine: new TrackingEngine(),
      tenantScope: (base, tid) => tid ? `${base}_t_${tid}` : base,
      listTenants: () => ["alpha", "beta"],
    });
    const result = await Search.indexesForAllTenants("posts");
    expect(result).toEqual({
      alpha: "posts_t_alpha",
      beta: "posts_t_beta",
    });
    const withLandlord = await Search.indexesForAllTenants("posts", { includeLandlord: true });
    expect(withLandlord).toEqual({
      __landlord__: "posts",
      alpha: "posts_t_alpha",
      beta: "posts_t_beta",
    });
  });

  test("indexesForAllTenants returns empty when listTenants not set", async () => {
    setupTestDb();
    Search.configure({
      engine: new TrackingEngine(),
      tenantScope: (base, tid) => tid ? `${base}_t_${tid}` : base,
    });
    expect(await Search.indexesForAllTenants("posts")).toEqual({});
  });
});

describe("Queue path preserves tenant-scoped index", () => {
  beforeEach(() => Search.reset());

  test("record dispatched under tenant context carries the scoped index name", async () => {
    const conn = setupTestDb();
    await Schema.create("posts", (t) => { t.increments("id"); t.string("title"); t.timestamps(); });
    await ConnectionManager.setTenantResolver(async (tenantId) => ({
      strategy: "schema",
      name: "default",
      schema: `t_${tenantId}`,
      mode: "qualify",
      connection: conn,
    } as any));

    const engine = new TrackingEngine();
    Search.configure({
      engine,
      tenantScope: (base, tid) => tid ? `${base}_t_${tid}` : base,
    });
    Search.register(_Post, { index: "posts" });

    await TenantContext.run("99", async () => {
      await Post.create({ title: "x" } as any);
    });

    // The record's `index` was resolved at dispatch time inside the tenant
    // context, so when a worker later replays it (Worker.ts re-enters
    // TenantContext.run with the same tenantId), the engine writes to the
    // same scoped index.
    expect(engine.updates).toHaveLength(1);
    expect(engine.updates[0].index).toBe("posts_t_99");
  });
});
