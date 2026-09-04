import type { QueueDriver, JobRecord } from "./QueueDriver.js";
import { resolveJob } from "./Job.js";
import { TenantContext } from "../connection/TenantContext.js";

export interface WorkerOptions {
  queue?: string;
  concurrency?: number;
  pollIntervalMs?: number;
  retryAfterSeconds?: number;
  retryDelaySeconds?: number;
}

/** Upper bound for the exponential backoff applied after a driver error. */
const MAX_RESERVE_BACKOFF_MS = 30_000;

/** Slice length used to keep long backoff sleeps responsive to `stop()`. */
const SLEEP_SLICE_MS = 250;

export class Worker {
  private queue: string;
  private concurrency: number;
  private pollIntervalMs: number;
  private retryAfterSeconds: number;
  private retryDelaySeconds: number;
  private running = false;
  private activeJobs = 0;
  private stopSignal = false;

  constructor(private driver: QueueDriver, options: WorkerOptions = {}) {
    this.queue = options.queue ?? "default";
    this.concurrency = normalizeConcurrency(options.concurrency);
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.retryAfterSeconds = options.retryAfterSeconds ?? 90;
    this.retryDelaySeconds = options.retryDelaySeconds ?? 0;
  }

  async run(): Promise<void> {
    this.running = true;
    this.stopSignal = false;

    const loops = Array.from({ length: this.concurrency }, () => this.workerLoop());
    await Promise.all(loops);
    this.running = false;
  }

  stop(): void {
    this.stopSignal = true;
  }

  private async workerLoop(): Promise<void> {
    let consecutiveErrors = 0;

    while (!this.stopSignal) {
      let job: JobRecord | null;

      try {
        job = await this.driver.reserve(this.queue, this.retryAfterSeconds);
        consecutiveErrors = 0;
      } catch (err) {
        // A transient driver error (network blip, SQLITE_BUSY, failover) must
        // never escape this loop: run() awaits every loop with Promise.all, so
        // a rejection here would take down sibling loops that are half way
        // through handle() and abandon their in-flight jobs.
        consecutiveErrors++;
        console.error(`[Queue] reserve() failed (${consecutiveErrors} consecutive):`, err);
        await this.sleep(backoffMs(this.pollIntervalMs, consecutiveErrors));
        continue;
      }

      if (!job) {
        await this.sleep(this.pollIntervalMs);
        continue;
      }

      this.activeJobs++;
      try {
        await this.processJob(job);
      } catch (err) {
        // processJob owns its own error handling; anything reaching here is a
        // bug or a driver failure in the failure path itself.
        console.error(`[Queue] Unhandled error while processing job ${job.id}:`, err);
      } finally {
        this.activeJobs--;
      }
    }

    // Drain: wait until active jobs finish (for the parallel loop case, each
    // loop handles its own active job, so just returning is enough).
  }

  private async processJob(job: JobRecord): Promise<void> {
    let stopped = false;
    let lost = false;
    let pending: Promise<void> | undefined;
    const timer = setInterval(() => {
      if (stopped || pending) return;
      pending = this.driver.heartbeat(job.id, job.reservationToken).then(owned => {
        if (!owned) { lost = true; clearInterval(timer); }
      }).catch(error => {
        lost = true;
        clearInterval(timer);
        console.error(`[Queue] heartbeat failed for job ${job.id}; reservation may be lost:`, error);
      }).finally(() => { pending = undefined; });
    }, Math.max(10, this.retryAfterSeconds * 1000 / 3));
    timer.unref?.();
    try { await this.handleReservedJob(job, () => lost); }
    finally { stopped = true; clearInterval(timer); await pending; }
  }

