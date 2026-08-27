# Seeders and Factories

Seeders are scripts that populate the database with development, demo, or test data. Factories generate realistic-looking model attributes that seeders (and tests) can use to create many similar records quickly.

```ts
import { Seeder, SeederRunner } from "@rekkr/orm";
```

## Writing a seeder

Extend the `Seeder` class and implement `run()`:

```ts
// database/seeders/UserSeeder.ts
import { Seeder } from "@rekkr/orm";
import User from "../../src/models/User";

export default class UserSeeder extends Seeder {
  async run() {
    await User.create({ name: "Ada Lovelace",  email: "ada@example.test" });
    await User.create({ name: "Linus Torvalds", email: "linus@example.test" });
  }
}
```

A seeder can call models, run raw SQL via `this.connection`, or invoke other seeders:

```ts
import { Seeder } from "@rekkr/orm";
import UserSeeder from "./UserSeeder";
import PostSeeder from "./PostSeeder";
import RoleSeeder from "./RoleSeeder";

export default class DemoSeeder extends Seeder {
  async run() {
    await this.call([UserSeeder, PostSeeder]);  // run other seeders in order
    await this.callOnce(RoleSeeder);            // deduplicated in this runner execution
    await this.connection.run("ANALYZE");
  }
}
```

`this.connection` is the active connection — including any tenant scoping. Inside `DB.tenant("acme", ...)` it is the tenant-qualified connection.

`callOnce()` prevents a shared dependency from running twice in a diamond-shaped seeder graph. Its deduplication set belongs to one `SeederRunner` execution, so a later `runner.run(...)` starts fresh. Use `call()` when repeated execution is intentional.

To suppress model observers for a seeder and every seeder it calls, set the static flag on the root seeder:

```ts
export default class DatabaseSeeder extends Seeder {
  static withoutModelEvents = true;

  async run() {
    await this.call([UserSeeder, PostSeeder]);
  }
}
```

Factory callbacks such as `afterCreating` still run; only model observers are muted.

## Configuring the seeder path

Set `seedersPath` in `orm.config.ts`:

```ts
export default {
  connection: { url: "sqlite://app.db" },
  seedersPath: "./database/seeders",
};
```

Multiple roots are allowed:

```ts
export default {
  connection: { url: "sqlite://app.db" },
  seedersPath: ["./database/seeders", "./modules/demo/seeders"],
};
```

The CLI looks for a `DatabaseSeeder` module in each configured root. When present, that class is the entry point and should call its child seeders explicitly. A root without `DatabaseSeeder` falls back to running every supported seeder module in filename order. Supported extensions are `.ts`, `.js`, `.mts`, `.mjs`, `.cts`, and `.cjs`; declaration and test files are ignored.

## Running seeders

### CLI

```bash
# DatabaseSeeder in each configured root, or every file when no root exists
bunx orm db:seed

# A single seeder by class name (found under seedersPath)
bunx orm db:seed UserSeeder

# A single seeder by file path
bunx orm db:seed ./database/seeders/UserSeeder.ts

# Multi-tenant
bunx orm db:seed --tenant acme
bunx orm db:seed --tenant acme UserSeeder
bunx orm db:seed --tenants                 # iterate every tenant from listTenants()

# Skip the production confirmation (including tenant-wide runs)
NODE_ENV=production bunx orm db:seed --force

# Rebuild the schema, then run the default or one selected seeder
bunx orm migrate:fresh --seed
bunx orm migrate:fresh --seed --seeder=UserSeeder
bunx orm migrate:refresh --seed
bunx orm migrate:refresh --seed --seeder=UserSeeder
```

When `NODE_ENV=production`, `db:seed`, `migrate:fresh --seed`, and `migrate:refresh --seed` ask for confirmation before resolving either landlord or tenant seed targets; non-interactive runs fail unless `--force` is present. When the command runs in a tenant context, `SeederRunner` automatically uses the tenant's connection. Seeder runs are transactional per target: if a seeder throws, that target rolls back. A `--tenants` fan-out cannot be atomic across separate tenant databases.

### Programmatic — `SeederRunner`

```ts
import { SeederRunner } from "@rekkr/orm";

const runner = new SeederRunner();

// Laravel-style root entry point, with all-files fallback
await runner.runDefault("./database/seeders");

// Run every seeder in one or more paths
await runner.runPaths("./database/seeders");
await runner.runPaths(["./database/seeders", "./modules/demo/seeders"]);

// Run one seeder by file path
await runner.runFile("./database/seeders/UserSeeder.ts");

// Run one seeder by class name (searches given paths)
await runner.runTarget("UserSeeder", "./database/seeders");

// Or pass class instances / classes directly
await runner.run(UserSeeder, new PostSeeder());
```

