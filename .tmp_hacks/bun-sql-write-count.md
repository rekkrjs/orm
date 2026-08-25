# The Bun write-count adapter split

> **This document describes a temporary hack.** It exists so that whoever reads
> it after Bun ships a fix can verify that the fix landed and delete the hack
> cleanly. If you only want the removal steps, jump to
> [Retiring the workaround](#retiring-the-workaround).

- **Status:** documented; the ORM-side split is not written yet
- **Last reviewed:** 2026-08-25
- **Affects:** MySQL diverges. SQLite and PostgreSQL agree with each other.
- **Verified with:** Bun 1.4.0 (`34cbb9a40`), MySQL 9.7.1 (Homebrew),
  PostgreSQL 16 (alpine), macOS arm64
- **Upstream:** [oven-sh/bun#40432](https://github.com/oven-sh/bun/issues/40432),
  filed 2026-08-25. Related open reports, none of which covers the cross-adapter
  split itself:
  [#23654](https://github.com/oven-sh/bun/issues/23654) (MySQL `affectedRows`;
  a comment shows the same `count: 0` shape),
  [#30843](https://github.com/oven-sh/bun/issues/30843) (`CLIENT_FOUND_ROWS`,
  the no-op-update column below),
  [#30811](https://github.com/oven-sh/bun/issues/30811) (SQLite `count: 0` for
  `INSERT ... SELECT`), and
  [#22569](https://github.com/oven-sh/bun/issues/22569) (`console.log` printing
  `[]` for these results). [#25488](https://github.com/oven-sh/bun/issues/25488)
  asked for `SQLResultArray` to be exported and is closed as completed, but
  `bun-types@1.4.0` still ships neither it nor `affectedRows` in any `.d.ts`.

## The symptom

A write reports the wrong number of affected rows on MySQL, and reports it
without failing. The result object looks empty in a debugger — Bun returns an
`SQLResultArray`, an `Array` subclass whose metadata lives in properties that
`JSON.stringify` does not serialize:

```console
> console.log(await db.unsafe("UPDATE t SET n='z' WHERE id IN (1,2)"))
[]
```

That `[]` is what makes the bug expensive: the count is there, it is just
invisible to the first thing anyone tries. Consumers end up guessing property
names, and a guess that works on the development adapter can be silently wrong
on the production one.

## The cause

Bun populates the affected-row count in a different property per adapter, and
the two conventions disagree about what `count` even means:

| adapter | `count` on a write | `affectedRows` | apparent meaning of `count` |
|---|---|---|---|
| SQLite | affected rows | `null` | rows returned **or** affected |
| PostgreSQL | affected rows | `null` | rows returned **or** affected |
| MySQL | **`0`** | affected rows | rows returned only |

On MySQL `count` tracks `length` exactly — it is the number of rows *returned*,
which for an `UPDATE` or `DELETE` is always zero. On SQLite and PostgreSQL
`count` doubles as the affected-row count. Neither convention is unreasonable;
they simply are not the same convention, and nothing in `sql.d.ts` says which
one applies. `unsafe<T = any>()` returns `SQL.Query<T> extends Promise<T>`, so
awaiting a write yields `any`. `count`, `affectedRows`, `command` and
`lastInsertRowid` are not declared anywhere in Bun's public types, and the
`SQLResultArray` class is not exported.

`command` diverges the same way: populated on SQLite and PostgreSQL (`"UPDATE"`,
`"DELETE"`), `null` on MySQL.

### Why the obvious fallback does not work

The natural way to paper over this is a nullish chain, and it fails:

```ts
result?.count ?? result?.affectedRows ?? 0     // returns 0 on MySQL, always
```

`??` only falls through on `null`/`undefined`. MySQL's `count` is `0`, which is
neither, so the chain stops at the first candidate and never reaches
`affectedRows`. **The failure is silent and it inverts by adapter:** it is
correct on SQLite, where most development happens, and wrong on MySQL.

This is not hypothetical. `@rekkr/better-auth-adapter` shipped exactly this
chain in `writeCount()`, where it made `consumeOne()` delete a verification row
and then report that nothing was consumed — see that package's own bug report.
Any consumer reaching for a portable count will write the same line.

### What was measured

`UPDATE` affecting two rows, then a no-op `UPDATE` that matches one row without
changing its value:

| adapter | `count` | `affectedRows` | `rowCount` | `rowsAffected` | `changes` | no-op update |
|---|---|---|---|---|---|---|
| SQLite | `2` | `null` | — | — | — | `1` |
| PostgreSQL | `2` | `null` | — | — | — | `1` |
| MySQL | `0` | `2` | — | — | — | `0` |

`rowCount`, `rowsAffected` and `changes` are `undefined` on all three; they are
node-driver names that Bun does not use.

The last column is a **separate, second divergence** and it is not Bun's doing:
MySQL reports rows *changed* where SQLite and PostgreSQL report rows *matched*.
That is server behaviour, fixed by the `CLIENT_FOUND_ROWS` capability flag,
which Bun does not appear to expose. A fix to the property split will not make
this column converge, so any portable `count` the ORM exposes has to pick a
meaning and document it.

## What the workaround will do

Nothing is implemented yet. `Builder.update()`, `delete()` and `forceDelete()`
are declared `Promise<any>` and hand the driver result straight back
(`src/query/Builder.ts`), so today every consumer inherits the problem.

When the typed write result lands it needs a per-driver read, in the same shape
as the existing `RETURNING` split in `Builder.insertGetId()`:

```ts
const raw = this.connection.getDriverName() === "mysql" ? result?.affectedRows : result?.count;
```

Mark it `WORKAROUND(bun-sql-write-count)` so the removal step can find it.

## Is Bun fixed yet?

Run the probe. It uses the raw Bun API with no ORM involved, and requires both
a MySQL and a PostgreSQL URL — probing a subset reports a false `FIXED`, because
SQLite and PostgreSQL already agree and leaving MySQL out hides the divergence:

```console
$ bun scripts/bun-sql-write-count-probe.ts mysql://root@127.0.0.1:3306/test postgres://postgres:pw@127.0.0.1:5432/test
bun 1.4.0 (34cbb9a40)

  UPDATE affecting 2 rows:

  adapter            count  affectedRows      rowCount  rowsAffected       changes
  sqlite                 2             -             -             -             -
  postgres               2             -             -             -             -
  mysql                  0             2             -             -             -

STILL DIVERGENT — no single property reports the affected count everywhere.
  sqlite     needs count
  postgres   needs count
  mysql      needs affectedRows
```

- exit **0** — still divergent; keep the split.
- exit **3** — one property works on every adapter; the split can be retired.
- exit **1** — a server could not be reached, or a URL was missing; nothing was
  learned.

Worth running after every Bun upgrade.

## Retiring the workaround

1. Confirm with the probe above (exit 3) on the Bun version you intend to ship.
   Record that version in the commit message.
2. Replace the per-driver read with the single property the probe reports, and
   delete the `WORKAROUND(bun-sql-write-count)` markers. Find them with
   `rg -n "WORKAROUND\(bun-sql-write-count\)" src/`.
3. The no-op-update column will still differ. That is expected and is **not** a
   reason to keep the split — but whatever `update()` documents about matched
   vs changed rows stays true and stays documented.
4. Delete `scripts/bun-sql-write-count-probe.ts` and this file.
5. **Keep** any test asserting that a write reports its affected-row count on
   every driver. That property is worth holding Bun to regardless of which
   property carries it.
