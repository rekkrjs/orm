# ORM Documentation

An Eloquent-inspired ORM for Bun with zero runtime dependencies, full TypeScript typing, and first-class multi-tenant support.

If you are new here, start with [Installation](./installation.md), then walk through the [Quickstart](./quickstart.md).

## Getting Started

| Topic | What you will learn |
|---|---|
| [Installation](./installation.md) | How to add `@rekkr/orm` to a Bun project. |
| [Configuration](./configuration.md) | Connection, tenancy, migrations, seeders, type generation, and runtime wiring. |
| [Quickstart](./quickstart.md) | End-to-end walkthrough: install → config → migration → model → query. |

## Database

| Topic | What you will learn |
|---|---|
| [Schema Builder](./schema-builder.md) | Define tables, columns, indexes, and foreign keys programmatically. |
| [Migrations](./migrations.md) | Versioned schema changes, batching, rollback, multi-tenant scopes, auto-create database / schema. |
| [Seeders](./seeders.md) | Populate development and test data with reproducible scripts. |
| [Transactions](./transactions.md) | `DB.transaction()`, explicit connection transactions, nested savepoints, and error handling. |

## Querying

| Topic | What you will learn |
|---|---|
| [Query Builder](./query-builder.md) | Chainable `where` / `join` / `with` / aggregates / pagination, the `DB` facade, raw queries. |
| [Cache](./cache.md) | Explicit Redis-backed caching, query `remember()`, exact tag invalidation. |
| [Search](./search.md) | Model indexing and search with Meilisearch, PostgreSQL full-text search, or SQLite FTS5. |
| [Collections](./collections.md) | `map`, `filter`, `groupBy`, `keyBy`, and other helpers returned by `get()`. |
| [Models](./models.md) | Defining models, casts, accessors / mutators, soft deletes, persistence, JSON serialization. |
| [Relationships](./relationships.md) | `hasMany`, `belongsTo`, `belongsToMany`, polymorphic relations, eager loading, pivot helpers. |
| [Validation](./validation.md) | Typed Laravel-style validator, fluent rules, transforms, and tenant-aware `unique` / `exists`. |

## TypeScript

| Topic | What you will learn |
|---|---|
| [TypeScript](./typescript.md) | `Model.define<T>()`, typed builders, scope typing, accessor typing. |
| [Type Generation](./type-generation.md) | Generate attribute interfaces and IntelliSense for your models from the database schema. |

## Background Processing

| Topic | What you will learn |
|---|---|
| [Queue Jobs](./queue.md) | Dispatch jobs to named queues, run workers with `orm queue`, retries, delays, failed-job tracking, database and Redis drivers. |
| [Commands](./commands.md) | Define and run CLI commands with `orm run`, signature DSL, argument/option parsing, output helpers. |

## Advanced

| Topic | What you will learn |
|---|---|
| [SvelteKit Helper](./sveltekit.md) | Typed route model binding and action validation helpers for `+page.server.ts`. |
| [Policies](./policies.md) | Register model/resource policies, use `can` / `authorize`, and enforce access in RouteBuilder. |
| [Observers](./observers.md) | Lifecycle hooks for `creating`, `created`, `updating`, `deleting`, and more. |
| [Events](./events.md) | Application-level events with function listeners, class handlers, and temporary subscriptions. |
| [Library Usage](./library-usage.md) | Run migrations and seeders programmatically from app code using the `configureOrm()` facade. |
| [Testing](./testing.md) | In-memory SQLite, transactional test isolation, integration patterns. |

- [Upgrading to v3](./upgrade-3.0.md) — breaking contracts, migration and deployment.
