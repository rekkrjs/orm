import { afterEach, expect, setSystemTime, test } from "bun:test";
import { Connection, ConnectionManager, configureOrm, reconfigureOrm, DB, TenantContext } from "../src/index.js";

afterEach(async () => { setSystemTime(); await ConnectionManager.closeAll(); });
const resolution = (id: string) => ({ strategy: "database" as const, name: id, config: { url: "sqlite://:memory:" }, ttl: 100 });

test("TTL starts again after active scopes and bound queries finish", async () => {
  setSystemTime(1_000);
  await ConnectionManager.setTenantResolver(resolution);
  let connection!: Connection;
  await DB.tenant("a", async () => {
    connection = TenantContext.current()!.connection;
    setSystemTime(2_000);
    expect(await ConnectionManager.purgeExpiredTenants()).toEqual([]);
    await connection.query("SELECT 1");
  });
  setSystemTime(2_050);
  await connection.query("SELECT 1");
  setSystemTime(2_120);
  expect(await ConnectionManager.purgeExpiredTenants()).toEqual([]);
  setSystemTime(2_151);
  expect(ConnectionManager.getResolvedTenant("a")).toBeUndefined();
  expect(await ConnectionManager.purgeExpiredTenants()).toEqual(["a"]);
  await expect(connection.query("SELECT 1")).rejects.toThrow(/closed|retired/);
});

test("closing waits for active work and does not close borrowed resources", async () => {
  await ConnectionManager.setTenantResolver(resolution);
  let release!: () => void;
  let started!: () => void;
  const start = new Promise<void>(r => { started = r; });
  const gate = new Promise<void>(r => { release = r; });
  const scope = DB.tenant("a", async () => {
    started();
    await gate;
    expect((await DB.raw("SELECT 1 AS value"))[0].value).toBe(1);
  });
  await start;
  let closed = false;
  const close = ConnectionManager.closeTenant("a").then(() => { closed = true; });
  await Promise.resolve();
  expect(closed).toBe(false);
  release();
  await Promise.all([scope, close]);
  const borrowed = new Connection({ url: "sqlite://:memory:" });
  ConnectionManager.add("borrowed", borrowed);
  await ConnectionManager.closeAll();
  expect(await borrowed.query("SELECT 1")).toHaveLength(1);
  await borrowed.close();
});

test("changing resolver invalidates older in-flight results", async () => {
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  await ConnectionManager.setTenantResolver(async id => { await gate; return resolution(`old-${id}`); });
  const old = ConnectionManager.resolveTenant("a");
  await ConnectionManager.setTenantResolver(id => resolution(`new-${id}`));
  const current = await ConnectionManager.resolveTenant("a");
  release();
  await expect(old).rejects.toThrow(/closed while resolving/);
  expect(ConnectionManager.getResolvedTenant("a")).toBe(current);
  expect(ConnectionManager.get("old-a")).toBeUndefined();
});

test("shutdown retains failed owned pools for a successful retry", async () => {
  const owned = ConnectionManager.add("owned", { url: "sqlite://:memory:" });
  const original = owned.close.bind(owned);
  let attempts = 0;
  owned.close = async () => { if (++attempts === 1) throw new Error("injected close failure"); await original(); };
  await expect(ConnectionManager.closeAll()).rejects.toThrow("shutdown failed");
  await expect(owned.query("SELECT 1")).rejects.toThrow("retired");
  await ConnectionManager.closeAll();
  expect(attempts).toBe(2);
});


test("reconfigure validates first, drains active work and clears omitted subsystems", async () => {
  const { Cache, MemoryCacheStore } = await import("../src/cache/index.js");
  const { Queue } = await import("../src/queue/index.js");
  const { Search } = await import("../src/search/index.js");
  const base = { connection: { url: "sqlite://:memory:" } };
  const first = configureOrm({ ...base, cache: { store: new MemoryCacheStore() }, queue: { driver: "db" }, search: { engine: "sqlite" }, tenancy: { resolveTenant: resolution } });
  expect(() => configureOrm(base)).toThrow("already configured");
  await expect(reconfigureOrm({ connection: { driver: "invalid" } } as any)).rejects.toThrow("supported");
  expect(await first.connection.query("SELECT 1")).toHaveLength(1);
  let release!: () => void;
  let entered!: () => void;
  const start = new Promise<void>(r => { entered = r; });
  const gate = new Promise<void>(r => { release = r; });
  const work = DB.transaction(async () => {
    entered(); await gate;
    expect(await DB.raw("SELECT 1")).toHaveLength(1);
  });
  await start;
  const replacement = reconfigureOrm(base);
  await expect(first.connection.query("SELECT 1")).rejects.toThrow(/retired/);
  release();
  await work;
  const next = await replacement;
  expect(await next.connection.query("SELECT 1")).toHaveLength(1);
  expect(() => Cache.getStore()).toThrow();
  expect(() => Queue.getDriver()).toThrow();
  expect(() => Search.engine()).toThrow();
  await expect(ConnectionManager.resolveTenant("a")).rejects.toThrow(/resolver/);
});
