import { Connection } from "./Connection.js";
import type { ConnectionConfig } from "../types/index.js";
import type { ActiveTenantContext } from "./TenantContext.js";

export interface TenantCachePolicy {
  ttl?: number;
  closeOnPurge?: boolean;
}

type TenantResolutionOptions = TenantCachePolicy;

export type TenantResolution =
  | ({ strategy: "database"; name: string; config: ConnectionConfig } & TenantResolutionOptions)
  | ({ strategy: "schema"; name: string; config?: ConnectionConfig; connection?: string | Connection; schema: string; mode?: "qualify" | "search_path" } & TenantResolutionOptions)
  | ({ strategy: "rls"; name: string; config?: ConnectionConfig; connection?: string | Connection; tenantId?: string; setting?: string; role?: string } & TenantResolutionOptions);

export type TenantResolver = (tenantId: string) => TenantResolution | Promise<TenantResolution>;

export class ConnectionManager {
  private static defaultConnection?: Connection;
  private static connections = new Map<string, Connection>();
  private static ownedConnections = new Set<Connection>();
  private static shuttingDown = false;
  private static retiring?: Promise<void>;
  private static tenantResolver?: TenantResolver;
  private static tenantCache = new Map<string, ActiveTenantContext>();
  /** In-flight resolutions, so concurrent callers share one connection. */
  private static tenantClosing = new Map<string, Promise<void>>();
  private static tenantInflight = new Map<string, Promise<ActiveTenantContext>>();
  /** Bumped by closeAll(); a resolution that spans a bump discards its result. */
  private static shutdownGeneration = 0;
  private static sweepTimer?: ReturnType<typeof setInterval>;

  /**
   * Default TTL (ms) applied to tenant contexts that own their own connection
   * pool (the `database` strategy). Prevents idle per-tenant pools from
   * accumulating indefinitely. A resolution-level `ttl` always overrides it.
   */
  static defaultTenantTtl: number | undefined = 300_000;

  /**
   * Start a background sweep that closes expired tenant contexts so idle
   * per-tenant connection pools are reclaimed. Opt-in (no global timers by
   * default). The timer is `unref`'d so it never keeps the process alive.
   */
  static enableTenantSweep(intervalMs = 60_000): void {
    this.disableTenantSweep();
    const timer = setInterval(() => {
      void this.purgeExpiredTenants({ close: true }).catch(() => {});
    }, intervalMs);
    (timer as any).unref?.();
    this.sweepTimer = timer;
  }

  static disableTenantSweep(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
  }

  static setDefault(connection: Connection, options: { owned?: boolean } = {}): void {
    this.assertAcceptingConfiguration();
    this.defaultConnection = connection;
    if (options.owned) this.ownedConnections.add(connection.resourceConnection());
  }

  static getDefault(): Connection | undefined {
    return this.defaultConnection;
  }

  static clearDefault(): void {
    this.defaultConnection = undefined;
  }

  static add(name: string, connection: Connection | ConnectionConfig, options: { owned?: boolean } = {}): Connection {
    this.assertAcceptingConfiguration();
    const resolved = connection instanceof Connection ? connection : new Connection(connection);
    this.connections.set(name, resolved);
    if (options.owned ?? !(connection instanceof Connection)) this.ownedConnections.add(resolved.resourceConnection());
    return resolved;
  }

  static get(name: string): Connection | undefined {
    return this.connections.get(name);
  }

  static hasTenantState(): boolean { return !!(this.tenantCache.size || this.tenantInflight.size || this.retiring || this.shuttingDown); }

  private static assertAcceptingConfiguration(): void {
    if (this.retiring || this.shuttingDown) throw new Error("Connection manager is reconfiguring; await the pending change.");
  }

  static nameOf(connection: Connection): string {
    for (const [name, candidate] of this.connections) if (candidate.sharesResource(connection)) return name;
    return this.defaultConnection?.sharesResource(connection) ? "default" : connection.getDriverName();
  }

  static require(name: string): Connection {
    const connection = this.get(name);
    if (!connection) {
      throw new Error(`No connection registered for "${name}".`);
    }
    return connection;
  }

