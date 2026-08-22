# Models

Models are TypeScript classes that map to a single database table. They give you typed attribute access, CRUD helpers, query scopes, casts, accessors, soft deletes, and lifecycle events — all the pieces you'd expect from an Eloquent-style ORM.

```ts
import { Model } from "@bunnykit/orm";
```

## Defining a model

There are two ways to declare a model. They differ only in how attribute types reach TypeScript.

### `Model.define<T>(table)` — typed (recommended)

Pass an attribute interface and the table name. The returned base class has every attribute, every column name in `where()`, and every relation name in `with()` fully typed:

```ts
import { Model } from "@bunnykit/orm";

interface ProductAttributes {
  id: number;
  sku: string;
  name: string;
  price: string;
  active: boolean;
  metadata: Record<string, any> | null;
}

class Product extends Model.define<ProductAttributes>("products") {
  static primaryKey = "sku";
  static timestamps = false;
  static softDeletes = true;

  static attributes = {
    active: true,
    status: "draft",
  };

  static casts = {
    active: "boolean",
    price: "decimal:2",
    metadata: "json",
  };
}
```

For tables with irregular plural names (`curricula`, `media`, ...) pass the singular class name as the second argument so foreign key inference works correctly when the class is assigned to a variable instead of subclassed:

```ts
// Subclassed — class name is always correct:
class Curriculum extends Model.define<CurriculumAttributes>("curricula") {}

// Direct assignment — provide name explicitly:
const Curriculum = Model.define<CurriculumAttributes>("curricula", "Curriculum");
```

### Plain `extends Model`

If you don't need attribute typing (or already have it from generated declarations), you can subclass `Model` directly:

```ts
class Product extends Model {
  static table = "products";
  static primaryKey = "sku";
  static timestamps = false;
  static softDeletes = true;

  static casts = {
    active: "boolean",
    price: "decimal:2",
    metadata: "json",
  };
}
```

This is mostly useful when you're combining the ORM with generated `.d.ts` files (see [Type Generation](./type-generation.md)).

## Conventions

- **Table name** — inferred from the class name in `snake_case` plus a trailing `s`. `class User` → `users`, `class BlogPost` → `blog_posts`. Override with `static table = "..."`.
- **Schema (PostgreSQL)** — optional `static modelSchema = "..."` pins a model to a schema (for example landlord/shared models on `public`).
- **Primary key** — defaults to `id`. Override with `static primaryKey = "..."`.
- **Key type** — defaults to `int`. Set `static keyType = "uuid"` or `"string"` for non-numeric keys; set `static incrementing = false` if the database doesn't auto-increment.
- **Generated keys** — with a textual primary key the ORM fills the value with a UUID before inserting, but not when the column has a database default (the database already decides it) or is too short to hold one — a `CHAR(26)` holding ULIDs stays yours to fill. `static keyType = "uuid"` opts in regardless of the column. MySQL cannot return a primary key assigned by an expression or trigger, so those models must provide the key explicitly (or use `AUTO_INCREMENT` or a literal default).
- **Timestamps** — `created_at` and `updated_at` are managed automatically. Disable with `static timestamps = false`.
- **Connection** — uses the default connection. Override per model with `static connection = "..."` plus `ConnectionManager.add(...)`.

## Timestamps

Models manage `created_at` and `updated_at` by default. Override both column names
when a table uses another convention:

```ts
class User extends Model {
  static override createdAtColumn = "createdAt";
  static override updatedAtColumn = "updatedAt";
}
```

`User.getCreatedAtColumn()` and `User.getUpdatedAtColumn()` expose the resolved
names. Model writes, `dateColumns()`, `schema()`, `replicate()`, `latest()`, and
`oldest()` use these getters, so a model may override either the property or its
getter. Names must be non-empty and different.

Ordinary JavaScript static inheritance applies. A Bunny base model can set both
names once, and subclasses may override either name independently:

```ts
class CamelModel extends Model {
  static override createdAtColumn = "createdAt";
  static override updatedAtColumn = "updatedAt";
}

class User extends CamelModel {}

class ImportedRecord extends CamelModel {
  static override createdAtColumn = "createdOn";
}
```

Set `static override timestamps = false` when Bunny must not manage timestamp
fields. Inactive timestamp settings are not validated during ordinary model use
or model-derived schema generation; explicit timestamp APIs such as the public
getters, `latest()`, and `replicate()` still validate the names they need.
`withoutTimestamps()` temporarily disables writes and restores the inherited
setting afterward.

