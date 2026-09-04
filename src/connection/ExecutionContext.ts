import { Connection } from "./Connection.js";
import { ConnectionManager } from "./ConnectionManager.js";
import { TenantContext } from "./TenantContext.js";
import { TransactionContext } from "./TransactionContext.js";

/** One policy for ambient operations and objects bound before entering a scope. */
export function resolveConnection(bound?: Connection, fallback?: Connection, poolBinding = false): Connection {
  const tenant = TenantContext.current();
  const transaction = TransactionContext.current();
  const active = transaction && tenant?.connection.isInTransaction()
    ? tenant.connection
    : transaction ?? tenant?.connection;
  bound = bound?.reusableConnection();
  if (bound && active && bound !== active) {
    const boundTransaction = bound.transactionConnection();
    const activeTransaction = active.transactionConnection();
    if (!bound.sharesResource(active) || (!(poolBinding && bound.getTenantId() === undefined) && bound.getTenantId() !== (tenant?.tenantId ?? active.getTenantId())) ||
        (boundTransaction && activeTransaction && boundTransaction !== activeTransaction)) {
      throw new Error(`Connection context conflict: "${ConnectionManager.nameOf(bound)}" (tenant "${bound.getTenantId() ?? "landlord"}") cannot join ${transaction ? "transaction" : "tenant"} on "${ConnectionManager.nameOf(active)}" (tenant "${tenant?.tenantId ?? active.getTenantId() ?? "landlord"}").`);
    }
  }
  const connection = active ?? bound ?? fallback ?? ConnectionManager.getDefault();
  if (connection?.isRetired() && !connection.isInTransaction() && !Connection.hasActiveScope()) {
    throw new Error("Connection is retired or closed; resolve a current connection.");
  }
  if (!connection) throw new Error("No database connection set. Configure the ORM or set a default connection first.");
  return connection;
}

/** Register an external effect; queue/search may also be configured without a database. */
export async function afterCommit(callback: () => unknown | Promise<unknown>): Promise<void> {
  const connection = TransactionContext.current() ?? TenantContext.current()?.connection ?? ConnectionManager.getDefault();
  if (connection) await connection.afterCommit(callback);
  else await callback();
}

/** Tenant identity also covers the lower-level Connection.withTenant() scope. */
export function currentTenantId(): string | undefined {
  return TenantContext.current()?.tenantId ?? TransactionContext.current()?.getTenantId();
}
