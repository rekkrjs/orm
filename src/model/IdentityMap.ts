import { AsyncLocalStorage } from "node:async_hooks";
import type { Connection } from "../connection/Connection.js";
import type { Model } from "./Model.js";

const storage = new AsyncLocalStorage<Map<string, Model>>();
const connectionIds = new WeakMap<object, number>();
let nextConnectionId = 1;

export class IdentityMap {
  static current(): Map<string, Model> | undefined {
    return storage.getStore();
  }

  static async run<T>(callback: () => T | Promise<T>): Promise<T> {
    return await storage.run(new Map<string, Model>(), callback);
  }

  private static connectionId(connection: Connection): number {
    const driver = connection.driver as unknown as object;
    let id = connectionIds.get(driver);
    if (id === undefined) {
      id = nextConnectionId++;
      connectionIds.set(driver, id);
    }
    return id;
  }

  private static cacheKey(table: string, key: string | number, connection?: Connection): string {
    const prefix = connection ? `${this.connectionId(connection)}\0` : "";
    return `${prefix}${table}:${String(key)}`;
  }

  static get(table: string, key: string | number, connection?: Connection): Model | undefined {
    const map = this.current();
    if (!map) return undefined;
    if (connection) return map.get(this.cacheKey(table, key, connection));

    const legacyKey = this.cacheKey(table, key);
    const legacy = map.get(legacyKey);
    if (legacy) return legacy;
    const suffix = `\0${legacyKey}`;
    for (const [cacheKey, model] of map) {
      if (cacheKey.endsWith(suffix)) return model;
    }
    return undefined;
  }

  static set(table: string, key: string | number, model: Model, connection?: Connection): void {
    const map = this.current();
    if (!map) return;
    map.set(this.cacheKey(table, key, connection), model);
  }

  static clear(): void {
    const map = this.current();
    if (!map) return;
    map.clear();
  }

  static clearTable(table: string, connection?: Connection): void {
    const map = this.current();
    if (!map) return;
    const prefix = connection ? `${this.connectionId(connection)}\0${table}:` : `${table}:`;
    const scopedMarker = `\0${table}:`;
    for (const key of map.keys()) {
      if (key.startsWith(prefix) || (!connection && key.includes(scopedMarker))) map.delete(key);
    }
  }

  static delete(table: string, key: string | number, connection?: Connection): void {
    const map = this.current();
    if (!map) return;
    if (connection) {
      map.delete(this.cacheKey(table, key, connection));
      return;
    }

    const legacyKey = this.cacheKey(table, key);
    const suffix = `\0${legacyKey}`;
    for (const cacheKey of map.keys()) {
      if (cacheKey === legacyKey || cacheKey.endsWith(suffix)) map.delete(cacheKey);
    }
  }
}
