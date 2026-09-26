import { AsyncLocalStorage } from "node:async_hooks";
import type { ModelConstructor } from "./ModelTypes.js";

export const timestampScopes = new AsyncLocalStorage<ReadonlySet<ModelConstructor>>();

export function timestampsEnabled(model: ModelConstructor): boolean {
  if (!model.timestamps) return false;
  const disabled = timestampScopes.getStore();
  if (!disabled) return true;
  for (let current = model; current; current = Object.getPrototypeOf(current)) {
    if (disabled.has(current)) return false;
    if (Object.hasOwn(current, "timestamps")) break;
  }
  return true;
}

/**
 * Fill created_at and updated_at where a record leaves them out, as an insert
 * through the model does. A value the caller passed is kept.
 */
export function withInsertTimestamps<R extends Record<string, any>>(model: ModelConstructor, records: readonly R[]): R[] {
  if (!timestampsEnabled(model)) return [...records];
  const { createdAt, updatedAt } = model.getTimestampColumns();
  const now: string = new model().freshTimestamp();
  return records.map((record) => ({
    ...record,
    [createdAt]: record[createdAt] === undefined ? now : record[createdAt],
    [updatedAt]: record[updatedAt] === undefined ? now : record[updatedAt],
  }));
}
