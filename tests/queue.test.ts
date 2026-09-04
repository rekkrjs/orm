import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Connection } from "../src/connection/Connection.js";
import { ConnectionManager } from "../src/connection/ConnectionManager.js";
import { DatabaseQueueDriver } from "../src/queue/DatabaseQueueDriver.js";
import { Queue } from "../src/queue/Queue.js";
import { DispatchableJob, registerJob, resolveJob } from "../src/queue/Job.js";
import { Worker } from "../src/queue/Worker.js";

function makeConnection(): Connection {
  return new Connection({ url: "sqlite://:memory:" });
}

describe("DatabaseQueueDriver", () => {
  let conn: Connection;
  let driver: DatabaseQueueDriver;

  beforeEach(async () => {
    conn = makeConnection();
    driver = new DatabaseQueueDriver(conn);
    await driver.migrate();
  });

  afterEach(async () => {
    await conn.close();
  });

  it("dispatches and reserves a job", async () => {
    await driver.dispatch("default", "SendEmail", JSON.stringify({ args: ["user@example.com"] }), 0, 3);

    const job = await driver.reserve("default", 90);
    expect(job).not.toBeNull();
    expect(job!.jobClass).toBe("SendEmail");
    expect(job!.attempts).toBe(1);
    expect(job!.queue).toBe("default");
  });

  it("returns null when queue is empty", async () => {
    const job = await driver.reserve("default", 90);
    expect(job).toBeNull();
  });

  it("does not reserve same job twice", async () => {
    await driver.dispatch("default", "SendEmail", "{}", 0, 3);
    const job1 = await driver.reserve("default", 90);
    const job2 = await driver.reserve("default", 90);
    expect(job1).not.toBeNull();
    expect(job2).toBeNull();
  });

  it("completes a job (removes from table)", async () => {
    await driver.dispatch("default", "SendEmail", "{}", 0, 3);
    const job = await driver.reserve("default", 90);
    await driver.complete(job!.id, job!.reservationToken);
    expect(await driver.size("default")).toBe(0);
  });

  it("fails a job (moves to failed_jobs)", async () => {
    await driver.dispatch("default", "SendEmail", "{}", 0, 3);
    const job = await driver.reserve("default", 90);
    await driver.fail(job!.id, job!.reservationToken, "Error: SMTP timeout");
    expect(await driver.size("default")).toBe(0);
    const failed = await conn.query<any>("SELECT * FROM failed_jobs");
    expect(failed).toHaveLength(1);
    expect(failed[0].job_class).toBe("SendEmail");
    expect(failed[0].exception).toContain("SMTP timeout");
  });

  it("releases a job back to queue with delay", async () => {
    const now = Math.floor(Date.now() / 1000);
    await driver.dispatch("default", "SendEmail", "{}", 0, 3);
    const job = await driver.reserve("default", 90);
    await driver.release(job!.id, job!.reservationToken, 60);

    // Not available yet (delay=60)
    const notYet = await driver.reserve("default", 90);
    expect(notYet).toBeNull();
    expect(await driver.size("default")).toBe(1);
  });

  it("re-reserves expired reserved jobs", async () => {
    await driver.dispatch("default", "SendEmail", "{}", 0, 3);
    // Reserve and manually set reserved_at to 200s ago to simulate timeout
    const job = await driver.reserve("default", 90);
    const expiredAt = Math.floor(Date.now() / 1000) - 200;
    await conn.run("UPDATE jobs SET reserved_at = ? WHERE id = ?", [expiredAt, job!.id]);

    // Should now be re-reservable
    const reReserved = await driver.reserve("default", 90);
    expect(reReserved).not.toBeNull();
    expect(reReserved!.id).toBe(job!.id);
  });

  it("respects named queues", async () => {
    await driver.dispatch("emails", "SendEmail", "{}", 0, 3);
    await driver.dispatch("reports", "GenerateReport", "{}", 0, 3);

    const emailJob = await driver.reserve("emails", 90);
    const reportJob = await driver.reserve("reports", 90);
    expect(emailJob?.jobClass).toBe("SendEmail");
    expect(reportJob?.jobClass).toBe("GenerateReport");
  });

  it("respects dispatch delay", async () => {
    await driver.dispatch("default", "SendEmail", "{}", 60, 3);
    const job = await driver.reserve("default", 90);
    expect(job).toBeNull();
  });

  it("counts queue size", async () => {
    await driver.dispatch("default", "A", "{}", 0, 3);
    await driver.dispatch("default", "B", "{}", 0, 3);
    await driver.dispatch("other", "C", "{}", 0, 3);
    expect(await driver.size("default")).toBe(2);
    expect(await driver.size("other")).toBe(1);
    expect(await driver.size()).toBe(3);
  });

  it("respects maxAttempts stored in record", async () => {
    await driver.dispatch("default", "SendEmail", "{}", 0, 5);
    const job = await driver.reserve("default", 90);
    expect(job!.maxAttempts).toBe(5);
  });
});

