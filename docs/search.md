# Search

`@rekkr/orm/search` — Laravel Scout-inspired full-text search over your own
database, on PostgreSQL full-text search or SQLite FTS5. The index lives in the
database you already run: there is no search service to install.

## Quick start

Configure the engine that matches your database:

```ts
// orm.config.ts
export default {
  connection: { url: "sqlite://./app.db" },
  modelsPath: "./app/models",
  search: { engine: "sqlite" },   // "pg" on PostgreSQL
};
```

Register the model:

```ts
// app/models/Post.ts
import { Model } from "@rekkr/orm";
import { Search } from "@rekkr/orm/search";

export class PostRecord extends Model {
  static override table = "posts";
  static override fillable = ["title", "body", "status"];
}

export const Post = Search.register(PostRecord);

export type PostInstance = InstanceType<typeof Post>;
```

Create the index and load the rows that already exist:

```bash
orm search:create-index Post
orm search:import Post
```

From then on, `Post.create()`, `post.save()` and `post.delete()` keep the index
in sync. Search it:

```ts
const posts = await Post.search("rust").where("status", "published").get();
```

That is all the setup. The index covers the table: its text columns are
searched, and every column can be used in `where()` and `orderBy()`, with no
change to the model. Only the primary key and the model's `hidden` columns are
left out.

## Searching

`Post.search(text)` returns a builder. Chain filters and sorting, then run it:

```ts
const results = await Post.search("alpha").get();          // hydrated Post models
const top10   = await Post.search("alpha").take(10).get();
const rawHits = await Post.search("alpha").raw();          // skip hydration
```

### Filters

```ts
await Post.search("rust")
  .where("status", "published")
  .where("views", ">", 100)
  .whereIn("category", ["tech", "news"])
  .get();
```

Filter on any column of the model's table; there is nothing to declare first.
If the model sets `fts` or its own `toSearchableArray()`, filters can use only
the fields those put in the index.

Every filter:

```ts
await Post.search("alpha")
  .where("status", "published")
  .where("rank", ">", 5)               // comparison ops: = != > >= < <=
  .whereNot("type", "draft")
  .whereIn("tag", ["tech", "news"])
  .whereNotIn("category", ["spam"])
  .whereBetween("price", [10, 99])
  .whereNotBetween("rank", [0, 1])
  .whereNull("deleted_at")
  .whereNotNull("published_at")
  .whereExists("title")
  .whereDoesntExist("archived_at")
  .whereRaw("status <> ?", ["archived"])  // raw SQL on stored columns
  .get();
```

### OR and nested groups

```ts
await Post.search("alpha")
  .where("status", "published")
  .orWhere("featured", true)                   // OR sibling
  .where((q) => {                              // nested AND group
    q.where("rank", ">", 10).orWhere("priority", "high");
  })
  .get();
```

Every method has an `or*` variant: `orWhere`, `orWhereIn`, `orWhereNotIn`, `orWhereBetween`, `orWhereNotBetween`, `orWhereRaw`.

### Sorting

Results come ordered by relevance. `orderBy()` replaces that order:

```ts
await Post.search("rust")
  .orderBy("rank", "desc")
  .thenBy("created_at", "desc")   // alias of orderBy, reads as a tie-breaker
  .get();
```

Sort fields apply left to right.

### Pagination

```ts
const page  = await Post.search("alpha").paginate(15, 2);
// { data: Collection<Post>, total, page, perPage }

const rawPage = await Post.search("alpha").rawPaginate(15, 2);
// { hits: SearchHit[], total, page, perPage, facetDistribution? }

const simple = await Post.search("alpha").simplePaginate(15, 2);
// { data: Collection<Post>, page, perPage, hasMore } — no total count query
```

### Eager loading

```ts
const posts = await Post.search("alpha").with("author", "tags").get();
posts[0].author;   // loaded
```

Hydrated search results use the same `Collection` type as ORM queries.
`raw()` is the escape hatch when you want plain engine hits.

### Streaming

```ts
for await (const post of Post.search("alpha").cursor(100)) {
  // streams pages of 100, yields one hydrated model at a time
}
```

Hits hydrate via a single `whereIn(primaryKey, ids)` query through the ORM. Casts, accessors, and `.with()` eager-loading all apply.

## Keeping the index in sync

Once registered, `Post.create()`, `post.save()`, and `post.delete()` push to the
index through the model observer, after the surrounding transaction commits.
Soft-deleted rows are removed from the index.

