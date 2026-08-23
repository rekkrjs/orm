# Migrations

Migrations are versioned, ordered scripts that change your database schema. They go beside your code in git, run in lockstep with deploys, and roll back cleanly when something goes wrong. ORM's migrator handles ordering, batching, locking, multi-tenant fan-out, and (optionally) auto-creates missing databases and schemas before running.

```ts
import { Migration, Migrator, Schema } from "@rekkr/orm";
```

See [Schema Builder](./schema-builder.md) for the full vocabulary you use inside migration bodies.

## Anatomy of a migration

A migration is a class extending `Migration` with `up()` and `down()` methods. `up()` applies the change; `down()` reverses it. Both are async.

```ts
// database/migrations/20260101000000_create_blog_tables.ts
import { Migration, Schema } from "@rekkr/orm";

export default class CreateBlogTables extends Migration {
  async up() {
    await Schema.create("users", (table) => {
      table.id();
      table.string("name");
      table.string("email").unique();
      table.timestamps();
    });

    await Schema.create("posts", (table) => {
      table.id();
      table.foreignId("author_id").constrained("users").cascadeOnDelete();
      table.string("title");
      table.string("slug").unique();
      table.text("body");
      table.timestamp("published_at").nullable();
      table.timestamps();
    });

    await Schema.create("comments", (table) => {
      table.id();
      table.foreignId("post_id").constrained().cascadeOnDelete();
      table.foreignId("author_id").nullable().constrained("users").nullOnDelete();
      table.text("body");
      table.timestamps();
      table.index(["post_id", "created_at"]);
    });
  }

  async down() {
    await Schema.dropIfExists("comments");
    await Schema.dropIfExists("posts");
    await Schema.dropIfExists("users");
  }
}
```

Create referenced tables before their dependents and drop them in reverse order.
Call `nullable()` before `constrained()` when a `nullOnDelete()` foreign key must
accept `NULL`.

Scaffold a new file with the CLI:

```bash
bunx orm migrate:make CreateBlogTables
# → ./database/migrations/20260101000000_create_blog_tables.ts

bunx orm migrate:make AddBioToUsers ./database/migrations
```

The timestamp prefix dictates run order, so always create new migrations via the CLI rather than hand-writing the filename.

## CLI commands

| Command | What it does |
|---|---|
| `orm migrate:make <Name> [dir]` | Scaffold a new migration file. |
| `orm migrate` | Run all pending migrations. |
| `orm migrate:rollback [--step=N]` | Reverse the last batch, or the last `N` batches. |
| `orm migrate:reset` | Roll back every migration. |
| `orm migrate:refresh` | `reset` + `migrate`. |
| `orm migrate:fresh` | Drop every table + `migrate`. |
| `orm migrate:status` | Report of ran / pending migrations, with the batch each ran in. |
| `orm schema:dump <path>` | Dump current schema to a SQL file. |
| `orm schema:squash <path>` | Dump schema *and* mark configured migrations as ran. |

