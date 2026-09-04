import { afterEach, expect, test } from "bun:test";
import { Connection, ConnectionManager, DB, TenantContext } from "../src/index.js";
import { PostgresFTSEngine, SqliteFTS5Engine } from "../src/search/index.js";

afterEach(() => ConnectionManager.closeAll());
const pgUrl = process.env.POSTGRES_TEST_URL;

test.skipIf(!pgUrl)("failed PostgreSQL COMMIT discards effects in callback and manual transactions", async () => {
  const pg = ConnectionManager.add("pg", { url: pgUrl! });
  ConnectionManager.setDefault(pg);
  const table = `v3_commit_${process.pid}`;
  let delivered = 0;
  try {
    await pg.run(`CREATE TABLE ${table} (id integer UNIQUE DEFERRABLE INITIALLY DEFERRED)`);
    await expect(pg.transaction(async () => {
      await pg.run(`INSERT INTO ${table} VALUES (1), (1)`);
      await pg.afterCommit(() => { delivered++; });
    })).rejects.toThrow();
    await pg.beginTransaction();
    await pg.run(`INSERT INTO ${table} VALUES (1), (1)`);
    await pg.afterCommit(() => { delivered++; });
    await expect(pg.commit()).rejects.toThrow();
    expect(delivered).toBe(0);
    expect(await pg.query(`SELECT * FROM ${table}`)).toHaveLength(0);
  } finally { await pg.run(`DROP TABLE IF EXISTS ${table}`); }
});

