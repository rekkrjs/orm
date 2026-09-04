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

  private static cacheKey(table: string, key: string | number, connection: Connection): string {
    return `${this.connectionId(connection)}\0${connection.getTenantId() ?? ""}\0${connection.getSchema() ?? ""}\0${table}:${String(key)}`;
  }

  static get(table: string, key: string | number, connection: Connection): Model | undefined {
    const map = this.current();
    if (!map) return undefined;
    return map.get(this.cacheKey(table, key, connection));
  }

  static set(table: string, key: string | number, model: Model, connection: Connection): void {
    const map = this.current();
    if (!map) return;
    map.set(this.cacheKey(table, key, connection), model);
  }

  static clear(): void {
    const map = this.current();
    if (!map) return;
    map.clear();
  }

  static clearTable(table: string, connection: Connection): void {
    const map = this.current();
    if (!map) return;
    const prefix = `${this.connectionId(connection)}\0${connection.getTenantId() ?? ""}\0${connection.getSchema() ?? ""}\0${table}:`;
    for (const key of map.keys()) {
      if (key.startsWith(prefix)) map.delete(key);
    }
  }

  static delete(table: string, key: string | number, connection: Connection): void {
    const map = this.current();
    if (!map) return;
    map.delete(this.cacheKey(table, key, connection));
  }
}
