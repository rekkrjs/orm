import { afterEach, describe, expect, test } from "./harness.js";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { Connection, ConnectionManager, DB, Model, Schema, reconfigureOrm } from "../src/index.js";
import { serverUrl, type ServerDriver } from "./driver-harness.js";

const directory = join(process.cwd(), "tmp_agents", `replicas-${process.pid}`);

class ReplicaItem extends Model {
  static override table = "replica_items";
  static override timestamps = false;
}

async function setup(sticky = false) {
  await mkdir(directory, { recursive: true });
  const write = `sqlite://${join(directory, "write.sqlite")}`;
  const read1 = `sqlite://${join(directory, "read1.sqlite")}`;
  const read2 = `sqlite://${join(directory, "read2.sqlite")}`;
  for (const [url, label] of [[write, "primary"], [read1, "replica-1"], [read2, "replica-2"]]) {
    const connection = new Connection({ url });
    await connection.run("CREATE TABLE replica_items (id INTEGER PRIMARY KEY, label TEXT)");
    await connection.run("INSERT INTO replica_items (id, label) VALUES (1, ?)", [label]);
    await connection.close();
  }
  await reconfigureOrm({ connection: { read: [read1, read2], write, sticky } });
  await ConnectionManager.getDefault()!.run("CREATE TABLE fallback_items (label TEXT)");
}

afterEach(async () => {
  await ConnectionManager.closeAll();
  await rm(directory, { recursive: true, force: true });
});

describe("read/write replicas", () => {
  test("reads rotate across replicas; writes, raw mutations and transactions use primary", async () => {
    await setup();
    expect((await DB.table("replica_items").first())?.label).toBe("replica-1");
    expect((await ReplicaItem.first())?.getAttribute("label")).toBe("replica-2");

    await DB.table("replica_items").where("id", 1).update({ label: "changed" });
    expect(await Schema.hasTable("fallback_items")).toBe(true);
    expect((await ConnectionManager.getDefault()!.query("SELECT label FROM replica_items"))[0]?.label).toBe("replica-1");
    await DB.raw("UPDATE replica_items SET label = 'raw' WHERE id = 1");

    await DB.transaction(async () => {
      expect((await DB.table("replica_items").first())?.label).toBe("raw");
      await DB.table("replica_items").where("id", 1).update({ label: "transaction" });
      expect((await DB.raw("SELECT label FROM replica_items"))[0]?.label).toBe("transaction");
    });
    expect((await DB.table("replica_items").first())?.label).toBe("replica-2");
    expect((await ConnectionManager.getDefault()!.query("SELECT label FROM replica_items"))[0]?.label).toBe("replica-1");
    expect((await ConnectionManager.getDefault()!.run("SELECT label FROM replica_items"))[0]?.label).toBe("transaction");
    expect(await DB.table("fallback_items").insertGetId({ label: "inserted" }, "missing")).toBe(1);
    expect((await ConnectionManager.getDefault()!.run("SELECT label FROM fallback_items"))[0]?.label).toBe("inserted");
  });

  test("sticky stays inside its async scope, including nested entry and out-of-order exits", async () => {
    await setup(true);
    let release!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    let written!: () => void;
    const wrote = new Promise<void>((resolve) => { written = resolve; });

    const first = DB.scope(async () => {
      expect((await DB.table("replica_items").first())?.label).toBe("replica-1");
      await DB.table("replica_items").where("id", 1).update({ label: "new" });
      written();
      await hold;
      expect((await DB.raw("SELECT label FROM replica_items"))[0]?.label).toBe("new");
      await DB.scope(async () => {
        expect((await ReplicaItem.first())?.getAttribute("label")).toBe("new");
      });
    });

    await wrote;
    const second = DB.scope(async () => {
      expect((await DB.table("replica_items").first())?.label).toBe("replica-2");
    });
    await second;
    release();
    await first;
    expect((await DB.table("replica_items").first())?.label).toBe("replica-1");
  });

  test("a failed write does not pin the scope to primary", async () => {
    await setup(true);
    await DB.scope(async () => {
      await expect(DB.raw("UPDATE missing_table SET label = 'x'")).rejects.toThrow();
      expect((await DB.table("replica_items").first())?.label).toBe("replica-1");
    });
  });

  test("read-only CTEs use a replica", async () => {
    await setup();
    const rows = await DB.raw("WITH selected AS (SELECT label FROM replica_items) SELECT label FROM selected");
    expect(rows).toEqual([{ label: "replica-1" }]);
  });
});

for (const driver of ["mysql", "postgres"] as ServerDriver[]) {
  const url = serverUrl(driver);
  (url ? test : test.skip)(`${driver} uses its own pool for reads and keeps transactions and sticky writes on primary`, async () => {
    const name = `orm_replica_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
    const orm = await reconfigureOrm({ connection: { read: [url!], write: url!, sticky: true } });
    const replica = ConnectionManager.get("orm:owned:1")!;
    const seen: Connection[] = [];
    const stop = DB.listen(event => { seen.push(event.connection); });
    try {
      expect(await DB.raw("SELECT 1 AS value")).toEqual([{ value: 1 }]);
      expect(seen.splice(0)).toEqual([replica]);

      await DB.transaction(async () => {
        expect(await DB.raw("SELECT 1 AS value")).toEqual([{ value: 1 }]);
      });
      expect(seen).toHaveLength(1);
      expect(seen[0]!.sharesResource(orm.connection)).toBe(true);
      seen.length = 0;

      await DB.scope(async () => {
        await DB.raw(`CREATE TABLE ${name} (id INTEGER)`);
        await DB.raw(`INSERT INTO ${name} (id) VALUES (7)`);
        expect(await DB.raw(`SELECT id FROM ${name}`)).toEqual([{ id: 7 }]);
      });
      expect(seen).toHaveLength(3);
      expect(seen.every(connection => connection.sharesResource(orm.connection))).toBe(true);
    } finally {
      stop();
      await orm.connection.run(`DROP TABLE IF EXISTS ${name}`);
      await ConnectionManager.closeAll();
    }
  });
}
