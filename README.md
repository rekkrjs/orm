# ORM

> **Bun-only package.** Install with:
>
> ```bash
> bun add git+ssh://git@github.com/rekkrjs/orm.git#v1.3.1
> ```
>
> The repository is private, so GitHub read access and SSH authentication are
> required. npm, yarn, pnpm, and Node.js runtime usage are not supported.

An **Eloquent-inspired ORM** built specifically for [Bun](https://bun.com)'s native `bun:sql` client. It ships with **zero runtime dependencies** and supports **SQLite**, **MySQL**, and **PostgreSQL** with full TypeScript typing, a chainable query builder, schema migrations, model observers, polymorphic relations, and an interactive REPL.

---

## Features

- 🔥 **Bun-native** — Built directly on top of `bun:sql`
- 🪶 **Zero runtime dependencies** — No package lock-in beyond Bun itself
- 📦 **Multi-database** — SQLite, MySQL, and PostgreSQL support
- 🧯 **Portable unique errors** — Duplicate unique and primary keys share one safe public error type across drivers
- 🔷 **Fully Typed** — Generate declarations for plain `extends Model` classes with typed attributes, queries, relations, and eager loads
- 🏗️ **Schema Builder** — Programmatic table creation, indexes, foreign keys
- 🔍 **Query Builder** — Chainable `where`, `join`, `orderBy`, `groupBy`, date filters, conditional building, etc.
- ⚡ **Fast direct JSON** — Opted-in compatible model queries avoid per-row hydration
- 🔎 **Search** — Meilisearch, PostgreSQL full-text search, and SQLite FTS5 engines
- 🧠 **Tagged Cache** — Redis-backed cache facade, query `remember()`, and exact tag invalidation
- 📣 **Events** — Application-level event dispatcher with function listeners and class handlers
- 📨 **Queue Jobs** — Database- and Redis-backed background job queue with named queues, retries, delays, and an `orm queue` worker
- 🛠️ **Commands** — Artisan-style CLI commands with a signature DSL, argument/option parsing, and `orm run`
- 🧬 **Eloquent-style Models** — Property attributes, defaults, casts, dirty tracking, soft deletes, scopes, find-or-fail, first-or-create
- 🧺 **Collections** — Laravel-style helpers for multi-record query results
- 🔗 **Relations** — Standard, many-to-many, polymorphic, through, one-of-many, and relation queries
- 👁️ **Observers** — Lifecycle hooks (`creating`, `created`, `updating`, `updated`, etc.)
- 🚀 **Migrations & CLI** — Create, run, reset, refresh, and inspect migrations from the command line
- 🌱 **Seeders & Factories** — Run all seeders or target one seeder by name/file, plus lightweight model factories
- 💬 **REPL** — Inspect models and run queries interactively with `orm repl`
- ⚡ **Streaming** — `chunk`, `chunkById`, `cursor`, `each`, `eachById`, and `lazy` for memory-efficient large dataset processing
- 🏢 **Multi-tenant** — Database-per-tenant, schema-per-tenant, and RLS strategies with `DB.tenant()` and `TenantContext`

---

## Installation

```bash
bun add git+ssh://git@github.com/rekkrjs/orm.git#v1.3.1
```

See [Installation](./docs/installation.md) for details.

---

## Quickstart

Extend `Model` directly. Table names follow conventions (`User` → `users`),
while `fillable` controls which attributes may be mass-assigned:

```ts
import { Model } from "@rekkr/orm";

class User extends Model {
  static override fillable = ["name", "email"];

  posts() {
    return this.hasMany(Post);
  }
}

class Post extends Model {
  static override fillable = ["user_id", "title"];

  author() {
    return this.belongsTo(User);
  }
}
```

Tables with camelCase timestamps can configure the model and migration directly:

```ts
import { Model, Schema } from "@rekkr/orm";

class CamelUser extends Model {
  static override fillable = ["name"];
  static override createdAtColumn = "createdAt";
  static override updatedAtColumn = "updatedAt";
}

await Schema.create("camel_users", (table) => {
  table.increments("id");
  table.string("name");
  table.timestamps("createdAt", "updatedAt");
});
```

Native getters can be serialized with `appends` without duplicating them in
`static accessors`:

```ts
class User extends Model {
  static override fillable = ["firstName", "lastName"];
  static override appends = ["fullName"];

  get fullName(): string {
    return `${this.getAttribute("firstName")} ${this.getAttribute("lastName")}`.trim();
  }
}
```

Create the shared configuration used by both the CLI and your application:

```ts
// orm.config.ts
import type { OrmConfig } from "@rekkr/orm";

const config: OrmConfig = {
  connection: { url: "sqlite://app.db" },
};

export default config;
```

Configure ORM once at application startup, then query your models:

```ts
import { configureOrm } from "@rekkr/orm";
import config from "./orm.config";

configureOrm(config);

const user = await User.where("email", "alice@example.com").firstOrFail();
const posts = await user.posts().get();

console.log(user.getAttribute("name"), posts.length);
```

Or use the `DB` facade for ad-hoc table access without a model:

```ts
import { DB } from "@rekkr/orm";

const rows = await DB.table("audit_logs")
  .where("event", "login")
  .orderBy("created_at", "desc")
  .limit(10)
  .get();
```

See the [Quickstart guide](./docs/quickstart.md) for the full walkthrough.

---

## Documentation

### Getting Started

| Topic | Summary |
|---|---|
| [Installation](./docs/installation.md) | Add the package to your Bun project. |
| [Configuration](./docs/configuration.md) | Connection, tenancy, migrations, seeders, type generation. |
| [Quickstart](./docs/quickstart.md) | End-to-end walkthrough: install → config → migration → model → query. |

### Database

| Topic | Summary |
|---|---|
| [Schema Builder](./docs/schema-builder.md) | Tables, columns, indexes, foreign keys. |
| [Migrations](./docs/migrations.md) | Versioned schema changes, rollback, multi-tenant scopes, auto-create database / schema. |
| [Seeders](./docs/seeders.md) | Populate development and test data. |
| [Transactions](./docs/transactions.md) | `connection.transaction()` and nested savepoints. |

### Querying

| Topic | Summary |
|---|---|
| [Query Builder](./docs/query-builder.md) | Chainable `where` / `join` / `with` / aggregates, `DB` facade, raw queries. |
| [Cache](./docs/cache.md) | Redis-backed cache API, query `remember()`, exact tag invalidation. |
| [Search](./docs/search.md) | Meilisearch, PostgreSQL full-text search, and SQLite FTS5. |
| [Collections](./docs/collections.md) | `map`, `filter`, `groupBy`, and other helpers returned by `get()`. |
| [Models](./docs/models.md) | Defining models, casts, accessors, soft deletes, persistence. |
| [Relationships](./docs/relationships.md) | `hasMany`, `belongsTo`, `belongsToMany`, polymorphic, eager loading. |
| [Validation](./docs/validation.md) | Typed Laravel-style validator with fluent rules and tenant-aware database checks. |

### TypeScript

| Topic | Summary |
|---|---|
| [TypeScript](./docs/typescript.md) | Plain model declarations, generated attributes, typed builders, scopes, and accessors. |
| [Type Generation](./docs/type-generation.md) | Generate attribute interfaces from your database schema. |

### Background Processing

| Topic | Summary |
|---|---|
| [Queue Jobs](./docs/queue.md) | Dispatch jobs to named queues, run workers with `orm queue`, retries, delays, failed-job tracking, database and Redis drivers. |
| [Commands](./docs/commands.md) | Artisan-style CLI commands with signature DSL, argument/option parsing, output helpers, and `orm run`. |

### Advanced

| Topic | Summary |
|---|---|
| [SvelteKit Helper](./docs/sveltekit.md) | Typed route model binding and action validation helpers for `+page.server.ts`. |
| [Policies](./docs/policies.md) | Register model/resource policies, use `can` / `authorize`, and enforce access in RouteBuilder. |
| [Observers](./docs/observers.md) | Lifecycle hooks for `creating`, `updating`, `deleting`, and more. |
| [Events](./docs/events.md) | Application-level events with function listeners, class handlers, and temporary subscriptions. |
| [Library Usage](./docs/library-usage.md) | Programmatic API via `configureOrm()`. |
| [Testing](./docs/testing.md) | In-memory SQLite and transactional test isolation. |

The full index lives at [docs/README.md](./docs/README.md).

---

## License

MIT

> This project is a fork of [Bunny](https://github.com/bunnykit/orm).
