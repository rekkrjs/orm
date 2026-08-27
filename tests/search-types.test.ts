/**
 * Compile-time intellisense / type assertions for the search API.
 *
 * Real checks performed by `tsc -p tsconfig.test.json`. If any guarantee
 * regresses, type-checking fails. Runtime body is trivial.
 */
import { test, expect } from "bun:test";
import { Collection, Connection, Model } from "../src/index.js";
import {
  Search,
  Searchable,
  SearchBuilder,
  MeilisearchEngine,
  type SearchableModelConstructor,
  type SearchHit,
  type SearchPaginatorResult,
  type SearchSimplePaginatorResult,
  type SearchFetchResult,
  type SearchPage,
  type SearchMultiResult,
  type FacetDistribution,
  type MatchPosition,
  type SearchCapabilities,
} from "../src/search/index.js";

function expectType<T>(_v: T): void {}
function expectAssignable<T>(_v: T): void {}

// ── Style 1: Search.define ──────────────────────────────────────────────────

class _TPost extends Model.define<{ id: number; title: string; status: string }>("t_posts") {
  static fillable = ["title", "status"];
}
const TPost = Search.define(_TPost, {
  index: "t_posts_v2",
  shouldBeSearchable: (m) => {
    expectType<string>(m.getAttribute("status"));
    return m.getAttribute("status") === "published";
  },
  toSearchableArray: (m) => ({
    id: m.getAttribute("id"),
    title: m.getAttribute("title"),
  }),
});

// ── Style 2: Search.register on an existing class ───────────────────────────

class _TArticle extends Model.define<{ id: number; body: string }>("t_articles") {
  static fillable = ["body"];
}
const TArticle = Search.register(_TArticle, {
  index: "articles",
  shouldBeSearchable: (m) => {
    expectType<string>(m.getAttribute("body"));
    return true;
  },
});

class _TComment extends Model.define<{ id: number; body: string }>("t_comments") {
  static fillable = ["body"];
}
const TComment = Search.define(_TComment, {
  index: "comments",
  shouldBeSearchable: (m) => {
    expectType<string>(m.getAttribute("body"));
    return true;
  },
});

// ── Style 3: Searchable mixin ───────────────────────────────────────────────

class TWidget extends Searchable(
  Model.define<{ id: number; name: string }>("t_widgets"),
  { index: "widgets" },
) {
  static fillable = ["name"];
}

type PostBase = _TPost;

