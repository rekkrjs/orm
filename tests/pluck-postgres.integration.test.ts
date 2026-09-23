import { afterEach, describe, expect, test } from "./harness.js";
import { Builder, Connection, ConnectionManager } from "../src/index.js";

const postgresUrl = process.env.POSTGRES_TEST_URL;
const runIfPostgres = postgresUrl ? test.serial : test.skip;

describe.serial("pluck against PostgreSQL identifier folding", () => {
  afterEach(async () => {
    await ConnectionManager.closeAll();
  });

  runIfPostgres("reads aliases PostgreSQL folded to lower case", async () => {
    const connection = new Connection({ url: postgresUrl! });
    const table = `pluck_fold_${Date.now()}`;

    await connection.run(`CREATE TABLE ${table} (id INT PRIMARY KEY, name TEXT)`);
    try {
      await connection.run(`INSERT INTO ${table} (id, name) VALUES (1, 'Ada'), (2, 'Grace')`);

      // Unquoted "AS Label" is stored and returned by the server as "label".
      expect(await new Builder(connection, table).pluck("name as Label")).toEqual(["Ada", "Grace"]);
      expect(await new Builder(connection, table).pluck("name as Label", "id as Key")).toEqual({
        1: "Ada",
        2: "Grace",
      });

      // A quoted alias keeps its casing and must keep working too.
      expect(await new Builder(connection, table).pluck('name as "Label"')).toEqual(["Ada", "Grace"]);
    } finally {
      await connection.run(`DROP TABLE IF EXISTS ${table}`);
      await connection.close();
    }
  });
});
