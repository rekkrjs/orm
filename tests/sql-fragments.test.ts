import { expect, test } from "./harness.js";
import { Builder, Connection, sql } from "../src/index.js";

for (const driver of ["sqlite", "postgres", "mysql"] as const) {
  test(`${driver}: tagged SQL preserves question marks and composes bindings`, async () => {
    const connection = new Connection({ url: driver === "sqlite" ? "sqlite://:memory:" : `${driver}://unused:unused@localhost/unused` });
    try {
      const sub = new Builder(connection, "children").select("id").where("value", 2);
      const expression = sql`payload ? ${"key"} AND payload ?| ${["a"]} AND payload ?& ${["b"]}`;
      const query = new Builder(connection, "items")
        .selectRaw(sql`${1} AS result, 'two  spaces ?' AS literal`)
        .whereRaw(sql`${expression} AND id IN ${sub} -- ? preserved
AND flag = ${true}`)
        .whereExists(sql`SELECT ${3}`)
        .groupByRaw(sql`${4}`)
        .havingRaw(sql`count(*) > ${5}`)
        .orderByRaw(sql`${6} /* ? preserved */`);
      const text = query.toSql();
      expect(text).toContain("'two  spaces ?'");
      expect(text).toContain("-- ? preserved\nAND");
      expect(text).toContain("/* ? preserved */");
      expect(query.bindings).toEqual([1, "key", ["a"], ["b"], 2, true, 3, 4, 5, 6]);
      if (driver === "postgres") expect([...(text.match(/\$\d+/g) ?? [])]).toEqual(Array.from({ length: 10 }, (_, i) => `$${i + 1}`));
      const { statements } = await connection.pretend(() => query.get());
      // An array reaches PostgreSQL as an array literal and the others as JSON text.
      const [a, b] = driver === "postgres" ? ['{"a"}', '{"b"}'] : ['["a"]', '["b"]'];
      expect(statements[0]).toEqual({ sql: text, bindings: [1, "key", a, b, 2, true, 3, 4, 5, 6] });
    } finally { await connection.close(); }
  });
}

test.skipIf(!process.env.POSTGRES_TEST_URL)("PostgreSQL executes tagged JSON operators and literal question marks", async () => {
  const connection = new Connection({ url: process.env.POSTGRES_TEST_URL! });
  try {
    const query = new Builder(connection, "unused").fromSub("SELECT '{\"key\":1,\"other\":2}'::jsonb AS payload", "j")
      .selectRaw(sql`'two  spaces ?' AS literal`)
      .whereRaw(sql`payload ? ${"key"} AND payload ?| array[${"key"}] AND payload ?& array[${"other"}] -- ?
AND ${true}`);
    expect(Array.from(await query.get())).toEqual([{ literal: "two  spaces ?" }]);
    // A JavaScript array binds as a PostgreSQL array on both runtimes; bun:sql alone sent "key,other".
    const bound = new Builder(connection, "unused").fromSub("SELECT '{\"key\":1,\"other\":2}'::jsonb AS payload", "j")
      .selectRaw(sql`payload ?& ${["key", "other"]} AS all_keys, payload ?| ${["nope", 'a"b\\c']} AS any_missing`);
    expect(Array.from(await bound.get())).toEqual([{ all_keys: true, any_missing: false }]);
  } finally { await connection.close(); }
});
