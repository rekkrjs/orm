# Models

Models are TypeScript classes that map to a single database table. They give you typed attribute access, CRUD helpers, query scopes, casts, accessors, soft deletes, and lifecycle events — all the pieces you'd expect from an Eloquent-style ORM.

```ts
import { Model } from "@rekkr/orm";
```

## Defining a model

The smallest model is an empty class:

```ts
import { Model } from "@rekkr/orm";

class Product extends Model {}
```

The conventions below fill in the rest: the table is `products`, the primary key
is an auto-incrementing integer `id`, and `created_at` and `updated_at` are
managed for you. Attribute types come from the database: `bunx orm types:generate`
writes declarations that add every column to the class, so `product.name` and
`Product.where("price", ">", "10")` are typed without listing the columns again in
TypeScript. See [Type Generation](./type-generation.md).

Mass assignment is closed by default: list in `fillable` the attributes that
`create()` and `fill()` may set.

### Overriding the defaults

Every convention is a static property. Override only the ones your table does not
follow:

```ts
import { Model } from "@rekkr/orm";

class Product extends Model {
  static override primaryKey = "sku";          // default "id"
  static override keyType = "string" as const; // default "int"
  static override incrementing = false;        // default true: the database assigns the key
  static override timestamps = false;          // default true: created_at and updated_at
  static override softDeletes = true;          // default false: delete() removes the row
  static override fillable = ["sku", "name", "price", "active", "status", "metadata"]; // default: none

  // Values a new instance starts with (default: none)
  static override attributes = {
    active: true,
    status: "draft",
  };

  // How columns are converted on read and write (default: as the driver returns them)
  static override casts = {
    active: "boolean",
    price: "decimal:2",
    metadata: "json",
  };
}
```

### Without type generation: `Model.define<T>()`

If you do not generate declarations, `Model.define<T>(table)` takes the attribute
types from an interface you write instead. The class body is the same:

```ts
interface ProductAttributes {
  sku: string;
  name: string;
  price: string;
  active: boolean;
}

class Product extends Model.define<ProductAttributes>("products") {
  static override primaryKey = "sku";
  static override keyType = "string" as const;
  static override incrementing = false;
}
```

The cost is keeping the interface in step with the table by hand. For tables with
irregular plural names (`curricula`, `media`, ...) pass the singular class name as
the second argument so foreign key inference works when the class is assigned to a
variable instead of subclassed:

```ts
// Subclassed — class name is always correct:
class Curriculum extends Model.define<CurriculumAttributes>("curricula") {}

// Direct assignment — provide name explicitly:
const CurriculumModel = Model.define<CurriculumAttributes>("curricula", "Curriculum");
```

## Conventions

- **Table name** — inferred from the class name in `snake_case` plus a trailing `s`. `class User` → `users`, `class BlogPost` → `blog_posts`. Override with `static table = "..."`.
- **Schema (PostgreSQL)** — optional `static modelSchema = "..."` pins a model to a schema (for example landlord/shared models on `public`).
- **Primary key** — defaults to `id`. Override with `static primaryKey = "..."`.
- **Key type** — defaults to `int`. Set `static keyType = "uuid"` or `"string"` for non-numeric keys; set `static incrementing = false` if the database doesn't auto-increment.
- **Generated keys** — with a textual primary key the ORM fills the value with a UUID before inserting, but not when the column has a database default (the database already decides it) or is too short to hold one — a `CHAR(26)` holding ULIDs stays yours to fill. `static keyType = "uuid"` opts in regardless of the column. MySQL cannot return a primary key assigned by an expression or trigger, so those models must provide the key explicitly (or use `AUTO_INCREMENT` or a literal default).
- **Key column lookup** — to decide the above, ORM reads the primary key column the first time it inserts into a table, then remembers it per database, schema and table. It reads it again after this process changes a table's shape (schema builder, migrations, or raw `CREATE`/`ALTER`/`DROP`/`RENAME`), including when a transaction that did so commits or rolls back. A table re-keyed by another process is seen after a restart, the same as a change to a model's static configuration.
- **Timestamps** — `created_at` and `updated_at` are managed automatically. Disable with `static timestamps = false`.
- **Connection** — uses the default connection. Assign a `Connection` instance
  to `static connection`, or route one query through a registered name with
  `User.on("analytics")`.

