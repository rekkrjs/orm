import { afterEach, beforeEach, describe, expect, test } from "./harness.js";
import { tmpdir } from "os";
import { join } from "path";
import { Connection, ConnectionManager, Model, Schema, TenantContext } from "../src/index.js";
import { MakeSearchableJob, Search, SqliteFTS5Engine, makeSearchableRecord } from "../src/search/index.js";
import { PostgresFTSEngine } from "../src/search/engines/PostgresFTSEngine.js";
import { cleanupSqliteFile } from "./helpers.js";

// The documented flow is two processes: `orm search:create-index Post` reads
// the model's `fts` config and creates the index; the application then saves
// and searches with a fresh engine that was never told about that config.

class _Article extends Model.define<{ id: number; title: string; body: string; status: string }>("fts_articles") {
  static fillable = ["title", "body", "status"];
  static timestamps = false;
}
const Article = Search.register(_Article, {
  fts: { columns: ["title", "body"], unindexed: ["status"] },
  toSearchableArray: (m) => ({ title: m.title, body: m.body, status: m.status }),
});

class _Note extends Model.define<{ id: number; text: string }>("fts_notes") {
  static fillable = ["text"];
  static timestamps = false;
}
const Note = Search.register(_Note, {
  fts: { columns: ["text"] },
  toSearchableArray: (m) => ({ text: m.text }),
});

async function createSourceTables(): Promise<void> {
  await Schema.create("fts_articles", (t) => { t.increments("id"); t.string("title"); t.text("body"); t.string("status"); });
  await Schema.create("fts_notes", (t) => { t.increments("id"); t.string("text"); });
}

/** What `search:create-index` does in its own process. */
async function cliCreateIndexes(engine: SqliteFTS5Engine | PostgresFTSEngine): Promise<void> {
  for (const model of [Article, Note] as any[]) {
    engine.configureIndex(model.searchableAs(), model.searchFtsConfig);
    await engine.createIndex(model.searchableAs());
  }
}

async function appFlow(): Promise<void> {
  const rust = await Article.create({ title: "Rust ownership", body: "borrowing rules", status: "published" });
  const draft = await Article.create({ title: "Rust macros", body: "hygiene", status: "draft" });
  await Article.create({ title: "Go channels", body: "select", status: "published" });
  await Note.create({ text: "rust notes that must stay in their own index" });

  expect((await Article.search("rust").get()).map((a) => a.id).sort()).toEqual([rust.id, draft.id]);
  expect((await Article.search("rust").where("status", "published").get()).map((a) => a.id)).toEqual([rust.id]);
  expect((await Note.search("rust").raw()).length).toBe(1);

  await draft.update({ title: "Zig comptime" });
  expect((await Article.search("rust").get()).map((a) => a.id)).toEqual([rust.id]);
  expect((await Article.search("zig").get()).map((a) => a.id)).toEqual([draft.id]);

  await rust.delete();
  expect(await Article.search("rust").raw()).toEqual([]);
  // The notes index is untouched by article writes.
  expect((await Note.search("rust").raw()).length).toBe(1);
}