Valdyr applications keep Valdyr's direct `extends Model` requirement for static
analysis; Bunny's support for inherited settings does not introduce an
application `BaseModel` convention there.

## Schema Resolution (PostgreSQL tenancy)

When using schema-per-tenant tenancy, models resolve table names in this order:

1. `static modelSchema` on the model (explicit override)
2. Active tenant schema from `TenantContext.run(...)`
3. Fallback `public` (PostgreSQL only)

Example:

```ts
import { Model, TenantContext } from "@bunnykit/orm";

class Plan extends Model.define<{ id: number; name: string }>("plans") {
  static modelSchema = "public"; // landlord/shared
}

class Invoice extends Model.define<{ id: number; total: string }>("invoices") {
  // tenant-resolved schema
}

await TenantContext.run("acme", async () => {
  console.log(Plan.getQualifiedTable());    // public.plans
  console.log(Invoice.getQualifiedTable()); // tenant_acme.invoices (depends on resolver)
});
```

`static modelSchema` is intended for PostgreSQL schema-based setups. MySQL/SQLite do not use PostgreSQL schema qualification.

## Default attributes

Use `static attributes` to give new instances in-memory defaults before saving:

```ts
class User extends Model {
  static attributes = {
    active: true,
    role: "member",
  };
}

const user = new User({ name: "Ada" });
user.active; // true
user.role;   // "member"
```

These are model defaults, not database defaults. Values passed to the constructor or `create()` override them.

## Attribute casting

`static casts` transforms values on read and serializes them on write. Casts are the right place to handle JSON columns, booleans (stored as 0/1 on SQLite), and decimals.

```ts
class User extends Model {
  static casts = {
    active: "boolean",
    login_count: "integer",
    price: "decimal:2",
    settings: "json",
    secret: "base64",
  };
}

const user = new User({ active: true, settings: { theme: "dark" } });
user.$attributes.active;   // 1 (stored)
user.active;               // true (cast on read)
user.settings.theme;       // "dark" (parsed JSON)
```

### Built-in casts

| Cast | Behavior |
|---|---|
| `boolean`, `bool` | Stores `1` / `0`, reads boolean |
| `number`, `integer`, `int`, `float`, `double` | Reads / writes as a number |
| `decimal:N` | Stores fixed precision string (e.g. `decimal:2` for money) |
| `string` | Reads / writes as a string |
| `date`, `datetime` | Reads as `Date`, stores ISO string from `Date` input |
| `json`, `array`, `object` | Stores JSON string, reads parsed value |
| `enum` | Stores `.value` of enum members |
| `base64` | Base64-encoded on write, decoded on read. Encoding, not encryption |

`decimal:N` deliberately returns a string. Pass exact database decimals as
strings too (`"12345678901234567890.12"`): once a value has entered a JavaScript
`number`, digits beyond its safe precision cannot be recovered. PostgreSQL
`NUMERIC` and MySQL `DECIMAL` preserve those strings natively. SQLite maps the
schema builder's decimal type to `REAL`; use a `TEXT` column with the decimal
cast, or integer minor units, when SQLite storage must remain exact.

JSON casts are mutable. Bunny compares the serialized cached value during dirty
tracking, so changing `user.settings.theme` in place is detected by `isDirty()`
and persisted by `save()`; assigning a whole replacement object also works.
JSON numbers still obey JavaScript's numeric precision. Store identifiers and
other integers beyond `Number.MAX_SAFE_INTEGER` as JSON strings.

> **`encrypted` was removed in favour of `base64`.** It only Base64-encoded
> values — anyone could decode them — so the name promised a guarantee it never
> delivered. Models still declaring `encrypted` now throw instead of silently
> encoding. For real secrets, write a custom cast backed by an actual cipher
> (`node:crypto`) and keep the key outside the database.

### Custom cast classes

Implement `CastsAttributes` for any transformation a built-in cast can't express:

```ts
import type { CastsAttributes, Model } from "@bunnykit/orm";

class UppercaseCast implements CastsAttributes {
  get(_model: Model, _key: string, value: unknown) {
    return String(value);
  }
  set(_model: Model, _key: string, value: unknown) {
    return String(value).toUpperCase();
  }
}

class Product extends Model {
  static casts = {
    sku: UppercaseCast,
  };
}
```