## Timestamps

Models manage `created_at` and `updated_at` by default. Override both column names
when a table uses another convention:

```ts
class User extends Model {
  static override createdAtColumn = "createdAt";
  static override updatedAtColumn = "updatedAt";
}
```

A value you set yourself is kept, as in Eloquent: a write stamps the current
time only on a timestamp column you left alone. That lets an import or a test
record when a row was really created:

```ts
await User.create({ name: "Imported", created_at: new Date("2024-02-29T10:00:00Z") });

user.name = "Edited";
user.updated_at = new Date("2025-01-01T00:00:00Z");
await user.save();              // keeps that updated_at; created_at is untouched
await user.increment("logins", 1, { updated_at: someDate }); // keeps someDate
```

`touch()` always stamps the current time.

`User.getCreatedAtColumn()` and `User.getUpdatedAtColumn()` expose the resolved
names. Model writes, `dateColumns()`, `schema()`, `replicate()`, `latest()`, and
`oldest()` use these getters, so a model may override either the property or its
getter. Names must be non-empty and different.

Declaring the columns is enough to make them dates: they read back as `Date`
without a matching `casts` entry, as does `deletedAtColumn` when `softDeletes`
is on. This holds for the defaults too — a model that overrides nothing gets
`created_at` and `updated_at` as dates. An explicit entry still wins, so
`casts = { created_at: "date" }` narrows the value to its UTC calendar day and a
custom cast replaces it outright. Set `timestamps = false` to opt out of the
columns entirely.

The implicit cast has the same parsing rules as an explicit `datetime` cast.
Text without a zone, such as `2026-08-27 12:00:00` from SQLite's
`CURRENT_TIMESTAMP`, is read as UTC whatever the process time zone, because
that is how ORM stores dates; JavaScript alone would read it as local time.
Free-form values, MySQL's `0000-00-00 00:00:00`, and Unix timestamps stored as
strings therefore become an invalid `Date`; numeric Unix seconds are treated as
JavaScript milliseconds. Use an explicit `"string"` cast when the column is not
a valid database datetime.

Ordinary JavaScript static inheritance applies. An ORM base model can set both
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

Set `static override timestamps = false` when ORM must not manage timestamp
fields. Inactive timestamp settings are not validated during ordinary model use
or model-derived schema generation; explicit timestamp APIs such as the public
getters, `latest()`, and `replicate()` still validate the names they need.
`withoutTimestamps()` disables automatic timestamps within its asynchronous
callback, including nested calls and subclasses inheriting the setting. Other
callbacks and models remain unaffected. The static `timestamps` configuration
does not change; implicit timestamp casts follow the callback's scope too.

Valdyr applications keep Valdyr's direct `extends Model` requirement for static
analysis; ORM's support for inherited settings does not introduce an
application `BaseModel` convention there.

## Schema Resolution (PostgreSQL tenancy)

When using schema-per-tenant tenancy, models resolve table names in this order:

1. `static modelSchema` on the model (explicit override)
2. Active tenant schema from `TenantContext.run(...)`
3. Fallback `public` (PostgreSQL only)

Example:

```ts
import { Model, TenantContext } from "@rekkr/orm";

class Plan extends Model {
  static override modelSchema = "public"; // landlord/shared
}

class Invoice extends Model {
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
  static override attributes = {
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
  static override casts = {
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
| `date` | Stores and serializes `YYYY-MM-DD`; reads as a `Date` at UTC midnight |
| `datetime` | Reads as `Date`, stores a full UTC ISO string from `Date` input |
| `timestamp` | Alias of `datetime` |
| `json`, `array`, `object` | Stores JSON string, reads parsed value |
| `base64` | Base64-encoded on write, decoded on read. Encoding, not encryption |

Here `timestamp` means a temporal database value, not Laravel's Unix-timestamp
cast. Store epoch seconds with a `number` cast instead.

The `date` cast represents a calendar day, not an instant: time components are
discarded in UTC before storage. Reading the attribute gives a `Date` at UTC
midnight, and serialization emits the day alone, such as `2026-08-26`. Use
`datetime` when the column must preserve a time.

A `DATE` column without a `date` cast arrives from PostgreSQL and MySQL as a
`Date` at UTC midnight and serializes as a full instant,
`2026-08-26T00:00:00.000Z`. A browser west of UTC that formats that instant in
local time shows the day before, so give calendar-day columns the `date` cast.

### Backed enum casts

Use a backed enum descriptor when an attribute has a fixed set of string values:

```ts
import {
  Model,
  backedEnum,
  InvalidEnumValueError,
  type BackedEnumDefinition,
  type EnumValue,
} from "@rekkr/orm";

export const PublicationState = backedEnum({
  Draft: "draft",
  Published: "published",
});

export type PublicationState = EnumValue<typeof PublicationState>;

class Article extends Model {
  static override casts = {
    state: PublicationState,
  };
}
```

Descriptor constants and serialized model values are primitive strings. The
descriptor, its case map, and its internal value list are immutable. Empty
descriptors, empty or duplicate values, and non-string values fail immediately
when `backedEnum()` is called. `BackedEnumDefinition` is exported for APIs that
accept any descriptor. A descriptor's only own keys are its string cases, so APIs
typed as `Record<PropertyKey, string | number>`, such as TypeBox 1.x `Type.Enum`
or Elysia 2 `t.Enum`, accept it directly.

Reads, writes, bulk model operations, and hydration reject values outside the
descriptor with `InvalidEnumValueError`. The error exposes `model`, `attribute`,
`value`, and the immutable `expected` value list for structured handling.
Unknown string cast names are rejected; use a built-in cast, a backed-enum
descriptor, or a `CastsAttributes` implementation.

`decimal:N` deliberately returns a string. Pass exact database decimals as
strings too (`"12345678901234567890.12"`): once a value has entered a JavaScript
`number`, digits beyond its safe precision cannot be recovered. PostgreSQL
`NUMERIC` and MySQL `DECIMAL` preserve those strings natively. SQLite maps the
schema builder's decimal type to `REAL`; use a `TEXT` column with the decimal
cast, or integer minor units, when SQLite storage must remain exact.

JSON casts are mutable. ORM compares the serialized cached value during dirty
tracking, so changing `user.settings.theme` in place is detected by `isDirty()`
and persisted by `save()`; assigning a whole replacement object also works.
JSON numbers still obey JavaScript's numeric precision. Store identifiers and
other integers beyond `Number.MAX_SAFE_INTEGER` as JSON strings.

### Custom cast classes

Implement `CastsAttributes` for any transformation a built-in cast can't express:

```ts
import type { CastsAttributes, Model } from "@rekkr/orm";

class UppercaseCast implements CastsAttributes {
  get(_model: Model, _key: string, value: unknown) {
    return String(value);
  }
  set(_model: Model, _key: string, value: unknown) {
    return String(value).toUpperCase();
  }
}

