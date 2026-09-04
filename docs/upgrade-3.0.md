# Upgrading to 3.x

This guide applies when upgrading from 2.x, including to the first published
3.x release, v3.1.0.

Use Bun 1.4.1 or newer. This release retains Model, Builder, raw result objects,
relations, observers, mutable casts, dirty tracking and the manual transaction API.
The breaking changes below make resource ownership and tenant isolation explicit.

## Connections and tenants

DB, Schema, models, existing builders and native search engines resolve the active
connection for each operation. A bound object participates in a compatible
transaction. An object belonging to another tenant, database or active transaction
throws a context conflict instead of silently writing outside the intended scope.
Resolve a fresh model/builder inside the scope where it will be used.

```ts
await DB.tenant("acme", () => DB.transaction(async () => {
  await Invoice.create({ amount: "12.50" });
}));
```

Changing tenants inside a transaction is rejected for database, search_path and
RLS strategies. Reentering the same tenant reuses the scope. Schema + qualify may
switch schemas on the same pool's active transaction; both schemas then commit
or roll back together. Leaving for landlord while a tenant transaction is active
is rejected. There is no cross-database transaction or two-phase commit support.

FROM, JOIN and write targets use the effective schema; explicit qualified tables,
aliases, derived tables and CTE names retain their meaning. Raw SQL text remains
your responsibility: under qualify, write `tenant_schema.table` explicitly.

Objects returned by RLS/search_path scopes must be used after reentering the same
tenant; using their finished session outside that scope throws. Ordinary committed
transaction objects can reconnect to their parent pool. Query namespaces for
SQLite `:memory:` pools are process-local because each pool represents a different
database; network and file database namespaces remain stable across processes.

## Commit effects

Search observers and both job dispatch APIs now deliver after a successful root
commit. Their payload and tenant are captured when registered. Validation and
transformation hooks still run during the write. Nested savepoints merge effects
on release and discard them on rollback; the manual API has the same behavior.

```ts
import { DB, AfterCommitError } from "@rekkr/orm";
try {
  await DB.transaction(async () => {
    await Invoice.create({ amount: "12.50" });
    await DB.afterCommit(() => invalidateInvoiceSummary());
  });
} catch (error) {
  if (error instanceof AfterCommitError) {
    // error.committed === true; inspect error.errors and retry delivery only.
    // Repeating the transaction would repeat already committed writes.
  } else throw error;
}
```

`Connection.afterCommit()` and `DB.afterCommit()` execute immediately without a
transaction. Deferred callbacks run in registration order, outside transaction
and tenant context. Search restores its captured tenant; queue writes to its
captured landlord driver and includes the tenant in the worker payload. Generic
callbacks should explicitly enter a tenant if needed. Every callback is attempted;
post-commit errors are aggregated with `committed: true`.

This is in-process delivery, not a durable outbox. A process crash after COMMIT
can lose effects. Handlers still need appropriate idempotency.

## Configuration and ownership

`configureOrm(config)` initializes once. Use `await reconfigureOrm(config)` for a
replacement, outside an active ORM scope. It validates the next configuration,
rejects new work in the retiring state, drains existing scopes/queries/transactions
and search batches, closes owned resources, clears omitted cache/queue/search/
tenancy settings, and installs the new state. Concurrent reconfigurations reject.
Validation failure preserves the old state. Cleanup failure throws and leaves the
old resources retired; fix the cause and retry `reconfigureOrm` or `closeAll`.

`await ConnectionManager.setTenantResolver(resolver)` now retires earlier tenant
contexts and invalidates older in-flight resolutions. Always await it.

Connections created from configuration are owned. Instances passed to
`ConnectionManager.add` or `setDefault` are borrowed by default and remain open
when the manager closes. Transfer ownership explicitly with `{ owned: true }`.
Custom cache, queue and search clients are borrowed; their owner closes them.

Tenant TTL measures inactivity. Queries and active scopes/transactions hold leases;
finishing work restarts the idle period. A stored model reference does not hold a
lease. After an owned pool expires, resolve a fresh builder/model in a new tenant
scope instead of reusing its retired connection.

## Query cache and Redis cache storage

`remember(key)` and `cacheTags(tag)` now namespace both keys and tags by tenant,
logical connection configuration and schema. Invalidation uses the same namespace:

