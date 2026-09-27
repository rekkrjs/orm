import { afterAll, beforeAll, expect, test } from "./harness.js";
import { Builder, Connection, DB, type QueryEvent } from "../src/index.js";

const url = process.env.POSTGRES_TEST_URL;
const table = `where_in_array_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
const quotedTable = `"${table}"`;
const uuids = Array.from({ length: 100 }, (_, i) => `${(i + 1).toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`);
const special = ['comma, braces { }', 'quote " and slash \\', 'NULL', '', 'line\n café 🤖'];
let connection: Connection;

beforeAll(async () => {
  if (!url) return;
  connection = new Connection({ url, max: 2 });
  await connection.run(`CREATE TABLE ${quotedTable} (id integer PRIMARY KEY, token text, uuid_key uuid)`);
  for (const [id, token, uuid] of [
    [1, special[0], uuids[0]], [2, special[1], uuids[1]],
    [3, special[2], uuids[2]], [4, special[3], uuids[3]],
    [5, special[4], uuids[4]], [200, "outside", uuids[99]],
  ] as const) {
    await connection.run(`INSERT INTO ${quotedTable} (id, token, uuid_key) VALUES ($1, $2, $3)`, [id, token, uuid]);
  }
});

afterAll(async () => {
  if (!connection) return;
  await connection.run(`DROP TABLE ${quotedTable}`);
  await connection.close();
});

test.skipIf(!url)("PostgreSQL binds a large IN list as one inferred array and preserves values", async () => {
  const cases: Array<{ column: string; values: unknown[]; expectedIds: number[] }> = [
    { column: "id", values: Array.from({ length: 100 }, (_, i) => i + 1), expectedIds: [1, 2, 3, 4, 5] },
    { column: "token", values: [...special, ...Array.from({ length: 95 }, (_, i) => `absent-${i}`)], expectedIds: [1, 2, 3, 4, 5] },
    { column: "uuid_key", values: [...uuids.slice(0, 99), "00000065-0000-4000-8000-000000000000"], expectedIds: [1, 2, 3, 4, 5] },
  ];
  for (const { column, values, expectedIds } of cases) {
    const query = new Builder(connection, table).whereIn(column, values).orderBy("id");
    expect(query.toSql()).toBe(`SELECT * FROM ${quotedTable} WHERE "${column}" = ANY($1) ORDER BY "id" ASC`);
    expect(query.bindings).toEqual([values]);
    const events: QueryEvent[] = [];
    const stop = DB.listen((event) => { if (event.connection === connection && event.sql.startsWith("SELECT")) events.push(event); });
    try {
      expect((await query.get()).map((row) => row.id)).toEqual(expectedIds);
    } finally {
      stop();
    }
    expect(events).toHaveLength(1);
    expect(events[0]!.sql).toBe(query.toSql());
    expect(events[0]!.bindings).toHaveLength(1);
  }
});

test.skipIf(!url)("small IN lists and non-PostgreSQL connections retain their original SQL", async () => {
  const small = new Builder(connection, table).whereIn("id", [1, 2]);
  expect(small.toSql()).toBe(`SELECT * FROM ${quotedTable} WHERE "id" IN ($1, $2)`);
  expect(small.bindings).toEqual([1, 2]);
  expect((await small.get()).map((row) => row.id)).toEqual([1, 2]);

  const belowThreshold = new Builder(connection, table).whereIn("id", Array.from({ length: 99 }, (_, i) => i + 1));
  expect(belowThreshold.toSql()).toContain('"id" IN ($1, $2, $3');
  expect(belowThreshold.bindings).toHaveLength(99);

  const withNull = new Builder(connection, table).whereIn("id", [1, null, ...Array.from({ length: 98 }, (_, i) => i + 1000)]);
  expect(withNull.toSql()).toContain('"id" IN ($1, $2, $3');
  expect(withNull.bindings).toHaveLength(100);
  expect((await withNull.get()).map((row) => row.id)).toEqual([1]);

  const excluded = new Builder(connection, table).whereNotIn("id", Array.from({ length: 100 }, (_, i) => i + 1));
  expect(excluded.toSql()).toContain('"id" NOT IN ($1, $2, $3');
  expect(excluded.bindings).toHaveLength(100);
  expect((await excluded.get()).map((row) => row.id)).toEqual([200]);

  const sqlite = new Connection({ url: "sqlite://:memory:" });
  try {
    const query = new Builder(sqlite, "things").whereIn("id", Array.from({ length: 100 }, (_, i) => i));
    expect(query.toSql()).toContain('"id" IN (?, ?, ?');
    expect(query.bindings).toHaveLength(100);
  } finally {
    await sqlite.close();
  }

  if (process.env.MYSQL_TEST_URL) {
    const mysql = new Connection({ url: process.env.MYSQL_TEST_URL });
    try {
      const query = new Builder(mysql, "things").whereIn("id", Array.from({ length: 100 }, (_, i) => i));
      expect(query.toSql()).toContain("`id` IN (?, ?, ?");
      expect(query.bindings).toHaveLength(100);
    } finally {
      await mysql.close();
    }
  }
});