class Product extends Model {
  static override casts = {
    sku: UppercaseCast,
  };
}
```

The built-in `date` cast writes its portable `YYYY-MM-DD` calendar literal
directly. Other custom casts that write to a `DATE`, `DATETIME`, or `TIMESTAMP`
column must return a `Date`, not a preformatted or ISO date string. This lets ORM
apply the correct database-specific serialization and, on MySQL, verify the
session's UTC requirement without mistaking ordinary text for a date.

You can also add casts at runtime to one instance only:

```ts
user.mergeCasts({ count: "string" });
```

## Accessors and mutators

`static accessors` transforms attribute values on read (`get`) and write (`set`). They run through property access (`model.name`), `getAttribute()`, and `setAttribute()`.

```ts
class User extends Model {
  static override accessors = {
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
import { Model, type AccessorMap } from "@rekkr/orm";
import type { UsersAttributes } from "./types/users"; // from orm types:generate

export class User extends Model {
  declare full_name: string;

  static override accessors: AccessorMap<UsersAttributes, User> = {
    full_name: {
      get: (_value, attributes, model) => {
        //    ^ any        ^ UsersAttributes ^ User
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

  static override accessors = {
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
  static override fillable = ["name", "email", "role"];
  // — or —
  static override guarded = ["id", "is_admin", "created_at", "updated_at"];
}

await User.create({ name: "Alice", email: "a@b.com", is_admin: true });
// is_admin is silently dropped (guarded)
```

Partial policies silently discard protected attributes by default. Set
`preventSilentlyDiscardingAttributes` globally or on one model to throw instead:

```ts
Model.preventSilentlyDiscardingAttributes = true; // all models

class StrictUser extends Model {
  static override guarded = ["is_admin"];
  static override preventSilentlyDiscardingAttributes = true; // or only this model
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

## Strict mode

Three guards turn a silent model foot-gun into a throw. Each one stands alone,
and `shouldBeStrict()` flips all three:

```ts
Model.shouldBeStrict();            // every model — do this in development only
StrictUser.shouldBeStrict();       // or just one model
StrictUser.shouldBeStrict(false);  // and back off
```

| Guard | Throws when |
| --- | --- |
| `preventLazyLoading` | A relation is loaded outside `with()` |
| `preventSilentlyDiscardingAttributes` | `fill()` drops an attribute the policy protects |
| `preventAccessingMissingAttributes` | A persisted model is asked for a column the query never selected |

```ts
User.shouldBeStrict();

const user = await User.select("id", "name").firstOrFail();
user.name;   // fine
user.email;  // throws MissingAttributeError — email was never selected
```

A missing attribute only throws on a model that came back from the database:
an unsaved model, a model still in `$wasRecentlyCreated` (its row may hold
defaults it never read back), a declared cast, an accessor, a relation, and a
relation method all read as before. Strict mode is set per class, so enabling
it on one model leaves its siblings and its parent untouched.

## Visibility (`hidden` / `visible`)

Control what `toJSON()` returns. Use `hidden` to remove fields from output, or `visible` to allow-list:

```ts
class User extends Model {
  static override hidden = ["password", "remember_token"];
  // — or, allow-list style —
  static override visible = ["id", "name", "email"];
}
```

If a key appears in both lists, `hidden` wins. These configuration properties
also accept readonly arrays and tuples, but `as const` is not required.
The rules apply to attributes, appended values, and loaded relations. When
`visible` is non-empty, append and relation names must be included in it too;
for example, add `fullName` to `visible` if it also appears in `appends`.

Instance-level overrides:

```ts
user.makeHidden("email", "phone");
user.makeVisible("password"); // re-include without hiding other attributes
```

`makeVisible()` extends an existing `visible` allow-list, if present, but does
not create one on a model that only uses `hidden`.

`makeHiddenIf()` and `makeVisibleIf()` apply the same change behind a guard,
which is either a boolean or a predicate receiving the model:

```ts
user.makeHiddenIf(!viewer.isAdmin, "email", "phone");
user.makeVisibleIf((model) => model.getAttribute("id") === viewer.id, "email");
```

When the guard is false the model is returned untouched, so both stay chainable.

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
const firstEmail = await User.value("email");                 // null if no row
const noUsers = await User.doesntExist();

const selected = await User.whereKey([1, 3, 5]).get();
const others = await User.whereKeyNot(1).get();
const page = await User.orderBy("id").limit(25).offset(25).get();

// Throw-on-miss
const user = await User.findOrFail(1);
const requiredFirst = await User.firstOrFail();
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

### `push` — save the model and its loaded relations

`save()` writes one row. `push()` writes that row and then every relation
already loaded on the model, depth first:

```ts
const user = await User.with("posts.comments").findOrFail(1);
user.name = "Alice Smith";
user.posts[0].title = "Edited";
user.posts[0].comments[0].body = "Edited too";

await user.push();   // three UPDATEs, one call
```

Only loaded relations are visited — `push()` never queries for more — and
foreign keys are left alone, so a related model that was never associated stays
unassociated. Each model is saved at most once, so a parent holding its own
children terminates instead of recursing. `push({ events: false })` skips
observers for the whole cascade.

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

### `firstOrNew` / `firstOrCreate` / `createOrFirst` / `updateOrCreate` / `updateOrInsert`

```ts
// firstOrNew — find or instantiate; does NOT save automatically
const user = await User.firstOrNew(
  { email: "alice@example.com" }, // search by
  { name: "Alice" },              // attributes if creating
);
user.$exists; // false if not found
await user.save();

// firstOrCreate — find or create (saves immediately)
const persistedUser = await User.firstOrCreate(
  { email: "alice@example.com" },
  { name: "Alice" },
);

// createOrFirst — insert first; on a UNIQUE conflict, fetch the existing row
const likelyNewUser = await User.createOrFirst(
  { email: "new@example.com" },
  { name: "New User" },
);

// updateOrCreate — update if found, otherwise create and return the model
const updatedUser = await User.updateOrCreate(
  { email: "alice@example.com" },
  { name: "Alice Smith", active: true },
);

// updateOrInsert — update if found, otherwise insert; returns a boolean
await User.updateOrInsert(
  { email: "alice@example.com" },
  { name: "Alice Smith", active: true },
);
```

`firstOrCreate()` starts with a lookup and delegates a miss to `createOrFirst()`.
Use `createOrFirst()` when rows are usually new: it avoids that initial lookup and
recovers from a concurrent UNIQUE collision by fetching the winning row. Both forms
preserve other builder constraints when fetching an existing row.

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
await user.updateQuietly({ name: "Imported name" });
await user.deleteQuietly();
await user.forceDeleteQuietly();
await user.restoreQuietly();
await User.createMany(records, { events: false });
await User.saveMany(models, { events: false });
model.save({ events: false });
```

### `forceCreate` / `truncate` / `withoutTimestamps`

```ts
await User.forceCreate({ name: "Root", internal_flag: true });

// Keep a trusted write on an explicitly selected tenant / database connection.
await User.on(tenantConnection).forceCreate({
  name: "Tenant root",
  internal_flag: true,
});

await User.truncate();   // wipe the table

await User.withoutTimestamps(async () => {
  await User.create({ name: "No Timestamp" });   // timestamps not set
  await user.save();                              // updated_at unchanged
});
```

`forceCreate()` bypasses `fillable` / `guarded`, but it is otherwise a normal
model save: casts and backed enums are validated, UUIDs and timestamps are
generated, observers run, and save options such as `{ events: false }` are
honored. The builder form requires a model-backed builder (`User.query()` or
`User.on(connection)`); a raw `new Builder(connection, table)` has no model to
instantiate and throws before writing.

## Bulk operations

Bulk input methods apply fillable rules, casts, timestamps, and UUID key generation
automatically. `saveMany()` receives model instances, so it persists their existing
trusted attributes; `createMany()` still filters its input while constructing them.

### `insert` / `insertOrIgnore` / `upsert`

```ts
// Bulk insert; registered observers trigger per-row saves unless events is false
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

`User.insert()`, `User.insertGetId()` and `User.insertOrIgnore()` set `created_at`
and `updated_at` on every row that leaves them out. `upsert()`, on the model or
on `User.query()`, does the same for the rows it inserts, and sets `updated_at`
on the rows it updates even when `updateColumns` does not list it; `created_at`
is never overwritten. A value you pass is kept. `User.query().insert()`,
`insertGetId()` and `insertOrIgnore()` are the raw path and set no timestamps.

### `createMany` / `saveMany`

`createMany()` and `saveMany()` fire model events by default. `Model.insert()` also fires them when observers are registered; pass `{ events: false }` to force the unconditional bulk path. That bulk path uses chunks of 100 unless `chunkSize` is explicit.

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

const fetched = await User.findOrFail(created.id);
fetched.$wasRecentlyCreated;  // false
```

### `getKey` / `getKeyName` / `getAttributes`

Read the primary key without hard-coding its name, or take the raw attribute
bag:

```ts
user.getKeyName();    // "id" — whatever static primaryKey says
user.getKey();        // 1

user.getAttributes(); // { id: 1, name: "Alice", settings: '{"theme":"dark"}' }
```

`getAttributes()` returns stored values, not cast ones: a `json` column comes
back as its string, a `boolean` as `1`. It is a copy, so editing it never
reaches the model — use `setAttribute()` for that.

### `wasChanged` / `getChanges`

Inspect which attributes changed in the last `save()`:

```ts
user.setAttribute("name", "Updated");
await user.save();

user.wasChanged();        // true
user.wasChanged("name");  // true
user.wasChanged(["email", "name"]); // true if either changed
user.wasChanged("email"); // false
user.getChanges();        // { name: "Updated" }
```

### `discardChanges` / `syncOriginal`

`discardChanges()` rolls the in-memory attributes back to the current baseline
and forgets the pending edits. The row is never touched:

```ts
user.setAttribute("name", "Pending");
user.isDirty();           // true

user.discardChanges();
user.getAttribute("name") // the value the baseline holds
user.isDirty();           // false
user.getChanges();        // {}
```

Values decoded by a `json`, `date`, `datetime`, or `timestamp` cast are rebuilt
from the restored attributes, so an edit made in place is discarded too.

That baseline is whatever the model last accepted as original — normally the
last `save()`, but `syncOriginal()` moves it without writing anything:

```ts
user.forceFill(rowFromSomewhereElse);
user.syncOriginal();
user.isDirty();           // false — this is the baseline now

user.discardChanges();    // rolls back to rowFromSomewhereElse, not to the row
```

In-place edits to a `json`, `date`, `datetime`, or `timestamp` cast are folded
into the baseline too, so `syncOriginal()` sees a mutated object the same way
`save()` does.

### `isDirty` / `isClean` / `getDirty`

In-memory attributes that haven't been saved yet:

```ts
user.setAttribute("name", "Pending");
user.isDirty();           // true
user.isDirty("name");     // true
user.isClean(["email", "phone"]); // true if neither is dirty
user.isClean();           // false
user.getDirty();          // { name: "Pending" }

await user.save();
user.isDirty();           // false
user.isClean();           // true
```

Assigning the value an attribute already has leaves it clean, even when the
database handed it back in another form. Under a built-in cast both sides are
compared as the cast reads them: `true` and `1` for `boolean`, `12.5` and
`"12.50"` for `decimal:2`, and a JSON object whatever the order of its keys.
Without a cast, `5` and `"5"` compare equal (PostgreSQL returns a `BIGINT` as
text), and so do two buffers with the same bytes. So filling a model with an
unchanged form writes nothing.

### `is` / `isNot`

Compare two instances with non-null primary keys by table, resolved connection,
and primary key:

```ts
const a = await User.findOrFail(1);
const b = await User.findOrFail(1);
a.is(b);                  // true
a.isNot(b);               // false
```

Models from different tenant connections never compare equal, even when their
table and primary key match. Two unsaved models without a primary key do not
compare equal.

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

Dates come out as ISO strings, not `Date` objects:

```ts
user.toJSON().created_at;   // "2026-08-20T10:11:12.000Z"
user.toJSON().birthday;     // "1990-05-17" — a `date` cast emits the day alone
user.created_at;            // Date — reading the attribute is unchanged
```

`toJSON()`, `json()` and `rawJson()` agree on this. The bytes
`JSON.stringify()` produces are the same as before, since it serialized those
`Date` objects to the same text; what changed is what you get when you inspect
the object without serializing it.

### Direct query JSON

`Builder.json()` always hydrates models and preserves their complete instance
semantics. `Builder.rawJson()` is the explicit direct-row alternative:

```ts
class User extends Model {
  static override casts = { active: "boolean" };
  static override hidden = ["password"];
}

const payload = await User.select("id", "name", "active").orderBy("id").rawJson();
```

Direct queries preserve built-in casts, implicit timestamp casts, backed-enum
validation, static defaults, `hidden` / `visible`, aliases, aggregates,
ordering, query caching, recursive decorations, and the builder's resolved
tenant connection. The result is a plain `Array` whose `DirectJson` type contains
selected attributes plus query-added aggregates; it does not advertise appends
or unloaded relations.

`rawJson()` always omits `appends` and ignores an active Identity Map. It throws
instead of silently hydrating when the query has eager loads, an output key has
an accessor or custom cast, or the model overrides `hydrate()`, `toJSON()`,
`json()`, `serialize()`, or `setConnection()`. Accessors and custom casts on
unselected or hidden keys do not block the query.

Constructor-installed behavior cannot be detected from static metadata.
`rawJson()` deliberately does not run it; use `json()` when constructor or other
instance behavior matters.

These forms always retain their existing semantics:

```ts
const users = await User.select("id", "name", "active").get();
users.each((user) => user.makeHidden("internal_note"));
const instancePayload = users.json(); // serializes these exact model instances

const rows = (await DB.table<UserRow>("users").get()).toArray();
// Raw rows: no model casts, visibility, accessors, or constructors.
```

Instance `json()`, `toJSON()`, `JSON.stringify(model)`, collection serialization,
and `Builder.json()` always use hydrated models.

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
getter is a real TypeScript member, no separate `declare` or ORM-specific
accessor is needed:

```ts
class User extends Model {
  static override appends = ["fullName"];

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

user.setAppends(["initials"]);    // replace instance appends; static appends remain
user.getAppends();                // ["fullName", "initials"]
```

`setAppends()` replaces only appends previously added to that instance. The
model's `static appends` remain the baseline, and `getAppends()` returns the
deduplicated combination of both lists.

Visibility is applied before a getter runs, and a getter is evaluated at most
once per serialization. Its result is never written to `$attributes`, marked
dirty, or included in SQL. `static accessors` remains supported for persisted
attribute getters and setters; if both mechanisms use the same name, the static
accessor takes precedence.

## Soft deletes

Set `static softDeletes = true` and add a `deleted_at` column (`table.softDeletes()` in [Schema Builder](./schema-builder.md#convenience-helpers)):

```ts
class User extends Model {
  static override softDeletes = true;
}

await user.delete();         // sets deleted_at — row stays in DB
await user.restore();        // clears deleted_at; fires restoring / restored
await user.restoreQuietly(); // same, without observers
await user.forceDelete();    // permanently removes the row; fires deleting / deleted
await user.forceDeleteQuietly(); // same, without observers

await User.all();                       // excludes trashed
await User.withTrashed().get();         // includes trashed
await User.withTrashed().withoutTrashed().get(); // excludes them again
await User.onlyTrashed().get();         // only trashed
await User.onlyTrashed().restore();     // restore everything trashed

await User.where("inactive", true).delete();          // bulk soft delete
await User.onlyTrashed().where("inactive", true).forceDelete(); // bulk permanent delete
```

A soft delete or a restore also sets `updated_at` to the current time, as in
Eloquent, so a sync that reads rows changed since a checkpoint also sees the
ones that were deleted or came back:

```ts
const changed = await User.withTrashed().where("updated_at", ">", lastSync).get();
```

A query-level `restore()` only touches rows that are trashed, so rows that were
never deleted keep their `updated_at`. Inside `withoutTimestamps()`, and on a
model with `timestamps = false`, only `deleted_at` changes.

Override `deletedAtColumn` when the schema uses another name, and pass the same
name to the migration helper:

```ts
class User extends Model {
  static override softDeletes = true;
  static override deletedAtColumn = "deletedAt";
}

table.softDeletes("deletedAt");
```

## Scopes

### Local scopes

Static methods named `scope{Name}` register a chainable scope:

```ts
import type { Builder } from "@rekkr/orm";

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
  static override touches = ["author"];

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
- [TypeScript](./typescript.md) — how attribute types flow through models and queries.