  private async handleReservedJob(job: JobRecord, leaseLost: () => boolean): Promise<void> {
    const JobClass = resolveJob(job.jobClass);

    if (!JobClass) {
      // Usually a misconfigured `jobsPath` or a deploy where the worker booted
      // before the class existed — transient from the job's point of view. Give
      // it the same retry budget as any other failure instead of burning the
      // whole backlog into failed_jobs on the first pass.
      const message =
        `Unknown job class: ${job.jobClass}. Register it via registerJob() or set jobsPath in config.`;

      if (job.attempts < job.maxAttempts) {
        console.warn(`[Queue] ${message} Retrying (attempt ${job.attempts}/${job.maxAttempts}).`);
        await this.guarded(() => this.driver.release(job.id, job.reservationToken, unknownClassRetryDelay(job.attempts)));
      } else {
        console.error(`[Queue] ${message}`);
        await this.guarded(() => this.driver.fail(job.id, job.reservationToken, new Error(message).stack ?? message));
      }
      return;
    }

    let payload: { args: any[]; tenantId?: string };
    try {
      payload = JSON.parse(job.payload);
    } catch {
      await this.guarded(() => this.driver.fail(job.id, job.reservationToken, `Invalid payload JSON for job ${job.jobClass}`));
      return;
    }

    try {
      // Constructing the instance can throw (a constructor doing real work, a
      // bad arg shape); that has to be a job failure, not an escaped rejection.
      const instance = new JobClass(...(payload.args ?? []));
      const run = () => instance.handle();
      await (payload.tenantId ? TenantContext.run(payload.tenantId, run) : run());
    } catch (err: unknown) {
      if (leaseLost()) return;
      const asError = err instanceof Error ? err : undefined;
      const message = asError?.stack ?? String(err);
      const shortMessage = asError?.message ?? String(err);
      const attempts = job.attempts;
      const maxAttempts = job.maxAttempts;

      if (attempts >= maxAttempts) {
        await this.guarded(() => this.driver.fail(job.id, job.reservationToken, message));
        console.error(`[Queue] Failed ${job.jobClass} (id=${job.id}) after ${attempts} attempt(s): ${shortMessage}`);
      } else {
        await this.guarded(() => this.driver.release(job.id, job.reservationToken, this.retryDelaySeconds));
        console.warn(`[Queue] Retrying ${job.jobClass} (id=${job.id}) attempt ${attempts}/${maxAttempts}: ${shortMessage}`);
      }
      return;
    }

    // handle() succeeded. A failing complete() is a bookkeeping problem, not a
    // job failure: releasing or failing here would either re-run side effects
    // that already happened or bury a job that actually worked. Let the
    // visibility timeout decide, and say so loudly.
    try {
      if (leaseLost() || !await this.driver.complete(job.id, job.reservationToken)) {
        console.warn(`[Queue] Lost reservation for job ${job.id}; outcome was not acknowledged.`);
        return;
      }
      console.log(`[Queue] Processed ${job.jobClass} (id=${job.id})`);
    } catch (err) {
      console.error(
        `[Queue] ${job.jobClass} (id=${job.id}) handled successfully but complete() failed; ` +
        `it may be retried once its reservation expires:`,
        err,
      );
    }
  }

  /**
   * Runs a driver call that is itself part of failure handling. A secondary
   * error must not mask the primary one — if release/fail cannot be persisted
   * the visibility timeout will redeliver the job, which is the safe default.
   */
  private async guarded(fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (secondary) {
      console.error("[Queue] driver error while handling job outcome:", secondary);
    }
  }

  /** Sleep that returns early once `stop()` has been called. */
  private async sleep(ms: number): Promise<void> {
    let remaining = ms;
    while (remaining > 0 && !this.stopSignal) {
      const slice = Math.min(remaining, SLEEP_SLICE_MS);
      await sleep(slice);
      remaining -= slice;
    }
  }
}

function normalizeConcurrency(requested: number | undefined): number {
  if (requested === undefined) return 1;
  return Number.isFinite(requested) ? Math.max(1, Math.floor(requested)) : 1;
}

function backoffMs(pollIntervalMs: number, consecutiveErrors: number): number {
  const base = Math.max(pollIntervalMs, 1);
  return Math.min(base * 2 ** Math.min(consecutiveErrors, 5), MAX_RESERVE_BACKOFF_MS);
}

function unknownClassRetryDelay(attempts: number): number {
  return Math.min(60, 5 * Math.max(attempts, 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