When a custom cast writes to a `DATE`, `DATETIME`, or `TIMESTAMP` column, its
`set()` method must return a `Date`, not a preformatted or ISO date string. This
lets Bunny apply the correct database-specific serialization and, on MySQL,
verify the session's UTC requirement without mistaking ordinary text for a date.

You can also add casts at runtime to one instance only:

```ts
user.mergeCasts({ count: "string" });
```

## Accessors and mutators

`static accessors` transforms attribute values on read (`get`) and write (`set`). They run through property access (`model.name`), `getAttribute()`, and `setAttribute()`.

```ts
class User extends Model {
  static accessors = {
    name: {
      get: (value: string) => value?.toUpperCase(),
    },
    email: {
      set: (value: string) => value?.toLowerCase().trim(),
    },
    slug: {
      get: (value: string) => value?.replace(/-/g, " "),
      set: (value: string) => value?.toLowerCase().replace(/\s+/g, "-"),
    },
  };
}

const user = new User({ email: "  ALICE@Example.com  " });
user.$attributes.email; // "alice@example.com" — mutator ran on set

const found = await User.create({ name: "alice" });
found.name;             // "ALICE" — accessor ran on get
```

### Typed accessors

Annotate `static accessors` with `AccessorMap<TAttrs, TModel>` so the callback parameters are fully typed — including `model` as `this` class:

```ts
import { Model, type AccessorMap } from "@bunnykit/orm";

interface UserAttrs {
  id: number;
  first_name: string;
  last_name: string;
}

class User extends Model.define<UserAttrs>("users") {
  declare full_name: string;

  static accessors: AccessorMap<UserAttrs, User> = {
    full_name: {
      get: (_value, attributes, model) => {
        //    ^ any        ^ UserAttrs      ^ User
        return `${attributes.first_name} ${attributes.last_name}`.trim();
      },
    },
  };
}
```

Without the annotation, TS has no inference target and parameters widen to `any`. If you find the annotation noisy, the `satisfies` form works too — but it produces a worse error message if your callbacks don't match the shape, so prefer the explicit annotation.

### Computed (virtual) attributes

A `get` with no matching database column behaves as a computed property derived from other attributes. Use `declare` on the class so TypeScript knows the property exists:

```ts
class User extends Model {
  declare full_name: string;

  static accessors = {
    full_name: {
      get: (_value: any, attrs: Record<string, any>) =>
        `${attrs.first_name ?? ""} ${attrs.last_name ?? ""}`.trim(),
    },
  };
}

const user = new User({ first_name: "Ada", last_name: "Lovelace" });
user.full_name;       // "Ada Lovelace"
```

