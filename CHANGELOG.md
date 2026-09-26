# Changelog

## Unreleased

### Node.js support

- ORM runs on Node.js 24.21 or newer as well as on Bun, with the same API and
  CLI. SQLite uses the built-in `node:sqlite`; PostgreSQL, MySQL and Redis use
  `pg`, `mysql2` and `ioredis`, declared as optional peer dependencies. On Bun
  nothing changes: the driver is still `bun:sql`, and there are still no
  dependencies. See [Installation](./docs/installation.md#what-differs-between-runtimes)
  for what remains different.
- The test suite runs on both runtimes against the same servers and holds them
  to one values contract: the same JavaScript type for every column type, dates
  stored as UTC whatever the process time zone, the same write counts and error
  codes.
- On Node.js the CLI loads `.env` files with Bun's precedence and `${NAME}`
  expansion, names the file when Node.js cannot strip its TypeScript, and runs
  `orm repl` on `node:repl`.
- `resolveRedisClient()` is exported from `@rekkr/orm/cache` and
  `@rekkr/orm/queue`: the default Redis client on either runtime, for wiring a
  `RedisCacheStore` or `RedisQueueDriver` by hand.
- `require("@rekkr/orm")` and its subpaths load on Node.js, for CommonJS
  projects and tools such as Jest, and hand back the same module as `import`,
  so both share one `configureOrm()` state.
- `prepare: true` works on Node.js too: PostgreSQL statements with bindings
  are named and planned once per session, as on Bun. The default stays `false`.
- On MySQL, every pooled connection opens in UTC on Node.js as well: the
  `mysql2` adapter runs `SET time_zone = '+00:00'` on each connection before
  its first statement, as `bun:sql` has done itself since Bun 1.4.1. A server
  whose default time zone is not UTC therefore needs no configuration on either
  runtime; before, a date write was refused on such a server and `TIMESTAMP`
  columns were read shifted by the session's offset. A proxy that rejects
  `SET time_zone` is not supported. See [Configuration](./docs/configuration.md#mysql-sessions-run-in-utc).

### Added

- A searchable model no longer needs `fts`. Without it, the PostgreSQL and
  SQLite engines index the model's table: text columns are searched, the
  others stored for `where()`, `orderBy()` and `facet()`, and the primary key
  and `hidden` columns left out. `Search.register(Post)` is the whole setup,
  as with Scout; `fts` stays for choosing columns, computed fields, a language
  or a tokenizer. See [Search](./docs/search.md#choosing-what-to-index--fts).
- `DB.listen(listener)` calls a function after each statement the application
  runs, on every connection, with its SQL, bindings, duration, connection and,
  if it failed, the error; it returns the function that stops it. Transaction
  control, savepoints and the ORM's own session checks are not reported. A
  listener that throws or rejects is reported with `console.error` and never
  reaches the query. The events are published on the `node:diagnostics_channel`
  channel `@rekkr/orm:query`, so APM and OpenTelemetry tooling can subscribe by
  name. With no listener the cost is one boolean check per statement; measured
  within noise on both runtimes. See [Configuration](./docs/configuration.md#listening-to-queries-in-code).

### Performance

- `create()`, `save()` of a new model and pivot inserts no longer read the
  table's primary key column from the schema before every insert. It is read
  once per database, schema and table, and again after this process changes a
  table's shape. On PostgreSQL that lookup was 86% of a `create()`: measured
  per `create()`, 23.6× faster on Bun (1.61 → 0.07 ms) and 16.4× on Node.js
  (1.75 → 0.11 ms); 1.6–1.8× on MySQL and 1.3–1.4× on SQLite. Checking each
  statement for a schema change costs nothing measurable on either runtime.
  A table re-keyed by another process is seen after a restart.

### Breaking

- Bun minimum is 1.4.2 (was 1.4.1), the release CI runs the suite on.
- `Connection.driver` is typed `SqlDriver`, the ORM's own driver contract,
  instead of Bun's `SQL`. On Bun it is still the same `SQL` object, which
  satisfies the contract as it is; code that used a Bun-only member casts it
  (`connection.driver as unknown as SQL`).
- Types resolve from the emitted declarations (`dist/**/*.d.ts`) instead of the
  TypeScript source, so a consumer's compiler flags stop applying to the ORM's
  implementation: a project with `exactOptionalPropertyTypes` and similar flags
  saw hundreds of errors in ORM code. A Git install without `dist/` falls back
  to the source.
- `update()`, `increment()` and `decrement()` on a model query set
  `updated_at` to the current time, as Eloquent does, unless the call passes a
  value for it. They left it alone, so an incremental sync reading rows by
  `updated_at` missed every bulk update. A backfill or data migration that must
  not mark rows as changed runs inside `Model.withoutTimestamps()`; a builder
  with no model is unaffected. In an `UPDATE ... JOIN` built with
  `updateFrom()` the column is qualified with the model's table, since the
  joined table may have its own `updated_at`. See
  [Query builder](./docs/query-builder.md).
- `upsert()` on a model query sets timestamps as `User.upsert()` does: both
  columns on the rows it inserts, `updated_at` on the rows it updates. It set
  none, so it inserted rows with a NULL `created_at`. `User.insertGetId()` and
  `User.insertOrIgnore()` set `created_at` and `updated_at` as `User.insert()`
  does; they wrote NULL. A value the call passes is kept. The query
  `insert()`, `insertGetId()` and `insertOrIgnore()` stay the raw path, without
  timestamps. See [Models](./docs/models.md#insert--insertorignore--upsert).
- `User.upsert()` and `saveMany()` (with `createMany()`) write in chunks of 100
  rows unless `chunkSize` says otherwise, as `User.insert()` already did. They
  sent the whole batch in one statement, which failed past each database's
  parameter limit: 65,535 on PostgreSQL, MySQL and Bun's SQLite, 32,766 on
  `node:sqlite`. A batch of 8,000 rows of 9 columns failed on all three. A
  `chunkSize` that is not a positive integer throws, as it does for
  `insert()`; `0` meant the whole batch.
- A model bulk write that takes more than one statement runs in a transaction,
  or a savepoint inside one already open, as knex's `batchInsert` does:
  `User.insert()` and `User.upsert()` when the batch spans several chunks, and
  `saveMany()` / `createMany()` with `{ events: false }` for two or more
  models, since an auto-increment key inserts them one by one. A failing
  chunk left the earlier ones written. When `saveMany()` fails, its models go
  back to the state they had before the call, so none claims a row that was
  rolled back.
- The `orm` bin is `bin/orm.mjs`, which runs the CLI on the runtime that
  launched it: Node.js under npm, pnpm and yarn; Bun under `bunx`, `bun run`,
  and when invoked directly with Bun installed.
- `RedisCacheStore` and `RedisQueueDriver` take the ORM's own client interfaces
  (`RedisLike`, `RedisQueueLike`) instead of `Pick<RedisClient, …>`. Bun's
  `RedisClient` still fits them.
- An attribute with the `date` cast serializes as `"2024-01-15"` instead of
  `"2024-01-15T00:00:00.000Z"`, in `toJSON()`, `json()` and `rawJson()`. The
  midnight instant read as the previous day anywhere west of UTC: a browser in
  New York formatting it showed 14 January. Reading the attribute still gives a
  `Date` at UTC midnight; `datetime` attributes and timestamps keep the full
  instant, and an accessor on the column still replaces the cast. A `DATE`
  column without the cast is unchanged, so give calendar days the `date` cast.
- `timestamps()`, `datetimes()`, `softDeletes()` and `softDeletesDatetime()`
  default to precision 3 instead of the database's 0. The model writes these
  columns from a `Date`, and at whole seconds PostgreSQL and MySQL rounded its
  milliseconds: a model just created held `…42.578Z` while its row said
  `…43.000Z`, which broke equality checks on `updated_at` and could push a row
  into the next day. Pass `{ precision: 0 }` to keep whole seconds. Existing
  tables are not altered; [Schema builder](./docs/schema-builder.md#convenience-helpers)
  shows the `ALTER` that widens them. SQLite is unaffected.
- `float()` and `double()` create double-precision columns that store the value
  as given: `DOUBLE` on MySQL, `DOUBLE PRECISION` on PostgreSQL, `REAL` on
  SQLite. On MySQL they were `FLOAT(8,2)` and `DOUBLE(8,2)`, which rounded
  3.14159 to 3.14 and refused anything from a million up, while the other
  databases kept the value; MySQL's single-precision `FLOAT` also read 1.1 as
  1.100000023841858 whenever the query had bindings. `float(name, precision)`
  now takes a precision in bits, as SQL's `FLOAT(p)`: 24 or less gives
  single precision. Neither takes a scale any more, and passing one throws;
  use `decimal()` for a fixed number of places. Existing tables are not altered;
  [Schema builder](./docs/schema-builder.md#floating-point-and-decimals) shows
  the `ALTER` for each database.
- The Meilisearch engine is removed: `MeilisearchEngine`, the `"meilisearch"`
  and `"meili"` aliases, the `host` and `apiKey` search options, and the
  Meilisearch settings validation (`validateMeilisearchSettings`,
  `InvalidMeilisearchSettingsError`, `MEILISEARCH_SETTING_KEYS`). So are the
  builder methods only it implemented, `vector()`, `hybrid()` and
  `orderByGeo()`, which the built-in engines ignored without a word, along with
  the `vector`, `hybrid` and `typoTolerance` capabilities and
  `SearchEngine.waitForTask()`. Search now runs on PostgreSQL full-text search
  or SQLite FTS5, in the database the application already uses; another
  service can still be wired through the `SearchEngine` interface. See
  [Search](./docs/search.md).
- `SqliteFTS5Engine` names its FTS5 tables `_fts_<index>`, as
  `PostgresFTSEngine` already did (`prefix` option). An index created before
  this change must be created again with `orm search:create-index` and
  `orm search:import`.

### Fixed behaviour

- Clearing a `date`, `datetime` or `timestamp` value at the Unix epoch now
  persists `null` on MySQL and PostgreSQL. Their drivers return a `Date`; the
  dirty check previously converted `null` to the epoch and skipped the UPDATE.
- Instance `increment()` and `decrement()` now fire `updating` before the SQL
  write and `updated` afterward, without `saving` or `saved`. An `updating`
  observer can abort by throwing. `incrementQuietly()` and
  `decrementQuietly()` keep the previous observer-free behavior.
- The PostgreSQL and SQLite search engines read the model's `fts` config in
  every process. Only `search:create-index`, `search:reindex` and
  `search:verify` passed it to the engine, so an application following the
  documentation failed on its first `Post.create()` or `Post.search()` with
  `no schema configured for index "posts"`. An index with no explicit
  `configureIndex()` now takes the `fts` of the registered model whose
  `searchableAs()` returns its name, per tenant under `tenantScope`; an
  explicit config still wins. `orm queue` loads `modelsPath` when search is
  configured, so search jobs find the config in the worker too.
- Everything the CLI writes compiles under `strict` with `noImplicitOverride`,
  `exactOptionalPropertyTypes` and `noPropertyAccessFromIndexSignature`. The
  `make:command`, `make:job` and `queue:install --models` stubs lacked
  `override` on the statics they redefine; the `orm init` config read
  `process.env.DATABASE_URL` without brackets. `types:generate` wrote a column
  such as `first-name` or `2fa` as a bare property, which is a syntax error;
  it is now quoted. A column named after a `Model` member (`save`, `delete`,
  `toJSON`) no longer becomes a property or accessor of the class, where it
  broke the model; it stays typed through `getAttribute()`. The `fill()`
  overload the declarations added is gone: it failed under
  `exactOptionalPropertyTypes`, and `Model.fill()` already takes the model's
  attributes. A test now runs every scaffold command and compiles the output as
  an installed project would.
- `SqliteFTS5Engine` no longer writes to the table it indexes. Its FTS5 table
  took the index name, which defaults to the model's table: `createIndex()`
  found that table already there and did nothing, each save overwrote the row
  with only the indexed fields and blanked the others, and
  `removeAllFromSearch()` or `orm search:flush` deleted every row of it.
- An `orWhere()` on a search no longer escapes the text match. The PostgreSQL
  and SQLite engines appended the filters to the match without parentheses, so
  `Post.search("rust").where("status", "draft").orWhere("featured", true)` ran
  as `(match AND draft) OR featured`: PostgreSQL returned featured rows that do
  not mention "rust", and SQLite refused the query with `unable to use function
  MATCH in the requested context`.
- `forceDelete()` on a model instance fires the `deleting` and `deleted`
  observers, as `delete()` does and as Eloquent does, with or without soft
  deletes. It fired neither, so an observer that cleans up after a row, such as
  removing its file, missed every permanent delete. A `deleting` observer that
  throws now stops the delete. `forceDeleteQuietly()` deletes permanently
  without observers, the way `forceDelete()` used to. See
  [Commands](./docs/commands.md#recipe-pruning-old-records) for a recipe that
  replaces Laravel's `model:prune`.
- `restore()` on a model instance fires the `restoring` and `restored`
  observers, as [Observers](./docs/observers.md) already promised. It fired
  neither, so a `restored` observer never ran. A `restoring` observer that
  throws now leaves the row trashed. `restoreQuietly()` restores without
  observers. Unlike Eloquent's, `restore()` is not a `save()`: it writes only
  `deleted_at` and `updated_at` and fires no save events.
- A soft delete and `restore()` set `updated_at` along with `deleted_at`, as
  Eloquent does. That covers `delete()`, `deleteQuietly()` and `restore()` on
  a model, and `delete()` and `restore()` on a query, which follow the rule
  for query updates under Breaking. They left `updated_at`
  alone, so an incremental sync that reads rows by `updated_at` missed every
  delete and restore. A query-level `restore()` now only updates trashed rows:
  it also matched live rows and would have moved their `updated_at`. See
  [Models](./docs/models.md#soft-deletes).
- `upsert()` with explicit update columns sets `updated_at` on the rows it
  updates, as Eloquent does. Unless the list named `updated_at`, an updated row
  kept its old `updated_at` and an incremental sync missed it.
- On MySQL, a date written under a qualified key, such as
  `update({ "posts.published_at": "2024-01-01T00:00:00Z" })` in an
  `updateFrom()` join, reached the server as ISO text and was rejected as an
  incorrect datetime. It is now converted like an unqualified one.
- `orm types:generate` with `modelsPath` set to a path or a list of paths, the
  single-database setup, generated no declarations: it excluded its own model
  directory as if it belonged to another tenancy scope, found no models and
  only warned "No models discovered". It now generates them; a config that
  separates `landlord` and `tenant` paths still keeps each scope's models apart.
- `orm types:generate <dir>` writes the declarations to `<dir>`, as documented.
  With a single model directory it wrote them to that directory's `types/`
  folder instead, while reporting `<dir>` as the output.
- `search:status`, `search:verify`, `search:list-indexes` and
  `search:sync-index-settings` handled a searchable model once per name it was
  exported under, so a model exported as `Post`, as its base class and as
  `default` was listed and synced twice. Each class is now handled once.
- `orm make:model` scaffolds `export class User extends Model {}` instead of a
  hand-written attribute interface and `Model.define()`, and `orm
  make:searchable` scaffolds a named model class passed to `Search.register()`
  instead of an unexported `_Post` behind a default export. Both work with
  `orm types:generate`, which could not type the old searchable scaffold at all.
  A model whose table the convention would misname (`Category`, `Status`) gets
  `static override table`, so it still reads the table its migration creates.
- Generated stubs (`typeStubs: true`) compile under `strict`: the getter of a
  nullable column returned `T | null` while reading an optional attribute, a
  type error for nearly every table since `timestamps()` columns are nullable.
  They also declare `static override table`, so they compile under
  `noImplicitOverride`.
- Type generation warns about a model exported only as `export default class`.
  TypeScript cannot merge the generated `declare module` block into a default
  export, so its declarations typed nothing and nothing said so. The warning
  names the file and asks for a named export (`export class User`); a class
  also exported by name, or a table mapped in `typeDeclarations`, is not
  reported. See [Type Generation](./docs/type-generation.md).
- `updateTimestamps()` followed by `save()` writes the new `updated_at`. The
  column was set without being marked as changed, so `save()` found nothing to
  write and left the model with the new time in memory and the old one in the
  database.
- A timestamp you set yourself is kept, as Eloquent does. `create()`, `save()`,
  `createMany()`, `saveMany()`, `increment()`, `decrement()` and
  `updateTimestamps()` overwrote `created_at` and `updated_at` with the current
  time even when the model carried its own value, so importing a row with its
  real creation date took `withoutTimestamps()`. They now stamp only a column
  left alone, as `insert()` and `upsert()` already did. See
  [Models](./docs/models.md#timestamps).
- With `log.file` set, a process restarted on the same day overwrote the day's
  query log from its first byte and left the tail of the old log behind. Lines
  are now appended.
- Every command in a project fresh from `orm init` printed `[Commands]
  commandsPath not found` on stderr, because the generated config points at
  `./app/commands` and init does not create it. A missing commands directory
  now means "no commands"; an unreadable one still fails.
- Date-time text without a zone, such as SQLite's `CURRENT_TIMESTAMP` output
  `2026-08-27 12:00:00`, was read in the process's local time zone: in New York
  it became 16:00 UTC. It is now read as UTC, the way ORM stores dates, when a
  `datetime` cast decodes it, when a model compares it for changes, and when it
  is written to MySQL. Reading that text is also faster, 5–11% on `rawJson()`
  of SQLite rows, because it is assembled rather than parsed.
- Assigning an attribute the value it already had no longer marks it changed
  when the database hands that value back in another form: `true` for a
  `boolean` cast the model stores as 1 (PostgreSQL), 12.5 for a `decimal:2`
  stored as "12.50" (SQLite), a JSON object with its keys reordered (MySQL
  `JSON`, PostgreSQL `JSONB`), "5" for a `BIGINT` given as 5 (PostgreSQL, where
  every `id()` and `foreignId()` column is one), or equal bytes in a new
  buffer. Filling a model with unchanged form data made `save()` run an
  `UPDATE`, bump `updated_at` and fire the `updating`/`updated` observers.
  Values under a built-in cast are now compared as the cast reads them. It
  costs 7–14 ns per `getDirty()` call (4–5%), measured on both runtimes;
  `toJSON()` and `rawJson()` are unchanged within noise.
- A plain object bound to a query is sent as JSON text on every driver, as
  MySQL's drivers already did: on PostgreSQL under Bun it was written as
  `"[object Object]"`, and SQLite refused it. An array is JSON text too, except
  on PostgreSQL, where it is a PostgreSQL array (`payload ?| ${["a", "b"]}`,
  `id = ANY(${ids})`). That worked on Node.js and failed on Bun, which sent
  `1,2`. A model attribute with a `json` cast is unaffected: the cast already
  writes text.
- A binary column serializes like a `Buffer`, `{ "type": "Buffer", "data": […] }`,
  on every driver. SQLite hands back a `Uint8Array`, which `toJSON()`,
  `json()` and `rawJson()` turned into an object keyed by index.
- Migrations are imported by file URL, not by raw path.
- Four tests awaited nothing on `expect(...).rejects` and asserted nothing; they
  now assert.

### Internal

- One unique-violation classifier, shared by `Connection` and the migration
  lock, reads the database's own codes; the lock no longer falls back to
  matching the error message.
- Tests import their API from `tests/harness.ts`, which is `bun:test` on Bun and
  vitest on Node.js. `bun run test:node` runs the suite under Node.js, and CI
  runs both.
- CI runs the suite on both runtimes with the process in seven more time zones,
  from UTC−11 to UTC+14, including half- and three-quarter-hour offsets and
  daylight saving in both hemispheres. It had only ever run in UTC, which hid
  the zone-less date reading fixed above.
- vitest reads `.env` like `bun test`, expanding its `${VAR}` references.
  Locally, `bun run test:node` used to skip every PostgreSQL, MySQL and Redis
  test in silence and still come out green. The suite now refuses to start with
  a server URL unset, on either runtime; `ORM_TEST_SKIP_SERVERS=1` skips them
  on purpose.
- The driver contract takes every built-in cast through the model on SQLite,
  MySQL and PostgreSQL, on both runtimes, with columns from the schema builder:
  what `create()` leaves in memory is what `find()` reads back, `toJSON()`,
  `json()` and `rawJson()` agree, and assigning the same values again writes
  nothing. It found the four fixes above.

## 4.1.0 — 2026-09-21

### Fixed behaviour

- `relation.whereIn()`, `.orderBy()` and `.limit()` were recorded but never
  applied to the relation's own query, so `user.posts().whereIn("id", [1])`
  returned every post. They now constrain it, like `.where()` always did.
  Affects `hasMany`, `hasOne`, `belongsTo` and `hasManyThrough`.
- `Schema.hasIndex()` and `hasForeignKey()` ignored the connection argument and
  always inspected the default database.
- Relation constraints now qualify the column with the related table, so
  `where`/`whereIn`/`orderBy` on a `hasManyThrough` no longer fail with
  "ambiguous column name".

### Fixed types

- `hasOneThrough().get()` was typed `Collection<T>` but returns a model:
  now `T | null`. Eager-loaded `hasManyThrough`/`hasOneThrough` infer
  `Collection<T>` and `T | null` instead of a union that omitted `null`.
- `with({ relation: cb })` on a `morphTo` inferred `unknown`; now `Model | null`.
- `BelongsTo.get()` and `HasOne.get()` no longer widen to `Collection<T> | T`.
- Instance `loadSum`/`loadAvg`/`loadMin`/`loadMax` return the aggregate, not `this`.
- `with()` no longer loses a relation when array and constraint-map forms mix.

### Improved inference

- Query statics type their column, and their value by column where `Builder`
  already did. Keys (`find`, `findMany`, `whereKey`, `Collection.find`) take the
  new `ModelKey`.
- New exported types: `WriteResult`, `ModelKey`, `ModelType`. Driver write
  methods return `Promise<WriteResult>` instead of `Promise<any>`.
- Callbacks the ORM awaits (`chunk`, `each`, `Events.listen`, factory hooks)
  accept concise arrows such as `(user) => seen.push(user.id)`.
- `Model.orWhereHas`, `MorphMap.register`, `Factory.for` and
  `toSqlWithEagerLoads` are callable from typed code.
- `Connection.query<TRow>()` is generic over the row;
  `rule().object(shape, "passthrough")` types its output.

### Internal

- All 151 test files are typechecked; only 17 were before.
- One declaration per model method, so the typed and untyped copies can no
  longer drift (`Model.ts` 555 → 182 lines).
- `bun run test` now fails if the public surface gains an `any`.

## 4.0.0 — 2026-09-20

### Breaking: dates serialize as ISO strings

- `toJSON()`, `json()` and `rawJson()` emit `"2026-08-20T10:11:12.000Z"` where
  they used to hand back a `Date` object, matching Eloquent's `serializeDate()`.
  Reading the attribute (`user.created_at`) still gives a `Date`.
- `JSON.stringify()` produces the same bytes as before, because it serialized
  those `Date` objects to the same text. Code that took a date out of `toJSON()`
  and called a `Date` method on it must parse it first.
- An unparseable stored date serializes as `null` instead of throwing, which is
  what `JSON.stringify()` already did with an invalid `Date`.

### Breaking: removed inert API

- `Model.dateFormat` is gone. Nothing read it, so setting it never had an
  effect; date formatting follows the cast.
- The unused `UnionClause` type is no longer exported.

### Added

- `push()` saves a model and every relation already loaded on it, depth first.
  It never rewrites a foreign key and visits each model once, so a parent
  holding its own children terminates.
- `getKey()`, `getKeyName()` and `getAttributes()`.
- `shouldBeStrict()` turns on the three development guards at once, including
  the new `preventAccessingMissingAttributes`, which throws
  `MissingAttributeError` when a persisted model is asked for a column the query
  never selected. Every guard is set per model class and defaults to off.

### Performance

Serialization was the bottleneck; the work went into removing work rather than
adding caches.

- The row serializer runs one pass instead of three. It no longer converts a
  date twice, no longer sends a json column the driver already parsed through
  `JSON.stringify` and back, and skips the cast entirely when the stored value
  already serializes to the same output.
- `formatIso()` replaces `Date.prototype.toISOString()` on every path that
  emits a date, at a third of the cost. The calendar arithmetic still belongs to
  the engine; only the string assembly changed. Dates outside years 0000–9999,
  invalid dates and `Date` subclasses keep the built-in.
- Serializing a model no longer allocates a hidden-attribute set when nothing is
  hidden, and no longer resolves each cast definition twice.

Measured against MySQL with `oha`: `/rekkr-json` 1469 → 1948 req/s (+32%),
`/rekkr-rawJson` 1905 → 2573 req/s (+35%), with an unchanged control endpoint.
In the repository benchmarks, per-row cast lookups during `toJSON()` fall from
8.00 to 4.00, proxy traps from 62.00 to 3.00, and the model path from 3.95x to
2.63x the driver-plus-encode floor.

### Compatibility and verification

- Upgrading needs no code change unless something consumed a `Date` out of
  `toJSON()`, read `Model.dateFormat`, or imported `UnionClause`.
- 1,761 tests pass against SQLite, MySQL 8, PostgreSQL and Redis, plus the type
  check and the build. The ISO formatter is verified against the built-in over
  2.4 million dates across six time zones, including 45-minute offsets, every
  millisecond value, the whole calendar and the edges of the representable
  range.

## 3.1.2 — 2026-09-14

### Type compatibility fix

- `backedEnum()` descriptors are now assignable to
  `Record<PropertyKey, string | number>`, the TypeScript enum contract of
  TypeBox 1.x `Type.Enum` and Elysia 2 `t.Enum`. Passing a descriptor to
  `t.Enum()` already validated correctly at runtime, but TypeScript rejected the
  call because the descriptor type exposed a symbol-keyed metadata object.
- Descriptor metadata lives in an internal registry instead of on the
  descriptor, whose only own keys are its string cases. `BackedEnumDefinition`
  stays nominal through a type-only brand, so plain objects are still rejected
  as descriptors and as casts.

### Compatibility and verification

- No public behavior changes and no migration needed when upgrading from v3.1.1.
  Validation, serialization, `EnumValue` and `InvalidEnumValueError.expected` are
  unchanged. The non-enumerable symbol property previously defined on
  descriptors was not public API and no longer exists. The contract is checked
  structurally; the ORM adds no TypeBox or Elysia dependency.
- Added a compile-time test for the enum-like contract, `EnumValue` and
  descriptor nominality, and a runtime assertion that descriptors have no hidden
  own keys. Against parent `9f89499`, `tsc -p tsconfig.test.json` fails on the
  new type test with the incompatible `[backedEnumMetadata]` error, and the
  runtime assertion fails on the leftover symbol key.
- The full suite passes with 1,728 tests.

## 3.1.1 — 2026-09-05

### Security and isolation fixes

- Validation rejects prototype-sensitive path segments in both form input
  normalization and validated output construction. Path writers no longer walk
  inherited containers; normalization and error dictionaries use safe objects.
  This prevents rejected forms and accepted wildcard JSON from contaminating
  `Object.prototype`.
- PostgreSQL `Connection.withTenant()` rejects changes to the RLS tenant value,
  setting or role inside an active scope, and rejects entry inside an existing
  non-RLS transaction. Identical reentry reuses the scope. Logical tenant IDs
  may differ from RLS values; borrowed sessions restore their logical identity
  when the transaction ends.
- Redis cache `flush()` deletes only its `cache:`, `cache-tags:` and `tag:`
  families, preserving queues and other keys sharing the prefix.
- Migration `fresh()`, `refresh()` and `reset()` hold one lock across the entire
  destructive operation. SQLite rebuilds preserve the table holding that lock.
- `withoutTimestamps()` uses asynchronous scope isolation instead of mutating
  shared static configuration, preserving unrelated writes and overlapping or
  nested callbacks. Implicit casts follow the scoped setting too.

### Compatibility and verification

- Fixes are enabled automatically. No dependency, database schema or Redis key
  migration is needed when upgrading from v3.1.0. Bun minimum remains 1.4.1.
  Code reading `Model.timestamps` inside `withoutTimestamps()` now sees the
  configured value; timestamp suppression applies to the callback's operations.
- Corrected connection-capture and SvelteKit policy documentation. Added a global
  prototype invariant and 31 tests for malicious inputs, shipped Redis defaults,
  queued search, scope composition and migration lock contention.
- The full suite passes with 1,726 tests, including real SQLite, PostgreSQL,
  MySQL and Redis. Against parent `64ab254`, 24 of the new cases fail, confirming
  detection of the defects rather than merely exercising the changed code.
- Nine paired benchmark runs show small, consistent costs in flat validation
  (+6.8–7.5%) and Redis flush (+4.6%), faster identical RLS reentry (-42.9%), and
  no consistent slowdown in normal hydration or SQLite CRUD. These are local
  workloads, not application latency guarantees. See the [report and raw
  measurements](benchmarks/audit-fixes.md).

## 3.1.0 — 2026-09-04

First published 3.x release, including the previously unreleased v3 changes.

### Behavior and compatibility

- Bound models/builders/connections join compatible transactions and reject
  conflicting tenant, resource or transaction contexts. FROM/JOIN/write targets
  use the effective schema without qualifying CTE names.
- Query cache keys/tags and IdentityMap respect tenant/resource/schema isolation.
  Query invalidation uses `Cache.forgetQuery()` / `forgetQueryTag()`; generic
  cache APIs remain global. Redis cache needs a fresh prefix on upgrade.
- Queue/search effects wait for root commit and capture payload and tenant.
  `afterCommit()` supports savepoints and manual transactions; delivery errors
  report `AfterCommitError.committed === true` without undoing committed data.
- `configureOrm()` initializes once; await `reconfigureOrm()` and
  `ConnectionManager.setTenantResolver()` for changes. Active work holds leases,
  TTL measures inactivity, and borrowed connections remain caller-owned.
- QueueDriver reservations use tokens and heartbeat. Migrate existing job tables
  and stop all old workers before starting v3 workers.
- SvelteKit validation values require `includeValues: true`. Policies preserve
  their receiver and enriched users are assigned back to locals.

### Fixes and additions

- Added composable `sql` fragments for raw Builder clauses and an additive
  `Connection.affectedRows(result)` helper; existing write results are preserved.
- Native search resolves the active connection. Failed search_path restoration
  discards the reserved session; search batches retain failed records and newer
  concurrent changes. Redis tags update atomically and built-in caches retain null.
- Documented standalone-only Redis support and MySQL DDL recovery limits.
- Bounded cast metadata reuse removes repeated parsing while retaining mutable
  public cast maps, overrides, relations, dirty tracking and Proxy behavior.
  The final 20,000-row model JSON benchmark uses 31.9949 ms versus 38.0315 ms
  (15.9% less time). Smaller, eager and network workloads plus isolation/queue
  costs are recorded separately; no universal speedup is claimed.
- Redis queue completion now checks ownership, resolves the queue and removes
  the reservation/job in one Lua call. It removes one remote command per job
  while retaining reservation tokens and stale-owner protection. This change
  is confined to Redis queue completion and adds no work to other ORM paths.
- Added an isolated Redis benchmark with fixed v2/v3 references, current-driver
  comparisons and immutable records. Six 20,000-job runs with warmup measured
  39,077 jobs/s versus 33,455 for the initial v3 driver (+16.8%) and 36,039 for
  v2 (+8.4%). These are local reserve/complete measurements, not application
  handler throughput. See the [Redis investigation](benchmarks/redis-queue-investigation.md).
- Bun minimum is 1.4.1. Updated the development dependency lock and cookie
  override; no runtime dependency added. Added CI with required SQL/Redis services.

### Verification

- Build and 1,695 functional tests pass (5,596 assertions), with real SQLite,
  PostgreSQL, MySQL and Redis integrations. Strict script typechecks pass;
  `bun audit` reports no vulnerabilities.
- Retained benchmark history, cast profiles, isolated hydration checks, memory
  runs and contention percentiles. Revalidated all three Bun/Elysia workarounds
  and an isolated real Elysia consumer. Redis regressions include concurrent
  completion, named-queue isolation and rejection of stale reservation owners.
- [Verification with measured tradeoffs](benchmarks/v3-verification.md).

## 2.5.0 - 2026-08-29

### Added

- Added reversible `table.fullText()` / `table.dropFullText()` migrations for
  native MySQL/MariaDB FULLTEXT and PostgreSQL GIN expression indexes.
- Added Laravel 13-style full-text query options for MySQL boolean/query
  expansion modes and PostgreSQL language, phrase, web-search, raw, and
  precomputed-vector modes.
- Full-text index introspection now reports `type: "fulltext"` while preserving
  ordinary and unique indexes.

### Fixed

- PostgreSQL query and Schema compilation now share the same null-safe,
  indexable `to_tsvector` expression. Expression indexes no longer disappear
  from introspection, and qualified-table drops target the table's schema.
- SQLite's fallback now treats `%`, `_`, and backslashes as literal search text.
  Unsupported native indexes fail before a create/alter migration writes
  anything.

### Compatibility and performance

- The former internal connector/negation overload remains available for minor
  compatibility. Invalid driver-specific option combinations now fail early
  instead of being ignored.
- Query compilation adds only constant-time option validation. Native full-text
  indexes are opt-in: they speed indexed reads but add disk usage and maintenance
  work to inserts/updates; SQLite's ordinary-table fallback remains an O(n)
  scan.

### Verification

- TypeScript build and the complete non-benchmark suite passed with 1,644 tests,
  5,356 expectations, 126 files, and no failures, including live SQLite, MySQL,
  and PostgreSQL full-text contracts. All 46 benchmark tests passed separately.

## 2.4.0 - 2026-08-29

### Added

- Expanded Laravel-style Builder and static model APIs with SQL diagnostics,
  paging, key predicates, joins, unions, direct inserts, single-result helpers,
  and existence callbacks.
- Added relation and pivot shortcuts for negative relation predicates, filtered
  eager loading, OR variants, pivot ranges, null checks, and pivot ordering.
- Added Collection aliases and helpers for strict matching, conditional
  pipelines, paging, percentages, chunks, partitions, null/range filters, and
  `implode()`.
- Added model relation-state, attribute-selection, column-qualification, and
  append-management helpers, plus portable increment and ULID Schema aliases.
- Added `createOrFirst()`. It attempts the insert first and recovers the
  existing row after a matching UNIQUE conflict. `firstOrCreate()` and the
  creation branch of `updateOrCreate()` now share that race-safe path.

### Fixed

- Relation callbacks containing OR predicates now remain grouped with their
  correlation condition, and `withWhereHas()` applies its constraint to both
  the parent filter and eager-loaded relation.
- Empty `IN` and `NOT IN` lists now compile to portable constants. Nested key
  predicates preserve model metadata, and the Builder find family honors
  custom primary keys.
- `setAppends()` now replaces inherited appends, relation setters remain
  chainable, and write typings no longer allow arrays to masquerade as one
  attribute object.

### Compatibility

- This release is additive and requires no migration or opt-in. Existing query,
  model, relation, collection, and schema APIs retain their behavior.
- Static `insertGetId()` and `insertOrIgnore()` are low-level Builder forwarding:
  they intentionally bypass mass-assignment filtering, timestamps, and model
  lifecycle hooks.
- `createOrFirst()` requires a matching database UNIQUE constraint to resolve
  concurrent inserts. Conflicts unrelated to its lookup attributes and all
  non-UNIQUE database errors are rethrown.

### Performance

- Aliases and static forwarding add no work beyond their existing Builder or
  Collection operations. `createOrFirst()` removes the initial SELECT when the
  row is normally absent.
- Inside an existing transaction, `createOrFirst()` uses a savepoint around the
  INSERT so PostgreSQL remains usable after a UNIQUE violation. This adds one
  savepoint round trip on that transactional path; outside transactions there
  is no savepoint overhead.

### Verification

- The complete non-benchmark suite passed with 1,633 tests, 5,272 expectations,
  124 files, and no failures. All 46 benchmark tests passed separately.

## 2.3.0 - 2026-08-27

### Changed

- Model serialization now reads ORM-owned state through the raw model target
  instead of repeatedly dispatching internal work through the public Proxy.
  Accessors, native getters, and custom casts still receive the public model.
- Hydration now assigns existing class fields directly through that target.
  Their writable, enumerable, and configurable descriptors are preserved
  without paying for `Object.defineProperties()` on every row.

### Added

- Added reproducible SQLite pipeline and PostgreSQL point-query benchmarks with
  warmups, median samples, phase timings, and Proxy trap counts.

### Compatibility

- No migration or opt-in is required. Public model property behavior,
  per-instance cast-map isolation, runtime static-cast mutation, visibility,
  appends, relations, and the `Collection` runtime identity are unchanged.
- PostgreSQL still defaults to `prepare: false` for pooler compatibility.
  Applications that control their connection topology may opt into prepared
  statements through the existing connection option.

### Performance

- On 20,000 SQLite rows with ten columns and six effective casts, median
  hydration improved from 16.122 ms to 9.917 ms (38.5%), serialization from
  11.814 ms to 6.661 ms (43.6%), and the complete `get().toJSON()` pipeline
  from 40.899 ms to 26.387 ms (35.5%).
- Internal Proxy traffic fell from 4 to 1 trap per hydrated row and from 62 to
  3 traps per serialized row.
- On the local PostgreSQL point-query benchmark, `toSql()` accounted for 1.96%
  of the unprepared RTT. Opting into `prepare: true` reduced raw query time by
  27.5% and the complete ORM lookup by 26.5%; no Builder or default-connection
  behavior changed.

### Verification

- The complete non-benchmark suite passed with 1,570 tests across 120 files and
  no failures. All 46 benchmark tests passed separately.

## 2.2.1 - 2026-08-27

### Changed

- Model construction and hydration now reuse mass-assignment validation and
  implicit date-cast metadata, avoid repeated proxy reads while normalizing
  casts, and skip merging the always-empty per-instance cast map.

### Fixed

- Implicit date-cast cache entries now validate all five public timestamp and
  soft-delete settings they depend on. Runtime `softDeletes` changes, renamed
  timestamp columns, and inherited `timestamps` toggles in
  `withoutTimestamps()` no longer silently leave hydrated values as the wrong
  type.

### Performance

- Validating cached date casts moved median `Model.hydrate()` time from 0.682
  µs/op to 0.699 µs/op in the seven-run paired CPU benchmark. This bounded
  correctness cost leaves hydration 7.0% below the 0.752 µs/op uncached
  baseline.

## 2.2.0 - 2026-08-27

### Changed

- `Collection.toJSON()` and `Collection.json(...paths)` now allocate and fill a
  native array directly. `Builder.json()` inherits that behavior, so its runtime
  value now matches its array return type and `JSON.stringify()` no longer
  invokes `Collection.toJSON()` a second time.
- `Builder.rawJson()` precompiles cast types, decimal arguments, enum metadata,
  and error context once per `RawJsonPlan`. Eligible models use a shallow-copy
  fast path when they have no defaults, accessors, visibility rules, or custom
  casts; all other models keep the general serializer.

### Compatibility

- TypeScript already declared collection JSON helpers and `Builder.json()` as
  arrays. JavaScript callers that relied on `Collection`-only helpers on their
  runtime results must use standard array methods; `get()` still returns a
  `Collection` when those helpers are required.
- Direct JSON output and opt-in behavior are unchanged. The compiled path keeps
  eager enum validation, explicit-cast precedence, soft-delete timestamps,
  cached-row isolation, and lazy errors for unselected unsupported casts.

### Performance

- In the focused 500-model benchmark, returning a native array reduced the
  following `JSON.stringify()` segment from 54.56 µs to 24.11 µs (about 56%).
- The isolated Bun benchmark serialized 500 casted rows in 0.015 ms on the
  compiled path versus 0.029 ms through the general path (about 48% less).
- On MySQL using 500 complex rows, compiled serialization improved from
  387.08 µs to 301.79 µs (22%), while the complete `rawJson()` query improved
  from 2,516.83 µs to 2,098.75 µs (16.6%).

### Verification

- Typechecked and built the package. The complete non-benchmark Bun suite passed
  with 1,564 tests across 120 files and no failures, including SQLite, MySQL,
  and PostgreSQL; the focused benchmark and MySQL `orm_bench2` contract passed.

## 2.1.0 - 2026-08-27

### Changed

- Fresh, uncached model queries now let the internal hydration path own each
  driver row and use it as the original snapshot. This removes one defensive
  row copy while keeping public `Model.hydrate()`, cached reads, custom
  `hydrate()` methods, defaults, casts, proxies, and dirty tracking unchanged.
- `Builder.rawJson()` now returns the plain `Array` declared by its public type
  instead of leaking the internal `Collection`. Cast normalization happens in
  the output pass without allocating a per-row `Map`; backed enums remain
  validated before other read casts, including hidden enum attributes.

### Compatibility

- TypeScript already exposed `rawJson()` as an array. JavaScript callers that
  relied on `Collection`-only helpers on its runtime result must use standard
  array methods or choose hydrated `json()` / `get()` results instead.
- No migration or opt-in is required for hydration ownership. Cache-backed
  queries and model hydration overrides deliberately retain the defensive path.

### Performance

- For 500 rows, query plus `JSON.stringify(rawJson())` improved from 0.122 ms to
  0.083 ms (32.5%), while encoding an already fetched result improved from
  0.046 ms to 0.014 ms (about 70%).
- Ownership-aware hydration improved the measured row-to-model path by about
  2.2% for small rows and 19% for rows with 101 columns.

### Verification

- Typechecked and built the package. The complete non-benchmark Bun suite passed
  with 1,561 tests across 120 files and no failures; focused cross-driver direct
  JSON regressions and the direct-JSON benchmark passed separately.

## 2.0.0 - 2026-08-27

### Added

- Added `Builder.rawJson()` for explicit model-row serialization without
  constructing one model per row. It preserves built-in and implicit timestamp
  casts, backed enums, static defaults, visibility rules, aliases, aggregates,
  ordering, recursive decorations, caching, and tenant routing.
- Added the exported `DirectJson<TResult, TSelected, TWith>` type. Direct-query
  results expose selected attributes and query-added aggregates without
  advertising appends or unloaded relations.

### Changed

- `Builder.json()` now has one predictable meaning: hydrate models and serialize
  their complete instance behavior. `rawJson()` never silently falls back; it
  reports incompatible eager loads, visible accessors or custom casts, and
  model lifecycle/serialization overrides.
- Direct JSON omits appends and ignores the Identity Map by definition. Migrate
  `static fastJson = true` plus `.json()` calls to `.rawJson()` where instance
  behavior is intentionally unnecessary.
- Query reads no longer allocate `Array.from(...).map(...)` around Bun SQL
  results. Boolean result coercion runs in place only on freshly queried rows.

### Removed

- Removed the public `Model.fastJson` flag. Direct serialization is now chosen
  per query with `rawJson()`.

### Fixed

- Direct row serialization now shares the same implicit `created_at`,
  `updated_at`, and `deleted_at` datetime casts as hydrated models, including
  custom timestamp column names and explicit-cast precedence.

### Verification

- Built and typechecked the package. The complete non-benchmark Bun suite passed
  with 1,558 tests across 120 files, and the direct-JSON benchmark passed
  separately.

## 1.13.1 - 2026-08-27

### Changed

- Model hydration now iterates cast keys without allocating an entry tuple for
  every cast. Hydrating 50,000 models improved from 32.48 ms to 29.53 ms while
  preserving proxies, casts, snapshots, and dirty tracking.

### Verification

- Typechecked and built the package, then ran the complete Bun test suite:
  1,556 tests passed with no failures.

## 1.13.0 - 2026-08-27

### Added

- `migrate:fresh --seed` and `migrate:refresh --seed` now run the existing
  default `db:seed` flow after migrations succeed. `--seeder=Name` selects one
  seeder and requires `--seed`; landlord and tenant targets apply to both phases.
- `migrate --pretend` and `migrate:rollback --pretend --step=N` compile pending
  or rollback SQL through the selected driver's real schema and query grammars.
  Ordered statements and bindings are available in plain output and as one
  `pretend` array under `--json`, without schema or migration-record writes.
- All state-changing migration commands now confirm under `NODE_ENV=production`;
  `--force` supports non-interactive runs. Status and pretend mode never prompt,
  and pretend captures SQL without executing it.
- `make:migration add_<something>_to_<table>_table` now infers the table and
  generates `Schema.table()` skeletons for both migration directions.

### Changed

- `make:migration` is the sole migration generator command. The duplicate
  `migrate:make` command and package script were removed.
- `Builder.toSql()` now emits driver placeholders and fills `bindings`.
  `toRawSql()` is the explicit diagnostic form for interpolated SQL.
- `Validator.safeParse()` now returns Standard Schema issue arrays from every
  entry point; `Validator.flatten()` converts those issues to an error bag.
- Type generation is configured through `modelsPath` and writes beside each
  model root. `orm types:generate <dir>` remains the explicit custom-output
  command.
- `Migrator.run()`, `rollback()`, `reset()`, `refresh()`, and `fresh()` now
  return their results directly; the duplicate `*WithResult()` methods were
  removed.
- Migration metadata tables must use the current schema. Automatic upgrades of
  pre-release tables and the `migrate:rollback --steps` alias were removed.
- Grouped migration configuration must define every targeted scope; it no
  longer falls back to a flat `migrationsPath`.
- Automatic migration locking remains enabled for every real migration run;
  the CLI intentionally does not expose Laravel's opt-in `--isolated` flag.

### Removed

- Removed pre-release query-builder signatures that placed `and`/`or` or JSON
  negation flags where binding arrays now belong.
- Removed `Builder.getArray()`; call `(await query.get()).toArray()` when a
  plain array is required.
- Removed the explicit relation-name argument from `getTree()`; recursive tree
  relation names are inferred from model metadata.
- Removed `Search.define("table")`; pass an existing model class to
  `Search.define(ModelClass)`.
- Removed unscoped `IdentityMap` access. A connection is now required for every
  key operation.
- Removed the undocumented nested `TenantResolution.cache` form; set `ttl` and
  `closeOnPurge` directly on the tenant resolution.
- Removed `typesOutDir` and `typeDeclarationModelsDir` configuration.
- Removed special handling and diagnostics for obsolete string casts. Unknown
  cast names now fail with the same unsupported-cast error.

### Fixed

- Package builds now clear `dist/` before compiling, so deleted modules cannot
  survive as stale JavaScript and leak into a release tarball.
- Tenant migration cleanup now removes owned connections from both the tenant
  cache and named connection registry, so a following seeder cannot reuse a
  closed connection.
- Pretend mode now captures every statement without executing SQL, including
  read-looking statements and writes made through derived connections. Bigint
  bindings serialize as exact decimal strings instead of breaking `--json`.
- Pretend rollback handles an empty history without emitting invalid `IN ()`
  SQL.
- Built-in command help now shows canonical direct usage such as `orm migrate`;
  application command help keeps `orm run <command>`.

### Verification

- Built the TypeScript package and ran the complete Bun test suite: 1,600 tests
  passed across 125 files, including live SQLite, MySQL, PostgreSQL, and Redis
  integrations.
- Ran 50 focused migration UX tests across SQLite, MySQL, and PostgreSQL, and
  verified the diff with `git diff --check`.
- `bun pm pack --dry-run` passed for version 1.13.0: 417 files, 2.74 MB
  unpacked, with no stale `migrate:make` artifact.

## 1.12.1 - 2026-08-26

### Added

- `dateTime()`, `timestamp()`, `time()`, `timestamps()`, and `softDeletes()` now
  accept fractional-second precision from 0 through 6. Existing declarations
  without precision compile to byte-identical SQL.
- `datetimes()` and `softDeletesDatetime()` provide `DATETIME` timestamp helpers
  for MySQL's wider range and lack of session-time-zone conversion. PostgreSQL
  and SQLite compile them the same way as their `TIMESTAMP` counterparts.

### Changed

- The `date` model cast now stores a calendar day as `YYYY-MM-DD` and reads it
  at UTC midnight consistently across SQLite, MySQL, and PostgreSQL. Applications
  that used `date` on a `DATETIME` column to preserve a time must migrate that
  cast to `datetime`; JSON serialization intentionally remains a full ISO value.

### Fixed

- The `timestamp` model cast is now a complete alias of `datetime`: it reads as
  `Date`, writes ISO strings, and tracks in-place `Date` mutations.
- Calendar-date casts preserve years `0000` through `0099` instead of allowing
  JavaScript's legacy `Date.UTC` remapping to shift them into 1900–1999.

### Verification

- Ran the complete Bun test suite: 1,543 tests passed across 118 files,
  including live MySQL, PostgreSQL and Redis integrations.
- Verified the cross-driver calendar-date contract under
  `TZ=America/New_York` and `TZ=Asia/Tokyo`.
- `bun pm pack --dry-run` passed for version 1.12.1: 420 files, 2.73 MB
  unpacked.

## 1.11.0 - 2026-08-26

### Added

- Factories now provide lifecycle `configure()`, observer-free
  `createQuietly()`, many-to-many `hasAttached()`, stable-return `rawOne()` /
  `makeOne()` / `createOne()` / `createMany()` terminals, typed relationship
  names, `recycle()`, `trashed()`, and explicit `connection()` targeting.
- Seeders now support `static withoutModelEvents`, execution-scoped
  `callOnce()`, and `SeederRunner.runDefault()`. The default CLI and
  `configureOrm().seed()` entry point prefer `DatabaseSeeder` per configured
  root, falling back to ordered files only when no root seeder exists.
- `db:seed` now confirms before landlord or tenant seeding under
  `NODE_ENV=production`; `--force` supports non-interactive production runs.

### Fixed

- `make()` now applies `for()` foreign keys from persisted models and rejects
  parent factories, unsaved parents, and asynchronous `afterMaking` hooks
  instead of silently omitting keys or leaving rejected promises unhandled.
- A parent factory passed to `for()` is created once per operation, not once per
  child. Recycled records now flow through nested `for()` and `hasAttached()`
  relationships, with random selection, instead of producing duplicate graph
  records.
- Explicit factory connections now propagate through parent, child, attachment,
  and bulk-insert paths. Bulk primary-key generation continues to respect model
  overrides when an explicit connection is used.
- Observer muting is async-context-local, so quiet and normal factory/seeder
  work can run concurrently without leaking global event state.
- Concurrent `callOnce()` branches can no longer start the same seeder twice,
  and declining the production seed confirmation now returns a failing exit
  status.
- `count()` rejects negative, fractional and non-finite values before doing
  work.

### Compatibility

- `make()` remains synchronous; use `create()` or `insert()` when an
  `afterMaking` hook is asynchronous, and use `create()` when `for()` receives a
  parent factory.
- `has()` and `for()` relation names are now compile-time checked. JavaScript
  callers retain the existing runtime errors for invalid relationships.
- Production `db:seed` automation must pass `--force`.

### Verification

- Built the TypeScript package and type-checked the dedicated test
  configuration.
- Ran the complete Bun test suite: 1,530 tests passed across 118 files,
  including live MySQL, PostgreSQL and Redis integrations.
- `bun pm pack --dry-run` passed for version 1.11.0: 420 files, 2.72 MB
  unpacked.

## 1.10.0 - 2026-08-26

### Added

- Factories gained `insert(overrides?, { chunkSize? })` for fast, chunked bulk
  persistence without model events. The method reuses the model bulk writer,
  awaits `afterMaking`, supports `for()` parents, and rejects `has()` graphs it
  cannot hydrate.

### Changed

- Factory definitions, states, sequences, overrides, and relationship keys now
  use trusted attributes. Public `Model.create()` and `Model.insert()` remain
  mass-assignment protected.

### Fixed

- Bulk factory inserts preserve in-place cast mutations made by `afterMaking`.
- Trusted enum values are validated before the first chunk is written, avoiding
  partial inserts when a later record is invalid.

### Compatibility

- The bulk path is opt-in. Existing `Factory.create()` behavior is unchanged;
  use it when model instances, model lifecycle events, or `has()` relationships
  are required. `Factory.insert()` returns `Promise<void>`.

### Verification

- Built the TypeScript package.
- Ran the complete Bun test suite: 1,515 tests passed across 118 files.
- `git diff --check` passed.

## 1.9.1 - 2026-08-25

### Fixed

- The PostgreSQL RLS tenancy integration test now switches to a temporary
  `NOSUPERUSER NOBYPASSRLS` role when `POSTGRES_TEST_URL` authenticates as a
  superuser or `BYPASSRLS` role. PostgreSQL always exempts those roles from row
  security, even with `FORCE ROW LEVEL SECURITY`, so the old test failed against
  a correct ORM depending only on the test role. The temporary role receives the
  schema and table privileges needed for the policy check and is removed during
  cleanup.

### Verification

- Ran the PostgreSQL tenancy integration suite with both a normal role and a
  superuser: all four tests passed in both configurations.
- Built the TypeScript package and ran the complete Bun suite: 1,503 tests
  passed across 118 files.
- `bun pm pack --dry-run` passed for version 1.9.1: 420 files, 2.69 MB
  unpacked.

## 1.9.0 - 2026-08-25

### Added

- **`TransactionContext` is now exported.** It was the only mechanism for
  joining an ambient transaction and it was private, with no wildcard in
  `exports` to reach it. A package that receives a `Connection` — the shape
  `@rekkr/cache` and `@rekkr/better-auth-adapter` use — could not tell whether
  the caller had a transaction open, so its writes always went to the pooled
  connection and survived a rollback on MySQL and PostgreSQL. Such a package now
  resolves per call with `TransactionContext.current() ?? this.connection`.
  `TenantContext` was already public; the two have the same role and the same
  `current()` / `run()` surface.

### Fixed

- **`connection.transaction()` installs the ambient context.** Only
  `DB.transaction()` did, so an unbound `Model` or `DB` query inside a
  `connection.transaction()` callback resolved to `ConnectionManager.getDefault()`
  and ran on a different pooled session — committing outside the transaction and
  surviving its rollback. All three branches now publish the transaction:
  borrowed-root, borrowed-savepoint and owned-driver. `withTenant()` delegates to
  `transaction()` and inherits the fix.

  The behavior was previously documented as a limitation of the lower-level form,
  with `Model.on(tx)` as the workaround. That workaround still works and is still
  correct for targeting a specific connection; it is simply no longer required.
  The pitfall entry has been removed from `docs/transactions.md`.

  This was invisible on SQLite, where a single connection makes the stray write
  land inside the open transaction by accident — which is why the existing
  `tests/transaction-context.test.ts` suite, running on `sqlite://:memory:`,
  could not catch it. The new regression coverage asserts ambient identity as
  well as rollback, so the failure remains visible on every driver.

### Changed

- `DB.transaction()` no longer wraps the callback itself. `Connection.transaction()`
  installs the context for every entry point, so the facade just delegates.

### Verification

- Built the TypeScript package and type-checked the dedicated test
  configuration.
- Ran the complete Bun test suite: 1,503 tests passed across 118 files,
  including live MySQL and PostgreSQL integrations.
- `bun pm pack --dry-run` passed for version 1.9.0: 420 files, 2.69 MB
  unpacked.

## 1.8.1 - 2026-08-25

### Fixed

- `change()` no longer re-adds the column it is changing. A changed column is
  marked on the blueprint, and `compileAdd()` skips it, so a migration that
  altered a column no longer followed the `ALTER`/`MODIFY` with an `ADD COLUMN`
  for a column that already exists.
- **PostgreSQL drops a column's old default before changing its type.** The
  previous order ran `ALTER COLUMN ... TYPE` while the old default was still
  attached, and PostgreSQL refuses a type change whose default it cannot cast to
  the new type: widening `integer("code").default(0)` into `string("code", 10)`
  aborted with `default for column "code" cannot be cast automatically to type
  character varying`. The statements are now `DROP DEFAULT`, `TYPE`, nullability,
  then the new `SET DEFAULT` if the blueprint still declares one.

### Changed

- **`.primary().change()` now throws on every driver.** The check moved into the
  shared `assertPortableChange()` next to the enum one. PostgreSQL has no
  `ALTER COLUMN` spelling for a primary key, while MySQL accepted
  `MODIFY COLUMN ... PRIMARY KEY` and either added the key or failed with
  `Multiple primary key defined` depending on the table — the same blueprint
  meant two different things. Use `primary([...])` at table level.
- **PostgreSQL `change()` resets what the blueprint omits.** An omitted
  `default()` now emits `DROP DEFAULT` and an omitted `comment()` emits
  `COMMENT ON COLUMN ... IS NULL`, matching what MySQL's `MODIFY COLUMN` already
  did implicitly. `change()` restates a column in full on both drivers, so
  describe the column as it should end up rather than only the part that moves.
- A column's fluent `.unique()` is ignored when that column is being changed: a
  changed column keeps the indexes it already has, and restating `.unique()`
  described the end state rather than requesting a second index. Use
  `uniqueIndex()` / `dropUnique()` to actually add or remove one; `uniqueIndex()`
  generates the same `<table>_<column>_unique` name.
- `Schema.create()` and `createIfNotExists()` reject the blueprint commands that
  only apply to an existing table — `change()`, `dropColumn()`,
  `renameColumn()`, `dropIndex()`, `dropUnique()` and `dropForeign()`. They were
  silently ignored, which could produce a table that did not match the migration
  describing it: a `.change()` column was created but its fluent index was not.

### Compatibility

- Existing MySQL migrations using `.primary().change()` must move the primary
  key declaration to `primary([...])`; PostgreSQL and SQLite could not express
  the fluent form portably.
- PostgreSQL migrations using `change()` must restate any default and comment
  they intend to keep. This matches MySQL's existing full-column rewrite
  semantics.
- Alter-only commands inside `Schema.create()` or `createIfNotExists()` now fail
  before SQL runs instead of being ignored.

### Verification

- Built the TypeScript package and type-checked the dedicated test
  configuration.
- Ran the complete Bun test suite: 1,499 tests passed across 118 files, including
  live MySQL, PostgreSQL and Redis integrations. The PostgreSQL contract covers
  changing an integer column with `DEFAULT 0` into `VARCHAR`.
- `bun pm pack --dry-run` passed for version 1.8.1: 420 files, 2.69 MB unpacked.

## 1.8.0 - 2026-08-25

### Added

- `whereLike()` takes a `{ caseSensitive }` option, and each driver compiles the
  operator that expresses the intent natively rather than
  `LOWER(column) LIKE LOWER(?)`, which would make an index on the column
  unusable. `whereNotLike()`, `orWhereLike()` and `orWhereNotLike()` accept it
  too.

  | | default | `{ caseSensitive: true }` |
  |---|---|---|
  | PostgreSQL | `ILIKE` | `LIKE` |
  | MySQL | `LIKE` | `LIKE BINARY` |
  | SQLite | `LIKE` | `GLOB` |

  SQLite has no case-sensitive `LIKE`, so the exact form switches to `GLOB` and
  translates the pattern; a literal `*`, `?` or `[` is escaped in the same pass.

### Changed

- The `like` family no longer takes the and/or connector or the `not` flag as
  positional arguments. `orWhereLike()` and `orWhereNotLike()` already express
  both, so the third argument is now always the options object and the connector
  moved to a private helper. Unlike the semantic change below, this one surfaces
  as a type error rather than a silent behaviour change.
- **`whereLike()` is now case-insensitive by default.** On PostgreSQL it
  previously compiled `LIKE`, which compares case-sensitively; it now compiles
  `ILIKE`. SQLite and MySQL are unaffected, their `LIKE` already ignoring case.
- A model's timestamp columns are cast to `Date` on read without a matching
  `casts` entry. This covers the defaults, `created_at` and `updated_at`, as well
  as any `createdAtColumn` / `updatedAtColumn` override — and `deletedAtColumn`
  when `softDeletes` is on. The write path already derived exactly these columns
  through `dateColumns()`; the read path ignored that derivation, so a model that
  declared its timestamp columns wrote a `Date` and read back a string. An
  explicit `casts` entry still wins.
- Generated types say `Date` for the columns a discovered model actually
  decodes through an effective `date` or `datetime` cast. Generated stubs use
  the default `created_at` / `updated_at` pair; declaration generation without a
  discovered model conservatively keeps the active driver's type.

### Fixed

- Type generation no longer uses write-path `dateColumns()` metadata to infer
  read types. That metadata also includes the write-only `"timestamp"` column
  hint, which remains a string at runtime, and previously treated an inactive
  `deleted_at` fallback as a `Date`. Effective read casts are now the source of
  truth, including explicit overrides.

### Compatibility

- **`whereLike()` on PostgreSQL changes results.** A query relying on it being
  case-sensitive needs `{ caseSensitive: true }` to keep its old behaviour. This
  is the one change here that alters results without a compiler error, so
  PostgreSQL callers of `whereLike` are worth reviewing.
- `whereLike(column, value, "or")` and `whereLike(column, value, "and", true)`
  no longer compile. Use `orWhereLike(column, value)` and
  `whereNotLike(column, value)`, which have always been the intended spellings.
- Reading a timestamp column now yields a `Date` where it previously yielded the
  raw string, on models that declared the columns without the matching cast.
  Code comparing those values by identity (`===`, `toBe`) has to compare
  instants instead. `toJSON()` returns a `Date` in that position, as it already
  did for any explicitly cast column; the serialized JSON is unchanged.
- The implicit cast parses exactly like an explicit `datetime` cast. Legacy
  free-form values, MySQL zero-dates (`0000-00-00 00:00:00`), and Unix
  timestamps stored as strings become an invalid `Date`; numeric Unix seconds
  are interpreted as JavaScript milliseconds. Normalize them first or add an
  explicit `"string"` cast while migrating.
- Regenerate types after upgrading: columns that were emitted as `string` are now
  `Date`.
- The default stays subject to each driver's configuration, which is what keeps
  it index-friendly: under `PRAGMA case_sensitive_like` on SQLite, or a `_cs` /
  `_bin` collation on MySQL, it stops ignoring case. `caseSensitive: true` is
  the form that does not depend on either.

## 1.7.0 - 2026-08-24

### Added

- `when()` and `unless()` now hand the evaluated value to their callbacks as a
  second argument, so optional filters no longer have to repeat the value inside
  the closure.
- `when()` and `unless()` accept a closure as their first argument. It is
  invoked with the builder and its return value decides which branch runs.

### Changed

- The callback of `when()` (and the `defaultCallback` of `unless()`) receives
  the value typed as `NonNullable<T>`, because that branch only runs when the
  value is truthy. `.when(filters.name, (q, name) => q.where("name", name))` now
  type-checks under `strict` without a non-null assertion.

### Fixed

- `unless()` forwarded the negated condition to its callbacks instead of the
  original value, and its signature did not accept that second argument at all.
  It is now implemented alongside `when()` instead of delegating to it.

### Compatibility

- Callbacks that take only the `query` parameter keep working unchanged; the
  value is an extra trailing argument.
- Passing a function as the first argument of `when()` / `unless()` previously
  counted as an always-truthy value. It is now invoked as a predicate. Wrap it
  as `() => fn` to keep the old behavior.

### Verification

- Built the TypeScript package and ran the complete Bun test suite (1481 tests
  across 118 files), including the available SQLite, MySQL, and PostgreSQL
  integrations.

## 1.6.0 - 2026-08-24

### Added

- Added static `doesntExist`, `value`, `limit`, and `offset` model helpers.
- Added conditional `makeHiddenIf` and `makeVisibleIf` serialization helpers.
- Added public `syncOriginal()` and `discardChanges()` model-state helpers.

### Changed

- Mutable `json` and `date` casts now keep in-place edits coherent across
  inserts, bulk saves, dirty baselines, and partial persistence operations.
- `updating` observer mutations are included in the pending UPDATE, while
  mutations from `updated` and `saved` remain dirty until explicitly saved.

### Fixed

- Prevented `touch`, increment/decrement, soft delete, and restore from marking
  unrelated in-memory changes as persisted.
- Kept nested saves from having their newer dirty baseline overwritten by the
  outer save.

### Compatibility

- All new model and query helpers are additive aliases over existing builder
  behavior. No migration or configuration change is required.
- `syncOriginal()` and `discardChanges()` only move or restore the in-memory
  baseline; neither writes to the database.

### Verification

- Built the TypeScript package and ran the complete Bun test suite, including
  the available SQLite, MySQL, and PostgreSQL integrations.

## 1.5.0 - 2026-08-24

### Added

- Added `orWhereLike`, `orWhereNotLike`, `whereJsonDoesntContain`,
  `orWhereJsonContains`, `orWhereJsonDoesntContain`, `orWhereJsonLength`, and
  `orWhereFullText` to both model and query-builder APIs.

### Changed

- Static pattern, JSON, and full-text helpers now retain model-column
  IntelliSense, and full-text helpers accept readonly column lists.
- SQLite's portable multi-column full-text fallback now groups its `LIKE`
  predicates so surrounding filters keep their intended precedence.
- JSON-length filters reject missing and non-finite comparison values instead
  of compiling malformed SQL.

### Fixed

- Negative JSON containment now excludes SQL `NULL` consistently on SQLite,
  MySQL, and PostgreSQL.

### Compatibility

- The new helpers are additive. The existing `whereJsonLength` boolean and
  negation arguments remain supported; calls that previously omitted a numeric
  length now fail early because they could only produce invalid SQL.
- SQLite query-builder full-text matching remains a portable `LIKE` fallback.
  Applications requiring an indexed SQLite search should opt into the existing
  `SqliteFTS5Engine`.

### Verification

- Built the TypeScript package and ran the complete Bun test suite, including
  the available SQLite, MySQL, and PostgreSQL integrations.

## 1.4.0 - 2026-08-23

### Added

- Added Eloquent-style query helpers for relative dates, column bounds,
  multi-column predicates, grouped ranges, descending keyset iteration,
  ordering replacement, and builder pipelines.
- Expanded model collections with primary-key identity helpers, set operations,
  per-collection serialization controls, eager loading, and aggregate loading.
- Added quiet model updates and quiet relationship creation across has-many,
  belongs-to-many, and morph-to-many relations.
- Added schema conveniences for unsigned integer columns, current-timestamp
  defaults, custom soft-delete columns, foreign-key actions, and dropping
  timestamp, soft-delete, remember-token, and morph columns.

### Changed

- Models and collections now include the resolved connection when comparing
  model identity, keeping rows with the same primary key in different tenant
  databases isolated.
- Relationship-created models inherit their parent's resolved connection.
- Keyset chunk and lazy helpers replace pre-existing ordering with their primary
  key order, preventing duplicate or skipped rows.
- Refreshed migration, schema, relationship, query, collection, transaction,
  testing, queue, and quick-start documentation with valid, production-shaped
  examples.

### Fixed

- Fixed SQLite relative-date filters when stored timestamps mix ISO 8601 and
  database `CURRENT_TIMESTAMP` formats.
- Prevented empty multi-column filters from emitting invalid SQL and avoided
  inherited object properties being reported as dirty or changed attributes.
- Corrected collection predicate lookup, mixed model/value membership, missing
  model detection, and cross-connection relation and aggregate loading.

### Compatibility

- The release is additive except for corrected model identity and keyset-order
  semantics. Code that intentionally compares same-ID rows across connections,
  or combines custom ordering with by-ID iteration, should opt into an explicit
  application-level comparison or ordering strategy instead.

### Verification

- Built the TypeScript package and ran the complete Bun test suite against the
  available SQLite, MySQL, and PostgreSQL integrations.

## 1.3.2 - 2026-08-23

### Changed

- Schema column `.nullable()` now accepts an optional boolean. Existing calls
  still make the column nullable, while `.nullable(false)` explicitly restores
  `NOT NULL`, which is useful for conditional migration definitions.

### Verification

- Added schema-builder coverage for default, implicit nullable, and explicit
  non-nullable column definitions.

## 1.3.1 - 2026-08-23

### Fixed

- PostgreSQL unique and primary-key violations raised only when a deferred
  constraint is checked at commit are now normalized as
  `UniqueConstraintViolationError`, just like violations raised by a write.
  Callback, borrowed-connection, and manual transactions retain the original
  Bun driver error as `cause`; other deferred constraint failures remain raw.

### Verification

- Added live PostgreSQL coverage for deferred unique violations through both
  callback and manual transaction commits, including rollback verification.

## 1.3.0 - 2026-08-23

### Added

- Added model-backed `Builder.forceCreate()`, including connection-bound
  creation through `Model.on(connection)`. It bypasses mass-assignment guards
  while retaining normal casts, backed-enum validation, generated keys,
  timestamps, observers, and save options.
- Added the exported `UniqueConstraintViolationError` for duplicate unique and
  primary-key writes on SQLite, MySQL, and PostgreSQL. Its stable public message
  omits query details and retains the native Bun error as `cause` for trusted
  diagnostics.

### Fixed

- Routed ordinary writes, date-bearing MySQL writes, reserved-session writes,
  and MySQL auto-increment inserts through the same unique-error classifier.
  Other database and constraint errors remain unchanged, and
  `insertOrIgnore()` keeps its existing behavior.
- Model instances created from an explicitly bound builder now inspect their
  primary-key strategy using that exact connection instead of the global model
  connection.

### Verification

- Added focused SQLite regressions and live Bun 1.4.0 driver-contract coverage
  for SQLite, MySQL, and PostgreSQL, including model creation, raw inserts,
  updates, primary keys, transactions, ignored conflicts, and non-unique
  constraints.

## 1.2.0 - 2026-08-23

### Added

- Models can opt direct query `json()` into conservative static row
  serialization with `static override fastJson = true`. Eligible queries keep
  built-in casts, backed enums, visibility, aliases, ordering, aggregates,
  recursive decorations, caching, and tenant connections without constructing
  one model per row.
- Added a 500-row JSON benchmark covering raw rows, eligible direct JSON,
  explicit hydration, fallback JSON, and response encoding.

### Changed

- Built-in read casts and driver JSON normalization now share the same internal
  conversion helpers between hydrated models and direct query JSON.
- Direct query JSON automatically retains hydration for eager loads, active
  Identity Maps, appends, accessors, custom casts, default attributes, and
  static hydration overrides or relevant prototype method overrides.

## 1.1.2 - 2026-08-22

### Changed

- Refreshed the documentation to match the current public API, supported
  drivers, private GitHub distribution, and `v1.1.2` installation tag.
- Expanded queue documentation for database, Redis, custom drivers, retry
  timing, stable job names, and migration-based table setup.
- Expanded schema and backed-enum documentation with driver-specific timestamp
  types, UUID defaults, immutable descriptors, and structured enum errors.

### Fixed

- Replaced obsolete seeder and tenant CLI examples with the commands and flags
  accepted by the current CLI.
- Corrected invalid imports, query result types, duplicate declarations, local
  anchors, MySQL foreign-key signedness, and outdated index-limit guidance.

## 1.1.1 - 2026-08-22

### Changed

- Repeated schema `.default()` modifiers are now last-wins. Only the final
  value is validated and compiled, while `null` or an omitted value produces no
  `DEFAULT` clause without changing column nullability.

## 1.1.0 - 2026-08-22

### Added

- Added immutable `backedEnum()` descriptors and the `BackedEnumDefinition` and
  `EnumValue` types for validated string-backed model attributes.
- Enum columns now emit enforced `CHECK` constraints on SQLite and PostgreSQL;
  MySQL continues to use its native `ENUM` type with safely rendered values.

### Changed

- **Breaking:** The legacy `"enum"` string cast is no longer accepted because it
  declares no allowed values. Use a `backedEnum({...})` descriptor directly in
  `static casts`.
- Enum schema definitions reject invalid values, unrepresentable portable
  members, and defaults; `.change()` is explicitly unsupported until a portable
  alteration strategy exists.

## 1.0.0 - 2026-08-22

### Changed

- **Breaking:** The package is now published as `@rekkr/orm` from
  `github.com/rekkrjs/orm`.
- **Breaking:** The CLI executable is now `orm`, its default configuration file
  is `orm.config.ts`, and its REPL temporary-directory variable is
  `ORM_REPL_TMPDIR`.
- **Breaking:** The runtime facade and configuration types are now
  `configureOrm()`, `OrmConfig`, and `ConfiguredOrm`.
- Internal cache, queue, migration, and temporary-resource prefixes now use the
  `orm` namespace.

### Added

- Model-backed builders expose `forceDelete()` for explicit permanent bulk
  deletion and `withoutTrashed()` for restoring the default soft-delete scope.
- Builders expose `firstOr()`, `findOr()`, and `valueOrFail()` retrieval
  terminators. Model statics proxy the applicable methods, callbacks may be
  synchronous or asynchronous, and `valueOrFail()` preserves a nullable value
  when the row itself exists.
- Builders and models expose `average()` as an alias of `avg()`.
- Model instances expose `fresh()`, `isClean()`, and `loadMissing()` for
  non-mutating reloads, clean-state checks, and selective relation loading.
- Builders and models expose `orDoesntHave()`, `orWhereDoesntHave()`, and
  `whereMorphRelation()` for symmetric negative and polymorphic relation
  filters.

### Fixed

- `delete()` on a model-backed builder now updates `deleted_at` when the model
  uses soft deletes. Raw builders and models without soft deletes continue to
  issue a physical `DELETE`; limited soft deletes affect only the selected
  primary keys, and soft builder deletion dispatches `deleted` without
  incorrectly dispatching update events.
- Builder `update()`, `increment()`, `decrement()`, `upsert()`, `delete()`, and
  `forceDelete()` invalidate affected Identity Map entries. Model persistence
  now keys entries by physical connection and qualified table consistently.
- Model-backed limited updates and increments modify only the selected primary
  keys; limited deletes remove the same ordered rows selected for observers,
  and limited soft deletes qualify their key when joins are present.
- Builder update observers reload affected rows without global scopes and on
  the builder's connection, including rows that leave a scope after the write.
- Chaining `onlyTrashed()` with `withoutTrashed()`, `withTrashed()`, or itself no
  longer leaves contradictory or duplicate `deleted_at` predicates.
- Model proxies no longer mistake inherited object properties for loaded
  relations, preserving `constructor`, `toString()`, and the model prototype.
- `Collection.loadMissing()` groups mixed model collections by constructor, so
  each model class resolves and eager-loads its own relation.
- `refresh()` reloads without global scopes and throws when its row is missing;
  `fresh()` keeps the original instance canonical inside an Identity Map.
- Bulk `deleted` observer placeholders remain existing models after a soft
  delete, while force-deleted placeholders are marked as non-existing.

## 0.12.2 - 2026-08-22

### Added

- Model-backed builders expose `create()` and `firstOrNew()`. Existing query
  constraints participate in the lookup without becoming attributes on a new
  model.

### Changed

- Static `create()`, `firstOrNew()`, `firstOrCreate()`, and `updateOrCreate()`
  delegate to the model builder so creation shares one implementation and uses
  the builder's connection.

## 0.12.1 - 2026-08-21

### Changed

- Model configuration arrays (`fillable`, `guarded`, `hidden`, `visible`,
  `appends`, and `touches`) and `ModelInfo.fillable` are exposed as
  `readonly string[]`. Plain arrays remain valid; readonly tuples are accepted
  when callers already use them. Code that needs a mutable array should make a
  copy first, for example `[...User.fillable]`.

### Fixed

- `makeVisible()` no longer turns its arguments into an instance-wide
  serialization allow-list and discard every other attribute. It now unhides
  those keys and only extends `visible` when the model already declares that
  allow-list.
- `hidden` is applied after `visible`, including instance-level `makeHidden()`
  overrides, so hidden keys never leak merely because a visible list exists.
- The model documentation no longer advertises the nonexistent `setHidden()`
  and `setVisible()` methods or recommends `as const` where it does not improve
  inferred JSON types.

## 0.12.0 - 2026-08-21

### Added

- `MassAssignmentError` exposes the affected model and attribute names when a
  fully guarded model receives mass-assigned data. Partial policies can opt into
  the same protection per model or globally with
  `preventSilentlyDiscardingAttributes`.
- Models can configure their managed timestamp names with `createdAtColumn` and
  `updatedAtColumn`. All model persistence paths, model-derived schemas, and the
  default columns used by `latest()` / `oldest()` honor the public timestamp
  getters while keeping `created_at` / `updated_at` as compatible defaults.
- `Blueprint.timestamps()` accepts either no arguments or an explicit created-at
  and updated-at column pair, with matching compile-time and runtime validation.
- Native JavaScript getters listed in `appends` are included by `toJSON()`,
  `json()`, and `JSON.stringify()` without becoming stored or dirty attributes.
  Existing `static accessors` keep precedence.

### Fixed

- Fully guarded models now reject discarded mass-assignment input instead of
  silently inserting incomplete rows. Empty input and trusted assignment paths
  such as `forceFill()` and `forceCreate()` remain valid.
- `saveMany(models, { events: false })` now preserves each new model's trusted
  attributes instead of filtering and replacing them a second time.

## 0.11.2 - 2026-08-21

### Fixed

- `constrained()` now recognizes camelCase foreign keys ending in `Id` and
  applies ORM's `snakeCase` table convention: `userId` targets `users` and
  `blogPostId` targets `blog_posts`. Code that relied on the previous inferred
  names such as `userIds` must pass that table name explicitly.

## 0.11.1 - 2026-08-21

### Changed

- Models without an explicit `fillable` or `guarded` policy now default to
  `guarded = ["*"]`, matching Laravel. Direct assignment, `forceFill()` and
  `forceCreate()` remain trusted bypasses, while `guarded = []` explicitly
  opts into unrestricted mass assignment.

## 0.11.0 - 2026-08-21

### Changed

- Mass-assignment policies now distinguish an absent declaration from an explicit
  empty array: `fillable = []` blocks every field, while `guarded = []` explicitly
  allows every non-internal field. `guarded = ["*"]` blocks all fields, declaring
  both policies throws, and subclasses may replace an inherited policy.
- Generated model types can attach `ModelMassAssignable<T>` to narrow only protected
  writes (`fill`, `update`, model creation/bulk helpers, relations, and factories)
  without narrowing filters, direct builders, `setAttribute`, `forceFill`, or
  `forceCreate`.
- Search criteria, model defaults and replicas, plus relationship-controlled foreign
  keys, morph columns and constraint defaults, now bypass mass-assignment guards
  without making caller-provided values trusted.

### Added

- `Model#forceFill()` assigns through `setAttribute()`, bypasses mass-assignment
  policies, and returns the model instance.

## 0.10.1 - 2026-08-21

### Fixed

#### Collection

- **`Collection` now reports `Array` as its constructor name.** Every other identity
  check in the language already treats it as an array; `constructor.name` was the only
  one that did not, and consumers dispatching on it sent collections down a subclass
  path. In Elysia that path discards the accumulated response headers, status and
  cookies, so a controller returning a Collection answered 200 with no headers and no
  `Set-Cookie`, with nothing logged (https://github.com/elysiajs/elysia/issues/1842).

## 0.10.0 - 2026-08-21

### Changed

- **`snakeCase` keeps acronyms together.** `parseJSONData` now maps to
  `parse_json_data` instead of `parse_j_s_o_n_data`, and `HTTPServer` to
  `http_server`. This changes the *default* table, foreign-key and pivot-column
  names derived from model names containing acronyms. Set `static table` (or the
  explicit key arguments) on affected models before upgrading.
- **`morphToMany` pluralises its default pivot table.** A `category` morph name
  now defaults to `categories` rather than `categorys`. Pass the pivot table
  explicitly to keep the old name.
- **A job's `static queue` no longer defaults to `"default"`.** The base class
  leaves it undefined so the configured `queue.defaultQueue` applies, which it
  previously could not: jobs went to `"default"` while the worker listened on the
  configured queue and the backlog grew silently. A job can still pin itself with
  `static queue = "default"`.
- **Query logs hide binding values by default.** Bindings carry password hashes,
  tokens and PII; the log line now reports how many were hidden. Opt back in with
  `log: { bindings: true }`. `configureOrm` is authoritative about logging: a
  later call with `log: true`, `log: false` or no `log` at all resets every
  setting, so a previous `bindings: true` (or log file) cannot carry over into a
  configuration that never asked for it. Previously an absent `log` left the
  earlier state untouched.
- **`url()` only accepts web schemes** (`http`, `https`, `ftp`, `ftps`), so
  `javascript:` and `data:` payloads are rejected. **`email()`** rejects
  malformed domains such as `a@b..com`.
- **`dateFormat()` throws on a format it cannot check** instead of falling back
  to "anything `Date` can parse", and checks the value rather than just its
  shape: `31/02/2026`, `2026-99-99` and `99:99:99` are rejected, leap years are
  handled, and the `c` (ISO 8601) pattern is anchored at both ends. **`digitsBetween()`** validates its bounds at
  construction. **`password().uncompromised()`** throws rather than silently
  doing nothing — it never performed a breach check.
- **`Events.dispatch` runs every listener** even when one throws, then rethrows
  (an `AggregateError` when several failed). **`unlisten`** removes one
  registration per call instead of every duplicate.
- `PRAGMA busy_timeout=5000` is applied to SQLite connections; tune or disable it
  with `sqlitePragmas.busyTimeoutMs`.

### Fixed

#### Queue

- Redis: every state transition — dispatch, reserve, release, complete, fail and
  both migrations — now runs as a single Lua script. Redis has no rollback, so
  issuing those as separate commands left windows where a crash stranded a job in
  none of the structures: a hash with nothing referencing it, or an id popped off
  the pending list with no reservation to time out and redeliver it. `ZREM` is
  also the arbitration point in the migrations, so two workers can no longer move
  the same id onto the pending list twice and run the job in parallel. `reserve()`
  skips orphaned ids instead of reporting an empty queue. The driver now requires
  a client exposing `send()`.
- A transient driver error no longer takes down the worker. `reserve()` failures
  are retried with backoff, and `release()`/`fail()` errors in the failure path
  are contained, so a network blip can no longer abandon the jobs other loops
  were half way through.
- A job whose class is not registered is retried within its own `maxAttempts`
  instead of being moved to `failed_jobs` on the first attempt, and the worker
  refuses to start when `jobsPath` is configured but yields no jobs.
- A failing `complete()` after a successful `handle()` is reported instead of
  being counted as a job failure.
- `static jobName` pins a job's registry key for minified builds; `static
  policyName` does the same for policies.
- `--workers` rejects anything that is not a positive integer — including values
  `parseInt` would silently truncate, such as `2x` and `1.5` — instead of
  starting zero workers and exiting 0. It no longer consumes a following flag as
  its value, and `--workers` with no value at all is an error rather than a
  silent fall back to the configured default.
- `queue.redis.url` is honoured; `queue.retryDelaySeconds` is configurable.

#### Models and queries

- `where()`/`whereIn()` constraints chained onto a relation
  (`comments().where("approved", true)`) are applied by `has()`, `doesntHave()`,
  `withCount()` and `withExists()`, which previously aggregated over every
  related row and disagreed with `with()`. `orderBy()` and `limit()` are
  deliberately *not* replayed there: `ORDER BY` on a plain column is invalid next
  to `COUNT(*)` on PostgreSQL and on MySQL under `ONLY_FULL_GROUP_BY`, and
  `LIMIT` would cap result rows rather than counted rows. Eager loading still
  honours both.
- `whereHasMorph` with several types wraps its `EXISTS` branches in a group, so a
  soft-delete scope or a user `where` no longer binds to the first branch only
  and leak trashed rows of the other types.
- `sync()`/`toggle()` compare ids by value, so a Postgres `bigint` returned as a
  string no longer detaches and re-attaches the whole pivot on every call.
- `exists()` includes JOINs (previously invalid SQL or wrong results), handles
  grouped and union queries through a derived table, and no longer leaves its
  bindings on the builder. `pluck()` likewise no longer narrows the builder it
  was called on.
- `UNION` arms that carry their own `ORDER BY`/`LIMIT` are scoped so the compound
  query parses — with parentheses on Postgres/MySQL and a derived table on
  SQLite, which rejects parenthesised arms.
- `DELETE ... LIMIT` fails with a clear message on PostgreSQL instead of emitting
  SQL the server rejects.
- `MorphTo` resolves a related row whose primary key is `0`.

#### Validation

- Cross-field references inside a wildcard resolve against the right row:
  `same("*.end")` under `ranges.*.start` now reads `ranges.0.end` rather than
  `0.end`. Presence rules also fire for keys that are absent from a row, so
  `required()` and `requiredIf()` under a wildcard work at all.
- `gt`/`gte`/`lt`/`lte` compare numeric strings by value rather than by length:
  `gt("15")` accepted `"91"` only by accident and `gt("3")` accepted `"-5"`.
- `distinct()` checks a flat array's own elements instead of silently passing.
- IP validation uses `node:net`, so `:::` and `1.2.3.4.` are rejected and
  `::ffff:192.168.0.1` is accepted.
- Custom messages interpolate `:attribute`.
- `multipleOf()` compares on scaled integers, so `multipleOf(0.1)` accepts `0.3`,
  including values in exponential notation such as `1.1e-7` against `1e-8`.
- `unique().ignoreField()` treats a `null` id as "nothing to ignore" instead of
  emitting `id <> NULL`, which matched no rows and disabled the check entirely.

#### Cache, connections and CLI

- Caching `undefined` is refused instead of writing the string `"undefined"`,
  which made every later read of that key throw forever; `remember()` passes an
  `undefined` resolver result through without caching. Unparseable entries are
  treated as a miss and dropped.
- `MemoryCacheStore` clears a key from its tag indexes on `forget()` *and* on
  overwrite, dropping indexes left empty, and sweeps expired entries as writes
  come in rather than only when that exact key is read. Entries written with no
  TTL still live until forgotten: this store has no eviction policy.
- Concurrent `resolveTenant()` calls for the same cold tenant share one
  resolution, instead of building two connections and orphaning the first. A
  resolution still in flight when `closeAll()` runs is discarded rather than
  registering a connection and a tenant entry after shutdown.
- `transaction()` refuses to open a `BEGIN` inside a manual `beginTransaction()`
  on the same connection.
- `types:generate` no longer enters the tenant branch — and throws after writing
  the landlord files — in a project whose `modelsPath` is a plain string.
- `queue:install` generates the tables named by `queue.table`/`queue.failedTable`.
- `orm init` serialises prompt answers with `JSON.stringify`, so a quote or
  `${...}` in an answer cannot break or inject into the generated config.
- The command signature parser reads `{-f}` as a short flag rather than a
  required positional argument, and trims `{--dir= ./app}` defaults.
- `bm25` weights are validated before reaching the SQL.


## 0.7.1 - 2026-08-20

### Fixed

- Driver connection configs are handed to Bun's SQL client as-is instead of
  being assembled into a URL first, so usernames and passwords containing `/`,
  `?`, `#`, `@` or `%` no longer produce an `Invalid URL` error. The `url`
  connection form still requires percent-encoded credentials.
- Driver configs no longer force `host` to `localhost` while leaving `port`,
  `database`, `username`, and `password` to be resolved from the environment.
  All five fields now behave alike: whatever you omit is resolved by Bun from
  the adapter's standard variables (`PGHOST`, `PGPORT`, `PGUSER`, ... and the
  `MYSQL_*` equivalents), falling back to `localhost` and the default port when
  unset. Previously an environment that supplied credentials and port would
  still be pointed at `localhost`. Pass `host` explicitly to override the
  environment; see `docs/configuration.md` for the full contract.

## 0.7.0 - 2026-08-19

### Changed

- Model hydration and serialization avoid redundant Proxy work, visibility
  rebuilding, and no-op cast dispatch. `DB.table()` is documented as the
  plain-row path for read-only endpoints that do not need model behavior.

### Fixed

- In-place mutations to `date` and `datetime` casts are detected by dirty
  tracking and persisted without corrupting the original database snapshot.
- Hydration preserves `setConnection` overrides declared either as prototype
  methods or instance fields, while retaining the direct fast path for the
  default implementation.
- Mutable-cast metadata remains isolated from later changes to a model's public
  static cast map.

## 0.6.5 - 2026-08-19

### Breaking changes

- SQLite connections now enable `PRAGMA foreign_keys=ON` by default. Run
  `PRAGMA foreign_key_check` before upgrading an existing database. Set
  `sqlitePragmas: { foreignKeys: false }` temporarily only when legacy data
  must be repaired first.
- The misleading `encrypted` cast was removed. Use `base64` for encoding or a
  custom cast backed by a real cipher for encryption.
- `decimal:N` now rounds decimal strings without converting through
  JavaScript `number` and throws for invalid values or scales. Recomputed
  values can therefore differ from earlier binary-floating-point rounding.
- `sum()` and `avg()` preserve exact driver values and return
  `number | string | bigint`; callers must not assume a `number`.
- Saving an existing model without its primary key now throws instead of
  issuing an unsafe update. Textual primary keys are generated only when the
  model and database schema indicate that ORM owns their generation.

### Changed

- Write payloads omit `undefined` properties so database defaults run, while
  explicit `null` values still write SQL `NULL`.
- MySQL date writes require a UTC session and verify it on the same physical
  connection as the write. The successful check is reused while a transaction
  pins that session.
- Foreign-key actions are normalized and restricted to supported SQL actions;
  `SET NULL` is rejected when a non-nullable local column is visible in the
  current blueprint.

### Fixed

- Pagination counts now preserve joins and correctly wrap grouped, distinct,
  `HAVING`, union, and recursive queries.
- Manual MySQL transactions keep `BEGIN`, writes, and commit or rollback on one
  pooled session, and reserved sessions are released on error paths.
- SQLite, MySQL, and PostgreSQL now share regression coverage for defaults,
  pagination, foreign-key actions, raw bindings, migrations, and native value
  contracts.