### Programmatic — `configureOrm()` facade

If you already loaded `orm.config.ts`, the facade is the shortest path:

```ts
import { configureOrm } from "@rekkr/orm";
import config from "../orm.config";

const orm = configureOrm(config);
await orm.seed();    // uses config.seedersPath
```

See [Library Usage](./library-usage.md).

## Factories

Factories produce attribute objects, unsaved model instances, or persisted records — driven by a `sequence` counter so each generated record is unique.

Define a factory class per model (Laravel-style): subclass `Factory<Model>`, implement `definition()`, add state methods, then `Factory.register(Model, FactoryClass)` once — typically in a `factories/` file imported at startup. `register` wires the model onto the factory (no `model =` field needed) and binds `Model.factory()`. Every model gets `factory()` built in; the model class itself stays free of factory code.

```ts
// factories/UserFactory.ts
import { Factory } from "@rekkr/orm";
import User from "../models/User";

export class UserFactory extends Factory<User> {
  definition(sequence: number) {
    return {
      name: `User ${sequence}`,
      email: `user${sequence}@example.test`,
      role: "member",
    };
  }

  // State methods — chainable, each returns a new factory.
  admin() {
    return this.state({ role: "admin" });
  }

  // Called automatically whenever Model.factory() resolves this factory.
  configure() {
    return this.afterCreating(async (user) => {
      // Factory-specific follow-up work.
    });
  }
}

Factory.register(User, UserFactory);
```

```ts
const raw = User.factory().raw();                 // attribute object
const model = User.factory().make();              // unsaved User
const created = await User.factory().create();    // saved User
const quiet = await User.factory().createQuietly(); // saved, no model observers
await User.factory().count(1_000).insert();        // bulk insert, no model events
```

| Method | Result | Persists | Model observers | Factory hooks |
|---|---|---:|---:|---|
| `raw()` | Attributes | No | No | None |
| `make()` | Unsaved model(s) | No | No | `afterMaking` (synchronous) |
| `create()` | Hydrated model(s) | Yes | Yes | `afterMaking`, `afterCreating` |
| `createQuietly()` | Hydrated model(s) | Yes | No | `afterMaking`, `afterCreating` |
| `insert()` | `void` | Yes, bulk | No | `afterMaking` |

### Counts and state overrides

```ts
// Five users
const many = await User.factory().count(5).create();

// State method
const admins = await User.factory().admin().count(3).create();

// Ad-hoc state by sequence
const mixed = await User.factory()
  .count(10)
  .state((attrs, seq) => ({
    role: seq % 2 === 0 ? "admin" : "member",
  }))
  .create();

// Per-call override (highest precedence)
const owner = await User.factory().create({ role: "owner" });

// Stable scalar/array return types, regardless of a previous count()
const one = await User.factory().count(5).createOne();   // User; creates one
const list = await User.factory().count(5).createMany(); // User[]; creates five
const made = User.factory().count(5).makeOne();          // User; unsaved
const attrs = User.factory().count(5).rawOne();          // FactoryAttributes<User>
```

`count()` accepts non-negative integers, including zero. Fractions, negative numbers, `NaN`, and infinity throw before any model is generated.

Precedence: `definition()` → states (in order) → per-call override.

Factory attributes are trusted and may set guarded columns such as IDs or administrative flags. Normal model APIs such as `Model.create()` and `Model.insert()` still enforce mass-assignment protection.

`raw()`, `make()`, `create()`, `createQuietly()`, and `insert()` each respect the count and state. Their scalar-or-array result follows the count; use `rawOne()`, `makeOne()`, `createOne()`, or `createMany()` when the caller needs a stable return type. A factory can also build unsaved fixtures for a test:

```ts
const fixtures = User.factory().count(3).make();   // User[] — unsaved
```

### Typing / IntelliSense

`Model.factory()` has two overloads:

```ts
User.factory()                  // Factory<User> — built-ins typed to the model
User.factory<UserFactory>()     // UserFactory  — also surfaces custom state methods
```

The default returns `Factory<User>`, so `make()`/`create()` are typed to the model and `definition(seq: number)` gets a typed sequence. To get autocomplete for your own state methods (`.admin()`, etc.) in a chain, pass the factory class as the type argument: `User.factory<UserFactory>().admin()`. Chaining preserves the concrete type.

Relationship names are checked too: `for()` accepts `belongsTo` methods, `has()` accepts `hasMany`, `hasOne`, `morphMany`, or `morphOne` methods, and `hasAttached()` accepts many-to-many methods.

### Relationships, sequences, hooks

