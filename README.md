# ORM

> **Runs on Bun and Node.js.** Install with:
>
> ```bash
> bun add github:rekkrjs/orm#v5.0.0                         # Bun
> npm install --allow-git=all github:rekkrjs/orm#v5.0.0     # Node.js 24.21+
> ```
>
> The package is installed directly from its public GitHub repository. On
> Node.js, add `pg`, `mysql2` or `ioredis` for the servers you use — see
> [Installation](./docs/installation.md).

An **Eloquent-inspired ORM** for [Bun](https://bun.com) and [Node.js](https://nodejs.org). On Bun it runs on the native `bun:sql` client with **zero runtime dependencies**; on Node.js it runs on the built-in `node:sqlite` and the standard `pg`, `mysql2` and `ioredis` drivers. It supports **SQLite**, **MySQL**, and **PostgreSQL** with full TypeScript typing, a chainable query builder, schema migrations, model observers, polymorphic relations, and an interactive REPL.

---

## Features

- 🔥 **Bun-native, Node.js-ready** — `bun:sql` on Bun; `node:sqlite`, `pg` and `mysql2` on Node.js, held to the same results by one test suite
- 🪶 **Zero runtime dependencies** — On Bun, nothing beyond Bun itself; on Node.js, only the drivers for the databases you use
- 📦 **Multi-database** — SQLite, MySQL, and PostgreSQL support
- 🧯 **Portable unique errors** — Duplicate unique and primary keys share one safe public error type across drivers
- 🔷 **Fully Typed** — Generate declarations for plain `extends Model` classes with typed attributes, queries, relations, and eager loads
- 🏗️ **Schema Builder** — Programmatic table creation, indexes, foreign keys
- 🔍 **Query Builder** — Chainable joins, unions, relation and pivot shortcuts, SQL diagnostics, and Laravel-style aliases
- ⚡ **Predictable direct JSON** — `rawJson()` skips per-row hydration or reports why it cannot
- 🔎 **Search** — PostgreSQL full-text search and SQLite FTS5 engines, no search service to run
- 🧠 **Tagged Cache** — Redis-backed cache facade, query `remember()`, and exact tag invalidation
- 📣 **Events** — Application-level event dispatcher with function listeners and class handlers
- 📨 **Queue Jobs** — Database- and Redis-backed background job queue with named queues, retries, delays, and an `orm queue` worker
- 🛠️ **Commands** — Artisan-style CLI commands with a signature DSL, argument/option parsing, and `orm run`
- 🧬 **Eloquent-style Models** — Property attributes, casts, scopes, soft deletes, and concurrency-safe find-or-create helpers
- 🧺 **Collections** — Laravel-style paging, filtering, partitioning, strict matching, and aggregation helpers
- 🔗 **Relations** — Standard, many-to-many, polymorphic, through, one-of-many, and relation queries
- 👁️ **Observers** — Lifecycle hooks (`creating`, `created`, `updating`, `updated`, etc.)
- 🚀 **Migrations & CLI** — Create, run, reset, refresh, and inspect migrations from the command line
- 🌱 **Seeders & Factories** — Root or targeted seeders plus typed factories for bulk data and relationship graphs
- 💬 **REPL** — Inspect models and run queries interactively with `orm repl`
- ⚡ **Streaming** — `chunk`, `chunkById`, `cursor`, `each`, `eachById`, and `lazy` for memory-efficient large dataset processing
- 🏢 **Multi-tenant** — Database-per-tenant, schema-per-tenant, and RLS strategies with `DB.tenant()` and `TenantContext`

---

## Installation

```bash
bun add github:rekkrjs/orm#v5.0.0                         # Bun
npm install --allow-git=all github:rekkrjs/orm#v5.0.0     # Node.js 24.21+
npm install pg                                            # Node.js + PostgreSQL
```

See [Installation](./docs/installation.md) for the driver each database needs and
what differs between the runtimes.

---

## Quickstart

Extend `Model` directly. Table names follow conventions (`User` → `users`),
while `fillable` controls which attributes may be mass-assigned:

```ts
import { Model } from "@rekkr/orm";

class User extends Model {
  static override fillable = ["name", "email"];
  static override softDeletes = true;

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

Create the `users` and `posts` tables with default timestamp names and a
foreign key between them:

```ts
// database/migrations/<timestamp>_create_blog_tables.ts
import { Migration, Schema } from "@rekkr/orm";

export default class CreateBlogTables extends Migration {
  async up() {
    await Schema.create("users", (table) => {
      table.id();
      table.string("name");
      table.string("email").unique();
      table.string("role").default("member");
      table.string("locale", 10).default("en");
      table.timestamp("email_verified_at").nullable();
      table.timestamps();
      table.softDeletes();
    });

    await Schema.create("posts", (table) => {
      table.id();
      table.foreignId("user_id").constrained("users").cascadeOnDelete();
      table.string("title");
      table.text("body").nullable();
      table.boolean("published").default(false);
      table.timestamp("published_at").nullable();
      table.timestamps();
      table.index(["user_id", "created_at"]);
    });
  }

  async down() {
    await Schema.dropIfExists("posts");
    await Schema.dropIfExists("users");
  }
}
```

See [Models: timestamps](./docs/models.md#timestamps) for custom column names,
including a camelCase model and matching schema.

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

Use the canonical migration commands for generation, dry runs, and seeded rebuilds:

```bash
orm make:migration create_blog_tables
orm migrate --pretend
orm migrate:rollback --step=2 --pretend
orm migrate:refresh --seed
orm migrate:fresh --seed
orm migrate:fresh --seed --seeder=UserSeeder
```

`--landlord`, `--tenants`, and `--tenant` apply to both phases. In production,
mutating migration commands require confirmation or `--force`; status and
pretend runs never prompt, and pretend does not execute SQL. Migration locking
is automatic, so there is no `--isolated` flag. With `--json`, stdout remains
one document.

---

## Documentation

### Getting Started

| Topic | Summary |
|---|---|
| [Installation](./docs/installation.md) | Add the package to a Bun or Node.js project. |
| [Configuration](./docs/configuration.md) | Connection, tenancy, migrations, seeders, type generation. |
| [Quickstart](./docs/quickstart.md) | End-to-end walkthrough: install → config → migration → model → query. |

### Database

| Topic | Summary |
|---|---|
| [Schema Builder](./docs/schema-builder.md) | Tables, columns, indexes, foreign keys. |
| [Migrations](./docs/migrations.md) | Versioned schema changes, rollback, multi-tenant scopes, auto-create database / schema. |
| [Seeders](./docs/seeders.md) | Populate development and test data. |
| [Transactions](./docs/transactions.md) | `DB.transaction()`, explicit connection transactions, and nested savepoints. |

### Querying

| Topic | Summary |
|---|---|
| [Query Builder](./docs/query-builder.md) | Chainable `where` / `join` / `with` / aggregates, `DB` facade, raw queries. |
| [Cache](./docs/cache.md) | Redis-backed cache API, query `remember()`, exact tag invalidation. |
| [Search](./docs/search.md) | PostgreSQL full-text search and SQLite FTS5. |
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

Performance and verification: [benchmark history](./benchmarks/README.md).
