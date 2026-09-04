# Database Transactions

A transaction groups a series of database operations so they either all succeed or all roll back. Use one whenever a single logical change requires more than one write — transferring money, copying related rows, or persisting a model with its dependents.

ORM exposes transactions through the `DB` facade and directly on a
`Connection`. Both install the transaction in the current async context, so
compatible bound models, builders, connections and `DB` queries inside the callback share it automatically.

## The callback form (recommended)

`DB.transaction(callback)` opens a transaction, calls your callback, and
commits on success. If the callback throws, the transaction is rolled back and
the error propagates out:

```ts
import { DB, Model } from "@rekkr/orm";
import User from "./models/User";
import Wallet from "./models/Wallet";

await DB.transaction(async () => {
  const sender = await User.findOrFail(1);
  const receiver = await User.findOrFail(2);

  sender.balance -= 100;
  receiver.balance += 100;

  await sender.save();
  await receiver.save();

  await Wallet.create({ user_id: sender.id, debit: 100 });
  await Wallet.create({ user_id: receiver.id, credit: 100 });
});
```

If PostgreSQL detects a deferred unique or primary-key violation only while
committing, ORM rolls the transaction back and throws the same
[`UniqueConstraintViolationError`](./configuration.md#unique-constraint-errors)
used for an immediate duplicate write. This applies to both callback and
manual transactions.

`DB.transaction()` installs the transaction connection in the current async
context, so model and `DB` queries inside the callback use it automatically.

`connection.transaction()` is the lower-level form and behaves the same way: it
passes a scoped `tx` connection to the callback **and** installs it in the async
context, so unbound queries inside join the transaction too. Use it when you
already hold a `Connection` and do not want to go through the `DB` facade.

```ts
await connection.transaction(async (tx) => {
  const user = await User.findOrFail(1); // joins tx through the async context
  user.active = true;
  await user.save();

  await User.on(tx).where("id", 2).update({ active: true }); // explicit, also fine
});
```

`Model.on(tx)` binds explicitly and validates compatibility with the active
context. An incompatible resource or active transaction throws.

A package can keep its original Connection and rely on the same per-operation
resolution as DB and models:

```ts
import { Builder, type Connection } from "@rekkr/orm";

class ReportStore {
  constructor(private readonly connection: Connection) {}
  save(row: ReportRow) {
    return new Builder(this.connection, "reports").insert(row);
  }
}
```

The bound connection joins a compatible ambient transaction on all three engines.
It cannot silently escape rollback or redirect an explicit different database.

## Nested transactions (savepoints)

ORM tracks transaction depth and uses savepoints for nested calls. The outer transaction commits or rolls back the whole stack; an inner failure rolls back only the inner savepoint:

```ts
await DB.transaction(async () => {
  await User.create({ name: "Alice" });

  try {
    await DB.transaction(async () => {
      await User.create({ name: "Bob" });
      throw new Error("nope");      // → rolls back only Bob
    });
  } catch {}

  await User.create({ name: "Carol" });
});
// Result: Alice and Carol committed, Bob never inserted
```

This is the right pattern for sub-routines that may fail but shouldn't abort the surrounding work — for example, optimistically writing an audit log entry that's allowed to fail.

## Manual control

When the callback form doesn't fit (long-running interactive sessions, complex error mapping), drive the lifecycle yourself:

```ts
const connection = Model.getConnection();

await connection.beginTransaction();
try {
  await User.create({ name: "Alice" });
  await User.create({ name: "Bob" });
  await connection.commit();
} catch (err) {
  await connection.rollback();
  throw err;
}
```

`beginTransaction`, `commit`, and `rollback` honor the same nested savepoint behavior as the callback form. `connection.isInTransaction()` returns true while a transaction is open.

> **Always pair `beginTransaction()` with a `commit()`/`rollback()` in `try/catch`.** `beginTransaction()` reserves a pooled connection; a path that throws before `commit()` without a `rollback()` would otherwise leak that connection. As a safety net, an abandoned manual transaction (no `commit`/`rollback`) is force-rolled-back and its connection released after `transactions.abandonedTimeoutMs` (default 60s — see [Configuration](./configuration.md#transactions)). The safety net is a backstop, not a substitute for correct `try/catch`; prefer the callback form, which releases automatically.

## Locking inside a transaction

Pessimistic locks (`lockForUpdate`, `sharedLock`) release on commit or rollback, so they only make sense inside a transaction:

```ts
await DB.transaction(async () => {
  const job = await Job
    .where("status", "pending")
    .orderBy("created_at")
    .limit(1)
    .lockForUpdate()
    .skipLocked()
    .first();

  if (!job) return;

  job.status = "running";
  await job.save();
});
```

See [Query Builder — Locking](./query-builder.md#locking) for the full reference.

## Transactions and tenancy

Inside [`DB.tenant()`](./query-builder.md#multi-tenant-scope),
`DB.transaction()` resolves the tenant-scoped connection and opens a
transaction against that tenant only. Be careful when mixing tenants in a
single transaction; most drivers do not allow cross-database two-phase commit:

```ts
await DB.tenant("acme", async () => {
  await DB.transaction(async () => {
    await User.create({ name: "Alice" });   // tenant_acme
    await User.update({ active: true });    // tenant_acme
  });
});
```

For the schema-qualify strategy, all tables are in the same physical database, so transactions work normally.

## Common pitfalls

- **Forgetting to `await`.** A missing `await` on `transaction(...)` lets the
  caller continue before commit or rollback finishes, and a later rejection can
  become unhandled.
- **A package that captures a `Connection` at construction.** It writes on the
  pooled connection and escapes the caller's transaction. Resolve per call with
  `TransactionContext.current() ?? this.connection`.
- **`beginTransaction()` and unbound queries on another connection object.**
  The manual form reserves the driver on the connection it is called on and
  installs no async context, so unbound queries follow the default connection.
  That is the same object in a single-connection setup and a different one
  otherwise. Prefer the callback form.
- **Throwing inside the callback aborts the whole tree.** Wrap nested transactions in `try / catch` if you want inner failures to be swallowed; otherwise the outer transaction rolls back too.
- **Locks outside a transaction are no-ops.** `lockForUpdate` releases at commit; without an enclosing `transaction(...)`, there's nothing to release against and other sessions are not blocked.
- **Connection pool exhaustion.** Each open transaction holds a connection. Don't sleep, fetch, or wait on user input inside a transaction — finish the SQL work and exit quickly.
- **`Connection.logQueries` inside long transactions.** Logging works as usual, but very large transactions can flood logs. Disable temporarily with `connection.logQueries = false` around batch work.

## Where to next

- [Query Builder — Locking](./query-builder.md#locking) — `lockForUpdate`, `sharedLock`, `skipLocked`, `noWait`.
- [Models](./models.md#crud) — `save()`, `delete()`, and bulk operations inside transactions.
- [Multi-tenant scope](./query-builder.md#multi-tenant-scope) — how tenant context selects the active connection.

## Effects after commit

```ts
import { DB, AfterCommitError } from "@rekkr/orm";

try {
  await DB.transaction(async () => {
    await User.create({ name: "Ada" });
    await DB.afterCommit(() => notifyDirectory());
  });
} catch (error) {
  if (error instanceof AfterCommitError) {
    // error.committed === true: retry delivery, never the confirmed write.
    console.error(error.errors);
  } else throw error;
}
```

`connection.afterCommit(cb)` and the exported `afterCommit(cb)` share this contract,
including manual transactions. Outside a transaction, they await the callback
immediately. Root COMMIT must finish first. Savepoint release merges callbacks;
savepoint/root rollback discards them. Callbacks run in registration order outside
the transaction/tenant context, all are attempted, and failures are aggregated in
`AfterCommitError` with `committed: true`.

Queue dispatch and search observers capture payload, destination and tenant at
registration and use this mechanism automatically. Validation and transformation
hooks still run with the write. This is in-process delivery, without a durable
outbox or crash recovery guarantee.

Switching tenants inside a transaction rejects, except schema/qualify scopes on
the same physical transaction. Connections bound to a different resource or active
transaction reject too. Raw SQL uses the effective connection but requires explicit
schema names under qualify. Objects from finished RLS/search_path scopes require
reentering their tenant before reuse. See [migration examples](./upgrade-3.0.md).
