import { Builder } from "./Builder.js";
import { Connection, queryChannel, type QueryEvent } from "../connection/Connection.js";
import { ConnectionManager } from "../connection/ConnectionManager.js";
import { TenantContext } from "../connection/TenantContext.js";
import { resolveConnection } from "../connection/ExecutionContext.js";

// Reported, never rethrown: the statement already ran and a write may be
// committed, so a caller seeing this error could retry it and write twice.
function reportListenerError(error: unknown): void {
  console.error("[orm] A query listener threw:", error);
}

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

  /**
   * Calls `listener` after each statement the application runs, on every
   * connection, and returns the function that stops it. A listener that throws
   * or rejects is reported with console.error and never reaches the query.
   */
  listen(listener: (event: QueryEvent) => void | Promise<void>): () => void {
    const guarded = (message: unknown) => {
      try {
        const pending = listener(message as QueryEvent);
        if (pending instanceof Promise) pending.catch(reportListenerError);
      } catch (error) {
        reportListenerError(error);
      }
    };
    queryChannel.subscribe(guarded);
    return () => {
      queryChannel.unsubscribe(guarded);
    };
  },
};
