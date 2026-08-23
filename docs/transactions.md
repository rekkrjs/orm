# Database Transactions

A transaction groups a series of database operations so they either all succeed or all roll back. Use one whenever a single logical change requires more than one write — transferring money, copying related rows, or persisting a model with its dependents.

ORM exposes transactions on the `Connection`. Models reach the connection through `Model.getConnection()`, or via the facade returned by `configureOrm()`.

## The callback form (recommended)

`connection.transaction(callback)` opens a transaction, calls your callback, and commits on success. If the callback throws, the transaction is rolled back and the error propagates out:

```ts
import { Model } from "@rekkr/orm";
import User from "./models/User";
import Wallet from "./models/Wallet";

const connection = Model.getConnection();

await connection.transaction(async (tx) => {
  const sender = await User.find(1);
  const receiver = await User.find(2);

  sender!.balance -= 100;
  receiver!.balance += 100;

  await sender!.save();
  await receiver!.save();

  await Wallet.create({ user_id: sender!.id, debit: 100 });
  await Wallet.create({ user_id: receiver!.id, credit: 100 });
});
```

If PostgreSQL detects a deferred unique or primary-key violation only while
committing, ORM rolls the transaction back and throws the same
[`UniqueConstraintViolationError`](./configuration.md#unique-constraint-errors)
used for an immediate duplicate write. This applies to both callback and
manual transactions.

The `tx` argument is a `Connection` scoped to the transaction. Any models or builder calls made inside the callback automatically use this connection — you do not need to thread `tx` through your code unless you want to.

## Nested transactions (savepoints)

ORM tracks transaction depth and uses savepoints for nested calls. The outer transaction commits or rolls back the whole stack; an inner failure rolls back only the inner savepoint:

```ts
await connection.transaction(async () => {
  await User.create({ name: "Alice" });

  try {
    await connection.transaction(async () => {
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

`beginTransaction`, `commit`, and `rollback` honor the same nested savepoint behavior as the callback form. `connection.inTransaction()` returns true while a transaction is open.

> **Always pair `beginTransaction()` with a `commit()`/`rollback()` in `try/catch`.** `beginTransaction()` reserves a pooled connection; a path that throws before `commit()` without a `rollback()` would otherwise leak that connection. As a safety net, an abandoned manual transaction (no `commit`/`rollback`) is force-rolled-back and its connection released after `transactions.abandonedTimeoutMs` (default 60s — see [Configuration](./configuration.md#transactions)). The safety net is a backstop, not a substitute for correct `try/catch`; prefer the callback form, which releases automatically.

## Locking inside a transaction

Pessimistic locks (`lockForUpdate`, `sharedLock`) release on commit or rollback, so they only make sense inside a transaction:

```ts
await connection.transaction(async () => {
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

Inside [`DB.tenant()`](./query-builder.md#multi-tenant-scope), the active connection is the tenant-scoped one — `connection.transaction()` opens a transaction against that tenant only. Be careful when mixing tenants in a single transaction; most drivers do not allow cross-database two-phase commit:

```ts
await DB.tenant("acme", async () => {
  await connection.transaction(async () => {
    await User.create({ name: "Alice" });   // tenant_acme
    await User.update({ active: true });    // tenant_acme
  });
});
```

For the schema-qualify strategy, all tables are in the same physical database, so transactions work normally.

## Common pitfalls

- **Forgetting to `await`.** A missing `await` on `transaction(...)` means the next line runs outside the transaction. The transaction commits on the rejected promise's resolution — typically with a partial result.
- **Throwing inside the callback aborts the whole tree.** Wrap nested transactions in `try / catch` if you want inner failures to be swallowed; otherwise the outer transaction rolls back too.
- **Locks outside a transaction are no-ops.** `lockForUpdate` releases at commit; without an enclosing `transaction(...)`, there's nothing to release against and other sessions are not blocked.
- **Connection pool exhaustion.** Each open transaction holds a connection. Don't sleep, fetch, or wait on user input inside a transaction — finish the SQL work and exit quickly.
- **`Connection.logQueries` inside long transactions.** Logging works as usual, but very large transactions can flood logs. Disable temporarily with `connection.logQueries = false` around batch work.

## Where to next

- [Query Builder — Locking](./query-builder.md#locking) — `lockForUpdate`, `sharedLock`, `skipLocked`, `noWait`.
- [Models](./models.md#crud) — `save()`, `delete()`, and bulk operations inside transactions.
- [Multi-tenant scope](./query-builder.md#multi-tenant-scope) — how tenant context selects the active connection.
