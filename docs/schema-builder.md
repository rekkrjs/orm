# Schema Builder

The schema builder defines tables, columns, indexes, and foreign keys in TypeScript instead of raw SQL. The same code emits the right dialect for SQLite, MySQL, and PostgreSQL — you do not have to maintain three versions of every migration.

`Schema` is a static class. You typically call it from inside [Migration](./migrations.md) files, but it works anywhere a `Connection` is set.

```ts
import { Schema } from "@rekkr/orm";
```

## Creating tables

`Schema.create(name, callback)` runs `CREATE TABLE` and any associated index / foreign key statements in order:

```ts
await Schema.create("products", (table) => {
  table.id();
  table.uuid("uuid").unique();
  table.string("name", 100);
  table.text("description").nullable();
  table.integer("stock").unsigned().default(0);
  table.decimal("price", 10, 2);
  table.boolean("active").default(true);
  table.json("metadata").nullable();
  table.timestamps();
  table.softDeletes();
});
```

If the table might already exist, use `createIfNotExists`:

```ts
await Schema.createIfNotExists("settings", (table) => {
  table.id();
  table.string("key").unique();
  table.text("value");
});
```

## Column types

Every method on the blueprint adds a column. The first argument is always the column name.

### Integers

| Method | SQL type |
|---|---|
| `id(name = "id")` | Alias of `bigIncrements`; auto-incrementing primary key |
| `increments(name = "id")` | Auto-incrementing integer primary key |
| `bigIncrements(name = "id")` | Auto-incrementing big-integer primary key |
| `tinyInteger(name)` | `TINYINT` |
| `smallInteger(name)` | `SMALLINT` |
| `integer(name)` | `INTEGER` |
| `bigInteger(name)` | `BIGINT` |
| `unsignedTinyInteger(name)` | Unsigned `TINYINT` |
| `unsignedSmallInteger(name)` | Unsigned `SMALLINT` |
| `unsignedInteger(name)` | Unsigned `INTEGER` |
| `unsignedBigInteger(name)` | Unsigned `BIGINT` |

```ts
table.id();                  // the primary key nearly every table wants
table.unsignedInteger("views").default(0);
table.bigInteger("file_size").nullable();
```

`unsigned()` is honored on MySQL; PostgreSQL and SQLite ignore it (no native unsigned type).

### Floating point and decimals

| Method | Notes |
|---|---|
| `float(name, p = 8, s = 2)` | Single-precision float |
| `double(name, p = 8, s = 2)` | Double-precision float |
| `decimal(name, p = 8, s = 2)` | Fixed-precision number — use for money |

```ts
table.decimal("price", 10, 2);   // up to 99,999,999.99
table.decimal("tax_rate", 5, 4); // 0.0000 – 9.9999
```

Always store currency as `decimal`, not `float`/`double`. Floats lose precision
on rounding. At the model boundary, use a `decimal:N` cast and pass exact values
as strings; this keeps MySQL `DECIMAL` and PostgreSQL `NUMERIC` values out of
JavaScript's lossy `number` representation.

### Strings and text

| Method | Notes |
|---|---|
| `string(name, length = 255)` | `VARCHAR(length)` |
| `char(name, length = 255)` | `CHAR(length)` — fixed width |
| `text(name)` | Unbounded `TEXT` |
| `mediumText(name)` | `MEDIUMTEXT` on MySQL (~16MB); `TEXT` elsewhere |
| `longText(name)` | `LONGTEXT` on MySQL (~4GB); `TEXT` elsewhere |

```ts
table.string("email").unique();
table.char("country_code", 2);       // always exactly 2 characters
table.text("body").nullable();
table.longText("payload");
```

Only MySQL/MariaDB has separate storage classes for text, so it is the only driver where `mediumText` and `longText` differ from `text`. PostgreSQL has a single unbounded `TEXT` (~1GB, past both) and SQLite gives everything TEXT affinity, so both collapse to `TEXT` there rather than declaring a type the engine does not really implement.

`char` is real on MySQL and PostgreSQL — blank-padded to the declared width. SQLite accepts the name but enforces no width, so it is declared as `TEXT`; do not rely on fixed-width semantics there.

### Booleans and dates

