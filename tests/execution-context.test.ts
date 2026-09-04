import { afterEach, beforeEach, expect, test } from "bun:test";
import { Connection, ConnectionManager, DB, Model, TenantContext, TransactionContext } from "../src/index.js";
import { Cache, MemoryCacheStore } from "../src/cache/index.js";

class Item extends Model {
  static table = "context_items";
  static timestamps = false;
  static guarded: string[] = [];
}

let landlord: Connection;
let other: Connection;
beforeEach(async () => {
  landlord = new Connection({ url: "sqlite://:memory:" });
  other = new Connection({ url: "sqlite://:memory:" });
  Model.setConnection(landlord);
  ConnectionManager.add("landlord", landlord);
  ConnectionManager.add("other", other);
  for (const connection of [landlord, other]) {
    await connection.run("CREATE TABLE context_items (id INTEGER PRIMARY KEY, name TEXT)");
  }
  Cache.configure({ store: new MemoryCacheStore() });
});
afterEach(() => ConnectionManager.closeAll());

test("previously bound models, builders and connections participate in rollback", async () => {
  const item = await Item.create({ id: 1, name: "before" });
  const query = DB.table("context_items");
  class OtherItem extends Item { static connection = other; }
  await expect(DB.transaction(async () => {
    item.name = "after";
    await item.save();
    await query.insert({ id: 2, name: "builder" });
    await landlord.run("INSERT INTO context_items VALUES (3, 'connection')");
    await expect(DB.connection("other").table("context_items").insert({ id: 4 })).rejects.toThrow(/context|transaction/i);
    await expect(OtherItem.create({ id: 5, name: "incompatible model" })).rejects.toThrow(/context|transaction/i);
    throw new Error("abort");
  })).rejects.toThrow("abort");
  expect(Array.from(await DB.table("context_items").get(), row => row.name)).toEqual(["before"]);
  expect(await other.query("SELECT * FROM context_items")).toHaveLength(0);
});

test("query cache and cached builders do not cross tenants", async () => {
  await landlord.run("INSERT INTO context_items VALUES (1, 'landlord')");
  await other.run("INSERT INTO context_items VALUES (1, 'other')");
  ConnectionManager.setTenantResolver(id => ({ strategy: "database", name: id, config: { url: "sqlite://:memory:" } }));
  const read = (id: string) => DB.tenant(id, async () => Array.from(await Item.query().remember("items").get(), row => row.name));
  expect(await read("landlord")).toEqual(["landlord"]);
  expect(await read("other")).toEqual(["other"]);
  const bound = await DB.tenant("landlord", () => Item.query());
  await expect(DB.tenant("other", () => bound.get())).rejects.toThrow(/tenant|context/i);
});

test("afterCommit waits for the root and discards rolled-back savepoints", async () => {
  const effects: string[] = [];
  await DB.transaction(async (tx) => {
    await landlord.afterCommit(() => { effects.push("outer"); });
    await tx.transaction(async inner => {
      await (inner as any).afterCommit(() => { effects.push("committed child"); });
    });
    await expect(tx.transaction(async inner => {
      await (inner as any).afterCommit(() => { effects.push("rolled back child"); });
      throw new Error("child abort");
    })).rejects.toThrow("child abort");
    expect(effects).toEqual([]);
  });
  expect(effects).toEqual(["outer", "committed child"]);
  await expect(DB.transaction(async tx => {
    await (tx as any).afterCommit(() => { effects.push("root abort"); });
    throw new Error("abort");
  })).rejects.toThrow("abort");
  expect(effects).toHaveLength(2);
});

test("manual transactions drain effects once and post-commit errors do not undo data", async () => {
  const effects: string[] = [];
  await landlord.beginTransaction();
  await landlord.run("INSERT INTO context_items VALUES (1, 'persisted')");
  await (landlord as any).afterCommit(() => { throw new Error("delivery failed"); });
  await (landlord as any).afterCommit(() => {
    expect(TransactionContext.current()).toBeUndefined();
    expect(TenantContext.current()).toBeUndefined();
    effects.push("delivered");
  });
  await expect(landlord.commit()).rejects.toMatchObject({ committed: true });
  expect(await landlord.query("SELECT * FROM context_items")).toHaveLength(1);
  expect(effects).toEqual(["delivered"]);
  await landlord.commit();
  expect(effects).toHaveLength(1);
});


test("queue snapshots payload and tenant and dispatches only after commit", async () => {
  const { Queue, DispatchableJob } = await import("../src/queue/index.js");
  const payloads: any[] = [];
  Queue.configure({ dispatch: async (...args: any[]) => { payloads.push(JSON.parse(args[2])); } } as any);
  class Work extends DispatchableJob { async handle() {} }
  ConnectionManager.setTenantResolver(id => ({ strategy: "database", name: id, config: { url: "sqlite://:memory:" } }));
  await DB.tenant("other", async () => {
    await expect(DB.transaction(async () => {
      await Work.dispatch({ value: "abort" });
      throw new Error("abort");
    })).rejects.toThrow("abort");
    await DB.transaction(async () => {
      const data = { value: "saved" };
      await Queue.dispatch(new Work(data));
      data.value = "changed";
      expect(payloads).toEqual([]);
    });
  });
  expect(payloads).toEqual([{ args: [{ value: "saved" }], tenantId: "other" }]);
});


test.skipIf(!process.env.POSTGRES_TEST_URL)("failed search_path reset discards only the reserved session", async () => {
  const pg = new Connection({ url: process.env.POSTGRES_TEST_URL!, max: 1 });
  let poisonedPid: number;
  try {
    await expect(pg.withSearchPath("public", async scoped => {
      poisonedPid = (await scoped.query("SELECT pg_backend_pid() AS pid"))[0].pid;
      const run = scoped.run.bind(scoped);
      scoped.run = async (sql, bindings) => {
        if (sql === "RESET search_path") throw new Error("injected RESET failure");
        return run(sql, bindings);
      };
    })).rejects.toThrow("injected RESET failure");
    const next = await pg.query("SELECT pg_backend_pid() AS pid, current_schema() AS schema");
    expect(next[0].pid).not.toBe(poisonedPid!);
    expect(next[0].schema).toBe("public");
    await expect(pg.withSearchPath("public", async scoped => {
      await scoped.beginTransaction();
      await scoped.run("CREATE TABLE poisoned_uncommitted (id integer)");
    })).rejects.toThrow("open transaction");
    expect((await pg.query("SELECT to_regclass('poisoned_uncommitted') AS table"))[0].table).toBeNull();
  } finally { await pg.close(); }
});


test("query cache separates distinct in-memory pools with identical configuration", async () => {
  await landlord.run("INSERT INTO context_items VALUES (1, 'landlord')");
  await other.run("INSERT INTO context_items VALUES (1, 'other')");
  expect(Array.from(await DB.table("context_items").remember("same-key").get(), r => r.name)).toEqual(["landlord"]);
  expect(Array.from(await DB.connection("other").table("context_items").remember("same-key").get(), r => r.name)).toEqual(["other"]);
});
