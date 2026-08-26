# Configuration

ORM is configured through a single `OrmConfig` object — typically exported from `orm.config.ts` at your project root. The same file is read by the CLI (`bunx orm migrate`, etc.) and by the `configureOrm()` runtime facade your application calls at startup.

## The minimum config

```ts
// orm.config.ts
export default {
  connection: { url: "sqlite://app.db" },
  migrationsPath: "./database/migrations",
};
```

That is enough for a single-database app with file-based migrations. Everything else is optional.

## A representative config

```ts
// orm.config.ts
import type { OrmConfig } from "@rekkr/orm";

const config: OrmConfig = {
  connection: {
    url: process.env.DATABASE_URL!,
  },

  // Migrations
  migrations: {
    landlord: "./database/landlord-migrations",
    tenant: "./database/tenant-migrations",
    createIfMissing: { database: true, schema: true },
  },

  // Seeders
  seedersPath: "./database/seeders",

  // Tenancy
  tenancy: {
    resolveTenant: async (tenantId) => ({
      strategy: "schema",
      name: `tenant:${tenantId}`,
      schema: `tenant_${tenantId}`,
      mode: "qualify",
    }),
    listTenants: async () => ["acme", "globex", "initech"],
    idleTimeoutMs: 300_000,
    sweep: true,
  },

  // Models (used by type generation and the REPL)
  modelsPath: {
    landlord: "./src/models/landlord",
    tenant: "./src/models/tenant",
  },

  // Type generation overrides
  typeDeclarationImportPrefix: "$models",
  typeDeclarationSingularModels: true,

  // Queue
  queue: {
    defaultQueue: "default",
    workers: 2,
    jobsPath: "./app/jobs",
  },

  // Transactions
  transactions: {
    abandonedTimeoutMs: 60_000,
  },

  // Diagnostics
  log: false,
};

export default config;
```

## `connection`

Required. Two equivalent shapes are supported.

### URL form

```ts
connection: { url: "postgres://user:pass@localhost:5432/mydb" }
connection: { url: "mysql://user:pass@localhost:3306/mydb" }
connection: { url: "sqlite://./app.db" }
connection: { url: "sqlite://:memory:" }
```

For MySQL and PostgreSQL, `bigint: true` asks Bun to decode large integer
values as `bigint`. MySQL can still return safe values as `number`; PostgreSQL
returns its `BIGINT` values as `bigint`. Leave it off when serializing rows
directly to JSON, because JavaScript's native `JSON.stringify` does not accept
`bigint`:

```ts
connection: {
  url: "mysql://user:pass@localhost:3306/mydb",
  bigint: true,
}
```

### MySQL sessions must use UTC

On MySQL, ORM passes model dates to `Bun.SQL` as native `Date` bindings, which
Bun encodes as a UTC wall clock. Every physical connection in the pool must
therefore start with `time_zone = '+00:00'`. This remains a runtime requirement:
`DATETIME` stores that wall clock directly, while `TIMESTAMP` interprets it in
the session's time zone; a non-UTC session can silently store a different
instant even though reading the value back appears to round-trip correctly.

Configure UTC as the server or pool default, then recreate existing
connections. Running this once is not sufficient for a pool with more than one
connection:

```sql
SET SESSION time_zone = '+00:00';
```

`SET SESSION` affects only the physical connection that executes it. Verify the
setting from application sessions; `offset_seconds` must be `0`:

```sql
SELECT
  @@session.time_zone AS time_zone,
  TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) AS offset_seconds;
```

ORM checks this before every date-bearing statement that runs directly on a
pool, because consecutive statements may use different sessions. Inside
`connection.transaction(...)` the session is pinned and the successful check is
reused for the rest of that transaction. Group related date writes in a short
transaction when the extra round trip matters; `max: 1` alone does not suppress
the check because that physical connection can still be replaced after a
disconnect.

SQLite connections apply production-friendly defaults before the first query:

```sql
PRAGMA foreign_keys=ON;
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
```

Override or disable them only when your deployment needs a different SQLite mode:

```ts
connection: {
  url: "sqlite://./app.db",
  sqlitePragmas: { journalMode: "DELETE", synchronous: "FULL", foreignKeys: true },
}

connection: {
  url: "sqlite://./app.db",
  sqlitePragmas: false,
}
```

`foreignKeys` defaults to `true`, so SQLite enforces declared foreign keys like MySQL and PostgreSQL. Set it to `false` only for an existing database that deliberately relies on SQLite's legacy disabled behavior.

