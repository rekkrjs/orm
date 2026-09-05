import { expect, test } from "bun:test";
import { Connection, ConnectionManager, DB, ObserverRegistry, Schema, TenantContext } from "../src/index.js";
import { PermissiveModel, setupTestDb, teardownTestDb } from "./helpers.js";

function gate() {
  let open!: () => void;
  const wait = new Promise<void>(resolve => { open = resolve; });
  return { wait, open };
}

test("withoutTimestamps overlaps, nests, and leaves unrelated writes and model configuration intact", async () => {
  const db = setupTestDb();
  class Row extends PermissiveModel { static override table = "scope_rows"; }
  class Other extends PermissiveModel { static override table = "scope_rows"; }
  const firstExit = gate(), secondExit = gate();
  try {
    await Schema.create(Row.table, table => { table.increments("id"); table.timestamps(); });
    const first = Row.withoutTimestamps(async () => {
      await firstExit.wait;
      return Row.create({});
    });
    const second = Row.withoutTimestamps(async () => {
      await secondExit.wait;
      const nested = await Row.withoutTimestamps(() => Row.create({}));
      const other = await Other.create({});
      return { nested, other, last: await Row.create({}) };
    });
    const outside = await Row.create({});
    firstExit.open();
    const a = await first;
    const between = await Row.create({});
    secondExit.open();
    const b = await second;
    expect(Row.timestamps).toBe(true);
    for (const row of [outside, between, b.other]) {
      expect(row.getAttribute("created_at")).toBeInstanceOf(Date);
      expect(row.getAttribute("updated_at")).toBeInstanceOf(Date);
    }
    for (const row of [a, b.nested, b.last]) {
      expect(row.$attributes).not.toHaveProperty("created_at");
      expect(row.$attributes).not.toHaveProperty("updated_at");
    }
  } finally {
    firstExit.open(); secondExit.open();
    await teardownTestDb(db);
  }
});

test("withoutEvents scopes overlap and nest without muting unrelated callbacks", async () => {
  const firstExit = gate(), secondExit = gate();
  const first = ObserverRegistry.withoutEvents(async () => {
    await firstExit.wait;
    expect(ObserverRegistry.eventsMuted()).toBe(true);
  });
  const second = ObserverRegistry.withoutEvents(async () => {
    await secondExit.wait;
    await ObserverRegistry.withoutEvents(async () => expect(ObserverRegistry.eventsMuted()).toBe(true));
    expect(ObserverRegistry.eventsMuted()).toBe(true);
  });
  expect(ObserverRegistry.eventsMuted()).toBe(false);
  firstExit.open(); await first;
  expect(ObserverRegistry.eventsMuted()).toBe(false);
  secondExit.open(); await second;
  expect(ObserverRegistry.eventsMuted()).toBe(false);
});

const postgres = process.env.POSTGRES_TEST_URL;
const pgTest = postgres ? test.serial : test.skip;

async function tenantSetting(connection: Connection): Promise<string> {
  return (await connection.query("SELECT current_setting('app.tenant_id', true) AS tenant"))[0].tenant;
}

pgTest("low-level withTenant rejects incompatible reentry before changing PostgreSQL session state", async () => {
  const db = new Connection({ url: postgres!, max: 1 });
  try {
    await db.run("SELECT set_config('app.tenant_id', 'landlord', false)");
    await db.withTenant("A", async scoped => {
      expect(scoped.getTenantId()).toBe("A");
      expect(await tenantSetting(scoped)).toBe("A");
      let entered = false;
      const changed = await scoped.withTenant("B", async inner => {
        entered = true;
        return [inner.getTenantId(), await tenantSetting(inner)];
      }).then(() => false, () => true);
      expect(changed).toBe(true);
      expect(entered).toBe(false);
      await scoped.withTenant("A", async inner => {
        expect(inner.getTenantId()).toBe("A");
        expect(await tenantSetting(inner)).toBe("A");
      });
      await expect(scoped.withTenant("A", async inner => tenantSetting(inner), "app.other_tenant")).rejects.toThrow();
      await expect(scoped.withTenant("A", async inner => tenantSetting(inner), "app.tenant_id", "postgres")).rejects.toThrow();
      expect(await tenantSetting(scoped)).toBe("A");
    });
    expect(await tenantSetting(db)).toBe("landlord");
    await expect(db.withTenant("A", async scoped => {
      expect(await tenantSetting(scoped)).toBe("A");
      throw new Error("abort");
    })).rejects.toThrow("abort");
    expect(await tenantSetting(db)).toBe("landlord");
  } finally { await db.close(); }
});

