export interface JobRecord {
  id: number;
  reservationToken: string;
  queue: string;
  jobClass: string;
  payload: string;
  attempts: number;
  maxAttempts: number;
  availableAt: number;
  reservedAt: number | null;
  createdAt: number;
}

export interface QueueDriver {
  migrate(): Promise<void>;
  dispatch(queue: string, jobClass: string, payload: string, delaySeconds: number, maxAttempts: number): Promise<void>;
  reserve(queue: string, retryAfterSeconds: number): Promise<JobRecord | null>;
  complete(id: number, token: string): Promise<boolean>;
  fail(id: number, token: string, exception: string): Promise<boolean>;
  release(id: number, token: string, delaySeconds: number): Promise<boolean>;
  heartbeat(id: number, token: string): Promise<boolean>;
  size(queue?: string): Promise<number>;
}
