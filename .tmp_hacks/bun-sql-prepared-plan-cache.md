# The PostgreSQL `prepare: false` default

> **This document describes a temporary hack.** It exists so that whoever reads
> it after Bun ships a fix can verify that the fix landed and restore Bun's
> default cleanly. If you only want the removal steps, jump to
> [Retiring the workaround](#retiring-the-workaround).

- **Status:** active; `createDriver()` in `src/connection/drivers/SqlDriver.ts`
  defaults PostgreSQL to `prepare: false` on both runtimes.
- **Last reviewed:** 2026-09-26
- **Affects:** PostgreSQL only. MySQL re-prepares a statement itself when a
  table's metadata changes, and SQLite prepares nothing across calls.
- **Verified with:** Bun 1.4.2 (`744846f84`), PostgreSQL 18.6, macOS arm64.
  Node.js 26.10 with `pg` behaves the same way (see [Node.js](#nodejs)).
- **Upstream:** [oven-sh/bun#29484](https://github.com/oven-sh/bun/issues/29484),
  filed 2026-04-19 on Bun 1.3.12. We added a Bun 1.4.2 reproduction and the
  postgres.js comparison in
  [a comment](https://github.com/oven-sh/bun/issues/29484#issuecomment-5848788647)
  on 2026-09-26. **Fix pending:** [oven-sh/bun#35120](https://github.com/oven-sh/bun/pull/35120),
  opened 2026-07-22 by `robobun` and last updated 2026-09-06, is open and
  awaiting review. Its build passes the probe (see [The fix in review](#the-fix-in-review)).
  The probe, not the issue's or the PR's state, decides when the default can
  change.

## The symptom

With `prepare: true`, a `SELECT *` that a pooled connection has already run
starts failing once a migration adds a column to its table:

```
PostgresError: cached plan must not change result type
    errno: "0A000",
  routine: "RevalidateCachedQuery",
```

Retrying does not help. Every later run of that statement on that connection
fails the same way until the connection closes. In a rolling deploy, every
process still running the old code breaks on that query until it restarts.
Model queries are `SELECT * FROM …`, so `ADD COLUMN`, the most common
migration, is enough to trigger it.

## The cause

The server and the driver each play a part.

- **PostgreSQL raises the error.** After DDL it replans cached statements on
  its own, but it refuses to change the *result shape* of a statement that is
  already prepared. The client received that shape when it prepared the
  statement, and the protocol has no way to announce a new one. Inside a
  transaction the error aborts the transaction, like any other error (the next
  statement gets `25P02`).
- **The driver decides whether it stays broken.** The fix is to drop the
  statement and prepare it again. postgres.js 3.4.7 does this: it deletes the
  cached statement and retries once when the error's routine is
  `RevalidateCachedQuery` (`retryRoutines` in its `src/connection.js`).
  Outside a transaction the caller never sees the error. Inside one the error
  is surfaced, but the next query and the next transaction work. `bun:sql`
  keeps the stale statement, and offers neither a per-query `prepare` option
  nor a way to evict one, so the ORM cannot recover on its behalf.

`bun:sql`'s `unsafe()` prepares whenever it has parameters. postgres.js's
`unsafe()` does not prepare unless it is passed `{ prepare: true }`. Everything
this ORM sends goes through `unsafe()`, so on Bun every bound statement would be
a named, cached one.

Drizzle runs on `bun:sql` with prepared statements and survives `ADD COLUMN`
only because it lists the columns explicitly (`select "id", "name" …`). It still
breaks when the type of a column it reads changes.

### What the default costs

This is what `prepare: false` gives up. Measured with `tmp_agents/prof/probe2.mjs`
(500 users, 1,000 posts, PostgreSQL 18.6 locally, three fresh processes per
cell), in time per operation (**lower is better**):

| Operation | Bun `false` → `true` | Node.js `false` → `true` |
| --- | ---: | ---: |
| `User.create()` | 61.9 → 53.9 µs (−13 %) | 73.8 → 64.4 µs (−13 %) |
| `where('id').update()` | 52.4 → 45.5 µs (−13 %) | 54.5 → 47.1 µs (−14 %) |
| Eager `.json()`, 500 + 1,000 rows | 3.02 → 2.60 ms (−13 %) | 3.76 → 3.22 ms (−14 %) |

The eager case gains the most because its `WHERE … IN` list of 500 parameters
is parsed and planned on every run. The full comparison with Drizzle and Guren
is in `tmp/bench_drizzle2.md`, which is local and not versioned.

## What the workaround does

`createDriver()` passes `prepare: false` to `bun:sql`, and to the `pg`
adapter, unless the connection config sets `prepare`. Statements then run
unnamed and are planned on every execution, so no plan outlives a schema change.
`docs/configuration.md` documents the default and how to opt in.

## Node.js

`pg` has the same gap: it caches named statements per client and does not
recover from `0A000`. Recovering in the adapter would mean editing `pg`'s
internal cache (`client.connection.parsedStatements`). Discarding the session
instead would lose its `SET` values, `search_path` and advisory locks, which is
exactly what the manual checkout in `nodeDrivers.ts` exists to keep. A Bun fix
therefore does **not** retire the default on Node.js.

## Is Bun fixed yet?

Run the probe against a PostgreSQL server:

```console
$ bun scripts/bun-sql-prepared-plan-probe.ts postgres://postgres@127.0.0.1:5432/test
```

- **Exit 3:** `bun:sql` re-prepared the statement outside a transaction, and the
  query after a failed transaction worked. Bun is fixed.
- **Exit 0:** a cached plan keeps failing on its connection. On Bun 1.4.2 the
  three verdict lines report `0A000`.
- **Exit 1:** the server could not be reached, or the table could not be
  created. Nothing was learned.

The error inside the transaction is expected even when Bun is fixed and is not
part of the verdict. Neither is the last line, which counts how many of 10
concurrent runs fail right after `ADD COLUMN`, and then in the next burst
(see [The fix in review](#the-fix-in-review)). The probe uses one connection and a table of its own,
which it drops at the end. Run it after every Bun upgrade.

## The fix in review

PR [#35120](https://github.com/oven-sh/bun/pull/35120) evicts a cached
statement on `26000`, or on `0A000` from `RevalidateCachedQuery`. When the
connection is idle and that exchange is the only one in flight, it re-prepares
the statement under a fresh name and retries once. Inside a transaction it
surfaces the error and still evicts the statement, so the connection recovers
after `ROLLBACK`. Beyond our case, it also covers `DEALLOCATE ALL` /
`DISCARD ALL` and a pooler swapping the backend (`26000`).

Its build for commit `fb3fd16` (`1.4.3-canary.1+fb3fd16d4`, fetched with
`bunx bun-pr 35120`) was run on 2026-09-26 against PostgreSQL 18.6:

- The probe exits **3**: both runs outside a transaction work, the one inside
  fails with `0A000` as expected, and the next query works.
- **Concurrent runs still fail once.** The PR states it: executions of the stale
  statement already pipelined on the connection when the error arrives are
  rejected, and only the cache is fixed. Measured with 20 concurrent runs
  right after `ADD COLUMN`, three times each: 19 of 20 failed with one
  connection, 16 of 20 with four (all but one per connection). The next burst
  had 0 failures. On Bun 1.4.2 every run fails, in every burst. The probe
  prints this as an informational line (9/10, then 0/10 on the PR build).
- **postgres.js 3.4.7 is no model here.** It retries sequential runs, but with
  as few as two concurrent runs of a stale statement it hangs: nothing settled
  within 5 s, with one connection or with four.

So even with the fix, a migration that adds a column fails the requests that
are in flight on that table at that moment, once per connection. Weigh that
before changing the default. We posted these numbers, and asked whether the
pipelined requests could be retried too, in
[a comment on the PR](https://github.com/oven-sh/bun/pull/35120#issuecomment-5848895365)
on 2026-09-26.

## Retiring the workaround

1. Confirm exit 3 with the probe on the **released** Bun version you intend to
   ship (not a PR build), and record that version in the commit message.
   Check the informational concurrency line too: if it still fails once per
   connection, the changelog entry must say so.
2. In `createDriver()`, stop defaulting PostgreSQL to `false` **on Bun only**,
   and remove the `WORKAROUND(bun-sql-prepared-plan-cache)` marker. Find it with
   `rg -n "WORKAROUND\(bun-sql-prepared-plan-cache\)" src/`. Node.js keeps
   `false` until the `pg` adapter can recover too (see [Node.js](#nodejs)).
3. Add a regression test on Bun: prepare a `SELECT *`, `ADD COLUMN`, and assert
   that the next model query returns the new column.
4. Document it in `docs/configuration.md` and the CHANGELOG. The error can still
   surface inside a transaction that meets a stale plan, as it does in Rails and
   postgres.js; retrying the transaction works. Users behind PgBouncer in
   transaction mode without prepared-statement support need `prepare: false`
   whatever Bun does.
5. Delete `scripts/bun-sql-prepared-plan-probe.ts` and this file.