Each command honors `migrationsPath` (single path) or `migrations.landlord` / `migrations.tenant` (grouped) from `orm.config.ts`. See [Configuration](./configuration.md#migrationspath-vs-migrations).

### `--config <path>`

A global flag, valid before any command, that loads a specific config module
instead of looking for `./orm.config.ts`:

```bash
orm --config config/database.ts migrate
```

Use it when the application already owns its database configuration and you do
not want a second source of truth for the connection. The module is imported and
its `default` export (or the module itself) is used as the config.

### `--types`

Type generation does **not** run after migrations by default. Pass `--types` to regenerate model type declarations once the migration finishes:

```bash
orm migrate --types
orm migrate:fresh --types
orm migrate:rollback --types
orm migrate:refresh --types
orm migrate:reset --types
```

Without the flag the schema changes apply but no types are emitted — keeping plain `migrate` fast and side-effect-free. Use `--types` in development (or a post-migrate step) when you want declarations refreshed. See [Type Generation](./type-generation.md).

### `--json`

For scripts and tools driving the CLI. Every migration command accepts it, and
the contract is the same in all of them:

- **stdout carries one JSON document and nothing else.** Not just the ORM's own
  progress: output through `console`, `process.stdout` or `Bun.stdout` — including
  late callbacks registered by a migration or config module — is relayed to
  stderr until the CLI process exits, so `JSON.parse(stdout)` cannot be broken by
  application output.
- Progress (`Migrating: …`, `Nothing to migrate.`, `Tenant: …`) goes to stderr,
  and so do warnings — those go to stderr in plain text mode too.
- Paths are relative to the directory the command ran in.
- The key for the command is always present, empty or not — `{"applied":[]}`
  means "nothing to migrate", never "something went wrong".

```bash
$ orm migrate --json
{"applied":["database/migrations/20260101000000_create_users_table.ts"]}

$ orm migrate:rollback --step=2 --json
{"rolledBack":["database/migrations/20260101000000_create_users_table.ts"]}

$ orm migrate:status --json
{"migrations":[{"migration":"database/migrations/20260101000000_create_users_table.ts","status":"Ran","tenant":null,"batch":1,"checksum":"…","storedChecksum":"…"}]}
```

`status` is `Pending`, `Ran` or `Changed`. `migrate:refresh` emits both keys
(`{"rolledBack":[…],"applied":[…]}`), `migrate:reset` emits `rolledBack`, and
`migrate:fresh` emits `applied`.

A failing command writes its error — and any usage help — to stderr and exits
non-zero, so stdout stays parseable or empty. Under `--tenants`, one document
covers the whole run rather than one per tenant.

### `--step=N`

`rollback` reverses one batch by default. `--step=N` reverses the last `N`
batches, in reverse order of application:

```bash
orm migrate:rollback --step=2
```

`--steps=` is accepted as an alias. Anything that is not a positive whole number
is rejected before the database is touched.

### `--allow-changed`

`migrate` refuses to run when a migration file's checksum no longer matches what
was recorded for it, because such a file is neither pending nor faithfully
applied:

```console
$ orm migrate
 Error: 1 migration file has changed since it ran: database/migrations/20260101000000_create_users_table.ts. …
$ echo $?
1
```

Pass `--allow-changed` to migrate whatever else is pending and leave the changed
files alone; the warning still goes to stderr. The clean fix is to roll the
migration back and re-apply it, or to add a new migration.

## Batches and `migrations` table

ORM records every applied migration in a `migrations` table (auto-created on first run). The table tracks:

- `migration` — the file name.
- `tenant` — the tenant id, or `null` for landlord migrations.
- `checksum` — used to detect file content drift.
- `batch` — incremented per `migrate` run.

`rollback` reverses one batch at a time. If your last `migrate` ran three new migrations, the next `rollback` reverses all three together. `migrate:status` reports the batch of every applied migration (`null` while pending), so you can see what a `--step=N` rollback is about to undo before running it.

## Auto-create database and schema

When the target database or schema does not exist yet, the migrator can create them automatically:

```ts
// orm.config.ts
export default {
  connection: { url: process.env.DATABASE_URL! },
  migrations: {
    landlord: "./database/migrations",
    tenant: "./database/tenant-migrations",
    createIfMissing: { database: true, schema: true },
  },
};
```

Driver behavior:

- **Postgres** — connects to the `postgres` admin database, checks `pg_database`, runs `CREATE DATABASE` if missing. Schemas use `CREATE SCHEMA IF NOT EXISTS`.
- **MySQL** — `CREATE DATABASE IF NOT EXISTS` via the `mysql` admin database. No schemas.
- **SQLite** — the file is created by Bun on connect. Both flags are no-ops.

The shortcut `createIfMissing: true` enables both. For granular control use the object form. Idempotent — existing targets are left alone.

Inside `DB.tenant()`, the migrator picks up the tenant's qualified connection automatically, so a missing tenant schema is created before tenant migrations run:

```ts
await DB.tenant("acme", () => orm.migrate("tenant"));
// → creates schema "tenant_acme" if absent, then runs tenant migrations under it
```

## Multi-tenant scopes

For apps with separate landlord and tenant migrations, group them:

```ts
// orm.config.ts
export default {
  connection: { url: process.env.LANDLORD_DATABASE_URL! },
  migrations: {
    landlord: ["./database/landlord-migrations", "./modules/billing/migrations"],
    tenant:   ["./database/tenant-migrations",  "./modules/tenant-features/migrations"],
    createIfMissing: { database: true, schema: true },
  },
  tenancy: {
    resolveTenant: async (tenantId) => ({
      strategy: "database",
      name: `tenant:${tenantId}`,
      config: await getTenantConnectionConfig(tenantId),
    }),
    listTenants: async () => await getAllTenantIds(),
  },
};
```

With grouped migrations, `orm migrate` runs landlord migrations first, then tenant migrations for every tenant returned by `listTenants()`. Rollbacks run in reverse — tenants first, then landlord.

Target individual scopes from the CLI:

```bash
orm migrate                       # default: landlord then all tenants
orm migrate --landlord
orm migrate --tenants
orm migrate --tenant acme
orm migrate:rollback --tenant acme
orm migrate:refresh --tenant acme
orm migrate:fresh   --tenant acme
orm migrate:status  --tenant acme
```

See [Configuration — Tenancy](./configuration.md#tenancy) for resolver setup.

## Programmatic use

### `configureOrm()` facade (recommended)

```ts
import { configureOrm } from "@rekkr/orm";
import config from "../orm.config";

const orm = configureOrm(config);

await orm.migrate();              // landlord
await orm.migrate("tenant");      // tenant scope
await orm.migrate("landlord", { createIfMissing: true });
await orm.rollback(2);
await orm.fresh();
```

See [Library Usage](./library-usage.md) for the full facade reference.

### `Migrator` directly

```ts
import { Migrator } from "@rekkr/orm";

const migrator = new Migrator(connection, "./database/migrations");

await migrator.run();
await migrator.rollback(2);
await migrator.reset();
await migrator.refresh();
await migrator.fresh();

// Result-returning variants for tooling; the original methods remain Promise<void>.
const applied    = await migrator.runWithResult();
const rolledBack = await migrator.rollbackWithResult(2);
await migrator.resetWithResult();   // string[]
await migrator.refreshWithResult(); // { rolledBack: string[]; applied: string[] }
await migrator.freshWithResult();   // string[]
const status = await migrator.status(); // includes `batch` per row

await migrator.dumpSchema("./database/schema.sql");
await migrator.squash("./database/schema.sql");
```

`squash()` writes the schema dump and marks the configured migration files as already ran — useful for collapsing dozens of historical migrations into a single baseline.

## Migration events

```ts
import { Migrator } from "@rekkr/orm";

Migrator.on("migrating", ({ migration, batch }) => {
  console.log(`Starting ${migration} (batch ${batch})`);
});
Migrator.on("migrated", ({ migration }) => {
  console.log(`Finished ${migration}`);
});
```

Events: `migrating`, `migrated`, `rollingBack`, `rolledBack`, `schemaDumped`, `schemaSquashed`.

Use these to wire up structured logging, Slack notifications on production migrations, or CI checks.

## Locking

Migrations take a lock so concurrent deploys don't double-apply. How it is held
depends on the driver:

| Driver | Mechanism | Released when the process dies |
|---|---|---|
| PostgreSQL | `pg_advisory_lock` on a dedicated connection | Yes — the server drops it with the session |
| MySQL | `GET_LOCK` on a dedicated connection | Yes — the server drops it with the session |
| SQLite | Row in `migration_locks` | Best effort on `SIGINT` / `SIGTERM` / `SIGHUP`, otherwise taken over once the row is older than `lockMaxAgeMs` |

On PostgreSQL and MySQL the lock lives on its own connection, separate from the
pool the migrations run on, so a crashed or `kill -9`'d deploy releases it as
soon as the socket closes. Nothing is left in the database to clean up.

SQLite has no advisory locks, so it falls back to a row in `migration_locks`.
That row is deleted on completion and on a normal termination signal, but a
`kill -9` leaves it behind — which is what `lockMaxAgeMs` is for: once the row is
older than that, the next migrator takes it over. Raise it above the runtime of
your slowest migration so a long-running deploy never has its lock stolen.

```ts
new Migrator(connection, path, undefined, {}, {
  lock: true,
  lockTimeoutMs: 60_000,   // how long to wait for a busy lock (default 30s)
  lockMaxAgeMs: 900_000,   // SQLite only: orphan takeover age (default 15 min)
});
```

Set `lock: false` only in development — never on production deploys.

## Auto type generation

If `typesOutDir` is set in your config, attribute interface declarations are regenerated automatically after every `migrate` and `migrate:rollback`. With `modelsPath`, ORM writes a `types/` directory beside each model root:

```bash
bunx orm migrate
# → Migrated: 20260101000000_create_users_table.ts
# → Regenerated types in ./src/models/types
```

See [Type Generation](./type-generation.md) for what is emitted and how IntelliSense picks it up.

## Common pitfalls

- **Editing a migration after it has run.** ORM stores a checksum per migration. Changing a file's contents after it has been applied breaks the assumption that `up()` already produced the recorded schema, so `migrate` stops and says which files drifted rather than reporting "Nothing to migrate." over a schema that no longer matches. Add a new migration instead, or pass `--allow-changed` to proceed deliberately.
- **Missing `down()`.** Tools and dev workflows assume `down()` is the inverse of `up()`. Skipping it makes `rollback` unsafe. If a change is truly irreversible, throw with a clear message inside `down()`.
- **Non-idempotent `up()`.** If `up()` calls `Schema.table()` to add a column that already exists (e.g. from a fresh dump-and-reload), the migration fails. Use `Schema.hasColumn()` guards in long-running projects.
- **Running migrations without `createIfMissing` on a fresh DB.** You'll see "database does not exist" / "schema does not exist" errors. Enable `createIfMissing` or create the target manually first.
- **`migrate:fresh` in production.** This drops every table. Lock it down to dev / staging — e.g. guard the CLI invocation with `NODE_ENV !== "production"`.

## Where to next

- [Schema Builder](./schema-builder.md) — the full set of column, index, and foreign key helpers you use inside `up()`.
- [Configuration](./configuration.md#migrationspath-vs-migrations) — how `migrationsPath` and `migrations.{landlord,tenant}` are resolved.
- [Library Usage](./library-usage.md) — running migrations from app code with the `configureOrm()` facade.
- [Type Generation](./type-generation.md) — what auto-regenerates after each migration.
