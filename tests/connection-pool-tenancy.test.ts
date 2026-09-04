import { afterEach, describe, expect, test } from "bun:test";
import { Connection, ConnectionManager } from "../src/index.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("connection pool + tenant lifecycle", () => {
  afterEach(async () => {
    ConnectionManager.defaultTenantTtl = 300_000;
    await ConnectionManager.closeAll();
  });

  test("Connection.defaultPostgresPoolMax defaults to 10 and is configurable", () => {
    expect(Connection.defaultPostgresPoolMax).toBe(10);
    const original = Connection.defaultPostgresPoolMax;
    try {
      Connection.defaultPostgresPoolMax = 25;
      expect(Connection.defaultPostgresPoolMax).toBe(25);
    } finally {
      Connection.defaultPostgresPoolMax = original;
    }
  });

  test("defaultTenantTtl applies expiry to database-strategy contexts that own their pool", async () => {
    ConnectionManager.defaultTenantTtl = 5_000;
    ConnectionManager.setTenantResolver((tenantId) => ({
      strategy: "database",
      name: `owned:${tenantId}`,
      config: { url: "sqlite://:memory:" },
    }));

    const before = Date.now();
    const ctx = await ConnectionManager.resolveTenant("acme");

    expect(ctx.ownsConnection).toBe(true);
    expect(ctx.closeOnPurge).toBe(true);
    expect(ctx.expiresAt).toBeDefined();
    expect(ctx.expiresAt!).toBeGreaterThanOrEqual(before + 5_000);
    expect(ctx.expiresAt!).toBeLessThanOrEqual(Date.now() + 5_000);
  });

  test("resolution-level ttl overrides defaultTenantTtl", async () => {
    ConnectionManager.defaultTenantTtl = 5_000;
    ConnectionManager.setTenantResolver((tenantId) => ({
      strategy: "database",
      name: `ttl:${tenantId}`,
      config: { url: "sqlite://:memory:" },
      ttl: 50_000,
    }));

    const before = Date.now();
    const ctx = await ConnectionManager.resolveTenant("beta");

    expect(ctx.expiresAt!).toBeGreaterThanOrEqual(before + 50_000);
    expect(ctx.expiresAt!).toBeLessThanOrEqual(Date.now() + 50_000);
  });

  test("defaultTenantTtl does NOT apply to non-owning schema contexts", async () => {
    const shared = new Connection({ url: "sqlite://:memory:" });
    ConnectionManager.setDefault(shared);
    ConnectionManager.defaultTenantTtl = 5_000;
    ConnectionManager.setTenantResolver((tenantId) => ({
      strategy: "schema",
      name: `shared:${tenantId}`,
      schema: `tenant_${tenantId}`,
      mode: "qualify",
    }));

    const ctx = await ConnectionManager.resolveTenant("gamma");

    expect(ctx.ownsConnection).toBe(false);
    expect(ctx.expiresAt).toBeUndefined();
  });

  test("purgeExpiredTenants closes expired owned tenant pools", async () => {
    const closeCalls: string[] = [];
    const originalClose = Connection.prototype.close;
    Connection.prototype.close = async function (this: Connection) {
      closeCalls.push("close");
      return originalClose.call(this);
    };

    try {
      ConnectionManager.defaultTenantTtl = 20;
      ConnectionManager.setTenantResolver((tenantId) => ({
        strategy: "database",
        name: `expire:${tenantId}`,
        config: { url: "sqlite://:memory:" },
      }));

      await ConnectionManager.resolveTenant("delta");
      expect(ConnectionManager.get("expire:delta")).toBeDefined();

      await sleep(40);
      const purged = await ConnectionManager.purgeExpiredTenants({ close: true });

      expect(purged).toContain("delta");
      expect(ConnectionManager.getResolvedTenant("delta")).toBeUndefined();
      expect(ConnectionManager.get("expire:delta")).toBeUndefined();
      expect(closeCalls.length).toBeGreaterThan(0);
    } finally {
      Connection.prototype.close = originalClose;
    }
  });

  test("enableTenantSweep reclaims expired pools on its own; disable stops it", async () => {
    ConnectionManager.defaultTenantTtl = 20;
    ConnectionManager.setTenantResolver((tenantId) => ({
      strategy: "database",
      name: `swept:${tenantId}`,
      config: { url: "sqlite://:memory:" },
    }));

    await ConnectionManager.resolveTenant("omega");
    expect(ConnectionManager.get("swept:omega")).toBeDefined();

    ConnectionManager.enableTenantSweep(15);
    try {
      const deadline = Date.now() + 1_000;
      while (ConnectionManager.get("swept:omega") && Date.now() < deadline) {
        await sleep(15);
      }
      expect(ConnectionManager.get("swept:omega")).toBeUndefined();
      expect(ConnectionManager.getResolvedTenant("omega")).toBeUndefined();
    } finally {
      ConnectionManager.disableTenantSweep();
    }

    // After disable, a freshly expired tenant must NOT be auto-reclaimed.
    await ConnectionManager.resolveTenant("omega");
    expect(ConnectionManager.get("swept:omega")).toBeDefined();
    await sleep(60);
    expect(ConnectionManager.get("swept:omega")).toBeDefined();
  });

  test("closeAll stops the sweep timer", async () => {
    ConnectionManager.defaultTenantTtl = 20;
    ConnectionManager.setTenantResolver((tenantId) => ({
      strategy: "database",
      name: `final:${tenantId}`,
      config: { url: "sqlite://:memory:" },
    }));
    await ConnectionManager.resolveTenant("zeta");
    ConnectionManager.enableTenantSweep(15);

    await ConnectionManager.closeAll();

    // Sweep is gone; re-register and confirm no background reclamation.
    ConnectionManager.defaultTenantTtl = 20;
    ConnectionManager.setTenantResolver((tenantId) => ({
      strategy: "database",
      name: `final:${tenantId}`,
      config: { url: "sqlite://:memory:" },
    }));
    await ConnectionManager.resolveTenant("zeta");
    await sleep(60);
    expect(ConnectionManager.get("final:zeta")).toBeDefined();
  });
});

