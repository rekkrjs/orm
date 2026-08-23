# Queue Jobs

Background job processing backed by your database or Redis. Jobs are dispatched to named queues and processed by a long-running worker started with `orm queue`.

## Concepts

| Term | Meaning |
|------|---------|
| **Job** | A class with a `handle()` method. Constructor args are the job's payload. |
| **Queue** | A named channel (e.g. `default`, `emails`, `critical`). Jobs route to one queue. |
| **Worker** | The `orm queue` process that polls the DB and runs jobs. |
| **Driver** | The storage backend. `DatabaseQueueDriver` and `RedisQueueDriver` are built in. |

Queue jobs are for **background work** (sending email, generating reports, syncing data). They are distinct from [Events](./events.md), which are synchronous in-process notifications.

## Configuration

```ts
// orm.config.ts
export default {
  connection: { url: process.env.DATABASE_URL },
  queue: {
    driver: "db",              // default; use "redis" for Redis
    defaultQueue: "default",   // queue name when none specified
    workers: 2,                // concurrent worker slots
    jobsPath: "./app/jobs",    // directory the worker auto-imports
    retryAfterSeconds: 90,     // re-queue jobs stuck longer than this
    retryDelaySeconds: 5,      // delay before retrying a failed job
    pollIntervalMs: 1_000,     // worker polling interval
    table: "jobs",             // optional table name override
    failedTable: "failed_jobs",
  },
};
```

`configureOrm()` sets up the selected driver automatically when `config.queue`
is present. For `driver: "redis"`, add `redis: { url }` or omit it to use Bun's
`REDIS_URL`. A `QueueDriver` instance is also accepted for custom backends.

## Defining a Job

```ts
import { DispatchableJob } from "@rekkr/orm/queue";

export class SendWelcomeEmail extends DispatchableJob {
  static jobName = "send-welcome-email"; // stable across minification/deploys
  static queue = "emails";    // optional; defaults to config.queue.defaultQueue
  static maxAttempts = 3;     // optional; default 3
  static delay = 0;           // optional dispatch delay in seconds

  constructor(private userId: number) {
    super(userId); // forward args to base class so instance dispatch works
  }

  async handle(): Promise<void> {
    const user = await User.findOrFail(this.userId);
    await mailer.send({ to: user.email, subject: "Welcome!" });
  }
}
```

Constructor arguments must be JSON-serializable (strings, numbers, arrays, plain objects).
The worker auto-registers exported job classes found under `jobsPath`. Keep
`jobName` stable after jobs have been dispatched; the stored payload uses it to
resolve the class when a worker eventually receives the job.

## Dispatching Jobs

The preferred form is instance dispatch — construct the job and pass it to `Queue.dispatch()`:

```ts
import { Queue } from "@rekkr/orm/queue";

await Queue.dispatch(new SendWelcomeEmail(user.id));

// With options
await Queue.dispatch(new SendWelcomeEmail(user.id), { delay: 30, queue: "critical" });
```

For convenience, the static method on the class also works:

```ts
await SendWelcomeEmail.dispatch(user.id);
```

### Class + args (alternative)

```ts
await Queue.dispatch(SendWelcomeEmail, [user.id]);
await Queue.dispatch(SendWelcomeEmail, [user.id], { maxAttempts: 5 });
```

## Running the Worker

```sh
orm queue                          # use config defaults
orm queue --queue emails           # process one queue
orm queue --queue emails --workers 4  # 4 concurrent slots
```

The worker is a long-running process. It polls the database, reserves a job, runs `handle()`, then marks it complete or schedules a retry.

### Graceful shutdown

`SIGTERM` / `SIGINT` stop the polling loop. In-flight jobs finish before the process exits.

## Retry & Failure

- On `handle()` error, the job is released back to the queue. Attempt count increments.
- `retryDelaySeconds` controls how long the job waits before becoming available again.
- When `attempts >= maxAttempts`, the job moves to `failed_jobs` and is not retried.
- Jobs reserved but not completed within `retryAfterSeconds` are automatically re-queued on the next poll.

## Database Tables

With the database driver, `orm queue` creates these tables on startup if they do
not exist. To manage them through normal deployments instead, generate and run a
migration first:

```sh
orm queue:install
orm migrate
```

### `jobs`

| Column | Type | Notes |
|--------|------|-------|
| `id` | bigint | PK |
| `queue` | varchar | Queue name |
| `job_class` | varchar | Class name used to reconstruct the job |
| `payload` | text/json | `{ "args": [...] }` |
| `attempts` | int | Incremented on each reservation |
| `max_attempts` | int | Moves to failed_jobs when `attempts >= max_attempts` |
| `available_at` | int | Unix timestamp; future value = delayed job |
| `reserved_at` | int | Set when a worker picks up the job; cleared on release |
| `created_at` | int | Unix timestamp |

### `failed_jobs`

| Column | Type | Notes |
|--------|------|-------|
| `id` | bigint | PK |
| `queue` | varchar | |
| `job_class` | varchar | |
| `payload` | text | Original payload |
| `exception` | text | Error stack trace |
| `failed_at` | int | Unix timestamp |

## Redis Driver

Select Redis directly in `orm.config.ts`; it uses Bun's built-in Redis client:

```ts
export default {
  connection: { url: process.env.DATABASE_URL },
  queue: {
    driver: "redis",
    redis: { url: process.env.QUEUE_REDIS_URL }, // omit to use REDIS_URL
  },
};
```

For manual runtime wiring or a secondary named queue connection, instantiate the
driver directly:

```ts
import { redis } from "bun";
import { RedisQueueDriver, Queue } from "@rekkr/orm/queue";

const driver = new RedisQueueDriver(redis, { prefix: "myapp:queue:" });
Queue.configure(driver, "default");
```

### Redis key layout

| Key | Type | Contents |
|-----|------|---------|
| `{prefix}pending:{queue}` | List | Job IDs ready to be processed (FIFO) |
| `{prefix}delayed:{queue}` | Sorted Set | Job IDs, score = `available_at` timestamp |
| `{prefix}reserved:{queue}` | Sorted Set | Reserved job IDs, score = `reserved_at` timestamp |
| `{prefix}job:{id}` | Hash | Job fields: class, payload, attempts, maxAttempts, etc. |
| `{prefix}failed` | List | JSON records of failed jobs |
| `{prefix}queues` | Set | All known queue names (used by `size()` with no arg) |
| `{prefix}id` | String | Auto-increment counter for job IDs |

### Options

```ts
new RedisQueueDriver(redisClient, {
  prefix: "myapp:queue:",  // default: "orm:queue:"
})
```

`migrate()` is a no-op — no DDL needed for Redis.

## Custom Driver

Implement the `QueueDriver` interface to add another backend:

```ts
import type { QueueDriver, JobRecord } from "@rekkr/orm/queue";

class MyDriver implements QueueDriver {
  async migrate() {}
  async dispatch(queue, jobClass, payload, delay, maxAttempts) { /* ... */ }
  async reserve(queue, retryAfter): Promise<JobRecord | null> { /* ... */ }
  async complete(id) { /* ... */ }
  async fail(id, exception) { /* ... */ }
  async release(id, delay) { /* ... */ }
  async size(queue?) { /* ... */ }
}

import { Queue } from "@rekkr/orm/queue";
Queue.configure(new MyDriver(), "default");
```

## Jobs vs Events

| | Events | Queue Jobs |
|---|--------|-----------|
| Execution | Synchronous, in-process | Asynchronous, separate worker process |
| Persistence | No | Yes (database) |
| Retries | No | Yes |
| Use case | React to something now | Do work later or in background |
