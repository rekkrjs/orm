import { expect, test, describe } from "bun:test";
import { Builder } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

describe("Query Builder", () => {
  test("generates basic select sql", () => {
    const connection = setupTestDb();
    const builder = new Builder(connection, "users");
    builder.where("age", ">", 18).orderBy("name").limit(10);
    const sql = builder.toRawSql();
    expect(sql).toContain('SELECT * FROM "users"');
    expect(sql).toContain('WHERE "age" > 18');
    expect(sql).toContain('ORDER BY "name" ASC');
    expect(sql).toContain("LIMIT 10");
  });

  test("toRawSql caches compiled SQL and invalidates after mutations", () => {
    const connection = setupTestDb();
    const builder = new Builder(connection, "users").where("age", ">", 18);

    const first = builder.toRawSql();
    const second = builder.toRawSql();
    expect(second).toBe(first);

    builder.orderBy("name");
    const afterOrder = builder.toRawSql();
    expect(afterOrder).not.toBe(first);
    expect(afterOrder).toContain('ORDER BY "name" ASC');

    builder.limit(5);
    const afterLimit = builder.toRawSql();
    expect(afterLimit).not.toBe(afterOrder);
    expect(afterLimit).toContain("LIMIT 5");
  });

  test("generates whereIn sql", () => {
    const connection = setupTestDb();
    const builder = new Builder(connection, "users");
    builder.whereIn("id", [1, 2, 3]);
    const sql = builder.toRawSql();
    expect(sql).toContain('"id" IN (1, 2, 3)');
  });

  test("generates join sql", () => {
    const connection = setupTestDb();
    const builder = new Builder(connection, "posts");
    builder.join("users", "posts.user_id", "=", "users.id");
    const sql = builder.toSql();
    expect(sql).toContain('INNER JOIN "users" ON "posts"."user_id" = "users"."id"');
  });

  test("inserts and retrieves rows", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)");
    const builder = new Builder(connection, "items");
    await builder.insert({ name: "Foo" });
    const rows = await builder.get();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Foo");
  });

  test("updates rows", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE upd (id INTEGER PRIMARY KEY, name TEXT)");
    await connection.run("INSERT INTO upd (name) VALUES ('Old')");
    const builder = new Builder(connection, "upd");
    await builder.where("id", 1).update({ name: "New" });
    const rows = await builder.where("id", 1).get();
    expect(rows[0].name).toBe("New");
  });

  test("deletes rows", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE del (id INTEGER PRIMARY KEY)");
    await connection.run("INSERT INTO del (id) VALUES (1), (2)");
    const builder = new Builder(connection, "del");
    await builder.where("id", 1).delete();
    const rows = await new Builder(connection, "del").get();
    expect(rows).toHaveLength(1);
  });

  test("count returns correct number", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE cnt (id INTEGER PRIMARY KEY)");
    await connection.run("INSERT INTO cnt (id) VALUES (1), (2), (3)");
    const builder = new Builder(connection, "cnt");
    const count = await builder.count();
    expect(count).toBe(3);
  });

  test("aggregate methods do not mutate selected columns", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE agg_state (id INTEGER PRIMARY KEY, name TEXT)");
    await connection.run("INSERT INTO agg_state (name) VALUES ('a'), ('b')");
    const builder = new Builder(connection, "agg_state").where("id", ">", 0);

    expect(await builder.count()).toBe(2);
    const rows = await builder.get();

    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveProperty("name", "a");
    expect(rows[0]).not.toHaveProperty("count");
  });

  test("bulk insert requires every record to have the same columns", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE bulk_shape (id INTEGER PRIMARY KEY, name TEXT, email TEXT)");

    await expect(
      new Builder(connection, "bulk_shape").insert([
        { name: "Alice" },
        { name: "Bob", email: "bob@example.com" },
      ])
    ).rejects.toThrow("Bulk insert records must have the same columns.");
  });

  test("insert omits undefined values but preserves explicit null", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE write_defaults (id INTEGER PRIMARY KEY, value TEXT DEFAULT 'database')");

    await new Builder(connection, "write_defaults").insert({ value: undefined } as any);
    await new Builder(connection, "write_defaults").insert({ value: null } as any);
    await new Builder(connection, "write_defaults").insertOrIgnore({ value: undefined } as any);
    await new Builder(connection, "write_defaults").where("id", 1).update({ value: undefined } as any);

    expect(await connection.query("SELECT value FROM write_defaults ORDER BY id")).toEqual([
      { value: "database" },
      { value: null },
      { value: "database" },
    ]);
  });

  test("insertGetId falls back to the rowid when the table has no such column", async () => {
    const connection = setupTestDb();
    // No "id" column: SQLite reads RETURNING "id" as a string literal rather
    // than failing, so the value has to come from the rowid instead.
    await connection.run("CREATE TABLE no_id_col (code TEXT PRIMARY KEY, name TEXT)");

    const first = await new Builder(connection, "no_id_col").insertGetId({ code: "a", name: "A" } as any);
    const second = await new Builder(connection, "no_id_col").insertGetId({ code: "b", name: "B" } as any);

    expect(Number(first)).toBe(1);
    expect(Number(second)).toBe(2);
    expect(await connection.query("SELECT COUNT(*) AS n FROM no_id_col")).toEqual([{ n: 2 }]);
  });

  test("insertGetId returns the declared key when the column exists", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE keyed (code TEXT PRIMARY KEY, name TEXT)");

    const key = await new Builder(connection, "keyed").insertGetId({ code: "abc", name: "A" } as any, "code" as any);
    expect(key).toBe("abc");
  });

  test("pluck returns array of values", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE plk (name TEXT)");
    await connection.run("INSERT INTO plk (name) VALUES ('a'), ('b')");
    const builder = new Builder(connection, "plk");
    const names = await builder.pluck("name");
    expect(names).toEqual(["a", "b"]);
  });

  test("pluck keyed by a second column returns a map", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE plk_keyed (id INTEGER PRIMARY KEY, email TEXT)");
    await connection.run("INSERT INTO plk_keyed (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com')");
    const builder = new Builder(connection, "plk_keyed");

    expect(await builder.pluck("email", "id")).toEqual({
      1: "a@example.com",
      2: "b@example.com",
    });
  });

  test("pluck keeps a __proto__ key instead of dropping it", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE plk_proto (k TEXT, v TEXT)");
    await connection.run("INSERT INTO plk_proto (k, v) VALUES ('__proto__', 'ghost'), ('normal', 'ok')");
    const builder = new Builder(connection, "plk_proto");

    const plucked = await builder.pluck("v", "k");

    expect(Object.keys(plucked).sort()).toEqual(["__proto__", "normal"]);
    expect(plucked["__proto__"]).toBe("ghost");
    expect(plucked["normal"]).toBe("ok");
    // Nothing a row carries can reach the prototype chain.
    expect(Object.getPrototypeOf(plucked)).toBeNull();
    expect(({} as any).ghost).toBeUndefined();
  });

  test("pluck resolves an alias the driver folded to lower case", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE plk_alias (id INTEGER PRIMARY KEY, name TEXT)");
    await connection.run("INSERT INTO plk_alias (id, name) VALUES (1, 'Ada'), (2, 'Grace')");

    // PostgreSQL folds unquoted identifiers, so "AS Label" comes back as "label".
    const query = connection.query.bind(connection);
    (connection as any).query = async (sql: string, bindings?: any[]) => {
      const rows = await query(sql, bindings);
      return (rows as any[]).map((row) =>
        Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]))
      );
    };

    expect(await new Builder(connection, "plk_alias").pluck("name as Label")).toEqual(["Ada", "Grace"]);
    expect(await new Builder(connection, "plk_alias").pluck("name as Label", "id as Key")).toEqual({
      1: "Ada",
      2: "Grace",
    });
  });

  test("pluck keyed by a column keeps the last row of a repeated key", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE plk_dupes (team TEXT, name TEXT)");
    await connection.run("INSERT INTO plk_dupes (team, name) VALUES ('red', 'Ada'), ('red', 'Grace'), ('blue', 'Linus')");
    const builder = new Builder(connection, "plk_dupes");

    expect(await builder.pluck("name", "team")).toEqual({ red: "Grace", blue: "Linus" });
  });

  test("pluck resolves qualified columns and aliases", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE plk_q (id INTEGER PRIMARY KEY, name TEXT)");
    await connection.run("INSERT INTO plk_q (id, name) VALUES (1, 'Ada')");

    expect(await new Builder(connection, "plk_q").pluck("plk_q.name")).toEqual(["Ada"]);
    expect(await new Builder(connection, "plk_q").pluck("plk_q.name", "plk_q.id")).toEqual({ 1: "Ada" });
    expect(await new Builder(connection, "plk_q").pluck("name as label")).toEqual(["Ada"]);
  });

  test("pluck with a key is still a single query over two columns", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE plk_sql (id INTEGER PRIMARY KEY, email TEXT)");

    // Observe the SQL that was actually issued rather than the builder's state:
    // pluck() compiles off a clone, so it leaves no trace on the builder.
    const issued: string[] = [];
    const query = connection.query.bind(connection);
    connection.query = ((sql: string, bindings?: any[]) => {
      issued.push(sql);
      return query(sql, bindings as any);
    }) as typeof connection.query;

    const builder = new Builder(connection, "plk_sql");
    await builder.pluck("email", "id");

    expect(issued).toEqual(['SELECT "email", "id" FROM "plk_sql"']);
  });

  test("pluck does not narrow the builder it was called on", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE plk_keep (id INTEGER PRIMARY KEY, email TEXT)");
    await connection.run("INSERT INTO plk_keep (id, email) VALUES (1, 'ada@example.com')");

    const builder = new Builder(connection, "plk_keep").where("id", 1);
    expect(await builder.pluck("email")).toEqual(["ada@example.com"]);

    // Previously pluck() overwrote the builder's columns and bindings, so this
    // came back as a single-column row with the WHERE binding already consumed.
    expect(builder.toRawSql()).toBe('SELECT * FROM "plk_keep" WHERE "id" = 1');
    expect(await builder.get()).toEqual([{ id: 1, email: "ada@example.com" }] as any);
  });

  test("exists returns boolean", async () => {
    const connection = setupTestDb();
    await connection.run("CREATE TABLE ex (id INTEGER PRIMARY KEY)");
    const builder = new Builder(connection, "ex");
    expect(await builder.where("id", 1).exists()).toBe(false);
    await connection.run("INSERT INTO ex (id) VALUES (1)");
    expect(await builder.where("id", 1).exists()).toBe(true);
  });
});
