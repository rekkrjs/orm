# Database Transactions

A transaction groups a series of database operations so they either all succeed or all roll back. Use one whenever a single logical change requires more than one write — transferring money, copying related rows, or persisting a model with its dependents.

ORM exposes transactions through the `DB` facade and directly on a
`Connection`. Both install the transaction in the current async context, so
unbound model and `DB` queries inside the callback share it automatically.

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

Binding explicitly with `Model.on(tx)` still works and is still the right tool
when a query must target a specific connection regardless of context.

A package that is handed a `Connection` and never sees the caller's `tx` handle
reads the context directly, resolving per call rather than capturing at
construction:

```ts
import { TransactionContext, type Connection } from "@rekkr/orm";

class ReportStore {
  constructor(private readonly connection: Connection) {}

  private resolve(): Connection {
    return TransactionContext.current() ?? this.connection;
  }

  save(row: ReportRow) {
    return new Builder(this.resolve(), "reports").insert(row);
  }
}
```

Without `resolve()`, the store writes on the pooled connection and its rows
survive the caller's rollback on MySQL and PostgreSQL — while appearing correct
on SQLite, where a single connection hides the difference.

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
