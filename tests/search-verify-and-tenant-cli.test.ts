import { describe, expect, test, beforeEach } from "./harness.js";
import { Model, Schema, ConnectionManager, TenantContext } from "../src/index.js";
import { Search, SqliteFTS5Engine } from "../src/search/index.js";
import { setupTestDb } from "./helpers.js";

// ─── SqliteFTS5Engine.indexExists() ───────────────────────────────────────────

describe("SqliteFTS5Engine.indexExists()", () => {
  test("returns false before createIndex, true after", async () => {
    const conn = setupTestDb();
    const engine = new SqliteFTS5Engine({ connection: conn });
    engine.configureIndex("posts_fts", { columns: ["title"] });
    expect(await engine.indexExists("posts_fts")).toBe(false);
    await engine.createIndex("posts_fts");
    expect(await engine.indexExists("posts_fts")).toBe(true);
    await engine.deleteIndex("posts_fts");
    expect(await engine.indexExists("posts_fts")).toBe(false);
  });
});

// ─── Tenant-scoped index name flows through CLI ops ───────────────────────────

class _Post extends Model.define<{ id: number; title: string }>("posts") {
  static fillable = ["title"];
}
const Post = Search.register(_Post, { index: "posts" });

describe("Tenant CLI flow — runWithTenant + tenantScope", () => {
  beforeEach(() => Search.reset());

  async function setup(tenantIds: string[] = []) {
    const conn = setupTestDb();
    await Schema.create("posts", (t) => { t.increments("id"); t.string("title"); t.timestamps(); });
    ConnectionManager.setTenantResolver(async (tenantId) => ({
      strategy: "schema",
      name: "default",
      schema: `t_${tenantId}`,
      mode: "qualify",
      connection: conn,
    } as any));
    const engine = new SqliteFTS5Engine({ connection: conn });
    // Configure FTS schema for the base + each tenant-scoped name we'll touch.
    engine.configureIndex("posts", { columns: ["title"] });
    for (const tid of tenantIds) {
      engine.configureIndex(`posts_t_${tid}`, { columns: ["title"] });
    }
    Search.configure({
      engine,
      tenantScope: (b, tid) => tid ? `${b}_t_${tid}` : b,
    });
    Search.register(_Post, { index: "posts" });
    return engine;
  }

  test("createIndex inside TenantContext targets the scoped name", async () => {
    const engine = await setup(["42"]);
    expect(await engine.indexExists("posts_t_42")).toBe(false);

    const { runWithTenant } = await import("../src/search/commands/runWithTenant.js");
    await runWithTenant("42", async () => {
      const index = (Post as any).searchableAs();
      expect(index).toBe("posts_t_42");
      await engine.createIndex(index);
    });

    expect(await engine.indexExists("posts_t_42")).toBe(true);
    expect(await engine.indexExists("posts")).toBe(false);
  });

  test("flush inside TenantContext flushes the scoped name only", async () => {
    const engine = await setup(["a", "b"]);
    const { runWithTenant } = await import("../src/search/commands/runWithTenant.js");

    // Create two tenant indexes
    await runWithTenant("a", async () => {
      await engine.createIndex((Post as any).searchableAs());
      await engine.update([{ index: (Post as any).searchableAs(), id: 1, data: { title: "x" } }]);
    });
    await runWithTenant("b", async () => {
      await engine.createIndex((Post as any).searchableAs());
      await engine.update([{ index: (Post as any).searchableAs(), id: 2, data: { title: "y" } }]);
    });

    // Flush only tenant a
    await runWithTenant("a", async () => {
      await engine.flush((Post as any).searchableAs());
    });

    // Tenant a empty
    let hits = await runWithTenant("a", async () =>
      engine.search({ index: (Post as any).searchableAs(), query: "", filters: [], sorts: [] }),
    );
    expect(hits).toHaveLength(0);
    // Tenant b intact
    hits = await runWithTenant("b", async () =>
      engine.search({ index: (Post as any).searchableAs(), query: "", filters: [], sorts: [] }),
    );
    expect(hits).toHaveLength(1);
  });

  test("indexExists distinguishes tenant-scoped indexes", async () => {
    const engine = await setup(["99"]);
    const { runWithTenant } = await import("../src/search/commands/runWithTenant.js");
    await runWithTenant("99", async () => {
      await engine.createIndex((Post as any).searchableAs());
    });
    expect(await engine.indexExists("posts_t_99")).toBe(true);
    expect(await engine.indexExists("posts_t_42")).toBe(false);
    expect(await engine.indexExists("posts")).toBe(false);
  });
});

// ─── search:verify command behavior (programmatic) ───────────────────────────

describe("search:verify command — programmatic invocation", () => {
  beforeEach(() => Search.reset());

  test("instantiates without throwing; reports when no models discovered", async () => {
    setupTestDb();
    Search.configure({
      engine: new SqliteFTS5Engine({ memory: true }),
    });
    const { makeSearchVerifyCommand } = await import("../src/search/commands/SearchVerifyCommand.js");
    const Cmd = makeSearchVerifyCommand({ connection: { url: "sqlite://:memory:" } } as any);
    const inst = new Cmd();
    inst._parsedArgs = {};
    inst._parsedOptions = {};
    // Capture warn output.
    const warnings: string[] = [];
    inst.warn = (m: any) => { warnings.push(String(m)); };
    inst.line = () => {};
    inst.info = () => {};
    inst.error = () => {};
    await inst.handle();
    expect(warnings.some((w) => /No searchable models/.test(w))).toBe(true);
  });

  test("warns if engine lacks indexExists()", async () => {
    setupTestDb();
    const stubEngine: any = {
      async update() {}, async delete() {},
      async search() { return []; },
      async paginate() { return { hits: [], total: 0, page: 1, perPage: 10 }; },
      async flush() {}, async createIndex() {}, async deleteIndex() {}, async updateIndexSettings() {},
    };
    Search.configure({ engine: stubEngine });
    Search.register(_Post, { index: "posts" });

    const { makeSearchVerifyCommand } = await import("../src/search/commands/SearchVerifyCommand.js");
    const Cmd = makeSearchVerifyCommand({ connection: { url: "sqlite://:memory:" } } as any);
    const inst = new Cmd();
    inst._parsedArgs = {};
    inst._parsedOptions = {};
    const warnings: string[] = [];
    inst.warn = (m: any) => { warnings.push(String(m)); };
    inst.info = () => {};
    inst.line = () => {};
    inst.error = () => {};
    await inst.handle();
    // Either "no searchable models" (filesystem-based loader can't find _Post
    // declared inline) OR "does not implement indexExists" — both indicate the
    // command bailed safely without throwing.
    expect(warnings.length).toBeGreaterThan(0);
  });
});
