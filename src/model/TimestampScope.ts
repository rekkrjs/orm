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