describe.serial("model `fts` config reaches the engine in the application process", () => {
  const files: string[] = [];
  const file = (name: string) => {
    const path = join(tmpdir(), `orm_fts_${process.pid}_${Date.now()}_${name}.sqlite`);
    files.push(path);
    return path;
  };

  beforeEach(() => Search.reset());
  afterEach(async () => {
    Search.reset();
    await ConnectionManager.closeAll();
    for (const path of files.splice(0)) await cleanupSqliteFile(path);
  });

  test("SQLite: create-index in one process, save and search in another", async () => {
    const url = `sqlite://${file("app")}`;

    const cli = new Connection({ url });
    Model.setConnection(cli);
    Schema.setConnection(cli);
    await createSourceTables();
    await cliCreateIndexes(new SqliteFTS5Engine({ connection: cli }));
    await cli.driver.close();

    const app = new Connection({ url });
    Model.setConnection(app);
    Search.configure({ engine: "sqlite" });
    Search.register(_Article);
    Search.register(_Note);
    await appFlow();
  });

  test("SQLite: the default index name (the table name) never writes to or flushes the source table", async () => {
    const conn = new Connection({ url: `sqlite://${file("collision")}` });
    Model.setConnection(conn);
    Schema.setConnection(conn);
    await Schema.create("fts_articles", (t) => {
      t.increments("id"); t.string("title"); t.text("body"); t.string("status"); t.string("author").nullable();
    });
    const engine = new SqliteFTS5Engine({ shared: true });
    await engine.createIndex(Article.searchableAs());
    expect(await engine.indexExists("fts_articles")).toBe(true);
    Search.configure({ engine });
    Search.register(_Article);

    await Article.query().insert({ title: "seed", body: "b", status: "draft", author: "ana" });
    const saved = await Article.create({ title: "Rust", body: "b", status: "published" });
    await conn.run("UPDATE fts_articles SET author = 'bob' WHERE id = ?", [saved.id]);
    await saved.update({ title: "Rust 2" });

    expect(await conn.query("SELECT id, title, author FROM fts_articles ORDER BY id")).toEqual([
      { id: 1, title: "seed", author: "ana" },
      { id: 2, title: "Rust 2", author: "bob" },
    ]);
    await Article.removeAllFromSearch();
    expect(await Article.search("rust").raw()).toEqual([]);
    expect(await Article.query().count()).toBe(2);
  });

  test("SQLite: an index configured on the engine wins over the model's `fts`", async () => {
    const conn = new Connection({ url: `sqlite://${file("explicit")}` });
    Model.setConnection(conn);
    Schema.setConnection(conn);
    await createSourceTables();
    const engine = new SqliteFTS5Engine({ shared: true });
    engine.configureIndex("fts_articles", { columns: ["title"], unindexed: ["body", "status"] });
    await engine.createIndex("fts_articles");
    Search.configure({ engine });
    Search.register(_Article);

    await Article.create({ title: "Plain title", body: "rust in the body only", status: "published" });
    // `body` is unindexed in the engine's own config, so it does not match.
    expect(await Article.search("rust").raw()).toEqual([]);
  });

  test("SQLite: a queued job resolves the tenant-scoped index inside the worker's tenant context", async () => {
    const tenants = { a: file("tenant_a"), b: file("tenant_b") };
    await ConnectionManager.setTenantResolver(async (tenantId) => ({
      strategy: "database",
      name: `tenant_${tenantId}`,
      config: { url: `sqlite://${tenants[tenantId as "a" | "b"]}` },
    }));
    const tenantScope = (base: string, tenantId: string | null) => tenantId ? `${base}_t_${tenantId}` : base;
    Model.setConnection(new Connection({ url: `sqlite://${file("landlord")}` }));

    // CLI: `search:create-index Article --tenant=a` and `--tenant=b`.
    Search.configure({ engine: "sqlite", tenantScope });
    const cliEngine = new SqliteFTS5Engine({ shared: true });
    for (const tenant of ["a", "b"]) {
      await TenantContext.run(tenant, async () => {
        const index = Article.searchableAs();
        cliEngine.configureIndex(index, (Article as any).searchFtsConfig);
        await cliEngine.createIndex(index);
      });
    }
    Search.reset();

    // Web process builds the record under tenant a; the worker replays it.
    Search.configure({ engine: "sqlite", tenantScope, queue: { name: "search" } });
    Search.register(_Article);
    const record = await TenantContext.run("a", () =>
      makeSearchableRecord(new Article().forceFill({ id: 1, title: "Rust in tenant a", body: "x", status: "published" })));
    expect(record!.index).toBe("fts_articles_t_a");
    const job = new MakeSearchableJob(record!);
    await TenantContext.run("a", () => job.handle());

    expect(await TenantContext.run("a", () => Article.search("rust").raw()).then((hits) => hits.map((h) => h.id)))
      .toEqual([1]);
    expect(await TenantContext.run("b", () => Article.search("rust").raw())).toEqual([]);
  });

  test("an index with no engine config and no model `fts` still fails with a pointer to `fts`", async () => {
    const conn = new Connection({ url: `sqlite://${file("missing")}` });
    Model.setConnection(conn);
    Search.configure({ engine: "sqlite" });
    await expect(Search.engine().search({ index: "unknown_index", query: "x", filters: [], sorts: [] }))
      .rejects.toThrow('no schema configured for index "unknown_index"');
  });
});

const postgresUrl = process.env.POSTGRES_TEST_URL;
const runIfPostgres = postgresUrl ? test.serial : test.skip;

describe.serial("model `fts` config reaches the engine in the application process (PostgreSQL)", () => {
  afterEach(async () => {
    if (!postgresUrl) return;
    const conn = new Connection({ url: postgresUrl });
    for (const table of ["fts_articles", "fts_notes", "_fts_fts_articles", "_fts_fts_notes"]) {
      await conn.run(`DROP TABLE IF EXISTS ${table} CASCADE`);
    }
    await conn.driver.close();
    Search.reset();
    await ConnectionManager.closeAll();
  });

  runIfPostgres("create-index in one process, save and search in another", async () => {
    const cli = new Connection({ url: postgresUrl! });
    Model.setConnection(cli);
    Schema.setConnection(cli);
    for (const table of ["fts_articles", "fts_notes", "_fts_fts_articles", "_fts_fts_notes"]) {
      await cli.run(`DROP TABLE IF EXISTS ${table} CASCADE`);
    }
    await createSourceTables();
    // useTriggers off: the observer is what keeps the index in sync here.
    await cliCreateIndexes(new PostgresFTSEngine({ connection: cli, useTriggers: false }));
    await cli.driver.close();

    const app = new Connection({ url: postgresUrl! });
    Model.setConnection(app);
    Search.configure({ engine: "pg" });
    Search.register(_Article);
    Search.register(_Note);
    await appFlow();
  });
});

// Without `fts`, the index covers the model's table: text columns are searched,
// the others stored for filters, and neither the primary key nor `hidden`
// columns are indexed.
class _Plain extends Model.define<{ id: number; title: string; body: string; status: string; views: number; secret: string }>("plain_posts") {
  static fillable = ["title", "body", "status", "views", "secret"];
  static hidden = ["secret"];
  static timestamps = false;
}
const Plain = Search.register(_Plain);

