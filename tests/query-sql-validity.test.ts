import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Connection, Model, Schema } from "../src/index.js";
import { PostgresGrammar } from "../src/query/grammars/PostgresGrammar.js";
import { MySqlGrammar } from "../src/query/grammars/MySqlGrammar.js";
import { SQLiteGrammar } from "../src/query/grammars/SQLiteGrammar.js";
import { PermissiveModel, setupTestDb, teardownTestDb } from "./helpers.js";

interface UserAttributes { id: number; name: string }
interface OrderAttributes { id: number; user_id: number; status: string }

class QUser extends PermissiveModel.define<UserAttributes>("q_users") { static override timestamps = false; }
class QOrder extends PermissiveModel.define<OrderAttributes>("q_orders") { static override timestamps = false; }

let connection: Connection;

beforeAll(async () => {
  connection = setupTestDb();
  await Schema.create("q_users", (table) => {
    table.increments("id");
    table.string("name");
  });
  await Schema.create("q_orders", (table) => {
    table.increments("id");
    table.integer("user_id");
    table.string("status");
  });

  const ada = await QUser.create({ name: "Ada" });
  await QUser.create({ name: "Linus" });
  await QOrder.create({ user_id: ada.getAttribute("id"), status: "paid" });
  await QOrder.create({ user_id: ada.getAttribute("id"), status: "refunded" });
});

afterAll(async () => {
  await teardownTestDb(connection);
});

describe("exists()", () => {
  test("includes joins so a where on a joined table resolves", async () => {
    const found = await QUser.query()
      .join("q_orders", "q_orders.user_id", "=", "q_users.id")
      .where("q_orders.status", "paid")
      .exists();
    expect(found).toBe(true);

    const missing = await QUser.query()
      .join("q_orders", "q_orders.user_id", "=", "q_users.id")
      .where("q_orders.status", "chargeback")
      .exists();
    expect(missing).toBe(false);
  });

  test("agrees with count() over the same joined query", async () => {
    const build = () => QUser.query()
      .join("q_orders", "q_orders.user_id", "=", "q_users.id")
      .where("q_orders.status", "refunded");

    expect(await build().exists()).toBe((await build().count()) > 0);
  });

  test("handles grouped queries through a derived table", async () => {
    const found = await QOrder.query().groupBy("user_id").having("user_id", ">", 0).exists();
    expect(found).toBe(true);
  });

  test("does not leave its bindings on the builder", async () => {
    const query = QUser.query().where("name", "Ada");
    expect(await query.exists()).toBe(true);
    // Re-running the same builder must still work and see the same filter.
    expect((await query.get()).map((row) => row.getAttribute("name"))).toEqual(["Ada"]);
  });

  test("doesntExist() mirrors exists()", async () => {
    expect(await QUser.query().where("name", "Nobody").doesntExist()).toBe(true);
  });
});

describe("UNION", () => {
  test("a per-arm LIMIT produces runnable SQL", async () => {
    const query = QUser.query().limit(1).union(QUser.query().where("name", "Linus"));
    const rows = await connection.query(query.toSql(), []);
    expect(rows.length).toBeGreaterThan(0);
  });

  test("a per-arm ORDER BY produces runnable SQL", async () => {
    const query = QUser.query().orderBy("name", "desc").limit(1)
      .unionAll(QUser.query().orderBy("name", "asc").limit(1));
    const rows = await connection.query(query.toSql(), []);
    expect(rows).toHaveLength(2);
  });

  test("a plain union stays unwrapped", () => {
    const sql = QUser.query().union(QUser.query().where("name", "Linus")).toRawSql();
    expect(sql).toBe('SELECT * FROM "q_users" UNION SELECT * FROM "q_users" WHERE "name" = \'Linus\'');
  });

  test("Postgres and MySQL scope an arm with parentheses", () => {
    for (const grammar of [new PostgresGrammar(), new MySqlGrammar()]) {
      expect(grammar.compileUnionArm("SELECT 1 LIMIT 1")).toBe("(SELECT 1 LIMIT 1)");
    }
  });

  test("SQLite scopes an arm with a derived table, since it rejects parentheses", () => {
    expect(new SQLiteGrammar().compileUnionArm("SELECT 1 LIMIT 1")).toBe("SELECT * FROM (SELECT 1 LIMIT 1)");
  });
});

describe("DELETE ... LIMIT", () => {
  test("MySQL and SQLite emit LIMIT", () => {
    for (const grammar of [new MySqlGrammar(), new SQLiteGrammar()]) {
      expect(grammar.compileDelete("t", "WHERE x = 1", undefined, 5)).toContain("LIMIT 5");
    }
  });

  test("Postgres refuses instead of emitting invalid SQL", () => {
    const grammar = new PostgresGrammar();
    expect(() => grammar.compileDelete("t", "WHERE x = 1", undefined, 5))
      .toThrow(/PostgreSQL does not support DELETE \.\.\. LIMIT/);
    // Unlimited deletes are untouched.
    expect(grammar.compileDelete("t", "WHERE x = 1")).toBe("DELETE FROM t WHERE x = 1");
  });
});
