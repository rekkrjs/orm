# The Bun MySQL event-loop workaround

> **This document describes a temporary hack.** It exists so that whoever reads
> it after Bun ships a fix can verify that the fix landed and delete the hack
> cleanly. If you only want the removal steps, jump to
> [Retiring the workaround](#retiring-the-workaround).

- **Status:** active workaround
- **Last reviewed:** 2026-09-04
- **Affects:** MySQL only. SQLite and PostgreSQL are unaffected.
- **Verified with:** Bun 1.4.1 (`4661e494f`) and 1.4.0 (`34cbb9a40`),
  MySQL 9.7.1, macOS arm64
- **Upstream:** [oven-sh/bun#27362](https://github.com/oven-sh/bun/issues/27362)
  documents the same timer workaround but for sequential remote queries and is
  closed as a duplicate; [oven-sh/bun#27102](https://github.com/oven-sh/bun/issues/27102)
  is the related open MySQL connection/transaction report, not an exact report
  of the local `reserve()` trigger; [oven-sh/bun#26235](https://github.com/oven-sh/bun/issues/26235)
  covers the now-flaky pooled-query shape. The exact minimal `reserve()` and
  second-client reproductions below do not currently have their own upstream
  issue, so the probe — not an issue label — decides when removal is safe.

## The symptom

A MySQL command produces **no output and exits with code 0** while having done
only part of its work. It was first seen on the CLI:

```console
$ DB_CONNECTION=mysql orm migrate:status
$ echo $?
0
```

No table, no error, no stack trace — and a green exit code. The same command on
SQLite works. `migrate`, `migrate:status` and `migrate:rollback` were all
affected, because the truncation happens in the startup path they share.

It is not a CLI problem. Any program that awaits an ORM call and does not hold
the event loop open some other way is exposed. The shortest reproduction goes
through the plain query builder:

```ts
const id   = await new Builder(connection, "widgets").insertGetId({ name: "x" });
const rows = await connection.query("SELECT COUNT(*) AS n FROM widgets");
console.log(rows);   // never printed; process exits 0
```

`insertGetId` on MySQL reserves a pooled session to read `LAST_INSERT_ID()` on
the same connection. That is enough to arm the bug: the row is inserted, the
`SELECT` after it never comes back, `close()` never runs, and the process exits
successfully. A seeder or a deploy script written that way silently does half
its job and reports success.

## The cause

It is a Bun bug, not an ORM bug, and it is not a deadlock.

Bun stops holding the event loop open for an in-flight MySQL query as soon as
that client's pool has had **more than one connection in play** — a second
`new SQL()`, a `reserve()`, or simply two concurrent queries. The query itself
is fine: the server answers and the bytes arrive. What goes missing is the
reference that tells Bun "there is still work pending". With nothing else
referenced, the loop drains, `beforeExit` fires with code 0, and the process
exits while the query's promise is still unsettled. Every `await` after it is
simply never reached.

Twelve lines, no ORM:

```ts
import { SQL } from "bun";

const a = new SQL({ adapter: "mysql", hostname: "127.0.0.1", port: 3306,
                    database: "test", username: "root", password: "" });

async function main() {
  await a.unsafe("SELECT 1");
  (await a.reserve()).release();            // or a.begin(), or a second client
  console.log(await a.unsafe("SELECT 2"));  // never resolves
}

main().catch(console.error);   // no output, exit 0
```

### Not one bug, and not all fixed at once

The observed triggers do not all become reliable at once, which matters for
deciding when the workaround can go:

| Trigger | Bun 1.4.0 | Bun 1.4.1 |
|---|---|---|
| `reserve()` → `release()` → query | truncates every time | truncates every time |
| `begin()` → query | truncates every time | truncates every time |
| second `new SQL()` → query on the first | truncates every time | truncates every time |
| two concurrent queries → a third | **flaky** — resolved 2/6 | **flaky** — resolved 3/20 |

The last row is the shape of #26235 and it is the dangerous one to test with:
on a lucky run it looks fixed. The first three are what the ORM leans on —
`insertGetId()` reserves, `transaction()` calls `begin()`, the migration lock
opens a second client — and they are still broken outright.

### What was measured

Every row below was run against a local MySQL 9.7 on Bun 1.4.0, with the
promise floated (`main().catch(...)`) unless stated otherwise.

| Scenario | Result |
|---|---|
| One client, one query | completes |
| One client, two sequential queries | completes |
| One client, second client constructed but never used | completes |
| Query on A → query on a second client B → query on A again | **truncated** |
| Both clients constructed up front, then A → B → A | **truncated** |
| Query on A → `A.reserve()` → `release()` → query on A | **truncated** |
| Query on A → `A.begin(...)` → query on A | **truncated** |
| One client with `max: 2`, two concurrent queries, then a third | **flaky** (2/6 completed) |
| Query on A → query on B → third query on **B** | completes |
| First query on B (A never used before B) | completes |
| Any truncating scenario, plus a ref'd `setInterval` in the loop | completes |
| Any truncating scenario, with top-level `await main()` instead of floating | completes |
| Every scenario on PostgreSQL | completes |

Two of those rows are what the workaround is built on: **a ref'd timer is
enough to keep the loop alive**, and **the query completes normally once it
is** — so nothing is stuck, only unreferenced.

Note the diagnosis this rules out: the lock's second connection, query logging
being off, and `Schema.hasTable` are all innocent. They were the visible
context in the first CLI report, not the cause. Query logging appearing to
"fix" it was a red herring — with stdout on a pipe, a `console.log` immediately
before the query does not mask the truncation.

Also note why the test suite never caught it: `tests/driver-harness.ts` builds
MySQL contexts with `max: 1`, which mostly keeps a single socket in play.

## What the workaround does

`src/connection/Connection.ts` adds the reference Bun fails to take.

- A process-wide counter and one `setInterval` handle, plus the public
  `Connection.keepMysqlEventLoopAlive` escape hatch, all inside the block marked
  `WORKAROUND(bun-mysql-eventloop)`.
- `private async keepEventLoopAlive<T>(operation)` — runs one driver operation
  with a ref'd timer registered for its duration. It is a no-op on SQLite and
  PostgreSQL, and when the escape hatch is off.
- **26 call sites**, each wrapping a single driver operation:
  `execute()`, `runAndGetMysqlInsertId()`, `assertMysqlUtc()`,
  `reserveRootTransaction()`, `beginTransaction()`, `commit()`, `rollback()`,
  the abandoned-transaction rollback, `transaction()` (both the savepoint path
  and `driver.begin()`), and `close()`.

The timer's delay is `2 ** 31 - 1` ms — the largest a timer accepts, so it never
fires. It exists only to be counted. Cost while idle is zero: no wakeups, one
timer object, and it is cleared as soon as the last in-flight operation
settles, so a finished program still exits immediately.

Wrapping `driver.begin()` holds the loop for the whole transaction callback.
That is deliberate: a process must not be allowed to exit in the middle of an
open transaction, which is exactly what this bug did.

`bin/orm.ts` also runs `await main()` at top level instead of
`main().catch(...)`. A pending top-level await is itself a reference Bun counts,
so the CLI cannot drain the loop and exit 0 mid-command. That is a second line
of defence and is worth keeping on its own merits, but it only protects the
CLI — the fix that protects library users is the one in `Connection`.

The sqlite pragma statements in `applySqliteDefaults()` are deliberately left
unwrapped: they only ever run on SQLite, where the guard would be a no-op.

## Is Bun fixed yet?

Run the probe. It shells out to a child process per attempt, reproducing the raw
Bun behaviour with no ORM involved, and tries **all four triggers twenty times
each**. The pooled trigger resolved 2/6 times on a broken runtime, so three
attempts still left a material chance of a lucky false `FIXED`; twenty keeps the
manual probe reasonably quick while making that outcome negligible:

```console
$ bun scripts/bun-mysql-eventloop-probe.ts mysql://root@127.0.0.1:3306/test
bun 1.4.1 (4661e494f)
  reserve/release   0/20 resolved  TRUNCATED
  transaction       0/20 resolved  TRUNCATED
  second client     0/20 resolved  TRUNCATED
  pooled queries    3/20 resolved  TRUNCATED

STILL BROKEN — 4 of 4 triggers truncate.
```

- exit **0** — at least one trigger still truncates; keep the workaround.
- exit **3** — every trigger resolved, every time; the workaround can be retired.
- exit **1** — the probe could not reach the server; nothing was learned.

Worth running after every Bun upgrade. Note that the probe tests Bun itself, so
it is unaffected by `Connection.keepMysqlEventLoopAlive`.

## Retiring the workaround

1. Confirm with the probe above (exit 3) on the Bun version you intend to ship.
   Record that version in the commit message.
2. In `src/connection/Connection.ts`:
   - delete the `WORKAROUND(bun-mysql-eventloop)` comment block, the
     `keepMysqlEventLoopAlive` / `EVENT_LOOP_HOLD_MS` / `eventLoopHolds` /
     `eventLoopHandle` statics, and the `keepEventLoopAlive()` method;
   - unwrap every call site — `await this.keepEventLoopAlive(() => X)` becomes
     `await X`. Find them with
     `rg -n "keepEventLoopAlive" src/connection/Connection.ts`. Four sites
     were reformatted onto several lines when they were wrapped
     (`LAST_INSERT_ID()` in `runAndGetMysqlInsertId()`, the `TIMESTAMPDIFF`
     query in `assertMysqlUtc()`, and `driver.begin()` in `transaction()`);
     those need their original single-expression shape back.
   - `git log -S keepEventLoopAlive -- src/connection/Connection.ts` finds the
     commit that introduced them, whose diff read backwards is the removal.
3. Removing `Connection.keepMysqlEventLoopAlive` is a public API change. It is
   documented here as temporary, but it still deserves a line in the release
   notes.
4. Delete `scripts/bun-mysql-eventloop-probe.ts` and this file.
5. **Keep** `tests/bun-mysql-eventloop.integration.test.ts`. It asserts that an
   ORM script which floats its promise still finishes its work — a property
   worth holding Bun to. Run it with `MYSQL_TEST_URL` set, before and after the
   removal:

   ```console
   $ MYSQL_TEST_URL=mysql://root@127.0.0.1:3306/test bun test tests/bun-mysql-eventloop.integration.test.ts
   ```

   If it fails after the removal, Bun is not fixed after all — restore the
   workaround and re-check the probe.

## v3 revalidation (2026-09-04)

`scripts/bun-mysql-eventloop-probe.ts` was rerun on Bun 1.4.1 (`4661e494f`).
All four triggers (reserve/release, transaction, second client and pooled queries)
resolved 0/20 attempts. The reference-holding workaround remains enabled.
