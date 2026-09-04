import { Builder } from "./Builder.js";
import { Connection } from "../connection/Connection.js";
import { ConnectionManager } from "../connection/ConnectionManager.js";
import { TenantContext } from "../connection/TenantContext.js";
import { resolveConnection } from "../connection/ExecutionContext.js";


export const DB = {
  table<T extends Record<string, any> = Record<string, any>>(name: string): Builder<T> {
    return new Builder<T>(resolveConnection(), name);
  },

  connection(name: string) {
    const conn = ConnectionManager.require(name);
    return {
      table<T extends Record<string, any> = Record<string, any>>(table: string): Builder<T> {
        return new Builder<T>(conn, table);
      },
    };
  },

  tenant<T>(tenantId: string, callback: () => T | Promise<T>): Promise<T> {
    return TenantContext.run(tenantId, callback);
  },

  transaction<T>(callback: (connection: Connection) => T | Promise<T>): Promise<T> {
    // Connection.transaction() installs the ambient context for every branch,
    // so unbound Model/DB queries inside the callback resolve to it.
    return resolveConnection().transaction(callback);
  },

  afterCommit(callback: () => unknown | Promise<unknown>): Promise<void> {
    return resolveConnection().afterCommit(callback);
  },

  raw<T = any>(sql: string, bindings: any[] = []): Promise<T[]> {
    return resolveConnection().query(sql, bindings) as Promise<T[]>;
  },
};