```ts
import { Sequence } from "@rekkr/orm";

// belongsTo: .for(parentOrFactory, relationName)
await Post.factory().for(User.factory(), "author").create();

// hasMany/hasOne children: .has(childFactory, relationName)
await User.factory().has(Post.factory().count(3), "posts").create();

// belongsToMany/morphToMany with optional pivot attributes
await User.factory()
  .hasAttached(Role.factory().count(3), { active: true }, "roles")
  .create();

// Reuse three tags throughout the nested graph
const tags = await Tag.factory().count(3).createMany();
await User.factory()
  .count(10)
  .has(Post.factory().count(5).hasAttached(Tag.factory().count(3), "tags"), "posts")
  .recycle(tags)
  .createMany();

// Cycle values across a batch
await User.factory()
  .count(4)
  .state(new Sequence({ role: "admin" }, { role: "member" }))
  .create();

// Lifecycle hooks
await User.factory()
  .afterMaking((u) => { /* mutate before save */ })
  .afterCreating(async (u) => { /* related side-effects */ })
  .create();
```

A parent factory passed to `.for()` is resolved once per operation, so `Post.factory().count(3).for(User.factory(), "author")` creates one user shared by all three posts.

`hasAttached()` accepts either a factory, one persisted model, or an array of persisted models. Pivot attributes are applied to every attachment.

`make()` applies `.for(savedModel)` without persisting anything. It rejects an unsaved parent or `.for(parentFactory)` because resolving either would require database I/O. Since `make()` is synchronous, its `afterMaking` hooks must also be synchronous; `create()` and `insert()` await asynchronous hooks.

`recycle(modelOrModels)` accepts persisted models, propagates them through nested factories, and randomly reuses matching types in `for()` and `hasAttached()` instead of creating duplicates. When `hasAttached()` requests fewer records than the recycled pool contains, it uses a random subset of that size.

For soft-delete fixtures and explicit database targets:

```ts
const deleted = await User.factory().trashed().createOne();
const landlord = await User.factory().connection("landlord").createOne();
const tenant = await User.factory().connection(tenantConnection).createOne();
```

`trashed()` requires the model to enable soft deletes and uses its configured `deletedAtColumn`. `connection()` accepts either a registered connection name or a `Connection`; that connection is propagated to parents, children, attachments, and bulk `insert()` calls.

Use `createQuietly()` when the factory must return hydrated models or create relationships without dispatching model observers. It still runs `afterMaking` and `afterCreating` factory callbacks, including callbacks registered by `configure()`.

`insert(overrides?, { chunkSize? })` writes in chunks of 100 by default and returns `Promise<void>`; `chunkSize` must be a positive integer. It awaits `afterMaking` hooks, but skips model observers and every `afterCreating` hook, including hooks registered by `configure()`. It supports `.for()`, including a parent factory. It rejects `.has()` and `.hasAttached()` because bulk inserts do not hydrate parent keys; use `create()` or `createQuietly()` when child relationships or `afterCreating` work are required.

## Test data idempotency

Seeders run more than once during development. Make them safe to re-run:

```ts
export default class UserSeeder extends Seeder {
  async run() {
    // Idempotent: only create if missing
    await User.firstOrCreate(
      { email: "ada@example.test" },
      { name: "Ada Lovelace" },
    );

    await User.updateOrInsert(
      { email: "linus@example.test" },
      { name: "Linus Torvalds", active: true },
    );
  }
}
```

For destructive seeders (wipe and reload), call `Model.truncate()` first or rely on `orm.fresh()` (drop + re-migrate + re-seed).

## Common pitfalls

- **Order matters.** Prefer a `DatabaseSeeder` that calls child seeders in dependency order. In roots without one, ORM falls back to running files alphabetically; prefix dependent files when using that fallback.
- **Atomicity surprises.** If one seeder throws, the transaction rolls back the entire run. Side-effects sent to external systems (emails, queue jobs) outside the database still went out — make seeders pure data work.
- **Tenant scope is implicit.** Inside `DB.tenant()` or `bunx orm db:seed --tenant`, `this.connection` is the tenant connection. If you also want to seed landlord-scoped data, do it outside the tenant block.
- **Factory persistence has three modes.** `create()` saves hydrated models with observers, `createQuietly()` saves hydrated graphs without observers, and `insert()` writes in bulk without observers. `raw()` and `make()` do not persist.

## Where to next

- [Library Usage](./library-usage.md) — the `configureOrm()` facade including `orm.seed()`.
- [Migrations](./migrations.md) — `orm.fresh()` to drop, re-migrate, and re-seed in one command.
- [Testing](./testing.md) — using factories inside `bun test`.