pgTest("withTenant isolates overlapping scopes with out-of-order exits", async () => {
  const db = new Connection({ url: postgres!, max: 3 });
  const enteredA = gate(), enteredB = gate(), exitA = gate(), exitB = gate();
  const scope = (id: string, entered: ReturnType<typeof gate>, exit: ReturnType<typeof gate>) => db.withTenant(id, async scoped => {
    entered.open(); await exit.wait;
    expect(scoped.getTenantId()).toBe(id);
    expect(await tenantSetting(scoped)).toBe(id);
  });
  const first = scope("A", enteredA, exitA);
  const second = scope("B", enteredB, exitB);
  try {
    await Promise.all([enteredA.wait, enteredB.wait]);
    expect(await tenantSetting(db)).not.toBe("A");
    expect(await tenantSetting(db)).not.toBe("B");
    exitA.open(); await first;
    exitB.open(); await second;
    expect(db.getTenantId()).toBeUndefined();
  } finally { exitA.open(); exitB.open(); await Promise.allSettled([first, second]); await db.close(); }
});

pgTest("RLS reentry preserves a logical tenant ID distinct from its PostgreSQL value", async () => {
  const db = new Connection({ url: postgres!, max: 1 });
  await ConnectionManager.setTenantResolver(async () => ({
    strategy: "rls", connection: db, tenantId: "uuid-for-acme",
  }));
  try {
    await DB.tenant("acme", async () => {
      const scoped = TenantContext.current()!.connection;
      expect(scoped.getTenantId()).toBe("acme");
      await scoped.withTenant("uuid-for-acme", async inner => {
        expect(inner.getTenantId()).toBe("acme");
        expect(await tenantSetting(inner)).toBe("uuid-for-acme");
      });
      expect(await tenantSetting(scoped)).toBe("uuid-for-acme");
    });
  } finally { await ConnectionManager.closeAll(); await db.close(); }
});

pgTest("withTenant refuses an existing non-RLS transaction without changing its session", async () => {
  const db = new Connection({ url: postgres!, max: 1 });
  try {
    await db.run("SELECT set_config('app.tenant_id', 'landlord', false)");
    await db.transaction(async tx => {
      await expect(tx.withTenant("A", async inner => tenantSetting(inner))).rejects.toThrow("existing transaction");
      expect(await tenantSetting(tx)).toBe("landlord");
    });
    expect(await tenantSetting(db)).toBe("landlord");
  } finally { await db.close(); }
});

pgTest("withTenant restores a borrowed search_path session before the next RLS scope", async () => {
  const db = new Connection({ url: postgres!, max: 1 });
  try {
    await db.withSearchPath("public", async session => {
      const before = await tenantSetting(session);
      for (const id of ["A", "B"]) {
        await session.withTenant(id, async scoped => {
          expect(scoped.getTenantId()).toBe(id);
          expect(await tenantSetting(scoped)).toBe(id);
        });
        expect(session.getTenantId()).toBeUndefined();
        expect((await tenantSetting(session)) || null).toBe(before || null);
      }
    });
  } finally { await db.close(); }
});

pgTest("withSearchPath isolates overlapping and nested scopes and restores sessions", async () => {
  const db = new Connection({ url: postgres!, max: 4 });
  const enteredA = gate(), enteredB = gate(), exitA = gate(), exitB = gate();
  const path = async (connection: Connection) => (await connection.query("SHOW search_path"))[0].search_path;
  const baseline = await path(db);
  const scope = (schema: string, entered: ReturnType<typeof gate>, exit: ReturnType<typeof gate>) => db.withSearchPath(schema, async scoped => {
    entered.open(); await exit.wait;
    expect(await path(scoped)).toBe(schema);
    await db.withSearchPath(schema, async nested => expect(await path(nested)).toBe(schema));
    expect(await path(scoped)).toBe(schema);
  });
  const first = scope("public", enteredA, exitA);
  const second = scope("pg_catalog", enteredB, exitB);
  try {
    await Promise.all([enteredA.wait, enteredB.wait]);
    expect(await path(db)).toBe(baseline);
    exitA.open(); await first;
    exitB.open(); await second;
    expect(await path(db)).toBe(baseline);
  } finally { exitA.open(); exitB.open(); await Promise.allSettled([first, second]); await db.close(); }
});
