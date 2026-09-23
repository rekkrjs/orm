import { describe, expect, test, beforeEach } from "./harness.js";
import { Schema, ConnectionManager, TenantContext, Connection } from "../src/index.js";
import { Search, SqliteFTS5Engine } from "../src/search/index.js";
import { setupTestDb } from "./helpers.js";

describe("SqliteFTS5Engine.rebuild() — clear error when contentTable missing", () => {
  test("throws a descriptive error before issuing SQL", async () => {
    const conn = setupTestDb();
    const engine = new SqliteFTS5Engine({ connection: conn });
    engine.configureIndex("posts_fts", { columns: ["title"] });   // no contentTable
    await engine.createIndex("posts_fts");
    await expect(engine.rebuild("posts_fts")).rejects.toThrow(/contentTable/);
  });

  test("rebuild on unknown index throws schema-not-registered error", async () => {
    const conn = setupTestDb();
    const engine = new SqliteFTS5Engine({ connection: conn });
    await expect(engine.rebuild("ghost")).rejects.toThrow(/no schema registered/);
  });
});

describe("Engine.indexExists()", () => {
  test("SqliteFTS5Engine reports presence correctly", async () => {
    const conn = setupTestDb();
    const engine = new SqliteFTS5Engine({ connection: conn });
    engine.configureIndex("posts_fts", { columns: ["title"] });
    expect(await engine.indexExists("posts_fts")).toBe(false);
    await engine.createIndex("posts_fts");
    expect(await engine.indexExists("posts_fts")).toBe(true);
  });
});

describe("Tenant-aware tenantScope inside CLI helpers", () => {
  beforeEach(() => Search.reset());

  test("runWithTenant wraps work in TenantContext.run", async () => {
    const conn = setupTestDb();
    ConnectionManager.setTenantResolver(async (tenantId) => ({
      strategy: "schema",
      name: "default",
      schema: `t_${tenantId}`,
      mode: "qualify",
      connection: conn,
    } as any));
    const engine = new SqliteFTS5Engine({ connection: conn });
    Search.configure({
      engine,
      tenantScope: (base, tid) => tid ? `${base}_t_${tid}` : base,
    });

    const { runWithTenant } = await import("../src/search/commands/runWithTenant.js");
    let seen: string | null = null;
    await runWithTenant("42", async () => {
      seen = TenantContext.current()?.tenantId ?? null;
    });
    expect<string | null>(seen).toBe("42");
  });

  test("runWithTenant is no-op when no tenant id passed", async () => {
    setupTestDb();
    const { runWithTenant } = await import("../src/search/commands/runWithTenant.js");
    let ran = false;
    await runWithTenant(undefined, async () => { ran = true; });
    expect(ran).toBe(true);
  });
});
