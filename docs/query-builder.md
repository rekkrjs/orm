# Query Builder

The query builder is a chainable, type-safe wrapper around SQL. Every model exposes it through static methods (`User.where(...)`, `Post.with(...)`). You can also use it directly without a model through the [`DB` facade](#the-db-facade) — handy for ad-hoc table access, reporting views, and pivot tables that don't warrant their own class.

Unless a section says otherwise, the APIs in this document work against SQLite,
MySQL, and PostgreSQL, with ORM translating to the appropriate dialect.

```ts
import { DB } from "@rekkr/orm";
import User from "./models/User";
import Post from "./models/Post";
```

## Quick reference

```ts
const users = await User
  .where("active", true)
  .whereNotIn("role", ["banned", "spam"])
  .with("posts")
  .withCount("comments")
  .orderByDesc("created_at")
  .paginate(20);
```

Most chains follow the same shape: filter, eager-load, order, then terminate with `.get()`, `.first()`, `.paginate()`, `.count()`, etc.

## The `DB` facade

`DB.table()` gives you a builder against any table without a model class. Useful for:

- Tables that exist only as join / pivot tables.
- One-off analytics or reporting queries.
- Migrating or backfilling data where a model would be overkill.
- Read-only endpoints and scripts that need raw row shapes.

```ts
import { DB } from "@rekkr/orm";

const rows = await DB.table("users")
  .where("active", true)
  .orderBy("created_at", "desc")
  .select("id", "name", "email")
  .get(); // Collection<Record<string, any>>

const count = await DB.table("audit_logs").where("event", "login").count();

await DB.table("settings").where("key", "theme").update({ value: "dark" });

// Raw SQL
const rawRows = await DB.raw("SELECT * FROM users WHERE id = ?", [1]);
```

### Typed columns (IntelliSense)

Pass a row-shape generic to get column autocomplete on `where`, `select`, `update`, and typed result rows:

```ts
interface UserRow {
  id: number;
  name: string;
  email: string;
  active: boolean;
}

const rows = await DB.table<UserRow>("users")
  .where("active", true)    // "active" autocompletes
  .select("id", "name")     // column names autocomplete
  .get();                   // rows: Collection<UserRow>

// Reuse model attribute interfaces
import type { UserAttributes } from "./models/User";
await DB.table<UserAttributes>("users").where("email", "a@b.com").first();

// Typed raw SQL
const stats = await DB.raw<{ total: number }>("SELECT COUNT(*) as total FROM users");
stats[0].total; // number
```

Omit the generic for a `Collection<Record<string, any>>` result.

### Named connections

When you operate against multiple databases (primary + analytics, read replica, archive), register them and route queries explicitly:

```ts
import { Connection, ConnectionManager } from "@rekkr/orm";

ConnectionManager.add("analytics", new Connection({ url: "postgres://analytics-db" }));

await DB.connection("analytics").table("events").where("type", "view").count();
```

`DB.connection(name)` throws if the name is not registered — fail fast instead of silently falling through to the default.

### Multi-tenant scope

`DB.tenant(tenantId, fn)` wraps [`TenantContext.run`](./configuration.md#tenancy). All queries inside (both Models and `DB.table()`) resolve against the tenant's connection or schema:

```ts
await DB.tenant("acme", async () => {
  const users = await User.all();                          // tenant_acme scope
  const orders = await DB.table("orders").get();           // tenant_acme scope
  await DB.table("audit_logs").insert({ event: "login" }); // tenant_acme scope
});
```

Works with all three tenancy strategies (database-per-tenant, schema-per-tenant, RLS) configured via `ConnectionManager.setTenantResolver()`.

**Context switching.** Tenant scope is tracked with `AsyncLocalStorage`, so it propagates across `await` boundaries and behaves predictably under nesting and concurrency:

```ts
import { TenantContext } from "@rekkr/orm";

// Nested contexts override the outer scope and restore on unwind.
await DB.tenant("acme", async () => {
  TenantContext.current()?.tenantId; // "acme"

  await DB.tenant("globex", async () => {
    TenantContext.current()?.tenantId; // "globex"
  });

  TenantContext.current()?.tenantId; // "acme" — restored
});

TenantContext.current(); // undefined — fully unwound

// Parallel tenants do not bleed into one another.
await Promise.all([
  DB.tenant("a", async () => User.all()),
  DB.tenant("b", async () => User.all()),
  DB.tenant("c", async () => User.all()),
]);
```

Each concurrent `DB.tenant()` runs in its own async storage frame.

## Reading rows

### Basic terminators

```ts
const all = await User.all();                                // every row
const found = await User.find(1);                            // by primary key, or null
const first = await User.first();                            // first row in default order
const user = await User.where("email", "a@b.com").first();   // first matching row
const result = await User.where("email", "a@b.com").firstOr(() => guestUser);
const byId = await User.findOr(1, () => guestUser);
const users = await User.where("active", true).get();        // Collection<User>
const arr = users.toArray();                                 // plain User[]
const payload = await User.where("active", true).json();     // serialized rows
```

`get()` returns a [Collection](./collections.md) with helpers like `map`,
`filter`, and `groupBy`. Call `.toArray()` when an API requires a plain array;
its entries remain hydrated `User` models.

`Builder.json()` normally hydrates those models and serializes them. A model can
opt compatible direct JSON queries into static row serialization:

```ts
class User extends Model {
  // Direct query JSON may bypass per-row construction when the model is eligible.
  static override fastJson = true;
}

const payload = await User.select("id", "name", "active").orderBy("id").json();
```

The optimized path preserves built-in casts, backed enums, `hidden` / `visible`,
SQL aliases, result order, relation aggregates, recursive decorations, query
caching, and tenant connections. The flag is only permission to optimize, not a
guarantee: eager loads, an active Identity Map, appends, accessors, custom casts,
default model attributes, a static `hydrate()` override, or relevant prototype
method overrides automatically use normal hydration.

Fetching first always requests models and exact instance behavior:

```ts
const users = await User.select("id", "name", "active").get();
const payloadWithInstanceBehavior = users.json();
```

For a read-only endpoint that wants database values without model serialization
rules, query with `DB.table<UserRow>("users")` instead. It returns plain rows and
skips model hydration; apply any output-only conversion (for example,
`Boolean(row.active)`) explicitly before returning the response.

### Throw-on-miss variants

These raise `ModelNotFoundError` when there's no row:

```ts
const user = await User.findOrFail(1);
const first = await User.firstOrFail();
const email = await User.where("id", 1).valueOrFail("email");
```

`sole()` is stricter — throws if there are zero **or** more than one match:

```ts
const alice = await User.where("email", "alice@example.com").sole();
```

Use `sole()` to enforce uniqueness assumptions (one row per email, etc.) and surface data integrity bugs early.

### Scalars and projections

```ts
const name = await User.where("id", 1).value("name");      // single column from first row
const firstName = await User.value("name");                // static form, null if no row
const requiredName = await User.where("id", 1).valueOrFail("name"); // throws only when no row exists
const emails = await User.pluck("email");                  // string[] — one column from every row
const idsByEmail = await User.pluck("email", "id");        // Record<id, email>
```

With a second argument, `pluck` returns a map keyed by that column instead of a list: `pluck("email", "id")` gives `{ 1: "alice@example.com", 2: "bob@example.com" }`. Both columns come back in a single query. If the key column repeats, the last row wins.

## Where clauses

### Equality and operators

```ts
User.where("active", true);
User.where("age", ">=", 18);
User.where({ role: "admin", active: true });               // object shorthand AND
```

Pass a callback to build a nested group (`WHERE (…)`):

```ts
// WHERE active = true AND (role = 'admin' OR role = 'mod')
User.where("active", true).where((q) =>
  q.where("role", "admin").orWhere("role", "mod"),
);
```

### Sets, ranges, null

```ts
User.whereNot("status", "banned");                         // !=
User.whereIn("role", ["admin", "mod"]);
User.whereNotIn("status", ["banned", "spam"]);
User.whereNull("deleted_at");
User.whereNull(["deleted_at", "suspended_at"]);              // both must be null
User.whereNotNull("email");
User.whereBetween("age", [18, 65]);
User.whereNotBetween("score", [0, 10]);
```

Each has an `or*` counterpart:

```ts
User.where("role", "admin").orWhere("role", "mod");
User.where("a", 1).orWhereIn("role", ["x", "y"]);
User.where("a", 1).orWhereNull("email");
```

### Columns, raw, EXISTS

```ts
// Compare two columns
User.whereColumn("updated_at", ">", "created_at");
User.whereColumn("email", "backup_email");                  // equality shorthand
User.whereColumn([
  ["updated_at", ">", "created_at"],
  ["login_count", ">=", "failed_login_count"],
]);

// Compare a value column against two bound columns
Product.whereBetweenColumns("price", ["minimum_price", "maximum_price"]);

// Raw SQL fragment; values belong in the bindings array
User.whereRaw("LENGTH(name) > ?", [10]);

// Subquery EXISTS / NOT EXISTS
User.whereExists("SELECT 1 FROM orders WHERE orders.user_id = users.id");
User.whereNotExists("SELECT 1 FROM bans WHERE bans.user_id = users.id");
```

### Date parts

Cross-database — ORM emits the right `EXTRACT`, `DATE_FORMAT`, or `strftime` per driver:

```ts
Event.whereDate("happened_at", "2024-01-01");
Event.whereYear("created_at", ">=", 2023);
Event.whereMonth("birthday", 12);
Event.whereDay("anniversary", 14);
Event.whereTime("opened_at", "09:00:00");

Event.wherePast("starts_at");
Event.whereFuture("expires_at");
Event.whereToday("published_at");
Event.whereTodayOrAfter(["starts_at", "ends_at"]);
```

On SQLite, relative timestamp comparisons normalize both ISO strings and the
database's `CURRENT_TIMESTAMP` format before comparing them, so mixed formats
remain chronological.

### JSON

```ts
User.whereJsonContains("roles", "editor");
User.whereJsonDoesntContain("roles", "banned");
User.where("active", true).orWhereJsonContains("roles", "admin");
User.where("active", false).orWhereJsonDoesntContain("roles", "staff");
User.whereJsonLength("tags", ">", 2);
User.where("featured", true).orWhereJsonLength("tags", ">=", 3);
```

These containment helpers provide portable JSON-array membership. On Postgres
they compile to `@>` / `jsonb_array_length`. On MySQL they use
`JSON_CONTAINS` / `JSON_LENGTH`. SQLite uses the `json1` extension built into
Bun.

Negative containment excludes SQL `NULL` on every driver; add an explicit
`orWhereNull(...)` when null documents should match too.

### Pattern matching

```ts
User.whereLike("name", "ali%");                              // case-insensitive
User.whereLike("name", "Ali%", { caseSensitive: true });     // exact
User.whereNotLike("name", "bot%");
User.where("active", true).orWhereLike("name", "admin%");
User.where("active", true).orWhereNotLike("name", "bot%");
User.whereRegexp("email", "^alice");
User.whereFullText(["bio", "summary"], "laravel orm");
User.where("featured", true).orWhereFullText("bio", "bun orm");
```

`whereLike` is **case-insensitive by default**, and each driver gets the operator
that expresses it natively rather than `LOWER(column) LIKE LOWER(?)`, which would
make an index on the column unusable everywhere to buy what two of the three
already do:

| | default | `{ caseSensitive: true }` |
|---|---|---|
| PostgreSQL | `ILIKE` | `LIKE` |
| MySQL | `LIKE` | `LIKE BINARY` |
| SQLite | `LIKE` | `GLOB` |

SQLite has no case-sensitive `LIKE`, so the exact form switches to `GLOB` and
translates the pattern — `%` and `_` become `*` and `?`, and a literal `*`, `?`
or `[` is escaped so it stays literal.

The default follows each driver's own configuration, which is what makes it
index-friendly: SQLite honours `PRAGMA case_sensitive_like`, MySQL the column's
collation. Under a case-sensitive pragma or a `_cs`/`_bin` collation the default
stops ignoring case. Pass `caseSensitive: true` when the comparison must not
depend on either, and note that SQLite's `LIKE` folds ASCII only.

The and/or connector is not part of these signatures — `orWhereLike()` and
`orWhereNotLike()` already express it — so the third argument is always the
options object.

`ILIKE` also remains available as a raw operator for PostgreSQL —
`where("name", "ILIKE", "%a%")` — on the same footing as MySQL's `<=>` and
SQLite's `GLOB`. The operator list is an injection allowlist, not a portability
guarantee: it is the caller's business whether the target accepts what it emits.

`whereFullText` uses Postgres `tsvector` and MySQL `MATCH … AGAINST`. SQLite
falls back to grouped `LIKE` predicates for portability; use the
[SQLite FTS5 search engine](./search.md#engine-sqlitefts5engine) when an indexed
full-text search is required.

### Multi-column

```ts
User.whereAll(["first_name", "last_name"], "like", "%smith%");  // every col matches
User.whereAny(["email", "phone"], "like", "%example%");         // any col matches
User.whereNone(["email", "phone"], "like", "%blocked%");       // no col matches
```

Passing an empty column list to these helpers adds no condition to the query.
The same no-op rule applies to an empty comparison list passed to
`whereColumn([])`.

### Primary-key shortcuts

```ts
User.whereKey(1);                  // WHERE id = 1
User.whereKey([1, 2, 3]);          // WHERE id IN (1,2,3)
User.whereKeyNot(99);              // WHERE id != 99
```

Useful in scopes and policies — they read better than `where("id", …)` and adapt automatically if a model overrides `primaryKey`.

## Ordering, grouping, limiting

```ts
User.orderBy("name", "asc");
User.orderByDesc("created_at");
User.latest();                     // model's getCreatedAtColumn(), descending
User.latest("published_at");
User.oldest();                     // model's getCreatedAtColumn(), ascending
DB.table("users").latest();       // generic builders fall back to created_at
DB.table("users").latest("createdAt"); // explicit generic custom column
User.inRandomOrder();              // RANDOM() / RAND() — use sparingly on large tables
User.orderBy("name").reorder();    // clear orders
User.orderBy("name").reorder("id"); // replace
User.orderBy("name").reorderDesc("created_at"); // replace descending
```

```ts
User.limit(10).offset(20);
User.take(10).skip(20);            // aliases
User.forPage(3, 15);               // offset 30, limit 15
```

```ts
User.groupBy("role");
User.groupBy("role").having("count", ">", 1);
User.select("role")
  .selectRaw("AVG(score) AS average_score")
  .groupBy("role")
  .havingBetween("average_score", [10, 20]);
User.groupBy("role").havingRaw("COUNT(*) > 1");
```

## Joins

```ts
const posts = await Post.query()
  .select("posts.*", "users.name as author_name")
  .join("users", "posts.user_id", "=", "users.id")
  .leftJoin("comments", "comments.post_id", "=", "posts.id")
  .crossJoin("tags")
  .get();
```

For a relation-aware filter, prefer [`whereHas`](./relationships.md#relation-queries) over manual joins — it composes with eager loading and respects soft deletes.

## Unions

```ts
const active = User.where("active", true);
const admin = User.where("role", "admin");

const distinct = await active.union(admin).get();    // dedupes
const all = await active.unionAll(admin).get();      // keeps duplicates
```

## Recursive CTEs

Use recursive tree helpers for adjacency-list data such as folders, categories, threaded comments, and org charts.

```ts
class Folder extends Model.define<FolderAttrs>("folders") {
  items() {
    return this.hasMany(Folder, "parent_id");
  }
}

const tree = await Folder.descendants(1).getTree();
```

That is the shortest path. ORM infers the tree column from the self-referencing `hasMany`, builds a recursive CTE, adds a `depth` attribute, hydrates `Folder` models, and nests children using the matching relation name.

Because `items()` points `Folder -> Folder` through `parent_id`, ORM knows the tree column is `parent_id` and can infer the nested relation name as `items`.

If you already know the parent pointer column, the lower-level API is still available:

```ts
const tree = await Folder.recursive("parent_id").getTree();
```

## Descendants

`descendants()` starts from a model id or ids and walks down the tree.

```ts
const folders = await Folder
  .descendants(1)
  .orderByDepth()
  .orderBy("name")
  .get();
```

Expected flat result:

```ts
folders.json();
// [
//   { id: 1, parent_id: null, name: "Root", depth: 0 },
//   { id: 2, parent_id: 1, name: "Admissions", depth: 1 },
//   { id: 3, parent_id: 1, name: "Billing", depth: 1 },
//   { id: 4, parent_id: 2, name: "Forms", depth: 2 },
// ]
```

`includeRoot()` keeps the starting record in the result. `excludeRoot()` drops it and promotes its children:

```ts
const folders = await Folder
  .descendants(1)
  .excludeRoot()
  .orderByDepth()
  .orderBy("name")
  .get();
```

Expected output:

```ts
folders.json();
// [
//   { id: 2, parent_id: 1, name: "Admissions", depth: 1 },
//   { id: 3, parent_id: 1, name: "Billing", depth: 1 },
//   { id: 4, parent_id: 2, name: "Forms", depth: 2 },
// ]
```

If `excludeRoot()` promotes more than one top-level node, `getTree()` returns a collection instead of a single model.

`getTree()` materializes nested models. See [Tree Results](#tree-results) for return shapes and examples.

## Ancestors

```ts
const folders = await Folder
  .ancestors(4)
  .orderByDepth("desc")
  .orderBy("name")
  .get();

folders.json();
// [
//   { id: 1, parent_id: null, name: "Root", depth: 2 },
//   { id: 2, parent_id: 1, name: "Admissions", depth: 1 },
//   { id: 4, parent_id: 2, name: "Forms", depth: 0 },
// ]
```

`ancestors()` walks up the tree toward the root. It is most useful for breadcrumbs, audit trails, and “show me where this item lives” UI.

With one starting id, `ancestors(...).getTree()` returns a single tree root or `null`:

```ts
const root = await Folder
  .ancestors(4)
  .orderByDepth("desc")
  .getTree();

root; // Folder | null
```

Expected tree shape:

```ts
root?.json();
// {
//   id: 1,
//   parent_id: null,
//   name: "Root",
//   depth: 2,
//   items: [
//     {
//       id: 2,
//       parent_id: 1,
//       name: "Admissions",
//       depth: 1,
//       items: [
//         { id: 4, parent_id: 2, name: "Forms", depth: 0, items: [] },
//       ],
//     },
//   ],
// }
```

## Ordering And Depth

`orderByDepth()` is a convenience wrapper for ordering recursive rows by the synthetic `depth` column.

```ts
await Folder.descendants(1).orderByDepth().get();      // breadth-first
await Folder.descendants(1).breadthFirst().get();      // same as orderByDepth("asc")
await Folder.descendants(1).depthFirst().get();        // same as orderByDepth("desc")
```

`maxDepth()` caps recursion depth. Depth starts at `0` for the starting row or root row.

```ts
const folders = await Folder
  .descendants(1)
  .maxDepth(1)
  .orderBy("depth")
  .orderBy("name")
  .get();
```

That returns the starting row plus one level of descendants. `cycleGuard()` is a convenience alias that applies a default depth cap.

## Paths And Flags

`path()` adds a breadcrumb-style string to every row. The default path column is `name` and the default alias is `path`.

Concrete example:

```ts
const folders = await Folder
  .descendants(1)
  .path("name")
  .hasChildren()
  .leaf()
  .orderByDepth()
  .orderBy("name")
  .get();
```

Expected result:

```ts
folders.json();
// [
//   {
//     id: 1,
//     parent_id: null,
//     name: "Root",
//     depth: 0,
//     path: "Root",
//     has_children: true,
//     leaf: false,
//   },
//   {
//     id: 2,
//     parent_id: 1,
//     name: "Admissions",
//     depth: 1,
//     path: "Root > Admissions",
//     has_children: true,
//     leaf: false,
//   },
//   {
//     id: 3,
//     parent_id: 1,
//     name: "Billing",
//     depth: 1,
//     path: "Root > Billing",
//     has_children: false,
//     leaf: true,
//   },
// ]
```

## Tree Results

`getTree()` nests the recursive rows into model relations. The relation name is inferred from the matching self-referencing `hasMany`.

```ts
const tree = await Folder
  .descendants(1)
  .orderBy("depth")
  .orderBy("name")
  .getTree();
```

Expected `json()` output:

```ts
tree.json();
// {
//   id: 1,
//   parent_id: null,
//   name: "Root",
//   depth: 0,
//   items: [
//     {
//       id: 2,
//       parent_id: 1,
//       name: "Admissions",
//       depth: 1,
//       items: [
//         { id: 4, parent_id: 2, name: "Forms", depth: 2, items: [] },
//       ],
//     },
//     { id: 3, parent_id: 1, name: "Billing", depth: 1, items: [] },
//   ],
// }
```

If you pass one starting id and keep the root included, `getTree()` returns `Folder | null`:

```ts
const root = await Folder.descendants(1).getTree();

root; // Folder | null

root?.json();
// {
//   id: 1,
//   parent_id: null,
//   name: "Root",
//   depth: 0,
//   items: [
//     {
//       id: 2,
//       parent_id: 1,
//       name: "Admissions",
//       depth: 1,
//       items: [
//         { id: 4, parent_id: 2, name: "Forms", depth: 2, items: [] },
//       ],
//     },
//     { id: 3, parent_id: 1, name: "Billing", depth: 1, items: [] },
//   ],
// }
```

If you exclude the starting record, `getTree()` returns a collection of the promoted roots:

```ts
const roots = await Folder
  .descendants(1)
  .excludeRoot()
  .getTree();

roots; // Collection<Folder>
```

### Real-world examples

Threaded comments:

```ts
class Comment extends Model.define<CommentAttrs>("comments") {
  replies() {
    return this.hasMany(Comment, "parent_id");
  }
}

const thread = await Comment
  .descendants(rootCommentId)
  .orderBy("depth")
  .getTree();
```

Category navigation:

```ts
const categories = await Category
  .descendants(rootCategoryId)
  .path("slug")
  .maxDepth(3)
  .breadthFirst()
  .get();
```

Use `recursive("parent_id")` when you need the lower-level API against a known parent column. Use `descendants()` and `ancestors()` when the model can infer the tree relation itself.

### Custom CTEs

Use `withRecursive()` when you need to customize the CTE manually:

```ts
const folders = await Folder
  .withRecursive(
    "folder_tree",

    Folder.query()
      .select("folders.*")
      .selectRaw("0 as depth")
      .where("id", folderId),

    Folder.query()
      .from("folders as child")
      .select("child.*")
      .selectRaw("folder_tree.depth + 1 as depth")
      .join("folder_tree", "child.parent_id", "=", "folder_tree.id"),
  )
  .from("folder_tree")
  .orderBy("depth")
  .orderBy("name")
  .get();

folders[0] instanceof Folder; // true
folders[0].getAttribute("depth"); // 0, 1, 2, ...
```

For recursive trees, index the parent pointer:

```ts
table.uuid("id").primary(); // already indexed by the primary key
table.integer("parent_id").nullable().index();
```

If your tree uses UUID keys, index the UUID parent pointer:

```ts
table.uuid("id").primary(); // already indexed by the primary key
table.foreignUuid("parent_id").nullable().index();
```

## Aggregates

```ts
await User.where("active", true).count();
await User.where("email", "test@example.com").exists();
await User.where("email", "missing@example.com").doesntExist();
await User.doesntExist();
await Order.sum("amount");
await Order.avg("amount");
await Order.average("amount"); // alias of avg()
await Product.min("price");
await Product.max("price");
```

`exists()` runs a tiny `SELECT 1` and short-circuits — prefer it to `count() > 0` when you only need a boolean.

`count`, `sum`, `avg`/`average`, `min`, `max`, `exists`/`doesntExist`, `sole`,
`value`/`valueOrFail`, and `pluck` all run either straight off the model or off
a constrained query — `User.sum("credits")` and
`User.where("active", true).sum("credits")` are the same call with a different
starting point.

`count()` always returns a JavaScript `number`. `sum()`, `avg()` and its `average()` alias preserve the
driver's exact numeric representation and return `number | string | bigint`:
MySQL `DECIMAL` and PostgreSQL `NUMERIC` aggregates are strings; large integer
aggregates can be strings or bigints when the connection enables `bigint`. Do
not coerce exact financial totals with `Number(...)` unless the range and
precision are known to be safe. SQLite performs numeric aggregates through its
`INTEGER`/`REAL` numeric representations, so arbitrary-precision decimal
aggregates are not available natively.

## Eager loading

The fastest way to avoid N+1 query bugs. Always pre-load relations you intend to read.

```ts
const posts = await Post.with("author", "comments").get();
for (const post of posts) {
  post.author.name;          // no extra query
  post.comments.length;      // no extra query
}
```

### Nested and constrained

```ts
// Nested: posts → comments → author
const posts = await Post.with("comments.author").get();

// Constrain a relation's query (filter, select, order)
const usersWithPublishedPosts = await User.with({
  posts: (q) => q.where("published", true).orderByDesc("created_at"),
}).get();

// Nest deeply
const usersWithVisibleComments = await User.with({
  "posts.comments": (q) => q.whereNull("flagged_at"),
}).get();
```

### Relation aggregates

These don't load the related rows; they emit extra scalar columns:

```ts
await User.withCount("posts").get();
// → user.posts_count: number

await Order.withSum("items", "price").get();
// → order.items_sum_price: number

await User.withMin("posts", "score").get();
await User.withMax("posts", "score").get();
await User.withAvg("posts", "rating").get();

// Conditional + aliased
await User.withCount({
  posts: (q) => q.where("published", true),
  drafts: (q) => q.where("published", false),
}).get();
// → user.posts_count, user.drafts_count
```

### Boolean existence

`withExists` adds a typed boolean column without hydrating the relation:

```ts
await User.withExists("posts").get();
// → user.posts_exists: boolean
```

### Filter + eager load in one call

```ts
await User.withWhereHas("posts", (q) => q.where("published", true)).get();
// → only users who have at least one published post, AND their published posts are eagerly loaded
```

### Lazy-load prevention

To catch accidental N+1 queries during development, enable lazy-load prevention globally:

```ts
import { Model } from "@rekkr/orm";
Model.preventLazyLoading = true;
```

After that, any access to an un-loaded relation throws — pushing you to add a `.with()` call up the chain. Disable in production or wrap with `if (process.env.NODE_ENV !== "production")`.

## Relation queries

Filter or check relations without dropping into raw joins:

```ts
// Users that have at least one post
await User.has("posts").get();

// Users with at least 3 published posts
await User.whereHas("posts", (q) => q.where("published", true), ">=", 3).get();

// Users with NO posts
await User.doesntHave("posts").get();

// Active users OR users with no posts
await User.where("active", true).orDoesntHave("posts").get();

// Or: filter by a single related column
await User.whereRelation("posts", "title", "like", "Hello%").get();

// Polymorphic: filter a morphTo
const author = await User.findOrFail(1);
await Comment.whereMorphedTo("commentable", author).get();
await Comment.whereMorphRelation("commentable", [Post, Video], "status", "published").get();
```

See [Relationships](./relationships.md#relation-queries) for the full reference.

## Pagination

### Offset (with total)

```ts
const page = await User.orderBy("name").paginate(15, 1);
page.data;          // Collection<User>
page.total;         // number — total matching row count
page.perPage;       // 15
page.currentPage;   // 1
page.lastPage;      // ceil(total / perPage)
page.json();        // plain object suitable for API responses
```

### Simple (no total query)

```ts
const simple = await User.orderBy("name").simplePaginate(15, 1);
simple.data;             // Collection<User>
simple.has_more_pages;   // boolean
simple.next_page;        // number | null
simple.prev_page;        // number | null
```

Use this on big tables where computing the total is expensive and "Next / Prev" navigation is enough.

### Cursor (keyset)

```ts
const first = await User.orderBy("id").cursorPaginate(15);
first.data;          // Collection<User>
first.next_cursor;   // opaque string | null

if (first.next_cursor) {
  const next = await User.orderBy("id").cursorPaginate(15, first.next_cursor);
  next.prev_cursor;
}
```

Cursor pagination is stable under inserts and deletes — perfect for infinite-scroll feeds and append-only event logs.

## Streaming large datasets

Use streaming when you need to process every row but can't hold the result set in memory.

```ts
// Chunked: callback receives a Collection of up to N rows
await User.chunk(100, (users) => {
  for (const user of users) { /* ... */ }
});

// Per-row callback
await User.each(100, (user) => console.log(user.name));

// Keyset-paginated chunks — safe under concurrent writes
await User.chunkById(100, (users) => users.pluck("email"));
await User.eachById(100, (user) => console.log(user.email));

// Descending keyset (newest first)
await User.chunkByIdDesc(100, (users) => users.pluck("id"));

// Async iterators
for await (const user of User.cursor()) { /* one at a time */ }
for await (const user of User.lazy(500)) { /* chunked iteration */ }
for await (const user of User.lazyById(500)) { /* keyset chunked */ }
for await (const user of User.lazyByIdDesc(500)) { /* newest IDs first */ }
```

The by-ID chunk and lazy helpers replace any existing `ORDER BY` clauses with
the requested key order. This prevents conflicting ordering from duplicating or
skipping rows during keyset traversal.

**Avoid `offset` for large tables** — once you're past a few thousand rows, offset pagination becomes O(offset) on most engines. Reach for `chunkById` / `lazyById` instead.

## Model-backed creation

Model-backed builders can construct and save a model on the builder's exact
connection:

```ts
const user = await User.on(tenantConnection).create({
  name: "Alice",
  email: "alice@example.test",
});

const root = await User.on(tenantConnection).forceCreate({
  name: "Root",
  is_admin: true,
});
```

`create()` applies the model's mass-assignment policy. `forceCreate()` accepts
trusted model attributes and bypasses that policy. Both use the normal model
save lifecycle (casts, enum validation, generated keys, timestamps, observers,
and save options) and return the persisted model. They are unavailable on raw
table builders because those builders do not know which model to instantiate.

## Conditional building

`when()` and `unless()` let you compose filters from optional inputs without an `if`-ladder:

```ts
const filters: { name?: string; role?: string } = { name: "Alice" };
const showInactive = false;

const users = await User
  .when(filters.name,  (q, name) => q.where("name", name))
  .when(filters.role,  (q, role) => q.where("role", role))
  .unless(showInactive, (q) => q.where("active", true))
  .get();
```

The first argument can be any value and follows JavaScript truthiness: `0`, `""`,
`null`, `undefined`, `false`, and `NaN` select the default branch. Use this
everywhere you'd otherwise write `if (filters.x) q.where(...)`.

The value is also handed to the callback as its second argument, already
narrowed to a non-nullable type, so you do not have to repeat `filters.name` (or
assert it with `!`) inside the closure. `unless()` mirrors this and passes the
**original** value, not the negated one:

```ts
User.unless(role, (q, value) => q.where("role", value ?? "guest"));
```

The `defaultCallback` receives the value too, so both branches can read it:

```ts
User.when(filters.role,
  (q, role) => q.where("role", role),      // role is a string here
  (q, role) => q.where("role", role ?? "guest"), // role is the falsy value
);
```

The first argument may also be a closure, which is invoked with the builder and
whose return value decides the branch. Use it when the condition is expensive or
has to be evaluated lazily at the point of the call:

```ts
User.where("active", true)
  .when(() => isPromoWeek(), (q) => q.where("promo", true));
```

## Select, raw, and subqueries

```ts
User.select("name", "email");
User.addSelect("role");                            // append without replacing
User.select("name").selectRaw("price * 2 as doubled");
User.fromSub(User.where("price", ">", 100), "expensive");
User.select("*").distinct();
User.orderByRaw("LOWER(name) ASC");
User.selectRaw("DATE(created_at) as day, COUNT(*) as total").groupByRaw("DATE(created_at)");
User.orderByRaw("CASE WHEN role = ? THEN 0 ELSE 1 END", [preferredRole]);
```

`whereRaw`, `selectRaw`, `orderByRaw`, `groupByRaw`, and `havingRaw` accept `?` placeholders plus a bindings array. The SQL fragment itself is trusted developer input: never interpolate request data, and use the ordinary `select`, `where`, `groupBy`, and `orderBy` methods whenever possible. Ordinary column methods always quote their arguments; SQL expressions must be explicit through a `*Raw` method.

Builder instances passed to `fromSub`, `union`, `unionAll`, and `withRecursive` keep their bindings. A string passed as a subquery is raw SQL and must therefore contain no untrusted input.

## Locking

Available on MySQL and PostgreSQL:

```ts
await User.where("id", 1).lockForUpdate().first();         // FOR UPDATE
await User.where("id", 1).sharedLock().first();            // FOR SHARE / LOCK IN SHARE MODE
await Job.where("status", "pending").skipLocked().limit(10).get();
await Job.where("status", "pending").noWait().first();
```

Combine with a [transaction](./transactions.md) — locks released on commit / rollback.

`skipLocked` is the idiomatic way to pull jobs off a queue without contention:

```ts
await DB.transaction(async () => {
  const jobs = await Job
    .where("status", "pending")
    .orderBy("created_at")
    .limit(10)
    .lockForUpdate()
    .skipLocked()
    .get();
  for (const job of jobs) { /* ... */ }
});
```

## Bulk write operations

Write payloads omit properties whose value is `undefined`, allowing database
defaults to run. An explicit `null` is still bound as SQL `NULL`. Bulk records
must have the same columns after undefined values have been omitted.

```ts
// Raw insert — no model events fire
await User.query().insert({ name: "Alice", email: "alice@example.com" });
await User.query().insertOrIgnore([{ email: "a@b.com" }, { email: "c@d.com" }]);
const id = await User.query().insertGetId({ name: "Bob" });

// Upsert: insert or update on conflict
await User.query().upsert(
  [{ email: "alice@example.com", name: "Alice" }],
  ["email"],          // unique key columns
  ["name"],           // columns to overwrite on conflict
);

// Update matched rows
await User.where("active", false).update({ deleted: true });
await User.where("active", false).orderBy("id").limit(10).update({ deleted: true });

// Update with JOIN (MySQL)
await Post.query().updateFrom("users", "users.id", "=", "posts.user_id");

// Delete
await User.where("active", false).delete();

// For soft-deleting models, delete() sets deleted_at. Permanent deletion is explicit.
await User.onlyTrashed().where("active", false).forceDelete();

// Increment / Decrement
await user.increment("login_count");
await user.increment("login_count", 5, { last_login_at: new Date() });
await user.decrement("stock", 10);
await User.where("active", false).decrement("score", 2);
```

Builder writes do not run per-instance lifecycle hooks or timestamps. `insert()` bypasses observers; when a model has registered observers, `update()` dispatches `updated`/`saved` and `delete()` dispatches `deleted` for the affected IDs. If before-hooks or fully hydrated event models matter, work through model instances (`new User()`, `user.save()`, `user.delete()`) instead.

On model-backed builders, limited updates and increments first select the
matching primary keys, so `limit()` constrains the rows actually modified.

## Debugging

```ts
const query = User.where("name", "Alice");
query.toSql();                      // SQL with driver placeholders
query.bindings;                     // ["Alice"]
query.toRawSql();                   // interpolated SQL for diagnostics only
query.dump();                       // log raw SQL, keep chain
query.dd();                         // log raw SQL and throw
await User.where("name", "Alice").explain(); // run EXPLAIN
```

`dd()` ("dump and die") is the fastest way to verify a query before adding `.get()` at the end.

## Common pitfalls

- **N+1 queries.** If you find yourself looping over a collection and accessing relations, add a `.with()` higher up. Turn on `Model.preventLazyLoading = true` in development to catch these automatically.
- **`offset` on huge tables.** Past a few thousand rows, `LIMIT/OFFSET` pagination scans linearly. Use `chunkById`, `lazyById`, or `cursorPaginate`.
- **Builder writes are not instance writes.** They skip per-instance before-hooks and timestamps; use model instances when those lifecycle details matter.
- **`distinct()` and `with()` together.** Eager-load joins can introduce duplicate parent rows. Add `distinct()` or use the relation aggregate variants (`withCount`, `withExists`) when you only need scalars.
- **Locking outside a transaction is a no-op.** `lockForUpdate` releases at
  commit, so wrap model queries in `DB.transaction(...)` or explicitly run them
  through the `tx` passed to `connection.transaction(...)`.

## Method reference

Most builder methods can be called either from `Model.query()` or directly on the model class:

```ts
await Room.whereExists("SELECT 1 FROM bookings WHERE bookings.room_id = rooms.id").get();
await Room.whereBetween("capacity", [2, 8]).orderByDesc("capacity").get();
```

| Method | Description |
|---|---|
| `where(col, op, val)` | Basic equality or operator filter |
| `where(obj)` | Object of column → value pairs |
| `where(fn)` | Nested where group via closure |
| `orWhere(...)` | OR variant of `where` |
| `whereNot(col, val)` | `!=` filter |
| `orWhereNot(...)` | OR `!=` |
| `whereIn(col, vals)` | `IN` set |
| `orWhereIn(...)` | OR `IN` |
| `whereNotIn(col, vals)` | `NOT IN` |
| `orWhereNotIn(...)` | OR `NOT IN` |
| `whereNull(col \| cols)` | `IS NULL` |
| `orWhereNull(...)` | OR `IS NULL` |
| `whereNotNull(col \| cols)` | `IS NOT NULL` |
| `orWhereNotNull(...)` | OR `IS NOT NULL` |
| `whereBetween(col, [a, b])` | `BETWEEN` |
| `orWhereBetween(...)` | OR `BETWEEN` |
| `whereNotBetween(col, [a, b])` | `NOT BETWEEN` |
| `orWhereNotBetween(...)` | OR `NOT BETWEEN` |
| `whereExists(sql)` | `EXISTS (subquery)` |
| `orWhereExists(...)` | OR `EXISTS` |
| `whereNotExists(sql)` | `NOT EXISTS` |
| `orWhereNotExists(...)` | OR `NOT EXISTS` |
| `whereColumn(a, b)` / `whereColumn(a, op, b)` | Compare two columns |
| `whereBetweenColumns(col, [low, high])` | Bounds are columns |
| `orWhereColumn(...)` | OR column compare |
| `whereRaw(sql, bindings?)` | Raw SQL where clause |
| `orWhereRaw(...)` | OR raw SQL |
| `whereDate / whereDay / whereMonth / whereYear / whereTime` | Date-part filters |
| `wherePast / whereFuture / whereNowOrPast / whereNowOrFuture / where*Today` | Relative-date filters |
| `whereJsonContains / whereJsonDoesntContain` | JSON-array membership (cross-DB) |
| `orWhereJsonContains / orWhereJsonDoesntContain` | OR JSON-array membership |
| `whereJsonLength / orWhereJsonLength` | JSON array length |
| `whereLike / whereNotLike / orWhereLike / orWhereNotLike` | Pattern filters, case-insensitive by default |
| `whereRegexp / whereFullText / orWhereFullText` | Regular-expression and FTS filters |
| `whereAll(cols, op, val)` | Multi-column `AND` |
| `whereAny(cols, op, val)` | Multi-column `OR` |
| `whereNone(cols, op, val)` | Negated multi-column `OR` |
| `whereKey(id \| ids)` | Filter by primary key |
| `whereKeyNot(id \| ids)` | Exclude by primary key |
| `orderBy(col, dir)` | Sort |
| `orderByDesc(col)` | Sort descending shorthand |
| `orderByRaw(sql, bindings?)` | Raw `ORDER BY` |
| `latest(col?)` / `oldest(col?)` | Order by timestamp |
| `inRandomOrder()` | RANDOM ordering |
| `reorder(col?, dir?)` / `reorderDesc(col?)` | Clear / replace orders |
| `groupBy(...cols)` / `groupByRaw(sql, bindings?)` | Group |
| `having / havingBetween / havingRaw / orHaving*` | Group filters |
| `join / leftJoin / rightJoin / crossJoin` | Joins |
| `union(query)` / `unionAll(query)` | Set ops |
| `select / addSelect / selectRaw / distinct / fromSub` | Column selection |
| `limit / offset / take / skip / forPage` | Row limits |
| `lockForUpdate / sharedLock / skipLocked / noWait` | Locks |
| `get / first / firstOr / find / findOr / findMany / findOrFail` | Read terminators |
| `firstWhere / firstOrFail / sole / value / valueOrFail / pluck` | Read terminators |
| `count / sum / avg / average / min / max / exists / doesntExist` | Aggregates |
| `paginate / simplePaginate / cursorPaginate` | Pagination |
| `chunk / each / chunkById / chunkByIdDesc / eachById` | Streaming |
| `cursor / lazy / lazyById / lazyByIdDesc` | Async iterators |
| `create / forceCreate` | Persist and return a model (model-backed builders only) |
| `insert / insertGetId / insertOrIgnore / upsert` | Inserts |
| `update / updateFrom / increment / decrement` | Updates |
| `delete / forceDelete / restore` | Delete or restore rows |
| `with(...rels)` | Eager load |
| `has / orHas / whereHas / orWhereHas / doesntHave / orDoesntHave / whereDoesntHave / orWhereDoesntHave` | Relation existence |
| `whereRelation / orWhereRelation` | Filter by related column |
| `whereMorphRelation / whereMorphedTo / orWhereMorphedTo / whereNotMorphedTo` | Polymorphic filters |
| `withWhereHas` | Filter + eager load |
| `withCount / withSum / withMin / withMax / withAvg` | Relation aggregates |
| `withExists` | Boolean relation flag |
| `scope(name, ...args)` | Apply local scope |
| `withoutGlobalScope(name) / withoutGlobalScopes()` | Drop global scopes |
| `withTrashed() / withoutTrashed() / onlyTrashed()` | Soft delete visibility |
| `when(value, fn, elseFn?) / unless(...)` | Conditional; `value` may be a closure and is passed to the callbacks |
| `tap(fn)` | Mutate and return |
| `clone()` | Copy builder state |
| `toSql() / toRawSql() / dump() / dd() / explain()` | SQL compilation and debugging |
