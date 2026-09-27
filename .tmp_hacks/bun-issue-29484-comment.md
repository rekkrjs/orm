Still reproduces on **Bun 1.4.2** (macOS arm64) against **PostgreSQL 18.6**. Some extra data that may help triage:

**Minimal repro** (`bun:sql` only, one connection so every call hits the same session):

```ts
import { SQL } from "bun";

const sql = new SQL({ url: process.env.DATABASE_URL!, max: 1 }); // prepare: true is the default
const t = `repro_0a000_${process.pid}`;
const select = () => sql.unsafe(`SELECT * FROM ${t} WHERE id = $1`, [1]);
const attempt = async (label: string, run: () => Promise<unknown>) => {
  try {
    console.log(label, "ok", JSON.stringify(await run()));
  } catch (error: any) {
    console.log(label, "FAILED", error.errno, error.message);
  }
};

await sql.unsafe(`CREATE TABLE ${t} (id int PRIMARY KEY, a int)`);
await sql.unsafe(`INSERT INTO ${t} VALUES (1, 1)`);
await attempt("before DDL     ", select);
await sql.unsafe(`ALTER TABLE ${t} ADD COLUMN b int`);
for (let i = 1; i <= 3; i++) await attempt(`after DDL, #${i}`, select);
await attempt("prepare: false ", async () => {
  const unprepared = new SQL({ url: process.env.DATABASE_URL!, max: 1, prepare: false });
  try { return await unprepared.unsafe(`SELECT * FROM ${t} WHERE id = $1`, [1]); } finally { await unprepared.close(); }
});
await sql.unsafe(`DROP TABLE ${t}`);
await sql.close();
```

```
before DDL      ok [{"id":1,"a":1}]
after DDL, #1 FAILED 0A000 cached plan must not change result type
after DDL, #2 FAILED 0A000 cached plan must not change result type
after DDL, #3 FAILED 0A000 cached plan must not change result type
prepare: false  ok [{"id":1,"a":1,"b":null}]
```

**postgres.js 3.4.7, same steps** (on both Bun 1.4.2 and Node 26.10), with prepared queries (the tagged template, or `unsafe(…, { prepare: true })`):

```
before DDL      ok [{"id":1,"a":1}]
after DDL, #1   ok [{"id":1,"a":1,"b":null}]
after DDL, #2   ok [{"id":1,"a":1,"b":null}]
```

It drops the cached statement and retries once when the error's routine is `RevalidateCachedQuery` (`retryRoutines` in `src/connection.js`). Inside a transaction it cannot hide it: the error aborts the transaction, so postgres.js surfaces `0A000` there too. The difference is that the next query on that connection works again, whereas with `bun:sql` it keeps failing until the connection is closed.

Two details that make this bite `bun:sql` users harder than postgres.js users:

- postgres.js's `sql.unsafe()` does **not** prepare by default (`prepare: false` unless passed). `bun:sql`'s `unsafe()` with parameters **does**. Query builders and ORMs that emit their SQL through `unsafe()` therefore get named, cached statements on Bun and not on postgres.js.
- The trigger is the most ordinary migration: `ADD COLUMN` on a table read with `SELECT *`. In a rolling deploy, every pooled connection of the processes still running old code breaks for that query until they restart. The only workaround today is `prepare: false` for the whole client, which gives up statement reuse everywhere; there is no per-query `prepare` option and no way to evict a cached statement.

Expected behaviour, as in postgres.js: on `0A000` from `RevalidateCachedQuery`, evict that statement from the connection's cache, and retry once when the connection is not inside a transaction. Inside a transaction, still evict it before surfacing the error, so the next transaction does not fail the same way.