```ts
await DB.tenant("acme", async () => {
  await Invoice.query().remember("invoices").cacheTags("invoices").get();
  await Cache.forgetQuery("invoices");
  await Cache.forgetQueryTag("invoices");
});
```

Pass a Connection as the second argument to select a namespace explicitly.
`Cache.queryKey(key, connection)` exposes its derived key. Generic `Cache.get`,
`set`, `forget` and `forgetTag` remain global APIs and do not acquire a tenant
namespace automatically. Queries inside transactions bypass result caching.

Retire old query keys and tags during deployment. Redis tag storage now uses
sorted sets and reverse associations, so **use a fresh Redis cache prefix or flush
the old cache namespace before starting v3 writers**. Do not run v2/v3 cache writers
against the same prefix. This concerns cache keys, not the queue namespace.

Built-in stores distinguish a cached `null` from a miss in `Cache.remember` while
`get()` still returns `T | null`. Custom stores can implement the optional atomic
`lookup(key): Promise<{ hit: boolean; value: T | null }>` contract for null hits.

## Queue workers

Stop and drain all v2 workers before migrating. Run the v3 driver's `migrate()`
(`await Queue.getDriver().migrate()` after configuration) once, then start only v3 workers. The database migration
adds nullable `reservation_token` without removing pending jobs. Redis pending
hashes are upgraded on acquisition; existing reservations can expire normally.
A v2 worker acknowledges by id and cannot coexist safely with token-aware workers.

Custom drivers must return `JobRecord.reservationToken`, assign a new unpredictable
token on every acquisition, and implement these conditional, atomic operations:

```ts
complete(id, token): Promise<boolean>;
fail(id, token, exception): Promise<boolean>;
release(id, token, delaySeconds): Promise<boolean>;
heartbeat(id, token): Promise<boolean>;
```

`false` means the reservation is no longer owned. A stale owner cannot acknowledge,
release, bury, or extend a newer reservation. Workers renew during `handle()` and
stop renewing after completion, lease loss or renewal failure. Lease loss does not
cancel JavaScript already running and cannot undo its external effects.

The Redis drivers support standalone Redis. Redis Cluster is not supported or
verified; changing a prefix alone does not make the multi-key scripts compatible.

## SQL fragments and write counts

Tagged fragments are additive; existing string/bindings signatures still work.

```ts
import { sql } from "@rekkr/orm";
const predicate = sql`payload ? ${"email"}`;
const query = User.query().whereRaw(sql`${predicate} AND enabled = ${true}`);
```

Use fragments in selectRaw, whereRaw, orderByRaw, groupByRaw, havingRaw and EXISTS
conditions, including their OR variants. Nested fragments retain text/value
boundaries; interpolated builders become parenthesized subqueries. Values become
bindings, never identifiers or executable SQL. PostgreSQL operators, comments and
literal question marks stay intact. Legacy string + bindings still interprets
each `?` as a placeholder when bindings are supplied.

Write methods keep their original driver result. Use
`connection.affectedRows(result)` for the driver-specific metadata field. MySQL
counts changed rows, while PostgreSQL/SQLite can count matched rows for no-op
UPDATEs; this helper does not make those semantics identical.

## SvelteKit, policies and migrations

Policy methods retain `this`. Extended users are assigned back to
`event.locals.user`, including when the original object is frozen.

Validation failures omit submitted values by default. Opt in per endpoint with
`.action(handler, { includeValues: true })` or
`.request(handler, { includeValues: true })`; review fields such as passwords
before returning them. Custom response formatters receive the same opted-in data.

MySQL DDL commits implicitly. A failed migration batch can leave schema changes
without matching history rows; `rollback` cannot restore transactional atomicity.
Inspect both schema and migration history, restore a backup or repair the partial
migration, then rerun it. See [migrations](migrations.md).

## Runtime and development dependencies

The supported Bun minimum is 1.4.1. The development stack pins Bun 1.4.1 and
updates SvelteKit/Vite and transitive dependencies. The `cookie` override keeps a
patched 0.7.x implementation while SvelteKit still declares 0.6.x. No runtime
dependency was added. See [verification](../benchmarks/v3-verification.md).