describe("DispatchableJob", () => {
  let conn: Connection;
  let driver: DatabaseQueueDriver;

  beforeEach(async () => {
    conn = makeConnection();
    driver = new DatabaseQueueDriver(conn);
    await driver.migrate();
    Queue.configure(driver, "default");
  });

  afterEach(async () => {
    await conn.close();
  });

  it("serializes constructor args on dispatch", async () => {
    class SendEmail extends DispatchableJob {
      constructor(public to: string, public subject: string) { super(to, subject); }
      async handle() {}
    }
    registerJob(SendEmail);

    await SendEmail.dispatch("a@b.com", "Hello");
    const job = await driver.reserve("default", 90);
    expect(job).not.toBeNull();
    const payload = JSON.parse(job!.payload);
    expect(payload.args).toEqual(["a@b.com", "Hello"]);
  });

  it("uses static queue override", async () => {
    class ReportJob extends DispatchableJob {
      static override queue = "reports";
      async handle() {}
    }
    registerJob(ReportJob);

    await ReportJob.dispatch();
    expect(await driver.size("reports")).toBe(1);
    expect(await driver.size("default")).toBe(0);
  });

  it("uses static maxAttempts", async () => {
    class FragileJob extends DispatchableJob {
      static override maxAttempts = 1;
      async handle() {}
    }
    registerJob(FragileJob);

    await FragileJob.dispatch();
    const job = await driver.reserve("default", 90);
    expect(job!.maxAttempts).toBe(1);
  });

  it("Queue.dispatch() facade works", async () => {
    class PingJob extends DispatchableJob {
      async handle() {}
    }
    registerJob(PingJob);

    await Queue.dispatch(PingJob, []);
    expect(await driver.size("default")).toBe(1);
  });

  it("Queue.dispatch() respects options", async () => {
    class PingJob extends DispatchableJob {
      async handle() {}
    }
    registerJob(PingJob);

    await Queue.dispatch(PingJob, [], { queue: "critical", maxAttempts: 5 });
    expect(await driver.size("critical")).toBe(1);
    const job = await driver.reserve("critical", 90);
    expect(job!.maxAttempts).toBe(5);
  });

  it("resolveJob returns registered class", () => {
    class MyJob extends DispatchableJob {
      async handle() {}
    }
    registerJob(MyJob);
    expect(resolveJob("MyJob")).toBe(MyJob);
  });

  it("Queue.dispatch() accepts an instance", async () => {
    class SendEmail extends DispatchableJob {
      constructor(public to: string) { super(to); }
      async handle() {}
    }
    registerJob(SendEmail);

    await Queue.dispatch(new SendEmail("a@b.com"));
    const job = await driver.reserve("default", 90);
    expect(job).not.toBeNull();
    expect(job!.jobClass).toBe("SendEmail");
    expect(JSON.parse(job!.payload).args).toEqual(["a@b.com"]);
  });

  it("Queue.dispatch() instance uses static queue from class", async () => {
    class CriticalJob extends DispatchableJob {
      static override queue = "critical";
      constructor(public x: number) { super(x); }
      async handle() {}
    }
    registerJob(CriticalJob);

    await Queue.dispatch(new CriticalJob(42));
    expect(await driver.size("critical")).toBe(1);
    const job = await driver.reserve("critical", 90);
    expect(JSON.parse(job!.payload).args).toEqual([42]);
  });

  it("Queue.dispatch() instance options override static values", async () => {
    class FlexJob extends DispatchableJob {
      static override queue = "low";
      constructor(public n: number) { super(n); }
      async handle() {}
    }
    registerJob(FlexJob);

    await Queue.dispatch(new FlexJob(1), { queue: "high", maxAttempts: 5 });
    expect(await driver.size("high")).toBe(1);
    const job = await driver.reserve("high", 90);
    expect(job!.maxAttempts).toBe(5);
  });
});