Computed accessors are picked up by `toJSON()` when listed in `static appends` (see [Serialization](#serialization)).

## Mass assignment

Models without an explicit policy are fully guarded. Mass-assigning any
non-internal attribute to them throws `MassAssignmentError`. Declare either
`fillable` (allow list) or `guarded` (deny list), never both:

```ts
class User extends Model {
  static fillable = ["name", "email", "role"];
  // — or —
  static guarded = ["id", "is_admin", "created_at", "updated_at"];
}

await User.create({ name: "Alice", email: "a@b.com", is_admin: true });
// is_admin is silently dropped (guarded)
```

Partial policies silently discard protected attributes by default. Set
`preventSilentlyDiscardingAttributes` globally or on one model to throw instead:

```ts
Model.preventSilentlyDiscardingAttributes = true; // all models

class StrictUser extends Model {
  static guarded = ["is_admin"];
  static preventSilentlyDiscardingAttributes = true; // or only this model
}
```

Empty arrays are explicit policies: `fillable = []` is fully guarded and
`guarded = []` allows everything. `guarded = ["*"]` is also fully guarded. Fully
guarded policies throw only when input is discarded, so `create({})` remains valid
for tables backed entirely by database defaults. A subclass inherits its parent's
policy unless it declares a replacement policy of its own. Internal keys such as
`$attributes`, `$exists`, `__proto__`, `prototype`, and `constructor` are always
discarded silently and never trigger `MassAssignmentError`.

Factories use the same protected path as `create()`. A model with a fully guarded
policy therefore throws when its factory supplies attributes; declare an explicit
writable policy when creating that model through a factory.

Bypass the guard with `forceCreate` / `forceFill` when an admin or migration script needs it:

```ts
await User.forceCreate({ name: "Root", is_admin: true });
user.forceFill({ is_admin: true });
await user.save();
```

## Visibility (`hidden` / `visible`)

Control what `toJSON()` returns. Use `hidden` to remove fields from output, or `visible` to allow-list:

```ts
class User extends Model {
  static hidden = ["password", "remember_token"];
  // — or, allow-list style —
  static visible = ["id", "name", "email"];
}
```

If a key appears in both lists, `hidden` wins. These configuration properties
also accept readonly arrays and tuples, but `as const` is not required.

Instance-level overrides:

```ts
user.makeHidden("email", "phone");
user.makeVisible("password"); // re-include without hiding other attributes
```

`makeVisible()` extends an existing `visible` allow-list, if present, but does
not create one on a model that only uses `hidden`.

Hidden fields are also dropped from `json()` and `JSON.stringify(user)`.

## CRUD

### Read

```ts
const all = await User.all();                                  // Collection<User>
const count = await User.count();
const found = await User.find(1);                              // null if missing
const first = await User.first();
const firstOrGuest = await User.firstOr(() => guestUser);
const foundOrGuest = await User.findOr(1, () => guestUser);
const many = await User.findMany([1, 2, 3]);
const admin = await User.firstWhere("role", "admin");

const selected = await User.whereKey([1, 3, 5]).get();
const others = await User.whereKeyNot(1).get();

// Throw-on-miss
const user = await User.findOrFail(1);
const first = await User.firstOrFail();
const email = await User.where("id", 1).valueOrFail("email");
```

### Create

```ts
// Mass assignment (respects fillable / guarded)
const user = await User.create({ name: "Alice", email: "alice@example.com" });

// Construct then save
const u = new User({ name: "Bob" });
await u.save();
u.$exists;            // true
u.$wasRecentlyCreated; // true
```

### Update

```ts
// Property assignment
user.name = "Alice Smith";
await user.save();

// fill() + save()
user.fill({ name: "Bob", email: "bob@example.com" });
await user.save();

// Combined
await user.update({ name: "Bob", email: "bob@example.com" });

// Raw attribute access (bypasses accessors / mutators)
user.getAttribute("name");
user.setAttribute("name", "Dana");
```

### Delete

```ts
const freshUser = await user.fresh(); // new instance or null; user is unchanged
await user.refresh();   // reload current state or throw ModelNotFoundError
await user.touch();     // update only the timestamp columns
await user.delete();
```

`fresh()` and `refresh()` reload the same primary key on the model's current
connection without applying global scopes. This lets an already-hydrated model
reload itself after a soft delete; it does not expose unrelated rows.

### `firstOrNew` / `firstOrCreate` / `updateOrInsert`

```ts
// firstOrNew — find or instantiate; does NOT save automatically
const user = await User.firstOrNew(
  { email: "alice@example.com" }, // search by
  { name: "Alice" },              // attributes if creating
);
user.$exists; // false if not found
await user.save();

// firstOrCreate — find or create (saves immediately)
const user = await User.firstOrCreate(
  { email: "alice@example.com" },
  { name: "Alice" },
);

// updateOrInsert — update if exists, otherwise insert
await User.updateOrInsert(
  { email: "alice@example.com" },
  { name: "Alice Smith", active: true },
);
```

These are great for idempotent imports, OAuth login flows, and "ensure this record exists" scripts.

### `replicate`

Clone a model without its primary key or timestamps:

```ts
const copy = user.replicate();
copy.email = "copy@example.com";
await copy.save();

const partial = user.replicate(["email", "stripe_id"]);  // exclude additional fields
```

### Increment / decrement

```ts
await user.increment("login_count");
await user.increment("login_count", 5, { last_login_at: new Date() });
await user.decrement("stock", 10);
await User.where("active", false).decrement("score", 2);   // bulk
```

### Quiet operations (skip observers)

```ts
await user.saveQuietly();
await user.deleteQuietly();
await User.createMany(records, { events: false });
await User.saveMany(models, { events: false });
model.save({ events: false });
```

### `forceCreate` / `truncate` / `withoutTimestamps`

```ts
await User.forceCreate({ name: "Root", internal_flag: true });

await User.truncate();   // wipe the table

await User.withoutTimestamps(async () => {
  await User.create({ name: "No Timestamp" });   // timestamps not set
  await user.save();                              // updated_at unchanged
});
```

## Bulk operations

Bulk input methods apply fillable rules, casts, timestamps, and UUID key generation
automatically. `saveMany()` receives model instances, so it persists their existing
trusted attributes; `createMany()` still filters its input while constructing them.

### `insert` / `insertOrIgnore` / `upsert`

```ts
// Fast bulk insert — no model events
await User.insert(
  [
    { name: "Alice", email: "alice@example.com" },
    { name: "Bob", email: "bob@example.com" },
  ],
  { chunkSize: 500 },
);

// Skip conflicting rows
await User.query().insertOrIgnore([
  { email: "alice@example.com" },
  { email: "existing@example.com" },
]);

// Insert or update on conflict
await User.upsert(
  [{ email: "alice@example.com", name: "Alice Updated" }],
  "email",            // unique key column(s)
  ["name"],           // columns to overwrite
  { chunkSize: 500 },
);

// Omit updateColumns to overwrite everything except the unique key
await User.upsert(
  [{ email: "alice@example.com", name: "Alice", active: true }],
  "email",
);
```

### `createMany` / `saveMany`

These fire model events; `insert` does not.

```ts
const users = await User.createMany([
  { name: "Alice", email: "alice@example.com" },
  { name: "Bob", email: "bob@example.com" },
]);

const p1 = new User({ name: "Alice" });
const p2 = new User({ name: "Bob" });
await User.saveMany([p1, p2]);

// Skip observers
await User.createMany(records, { events: false });
```

## Lifecycle and state

### `$exists`, `$wasRecentlyCreated`

```ts
const user = new User({ name: "Alice" });
user.$exists;             // false

await user.save();
user.$exists;             // true

const created = await User.create({ name: "Bob" });
created.$wasRecentlyCreated;  // true

const fetched = await User.find(created.id);
fetched.$wasRecentlyCreated;  // false
```

### `wasChanged` / `getChanges`

Inspect which attributes changed in the last `save()`:

```ts
user.setAttribute("name", "Updated");
await user.save();

user.wasChanged();        // true
user.wasChanged("name");  // true
user.wasChanged("email"); // false
user.getChanges();        // { name: "Updated" }
```

### `isDirty` / `isClean` / `getDirty`

In-memory attributes that haven't been saved yet:

```ts
user.setAttribute("name", "Pending");
user.isDirty();           // true
user.isClean();           // false
user.getDirty();          // { name: "Pending" }

await user.save();
user.isDirty();           // false
user.isClean();           // true
```

### `is` / `isNot`

Compare two instances by table and primary key:

```ts
const a = await User.find(1);
const b = await User.find(1);
a.is(b);                  // true
a.isNot(b);               // false
```

### `isInstanceOf`

Check whether the current instance belongs to a model class, which is useful in observers and shared helpers:

```ts
if (model.isInstanceOf(User)) {
  model.getAttribute("email");
}
```

## Serialization

`toJSON()` (or its alias `json()`) returns a plain object combining attributes and loaded relations:

```ts
const user = await User.with("posts").first();

user.toJSON();
// { id: 1, name: "Alice", posts: [{ id: 1, title: "Hello" }, ...] }

user.json();                       // same as toJSON()
user.json({ relations: false });   // attributes only, no relations
```

`JSON.stringify(user)` calls `toJSON()`, so it picks up relations and accessor-defined virtual fields automatically.

### Picking fields

Pass field names to return only a subset. Keys autocomplete and are type-checked:

```ts
user.json("id", "name", "email")
// { id: 1, name: "Alice", email: "alice@example.com" }
```

Use dot notation to pick fields from eager-loaded relations:

```ts
const user = await User.with("posts", "social").first();

user.json("id", "name", "posts.title")
// { id: 1, name: "Alice", posts: [{ title: "Hello" }] }

user.json("id", "social.provider", "social.provider_id")
// { id: 1, social: { provider: "github", provider_id: "gh-123" } }
```

This works on collections too — the same signature, applied to every item:

```ts
const users = await User.with("posts").get();

users.json("id", "name", "posts.title")
// [{ id: 1, name: "Alice", posts: [{ title: "Hello" }] }, ...]
```

### Appended attributes

Use `static appends` to include native getters in serialized output. Because the
getter is a real TypeScript member, no separate `declare` or Bunny-specific
accessor is needed:

```ts
type UserAttrs = {
  id: number;
  first_name: string;
  last_name: string;
};

class User extends Model.define<UserAttrs>("users") {
  static appends = ["fullName"];

  get fullName(): string {
    return `${this.first_name} ${this.last_name}`.trim();
  }

  get initials(): string {
    return `${this.first_name[0] ?? ""}${this.last_name[0] ?? ""}`.toUpperCase();
  }
}

const user = await User.firstOrFail();
user.fullName;                    // normal property access
user.json().fullName;             // included via static appends

const withInitials = user.append("initials");
withInitials.json().initials;     // included for this instance only

user.setAppends(["initials"]);    // replace the list
user.getAppends();                // ["fullName", "initials"]
```

Visibility is applied before a getter runs, and a getter is evaluated at most
once per serialization. Its result is never written to `$attributes`, marked
dirty, or included in SQL. `static accessors` remains supported for persisted
attribute getters and setters; if both mechanisms use the same name, the static
accessor takes precedence.

## Soft deletes

Set `static softDeletes = true` and add a `deleted_at` column (`table.softDeletes()` in [Schema Builder](./schema-builder.md#convenience-helpers)):

```ts
class User extends Model {
  static softDeletes = true;
}

await user.delete();         // sets deleted_at — row stays in DB
await user.restore();        // clears deleted_at
await user.forceDelete();    // permanently removes the row

await User.all();                       // excludes trashed
await User.withTrashed().get();         // includes trashed
await User.withTrashed().withoutTrashed().get(); // excludes them again
await User.onlyTrashed().get();         // only trashed
await User.onlyTrashed().restore();     // restore everything trashed

await User.where("inactive", true).delete();          // bulk soft delete
await User.onlyTrashed().where("inactive", true).forceDelete(); // bulk permanent delete
```

## Scopes

### Local scopes

Static methods named `scope{Name}` register a chainable scope:

```ts
import type { Builder } from "@bunnykit/orm";

class User extends Model {
  static scopeActive(query: Builder<User>) {
    return query.where("active", true);
  }
  static scopeRole(query: Builder<User>, role: string) {
    return query.where("role", role);
  }
}

const users = await User.scope("active").get();
const admins = await User.scope("role", "admin").get();
```

Combine them like any other builder call:

```ts
await User.scope("active").scope("role", "admin").orderBy("name").get();
```

### Global scopes

A scope applied automatically to every query on the model:

```ts
User.addGlobalScope("tenant", (query) => {
  query.where("tenant_id", currentTenantId());
});

// Bypass for a specific query
await User.withoutGlobalScope("tenant").get();
await User.withoutGlobalScopes().get();
```

Global scopes are the right tool for soft-multi-tenancy at the model level. For schema- or database-per-tenant strategies, use [`DB.tenant()`](./query-builder.md#multi-tenant-scope) instead.

## `touches` — bump parent timestamps

Declare `static touches` to bump a parent relation's `updated_at` whenever this model is saved:

```ts
class Post extends Model {
  static touches = ["author"];

  author() {
    return this.belongsTo(User);
  }
}

await post.save();   // also bumps post.author.updated_at
```

Useful for cache invalidation patterns where the parent's timestamp drives view rebuilds.

## Common pitfalls

- **Accessors without typing widen to `any`.** Annotate `static accessors` with `AccessorMap<TAttrs, TModel>` to get full IntelliSense.
- **Mass assignment surprises.** Adding a new column doesn't automatically expose it through `create()` if you set `static fillable`. Update the allow list when you add new fields.
- **Builder updates skip per-instance before-hooks and timestamps.** Registered observers still receive `updated`/`saved` after `User.where(...).update(...)`; fetch the instance and call `instance.save()` or `instance.update()` when `updating`/`saving` hooks or automatic timestamps matter.
- **`delete()` without soft deletes is permanent.** If you intended a soft delete, set `static softDeletes = true` and add a `deleted_at` column.
- **`fresh()` and `refresh()` differ.** `fresh()` returns a new instance (or `null`) without changing the current object; `refresh()` mutates the current instance and throws `ModelNotFoundError` if its row no longer exists. Both reload without global scopes.
- **Relation loading is explicit.** Use `model.loadMissing()` or `Collection.loadMissing()` to load only relations that are still absent, or `with()` on the next query.

## Where to next

- [Relationships](./relationships.md) — `hasMany`, `belongsTo`, polymorphic, pivot tables.
- [Query Builder](./query-builder.md) — every chainable filter, join, and aggregate.
- [Observers](./observers.md) — lifecycle hooks for creating, updating, and deleting.
- [Events](./events.md) — explicit application events and class-based handlers.
- [TypeScript](./typescript.md) — how the types flow through `Model.define<T>()`.