  static async setTenantResolver(resolver?: TenantResolver): Promise<void> {
    if (this.retiring || this.shuttingDown) throw new Error("Connection manager is reconfiguring; await the pending change.");
    if (Connection.hasActiveScope()) throw new Error("Change the tenant resolver outside active ORM scopes.");
    this.shutdownGeneration++;
    this.tenantInflight.clear();
    if (!this.tenantCache.size) { this.tenantResolver = resolver; return; }
    const ids = [...this.tenantCache.keys()];
    this.retiring = (async () => { for (const id of ids) await this.closeTenant(id); })();
    try { await this.retiring; this.tenantResolver = resolver; } finally { this.retiring = undefined; }
  }

  static touchTenant(tenantId: string | undefined, root: Connection): void {
    if (tenantId === undefined) return;
    const context = this.tenantCache.get(tenantId);
    if (!context || context.connection.resourceConnection() !== root) return;
    context.lastUsedAt = Date.now();
    context.expiresAt = context.ttl ? context.lastUsedAt + context.ttl : undefined;
  }

  private static expired(context: ActiveTenantContext): boolean {
    return !!context.expiresAt && context.expiresAt <= Date.now() && !context.connection.isBusy();
  }

  static async resolveTenant(tenantId: string): Promise<ActiveTenantContext> {
    if ((this.retiring || this.shuttingDown || this.tenantClosing.has(tenantId)) && !Connection.hasActiveScope()) throw new Error("Connection manager is reconfiguring; await the pending change.");
    const cached = this.tenantCache.get(tenantId);
    if (cached) {
      if (!this.expired(cached)) {
        this.touchTenant(tenantId, cached.connection.resourceConnection());
        return cached;
      }
      await this.closeTenant(tenantId);
    }
    if (!this.tenantResolver || this.shuttingDown) {
      throw new Error("No tenant resolver configured or connection manager is shutting down.");
    }

    // Single-flight: two concurrent requests for the same cold tenant would
    // each build a Connection and each register it under `resolution.name`, so
    // the second overwrote the first and left it open with no way to close it.
    const inflight = this.tenantInflight.get(tenantId);
    if (inflight) return inflight;

    const promise = this.buildTenantContext(tenantId, this.shutdownGeneration);
    this.tenantInflight.set(tenantId, promise);
    try {
      return await promise;
    } finally {
      if (this.tenantInflight.get(tenantId) === promise) this.tenantInflight.delete(tenantId);
    }
  }

  private static async buildTenantContext(tenantId: string, generation: number): Promise<ActiveTenantContext> {
    if (!this.tenantResolver) {
      throw new Error("No tenant resolver configured.");
    }

    const resolution = await this.tenantResolver(tenantId);
    if (generation !== this.shutdownGeneration) throw new Error(`Connection manager was closed while resolving tenant "${tenantId}".`);
    const resolvedAt = Date.now();
    const schema = resolution.strategy === "schema" ? resolution.schema : undefined;
    const schemaMode = resolution.strategy === "schema" ? resolution.mode || "qualify" : undefined;
    let ownsConnection = false;
    let connection = (resolution.strategy === "schema" || resolution.strategy === "rls") && resolution.connection instanceof Connection
      ? resolution.connection
      : (resolution.strategy === "schema" || resolution.strategy === "rls") && typeof resolution.connection === "string"
      ? this.require(resolution.connection)
      : this.connections.get(resolution.name);
    if (!connection) {
      if ((resolution.strategy === "schema" || resolution.strategy === "rls") && !resolution.config) {
        connection = this.defaultConnection;
      }
      if (!connection && !resolution.config) {
        throw new Error(`No connection config or registered connection found for tenant "${tenantId}".`);
      }
    }
    if (!connection) {
      const config = resolution.config;
      if (!config) {
        throw new Error(`No connection config or registered connection found for tenant "${tenantId}".`);
      }
      connection = new Connection(config, { schema });
      this.connections.set(resolution.name, connection);
      ownsConnection = true;
      this.ownedConnections.add(connection);
    } else if (schema && schemaMode === "qualify") {
      connection = connection.withSchema(schema);
    }

    const effectiveTtl = resolution.ttl ?? (ownsConnection ? this.defaultTenantTtl : undefined);

    const context: ActiveTenantContext = {
      tenantId,
      connection: connection.withTenantId(tenantId),
      connectionName: resolution.name,
      strategy: resolution.strategy,
      resolvedAt,
      lastUsedAt: resolvedAt,
      ttl: effectiveTtl,
      expiresAt: effectiveTtl ? resolvedAt + effectiveTtl : undefined,
      closeOnPurge: resolution.closeOnPurge ?? ownsConnection,
      ownsConnection,
      schema,
      schemaMode,
      rlsTenantId: resolution.strategy === "rls" ? resolution.tenantId || tenantId : undefined,
      rlsSetting: resolution.strategy === "rls" ? resolution.setting || "app.tenant_id" : undefined,
      rlsRole: resolution.strategy === "rls" ? resolution.role : undefined,
    };
    // closeAll() may have run while the resolver was awaiting. Registering now
    // would resurrect a connection and a tenant entry after shutdown, with
    // nothing left holding a reference to close them.
    if (generation !== ConnectionManager.shutdownGeneration) {
      if (this.connections.get(resolution.name) === connection) {
        this.connections.delete(resolution.name);
      }
      if (ownsConnection) await connection.close();
      throw new Error(
        `Connection manager was closed while resolving tenant "${tenantId}".`,
      );
    }

    this.tenantCache.set(tenantId, context);
    return context;
  }

