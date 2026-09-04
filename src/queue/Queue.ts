import type { QueueDriver } from "./QueueDriver.js";
import {
  DispatchableJob,
  setJobDriver,
  resetJobDrivers,
  registerJobDriver,
  getJobDriver,
  getJobDriverByConnection,
  getDefaultQueue,
  jobKeyFor,
  type JobConstructor,
  type JobStatics,
  type DispatchOptions,
} from "./Job.js";
import { afterCommit, currentTenantId } from "../connection/ExecutionContext.js";
import { TenantContext } from "../connection/TenantContext.js";

export class Queue {
  static reset(): void { resetJobDrivers(); }

  static configure(driver: QueueDriver, defaultQueue = "default"): void {
    setJobDriver(driver, defaultQueue);
  }

  /** Register a secondary driver under a name. Dispatch by passing `{ connection: "<name>" }`. */
  static registerDriver(name: string, driver: QueueDriver): void {
    registerJobDriver(name, driver);
  }

  static async dispatch(instance: DispatchableJob, options?: DispatchOptions): Promise<void>;
  static async dispatch(jobClass: JobConstructor, args?: any[], options?: DispatchOptions): Promise<void>;
  static async dispatch(
    jobClassOrInstance: JobConstructor | DispatchableJob,
    argsOrOptions?: any[] | DispatchOptions,
    options: DispatchOptions = {},
  ): Promise<void> {
    let jobClass: JobConstructor;
    let jobArgs: any[];
    let opts: DispatchOptions;

    if (jobClassOrInstance instanceof DispatchableJob) {
      jobClass = jobClassOrInstance.constructor as JobConstructor;
      jobArgs = jobClassOrInstance._jobArgs;
      opts = (argsOrOptions as DispatchOptions) ?? {};
    } else {
      jobClass = jobClassOrInstance;
      jobArgs = (argsOrOptions as any[]) ?? [];
      opts = options;
    }

    const d = getJobDriverByConnection(opts.connection);
    const statics = jobClass as unknown as JobStatics;
    const queue = opts.queue ?? statics.queue ?? getDefaultQueue();
    const delay = opts.delay ?? statics.delay ?? 0;
    const maxAttempts = opts.maxAttempts ?? statics.maxAttempts ?? 3;
    const tenantId = currentTenantId();
    const payload = JSON.stringify({ args: jobArgs, tenantId });
    const key = jobKeyFor(statics);
    await afterCommit(() => TenantContext.asLandlord(() => d.dispatch(queue, key, payload, delay, maxAttempts)));
  }

  static async size(queue?: string, connection?: string): Promise<number> {
    return getJobDriverByConnection(connection).size(queue);
  }

  static getDriver(connection?: string): QueueDriver {
    return getJobDriverByConnection(connection);
  }
}

export async function dispatch(instance: DispatchableJob, options?: DispatchOptions): Promise<void>;
export async function dispatch(jobClass: JobConstructor, args?: any[], options?: DispatchOptions): Promise<void>;
export async function dispatch(
  jobClassOrInstance: JobConstructor | DispatchableJob,
  argsOrOptions?: any[] | DispatchOptions,
  options: DispatchOptions = {},
): Promise<void> {
  return Queue.dispatch(
    jobClassOrInstance as any,
    argsOrOptions as any,
    options,
  );
}