Manual control:

```ts
await post.searchable();    // force-index this row
await post.unsearchable();  // remove from index
```

### Bulk writes

When any observer is registered for a model, these paths now fire observer events too:

- `Model.insert([...])` — routes through `saveMany()` to dispatch lifecycle events per row (one SQL INSERT per row; cost only paid when observers are attached). Pass `{ events: false }` to opt out.
- `Model.where(...).update({...})` — pre-fetches matching IDs, runs the UPDATE, then dispatches `updated`/`saved` per affected row.
- `Model.where(...).delete()` — pre-fetches matching IDs, runs DELETE, then dispatches `deleted` per removed row.

Models without observers skip the extra `SELECT` entirely.

### Static helpers

`Search.register()` adds two static methods for full reindex / wipe:

```ts
await Post.makeAllSearchable(500);   // chunked bulk index — same shape as `search:import` CLI
await Post.removeAllFromSearch();    // wipe model's index
```

### Soft deletes

`Model.trashed()` returns `true` when `static softDeletes = true` and the `deleted_at` column is set on the instance. `SearchObserver` uses it to remove soft-deleted rows from the index automatically.

## More search features

### Facets

```ts
const page = await Post.search("rust")
  .facet("status")
  .facets("category", "language")   // variadic
  .paginate(15, 1);

page.facetDistribution;
// { status: { published: 42, draft: 7 }, category: { tech: 30, news: 19 }, ... }
```

Facets-only fetch (no hits):

```ts
const fd = await Post.search("").facet("status").facetDistribution();
// { status: { published: 42, draft: 7 } }
```

Sugar one-shot result with hits + total + facets:

```ts
const result = await Post.search("rust").facet("status").fetch(20);
// { data: Post[], total: 142, facetDistribution: { status: {...} } }
```

> As with filters, a facet works on any table column unless the model sets `fts` or its own `toSearchableArray()`.

### Score threshold

Drop low-relevance hits at query time:

```ts
const strong = await Post.search("rust").minScore(0.5).get();
```

Opt in to per-hit ranking scores:

```ts
const hits = await Post.search("rust").withScore().raw();
hits[0].score;   // number | undefined
```

Restrict raw hit fields for display/autocomplete payloads:

```ts
const hits = await Student.search("michelle")
  .searchOn("full_name")
  .retrieve("id", "full_name")
  .highlight("full_name")
  .raw();

hits[0].data;       // { id, full_name }
hits[0].formatted;  // highlighted fields, when supported by the engine
```

`.display()` is an alias of `.retrieve()`.

### Per-query field weighting (boost)

Restrict matching to a subset of indexed fields. Ranking ignores other fields for this query:

```ts
await Post.search("rust").searchOn("title").get();
await Post.search("rust").boost("title", "summary").get();  // alias of searchOn
```

### Highlight + crop + match positions

```ts
const hits = await Post.search("rust")
  .highlight("title", "body")
  .highlightTags("<mark>", "</mark>")
  .crop("body", 80)
  .raw();

hits[0].formatted;          // { title: "<mark>Rust</mark>...", body: "...<mark>Rust</mark>..." }
hits[0].matchesPosition;    // { title: [{ start: 0, length: 4 }], body: [...] }
```

### Multi-query search

Run several queries, across models or indexes, and get the raw hits of each:

```ts
import { Search } from "@rekkr/orm/search";

const [postResults, articleResults] = await Search.multi([
  Post.search("rust").take(5),
  Article.search("rust").take(5),
]);

postResults.index;            // "posts"
postResults.hits;             // SearchHit[]
postResults.total;            // 42
postResults.facetDistribution; // optional, if .facet() was used
```

Returns raw hits per builder — no ORM hydration. Hydrate manually with `Post.whereIn("id", postResults.hits.map(h => h.id)).get()` if needed. Both built-in engines run the queries one after another; an engine that implements `multiSearch()` answers them in one call.

## Model options

### `Search.register()`

`Search.register()` makes `PostRecord` searchable in place and returns that same
class, typed with the search API: `Post` and `PostRecord` are one class, and
`Post` is the name to use in code. Export the model class by name as well:
the declarations from `orm types:generate` merge into it, which is what types
`post.title` and the results of `Post.search()`. Its name no longer matches the
table, so name the table in `static table`.

