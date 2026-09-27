Tested this PR's build (`1.4.3-canary.1+fb3fd16d4`, fetched with `bunx bun-pr 35120`) on macOS arm64 against PostgreSQL 18.6, using the repro from #29484.

**Sequential use: fixed.** After `ALTER TABLE … ADD COLUMN`, a stale `SELECT *` re-prepares transparently. Inside `BEGIN`, the original `0A000` surfaces and the next query after the transaction works. On 1.4.2, every later run on that connection fails.

**Concurrent use: the pipelined case described above is most of the traffic.** This is 20 concurrent runs of the same statement right after `ADD COLUMN`, three runs each:

| | 1 connection | 4 connections | next burst |
| --- | ---: | ---: | ---: |
| this PR | 19/20 fail | 16/20 fail (all but one per connection) | 0/20 |
| 1.4.2 | 20/20 fail | 20/20 fail | 20/20 |

```ts
import { SQL } from "bun";

for (const max of [1, 4]) {
  const sql = new SQL({ url: process.env.DATABASE_URL!, max, prepare: true });
  const t = `repro_conc_${process.pid}_${max}`;
  const select = () => sql.unsafe(`SELECT * FROM ${t} WHERE id = $1`, [1]);
  await sql.unsafe(`CREATE TABLE ${t} (id int PRIMARY KEY, a int)`);
  await sql.unsafe(`INSERT INTO ${t} VALUES (1, 1)`);
  await Promise.all(Array.from({ length: 20 }, select)); // prepared on every pooled connection
  await sql.unsafe(`ALTER TABLE ${t} ADD COLUMN b int`);
  const burst = await Promise.allSettled(Array.from({ length: 20 }, select));
  const next = await Promise.allSettled(Array.from({ length: 20 }, select));
  const failed = (results: PromiseSettledResult<unknown>[]) => results.filter((r) => r.status === "rejected").length;
  console.log(`max ${max}: burst ${failed(burst)}/20 failed, next burst ${failed(next)}/20`);
  await sql.unsafe(`DROP TABLE ${t}`);
  await sql.close();
}
```

In an app server, a migration that adds a column usually lands while requests are in flight. With a busy pool, most requests that touch that table fail once. Every rejected run in the burst failed with `0A000` itself. Could those pipelined requests be re-queued under the fresh name as well, once each and only outside a transaction? Or do the responses already on the wire make that impractical? Either way, this is a clear improvement over 1.4.2. For comparison, postgres.js 3.4.7 does worse here: with as few as two concurrent runs of a stale statement it hangs, and nothing settles within 5 s.