class _Counter extends Model.define<{ id: number; hits: number }>("plain_counters") {
  static fillable = ["hits"];
  static timestamps = false;
}
const Counter = Search.register(_Counter);

async function createPlainTables(): Promise<void> {
  await Schema.create("plain_posts", (t) => {
    t.increments("id"); t.string("title"); t.text("body"); t.string("status"); t.integer("views"); t.string("secret");
  });
  await Schema.create("plain_counters", (t) => { t.increments("id"); t.integer("hits"); });
}

async function plainAppFlow(): Promise<void> {
  const rust = await Plain.create({ title: "Rust ownership", body: "borrowing", status: "published", views: 50, secret: "zebra" });
  const draft = await Plain.create({ title: "Draft", body: "rust macros", status: "draft", views: 5, secret: "zebra" });
  await Plain.create({ title: "Go channels", body: "select", status: "published", views: 80, secret: "zebra" });

  expect((await Plain.search("rust").get()).map((p) => p.id).sort()).toEqual([rust.id, draft.id]);
  expect((await Plain.search("published").get()).length).toBe(2);
  expect((await Plain.search("rust").where("status", "published").get()).map((p) => p.id)).toEqual([rust.id]);
  expect((await Plain.search("rust").where("views", ">", 10).get()).map((p) => p.id)).toEqual([rust.id]);
  expect(await Plain.search("zebra").raw()).toEqual([]);
  // An OR filter narrows the text match; it never adds rows the text does not match ("Go channels" has views 80).
  const either = Plain.search("rust").where("status", "draft").orWhere("views", ">", 60);
  expect((await either.get()).map((p) => p.id)).toEqual([draft.id]);
  expect((await either.paginate(10, 1)).total).toBe(1);
  expect(await Plain.search("rust").where("status", "draft").orWhere("views", ">", 60).facet("status").facetDistribution())
    .toEqual({ status: { draft: 1 } });
  expect(Object.keys((await Plain.search("rust").where("views", ">", 10).raw())[0]!.data).sort())
    .toEqual(["body", "status", "title", "views"]);

  await expect(Counter.search("x").raw()).rejects.toThrow('_Counter: table "plain_counters" has no text columns to search. Declare `fts` on the model.');
}

describe.serial("a model without `fts` indexes its table", () => {
  const files: string[] = [];
  afterEach(async () => {
    Search.reset();
    await ConnectionManager.closeAll();
    for (const path of files.splice(0)) await cleanupSqliteFile(path);
  });

  test("SQLite: create-index in one process, save and search in another", async () => {
    const path = join(tmpdir(), `orm_fts_${process.pid}_${Date.now()}_plain.sqlite`);
    files.push(path);

    const cli = new Connection({ url: `sqlite://${path}` });
    Model.setConnection(cli);
    Schema.setConnection(cli);
    await createPlainTables();
    await new SqliteFTS5Engine({ connection: cli }).createIndex(Plain.searchableAs());
    expect((await cli.query("SELECT name FROM pragma_table_info('_fts_plain_posts')") as any[]).map((r) => r.name))
      .toEqual(["title", "body", "status", "views"]);
    await cli.driver.close();

    const app = new Connection({ url: `sqlite://${path}` });
    Model.setConnection(app);
    Search.configure({ engine: "sqlite" });
    Search.register(_Plain);
    Search.register(_Counter);
    await plainAppFlow();
  });

  test("SQLite: an explicitly configured index does not read the table", async () => {
    const conn = new Connection({ url: "sqlite://:memory:" });
    Model.setConnection(conn);
    Schema.setConnection(conn);
    await createPlainTables();
    const engine = new SqliteFTS5Engine({ shared: true });
    engine.configureIndex("plain_counters", { columns: ["hits"] });
    await engine.createIndex("plain_counters");
    Search.configure({ engine });
    Search.register(_Counter);
    const counter = await Counter.create({ hits: 42 });
    expect((await Counter.search("42").raw()).map((h) => h.id)).toEqual([counter.id]);
  });

  runIfPostgres("PostgreSQL: create-index in one process, save and search in another", async () => {
    const drop = async (conn: Connection) => {
      for (const table of ["plain_posts", "plain_counters", "_fts_plain_posts", "_fts_plain_counters"]) {
        await conn.run(`DROP TABLE IF EXISTS ${table} CASCADE`);
      }
    };
    const cli = new Connection({ url: postgresUrl! });
    Model.setConnection(cli);
    Schema.setConnection(cli);
    await drop(cli);
    await createPlainTables();
    await new PostgresFTSEngine({ connection: cli }).createIndex(Plain.searchableAs());
    await cli.driver.close();

    const app = new Connection({ url: postgresUrl! });
    Model.setConnection(app);
    Search.configure({ engine: "pg" });
    Search.register(_Plain);
    Search.register(_Counter);
    try {
      await plainAppFlow();
    } finally {
      await drop(app);
    }
  });
});