test.skipIf(!pgUrl)("qualify preserves aliases, joins, CTEs and rollback across two tenant schemas", async () => {
  const pg = ConnectionManager.add("pg", { url: pgUrl! });
  ConnectionManager.setDefault(pg);
  const schemas = [`v3_a_${process.pid}`, `v3_b_${process.pid}`];
  await ConnectionManager.setTenantResolver(id => ({ strategy: "schema", name: id, connection: pg, schema: schemas[id === "a" ? 0 : 1]!, mode: "qualify" }));
  try {
    for (const schema of schemas) {
      await pg.run(`CREATE SCHEMA "${schema}"`);
      await pg.run(`CREATE TABLE "${schema}".items (id integer PRIMARY KEY, name text)`);
    }
    const write = () => DB.tenant("a", async () => {
      await DB.table("items").insert({ id: 1, name: "a" });
      await DB.tenant("b", async () => {
        await DB.table("items").insert({ id: 1, name: "b" });
        const rows = await DB.table("items as i").join("items as j", "i.id", "=", "j.id").select("i.name").get();
        expect(rows[0].name).toBe("b");
        const sub = DB.table("items").select("name");
        expect((await DB.table("picked").withRecursive("picked", sub, DB.table("picked").select("name").whereRaw("false")).get())[0].name).toBe("b");
        await DB.table("items").where("id", 1).update({ name: "updated" });
      });
      expect((await DB.table("items").get())[0].name).toBe("a");
    });
    await expect(DB.transaction(async () => { await write(); throw new Error("abort"); })).rejects.toThrow("abort");
    for (const schema of schemas) expect(await pg.query(`SELECT * FROM "${schema}".items`)).toHaveLength(0);
    await DB.transaction(write);
    expect((await pg.query(`SELECT name FROM "${schemas[1]}".items`))[0].name).toBe("updated");
  } finally { for (const schema of schemas) await pg.run(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
});

test.skipIf(!pgUrl)("finished search_path and RLS objects require reentering their tenant", async () => {
  const pg = ConnectionManager.add("pg", { url: pgUrl! });
  ConnectionManager.setDefault(pg);
  for (const strategy of ["schema", "rls"] as const) {
    await ConnectionManager.setTenantResolver(id => strategy === "schema"
      ? { strategy, name: id, connection: pg, schema: "public", mode: "search_path" }
      : { strategy, name: id, connection: pg });
    let bound!: Connection;
    await DB.tenant("a", async () => { bound = TenantContext.current()!.connection; });
    await expect(bound.query("SELECT 1")).rejects.toThrow("Reenter tenant");
    await DB.tenant("a", async () => { expect(await bound.query("SELECT 1")).toHaveLength(1); });
  }
});

test.skipIf(!pgUrl)("bound transaction handles cannot join another transaction on the same pool", async () => {
  const pg = ConnectionManager.add("pg", { url: pgUrl!, max: 2 });
  ConnectionManager.setDefault(pg);
  let first!: Connection;
  let entered!: () => void;
  let finish!: () => void;
  const ready = new Promise<void>(r => { entered = r; });
  const gate = new Promise<void>(r => { finish = r; });
  const running = pg.transaction(async tx => { first = tx; entered(); await gate; });
  await ready;
  try {
    await pg.transaction(async () => { await expect(first.query("SELECT 1")).rejects.toThrow("context conflict"); });
  } finally { finish(); await running; }
});

for (const driver of ["sqlite", "postgres"] as const) {
  test.skipIf(driver === "postgres" && !pgUrl)(`${driver}: native search isolates identical index and record ids across tenants`, async () => {
    const connections = ["a", "b"].map(id => ConnectionManager.add(id, { url: driver === "sqlite" ? "sqlite://:memory:" : pgUrl! }));
    ConnectionManager.setDefault(connections[0]!);
    const schemas = [`v3_search_a_${process.pid}`, `v3_search_b_${process.pid}`];
    const engine = driver === "sqlite" ? new SqliteFTS5Engine({ shared: true }) : new PostgresFTSEngine({ connection: connections[0], useTriggers: false });
    engine.configureIndex("documents", { columns: ["title"] });
    await ConnectionManager.setTenantResolver(id => driver === "sqlite"
      ? { strategy: "database", name: id, config: { url: "sqlite://:memory:" } }
      : { strategy: "schema", name: id, connection: connections[0], schema: schemas[id === "a" ? 0 : 1]!, mode: "qualify" });
    try {
      if (driver === "postgres") for (const schema of schemas) await connections[0]!.run(`CREATE SCHEMA "${schema}"`);
      for (const id of ["a", "b"]) await DB.tenant(id, async () => {
        await engine.createIndex("documents");
        await engine.update([{ index: "documents", id: 1, data: { title: id === "a" ? "apple" : "banana" } }]);
      });
      for (const id of ["a", "b"]) await DB.tenant(id, async () => {
        const hits = await engine.search({ index: "documents", query: "apple", filters: [], sorts: [] });
        expect(hits).toHaveLength(id === "a" ? 1 : 0);
      });
    } finally { if (driver === "postgres") for (const schema of schemas) await connections[0]!.run(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
  });
}

for (const [driver, url] of Object.entries({ sqlite: "sqlite://:memory:", postgres: pgUrl, mysql: process.env.MYSQL_TEST_URL })) {
  test.skipIf(!url)(`${driver}: affectedRows preserves driver results and no-op semantics`, async () => {
    const db = ConnectionManager.add(driver, { url: url! });
    const table = `v3_counts_${process.pid}`;
    try {
      await db.run(`CREATE TABLE ${table} (id integer PRIMARY KEY, value integer)`);
      expect(db.affectedRows(await db.run(`INSERT INTO ${table} VALUES (1, 0), (2, 0)`))).toBe(2);
      expect(db.affectedRows(await db.run(`UPDATE ${table} SET value = 1`))).toBe(2);
      expect(db.affectedRows(await db.run(`UPDATE ${table} SET value = 1 WHERE id = 1`))).toBe(driver === "mysql" ? 0 : 1);
      expect(db.affectedRows(await db.run(`DELETE FROM ${table}`))).toBe(2);
    } finally { await db.run(`DROP TABLE IF EXISTS ${table}`); }
  });
}