| Method | Notes |
|---|---|
| `boolean(name)` | `BOOLEAN` (TINYINT(1) on MySQL) |
| `date(name)` | `DATE` (MySQL/Postgres); `TEXT` (SQLite) |
| `time(name, precision?)` | `TIME` (MySQL); `TIME WITHOUT TIME ZONE` (Postgres); `TEXT` (SQLite) |
| `dateTime(name, precision?)` | `DATETIME` (MySQL); `TIMESTAMP WITHOUT TIME ZONE` (Postgres); `TEXT` (SQLite) |
| `timestamp(name, precision?)` | `TIMESTAMP` (MySQL); `TIMESTAMP WITHOUT TIME ZONE` (Postgres); `TEXT` (SQLite) |

```ts
table.boolean("is_published").default(false);
table.timestamp("published_at").nullable();
```

### JSON

| Method | Notes |
|---|---|
| `json(name)` | Native `JSON` (MySQL / PostgreSQL); `TEXT` on SQLite |
| `jsonb(name)` | `JSONB` (Postgres only); falls back to `JSON` elsewhere |

```ts
table.json("preferences").default({});
table.jsonb("search_index").nullable();
```

MySQL uses its native binary `JSON` type, PostgreSQL uses native `JSON`, and
SQLite stores the serialized text. Structured defaults such as `.default({})`
and `.default([])` are serialized correctly on all three drivers. Use `jsonb`
on Postgres for indexable / queryable JSON. See
[`whereJsonContains`](./query-builder.md#json).

JSON is decoded into JavaScript values, so numeric literals beyond
`Number.MAX_SAFE_INTEGER` are not exact. Encode large IDs and exact decimal
values as strings inside JSON documents.

### Identifiers

| Method | Notes |
|---|---|
| `uuid(name)` | `UUID` (Postgres native, `CHAR(36)` elsewhere) |
| `binary(name)` | `BLOB` / `BYTEA` |
| `enum(name, ["a","b"])` | Native `ENUM` on MySQL; `VARCHAR(255)` + `CHECK` on Postgres; `TEXT` + `CHECK` on SQLite |

```ts
table.uuid("public_id").unique();
table.uuid("id").primary(); // primary keys are indexed automatically
table.enum("status", ["draft", "published", "archived"]).default("draft");
```

Enum values must be unique strings between 1 and 255 characters, without NUL
characters or trailing spaces. The final non-null default must be one of the
declared values. Changing an existing enum with `.change()` is rejected because
no portable implementation exists across the supported databases.

MySQL retains its native `ENUM` comparison rules; no binary collation is
imposed. Model casts created with `backedEnum()` still validate exact strings.
Enum members that require hexadecimal rendering use an `utf8mb4` column so
backslashes and Unicode survive independently of the session SQL mode and
database charset.

Do not add `.index()` or `.unique()` to the same column when it is already the primary key. The database creates the primary-key index for:

```ts
table.id();
table.uuid("id").primary();
table.increments("id");
table.bigIncrements("id");
```

### Foreign-key shortcuts

| Method | Equivalent |
|---|---|
| `foreignId(name)` | `bigInteger(name).unsigned()` |
| `foreignUuid(name)` | `uuid(name)` |

```ts
table.foreignId("user_id").constrained();         // bigInteger(user_id) + FK users.id
table.foreignUuid("tenant_id").constrained();
```

## Column modifiers

Modifiers attach to the most recently added column.

```ts
table.string("email").unique();              // UNIQUE constraint
table.string("slug").index();                // INDEX
table.string("name").nullable();             // NULL allowed
table.string("name").nullable(false);        // NOT NULL
table.integer("role").default(1);            // DEFAULT 1
table.timestamp("published_at").useCurrent();
table.uuid("public_id").defaultUuid();        // database-generated UUID where supported
table.string("code").comment("SKU code");    // COMMENT
table.integer("user_id").unsigned();         // UNSIGNED (MySQL)
table.string("uuid").primary();              // Composite/custom primary key column
table.string("phone").after("email");        // Column position (MySQL)
```

| Modifier | Effect |
|---|---|
| `.nullable(value = true)` | Allow `NULL` values, or enforce `NOT NULL` with `false` |
| `.default(value?)` | Set or replace the default literal (or use `Schema.raw(...)` for expressions) |
| `.useCurrent()` | Use the database's `CURRENT_TIMESTAMP` expression |
| `.defaultUuid()` | Use `UUID()` on MySQL or `gen_random_uuid()` on PostgreSQL; emit no default on SQLite |
| `.unique()` | Add a single-column UNIQUE constraint |
| `.index()` | Add a single-column index |
| `.primary()` | Make the column the primary key (see [Primary keys](#primary-keys) for composite ones) |
| `.unsigned()` | Unsigned numeric (MySQL) |
| `.comment(text)` | Column comment (MySQL; PostgreSQL with `change()`) |
| `.after(column)` | Place a newly added column after another one (MySQL) |

Modifiers are chainable in any order before the next column is added.

Repeated `.default()` calls are last-wins, and only the final value is validated
and compiled. `.default(null)` and `.default()` emit no `DEFAULT` clause; they
do not make a column nullable. Call `.nullable()` explicitly when the column
itself should accept `NULL`. `.defaultUuid()` takes precedence over a literal
`.default(...)`; enum columns reject it because a generated UUID cannot satisfy
their declared values.

String defaults are always literals, including `"CURRENT_TIMESTAMP"`. Use
`.useCurrent()` for the database's current-timestamp expression. For any other
trusted database expression, use `Schema.raw(...)`; its contents are inserted
into migration SQL verbatim.

## Convenience helpers

```ts
table.timestamps();        // adds nullable created_at + updated_at TIMESTAMP columns
table.timestamps({ precision: 3 }); // preserve milliseconds
table.timestamps("createdAt", "updatedAt", { precision: 6 }); // explicit names
table.softDeletes();       // adds nullable deleted_at TIMESTAMP
table.softDeletes("removed_at", { precision: 3 }); // custom name + precision
table.rememberToken();     // adds nullable remember_token VARCHAR(100)
```

`timestamps()` accepts no arguments, an options object, or two non-empty,
different column names followed by optional precision options. The zero-argument
form creates ORM's defaults; the named form matches models that configure
`createdAtColumn` and `updatedAtColumn`. `softDeletes(name = "deleted_at")`
remains independent from timestamp column customization and accepts its own
column name and precision options.

Temporal precision must be an integer from `0` through `6`. MySQL emits the
matching `DATETIME(n)`, `TIMESTAMP(n)`, or `TIME(n)` declaration. PostgreSQL
emits `TIMESTAMP(n) WITHOUT TIME ZONE` or `TIME(n) WITHOUT TIME ZONE`; it rounds
rather than truncates when the stored value exceeds the declared precision, so
`10:00:00.600` in a whole-second column becomes `10:00:01`. SQLite always stores
these columns as `TEXT` and ignores the precision declaration.

`rememberToken()` is the "remember me" column: a session cookie carries the token and the login lookup matches it. It is `string("remember_token", 100).nullable()`, and returns the blueprint with that column current, so modifiers still chain:

```ts
table.rememberToken().index();
```

### Polymorphic columns

For polymorphic relations (one column referring to multiple tables), use a `*morphs` helper. It adds the type column, id column, and a composite index in one call.

```ts
// commentable_type + commentable_id (+ index)
table.morphs("commentable");

// nullable subject_type + subject_id (+ index)
table.nullableMorphs("subject");

// UUID-keyed variant
table.uuidMorphs("commentable");

// Nullable UUID variant
table.nullableUuidMorphs("subject");
```

Use these on tables holding [`MorphTo`](./relationships.md#polymorphic-relations) targets — `comments`, `activities`, `attachments`, etc.

## Primary keys

A single-column key is a modifier on the column:

```ts
table.id();                    // conventional bigint primary key
table.uuid("id").primary();    // explicit
```

A composite key belongs to the table, not to any one column, so it takes the columns as an argument — the same shape as `index()`:

```ts
await Schema.create("role_user", (table) => {
  table.foreignId("user_id").constrained();
  table.foreignId("role_id").constrained();
  table.primary(["user_id", "role_id"]);      // PRIMARY KEY (user_id, role_id)
});
```

Pivot tables are the usual case: the pair is the identity of the row, and the key both enforces it and indexes the lookups that lead with the first column.

A second argument names the constraint:

```ts
table.primary(["user_id", "role_id"], "role_user_pk");
```

PostgreSQL and SQLite honor the name. MySQL always calls the primary key `PRIMARY` and ignores what you pass.

`Schema.table()` can add one to a table that has none, as long as the columns are `NOT NULL`:

```ts
await Schema.table("role_user", (table) => {
  table.primary(["user_id", "role_id"]);
});
```

SQLite cannot do this — it has no `ALTER TABLE ... ADD PRIMARY KEY` — and throws rather than silently skipping. Declare the key in `Schema.create()` there.

## Indexes

### Single-column

```ts
table.string("slug").index();          // auto-named: <table>_slug_index
table.string("email").unique();        // auto-named: <table>_email_unique
```

### Composite

```ts
table.index(["user_id", "created_at"]);                  // auto-named
table.index(["user_id", "created_at"], "ix_posts_user"); // explicit name
table.uniqueIndex(["slug"]);                             // auto-named
table.uniqueIndex(["org_id", "key"], "settings_unique"); // explicit
```

### Dropping (inside `Schema.table`)

```ts
await Schema.table("posts", (table) => {
  table.dropIndex("posts_slug_index");
  table.dropUnique("posts_email_unique");
  table.dropForeign("posts_user_id_foreign");
  table.dropTimestamps();
  table.dropSoftDeletes();
  table.dropRememberToken();
  table.dropMorphs("commentable");
});
```

| Method | Purpose |
|---|---|
| `.index()` | Single-column index, auto-named |
| `.index(cols)` / `.index(cols, name)` | Composite index |
| `.unique()` | Single-column unique constraint |
| `.uniqueIndex(cols, name?)` | Explicit single-column or composite unique index |
| `.dropIndex(name)` | Drop a named index |
| `.dropUnique(name)` | Drop a unique constraint |
| `.dropForeign(name)` | Drop a foreign key constraint |
| `.dropTimestamps()` / `.dropTimestampsTz()` | Drop `created_at` and `updated_at` |
| `.dropSoftDeletes(name?)` / `.dropSoftDeletesTz(name?)` | Drop the soft-delete column |
| `.dropRememberToken()` | Drop `remember_token` |
| `.dropMorphs(name, indexName?)` | Drop morph columns and their composite index |

## Foreign keys

### Explicit form

```ts
await Schema.create("posts", (table) => {
  table.id();
  table.foreignId("user_id");
  table
    .foreign("user_id")
    .references("id")
    .on("users")
    .onDelete("cascade")
    .onUpdate("restrict");
  table.string("title");
});
```

### Convention-based form

`constrained()` infers the referenced table from the column name (`user_id` → `users`):

```ts
await Schema.create("posts", (table) => {
  table.id();
  table.foreignId("user_id").constrained();                  // FK posts.user_id → users.id
  table.foreignId("category_id").nullable().constrained();
  table.foreignUuid("tenant_id").constrained();
  table.string("title");
  table.timestamps();
});
```

`foreignId()` creates `BIGINT UNSIGNED`, so its referenced key should be
`id()`/`bigIncrements()` (or an explicitly matching `bigInteger().unsigned()`).
If the parent uses `increments()`/`INTEGER`, declare the child with
`integer("user_id").unsigned()` instead. MySQL rejects foreign keys whose
integer size or signedness differs. Apply `nullable()` before `constrained()`,
because `constrained()` starts the foreign-key builder.

`constrained(table?, column?, name?)` takes the referenced table, the referenced column, and the constraint name — all optional:

```ts
table.foreignId("author_id").constrained("users");             // → users.id
table.foreignId("author_id").constrained("users", "uuid");     // → users.uuid
table.foreignId("author_id").constrained("users", "id", "posts_author_fk");
```

Without a name the database picks one. Name it when you need to reference it later, or when the generated name would exceed the identifier limit — MySQL cuts off at 64 characters, which long table and column names reach faster than you would expect. SQLite names the constraint inline in `CREATE TABLE`; it cannot be dropped there afterwards, but the name still shows up in the schema.

Cascade helpers chain naturally:

```ts
table.foreignId("author_id").constrained().cascadeOnDelete();
table.integer("user_id").nullable();
table.foreign("user_id").references("id").on("users").onDelete("set null");
table.foreign("user_id", "posts_user_fk").references("id").on("users");
```

`onDelete` accepts `"cascade"`, `"restrict"`, `"set null"`, `"no action"`, or `"set default"`. The same options apply to `onUpdate`; other strings are rejected. `SET NULL` requires every local foreign-key column declared in the blueprint to be nullable. Convenience aliases include `restrictOnUpdate()`, `nullOnUpdate()`, `noActionOnUpdate()`, and `noActionOnDelete()` alongside the cascade/delete helpers.

## Altering tables

Use `Schema.table()` to add, modify, drop, or rename columns:

```ts
await Schema.table("users", (table) => {
  table.string("phone").nullable();
  table.timestamp("last_login").nullable();
});
```

New columns land at the end of the table. On MySQL, `after()` places one where you want it:

```ts
await Schema.table("users", (table) => {
  table.string("phone").nullable().after("email");
});
```

PostgreSQL and SQLite cannot reorder columns — they always append, and `after()` is ignored there rather than failing, so the same migration runs on all three drivers.

### Modifying a column

`change()` rewrites an existing column on MySQL and PostgreSQL. SQLite has no
portable way to alter a column and rejects it.

```ts
await Schema.table("users", (table) => {
  table.string("name", 150).nullable().change();
});
```

**`change()` restates the column in full.** Whatever the blueprint does not
declare is reset, not preserved — an omitted `nullable()` makes the column
`NOT NULL`, an omitted `default()` drops the existing default, and an omitted
`comment()` clears the comment. Always describe the column as you want it to end
up, not just the part you are changing:

```ts
// Widens the column AND drops its default and comment.
table.string("name", 150).change();

// Widens it and keeps them.
table.string("name", 150).default("anonymous").comment("display name").change();
```

Three things `change()` will not do:

- **Enums.** No portable rewrite exists across the three drivers, so
  `table.enum(...).change()` throws. Use a driver-specific statement in its own
  migration.
- **Primary keys.** `.primary().change()` throws on every driver. Declare it at
  table level with `table.primary(["id"])` instead — MySQL would otherwise
  accept `MODIFY COLUMN ... PRIMARY KEY` and mean something PostgreSQL cannot
  express at all.
- **Indexes.** A changed column keeps the indexes it already has. Restating
  `.unique()` inside a `change()` block describes the column as it should end up;
  it does not ask for a second index and none is created. To actually add or
  remove one, say so explicitly with `table.uniqueIndex("email")` or
  `table.dropUnique("users_email_unique")` — `uniqueIndex()` picks the same
  `<table>_<column>_unique` name the fluent `.unique()` would have used.

`change()` belongs to `Schema.table()`. Calling it inside `Schema.create()` or
`Schema.createIfNotExists()` throws, as do `dropColumn()`, `renameColumn()`,
`dropIndex()`, `dropUnique()` and `dropForeign()` — they all describe edits to a
table that already exists, while the create methods build the whole table in a
single statement.

### Renaming and dropping

Rename or drop columns:

```ts
await Schema.table("users", (table) => {
  table.renameColumn("user_name", "full_name");
  table.dropColumn("legacy_flag");
  table.dropColumn(["created_by", "updated_by"]);
});
```

Rename or drop entire tables:

```ts
await Schema.rename("users", "customers");
await Schema.drop("old_table");
await Schema.dropIfExists("old_table");
```

## Introspection

Check what already exists before acting:

```ts
if (!(await Schema.hasTable("users"))) {
  await Schema.create("users", /* ... */);
}

if (await Schema.hasColumn("users", "phone")) {
  // safe to query users.phone
}

const indexes = await Schema.getIndexes("posts");
const foreignKeys = await Schema.getForeignKeys("posts");
const exists = await Schema.hasIndex("posts", ["user_id", "created_at"]);
```

These are useful for idempotent setup scripts and for one-shot maintenance work where you don't want to write a full migration.

## Postgres schemas

PostgreSQL has named schemas separate from databases. ORM treats them as first-class:

```ts
await Schema.createSchema("tenant_acme");
await Schema.dropSchema("tenant_acme", { cascade: true });
```

When you set `connection.schema` (or use a tenant resolver), every `Schema.create`, `Schema.drop`, and migration call automatically qualifies tables with that schema. See [Migrations — multi-tenant scopes](./migrations.md#multi-tenant-scopes).

## Driver caveats

- **SQLite** can not change column types in place. The schema builder issues `ALTER TABLE` where SQLite supports it and falls back to a `create + copy + drop + rename` recipe for unsupported operations.
- **SQLite exact numbers:** its `INTEGER`/`REAL` values and Bun's SQLite decoder use JavaScript numbers, so values beyond `Number.MAX_SAFE_INTEGER` and arbitrary-precision decimals are not exact. Store large IDs/decimals as `TEXT`, or store money as integer minor units. Changing `decimal()` globally to text would break numeric ordering and aggregates, so ORM does not do that implicitly.
- **MySQL index limits** are byte-based and depend on the InnoDB row format and page size. The often-cited 191-character `utf8mb4` limit applies to the legacy 767-byte ceiling, not every MySQL installation. See the [MySQL index documentation](https://dev.mysql.com/doc/refman/8.4/en/column-indexes.html) before indexing unusually wide or composite string keys.
- **PostgreSQL** is the only driver that supports `jsonb` and named `schema` qualification. Without an explicit precision, `dateTime()` and `timestamp()` compile to `TIMESTAMP(0) WITHOUT TIME ZONE` as before.