Before upgrading an existing SQLite database, check for old orphaned references
that SQLite previously allowed:

```sql
PRAGMA foreign_key_check;
```

You can also pin a Postgres schema and tune the connection pool from the URL form:

```ts
connection: {
  url: "postgres://localhost/mydb",
  schema: "app",   // default search_path / qualifier
  max: 20,         // pool size
  prepare: false,  // default for Postgres; avoids stale named prepared plans
}
```

### Driver form

Useful when secrets come from multiple env vars:

```ts
connection: {
  driver: "postgres",
  host: "localhost",
  port: 5432,
  database: "mydb",
  username: "app",
  password: process.env.DB_PASSWORD!,
  max: 20,
  prepare: false,
}
```

SQLite uses `filename` instead of `host`/`port`:

```ts
connection: { driver: "sqlite", filename: "./app.db" }
```

ORM forwards the driver config to Bun's SQL client as-is and does not substitute defaults of its own. Every field you omit is therefore resolved by Bun from the adapter's standard environment variables — `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD` for Postgres, and the `MYSQL_*` equivalents for MySQL — falling back to `localhost` and the adapter's default port when the variable is unset. So `{ driver: "postgres" }` in an environment with `PGHOST` set connects to that host, not to `localhost`. Pass the field explicitly whenever you need it to win over the environment:

```ts
connection: { driver: "postgres", host: "localhost", database: "mydb" }
```

Credentials in this form are handed to the driver verbatim instead of being assembled into a URL, so usernames and passwords containing `/`, `?`, `#`, `@` or `%` need no escaping. The `url` form is parsed as a URL and still requires percent-encoded credentials.

For PostgreSQL, `prepare` defaults to `false`. ORM generates dynamic SQL for model queries, validation checks, migrations, and schema-qualified tenant queries; disabling named prepared statements avoids intermittent stale-plan errors after schema changes or when a long-running server reuses pooled connections. Set `prepare: true` only when you know your Postgres deployment benefits from Bun's persisted named prepared statements and your query result shapes are stable.

For PostgreSQL, the pool `max` defaults to `10` when unset (`Connection.defaultPostgresPoolMax`). Override per-connection with `max`, or globally before constructing connections:

```ts
import { Connection } from "@rekkr/orm";
Connection.defaultPostgresPoolMax = 20;
```

### Unique constraint errors

Duplicate unique values and primary keys are normalized across SQLite, MySQL,
and PostgreSQL, including deferred constraints that PostgreSQL detects only
when a transaction commits:

```ts
import { UniqueConstraintViolationError } from "@rekkr/orm";

try {
  await User.create({ email: "already-taken@example.test" });
} catch (error) {
  if (error instanceof UniqueConstraintViolationError) {
    // Return a conflict response, report a validation issue, etc.
  }
}
```

The public message is stable and intentionally contains no SQL, bindings,
table, column, or constraint names. The original Bun driver error is available
as `error.cause` for trusted server-side diagnostics. Treat that cause as
sensitive: do not serialize it into an HTTP response or expose it to clients.

Only duplicate unique and primary-key violations use this error. `NOT NULL`,
`CHECK`, foreign-key, connection, and syntax failures remain the original
driver errors. `insertOrIgnore()` continues to suppress duplicate conflicts as
requested instead of throwing.

### Multi-tenant connection budget

Each distinct connection opens its **own** pool of up to `max` sockets. Postgres `max_connections` defaults to 100, so the ceiling is roughly:

```
total sockets ≈ (number of distinct connections) × max
```

Strategy implications:

- **`qualify`** (recommended for high concurrency): all tenants share the base connection's pool — table names are schema-prefixed (`tenant_x.users`). One pool total. No connection pinned per request. Best scalability.
- **`search_path`**: uses a dedicated reserved connection for the callback and sets `search_path` for that session, then resets it. **One pool connection is pinned for the callback duration** (including any external I/O inside the handler). Keep callbacks short; prefer `qualify` unless you need `search_path` behavior for raw SQL.
- **`database`**: each distinct tenant database gets its **own pool**. `T` tenants ⇒ `T × max` sockets — this exhausts `max_connections` fast. This is mitigated by default: when `tenancy.resolveTenant` is set, `configureOrm()` applies a 5-minute idle TTL and a 60s background eviction sweep automatically. Tune or disable via [`tenancy.idleTimeoutMs`](#idletimeoutms) and [`tenancy.sweep`](#sweep):

```ts
tenancy: {
  resolveTenant: ...,
  idleTimeoutMs: 5 * 60_000,   // default; idle database-strategy pools expire
  sweep: 60_000,               // default true@60s; false/0 to disable
}
```

The equivalent low-level handles are still available if you wire the runtime manually instead of through `configureOrm()`:

```ts
import { ConnectionManager } from "@rekkr/orm";

ConnectionManager.defaultTenantTtl = 5 * 60_000;   // a resolution-level `ttl` always wins
ConnectionManager.enableTenantSweep(60_000);        // unref'd; call once at startup
```

With the sweep disabled, expired `database`-strategy pools are only reclaimed lazily the next time that same tenant is resolved — idle tenants in between keep their sockets open until `ConnectionManager.closeAll()`.

## `migrationsPath` vs `migrations`

There are two shapes for declaring where migration files live.

### Flat (single-tenant)

```ts
migrationsPath: "./database/migrations",
// or multiple roots merged in glob order
migrationsPath: ["./database/migrations", "./database/extra"],
```

### Grouped (multi-tenant)

```ts
migrations: {
  landlord: "./database/landlord-migrations",
  tenant:   "./database/tenant-migrations",
}
```

When `migrations.landlord` or `migrations.tenant` is set, use
`orm migrate --landlord`, `orm migrate --tenants`, or
`orm migrate --tenant=<id>` to target a scope. The flat `migrationsPath` is
still honored as a fallback when a scope is requested but its grouped path is
missing.

### `createIfMissing`

Tell the migrator to provision the database or schema before running migrations:

```ts
migrations: {
  landlord: "./database/migrations",
  createIfMissing: true,                          // both database and schema
  // — or fine-grained —
  createIfMissing: { database: true, schema: false },
}
```

Driver behavior:

- **PostgreSQL** — connects to the `postgres` admin database, checks `pg_database`, and runs `CREATE DATABASE` if missing. Schemas use `CREATE SCHEMA IF NOT EXISTS`.
- **MySQL** — `CREATE DATABASE IF NOT EXISTS` via the `mysql` admin database. MySQL does not have schemas, so the `schema` option is a no-op.
- **SQLite** — the file is auto-created by Bun on connect. Both `database` and `schema` flags are no-ops.

See [Migrations](./migrations.md#auto-create-database-and-schema) for the full lifecycle.

## `seedersPath`

```ts
seedersPath: "./database/seeders",
// or
seedersPath: ["./database/seeders", "./database/test-fixtures"],
```

Used by `bunx orm db:seed` and `orm.seed()`. Each configured root runs its `DatabaseSeeder` when present, otherwise it falls back to all seeder files in filename order. See [Seeders](./seeders.md).

## `tenancy`

Two callbacks turn an app into a multi-tenant system.

### `resolveTenant`

Maps a tenant identifier to a connection or schema. Three strategies are supported:

```ts
// Database-per-tenant — each tenant on its own database
tenancy: {
  resolveTenant: async (tenantId) => ({
    strategy: "database",
    name: `tenant:${tenantId}`,
    config: { url: await lookupDsn(tenantId) },
  }),
}

// Schema-per-tenant (Postgres only) — shared database, qualified table names
tenancy: {
  resolveTenant: async (tenantId) => ({
    strategy: "schema",
    name: `tenant:${tenantId}`,
    schema: `tenant_${tenantId}`,
    mode: "qualify", // or "search_path"
  }),
}

// Row-level security (Postgres) — same database, session var set per request
tenancy: {
  resolveTenant: async (tenantId) => ({
    strategy: "rls",
    name: `tenant:${tenantId}`,
    tenantId,
    setting: "app.current_tenant",
  }),
}
```

`name` is an internal cache key; pick something stable. The resolution is cached for the duration of the process.

### Model-level schema override (`static modelSchema`)

For PostgreSQL schema-per-tenant apps, you can pin specific models to a fixed schema (commonly landlord/shared models on `public`) while other models stay tenant-scoped:

```ts
class LandlordPlan extends Model.define<{ id: number }>("plans") {
  static modelSchema = "public";
}

class TenantInvoice extends Model.define<{ id: number }>("invoices") {}
```

Resolution order for model table names:

1. `static modelSchema` on the model
2. Active tenant schema from `TenantContext.run(...)`
3. Fallback `public` (PostgreSQL only)

### `listTenants`

Only used by the CLI when running grouped tenant migrations across every tenant (`bunx orm migrate --tenants`):

```ts
tenancy: {
  listTenants: async () => {
    const rows = await landlordDb.query("SELECT id FROM tenants");
    return rows.map((r) => r.id);
  },
}
```

Application code never calls this — it is purely for batch operations.

### `idleTimeoutMs`

```ts
tenancy: { idleTimeoutMs: 300_000 }
```

Idle TTL (milliseconds) for tenant contexts that own their own connection pool (the `database` strategy, and any resolution that builds a new connection from `config`). After this window with no use, the context expires and its pool can be closed by the sweep — preventing per-tenant pools from accumulating until the database hits its connection limit.

A resolution-level `ttl` always overrides this. Applies only to connection-owning contexts; shared schema/RLS connections (which do not own a pool) are unaffected.

**Default:** `300_000` (5 minutes) when `tenancy.resolveTenant` is set. Set to a different value to tune, or pair with `sweep: false` to opt out of reclamation entirely.

### `sweep`

```ts
tenancy: { sweep: true }      // background sweep every 60s
tenancy: { sweep: 30_000 }    // custom interval (ms)
tenancy: { sweep: false }     // disable
```

Enables a background timer that closes expired tenant contexts (per `idleTimeoutMs` / resolution `ttl`), reclaiming idle pools. The timer is `unref`'d so it never keeps the process alive.

**Default:** enabled at a 60s interval when `tenancy.resolveTenant` is set. `false` or `0` disables it (idle pools then only reclaim when a tenant is re-resolved after expiry).

See [Library Usage](./library-usage.md) and the [Query Builder's `DB.tenant()`](./query-builder.md#multi-tenant-scope) section for runtime use.

## `modelsPath`

Tells the REPL and the type generator where to look for model classes:

```ts
modelsPath: "./src/models",
// or a list
modelsPath: ["./src/models", "./src/admin/models"],
// or partitioned for multi-tenant projects
modelsPath: {
  landlord: "./src/models/landlord",
  tenant:   "./src/models/tenant",
}
```

The grouped form lets `orm migrate --landlord --types` regenerate types only for landlord-scoped models.

## `policyPath`

Optional default output path for policy generators:

```ts
policyPath: "./app/policies",
// or
policyPath: ["./app/policies", "./modules/core/policies"],
```

Used by `orm make:policy` when `--dir` is not provided.

## Type generation

```ts
typesOutDir: "./src/generated/model-types",       // optional legacy output dir
typeDeclarationImportPrefix: "$models",
typeDeclarationSingularModels: true,
typeDeclarations: {
  admin_users: { path: "$models/admin/AdminAccount", className: "AdminAccount" },
},
typeStubs: false,                                  // emit stubs instead of declarations
```

See [Type Generation](./type-generation.md) for the full feature reference.

## `transactions`

```ts
transactions: {
  abandonedTimeoutMs: 60_000,   // default; set 0 to disable
}
```

Safety net for the **manual** transaction API (`connection.beginTransaction()` paired with `commit()` / `rollback()`). `beginTransaction()` reserves a pooled connection; if neither `commit()` nor `rollback()` is called within `abandonedTimeoutMs`, the transaction is force-rolled-back and the pooled slot released — so a code path that throws between `begin` and `commit` cannot leak a connection permanently.

The timer is `unref`'d and is cleared automatically on a normal `commit()` / `rollback()`, so well-behaved transactions never trigger it. The callback form (`DB.transaction(cb)` / `connection.transaction(cb)`) already releases on its own and is unaffected.

**Default:** `60_000` (60s) globally. Set `abandonedTimeoutMs: 0` to disable. Raise it if you legitimately run long manual transactions; prefer the callback form where possible.

## `log`

```ts
log: true                                  // SQL to console
log: { file: "./logs" }                    // SQL to ./logs/query-YYYY-MM-DD.log only
log: { file: "./logs", console: true }     // both file and console
log: false                                 // off (default)
```

Controls SQL query logging.

- `true` — log every query to the console.
- `{ file }` — append queries to a dated file `query-YYYY-MM-DD.log` inside the given directory (rolls over daily; rotate/prune old files with your OS, e.g. `logrotate`). Console output is **off** unless `console: true` is also set.
- `{ file, console: true }` — write to both.
- `false` / omitted — no logging.

Useful in development; in production prefer the file form (or leave off) and ensure query sampling if volume is high.

## `queue`

Enables the background job queue. When present, `configureOrm()` configures the
selected database, Redis, or custom driver. The database driver is the default.

```ts
queue: {
  driver: "db",                  // "db", "redis", or a QueueDriver instance
  defaultQueue: "default",        // queue name used when a job does not specify one
  workers: 2,                     // concurrent worker slots for `orm queue`
  jobsPath: "./app/jobs",         // directory the worker imports to register job classes
  retryAfterSeconds: 90,          // re-queue jobs reserved but not finished within this time
  retryDelaySeconds: 5,           // wait before retrying a failed job
  pollIntervalMs: 1_000,          // worker polling interval
  table: "jobs",                  // override the jobs table name
  failedTable: "failed_jobs",     // override the failed jobs table name
},
```

All fields are optional. Omitting the entire `queue` key leaves the queue unconfigured; you can still call `Queue.configure()` manually.

For Redis, configuration is enough; the URL defaults to Bun's `REDIS_URL`:

```ts
queue: {
  driver: "redis",
  redis: { url: process.env.QUEUE_REDIS_URL },
}
```

Use `Queue.configure()` manually only when wiring ORM without `configureOrm()`
or when supplying a custom driver. See [Queue Jobs](./queue.md) for the full
reference.

## Subsystem configuration

These optional `OrmConfig` sections have dedicated guides:

- [`cache`](./cache.md#setup) — cache store, key prefix, and default TTL.
- [`commands`](./commands.md#configuration) — command discovery paths.
- [`search`](./search.md#configure) — engine, model discovery, batching, queues,
  and tenant-aware indexes.

## Wiring it up at runtime

The CLI loads `orm.config.ts` automatically. Your application code activates the same config through `configureOrm()`:

```ts
// src/app.ts
import { configureOrm } from "@rekkr/orm";
import config from "../orm.config";

const orm = configureOrm(config);

// orm.connection — the live Connection
// orm.migrate(), orm.seed(), orm.migrator(), orm.seeder() — facade helpers
```

`configureOrm()` does the following on call:

1. Constructs a `Connection` from `config.connection` and registers it as the default.
2. Sets the connection on `Model` and `Schema` so static helpers work.
3. Wires up `tenancy.resolveTenant` if provided, and applies the tenant pool defaults (`idleTimeoutMs`, `sweep`).
4. Applies the abandoned-transaction safety net (`transactions.abandonedTimeoutMs`, default 60s).
5. Configures query logging from `log`.
6. Configures the selected database, Redis, or custom queue driver if `queue` is set.

It returns a [facade](./library-usage.md) you can use to run migrations and seeders programmatically.

### SvelteKit

Bootstrap ORM in a server-only singleton module so hot reloads do not re-create it from multiple places. Guard the singleton against Vite HMR invalidating the framework's own internal modules (`Model`, `ConnectionManager`) — when that happens the cached `__orm` survives on `globalThis` but `Model.connection` / `ConnectionManager.defaultConnection` are wiped on the new class instances, which is exactly when you see `No connection set on model Tenant`:

```ts
// src/lib/server/orm.ts
import { configureOrm, ConnectionManager, type ConfiguredOrm } from "@rekkr/orm";
import config from "../../../orm.config";

declare global {
  // eslint-disable-next-line no-var
  var __orm: ConfiguredOrm | undefined;
}

// First load OR HMR invalidated Model/ConnectionManager (their static state
// was reset). Re-running configureOrm is race-free — new defaults install
// before the previous pool is torn down in the background.
if (!globalThis.__orm || !ConnectionManager.getDefault()) {
  globalThis.__orm = configureOrm(config);
}

const orm = globalThis.__orm;
export default orm;
```

The double check matters:

- `!globalThis.__orm` — cold start.
- `!ConnectionManager.getDefault()` — Vite re-evaluated `connection/ConnectionManager.ts` (or `model/Model.ts`); the cached singleton points at a stale module's pool. Re-running `configureOrm` writes the connection onto the live classes AND refreshes the cached singleton.

Then import the module from server code:

```ts
import "$lib/server/orm";
```

or:

```ts
import orm from "$lib/server/orm";
```

Do not call `configureOrm()` directly inside `hooks.server.ts`, route modules, or actions. Those files are re-evaluated during dev reloads; centralize the bootstrap in `src/lib/server/orm.ts` with the guard above.

## Environment variables (CLI only)

When no `orm.config.ts` exists, the CLI falls back to env vars:

```bash
export DATABASE_URL="sqlite://app.db"
export MIGRATIONS_PATH="./database/migrations,./database/tenant-migrations"
export SEEDERS_PATH="./database/seeders"
export MODELS_PATH="./src/models"
export TYPES_OUT_DIR="./src/generated/model-types"
```

Comma-separated lists work where a config field accepts `string[]`. Prefer a real config file for anything beyond a quick experiment — the env-var path does not support `tenancy`, `createIfMissing`, or any of the type generation overrides.