function _typeAssertions(): void {
  if (false as boolean) {
    // Static API exists on each style. Builder<M> = base attribute shape.
    expectAssignable<SearchBuilder<PostBase>>(TPost.search("foo"));
    expectAssignable<SearchBuilder<any>>(TArticle.search("foo"));
    expectAssignable<SearchBuilder<_TComment>>(TComment.search("foo"));
    expectAssignable<SearchBuilder<any>>(TWidget.search("foo"));

    // searchableAs() returns string on all styles.
    expectType<string>(TPost.searchableAs());
    expectType<string>(TArticle.searchableAs());
    expectType<string>(TComment.searchableAs());
    expectType<string>(TWidget.searchableAs());

    // Builder chain methods return SearchBuilder<M> for fluent chaining.
    const chained = TPost.search("foo")
      .where("status", "published")
      .where("rank", ">", 5)
      .whereNot("type", "draft")
      .whereIn("tag", ["a", "b"])
      .whereNotIn("category", ["spam"])
      .whereBetween("price", [1, 9])
      .whereNotBetween("price", [10, 20])
      .whereNull("deleted_at")
      .whereNotNull("published_at")
      .whereExists("title")
      .whereDoesntExist("archived_at")
      .whereRaw("foo > 1")
      .orWhere("featured", true)
      .orWhereIn("tag", ["x"])
      .orWhereNotIn("tag", ["y"])
      .orWhereBetween("rank", [1, 2])
      .orWhereNotBetween("rank", [3, 4])
      .orWhereRaw("bar < 2")
      .where((q) => {
        // Callback receives a child builder of the same M.
        expectAssignable<SearchBuilder<PostBase>>(q);
        q.where("a", "=", 1).orWhere("b", "=", 2);
      })
      .orderBy("created_at", "desc")
      .take(10)
      .with("comments", "author");
    expectAssignable<SearchBuilder<PostBase>>(chained);

    // Execution shapes carry the model type.
    expectAssignable<Promise<Collection<PostBase>>>(chained.get());
    expectType<Promise<SearchHit[]>>(chained.raw());
    expectAssignable<Promise<SearchPaginatorResult<PostBase>>>(chained.paginate(15, 1));
    expectAssignable<Promise<SearchPage>>(chained.rawPaginate(15, 1));
    expectAssignable<Promise<SearchSimplePaginatorResult<PostBase>>>(chained.simplePaginate(15, 1));

    // Cursor is an AsyncGenerator of base model type.
    expectAssignable<AsyncGenerator<PostBase>>(chained.cursor(50));

    // Instance methods exposed by every style.
    const post = new TPost();
    const article = new (TArticle as any)();
    const comment = new TComment();
    const widget = new TWidget();
    expectType<Promise<void>>(post.searchable());
    expectType<Promise<void>>(post.unsearchable());
    expectType<Promise<void>>(article.searchable());
    expectType<Promise<void>>(comment.searchable());
    expectType<Promise<void>>(widget.searchable());

    // register() returns a SearchableModelConstructor.
    expectAssignable<SearchableModelConstructor<_TArticle>>(TArticle);
    expectAssignable<SearchableModelConstructor<_TComment>>(TComment);

    // Model attributes still flow through .getAttribute() on the typed shape.
    expectType<number>(post.getAttribute("id"));
    expectType<string>(post.getAttribute("title"));

    // Engine API — Search.configure accepts MeilisearchEngine instance.
    Search.configure({ engine: new MeilisearchEngine({ host: "http://x" }) });
    Search.configure({ engine: "meilisearch" });
    Search.configure({ engine: "meili" });
    Search.configure({ engine: "pg" });
    Search.configure({ engine: "postgres" });
    Search.configure({ engine: "postgres-fts" });
    Search.configure({ engine: "sqlite" });
    Search.configure({ engine: "sqlite-fts5" });
    Search.configure({ engine: "pg", connection: { url: "postgres://localhost/postgres" } });
    Search.configure({ engine: "sqlite", connection: { url: "sqlite://:memory:" } });
    Search.configure({ engine: "sqlite", connection: new Connection({ url: "sqlite://:memory:" }) });
    Search.configure({ engine: "meilisearch", host: "http://localhost:7700" });
    Search.configure({ engine: "meilisearch", apiKey: "secret" });
    Search.configure({ engine: "meilisearch", host: "http://localhost:7700", apiKey: "secret" });
    Search.configure({
      engine: new MeilisearchEngine({ host: "http://x" }),
      queue: { name: "scout" },
      chunk: 100,
    });

    // Negative checks: unsupported operations should error.
    // @ts-expect-error - search() requires string query.
    TPost.search(42);
    // @ts-expect-error - unknown search engine alias.
    Search.configure({ engine: "elastic" });
    // @ts-expect-error - connection must be a Connection or ConnectionConfig.
    Search.configure({ engine: "sqlite", connection: "search" });
    // @ts-expect-error - Meilisearch alias does not accept database connection.
    Search.configure({ engine: "meilisearch", connection: { url: "sqlite://:memory:" } });
    // @ts-expect-error - host must be a string.
    Search.configure({ engine: "meilisearch", host: 123 });
    // @ts-expect-error - apiKey must be a string.
    Search.configure({ engine: "meilisearch", apiKey: 123 });
    // @ts-expect-error - PostgreSQL alias does not accept Meilisearch host.
    Search.configure({ engine: "pg", host: "http://localhost:7700" });
    // @ts-expect-error - SQLite alias does not accept Meilisearch API key.
    Search.configure({ engine: "sqlite", apiKey: "secret" });
    // @ts-expect-error - custom engine instances do not accept alias options.
    Search.configure({ engine: new MeilisearchEngine({ host: "http://x" }), host: "http://localhost:7700" });
    // @ts-expect-error - non-searchable Model.define result has no .search() static.
    Model.define<{ id: number }>("nope").search("x");
    // @ts-expect-error - chunkSize must be number.
    chained.cursor("nope");

    // ── Field autocomplete ───────────────────────────────────────────────────

    // Known fields type-check.
    TPost.search("").where("status", "published");
    TPost.search("").where("title", "x");
    TPost.search("").where("id", ">", 5);
    TPost.search("").orderBy("created_at", "desc");
    TPost.search("").whereIn("status", ["published", "draft"]);
    TPost.search("").whereBetween("id", [1, 10]);

    // Value type follows field type.
    // @ts-expect-error - status is "draft" | "published", number not allowed.
    TPost.search("").where("status", 42);
    // @ts-expect-error - id is number, string not allowed.
    TPost.search("").where("id", "abc");
    // @ts-expect-error - whereIn values must match field type.
    TPost.search("").whereIn("id", ["abc"]);

    // Unknown fields still accepted (LiteralUnion preserves escape hatch for
    // computed/virtual fields like `meta.foo`), but autocomplete shows known.
    TPost.search("").where("meta.locale" as any, "en");
    TPost.search("").whereRaw("computed > 5");

    // ── Extended builder API: facets, minScore, boost, highlight, crop ──────

    const ext = TPost.search("rust")
      .facet("status")
      .facets("status", "title")
      .minScore(0.4)
      .searchOn("title", "status")
      .retrieve("id", "title")
      .display("id", "title")
      .boost("title")
      .highlight("title", "status")
      .highlightTags("<em>", "</em>")
      .crop("title", 80)
      .crop("status")
      .withScore()
      .thenBy("title", "desc");
    expectAssignable<SearchBuilder<PostBase>>(ext);

    // Negative: argument types enforced where literal types apply.
    // (Field params use LiteralUnion: known names autocomplete, arbitrary
    // strings remain accepted as an escape hatch for virtual/computed fields.)
    // @ts-expect-error - minScore is a number.
    TPost.search("").minScore("high");
    // @ts-expect-error - highlightTags first arg must be string.
    TPost.search("").highlightTags(42, "</em>");
    // @ts-expect-error - crop length must be number.
    TPost.search("").crop("title", "long");
    // @ts-expect-error - retrieve fields must be strings.
    TPost.search("").retrieve(123);
    // @ts-expect-error - facets is variadic of strings.
    TPost.search("").facets(123);
    // @ts-expect-error - withScore takes no args.
    TPost.search("").withScore(true);

    // ── Result shapes ───────────────────────────────────────────────────────

    expectAssignable<Promise<SearchFetchResult<PostBase>>>(ext.fetch());
    expectAssignable<Promise<SearchFetchResult<PostBase>>>(ext.fetch(50));
    expectAssignable<Promise<FacetDistribution>>(ext.facetDistribution());

    // paginate result optionally carries facetDistribution.
    const page: SearchPaginatorResult<PostBase> = {
      data: new Collection<PostBase>(),
      total: 0,
      page: 1,
      perPage: 10,
      facetDistribution: { status: { published: 5 } },
    };
    expectType<FacetDistribution | undefined>(page.facetDistribution);

    // SearchHit carries rich optional fields.
    const hit: SearchHit = {
      id: 1,
      data: { title: "x" },
      score: 0.5,
      formatted: { title: "<b>x</b>" },
      matchesPosition: { title: [{ start: 0, length: 1 }] },
    };
    expectType<number | undefined>(hit.score);
    expectType<Record<string, unknown> | undefined>(hit.formatted);
    expectType<Record<string, MatchPosition[]> | undefined>(hit.matchesPosition);

    // ── Search.multi — typed return ─────────────────────────────────────────

    expectAssignable<Promise<SearchMultiResult[]>>(
      Search.multi([TPost.search("a"), TArticle.search("b") as any]),
    );
    expectAssignable<Promise<SearchMultiResult[]>>(Search.multi([]));

    // @ts-expect-error - must be a list of builders.
    Search.multi("not-an-array");

    // ── New statics: makeAllSearchable / removeAllFromSearch ────────────────

    expectType<Promise<void>>(TPost.makeAllSearchable());
    expectType<Promise<void>>(TPost.makeAllSearchable(250));
    expectType<Promise<void>>(TPost.removeAllFromSearch());

    // @ts-expect-error - chunk must be a number.
    TPost.makeAllSearchable("big");
    // @ts-expect-error - takes no args.
    TPost.removeAllFromSearch("x");

    // ── trashed() instance method on Model ──────────────────────────────────

    expectType<boolean>(post.trashed());

    // ── Search.configure accepts new `batch` option ─────────────────────────

    Search.configure({
      engine: new MeilisearchEngine({ host: "http://x" }),
      batch: { maxItems: 100, maxMs: 500 },
    });
    Search.configure({
      engine: new MeilisearchEngine({ host: "http://x" }),
      queue: { name: "search", connection: "search-driver" },
    });
    // @ts-expect-error - maxItems is a number.
    Search.configure({ engine: new MeilisearchEngine({ host: "http://x" }), batch: { maxItems: "many" } });

    // ── Search.enqueueUpdate / flushPending exist ───────────────────────────

    expectType<boolean>(Search.enqueueUpdate({ index: "x", id: 1, data: {} }));
    expectType<boolean>(Search.enqueueDelete({ index: "x", id: 1, data: {} }));
    expectType<boolean>(Search.isBatching());
    expectType<Promise<void>>(Search.flushPending());

    // ── New builder ops: matchRaw, bm25Weights, facetRange, whereRaw bindings

    const adv = TPost.search("rust*")
      .matchRaw("rust*")
      .bm25Weights([10, 1])
      .facetRange("id", [0, 100, 500])
      .facetRange("id", [0, 50], ["small", "large"])
      .whereRaw("status = ?", ["published"]);
    expectAssignable<SearchBuilder<PostBase>>(adv);

    // @ts-expect-error - bm25Weights expects number[]
    TPost.search("").bm25Weights(["a"]);
    // @ts-expect-error - matchRaw takes a string
    TPost.search("").matchRaw(123);
    // @ts-expect-error - facetRange buckets must be number[]
    TPost.search("").facetRange("id", ["a"]);

    // ── Tenant scope config + Search.indexFor ───────────────────────────────

    Search.configure({
      engine: new MeilisearchEngine({ host: "http://x" }),
      tenantScope: (base, tenantId) => tenantId ? `${base}_t_${tenantId}` : base,
    });
    expectType<string>(Search.indexFor("posts"));
    expectType<string>(Search.indexFor("posts", "42"));
    expectType<string>(Search.indexFor("posts", null));

    // @ts-expect-error - tenantScope is a function
    Search.configure({ engine: new MeilisearchEngine({ host: "http://x" }), tenantScope: "nope" });

    // ── Batch tenant resolution ─────────────────────────────────────────────

    expectType<Record<string, string>>(Search.indexesFor("posts", ["1", "2", null]));
    expectAssignable<Promise<Record<string, string>>>(Search.indexesForAllTenants("posts"));
    expectAssignable<Promise<Record<string, string>>>(
      Search.indexesForAllTenants("posts", { includeLandlord: true }),
    );

    Search.configure({
      engine: new MeilisearchEngine({ host: "http://x" }),
      tenantScope: (b, tid) => tid ? `${b}_${tid}` : b,
      listTenants: () => ["a", "b"],
    });
    Search.configure({
      engine: new MeilisearchEngine({ host: "http://x" }),
      listTenants: async () => ["a", "b"],
    });

    // ── Engine.indexExists is optional ──────────────────────────────────────

    const meiliEng = new MeilisearchEngine({ host: "http://x" });
    expectType<Promise<boolean>>(meiliEng.indexExists("posts"));
    expectType<SearchCapabilities>(Search.capabilities());
    expectType<boolean>(Search.supports("indexSettings"));
    expectType<boolean>(Search.supports("nativeMultiSearch"));
    // @ts-expect-error - unknown capability.
    Search.supports("unknown");
  }
}

test("search type assertions compile", () => {
  expect(typeof _typeAssertions).toBe("function");
});