describe("concurrent tenant resolution", () => {
  afterEach(async () => {
    ConnectionManager.defaultTenantTtl = 300_000;
    await ConnectionManager.closeAll();
  });

  test("simultaneous callers share one resolution and one connection", async () => {
    let resolverCalls = 0;
    ConnectionManager.setTenantResolver(async (tenantId) => {
      resolverCalls++;
      // A real resolver hits a database or an API; the await is what opened the
      // window for a second caller to build a duplicate connection.
      await sleep(10);
      return { strategy: "database", name: `race:${tenantId}`, config: { url: "sqlite://:memory:" } };
    });

    const [a, b, c] = await Promise.all([
      ConnectionManager.resolveTenant("acme"),
      ConnectionManager.resolveTenant("acme"),
      ConnectionManager.resolveTenant("acme"),
    ]);

    expect(resolverCalls).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
    // The registered connection must be the one every caller received; a second
    // build would have overwritten it and orphaned the first, unclosed.
    expect(ConnectionManager.get("race:acme")!.sharesResource(a.connection)).toBe(true);
  });

  test("different tenants still resolve independently", async () => {
    ConnectionManager.setTenantResolver(async (tenantId) => {
      await sleep(5);
      return { strategy: "database", name: `multi:${tenantId}`, config: { url: "sqlite://:memory:" } };
    });

    const [a, b] = await Promise.all([
      ConnectionManager.resolveTenant("one"),
      ConnectionManager.resolveTenant("two"),
    ]);

    expect(a.tenantId).toBe("one");
    expect(b.tenantId).toBe("two");
    expect(a.connection).not.toBe(b.connection);
  });

  test("closeAll() invalidates a resolution that is still in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });

    ConnectionManager.setTenantResolver(async (tenantId) => {
      await gate;
      return { strategy: "database", name: `late:${tenantId}`, config: { url: "sqlite://:memory:" } };
    });

    const pending = ConnectionManager.resolveTenant("acme");
    await ConnectionManager.closeAll();
    release();

    // Registering after shutdown would resurrect a connection and a tenant
    // entry with nothing left holding a reference to close them.
    await expect(pending).rejects.toThrow(/closed while resolving tenant/);
    expect(ConnectionManager.get("late:acme")).toBeUndefined();
    expect(ConnectionManager.getResolvedTenant("acme")).toBeUndefined();
  });

  test("a failed resolution does not stick around and block retries", async () => {
    let attempts = 0;
    ConnectionManager.setTenantResolver(async (tenantId) => {
      attempts++;
      await sleep(5);
      if (attempts === 1) throw new Error("resolver unavailable");
      return { strategy: "database", name: `retry:${tenantId}`, config: { url: "sqlite://:memory:" } };
    });

    await expect(ConnectionManager.resolveTenant("flaky")).rejects.toThrow("resolver unavailable");
    const ctx = await ConnectionManager.resolveTenant("flaky");
    expect(ctx.tenantId).toBe("flaky");
    expect(attempts).toBe(2);
  });
});
