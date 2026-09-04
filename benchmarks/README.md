# Benchmark history

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
