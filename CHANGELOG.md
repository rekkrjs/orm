# Changelog

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
