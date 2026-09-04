import { AsyncLocalStorage } from "node:async_hooks";
import type { Connection } from "./Connection.js";
import { ConnectionManager } from "./ConnectionManager.js";
import { TransactionContext } from "./TransactionContext.js";

export interface ActiveTenantContext {
  tenantId: string;
  connection: Connection;
  connectionName: string;
  strategy: "database" | "schema" | "rls";
  resolvedAt: number;
  lastUsedAt?: number;
  ttl?: number;
  expiresAt?: number;
  closeOnPurge: boolean;
  ownsConnection: boolean;
  schema?: string;
  schemaMode?: "qualify" | "search_path";
  rlsTenantId?: string;
  rlsSetting?: string;
  rlsRole?: string;
}

const storage = new AsyncLocalStorage<ActiveTenantContext>();

export class TenantContext {
  static current(): ActiveTenantContext | undefined {
    return storage.getStore();
  }

  static async withConnection<T>(connection: Connection, callback: () => T | Promise<T>): Promise<T> {
    const context = this.current();
    if (!context) {
      return await callback();
    }
    return await storage.run({ ...context, connection }, callback);
  }

  static async asLandlord<T>(callback: () => T | Promise<T>): Promise<T> {
    const tenant = this.current();
    if (tenant && (TransactionContext.current() || tenant.connection.isInTransaction())) {
      throw new Error(`Cannot leave tenant "${tenant.tenantId}" for landlord while its transaction is active.`);
    }
    return await storage.run(undefined as any, callback);
  }

  static async run<T>(tenantId: string, callback: () => T | Promise<T>): Promise<T> {
    const current = this.current();
    const transaction = TransactionContext.current() ?? (current?.connection.isInTransaction() ? current.connection : undefined);
    if (current?.tenantId === tenantId) return await callback();
    const context = await ConnectionManager.resolveTenant(tenantId);
    if (transaction) {
      if (context.strategy !== "schema" || context.schemaMode !== "qualify" ||
          (current && (current.strategy !== "schema" || current.schemaMode !== "qualify")) ||
          !context.connection.sharesResource(transaction)) {
        throw new Error(`Cannot enter tenant "${tenantId}" inside transaction for "${current?.tenantId ?? "landlord"}".`);
      }
      const connection = transaction.withSchema(context.schema!).withTenantId(tenantId);
      return await storage.run({ ...context, connection }, callback);
    }
    return await context.connection.use(() => storage.run(context, async () => {
      if (context.strategy === "schema" && context.schema && context.schemaMode === "search_path") {
        return await context.connection.withSearchPath(context.schema, connection => storage.run({ ...context, connection }, callback));
      }
      if (context.strategy === "rls") {
        return await context.connection.withTenant(context.rlsTenantId || context.tenantId,
          connection => storage.run({ ...context, connection }, callback), context.rlsSetting, context.rlsRole);
      }
      return await callback();
    }));
  }
}
