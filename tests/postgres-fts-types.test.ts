/**
 * Compile-time intellisense / type assertions for the PostgresFTSEngine API.
 *
 * Real checks performed by `tsc -p tsconfig.test.json`. If any type guarantee
 * regresses, type-checking fails. Runtime body is trivial — the test just
 * verifies that the assertion function is callable without runtime errors.
 */
import { test, expect } from "./harness.js";
import { Connection, Model } from "../src/index.js";
import {
  Search,
  PostgresFTSEngine,
  type PostgresFTSEngineOptions,
  type PostgresFTSIndexConfig,
  type SearchEngine,
  type SearchHit,
  type SearchPage,
  type SearchHealth,
  type SearchMultiResult,
  type SearchableRecord,
  type FacetDistribution,
} from "../src/search/index.js";

function expectType<T>(_v: T): void {}
function expectAssignable<T>(_v: T): void {}

function _pgFtsTypeAssertions(): void {
  if (false as boolean) {
    // ── Constructor signatures ─────────────────────────────────────────────

    // Empty options uses defaults.
    const engine1 = new PostgresFTSEngine();
    expectAssignable<SearchEngine>(engine1);

    // Explicit connection option.
    const conn = new Connection({ url: "postgres://localhost/db" });
    const engine2 = new PostgresFTSEngine({ connection: conn });
    expectAssignable<SearchEngine>(engine2);

    // Shared mode (uses default ORM connection).
    const engine3 = new PostgresFTSEngine({ shared: true });
    expectAssignable<SearchEngine>(engine3);

    // Full options with pre-registered indexes.
    const engine4 = new PostgresFTSEngine({
      connection: conn,
      prefix: "_fts_",
      defaultLanguage: "english",
      useTriggers: true,
      indexes: {
        posts: {
          columns: ["title", "body"],
          unindexed: ["status", "views"],
          language: "spanish",
          contentTable: "posts",
          contentRowid: "id",
        },
      },
    });
    expectAssignable<SearchEngine>(engine4);

    // ── Options shape validation ──────────────────────────────────────────

    const opts: PostgresFTSEngineOptions = {
      prefix: "_search_",
      defaultLanguage: "simple",
      useTriggers: false,
    };
    expectAssignable<PostgresFTSEngineOptions>(opts);

    // Shared and connection are mutually exclusive at runtime, but both
    // are optional in the type.
    const opts2: PostgresFTSEngineOptions = { shared: true };
    expectType<boolean | undefined>(opts2.shared);
    expectType<Connection | undefined>(opts2.connection);

    // ── Index config shape ────────────────────────────────────────────────

    const cfg: PostgresFTSIndexConfig = {
      columns: ["title", "body"],
      unindexed: ["status"],
      language: "german",
      contentTable: "articles",
      contentRowid: "article_id",
      triggerWhere: {
        insert: "NEW.published = true",
        update: "NEW.published = true",
        delete: "OLD.published = true",
      },
    };
    expectType<string[]>(cfg.columns);
    expectType<string[] | undefined>(cfg.unindexed);
    expectType<string | undefined>(cfg.language);
    expectType<string | undefined>(cfg.contentTable);
    expectType<string | undefined>(cfg.contentRowid);

    // triggerWhere shape — all fields optional.
    const tw = cfg.triggerWhere!;
    expectType<string | undefined>(tw.insert);
    expectType<string | undefined>(tw.update);
    expectType<string | undefined>(tw.delete);

    // Minimal config — only columns required.
    const minCfg: PostgresFTSIndexConfig = { columns: ["name"] };
    expectType<string[]>(minCfg.columns);

    // ── configureIndex ────────────────────────────────────────────────────

    engine1.configureIndex("posts", {
      columns: ["title", "body"],
      unindexed: ["status"],
    });

    // ── Engine method return types ────────────────────────────────────────

    // update & delete accept SearchableRecord[]
    const records: SearchableRecord[] = [
      { index: "posts", id: 1, data: { title: "Hello" } },
    ];
    expectType<Promise<void>>(engine1.update(records));
    expectType<Promise<void>>(engine1.delete(records));

    // search returns SearchHit[]
    expectType<Promise<SearchHit[]>>(
      engine1.search({
        index: "posts",
        query: "hello",
        filters: [],
        sorts: [],
      }),
    );

    // paginate returns SearchPage
    expectType<Promise<SearchPage>>(
      engine1.paginate(
        { index: "posts", query: "hello", filters: [], sorts: [] },
        15,
        1,
      ),
    );

    // flush, createIndex, deleteIndex return void
    expectType<Promise<void>>(engine1.flush("posts"));
    expectType<Promise<void>>(engine1.createIndex("posts"));
    expectType<Promise<void>>(engine1.createIndex("posts", {}));
    expectType<Promise<void>>(engine1.deleteIndex("posts"));
    expectType<boolean>(engine1.capabilities().indexSettings);

    // indexExists returns boolean
    expectType<Promise<boolean>>(engine1.indexExists("posts"));

    // health returns SearchHealth
    expectType<Promise<SearchHealth>>(engine1.health());

    // multiSearch returns SearchMultiResult[]
    expectType<Promise<SearchMultiResult[]>>(
      engine1.multiSearch([
        { index: "posts", query: "a", filters: [], sorts: [] },
        { index: "posts", query: "b", filters: [], sorts: [] },
      ]),
    );

    // rebuild returns void
    expectType<Promise<void>>(engine1.rebuild("posts"));

    // diagnostics returns Record
    expectType<Promise<Record<string, unknown>>>(engine1.diagnostics());

    // ── SearchPage shape ──────────────────────────────────────────────────

    const page: SearchPage = {
      hits: [{ id: "1", data: { title: "x" } }],
      total: 1,
      page: 1,
      perPage: 10,
      facetDistribution: { status: { active: 5 } },
    };
    expectType<SearchHit[]>(page.hits);
    expectType<number>(page.total);
    expectType<number>(page.page);
    expectType<number>(page.perPage);
    expectType<FacetDistribution | undefined>(page.facetDistribution);

    // ── SearchHit shape from Postgres engine ──────────────────────────────

    const hit: SearchHit = {
      id: "42",
      data: { title: "Postgres FTS", body: "Full text search" },
      score: 0.65,
      formatted: {
        title: "<b>Postgres</b> FTS",
        body: "<b>Full</b> text <b>search</b>",
      },
    };
    expectType<string | number>(hit.id);
    expectType<Record<string, unknown>>(hit.data);
    expectType<number | undefined>(hit.score);
    expectType<Record<string, unknown> | undefined>(hit.formatted);

    // ── Search.configure accepts PostgresFTSEngine ────────────────────────

    Search.configure({ engine: engine1 });
    Search.configure({
      engine: new PostgresFTSEngine({ shared: true }),
      batch: { maxItems: 50, maxMs: 200 },
    });
    Search.configure({
      engine: new PostgresFTSEngine({ connection: conn, prefix: "_idx_" }),
      tenantScope: (base, tid) => (tid ? `${base}_${tid}` : base),
    });

    // ── Integration with Search.register / Model ──────────────────────────

    class PgArticle extends Model.define<{
      id: number;
      title: string;
      body: string;
      status: string;
    }>("pg_articles") {
      static fillable = ["title", "body", "status"];
    }

    // register with fts config
    const Registered = Search.register(PgArticle, {
      index: "pg_articles",
      fts: {
        columns: ["title", "body"],
        unindexed: ["status"],
        contentTable: "pg_articles",
        contentRowid: "id",
      },
    });

    // Static methods present after registration.
    expectType<string>(Registered.searchableAs());
    expectAssignable<any>(Registered.search("hello"));
    expectType<Promise<void>>(Registered.makeAllSearchable());
    expectType<Promise<void>>(Registered.removeAllFromSearch());

    // fts config stored as opaque Record<string, unknown>.
    const ftsConfig: Record<string, unknown> | undefined =
      (Registered as any).searchFtsConfig;
    void ftsConfig;

    // ── Negative checks ───────────────────────────────────────────────────

    // @ts-expect-error - configureIndex requires a config object.
    engine1.configureIndex("posts");
    // @ts-expect-error - columns is required in PostgresFTSIndexConfig.
    const bad: PostgresFTSIndexConfig = { unindexed: ["x"] };
    void bad;
    // @ts-expect-error - prefix must be string.
    new PostgresFTSEngine({ prefix: 42 });
    // @ts-expect-error - defaultLanguage must be string.
    new PostgresFTSEngine({ defaultLanguage: true });
    // @ts-expect-error - useTriggers must be boolean.
    new PostgresFTSEngine({ useTriggers: "yes" });
    // @ts-expect-error - search requires query object, not a string.
    engine1.search("hello");
    // @ts-expect-error - paginate requires perPage and page numbers.
    engine1.paginate({ index: "x", query: "", filters: [], sorts: [] });
  }
}

test("PostgresFTSEngine type assertions compile", () => {
  expect(typeof _pgFtsTypeAssertions).toBe("function");
});
