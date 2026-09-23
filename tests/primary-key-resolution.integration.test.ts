import { afterEach, describe, expect, test } from "./harness.js";
import { Connection, ConnectionManager, Model, Schema } from "../src/index.js";
import { insertAndResolveKey } from "../src/model/PrimaryKeyResolution.js";

const postgresUrl = process.env.POSTGRES_TEST_URL;
const mysqlUrl = process.env.MYSQL_TEST_URL;
const runIfPostgres = postgresUrl ? test.serial : test.skip;
const runIfMySql = mysqlUrl ? test.serial : test.skip;

describe.serial("Database-assigned primary keys", () => {
  afterEach(async () => {
    await ConnectionManager.closeAll();
  });

  runIfPostgres("returns the key a Postgres column default assigned", async () => {
    const connection = new Connection({ url: postgresUrl! });
    const table = `pk_default_${Date.now()}`;

    await connection.run(
      `CREATE TABLE ${table} (id TEXT PRIMARY KEY DEFAULT 'db-key', name TEXT)`
    );
    try {
      const column = await Schema.getColumn(table, "id", connection);
      const key = await insertAndResolveKey(connection, table, { name: "row" }, "id", column);

      expect(key).toBe("db-key");
      const rows = await connection.query(`SELECT id FROM ${table}`);
      expect(rows[0]?.id).toBe("db-key");
    } finally {
      await connection.run(`DROP TABLE IF EXISTS ${table}`);
      await connection.close();
    }
  });

  runIfMySql("returns the key a MySQL literal default assigned", async () => {
    const connection = new Connection({ url: mysqlUrl! });
    await connection.run("SET time_zone = \'+00:00\'");
    const table = `pk_default_${Date.now()}`;

    await connection.run(
      `CREATE TABLE ${table} (id VARCHAR(64) PRIMARY KEY DEFAULT 'db-key', name TEXT)`
    );
    try {
      const column = await Schema.getColumn(table, "id", connection);
      const key = await insertAndResolveKey(connection, table, { name: "row" }, "id", column);

      expect(key).toBe("db-key");
      const rows = await connection.query(`SELECT id FROM ${table}`);
      expect(rows[0]?.id).toBe("db-key");
    } finally {
      await connection.run(`DROP TABLE IF EXISTS ${table}`);
      await connection.close();
    }
  });

  runIfMySql("resolves keys on schema-qualified tables", async () => {
    const url = mysqlUrl!;
    const database = new URL(url).pathname.replace(/^\//, "");
    const plain = new Connection({ url });
    await plain.run("SET time_zone = \'+00:00\'");
    const table = `pk_qualified_${Date.now()}`;

    await plain.run(`CREATE TABLE ${table} (id BIGINT AUTO_INCREMENT PRIMARY KEY, name TEXT)`);

    // A connection with a schema makes every model table qualified ("db.table"),
    // which introspection has to be able to take apart again.
    const scoped = new Connection({ url, schema: database });
    await scoped.run("SET time_zone = \'+00:00\'");
    Model.setConnection(scoped);
    Schema.setConnection(scoped);

    try {
      const column = await Schema.getColumn(`${database}.${table}`, "id", scoped);
      expect(column?.autoIncrement).toBe(true);

      class Qualified extends Model {
        static override table = table;
        static override fillable = ["name"];
        static override timestamps = false;
      }

      const row = await Qualified.create({ name: "qualified" } as any);
      expect(Number((row as any).id)).toBeGreaterThan(0);

      const stored = await plain.query(`SELECT id FROM ${table}`);
      expect(Number(stored[0]?.id)).toBe(Number((row as any).id));
    } finally {
      await plain.run(`DROP TABLE IF EXISTS ${table}`);
      await scoped.close();
      await plain.close();
    }
  });

  runIfMySql("still uses AUTO_INCREMENT when that is what assigns the key", async () => {
    const connection = new Connection({ url: mysqlUrl! });
    await connection.run("SET time_zone = \'+00:00\'");
    const table = `pk_auto_${Date.now()}`;

    await connection.run(
      `CREATE TABLE ${table} (id BIGINT AUTO_INCREMENT PRIMARY KEY, name TEXT)`
    );
    try {
      const column = await Schema.getColumn(table, "id", connection);
      const key = await insertAndResolveKey(connection, table, { name: "row" }, "id", column);

      expect(Number(key)).toBeGreaterThan(0);
      const rows = await connection.query(`SELECT id FROM ${table}`);
      expect(Number(rows[0]?.id)).toBe(Number(key));
    } finally {
      await connection.run(`DROP TABLE IF EXISTS ${table}`);
      await connection.close();
    }
  });

  runIfMySql("rejects an expression-assigned key before inserting an untrackable model", async () => {
    const connection = new Connection({ url: mysqlUrl! });
    await connection.run("SET time_zone = \'+00:00\'");
    const table = `pk_expression_${Date.now()}`;

    class ExpressionKey extends Model {
      static override timestamps = false;
      static override primaryKey = "id";
      static override keyType = "string" as const;
      static override incrementing = false;
      static override fillable = ["name"];
    }
    ExpressionKey.table = table;
    ExpressionKey.setConnection(connection);

    await connection.run(
      `CREATE TABLE ${table} (id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()), name TEXT)`
    );
    try {
      await expect(ExpressionKey.create({ name: "row" } as any)).rejects.toThrow(
        /MySQL cannot return a key assigned by an expression or trigger/
      );
      const rows = await connection.query(`SELECT id FROM ${table}`);
      expect(rows).toHaveLength(0);
    } finally {
      await connection.run(`DROP TABLE IF EXISTS ${table}`);
      await connection.close();
    }
  });
});
