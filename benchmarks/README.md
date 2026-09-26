# Benchmark history

## Eager matching and PostgreSQL create costs

```sh
bun benchmarks/eager-match-cost.mjs
node benchmarks/eager-match-cost.mjs
bun benchmarks/postgres-insert-compile-cost.mjs
node benchmarks/postgres-insert-compile-cost.mjs
POSTGRES_TEST_URL='postgres://…/test_db' bun benchmarks/postgres-create-cost.mjs
POSTGRES_TEST_URL='postgres://…/test_db' node benchmarks/postgres-create-cost.mjs
```

The matching probe compares grouping, parent assignment, and collection
construction for 500 parents and 1,000 children without a database. The create
probe inserts into a temporary PostgreSQL table and compares the full model
path, a diagnostic path without the outer connection scope, the builder, and
SQL written ahead of time. The SQL compilation probe needs no database. Each
prints microseconds per operation; lower is better. Run each in three fresh
processes and compare medians.

## MySQL/Bun model JSON reads

```sh
bun run build
MYSQL_TEST_URL='mysql://…/test_db' bun benchmarks/mysql-json-read.mjs
# Compare another build with BENCH_ORM_SOURCE=../path/to/dist/src/index.js
```

This creates a unique table with 500 rows, boolean and JSON columns, then
compares model `.json()` and `rawJson()` on `bun:sql`. It checks both outputs
against the exact expected JSON before timing seven rounds of 100 reads. Schema
creation and seeding use a separate connection from timed reads. Run at least
three fresh processes per build, alternating builds; compare the median of
their per-process median ops/s. The table is dropped after each process.

## MySQL Date writes

```sh
MYSQL_TEST_URL='mysql://…/test_db' node benchmarks/mysql-date-write.mjs
# Compare another build with BENCH_ORM_SOURCE=../path/to/dist/src/index.js
```

This creates a uniquely named table in the test database and times 700
single-row `UPDATE` calls with a real `Date` binding after 20 warmups. It
checks the row count and exact millisecond timestamp, then drops the table.
Run at least three fresh Node processes per build; this isolates MySQL's UTC
session write path from insert-ID retrieval and model hydration.

## Database-free `Builder.json()` comparison

```sh
bun run build
bun benchmarks/json-query-memory.mjs
node benchmarks/json-query-memory.mjs
# Compare another build with BENCH_ORM_SOURCE=../path/to/dist/src/index.js
```

This replaces `Connection.query` with fixed, fresh driver-shaped rows, so no
database server participates. Three workloads serialize 500 rows and call
`JSON.stringify`: `plain` uses the direct plan; `appended` hydrates models and
reads a JSON cast in a getter; `appendedWithoutJsonCast` hydrates models without
that cast. The script checks exact output before timing and reports the median
of seven 100-call rounds. Compare at least three fresh processes per runtime.

## Hydration and serialization in memory

```sh
bun run build
bun benchmarks/hydration-memory.mjs
node --expose-gc benchmarks/hydration-memory.mjs
# Compare another build with BENCH_ORM_SOURCE=../path/to/dist/src/index.js
```

The script uses 500 fixed rows with boolean and JSON casts. It checks the exact
JSON output, then measures `hydrate()`, `toJSON()` and `JSON.stringify()` in
separate phases without a database or driver. Each result is the median of five
rounds of 60 batches. Run each command in at least three fresh processes when
comparing changes. `BENCH_ROWS` and `BENCH_MEMORY_ROWS` adjust the batch and
memory sample sizes.

The memory sample retains 10,000 models, then their JSON objects, and reports
heap bytes per model after a forced GC. Node also reports heap growth before GC
when no automatic collection occurred in that phase, plus observed GC events.
Bun does not emit `gc` events through `node:perf_hooks`, and its pre-GC heap
counter does not reliably update after each phase; those fields are `null`.
Retained heap is useful for comparing revisions, but it is not the total number
of transient bytes allocated by one operation. Compare only runs from the same
runtime and machine.

```sh
bun benchmarks/model-serialization.mjs
node benchmarks/model-serialization.mjs
```

This measures `toJSON()` alone on 500 fresh models, with plain casts, an
appended accessor, a hidden field, or a visible field. It checks the exact JSON
for all four cases, including in-place visibility changes, before timing. Run
it in three fresh Bun and Node processes per build;
`BENCH_ORM_SOURCE` selects another build.

