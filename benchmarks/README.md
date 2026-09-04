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
