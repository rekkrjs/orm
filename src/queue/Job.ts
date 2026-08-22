import type { QueueDriver } from "./QueueDriver.js";
import { TenantContext } from "../connection/TenantContext.js";

export interface JobStatics {
  /**
   * Queue this job is dispatched to. Left undefined so the configured
   * `queue.defaultQueue` applies — a literal default here would shadow it.
   */
  queue?: string;
  maxAttempts: number;
  delay: number;
  name: string;
  /** Stable registry key; falls back to the class name. See `jobKeyFor()`. */
  jobName?: string;
}

export type JobConstructor = (new (...args: any[]) => DispatchableJob) & JobStatics;

export interface DispatchOptions {
  queue?: string;
  delay?: number;
  maxAttempts?: number;
  /**
   * Name of a previously-registered driver to dispatch to. Omit to use the
   * default driver. Register additional drivers via `Queue.registerDriver()`.
   */
  connection?: string;
}

let driver: QueueDriver | null = null;
let defaultQueue = "default";
const drivers = new Map<string, QueueDriver>();

export function setJobDriver(d: QueueDriver, queue: string): void {
  driver = d;
  defaultQueue = queue;
  drivers.set("default", d);
}

export function registerJobDriver(name: string, d: QueueDriver): void {
  drivers.set(name, d);
}

export function getJobDriver(): QueueDriver {
  if (!driver) throw new Error("Queue not configured. Call configureOrm() with a queue config first.");
  return driver;
}

export function getJobDriverByConnection(name?: string): QueueDriver {
  if (!name) return getJobDriver();
  const d = drivers.get(name);
  if (!d) throw new Error(`Queue connection "${name}" not registered. Call Queue.registerDriver("${name}", driver) first.`);
  return d;
}

export function getDefaultQueue(): string {
  return defaultQueue;
}

const registry = new Map<string, JobConstructor>();

/**
 * Registry key for a job class. `class.name` is not stable: a bundler that
 * minifies the worker renames the class and every pending payload becomes an
 * unknown job. Declaring `static jobName = "send-invoice"` pins it.
 */
export function jobKeyFor(jobClass: { name: string; jobName?: string }): string {
  return jobClass.jobName ?? jobClass.name;
}

export function registerJob(jobClass: JobConstructor): void {
  const key = jobKeyFor(jobClass);
  registry.set(key, jobClass);
  // Also index by class name so payloads enqueued before a `jobName` was
  // introduced still resolve. Harmless when both are the same string.
  if (jobClass.name && jobClass.name !== key) registry.set(jobClass.name, jobClass);
}

export function resolveJob(name: string): JobConstructor | undefined {
  return registry.get(name);
}

export abstract class DispatchableJob {
  /**
   * Target queue. Undefined by default so the queue configured via
   * `configureOrm({ queue: { defaultQueue } })` wins; set it to pin a job to
   * a specific queue regardless of config.
   */
  static queue?: string;
  static maxAttempts: number = 3;
  static delay: number = 0;
  /**
   * Stable identifier stored in the payload and used by the registry. Defaults
   * to the class name; set it explicitly when the worker runs minified code.
   */
  static jobName?: string;

  readonly _jobArgs: any[];

  constructor(...args: any[]) {
    this._jobArgs = args;
  }

  abstract handle(): Promise<void>;

  static async dispatch(this: JobConstructor & typeof DispatchableJob, ...args: any[]): Promise<void> {
    const d = getJobDriver();
    const queue = this.queue ?? defaultQueue;
    const maxAttempts = this.maxAttempts ?? 3;
    const delay = this.delay ?? 0;
    const tenantId = TenantContext.current()?.tenantId;
    const payload = JSON.stringify({ args, tenantId });
    await TenantContext.asLandlord(() => d.dispatch(queue, jobKeyFor(this), payload, delay, maxAttempts));
  }
}

export { drivers as _registeredDrivers };
