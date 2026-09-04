# Testing

ORM ships with no built-in test harness — it's just a database library — but it integrates cleanly with Bun's built-in test runner (`bun test`). This page collects the patterns you'll want when writing tests against your models.

## Quick start with `bun:test`

```ts
// tests/user.test.ts
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Connection, Model, Schema } from "@rekkr/orm";
import User from "../src/models/User";

describe("User model", () => {
  let connection: Connection;

  beforeAll(async () => {
    connection = new Connection({ url: "sqlite://:memory:" });
    Model.setConnection(connection);
    Schema.setConnection(connection);

    await Schema.create("users", (table) => {
      table.id();
      table.string("name");
      table.string("email").unique();
      table.timestamps();
    });
  });

  afterAll(async () => {
    await connection.close();
  });

  test("creates a user", async () => {
    const user = await User.create({ name: "Alice", email: "alice@example.com" });
    expect(user.id).toBeGreaterThan(0);
    expect(user.email).toBe("alice@example.com");
  });
});
```

Run with:

```bash
bun test
bun test tests/user.test.ts
bun test --watch
```

## In-memory SQLite

For unit tests, `sqlite://:memory:` is the right default — each connection has its own private database that disappears on close. Wrap setup in a helper:

```ts
// tests/helpers.ts
import { Connection, Model, Schema } from "@rekkr/orm";

export function setupTestDb() {
  const connection = new Connection({ url: "sqlite://:memory:" });
  Model.setConnection(connection);
  Schema.setConnection(connection);
  return connection;
}

export async function teardownTestDb(connection: Connection) {
  await connection.close();
}
```

Then in each suite:

```ts
import { beforeAll, afterAll } from "bun:test";
import { setupTestDb, teardownTestDb } from "./helpers";

let connection: ReturnType<typeof setupTestDb>;

beforeAll(async () => {
  connection = setupTestDb();
  // run any migrations or Schema.create calls
});

afterAll(async () => {
  await teardownTestDb(connection);
});
```

This is the same pattern ORM's own test suite uses — see `tests/helpers.ts` in the repository.

## Running real migrations in tests

For integration-style coverage, run your actual migrations rather than re-declaring schemas in test setup:

```ts
import { Migrator } from "@rekkr/orm";

beforeAll(async () => {
  const connection = setupTestDb();
  await new Migrator(connection, "./database/migrations").run();
});
```

Each test file then starts with the production schema. Pair with [`orm.fresh()`](./library-usage.md) or `migrator.fresh()` between suites for hard isolation.

## Seeding test data

Use [factories](./seeders.md#factories) to produce realistic fixtures inline without writing seeder files:

```ts
import { Factory } from "@rekkr/orm";
import User from "../src/models/User";

class UserFactory extends Factory<User> {
  definition(seq: number) {
    return { name: `User ${seq}`, email: `user${seq}@example.test` };
  }
}
Factory.register(User, UserFactory);

test("paginates users", async () => {
  await User.factory().count(50).createMany();
  const page = await User.orderBy("id").paginate(15, 1);
  expect(page.total).toBe(50);
  expect(page.data.length).toBe(15);
});
```

For shared fixtures across many tests, put a seeder under `tests/fixtures/` and invoke it from `beforeAll`:

```ts
import { SeederRunner } from "@rekkr/orm";
import UserFixtureSeeder from "./fixtures/UserFixtureSeeder";

beforeAll(async () => {
  setupTestDb();
  await new SeederRunner().run(UserFixtureSeeder);
});
```

## Transactional isolation

When the code under test only issues ordinary model or query-builder calls, the
fastest isolation strategy is to open a manual transaction before each test and
roll it back afterward:

```ts
import { afterEach, beforeEach } from "bun:test";

beforeEach(async () => {
  await connection.beginTransaction();
});

afterEach(async () => {
  await connection.rollback();
});
```

The next test starts with the original schema and seed data intact. Do not use
this harness when the code under test opens `DB.transaction()` or
`connection.transaction()` itself: a callback transaction cannot be opened on
top of an owned connection's manual root transaction. For those tests, use a
fresh in-memory database per test or wrap the complete test body in
`DB.transaction()` and deliberately throw a test-only sentinel at the end so
the outer callback rolls back; nested callback transactions then use
savepoints.

## Testing observers

Register observers in `beforeEach` and unregister in `afterEach` to avoid cross-test bleed:

```ts
import { beforeEach, afterEach } from "bun:test";
import { ObserverRegistry } from "@rekkr/orm";
import User from "../src/models/User";
import UserObserver from "../src/observers/UserObserver";

beforeEach(() => {
  UserObserver.observe(User);
});

afterEach(() => {
  ObserverRegistry.unregister(User);
});
```

See [Observers — Testing](./observers.md#testing-observers).

## Integration tests against PostgreSQL, MySQL, and Redis

For full-fidelity tests on Postgres or MySQL, point `setupTestDb()` at a real database. The repo's own integration suite uses an environment variable:

```ts
const url = process.env.POSTGRES_TEST_URL;
const runIfPostgres = url ? test : test.skip;

runIfPostgres("integration against Postgres", async () => {
  const connection = new Connection({ url });
  // …
});
```

The repository uses `POSTGRES_TEST_URL`, `MYSQL_TEST_URL`, and
`REDIS_TEST_URL` for its live integration suites. For example:

```bash
POSTGRES_TEST_URL=postgres://localhost/test_db bun test
MYSQL_TEST_URL=mysql://localhost/test_db bun test
REDIS_TEST_URL=redis://127.0.0.1:6379 bun test tests/redis.integration.test.ts
```

Each live suite is skipped when its URL is absent, so `bun test` remains usable
on machines that only have SQLite available.

## Common pitfalls

- **Leaking the SQLite file.** Use `sqlite://:memory:` for tests. A real file path persists between runs and produces stateful, hard-to-debug failures.
- **Forgetting to close connections.** A test that doesn't close its connection makes `bun test` hang at the end. Always close in `afterAll` (or rely on `setupTestDb` / `teardownTestDb`).
- **Cross-test observer state.** Observers register globally. Re-registering the same observer in `beforeEach` without unregistering in `afterEach` accumulates handlers and fires them multiple times.
- **Tenant context bleed.** If a test opens `DB.tenant(...)` and the callback throws before completing, the next test inherits no tenant — but a careless `TenantContext.run` outside a `try` block can mask failures. Wrap tenant flows in `try / finally`.
- **Concurrent tests sharing a connection.** Bun runs tests sequentially unless
  you opt into `--concurrent` or `--parallel`. If you enable either mode, give
  each test file its own connection and database.

## Where to next

- [Library Usage](./library-usage.md) — running migrations and seeders programmatically for test setup.
- [Seeders](./seeders.md) — factories and reusable fixture seeders.
- [Transactions](./transactions.md) — callback transactions, manual control,
  and the savepoints available to nested callback transactions.

## Required integration services

CI uses Bun 1.4.1 with SQLite, PostgreSQL 16, MySQL 8.4 and Redis 7. Run
`bun scripts/verify-services.ts` before `bun run build && bun run test`, with
`POSTGRES_TEST_URL`, `MYSQL_TEST_URL` and `REDIS_TEST_URL` set to dedicated test
services. Missing/unreachable required services fail preparation. `bun audit`
checks the development dependency graph too. Benchmarks run separately, without
the concurrent test suite competing for resources; see [history](../benchmarks/README.md).
