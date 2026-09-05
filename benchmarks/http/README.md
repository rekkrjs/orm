# Reproducible HTTP benchmark

This directory contains the complete `orm-http-v1` workload: server, schema and
deterministic synthetic fixtures. It needs no application outside this repository
and adds no dependencies. The runner compares two Git source snapshots without
changing your checkout or resolving `@rekkr/orm` from another package.

## Run a comparison

Requirements: Bun 1.4.1+, Git, `tar`, oha 1.16.0+, and an existing MySQL/MariaDB
database. The database account needs CREATE TABLE, INSERT, SELECT and DROP TABLE.
Use a benchmark database; the server creates uniquely named `bench_http_*` tables
and deletes only tables it successfully created. It never drops the database,
flushes shared state, or modifies existing application tables.

From the repository root, after `bun install --frozen-lockfile`:

```sh
export BENCH_HTTP_URL='mysql://user:password@127.0.0.1:3306/orm_bench'
# For MySQL configurations requiring TLS, add ?ssl-mode=require to the URL.
bun run bench:http v2.5.0 v3.1.1
```

Both refs must exist locally. In a shallow clone, fetch their history/tags first.
With no arguments, the runner uses v2.5.0 and v3.1.1. Neither tag needs to contain
the harness: the current harness is run unchanged against both extracted sources.

Defaults: 60 seconds measured, 5 seconds warm-up, 1,000 HTTP connections, one
repetition, SQL pool max 10, UTC process timezone. Six routes × two versions take
approximately 13 minutes plus seeding and request drain. Each combination starts
a fresh process on an available loopback port. Version order alternates across
endpoints and repetitions. There is no profiling in the timed run.

```sh
# Fast integration check; these numbers are not performance evidence.
BENCH_HTTP_OUTPUT=tmp_agents/http-smoke BENCH_HTTP_SECONDS=1 \
  BENCH_HTTP_WARMUP=1 BENCH_HTTP_CONNECTIONS=2 bun run bench:http

# Repeat under lower concurrency to measure variance; about 39 minutes.
BENCH_HTTP_REPETITIONS=3 BENCH_HTTP_CONNECTIONS=10 bun run bench:http
```

Before load, every route must match the expected fixture response hash. The
runner fails on non-200 responses or oha errors. It saves original oha metrics,
fixture hashes/sizes, source commits/hashes, harness hash, database version and
machine/runtime details to a new JSON file under `benchmarks/http/results/`.
Credentials and database URLs are not recorded. Keep selected measurements in
Git; short smoke runs and intermediate diagnostics belong in `tmp_agents/`.

`-w` waits for pending requests after the deadline, and that drain affects oha's
reported duration and throughput. The runner does not pass
`--latency-correction`: oha ignores it without a rate limit (`-q`). Latencies are
uncorrected closed-loop load measurements, not isolated-request latency.

## Run the server manually

```sh
TZ=UTC BENCH_HTTP_PORT=3000 bun benchmarks/http/server.ts
oha -z 60s -c 1000 --no-tui -w http://127.0.0.1:3000/rekkr-json
oha -z 60s -c 1000 --no-tui -w http://127.0.0.1:3000/benchmark-records/rekkr-json
```

`BENCH_HTTP_URL` is required here too. `BENCH_ORM_SOURCE` optionally selects an
absolute or repository-relative `src` directory; otherwise this uses the working
tree. SIGINT/SIGTERM stops the server and cleans its own tables. A forced kill
cannot perform cleanup; any leftovers retain their unique `bench_http_*` names.

| Routes | Rows | Model casts |
| --- | ---: | --- |
| `/rekkr`, `/rekkr-rawJson`, `/rekkr-json` | 500 users | Boolean `active`; aliased date columns |
| `/benchmark-records/rekkr`, `/benchmark-records/rekkr-rawJson`, `/benchmark-records/rekkr-json` | 1,000 records | Number, decimal, boolean, JSON, implicit timestamps |

The query-builder routes convert values manually; `rawJson()` avoids model
hydration; `.json()` hydrates models and serializes them. All include final
`JSON.stringify` and HTTP response construction using native `Bun.serve`.

Run the cleanup/equivalence check with
`bun test tests/http-bench-script.test.ts` (`MYSQL_TEST_URL` required). It also
checks an overlapping server, a failed bind, neighboring data, the default ORM
connection and `Object.prototype`.

## Historical measurements are a different protocol

The [500-user](../http-users-2026-09-05/README.md) and
[1,000-record](../http-records-2026-09-05/README.md) reports came from a separate
Hono consumer and its existing database. Their original application and fixtures
were not published with v3.1.1. Raw records and profiles preserve the observations,
but do not make those historical executions independently reproducible.

This harness uses native Bun HTTP and new deterministic fixtures. It reproduces
the workload categories and six ORM paths, **not the old Hono application, exact
payloads or published percentages**. Do not compare its results directly with the
historical records or relabel those records as `orm-http-v1`. New comparisons
must use the same harness, fixtures, Bun build, database and machine conditions
for both versions. Repeated runs are needed to assess variation.