For the self-contained HTTP server, deterministic fixtures and two-version
runner, see [the reproducible HTTP benchmark](http/README.md):
`BENCH_HTTP_URL=... bun run bench:http v2.5.0 v3.1.1`.
The [users](http-users-2026-09-05/README.md) and
[records](http-records-2026-09-05/README.md) HTTP reports are historical external
consumer measurements; their private application/fixtures were not published.
They are not the same protocol as the new repository-owned HTTP harness.

```sh
bun run bench:record
bun run bench:record benchmarks/results/<previous-result>.json
```

Runs the SQLite pipeline and hydration benchmarks three times each, sequentially
in fresh processes. No external database is needed. Each invocation writes a new
JSON file under `benchmarks/results/`; previous results are never overwritten.
Keep selected baselines in Git alongside the changes they measure.

Initial baseline for the current harness:
[`2026-09-04T18-49-28.185Z`](results/2026-09-04T18-49-28.185Z-683373b-4eb6ba5d.json).
The two earlier records form a comparable pair from before the recorder's final
type annotation; their harness hash differs from the current one.

Records the commit, dirty worktree paths, SHA-256 of source/tests/scripts/config,
Bun version and revision, OS, CPU, memory, harness hash, full test output and every
run's metrics. The summary contains the median/min/max of the three reported
medians, not percentiles of individual query latency. A comparison adds the
percentage change for each metric; zero baselines have no percentage change.

Comparison requires the same harness, Bun build and machine configuration. Runtime
upgrades or harness changes need a new baseline. Machine load, power settings and
thermal throttling still affect results: keep conditions steady and rerun noisy
comparisons. Check absolute times as well as ratios. There is no automatic
performance failure threshold yet.

`sqlite-json-v2` measures the native SQL query plus `JSON.stringify` together.
That reference does less work (no ORM casts), so it is not semantically equivalent
to model JSON. The harness asserts equivalence between model JSON and `rawJson()`.
The old `tests/*.baseline.txt` files used a different protocol/runtime; keep them
as historical evidence, without calculating improvements against them.

The workload covers 1/25/200/20,000 rows and cast/proxy call counts. It does not
measure concurrent throughput, per-request p95/p99, peak memory or networked
PostgreSQL/MySQL. Extend the workload when refactoring those paths. Run the
recorder's small check with `bun test tests/bench-history-script.test.ts`.

## v3 runtime workloads

```sh
bun run bench:runtime
# Same harness against an isolated v2 source snapshot:
BENCH_ORM_SOURCE=tmp/runtime-baseline/src BENCH_SOURCE_LABEL=v2.5.0 bun run bench:runtime
```

The snapshot in the second command is extracted from commit `683373b` with
`git archive 683373b src | tar -x -C tmp/runtime-baseline` after creating that
directory. It changes no checkout or consumer. Required services:
`POSTGRES_TEST_URL`, `MYSQL_TEST_URL`, `REDIS_TEST_URL`; missing services fail.

`orm-runtime-v2` records three repetitions per driver, 200 operations per metric
(30 for batches of 25 writes), actual server versions, pool max 4, source/harness
hashes and machine/runtime. It covers point/tenant/transaction reads, contention
with 8 concurrent callers, create/save/delete with and without observers, bulk
writes, heterogeneous casts, overrides, partial columns, eager relations, and
queue reserve/complete contention. Observer work is an in-memory counter, not
network delivery. Queue timings exclude dispatch and job handling/heartbeat.

Every repetition stores throughput and median/p95/p99 of individual operations.
Compare only equal protocol/harness/runtime/server/pool/machine settings. Earlier
`orm-runtime-v1` records remain historical evidence; adding cast/eager workloads
changed warmup conditions, so v1 and v2 must not be compared as equivalent runs.

Memory runs in three fresh subprocesses (2,000 rows × 30 rounds after warmup),
recording heap/RSS before/after forced GC, observed heap peak, process RSS peak,
and explicit GC duration. These are finite workload measurements, not a proof of
absence of leaks or a production GC latency distribution. Connection URLs and
credentials are never included in records.

See [v3 verification and measured tradeoffs](./v3-verification.md),
[runtime records](./runtime/) and [cast profiles](./profiles/).

## Redis queue investigation

`bun scripts/benchmark-redis-queue.ts` compares v2/v3 in fresh processes with a
temporary dedicated Redis server, 2,000 warmup jobs and 20,000 measured jobs per
run. It stores independent records and experimental variants under `redis/`.
See [the investigation report](./redis-queue-investigation.md) for the measured
regression, causes, limitations and proposed improvements.
Historical `v2`/`v3` variants are pinned to their recorded commits. To compare
the current driver against them, run
`REDIS_BENCH_VARIANTS=v2,v3,worktree bun scripts/benchmark-redis-queue.ts`.
