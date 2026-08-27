# Changelog

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
