import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Connection, ConnectionManager, Model, Schema } from "../src/index.js";
import { Search } from "../src/search/index.js";
import { PostgresFTSEngine } from "../src/search/engines/PostgresFTSEngine.js";

const postgresUrl = process.env.POSTGRES_TEST_URL;
const runIfPostgres = postgresUrl ? test.serial : test.skip;

interface PgPostAttributes {
  id: number;
  title: string;
  body: string;
  status: string;
  views: number;
}

class PgPost extends Model.define<PgPostAttributes>("pg_posts") {
  static fillable = ["title", "body", "status", "views"];
  static timestamps = false;
}

describe.serial("PostgreSQL FTS Engine Integration", () => {
  let connection: Connection;
  let engine: PostgresFTSEngine;

  beforeEach(async () => {
    if (!postgresUrl) return;
    connection = new Connection({ url: postgresUrl });
    ConnectionManager.setDefault(connection);
    (PgPost as any).connection = connection;
    Schema.setConnection(connection);

    // Clean start
    await connection.run(`DROP TABLE IF EXISTS pg_posts CASCADE`);
    await connection.run(`DROP TABLE IF EXISTS _fts_pg_posts CASCADE`);

    // Create main table
    await Schema.create("pg_posts", (table) => {
      table.increments("id");
      table.string("title");
      table.text("body");
      table.string("status");
      table.integer("views");
    });

    engine = new PostgresFTSEngine({
      connection,
      prefix: "_fts_",
      useTriggers: true,
    });

    Search.reset();
    Search.configure({ engine });
  });

  afterEach(async () => {
    if (!postgresUrl) return;
    try {
      await connection.run(`DROP TABLE IF EXISTS pg_posts CASCADE`);
      await connection.run(`DROP TABLE IF EXISTS _fts_pg_posts CASCADE`);
      await connection.run(`DROP FUNCTION IF EXISTS _fts_pg_posts_sync() CASCADE`);
    } catch {
      // ignore
    }
    delete (PgPost as any).connection;
    Search.reset();
    await ConnectionManager.closeAll();
  });

  runIfPostgres("registers index and creates shadow table + GIN index", async () => {
    engine.configureIndex("pg_posts", {
      columns: ["title", "body"],
      unindexed: ["status", "views"],
    });

    expect(await engine.indexExists("pg_posts")).toBe(false);

    await engine.createIndex("pg_posts");

    expect(await engine.indexExists("pg_posts")).toBe(true);

    const diagnostics = await engine.diagnostics();
    expect(diagnostics.indexes).toContain("pg_posts");
    expect(diagnostics.index_rows).toHaveProperty("pg_posts");

    await engine.deleteIndex("pg_posts");
    expect(await engine.indexExists("pg_posts")).toBe(false);
  });

  runIfPostgres("performs basic manual updates, queries, and deletions", async () => {
    engine.configureIndex("pg_posts", {
      columns: ["title", "body"],
      unindexed: ["status", "views"],
    });
    await engine.createIndex("pg_posts");

    // Insert records
    await engine.update([
      {
        index: "pg_posts",
        id: 1,
        data: { title: "Getting Started with ORM", body: "An Eloquent-style Bun native ORM", status: "published", views: 100 },
      },
      {
        index: "pg_posts",
        id: 2,
        data: { title: "Advanced PostgreSQL FTS", body: "How to use native Postgres full text search", status: "draft", views: 10 },
      },
    ]);

    // Search query FTS match
    let hits = await engine.search({
      index: "pg_posts",
      query: "ORM ORM",
      filters: [],
      sorts: [],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe("1");
    expect(hits[0].data.title).toBe("Getting Started with ORM");

    // Search query FTS match 2
    hits = await engine.search({
      index: "pg_posts",
      query: "Postgres",
      filters: [],
      sorts: [],
    });
    expect(hits).toHaveLength(1);
    expect(hits.some((hit) => hit.id === "2")).toBe(true);

    // Pagination
    const page = await engine.paginate(
      {
        index: "pg_posts",
        query: "Started OR FTS",
        filters: [],
        sorts: [],
      },
      15,
      1,
    );
    expect(page.hits).toHaveLength(2);
    expect(page.total).toBe(2);

    // Delete a record
    await engine.delete([{ index: "pg_posts", id: 1, data: {} }]);
    hits = await engine.search({
      index: "pg_posts",
      query: "ORM",
      filters: [],
      sorts: [],
    });
    expect(hits).toHaveLength(0);
  });

  runIfPostgres("supports advanced filters (where, whereIn, whereBetween, whereNull, groups)", async () => {
    engine.configureIndex("pg_posts", {
      columns: ["title", "body"],
      unindexed: ["status", "views"],
    });
    await engine.createIndex("pg_posts");

    await engine.update([
      { index: "pg_posts", id: 1, data: { title: "Post A", body: "Hello standard", status: "active", views: 25 } },
      { index: "pg_posts", id: 2, data: { title: "Post B", body: "Hello advanced", status: "active", views: 50 } },
      { index: "pg_posts", id: 3, data: { title: "Post C", body: "Draft version", status: "draft", views: 5 } },
      { index: "pg_posts", id: 4, data: { title: "Post D", body: "Unpublished post", status: null, views: 0 } },
    ]);

    // where filter
    let hits = await engine.search({
      index: "pg_posts",
      query: "Hello",
      filters: [{ kind: "cmp", bool: "and", field: "status", op: "=", value: "active" }],
      sorts: [],
    });
    expect(hits).toHaveLength(2);

    // whereIn filter
    hits = await engine.search({
      index: "pg_posts",
      query: "Post",
      filters: [{ kind: "in", bool: "and", field: "status", values: ["draft", "active"] }],
      sorts: [],
    });
    expect(hits).toHaveLength(3);

    // whereBetween filter
    hits = await engine.search({
      index: "pg_posts",
      query: "Post",
      filters: [{ kind: "between", bool: "and", field: "views", from: 20, to: 60 }],
      sorts: [],
    });
    expect(hits).toHaveLength(2);

    // whereNull filter
    hits = await engine.search({
      index: "pg_posts",
      query: "post",
      filters: [{ kind: "null", bool: "and", field: "status" }],
      sorts: [],
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe("4");

    // Grouping filter (AND + OR combination)
    hits = await engine.search({
      index: "pg_posts",
      query: "Post",
      filters: [
        {
          kind: "group",
          bool: "and",
          filters: [
            { kind: "cmp", bool: "and", field: "status", op: "=", value: "active" },
            { kind: "cmp", bool: "or", field: "status", op: "=", value: "draft" },
          ],
        },
      ],
      sorts: [],
    });
    expect(hits).toHaveLength(3);
  });

  runIfPostgres("computes facets and facetRanges correctly", async () => {
    engine.configureIndex("pg_posts", {
      columns: ["title", "body"],
      unindexed: ["status", "views"],
    });
    await engine.createIndex("pg_posts");

    await engine.update([
      { index: "pg_posts", id: 1, data: { title: "Alpha article", body: "Testing facets", status: "active", views: 10 } },
      { index: "pg_posts", id: 2, data: { title: "Bravo article", body: "Testing facets", status: "active", views: 30 } },
      { index: "pg_posts", id: 3, data: { title: "Charlie article", body: "Testing facets", status: "draft", views: 100 } },
    ]);

    const page = await engine.paginate(
      {
        index: "pg_posts",
        query: "facets",
        filters: [],
        sorts: [],
        facets: ["status"],
        facetRanges: [{ field: "views", buckets: [0, 20, 50, 150] }],
      },
      15,
      1,
    );

    expect(page.facetDistribution).toBeDefined();
    const fd = page.facetDistribution!;
    expect(fd.status).toEqual({ active: 2, draft: 1 });
    expect(fd.views).toEqual({ "0-20": 1, "20-50": 1, "50-150": 1, "150+": 0 });
  });

  runIfPostgres("supports ts_headline highlighting and cropping", async () => {
    engine.configureIndex("pg_posts", {
      columns: ["title", "body"],
      unindexed: ["status"],
    });
    await engine.createIndex("pg_posts");

    await engine.update([
      {
        index: "pg_posts",
        id: 1,
        data: {
          title: "Postgres search highlighting",
          body: "Postgres text headline search is powerful. Highlight works incredibly well in custom tags.",
          status: "active",
        },
      },
    ]);

    const hits = await engine.search({
      index: "pg_posts",
      query: "search powerful",
      filters: [],
      sorts: [],
      highlight: {
        fields: ["title"],
        preTag: "<b>",
        postTag: "</b>",
      },
      crop: [
        { field: "body", length: 6 },
      ],
    });

    expect(hits).toHaveLength(1);
    expect(hits[0].formatted).toBeDefined();
    const fmt = hits[0].formatted!;
    // Highlight
    expect(fmt.title).toContain("<b>search</b>");
    // Crop
    expect(fmt.body).toContain("<b>powerful</b>");
  });

  runIfPostgres("automatically synchronizes indexes via triggers", async () => {
    // Configure searchable model
    Search.register(PgPost, {
      index: "pg_posts",
      fts: {
        columns: ["title", "body"],
        unindexed: ["status", "views"],
        contentTable: "pg_posts",
        contentRowid: "id",
      },
    });

    // Bridge the model's fts config to the engine (same as CLI commands do)
    engine.configureIndex("pg_posts", {
      columns: ["title", "body"],
      unindexed: ["status", "views"],
      contentTable: "pg_posts",
      contentRowid: "id",
    });

    // Triggers will be set up during index creation
    await engine.createIndex("pg_posts");

    // 1. Create a model row natively in DB
    const post = await PgPost.create({
      title: "Automatic Trigger Sync",
      body: "Database trigger keeps index in sync",
      status: "active",
      views: 55,
    } as any);

    // Wait short moment for DB transaction commit to settle triggers
    await new Promise((r) => setTimeout(r, 20));

    // Verify trigger auto-inserted into index shadow table.
    let results = await engine.search({ index: "pg_posts", query: "Trigger", filters: [], sorts: [] });
    expect(results).toHaveLength(1);
    expect(results[0].data.title).toBe("Automatic Trigger Sync");

    // 2. Update model natively in DB
    post.setAttribute("body", "Trigger updated the search content");
    await post.save();

    await new Promise((r) => setTimeout(r, 20));

    results = await engine.search({ index: "pg_posts", query: "content", filters: [], sorts: [] });
    expect(results).toHaveLength(1);
    expect(results[0].data.body).toBe("Trigger updated the search content");

    // 3. Delete model natively in DB
    await post.delete();

    await new Promise((r) => setTimeout(r, 20));

    results = await engine.search({ index: "pg_posts", query: "Trigger", filters: [], sorts: [] });
    expect(results).toHaveLength(0);
  });

  runIfPostgres("rebuilds the index from the content table correctly", async () => {
    engine.configureIndex("pg_posts", {
      columns: ["title", "body"],
      unindexed: ["status", "views"],
      contentTable: "pg_posts",
      contentRowid: "id",
    });

    await engine.createIndex("pg_posts");

    // Insert directly to main database table (bypass identity column default)
    await connection.run(`
      INSERT INTO pg_posts (id, title, body, status, views)
      OVERRIDING SYSTEM VALUE
      VALUES (99, 'Rebuild test title', 'This is content to be rebuilt', 'active', 77)
    `);

    // Verify index doesn't have it yet (because we inserted directly and trigger wasn't fired, or we dropped it temporarily)
    await engine.flush("pg_posts");
    let hits = await engine.search({ index: "pg_posts", query: "Rebuild", filters: [], sorts: [] });
    expect(hits).toHaveLength(0);

    // Perform rebuild
    await engine.rebuild("pg_posts");

    // Verify index now has it
    hits = await engine.search({ index: "pg_posts", query: "Rebuild", filters: [], sorts: [] });
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe("99");
    expect(hits[0].data.title).toBe("Rebuild test title");
  });
});
