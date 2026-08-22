# Seeders and Factories

Seeders are scripts that populate the database with development, demo, or test data. Factories generate realistic-looking model attributes that seeders (and tests) can use to create many similar records quickly.

```ts
import { Seeder, factory, SeederRunner } from "@rekkr/orm";
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

export default class DemoSeeder extends Seeder {
  async run() {
    await this.call([UserSeeder, PostSeeder]);  // run other seeders in order
    await this.connection.run("ANALYZE");
  }
}
```

`this.connection` is the active connection — including any tenant scoping. Inside `DB.tenant("acme", ...)` it is the tenant-qualified connection.

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

The CLI walks every file in these directories that ends in `.ts` or `.js` and looks for a default export extending `Seeder`.

## Running seeders

### CLI

```bash
# All seeders in seedersPath, in filename order
bunx orm db:seed

# A single seeder by class name (found under seedersPath)
bunx orm db:seed UserSeeder

# A single seeder by file path
bunx orm db:seed ./database/seeders/UserSeeder.ts

# Multi-tenant
bunx orm db:seed --tenant acme
bunx orm db:seed --tenant acme UserSeeder
bunx orm db:seed --tenants                 # iterate every tenant from listTenants()
```

When the command runs in a tenant context, `SeederRunner` automatically uses the tenant's connection. Seeder runs are wrapped in a transaction — if any seeder throws, the entire run rolls back.

### Programmatic — `SeederRunner`

```ts
import { SeederRunner } from "@rekkr/orm";

const runner = new SeederRunner();

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
}

Factory.register(User, UserFactory);
```

```ts
const raw = User.factory().raw();                 // attribute object
const model = User.factory().make();              // unsaved User
const created = await User.factory().create();    // saved User
```

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
```

Precedence: `definition()` → states (in order) → per-call override.

`raw()`, `make()`, and `create()` each respect the count and state, so a factory also seeds unsaved fixtures for a test:

```ts
const fixtures = User.factory().count(3).make();   // User[] — unsaved
```

### Typing / intellisense

`Model.factory()` has two overloads:

```ts
User.factory()                  // Factory<User> — built-ins typed to the model
User.factory<UserFactory>()     // UserFactory  — also surfaces custom state methods
```

The default returns `Factory<User>`, so `make()`/`create()` are typed to the model and `definition(seq: number)` gets a typed sequence. To get autocomplete for your own state methods (`.admin()`, etc.) in a chain, pass the factory class as the type argument: `User.factory<UserFactory>().admin()`. Chaining preserves the concrete type.

### Relationships, sequences, hooks

```ts
import { Sequence } from "@rekkr/orm";

// belongsTo: .for(parentOrFactory, relationName)
await Post.factory().for(User.factory(), "author").create();

// hasMany/hasOne children: .has(childFactory, relationName)
await User.factory().has(Post.factory().count(3), "posts").create();

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

- **Order matters.** ORM runs seeders alphabetically by filename. If `PostSeeder` needs users, prefix it (`02_PostSeeder.ts`) or call seeders from a single `DatabaseSeeder` that lists them in the right order.
- **Atomicity surprises.** If one seeder throws, the transaction rolls back the entire run. Side-effects sent to external systems (emails, queue jobs) outside the database still went out — make seeders pure data work.
- **Tenant scope is implicit.** Inside `DB.tenant()` or `bunx orm db:seed --tenant`, `this.connection` is the tenant connection. If you also want to seed landlord-scoped data, do it outside the tenant block.
- **Factories don't apply observers by default for `raw()` and `make()`.** Only `create()` persists the record (and therefore fires observers).

## Where to next

- [Library Usage](./library-usage.md) — the `configureOrm()` facade including `orm.seed()`.
- [Migrations](./migrations.md) — `orm.fresh()` to drop, re-migrate, and re-seed in one command.
- [Testing](./testing.md) — using factories inside `bun test`.