  static getResolvedTenant(tenantId: string): ActiveTenantContext | undefined {
    const context = this.tenantCache.get(tenantId);
    // Retain expired entries so a later sweep still owns their resources.
    if (!context || this.expired(context) || (this.tenantClosing.has(tenantId) && !Connection.hasActiveScope())) return undefined;
    this.touchTenant(tenantId, context.connection.resourceConnection());
    return context;
  }

  static async purgeExpiredTenants(options: { close?: boolean } = {}): Promise<string[]> {
    const purged: string[] = [];
    for (const [tenantId, context] of [...this.tenantCache.entries()]) {
      if (!this.expired(context)) continue;
      purged.push(tenantId);
      if (options.close ?? context.closeOnPurge) {
        await this.closeTenant(tenantId);
      } else {
        this.tenantCache.delete(tenantId);
      }
    }
    return purged;
  }

  static async closeTenant(tenantId: string): Promise<void> {
    const existing = this.tenantClosing.get(tenantId);
    if (existing) return existing;
    const context = this.tenantCache.get(tenantId);
    if (!context) return;
    if (Connection.hasActiveScope()) throw new Error("Close tenants outside active ORM scopes.");
    const root = context.connection.resourceConnection();
    const close = (async () => {
      const shared = [...this.tenantCache.values()].some(other => other !== context && other.connection.resourceConnection() === root);
      if (context.closeOnPurge && this.ownedConnections.has(root) && !shared && this.defaultConnection?.resourceConnection() !== root) {
        await root.close();
        this.ownedConnections.delete(root);
        for (const [name, connection] of this.connections) {
          if (connection.resourceConnection() === root) this.connections.delete(name);
        }
      } else await root.waitForIdle();
      if (this.tenantCache.get(tenantId) === context) this.tenantCache.delete(tenantId);
    })();
    this.tenantClosing.set(tenantId, close);
    try { await close; } finally { this.tenantClosing.delete(tenantId); }
  }

  static async closeAll(options: { beforeClose?: () => Promise<void> } = {}): Promise<void> {
    if (Connection.hasActiveScope()) throw new Error("Cannot shut down connections from an active ORM scope; finish the scope first.");
    if (this.retiring) await this.retiring;
    const connections = [...this.ownedConnections];
    this.disableTenantSweep();
    // Invalidate resolutions still awaiting their resolver, and stop new
    // callers from joining one.
    this.shutdownGeneration++;
    this.tenantInflight.clear();
    this.shuttingDown = true;
    const all = new Set([...connections, ...this.connections.values(), ...(this.defaultConnection ? [this.defaultConnection] : [])].map(c => c.resourceConnection()));
    for (const connection of connections) connection.retire();
    while ([...all].some(connection => connection.isBusy())) {
      await Promise.all([...all].map(connection => connection.waitForIdle()));
    }
    if (options.beforeClose) await Connection.finishDraining(all, options.beforeClose);
    this.connections.clear();
    this.tenantCache.clear();
    this.defaultConnection = undefined;
    this.tenantResolver = undefined;

    const results = await Promise.allSettled(connections.map(async connection => {
      await connection.close();
      this.ownedConnections.delete(connection);
    }));
    this.shuttingDown = false;
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), "Connection shutdown failed; retry closeAll().");
  }
}