describe("Worker", () => {
  let conn: Connection;
  let driver: DatabaseQueueDriver;

  beforeEach(async () => {
    conn = makeConnection();
    driver = new DatabaseQueueDriver(conn);
    await driver.migrate();
    Queue.configure(driver, "default");
  });

  afterEach(async () => {
    await conn.close();
  });

  it("processes a job and completes it", async () => {
    const handled: string[] = [];

    class GreetJob extends DispatchableJob {
      constructor(public name: string) { super(name); }
      async handle() { handled.push(this.name); }
    }
    registerJob(GreetJob);

    await GreetJob.dispatch("World");

    const worker = new Worker(driver, { pollIntervalMs: 10 });
    // Run one tick then stop
    const runPromise = worker.run();
    await new Promise((r) => setTimeout(r, 50));
    worker.stop();
    await runPromise;

    expect(handled).toEqual(["World"]);
    expect(await driver.size("default")).toBe(0);
  });

  it("retries a job on failure when under maxAttempts", async () => {
    let callCount = 0;

    class FlakyJob extends DispatchableJob {
      static override maxAttempts = 3;
      async handle() {
        callCount++;
        if (callCount < 2) throw new Error("transient");
      }
    }
    registerJob(FlakyJob);

    await FlakyJob.dispatch();

    const worker = new Worker(driver, { pollIntervalMs: 10, retryAfterSeconds: 0 });
    const runPromise = worker.run();
    await new Promise((r) => setTimeout(r, 150));
    worker.stop();
    await runPromise;

    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it("moves job to failed_jobs after exhausting maxAttempts", async () => {
    class AlwaysFailJob extends DispatchableJob {
      static override maxAttempts = 1;
      async handle() { throw new Error("always fails"); }
    }
    registerJob(AlwaysFailJob);

    await AlwaysFailJob.dispatch();

    const worker = new Worker(driver, { pollIntervalMs: 10 });
    const runPromise = worker.run();
    await new Promise((r) => setTimeout(r, 100));
    worker.stop();
    await runPromise;

    expect(await driver.size("default")).toBe(0);
    const failed = await conn.query<any>("SELECT * FROM failed_jobs");
    expect(failed).toHaveLength(1);
    expect(failed[0].job_class).toBe("AlwaysFailJob");
  });

  it("fails job with unknown class", async () => {
    await driver.dispatch("default", "GhostJob", "{}", 0, 1);

    const worker = new Worker(driver, { pollIntervalMs: 10 });
    const runPromise = worker.run();
    await new Promise((r) => setTimeout(r, 100));
    worker.stop();
    await runPromise;

    expect(await driver.size("default")).toBe(0);
    const failed = await conn.query<any>("SELECT * FROM failed_jobs");
    expect(failed).toHaveLength(1);
  });

  it("handles concurrency > 1 on sqlite without nested transaction errors", async () => {
    const handled: number[] = [];

    class FastJob extends DispatchableJob {
      constructor(public id: number) { super(id); }
      async handle() { handled.push(this.id); }
    }
    registerJob(FastJob);

    for (let i = 1; i <= 20; i++) {
      await FastJob.dispatch(i);
    }

    const worker = new Worker(driver, {
      concurrency: 2,
      pollIntervalMs: 5,
      retryAfterSeconds: 0,
    });
    const runPromise = worker.run();
    await new Promise((r) => setTimeout(r, 250));
    worker.stop();
    await runPromise;

    expect(await driver.size("default")).toBe(0);
    expect(handled.length).toBeGreaterThan(0);
    expect(new Set(handled).size).toBe(handled.length);
  });
});

describe("Queue resilience (regression)", () => {
  let conn: Connection;
  let driver: DatabaseQueueDriver;

  beforeEach(async () => {
    conn = makeConnection();
    driver = new DatabaseQueueDriver(conn);
    await driver.migrate();
    Queue.configure(driver, "default");
  });

  afterEach(async () => {
    await conn.close();
  });

  it("dispatches to the configured default queue when the job declares none", async () => {
    Queue.configure(driver, "critical");

    class ConfiguredQueueJob extends DispatchableJob {
      async handle() {}
    }
    registerJob(ConfiguredQueueJob);

    await ConfiguredQueueJob.dispatch();
    await Queue.dispatch(ConfiguredQueueJob, []);

    expect(await driver.size("critical")).toBe(2);
    expect(await driver.size("default")).toBe(0);
  });

  it("still lets a job pin itself to a queue named 'default'", async () => {
    Queue.configure(driver, "critical");

    class PinnedJob extends DispatchableJob {
      static override queue = "default";
      async handle() {}
    }
    registerJob(PinnedJob);

    await PinnedJob.dispatch();
    expect(await driver.size("default")).toBe(1);
    expect(await driver.size("critical")).toBe(0);
  });

  it("uses static jobName as the stable registry key", async () => {
    class MinifiedJob extends DispatchableJob {
      static override jobName = "send-invoice";
      async handle() {}
    }
    registerJob(MinifiedJob);

    expect(resolveJob("send-invoice")).toBe(MinifiedJob as any);
    // Class name stays registered so payloads enqueued before the rename resolve.
    expect(resolveJob("MinifiedJob")).toBe(MinifiedJob as any);

    await MinifiedJob.dispatch();
    const job = await driver.reserve("default", 90);
    expect(job!.jobClass).toBe("send-invoice");
  });

  it("survives transient reserve() errors instead of taking down the worker", async () => {
    const handled: string[] = [];

    class ResilientJob extends DispatchableJob {
      async handle() { handled.push("ok"); }
    }
    registerJob(ResilientJob);
    await ResilientJob.dispatch();

    let failures = 0;
    const flaky: typeof driver = Object.create(driver);
    flaky.reserve = async (queue: string, retryAfter: number) => {
      if (failures < 3) { failures++; throw new Error("ECONNRESET"); }
      return driver.reserve(queue, retryAfter);
    };

    const worker = new Worker(flaky, { pollIntervalMs: 5 });
    const runPromise = worker.run();
    await new Promise((r) => setTimeout(r, 400));
    worker.stop();
    await runPromise;              // must resolve, not reject

    expect(failures).toBe(3);
    expect(handled).toEqual(["ok"]);
    expect(await driver.size("default")).toBe(0);
  });

  it("does not take sibling loops down when one reserve() throws", async () => {
    const handled: number[] = [];

    class SiblingJob extends DispatchableJob {
      constructor(public n: number) { super(n); }
      async handle() {
        await new Promise((r) => setTimeout(r, 20));
        handled.push(this.n);
      }
    }
    registerJob(SiblingJob);
    for (let i = 1; i <= 4; i++) await SiblingJob.dispatch(i);

    let calls = 0;
    const flaky: typeof driver = Object.create(driver);
    flaky.reserve = async (queue: string, retryAfter: number) => {
      calls++;
      if (calls === 2) throw new Error("network blip");
      return driver.reserve(queue, retryAfter);
    };

    const worker = new Worker(flaky, { concurrency: 2, pollIntervalMs: 5, retryAfterSeconds: 60 });
    const runPromise = worker.run();
    await new Promise((r) => setTimeout(r, 400));
    worker.stop();
    await runPromise;

    expect(handled).toHaveLength(4);
    expect(await driver.size("default")).toBe(0);
  });

  it("retries an unknown job class before failing it", async () => {
    await driver.dispatch("default", "NotYetDeployedJob", "{}", 0, 3);

    const worker = new Worker(driver, { pollIntervalMs: 5, retryAfterSeconds: 0 });
    const runPromise = worker.run();
    await new Promise((r) => setTimeout(r, 50));
    worker.stop();
    await runPromise;

    // Released with a delay rather than buried in failed_jobs on attempt 1.
    const failed = await conn.query<any>("SELECT * FROM failed_jobs");
    expect(failed).toHaveLength(0);
    expect(await driver.size("default")).toBe(1);
  });

  it("still fails an unknown job class once its attempts are exhausted", async () => {
    await driver.dispatch("default", "GhostJob", "{}", 0, 1);

    const worker = new Worker(driver, { pollIntervalMs: 5 });
    const runPromise = worker.run();
    await new Promise((r) => setTimeout(r, 50));
    worker.stop();
    await runPromise;

    const failed = await conn.query<any>("SELECT * FROM failed_jobs");
    expect(failed).toHaveLength(1);
    expect(failed[0].job_class).toBe("GhostJob");
  });

  it("does not mark a job failed when complete() throws after a successful handle()", async () => {
    let handleCount = 0;

    class SucceedsJob extends DispatchableJob {
      static override maxAttempts = 1;
      async handle() { handleCount++; }
    }
    registerJob(SucceedsJob);
    await SucceedsJob.dispatch();

    const broken: typeof driver = Object.create(driver);
    broken.complete = async () => { throw new Error("connection lost on ack"); };

    const worker = new Worker(broken, { pollIntervalMs: 5, retryAfterSeconds: 60 });
    const runPromise = worker.run();
    await new Promise((r) => setTimeout(r, 60));
    worker.stop();
    await runPromise;

    expect(handleCount).toBe(1);
    const failed = await conn.query<any>("SELECT * FROM failed_jobs");
    expect(failed).toHaveLength(0);
  });

  it("keeps the loop alive when release() also fails", async () => {
    class ExplodingJob extends DispatchableJob {
      static override maxAttempts = 3;
      async handle() { throw new Error("boom"); }
    }
    registerJob(ExplodingJob);
    await ExplodingJob.dispatch();

    const broken: typeof driver = Object.create(driver);
    broken.release = async () => { throw new Error("driver gone"); };

    const worker = new Worker(broken, { pollIntervalMs: 5, retryAfterSeconds: 60 });
    const runPromise = worker.run();
    await new Promise((r) => setTimeout(r, 60));
    worker.stop();
    await expect(runPromise).resolves.toBeUndefined();
  });

  it("clamps a non-numeric concurrency to a single loop", async () => {
    const worker = new Worker(driver, { concurrency: Number.NaN, pollIntervalMs: 5 });
    const runPromise = worker.run();
    await new Promise((r) => setTimeout(r, 20));
    worker.stop();
    await runPromise;
    expect((worker as any).concurrency).toBe(1);
  });
});