```ts
// consumer
import { Post, type PostInstance } from "./app/models/Post";

const hits: PostInstance[] = await Post.search("rust").get();
```

Search commands find the model by either export name: `orm search:import Post`.

Scaffold via CLI: `orm make:searchable Post`.

Options:

| Option | Purpose |
|---|---|
| `fts` | Which fields are searched and which are only stored. Defaults to the table's columns. See below. |
| `index` | Index name. Defaults to the model's table. |
| `toSearchableArray(model)` | The fields sent to the index. Defaults to `model.toJSON()`. |
| `shouldBeSearchable(model)` | Return `false` to keep a row out of the index (it is removed if present). |
| `settings` | Engine index settings, for [custom engines](#custom-engines) that support them. |

### Choosing what to index — `fts`

Without `fts`, the index is built from the model's table, as described in the
[quick start](#quick-start). Declare `fts` to search fewer columns, to index
fields that are not table columns (computed in `toSearchableArray()`), or to
choose a language or tokenizer:

```ts
export const Post = Search.register(PostRecord, {
  fts: {
    columns: ["title", "body"],   // tokenized and searched
    unindexed: ["status"],        // stored for filters, facets and sorting
  },
  toSearchableArray: (m) => ({
    title: m.getAttribute("title"),
    body: m.getAttribute("body"),
    status: m.getAttribute("status"),
  }),
  shouldBeSearchable: (m) => m.getAttribute("status") === "published",
});
```

Both engines read it the same way:

| Key | Meaning |
|---|---|
| `columns` | Fields that are tokenized and matched by the search query. |
| `unindexed` | Fields stored next to them for `where()`, `facet()`, `orderBy()` and `retrieve()`, but not matched. |
| `language` | PostgreSQL only: text search configuration (default `"english"`). |
| `tokenizer` | SQLite only: FTS5 tokenizer, such as `"porter unicode61"` (default `unicode61`). |
| `contentTable`, `contentRowid` | Source table and key for trigger sync and `search:fts:rebuild`. See each engine. |
| `triggerWhere` | SQL conditions that gate the sync triggers. |

Each field in `columns` and `unindexed` is read from `toSearchableArray()`; a field it does not return is stored as `NULL`.

The engine finds the model from the index name: for an index it was not
configured for explicitly, it uses the `fts`, or the table, of the registered
model whose `searchableAs()` returns that name. That holds in every process that imports the
model: the CLI, the application, and the `orm queue` worker, which loads
`modelsPath` when search is configured. A worker you start yourself must import
the searchable models before it runs search jobs. With
[`tenantScope`](#multi-tenancy), the name is resolved in the active tenant
context, so per-tenant indexes find their model too.

To configure an index by hand instead, call `engine.configureIndex(name, config)`
or pass `indexes` to the engine constructor. That config wins over the model's,
and the table is not read.

### Alternative — `Search.define()`

Wrap an existing model class, add the searchable API, and register the
observer automatically.

```ts
import { Model } from "@rekkr/orm";
import { Search } from "@rekkr/orm/search";

export class PostRecord extends Model {
  static override table = "posts";
  static override fillable = ["title", "body", "status"];
}

export const Post = Search.define(PostRecord);
export type PostInstance = InstanceType<typeof Post>;
```

### Alternative — `Searchable` mixin

For models typed with [`Model.define<T>()`](./typescript.md#modeldefinettable) instead of generated declarations:

```ts
import { Model } from "@rekkr/orm";
import { Searchable, Search } from "@rekkr/orm/search";

interface PostAttributes {
  id: number;
  title: string;
  body: string;
  status: "draft" | "published";
}

export class Post extends Searchable(Model.define<PostAttributes>("posts")) {
  static override fillable = ["title", "body", "status"];
}

Search.register(Post);   // mixin adds statics + types; this attaches the observer
```

`Searchable()` adds its statics to the class it receives. `Model.define()` hands
it a fresh class; never pass `Model` itself, or every model becomes searchable
under one index. With generated declarations, use `Search.register()` or
`Search.define()` above: the mixin types search results as its base class, which
would then have to be exported and searchable as well.

## Configure

Set `search` in `configureOrm()` or `orm.config.ts`. The engine is a string
alias or an engine instance:

| Alias | Engine | Defaults |
|---|---|---|
| `"pg"`, `"postgres"`, or `"postgres-fts"` | `PostgresFTSEngine` | `{ shared: true }`: reuses the default ORM PostgreSQL connection |
| `"sqlite"` or `"sqlite-fts5"` | `SqliteFTS5Engine` | `{ shared: true }`: reuses the default ORM SQLite connection |

```ts
import { configureOrm } from "@rekkr/orm";

configureOrm({
  connection: { url: process.env.DATABASE_URL! },
  modelsPath: "./app/models",
  search: {
    engine: "pg",
    // Optional: keep the index on a dedicated connection.
    // connection: { url: process.env.SEARCH_DATABASE_URL! },
    // Optional: sync through queued jobs instead of inline.
    // queue: { name: "search" },
    chunk: 500,
  },
});
```

`search.connection` accepts a `ConnectionConfig` or an existing `Connection`.
To set engine options, pass an instance instead of the alias:

```ts
import { PostgresFTSEngine, SqliteFTS5Engine } from "@rekkr/orm/search";

search: { engine: new PostgresFTSEngine({ shared: true, defaultLanguage: "spanish" }) }
search: { engine: new SqliteFTS5Engine({ shared: true, walMode: true }) }
```

Engine options are listed under [PostgreSQL FTS](#engine-postgresftsengine) and
[SQLite FTS5](#engine-sqlitefts5engine). `connection` next to an engine instance
is rejected; pass it to the constructor instead.

Outside the ORM facade:

```ts
import { Search } from "@rekkr/orm/search";

Search.configure({ engine: "sqlite" });
```

## CLI

When `search` is configured, these commands register automatically:

| Command | Purpose |
|---|---|
| `orm search:import <Model>` | Bulk-index all rows of a model (chunked). |
| `orm search:flush <Model>` | Wipe the index for a model. |
| `orm search:sync-index-settings [Model]` | Push the model's `settings` to an engine that supports index settings. Neither built-in engine does; see [Custom engines](#custom-engines). |
| `orm search:status` | Engine health and diagnostics (page counts, journal mode, row counts of explicitly configured indexes). |
| `orm search:create-index <Model>` | Create the model's index, from its `fts` or its table. |
| `orm search:delete-index <Model> --force` | Delete the model's index. `--force` required. |
| `orm search:reimport <Model> [--chunk=N]` | Flush + bulk-import in one step. |
| `orm search:reindex <Model> [--chunk=N] [--suffix=_next]` | Build, swap, and drop a temporary index without downtime. Needs an engine with `swapIndexes()`, which neither built-in engine has; use `search:reimport` with them. |
| `orm search:import <Model> [--chunk=N] [--dry-run]` | `--dry-run` counts rows without pushing. |
| `orm search:fts:optimize <Model>` | FTS5-only. Merges b-tree levels, reduces fragmentation. |
| `orm search:fts:rebuild <Model>` | FTS engines with `rebuild()`. Repopulates the index from the source content table. |
| `orm search:list-indexes [--tenant=ID] [--tenants=A,B] [--all-tenants] [--include-landlord]` | Print the resolved index name per searchable model, optionally per-tenant. |
| `orm search:verify [--tenant=ID] [--all-tenants] [--include-landlord] [--fix]` | Check that every searchable model's index exists on the engine. `--fix` auto-creates missing ones. |

### `--tenant=<id>` flag

Every per-model command accepts `--tenant=<id>` to run under a `TenantContext`. The command resolves the model's tenant-scoped index (when `tenantScope` is configured) before issuing the operation:

```bash
orm search:create-index Post --tenant=42
orm search:import Post --tenant=42 --chunk=1000
orm search:flush Post --tenant=42
orm search:reimport Post --tenant=42
orm search:reindex Post --tenant=42
orm search:delete-index Post --tenant=42 --force
orm search:sync-index-settings Post --tenant=42
orm search:fts:optimize Post --tenant=42
orm search:fts:rebuild Post --tenant=42
```

Without `--tenant`, commands operate in the landlord context.

### `search:verify`

Walks every searchable model and confirms its resolved index exists on the engine. Useful in CI, deploy hooks, or after onboarding a new tenant.

```bash
orm search:verify                                    # default context
orm search:verify --tenant=42                        # one tenant
orm search:verify --all-tenants --include-landlord   # full sweep
orm search:verify --all-tenants --fix                # auto-create missing
```

Output:

```
▶ tenant=42
  ✓ Post                     → posts_t_42
  ✗ Article                  → articles_t_42  (MISSING)
▶ tenant=43
  ✓ Post                     → posts_t_43
  ✓ Article                  → articles_t_43

Missing: 1. Re-run with --fix to create.
```

Exit code:
- `0` when all indexes present
- `1` when any index missing (without `--fix`) or any engine error

`--fix` creates each missing index as `search:create-index` does. Safe to re-run; existing indexes are skipped.

Requires `engine.indexExists?()` — implemented by `SqliteFTS5Engine` (via `sqlite_master`, filtered to FTS5 virtual tables) and `PostgresFTSEngine` (via `pg_class`). Engines without it skip with a warning.

`<Model>` matches the exported class name discovered in `config.modelsPath`.

## Queued sync

Set `search.queue` to push observer-triggered updates onto the existing queue subsystem:

```ts
search: {
  engine: "pg",
  queue: { name: "search" },
}
```

Then run a worker that picks up `MakeSearchableJob` / `RemoveFromSearchJob`:

```bash
orm queue --queue=search
```

The worker loads the models in `modelsPath`, so the engine finds each index's
model there as it does in the application.

### Routing to a dedicated queue driver

Register a secondary driver under a name, then point `search.queue.connection` at it. Search jobs land on that driver instead of the default:

```ts
import { Queue, RedisQueueDriver } from "@rekkr/orm/queue";

Queue.registerDriver("search-driver", new RedisQueueDriver({ /* ... */ }));

configureOrm({
  // ...
  search: {
    engine: "pg",
    queue: { name: "search", connection: "search-driver" },
  },
});
```

Worker process for that driver runs against the same Redis (or whatever the secondary points at). Each driver still needs its own worker process.

## Multi-tenancy

Set `tenantScope` to derive a per-tenant index name from the active `TenantContext`. The hook fires every time `Model.searchableAs()` resolves — so observer writes, queue payloads, `SearchBuilder` reads, and CLI commands all stay aligned.

```ts
configureOrm({
  // ...
  tenancy: { resolveTenant: yourResolver },
  search: {
    engine: "pg",
    tenantScope: (base, tenantId) => tenantId ? `${base}_t_${tenantId}` : base,
  },
});
```

```ts
await TenantContext.run("42", async () => {
  await Post.create({ title: "..." });   // indexed in "posts_t_42"
  await Post.search("rust").get();        // reads from "posts_t_42"
});

await Post.create({ title: "..." });      // landlord → "posts"
```

Create each tenant's index with `orm search:create-index Post --tenant=42`, or
all of them with `orm search:verify --all-tenants --fix`.

**How it composes with queue mode:** `SearchObserver` resolves the index name at dispatch time, baking it into `SearchableRecord.index`. The queue worker re-enters `TenantContext.run(payload.tenantId, ...)` before calling `engine.update()`, so per-tenant connection routing (schema, RLS) is preserved end-to-end, and the engine resolves the tenant's index name to its model in that same context.

**Resolve outside model context:**

```ts
Search.indexFor("posts", "42");        // "posts_t_42"
Search.indexFor("posts");              // reads active TenantContext
Search.indexFor("posts", null);        // landlord

// Batch
Search.indexesFor("posts", ["1", "2", null]);
// { "1": "posts_t_1", "2": "posts_t_2", "__landlord__": "posts" }

// All tenants from configured lister
await Search.indexesForAllTenants("posts", { includeLandlord: true });
```

Wire `listTenants` either on the search config or inherit it from `tenancy.listTenants`:

```ts
configureOrm({
  tenancy: { resolveTenant, listTenants: () => listTenantIds() },
  search: {
    engine: "pg",
    tenantScope: (b, tid) => tid ? `${b}_t_${tid}` : b,
    // `listTenants` inherits from tenancy.listTenants when omitted here
  },
});
```

**CLI introspection:**

```bash
orm search:list-indexes                            # base names
orm search:list-indexes --tenant=42                # one tenant
orm search:list-indexes --tenants=1,2,3            # comma list
orm search:list-indexes --all-tenants              # uses listTenants()
orm search:list-indexes --all-tenants --include-landlord
```

Output:

```
Post
  tenant=1             → posts_t_1
  tenant=2             → posts_t_2
  (landlord)           → posts
```

Other shipped commands (`search:create-index`, `search:import`, etc.) operate on whatever tenant context the calling process is in.

## Batch coalescing

For high-write workloads where queue mode is overkill, opt in to in-process batching. The buffer dedupes by tenant, index and id, so a record updated 3× in one window is written to the index once:

```ts
search: {
  engine: "sqlite",
  batch: { maxItems: 100, maxMs: 500 },
}
```

Flush triggers:
- buffer reaches `maxItems` records
- `maxMs` elapses since first buffered record
- `Search.flushPending()` called manually
- process `beforeExit` (auto-installed)

Batching is **ignored** when `search.queue` is configured — the queue handles throughput.

## Hit + page shapes

```ts
interface SearchHit {
  id: string | number;
  data: Record<string, unknown>;
  score?: number;                                        // .withScore()
  formatted?: Record<string, unknown>;                   // .highlight() / .crop()
  matchesPosition?: Record<string, MatchPosition[]>;
}

interface SearchPaginatorResult<T> {
  data: Collection<T>;
  total: number;
  page: number;
  perPage: number;
  facetDistribution?: Record<string, Record<string, number>>;
}

interface SearchFetchResult<T> {
  data: Collection<T>;
  total: number;
  facetDistribution?: Record<string, Record<string, number>>;
}

interface SearchMultiResult {
  index: string;
  hits: SearchHit[];
  total?: number;
  facetDistribution?: Record<string, Record<string, number>>;
}
```

## Engine capabilities

Engines do not have identical native features. Use capabilities when UI or CLI code needs to branch by engine:

```ts
const caps = Search.capabilities();

caps.matchesPosition;       // "native" | "approximate" | false
caps.nativeMultiSearch;     // false for both built-in engines: Search.multi() runs sequentially
caps.indexSettings;         // true when updateIndexSettings() is supported

if (Search.supports("highlight")) {
  // show highlighted snippets
}
```

| Capability | PostgreSQL FTS | SQLite FTS5 |
|---|---|---|
| `nativeMultiSearch` | ❌ sequential fallback | ❌ sequential fallback |
| `indexSettings` | ❌ | ❌ |
| `matchesPosition` | `"approximate"` | `"approximate"` |
| `highlight` / `crop` | ✅ | ✅ |
| `facets` | ✅ | ✅ |
| `minScore` | ✅ | ✅ |
| `searchOn` | ✅ | ✅ |
| `rawQuery` | ✅ | ✅ |

### Builder features by engine

| Builder feature | PostgreSQL FTS | SQLite FTS5 |
|---|---|---|
| `where` / `whereIn` / `whereBetween` / `whereNull` / `whereExists` / `whereRaw` | ✅ SQL on stored columns | ✅ SQL on `unindexed` columns |
| OR / nested groups | ✅ | ✅ |
| `orderBy` | ✅ — default is `ts_rank()` relevance | ✅ — default is `bm25()` relevance |
| `take` / pagination / `simplePaginate` / `cursor` | ✅ | ✅ |
| `.facet()` / facet distribution | ✅ SQL `GROUP BY` | ✅ SQL `GROUP BY` |
| `.minScore()` | ✅ `ts_rank()` threshold | ✅ `bm25()` threshold |
| `.searchOn()` / `.boost()` | ✅ column-scoped `tsvector` | ✅ FTS5 column-scoped match |
| `.retrieve()` / `.display()` | ✅ | ✅ |
| `.matchRaw()` | ✅ raw PostgreSQL `to_tsquery()` | ✅ raw FTS5 syntax |
| `.bm25Weights()` | ❌ ignored | ✅ |
| `.withScore()` | ✅ exposes `ts_rank()` | ✅ exposes `-bm25()` |
| `.highlight()` / `.crop()` | ✅ `ts_headline()` | ✅ `highlight()` + `snippet()` |
| `matchesPosition` | ✅ best-effort character offsets | ✅ best-effort character offsets |
| `Search.multi([...])` | sequential | sequential |

Neither engine has typo tolerance: they match words and prefixes, not
misspellings.

## Engine: `PostgresFTSEngine`

For PostgreSQL apps. It creates one shadow table per index (`_fts_<index>`), stores the searchable columns plus filter/facet fields, maintains a `tsvector`, and creates a GIN index.

### Setup

```ts
search: { engine: "pg" }

// app/models/Post.ts
export const Post = Search.register(PostRecord);
```

```bash
orm search:create-index Post
orm search:import Post
```

The `"pg"` alias creates `new PostgresFTSEngine({ shared: true })`, which reuses the ORM's active PostgreSQL connection. Add `search.connection` to keep the alias but store the index on another PostgreSQL connection. Stemming uses the `english` configuration; set `fts.language` on the model, or `defaultLanguage` on the engine, for another language.

Constructor options:

| Option | Default | Purpose |
|---|---|---|
| `shared` | `true` | Reuse the ORM's default connection. |
| `connection` | — | An explicit `Connection` instead. |
| `prefix` | `"_fts_"` | Shadow table name prefix. |
| `defaultLanguage` | `"english"` | Text search configuration when `fts.language` is not set. |
| `useTriggers` | `true` | Create sync triggers for indexes whose `fts` has `contentTable`. |
| `indexes` | — | Index configs by name; they win over the models' `fts`. |

### Trigger mode

When the model's `fts` has `contentTable` (and `useTriggers` is on, the default), `createIndex()` also creates PostgreSQL triggers that keep the shadow table in sync on `INSERT`, `UPDATE` and `DELETE`, including writes that bypass the ORM:

```ts
fts: {
  columns: ["title", "body"],
  unindexed: ["status"],
  contentTable: "posts",
  contentRowid: "id",
}
```

The model observer keeps writing as well; both upsert the same row. `contentTable` also enables `orm search:fts:rebuild Post`, which rebuilds the shadow table from the source rows.

Trigger functions are schema-qualified when the active connection uses schema-qualified tenancy, so schema-per-tenant setups can reuse the same index names safely.

### Query behavior

```ts
await Post.search("rust postgres")
  .searchOn("title")            // searches only title
  .retrieve("title", "status")  // raw() returns only these fields in hit.data
  .where("status", "published")
  .highlight("title")
  .crop("body", 20)
  .paginate(15, 1);
```

Normal searches use PostgreSQL `websearch_to_tsquery()`. Use `.matchRaw()` when you want raw PostgreSQL tsquery syntax:

```ts
await Post.search("").matchRaw("rust:* & postgres").raw();
```

### Caveats

- Shadow-table columns are stored as `TEXT`. Numeric filters/ranges are cast to numeric by the engine; keep filter values consistent.
- `search:create-index` creates the shadow table and GIN index. Existing rows still need `search:import` or `search:fts:rebuild`.
- Changing `fts`, or the table's columns when there is no `fts`, means recreating the index: `search:delete-index --force`, `search:create-index`, then `search:import`.

## Engine: `SqliteFTS5Engine`

For SQLite apps, or as a single-file index next to another database. It stores each index in an FTS5 virtual table named `_fts_<index>`, so the default index name (the model's table) never collides with the table it indexes.

### Setup — same file as the app

```ts
configureOrm({
  connection: { url: "sqlite://./app.db" },
  modelsPath: "./app/models",
  search: { engine: "sqlite" },
});
```

```bash
orm search:create-index Post
orm search:import Post
```

The index lives in the same SQLite file as the app data, so one backup covers both. It tokenizes with `unicode61`; set `fts.tokenizer` on the model for another, such as `"porter unicode61"` for English stemming.

### Setup — separate SQLite index file

Keep app data in PostgreSQL or MySQL and the index in one SQLite file:

```ts
configureOrm({
  connection: { url: "postgres://app:pw@host/db" },
  modelsPath: "./app/models",
  search: { engine: "sqlite", connection: { url: "sqlite://./search.db" } },
});
```

Sync runs through the same model observer as the same-file setup.

Constructor options:

| Option | Default | Purpose |
|---|---|---|
| `shared` | `false` (`true` through the alias) | Reuse the ORM's default connection. |
| `connection` | — | An explicit `Connection`. |
| `memory` | `false` | Open a private in-memory database, for tests. |
| `prefix` | `"_fts_"` | FTS5 table name prefix. |
| `useTriggers` | `false` | Create sync triggers; needs `contentTable` in every index's `fts`. |
| `walMode` / `journalMode` | — | Set the journal mode on first use. |
| `indexes` | — | Index configs by name; they win over the models' `fts`. |

### Trigger mode — sync inside the write (same file only)

When app data and the FTS5 table share the same SQLite file, SQLite triggers can keep the index in sync, including raw SQL writes:

```ts
import { SqliteFTS5Engine } from "@rekkr/orm/search";

search: { engine: new SqliteFTS5Engine({ shared: true, useTriggers: true }) }

// in the model
fts: {
  columns: ["title", "body"],
  unindexed: ["status"],
  contentTable: "posts",   // required for triggers
  contentRowid: "id",      // key column on the source table
}
```

`createIndex()` creates the FTS5 table **and** three triggers (`_fts_posts_ai`, `_ad`, `_au`); `deleteIndex()` drops them. The model observer keeps writing as well, which is redundant but leaves the index consistent. `contentTable` also enables `orm search:fts:rebuild Post`.

### Caveats

- **Single writer.** SQLite serializes writes. Run search sync through a queue worker (`orm queue --queue=search`) in multi-process apps to avoid lock contention.
- **Single node.** The SQLite file lives on one disk. For replicated reads, use Litestream/rqlite.
- **Schema-tied.** Columns are fixed at `createIndex()` time. Changing `fts`, or the table's columns when there is no `fts`, means `search:delete-index --force`, `search:create-index`, then `search:reimport`.
- **Enable WAL.** `walMode: true` (or `PRAGMA journal_mode=WAL`) for concurrent readers.
- **Migrations.** When using `useTriggers`, treat the FTS table and triggers as part of your schema so they survive `migrate:fresh`.

## Custom engines

Implement `SearchEngine` and pass the instance as `search.engine`:

```ts
import type { SearchEngine } from "@rekkr/orm/search";

class MyEngine implements SearchEngine {
  async update(records) { /* upsert { index, id, data } */ }
  async delete(records) { /* remove by { index, id } */ }
  async search(query) { return []; }
  async paginate(query, perPage, page) { return { hits: [], total: 0, page, perPage }; }
  async flush(index) {}
  async createIndex(name, options) {}
  async deleteIndex(name) {}
}

configureOrm({ /* ... */ search: { engine: new MyEngine() } });
```

Optional methods unlock more of the API:

| Method | Enables |
|---|---|
| `capabilities()` | `Search.capabilities()` / `Search.supports()` |
| `health()` | `orm search:status` |
| `indexExists(name)` | `orm search:verify` |
| `multiSearch(queries)` | `Search.multi()` in one call |
| `updateIndexSettings(name, settings)` | the model's `settings` option and `orm search:sync-index-settings` (report `indexSettings: true` in `capabilities()`) |
| `swapIndexes(a, b)` | `orm search:reindex` |

`fts` and `configureIndex()` belong to the built-in engines; a custom engine
reads whatever it needs from `SearchableRecord.data` and its own options.

## Architecture

- `SearchEngine` — driver interface (`update`, `delete`, `search`, `paginate`, `flush`, `createIndex`, `deleteIndex`, plus the optional methods above).
- `PostgresFTSEngine` — PostgreSQL `tsvector` driver. Uses a shadow table, GIN index, optional triggers, `websearch_to_tsquery()` for normal queries, and `to_tsquery()` for `.matchRaw()`.
- `SqliteFTS5Engine` — SQLite FTS5 driver. Uses an FTS5 virtual table, optional triggers, BM25 ranking, snippets, and column-scoped matches.
- `Searchable(Base)` — mixin adding the static API and a per-instance `searchable()` / `unsearchable()` pair.
- `SearchObserver` — internal `ObserverContract` impl attached via `Search.register(Model)`. Fires on `saved`/`deleted`.
- `SearchBuilder` — fluent query builder; returns hydrated ORM models.
- `MakeSearchableJob` / `RemoveFromSearchJob` — queue jobs for async sync.
- `Search.multi(builders)` — several queries at once; routes through `engine.multiSearch()` when available, falls back to sequential `engine.search()`.

## Not yet implemented

- Other engines (Meilisearch, Algolia, Typesense, MySQL `MATCH AGAINST`) — write one against the [`SearchEngine` interface](#custom-engines).
- Native tokenizer-backed match positions for PostgreSQL and SQLite FTS. The current implementation computes best-effort character offsets from returned field text.

## Transaction and batch behavior in v3

Search observers capture each record and its tenant at write time, then deliver
only after root commit. Rollbacks discard delivery. Native engines resolve the
current connection per operation; explicit connections must be compatible with
the active resource. Use tenant schemas/databases or explicit tenant index names
where isolation is required; RLS policies remain the application's responsibility.

Batches retain their captured engine/tenant, swap the active buffer when flushing,
and retry failed groups without overwriting newer updates. Background flush errors
are reported and retained in memory for retry. Await `Search.flushPending()` during
shutdown. This buffer and afterCommit are not a durable outbox.
