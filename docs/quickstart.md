# Quickstart

This guide builds a tiny blog: users and the posts they author. By the end you will have a migration, two models, a seeder, and a handful of queries running against SQLite. The same core steps apply to PostgreSQL and MySQL; review the [driver caveats](./schema-builder.md#driver-caveats) before deploying against either one.

Estimated time: ten minutes.

## 1. Install

```bash
bun init -y
bun add git+ssh://git@github.com/rekkrjs/orm.git#v2.0.0
```

If you are using TypeScript, make sure `tsconfig.json` has `"target": "ESNext"`, `"module": "ESNext"`, and `"moduleResolution": "bundler"`. See [Installation](./installation.md) for the full setup.

## 2. Create `orm.config.ts`

This file is read by the `orm` CLI and by `configureOrm()` at runtime, so both share one source of truth.

```ts
// orm.config.ts
export default {
  connection: { url: "sqlite://app.db" },
  migrationsPath: "./database/migrations",
  seedersPath: "./database/seeders",
  modelsPath: "./src/models",
};
```

For more options — Postgres URLs, multi-tenant resolvers, schema auto-create — see [Configuration](./configuration.md).

## 3. Write a migration

Create the `users` and `posts` tables.

```bash
bunx orm make:migration create_users_table
bunx orm make:migration create_posts_table
```

Each command writes a timestamped file under `./database/migrations`. Fill them in:

```ts
// database/migrations/20260101000000_create_users_table.ts
import { Migration, Schema } from "@rekkr/orm";

export default class CreateUsersTable extends Migration {
  async up() {
    await Schema.create("users", (table) => {
      table.id();
      table.string("name");
      table.string("email").unique();
      table.timestamps();
    });
  }

  async down() {
    await Schema.dropIfExists("users");
  }
}
```

```ts
// database/migrations/20260101000001_create_posts_table.ts
import { Migration, Schema } from "@rekkr/orm";

export default class CreatePostsTable extends Migration {
  async up() {
    await Schema.create("posts", (table) => {
      table.id();
      table.foreignId("user_id").constrained().cascadeOnDelete();
      table.string("title");
      table.text("body").nullable();
      table.timestamps();
    });
  }

  async down() {
    await Schema.dropIfExists("posts");
  }
}
```

Run them:

```bash
bunx orm migrate
```

You should see `Migrated: ...create_users_table.ts` and similar for posts. See [Migrations](./migrations.md) for rollback, refresh, and multi-tenant migrations.

## 4. Define typed models

`Model.define<Attributes>(table)` gives full IntelliSense — attribute access, typed `where()` columns, typed `with()` relations — with no code generation:

```ts
// src/models/User.ts
import { Model } from "@rekkr/orm";
import Post from "./Post";

interface UserAttributes {
  id: number;
  name: string;
  email: string;
  created_at: Date;
  updated_at: Date;
}

export default class User extends Model.define<UserAttributes>("users") {
  posts() {
    return this.hasMany(Post);
  }
}
```

```ts
// src/models/Post.ts
import { Model } from "@rekkr/orm";
import User from "./User";

interface PostAttributes {
  id: number;
  user_id: number;
  title: string;
  body: string | null;
  created_at: Date;
  updated_at: Date;
}

export default class Post extends Model.define<PostAttributes>("posts") {
  author() {
    return this.belongsTo(User);
  }
}
```

Plain `extends Model` also works if you have generated declarations or don't need attribute typing — see [Models](./models.md) for the trade-offs.

## 5. Write a seeder (optional)

Create the seeder file under the configured `seedersPath`:

```ts
// database/seeders/DatabaseSeeder.ts
import { Seeder } from "@rekkr/orm";
import User from "../../src/models/User";
import Post from "../../src/models/Post";

export default class DatabaseSeeder extends Seeder {
  async run() {
    const alice = await User.create({ name: "Alice", email: "alice@example.com" });
    await Post.create({ user_id: alice.id, title: "Hello world", body: "First post." });
    await Post.create({ user_id: alice.id, title: "Second", body: null });
  }
}
```

Run it:

```bash
bunx orm db:seed
```

See [Seeders](./seeders.md) for targeted runs, ordering, and factories.

## 6. Wire up your app

Call `configureOrm()` once at startup so models, schema, and the connection manager all share the same connection:

```ts
// src/app.ts
import { configureOrm } from "@rekkr/orm";
import config from "../orm.config";

const orm = configureOrm(config);

// You can now use models, the DB facade, and the facade helpers.
```

Using SvelteKit / Vite dev? Wrap this in a `globalThis` singleton with an HMR-safe guard — see [SvelteKit](./configuration.md#sveltekit).

The returned `orm` object lets you run migrations and seeders programmatically too:

```ts
await orm.migrate();
await orm.seed();
await orm.rollback();
await orm.fresh();
```

See [Library Usage](./library-usage.md) for the full facade reference.

## 7. Query the database

### Read

```ts
import User from "./models/User";

const all = await User.all();                       // every row, as Collection<User>
const alice = await User.find(1);                   // by primary key, or null
const byEmail = await User.where("email", "alice@example.com").first();

// With type-safe eager loading
const usersWithPosts = await User.with("posts").get();
for (const user of usersWithPosts) {
  console.log(user.name, user.posts.length);        // posts is typed
}

// Aggregates
const authorsWithCounts = await User.withCount("posts").get();
console.log(authorsWithCounts[0].posts_count);
```

### Create and update

```ts
// Mass-assigned insert
const alice = await User.create({ name: "Alice", email: "alice@example.com" });

// Mutate and save
alice.name = "Alice Smith";
await alice.save();

// Or one-step update
await User.where("id", alice.id).update({ name: "Alice S." });
```

### Delete

```ts
const post = await Post.findOrFail(1);
await post.delete();

// Bulk delete
await Post.where("user_id", 999).delete();
```

### Raw table access (no model)

```ts
import { DB } from "@rekkr/orm";

const counts = await DB.table("posts")
  .selectRaw("user_id, COUNT(*) as total")
  .groupBy("user_id")
  .orderByDesc("total")
  .get();
```

See [Query Builder](./query-builder.md) for the complete reference.

## 8. Try the REPL

```bash
bunx orm repl
```

The prompt is `orm> ` and your models, `DB`, `Schema`, and `Connection` are all in scope:

```
orm> await User.with('posts').first()
orm> await DB.table('users').count()
orm> await DB.tenant('acme', () => User.all())
```

When no `orm.config.ts` is present the REPL starts against an in-memory SQLite database so you can experiment without a project setup.

## Where to next

- [Models](./models.md) — casts, accessors, soft deletes, JSON serialization.
- [Relationships](./relationships.md) — `hasMany`, `belongsToMany`, polymorphic, eager loading.
- [Query Builder](./query-builder.md) — every chainable method and the `DB` facade.
- [Migrations](./migrations.md) — rollback, batches, multi-tenant.
- [TypeScript](./typescript.md) — how the typing flows from `Model.define<T>()` through queries.
