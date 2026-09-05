# Audit fixes: measured performance

The fixes add a small, repeatable cost to flat validation and Redis cache flushing. Same-tenant PostgreSQL reentry and uncontended SQLite migration rebuilds become faster. This run does not show a consistent slowdown in normal hydration or SQLite CRUD.

Compared commit `64ab254` with the corrected, uncommitted source snapshot on 2026-09-05. No production code was changed during this benchmark.

## Method

- Apple M4, 32 GiB RAM, macOS/Darwin 24.6.0 arm64; Bun 1.4.2 (`744846f844374847c902b5e7fd59b4342a51ef99`).
- PostgreSQL 18.6 and Redis 8.10.1 using the configured local test services. SQLite uses a disposable in-memory database. Connection URLs and credentials are omitted.
- Nine paired repetitions, alternating before/after and after/before. All benchmarks run sequentially in fresh processes with UTC timezone.
- Each process runs three warmups and nine measured samples for each workload. The table compares the median of the nine process medians. Positive percentages mean slower; negative percentages mean faster.
- The existing hydration benchmark is reused unchanged. The targeted harness adds valid-input validation, automatic timestamps, bulk writes, RLS reentry, migrations and cache flushing, with assertions on results.
- Insert timings exclude cleanup. Redis timings exclude populating keys. Cache prefixes and migration directories are isolated. The Redis comparison contains only cache keys so both versions delete the same data; correctness with neighboring queues is covered by the regression suite.
- Raw samples, paired ranges, source hashes, harness hashes, server versions and complete hydration output are retained in [the JSON record](results/audit-fixes-2026-09-05.json).

## Results

All times below are milliseconds for the **whole batch**, not per individual request. “Slower pairs” counts pairs in which the fixed source took longer.

| Workload | Before ms | Fixed ms | Change | Slower pairs |
|---|---:|---:|---:|---:|
| Hydrate 20,000 models (timestamps enabled) | 3.260 | 3.219 | -1.26% | 4/9 |
| Hydrate 20,000 models inside withoutTimestamps | 4.237 | 3.060 | -27.78% | 0/9 |
| Validate 1,000 JSON objects, 10 fields each | 2.298 | 2.453 | +6.78% | 9/9 |
| Validate 1,000 flat forms, 10 fields each | 3.091 | 3.324 | +7.53% | 9/9 |
| Validate 1,000 forms, 10 nested fields each | 6.847 | 7.085 | +3.48% | 8/9 |
| Validate 100 JSON objects, 100 wildcard items each | 4.831 | 4.719 | -2.30% | 3/9 |
| SQLite Model.insert(), 1,000 rows | 3.216 | 3.054 | -5.05% | 2/9 |
| SQLite Model.insert(), 1,000 rows without timestamps | 2.062 | 2.026 | -1.73% | 4/9 |
| SQLite create + save + delete, 100 cycles | 4.525 | 4.475 | -1.13% | 4/9 |
| SQLite migration fresh(), 10 cycles | 2.983 | 2.698 | -9.55% | 0/9 |
| SQLite migration refresh(), 10 cycles | 2.219 | 1.932 | -12.95% | 0/9 |
| PostgreSQL withTenant + session read, 100 cycles | 9.993 | 9.993 | +0.00% | 4/9 |
| PostgreSQL same-tenant reentry + read, 100 cycles | 17.102 | 9.763 | -42.91% | 0/9 |
| Redis flush(), 3,000 cache keys | 10.569 | 11.054 | +4.59% | 9/9 |
| SQLite query + models + JSON, 20,000 rows | 31.609 | 29.684 | -6.09% | 2/9 |
| SQLite query + rawJson(), 20,000 rows | 21.047 | 20.907 | -0.66% | 4/9 |
| Native SQLite query + JSON, 20,000 rows (control) | 9.750 | 9.678 | -0.74% | 3/9 |

## Interpretation

- Flat JSON and form validation slow down in all nine pairs: +6.8% and +7.5%, respectively. For these 10-field inputs, that adds approximately 0.16 and 0.23 microseconds per validation. Nested forms add approximately 0.24 microseconds (+3.5%, slower in eight of nine pairs). These costs include the new path checks and safe property handling.
- Redis flushing adds about 0.49 ms per 3,000-key flush (+4.6%, slower in all nine pairs). Filtering scanned keys is additional work, and protects neighboring resource families.
- Same-tenant RLS reentry drops from about 171 to 98 microseconds per cycle (-42.9%, faster in every pair). The fixed path reuses the scope instead of opening another savepoint and setting the tenant again. Entering the outer RLS scope alone is effectively unchanged.
- Uncontended fresh/refresh migrations improve in every pair. The fixed implementation avoids repeated lock acquisitions; SQLite fresh also preserves its existing lock table. These single-migration timings do not represent long real-world DDL migrations.
- Normal hydration, rawJson and SQLite CRUD results vary in direction between pairs. Their small median improvements are not evidence of a dependable speedup. The native query + JSON control changes by only -0.7%.
- Hydration inside withoutTimestamps is faster in every pair, with a median change of -27.8%. This is a CPU microbenchmark using one repeated row and a model whose timestamp flag changes in the old version. Avoiding shared static mutation may help JIT specialization, but that explanation is an inference, not a profiling result.
- No aggregate percentage is reported: combining operations with different frequencies and units would not describe an application workload.

## Limits and reproduction

These measurements are local, warmed workloads. They do not measure production throughput, request p95/p99, concurrent migration waiting time, peak memory, MySQL, or large/hostile validation inputs. Locking now intentionally makes competing destructive operations wait; the unsafe old concurrent behavior is not an equivalent performance reference.

The runnable targeted harness is [scripts/benchmark-audit.ts](../scripts/benchmark-audit.ts). It requires POSTGRES_TEST_URL and REDIS_TEST_URL and prints the nine raw sample times per workload as JSON. A minimal comparison is:

```sh
mkdir -p tmp_agents/audit-perf-baseline
git archive 64ab254 src | tar -x -C tmp_agents/audit-perf-baseline
BENCH_ORM_SOURCE=tmp_agents/audit-perf-baseline/src TZ=UTC bun scripts/benchmark-audit.ts
TZ=UTC bun scripts/benchmark-audit.ts
```

Repeat each version in nine fresh processes, alternating the order per pair, to reproduce the protocol. The hydration query measurements additionally run the same `tests/benchmark-hydration-plan.test.ts` against each source snapshot. The recorded hashes identify the exact fixed source; later changes require a new record.
