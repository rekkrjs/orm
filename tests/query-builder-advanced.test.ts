import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { Connection, Schema, Builder, Model } from "../src/index.js";
import { PermissiveModel, setupTestDb } from "./helpers.js";

describe("Advanced Query Builder Features", () => {
  let db: Connection;

  class Folder extends PermissiveModel.define<{ id: number; parent_id: number | null; name: string; depth?: number }>("folders") {
    static override fastJson = true;

    items() {
      return this.hasMany(Folder, "parent_id");
    }
  }

  beforeAll(async () => {
    db = setupTestDb();
    await Schema.create("products", (table) => {
      table.increments("id");
      table.string("name");
      table.integer("price");
      table.string("category").nullable();
      table.json("tags").nullable();
      table.timestamps();
    });

    await Schema.create("categories", (table) => {
      table.increments("id");
      table.string("name");
    });

    await Schema.create("folders", (table) => {
      table.increments("id");
      table.integer("parent_id").nullable().index();
      table.string("name");
      table.timestamps();
    });

    const builder = new Builder(db, "products");
    await builder.insert([
      { name: "A", price: 10, category: "foo", tags: '["red","small"]' },
      { name: "B", price: 20, category: null, tags: '["blue","large"]' },
      { name: "C", price: 30, category: "bar", tags: '["red","large"]' },
      { name: "D", price: 40, category: "foo", tags: null },
    ]);

    const catBuilder = new Builder(db, "categories");
    await catBuilder.insert([
      { name: "foo" },
      { name: "bar" },
    ]);

    await Folder.insert([
      { id: 1, parent_id: null, name: "Root" },
      { id: 2, parent_id: 1, name: "Admissions" },
      { id: 3, parent_id: 1, name: "Billing" },
      { id: 4, parent_id: 2, name: "Forms" },
    ] as any);
  });

  afterAll(async () => {
    await Schema.dropIfExists("products");
    await Schema.dropIfExists("categories");
    await Schema.dropIfExists("folders");
  });

  describe("or* where variants", () => {
    test("orWhereNull", async () => {
      const results = await new Builder(db, "products")
        .where("category", "foo")
        .orWhereNull("category")
        .get();
      expect(results.length).toBe(3); // A, B, D
    });

    test("orWhereNotNull", async () => {
      const results = await new Builder(db, "products")
        .where("name", "B")
        .orWhereNotNull("category")
        .get();
      expect(results.length).toBe(4); // all have category except B, but B matches name
    });

    test("orWhereBetween", async () => {
      const results = await new Builder(db, "products")
        .where("name", "A")
        .orWhereBetween("price", [25, 35])
        .get();
      expect(results.map((r: any) => r.name).sort()).toEqual(["A", "C"]);
    });

    test("orWhereNotBetween", async () => {
      const results = await new Builder(db, "products")
        .where("name", "B")
        .orWhereNotBetween("price", [15, 35])
        .get();
      expect(results.map((r: any) => r.name).sort()).toEqual(["A", "B", "D"]);
    });

    test("orWhereIn", async () => {
      const results = await new Builder(db, "products")
        .where("name", "A")
        .orWhereIn("name", ["C", "D"])
        .get();
      expect(results.map((r: any) => r.name).sort()).toEqual(["A", "C", "D"]);
    });

    test("orWhereNotIn", async () => {
      const results = await new Builder(db, "products")
        .where("name", "A")
        .orWhereNotIn("name", ["A", "B"])
        .get();
      expect(results.map((r: any) => r.name).sort()).toEqual(["A", "C", "D"]);
    });

    test("orWhereExists", async () => {
      const results = await new Builder(db, "products")
        .where("name", "A")
        .orWhereExists("SELECT 1 FROM categories WHERE categories.name = products.category")
        .get();
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    test("orWhereNotExists", async () => {
      const results = await new Builder(db, "products")
        .where("name", "A")
        .orWhereNotExists("SELECT 1 FROM categories WHERE categories.name = 'nonexistent'")
        .get();
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    test("orWhereColumn", async () => {
      const sql = new Builder(db, "products")
        .where("name", "A")
        .orWhereColumn("name", "!=", "category")
        .toRawSql();
      expect(sql).toContain("OR");
      expect(sql).toContain("!=");
    });

    test("orWhereRaw", async () => {
      const sql = new Builder(db, "products")
        .where("name", "A")
        .orWhereRaw("price > 25")
        .toRawSql();
      expect(sql).toContain("OR price > 25");
    });
  });

  describe("compact where helpers", () => {
    test("whereNull and whereNotNull accept column arrays", () => {
      const sql = new Builder(db, "products")
        .whereNull(["category", "tags"])
        .orWhereNotNull(["category", "tags"])
        .toRawSql();

      expect(sql).toContain('WHERE "category" IS NULL AND "tags" IS NULL');
      expect(sql).toContain('OR "category" IS NOT NULL OR "tags" IS NOT NULL');
    });

    test("whereColumn accepts equality shorthand and comparison arrays", () => {
      const sql = new Builder(db, "products")
        .whereColumn("name", "category")
        .whereColumn([
          ["price", ">", "id"],
          ["id", "<=", "price"],
        ])
        .orWhereColumn([
          ["category", "=", "name"],
          ["id", "<", "price"],
        ])
        .toSql();

      expect(sql).toContain('WHERE "name" = "category"');
      expect(sql).toContain('AND ("price" > "id" AND "id" <= "price")');
      expect(sql).toContain('OR ("category" = "name" AND "id" < "price")');
    });

    test("whereBetweenColumns variants treat bounds as identifiers", () => {
      const sql = new Builder(db, "products")
        .whereBetweenColumns("price", ["id", "price"])
        .whereNotBetweenColumns("price", ["id", "price"])
        .orWhereBetweenColumns("price", ["id", "price"])
        .orWhereNotBetweenColumns("price", ["id", "price"])
        .toSql();

      expect(sql).toContain('WHERE "price" BETWEEN "id" AND "price"');
      expect(sql).toContain('AND "price" NOT BETWEEN "id" AND "price"');
      expect(sql).toContain('OR "price" BETWEEN "id" AND "price"');
      expect(sql).toContain('OR "price" NOT BETWEEN "id" AND "price"');
    });

    test("whereNone and the orWhere group variants preserve grouping", () => {
      const sql = new Builder(db, "products")
        .whereNone(["name", "category"], "=", "blocked")
        .orWhereAny(["name", "category"], "=", "A")
        .orWhereAll(["name", "category"], "!=", "")
        .orWhereNone(["name", "category"], "=", "hidden")
        .toRawSql();

      expect(sql).toContain('WHERE NOT ("name" = \'blocked\' OR "category" = \'blocked\')');
      expect(sql).toContain('OR ("name" = \'A\' OR "category" = \'A\')');
      expect(sql).toContain('OR ("name" != \'\' AND "category" != \'\')');
      expect(sql).toContain('OR NOT ("name" = \'hidden\' OR "category" = \'hidden\')');
    });

    test("empty multi-column groups add no invalid clause", () => {
      const sql = new Builder(db, "products")
        .whereAll([], "=", "A")
        .whereAny([], "=", "A")
        .whereNone([], "=", "A")
        .orWhereAll([], "=", "A")
        .orWhereAny([], "=", "A")
        .orWhereNone([], "=", "A")
        .whereColumn([])
        .orWhereColumn([])
        .toSql();

      expect(sql).toBe('SELECT * FROM "products"');
    });

    test("relative date helpers choose timestamp or date comparisons", () => {
      const timestampMethods = [
        ["wherePast", "<"],
        ["whereNowOrPast", "<="],
        ["whereFuture", ">"],
        ["whereNowOrFuture", ">="],
      ] as const;
      for (const [method, operator] of timestampMethods) {
        const query = new Builder(db, "products");
        (query[method] as any)(["created_at", "updated_at"]);
        expect(query.wheres.every((where) => where.type === "raw")).toBe(true);
        expect(query.wheres.every((where) => where.column.includes(` ${operator} julianday(?)`))).toBe(true);
        expect(query.wheres.every((where) => where.bindings?.[0] instanceof Date)).toBe(true);
      }

      const dateMethods = [
        ["whereToday", "="],
        ["whereBeforeToday", "<"],
        ["whereAfterToday", ">"],
        ["whereTodayOrBefore", "<="],
        ["whereTodayOrAfter", ">="],
      ] as const;
      for (const [method, operator] of dateMethods) {
        const query = new Builder(db, "products");
        (query[method] as any)("created_at");
        expect(query.wheres[0].dateType).toBe("date");
        expect(query.wheres[0].operator).toBe(operator);
        expect(query.wheres[0].value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });
  });

  describe("Having variants", () => {
    test("havingRaw", async () => {
      const sql = new Builder(db, "products")
        .select("category")
        .groupBy("category")
        .havingRaw("COUNT(*) > 1")
        .toSql();
      expect(sql).toContain("HAVING COUNT(*) > 1");
    });

    test("orHaving", async () => {
      const sql = new Builder(db, "products")
        .select("category")
        .groupBy("category")
        .having("price", ">", 5)
        .orHaving("price", "<", 50)
        .toSql();
      expect(sql).toContain("HAVING");
      expect(sql).toContain("OR");
    });

    test("orHavingRaw", async () => {
      const sql = new Builder(db, "products")
        .select("category")
        .groupBy("category")
        .havingRaw("COUNT(*) > 1")
        .orHavingRaw("SUM(price) > 10")
        .toSql();
      expect(sql).toContain("OR SUM(price) > 10");
    });

    test("havingBetween variants compile value bounds", async () => {
      const results = await new Builder(db, "products")
        .select("category")
        .selectRaw("AVG(price) AS average_price")
        .groupBy("category")
        .havingBetween("average_price", [15, 35])
        .get();
      expect(results).toHaveLength(3);

      const sql = new Builder(db, "products")
        .groupBy("category")
        .havingBetween("price", [10, 40])
        .havingNotBetween("price", [20, 30])
        .orHavingBetween("price", [10, 20])
        .orHavingNotBetween("price", [30, 40])
        .toRawSql();
      expect(sql).toContain('HAVING "price" BETWEEN 10 AND 40');
      expect(sql).toContain('AND "price" NOT BETWEEN 20 AND 30');
      expect(sql).toContain('OR "price" BETWEEN 10 AND 20');
      expect(sql).toContain('OR "price" NOT BETWEEN 30 AND 40');
    });
  });

  describe("Order helpers", () => {
    test("orderByDesc", async () => {
      const results = await new Builder(db, "products").orderByDesc("price").get();
      expect(results[0].name).toBe("D");
    });

    test("reorder clears orders", async () => {
      const sql = new Builder(db, "products").orderBy("name").reorder().toSql();
      expect(sql).not.toContain("ORDER BY");
    });

    test("reorder with new column", async () => {
      const sql = new Builder(db, "products").orderBy("name").reorder("price", "desc").toSql();
      expect(sql).toContain('ORDER BY "price" DESC');
      expect(sql).not.toContain('"name"');
    });

    test("reorderDesc replaces existing orders with a descending order", () => {
      const sql = new Builder(db, "products").orderBy("name").reorderDesc("price").toSql();
      expect(sql).toContain('ORDER BY "price" DESC');
      expect(sql).not.toContain('"name"');
    });
  });

  describe("Cross Join", () => {
    test("crossJoin generates CROSS JOIN", () => {
      const sql = new Builder(db, "products").crossJoin("categories").toSql();
      expect(sql).toContain("CROSS JOIN");
    });
  });

  describe("Union", () => {
    test("union combines queries", () => {
      const a = new Builder(db, "products").where("name", "A");
      const b = new Builder(db, "products").where("name", "B");
      const sql = a.union(b).toSql();
      expect(sql).toContain("UNION");
    });

    test("unionAll", () => {
      const a = new Builder(db, "products").where("name", "A");
      const b = new Builder(db, "products").where("name", "B");
      const sql = a.unionAll(b).toSql();
      expect(sql).toContain("UNION ALL");
    });
  });

  describe("Insert Or Ignore", () => {
    test("insertOrIgnore does not throw on duplicate", async () => {
      await new Builder(db, "products").insertOrIgnore({ name: "Z", price: 99 });
      const found = await new Builder(db, "products").where("name", "Z").first();
      expect(found).not.toBeNull();
      // insert again should be ignored
      await expect(new Builder(db, "products").insertOrIgnore({ name: "Z", price: 99 })).resolves.toBeDefined();
    });
  });

  describe("Upsert", () => {
    beforeAll(async () => {
      await Schema.create("upsert_test", (table) => {
        table.increments("id");
        table.string("slug").unique();
        table.integer("counter");
      });
    });

    afterAll(async () => {
      await Schema.dropIfExists("upsert_test");
    });

    test("upsert inserts new record", async () => {
      await new Builder(db, "upsert_test").upsert({ slug: "x", counter: 1 }, "slug");
      const found = await new Builder(db, "upsert_test").where("slug", "x").first();
      expect(found).not.toBeNull();
      expect((found as any).counter).toBe(1);
    });

    test("upsert updates existing record", async () => {
      await new Builder(db, "upsert_test").upsert({ slug: "x", counter: 5 }, "slug");
      const found = await new Builder(db, "upsert_test").where("slug", "x").first();
      expect((found as any).counter).toBe(5);
    });
  });

  describe("Delete with limit", () => {
    test("delete with limit generates LIMIT in SQL", async () => {
      // Use a fresh disposable table so we don't affect shared data
      await Schema.create("delete_limits", (table) => {
        table.increments("id");
        table.string("name");
      });
      await new Builder(db, "delete_limits").insert([{ name: "a" }, { name: "b" }]);
      const sql = new Builder(db, "delete_limits").where("name", "a").limit(1).toSql();
      expect(sql).toContain("LIMIT 1");
      await Schema.dropIfExists("delete_limits");
    });
  });

  describe("Lock modifiers", () => {
    test("skipLocked appends SKIP LOCKED on mysql/postgres SQL", () => {
      // Manually set lockMode to simulate non-sqlite driver
      const builder = new Builder(db, "products");
      builder.lockMode = "FOR UPDATE";
      builder.skipLocked();
      expect(builder.toSql()).toContain("SKIP LOCKED");
    });

    test("noWait appends NOWAIT on mysql/postgres SQL", () => {
      const builder = new Builder(db, "products");
      builder.lockMode = "FOR UPDATE";
      builder.noWait();
      expect(builder.toSql()).toContain("NOWAIT");
    });
  });

  describe("JSON where", () => {
    test("whereJsonContains compiles SQL", () => {
      const sql = new Builder(db, "products").whereJsonContains("tags", "red").toSql();
      expect(sql.length).toBeGreaterThan(0);
    });

    test("whereJsonLength compiles SQL", () => {
      const sql = new Builder(db, "products").whereJsonLength("tags", 2).toSql();
      expect(sql.length).toBeGreaterThan(0);
    });

    test("JSON contains and length variants preserve OR and NOT", async () => {
      const sql = new Builder(db, "products")
        .where("id", 1)
        .whereJsonDoesntContain("tags", "blocked")
        .orWhereJsonContains("tags", "red")
        .orWhereJsonDoesntContain("tags", "blue")
        .orWhereJsonLength("tags", ">", 1)
        .toRawSql();

      expect(sql).toContain("NOT (");
      expect(sql).toContain("> 1");
      expect(sql.match(/ OR /g)).toHaveLength(3);

      const withoutRed = await new Builder(db, "products")
        .whereJsonDoesntContain("tags", "red")
        .orderBy("name")
        .pluck("name");
      expect(withoutRed).toEqual(["B"]); // null JSON is excluded on every driver

      const redOrB = await new Builder(db, "products")
        .where("name", "B")
        .orWhereJsonContains("tags", "red")
        .orderBy("name")
        .pluck("name");
      expect(redOrB).toEqual(["A", "B", "C"]);
    });

    test("JSON length requires a finite comparison value", () => {
      const builder = new Builder(db, "products");
      expect(() => (builder as any).whereJsonLength("tags")).toThrow("JSON length must be a finite number.");
      expect(() => (builder as any).orWhereJsonLength("tags")).toThrow("JSON length must be a finite number.");
      expect(() => (builder as any).whereJsonLength("tags", Number.NaN)).toThrow("JSON length must be a finite number.");
    });
  });

  describe("Like / Regexp", () => {
    test("whereLike compiles LIKE SQL", () => {
      const sql = new Builder(db, "products").whereLike("name", "%A%").toSql();
      expect(sql).toContain("LIKE");
    });

    test("whereLike is case-insensitive by default", async () => {
      // SQLite and MySQL match case-insensitively with plain LIKE; PostgreSQL
      // needs ILIKE. This asserts the SQLite shape plus the behaviour.
      const sql = new Builder(db, "products").whereLike("name", "%a%").toSql();
      expect(sql).toContain("LIKE");
      expect(sql).not.toContain("LOWER(");

      const lower = await new Builder(db, "products").whereLike("name", "%a%").get();
      const upper = await new Builder(db, "products").whereLike("name", "%A%").get();
      expect(lower.length).toBeGreaterThan(0);
      expect(upper.length).toBe(lower.length);
    });

    test("caseSensitive uses the dialect's exact operator", () => {
      // GLOB on SQLite, which has no case-sensitive LIKE.
      const sql = new Builder(db, "products").whereLike("name", "%a%", { caseSensitive: true }).toRawSql();
      expect(sql).toContain("GLOB");
      expect(sql).toContain("*a*");
    });

    test("caseSensitive escapes GLOB metacharacters instead of translating them", () => {
      // A literal * ? or [ must not become a GLOB wildcard, while % and _ must.
      const sql = new Builder(db, "products").whereLike("name", "a*b_c", { caseSensitive: true }).toRawSql();
      expect(sql).toContain("a[*]b?c");
    });

    test("the or* variants carry the connector, so options are the third argument", () => {
      // The and/or connector is not part of the public signature: orWhereLike()
      // expresses it, and the third argument is always the options object.
      const sql = new Builder(db, "products")
        .where("id", 1)
        .orWhereLike("name", "a%")
        .orWhereNotLike("name", "b%", { caseSensitive: true })
        .toSql();

      expect(sql).toContain("OR \"name\" LIKE");
      expect(sql).toContain("OR \"name\" NOT GLOB");
    });

    test("ILIKE stays accepted as a raw operator", () => {
      // PostgreSQL-only, like <=> is MySQL-only and GLOB is SQLite-only. The
      // operator list is an injection allowlist, not a portability guarantee,
      // so this must keep compiling for the driver that accepts it.
      const sql = new Builder(db, "products").where("name", "ILIKE", "%a%").toSql();
      expect(sql).toContain("ILIKE");
    });

    test("whereNotLike compiles NOT LIKE SQL", () => {
      const sql = new Builder(db, "products").whereNotLike("name", "%A%").toSql();
      expect(sql).toContain("NOT LIKE");
    });

    test("orWhereLike variants compile OR LIKE clauses", () => {
      const sql = new Builder(db, "products")
        .where("id", 1)
        .orWhereLike("name", "A%")
        .orWhereNotLike("name", "B%")
        .toSql();

      expect(sql).toContain("OR \"name\" LIKE");
      expect(sql).toContain("OR \"name\" NOT LIKE");
    });

    test("whereRegexp compiles REGEXP SQL", () => {
      const sql = new Builder(db, "products").whereRegexp("name", "^A").toSql();
      expect(sql).toContain("REGEXP");
    });
  });

  describe("Full Text", () => {
    test("whereFullText compiles SQL", () => {
      const sql = new Builder(db, "products").whereFullText("name", "foo").toSql();
      expect(sql.length).toBeGreaterThan(0);
    });

    test("orWhereFullText compiles an OR clause", () => {
      const sql = new Builder(db, "products")
        .where("id", 1)
        .orWhereFullText("name", "foo")
        .toSql();
      expect(sql).toContain(" OR ");
    });

    test("SQLite groups multi-column full-text fallbacks as one predicate", async () => {
      const query = new Builder(db, "products")
        .where("price", ">", 100)
        .whereFullText(["name", "category"], "foo");

      expect(query.toSql()).toContain("AND (");
      expect(await query.get()).toHaveLength(0);
    });

    test("full-text filters reject an empty column list", () => {
      expect(() => new Builder(db, "products").whereFullText([], "foo")).toThrow(
        "whereFullText() requires at least one column.",
      );
      expect(() => new Builder(db, "products").orWhereFullText([], "foo")).toThrow(
        "whereFullText() requires at least one column.",
      );
    });
  });

  describe("whereAll / whereAny", () => {
    test("whereAll groups with AND", () => {
      const sql = new Builder(db, "products").whereAll(["name", "category"], "=", "foo").toSql();
      expect(sql).toContain("(");
      expect(sql).toContain("AND");
    });

    test("whereAny groups with OR", () => {
      const sql = new Builder(db, "products").whereAny(["name", "category"], "=", "foo").toSql();
      expect(sql).toContain("(");
      expect(sql).toContain("OR");
    });
  });

  describe("sole", () => {
    test("sole returns single record", async () => {
      const result = await new Builder(db, "products").where("name", "A").sole();
      expect((result as any).name).toBe("A");
    });

    test("sole throws when no records", async () => {
      await expect(new Builder(db, "products").where("name", "ZZZ").sole()).rejects.toThrow();
    });

    test("sole throws when multiple records", async () => {
      await expect(new Builder(db, "products").where("category", "foo").sole()).rejects.toThrow("Multiple records found");
    });
  });

  describe("value", () => {
    test("value returns single column", async () => {
      const name = await new Builder(db, "products").where("name", "A").value("name");
      expect(name).toBe("A");
    });

    test("value returns null when not found", async () => {
      const name = await new Builder(db, "products").where("name", "ZZZ").value("name");
      expect(name).toBeNull();
    });
  });

  describe("selectRaw", () => {
    test("selectRaw adds raw expression", () => {
      const sql = new Builder(db, "products").select("name").selectRaw("price * 2 as doubled").toSql();
      expect(sql).toContain("price * 2 as doubled");
    });
  });

  describe("fromSub", () => {
    test("fromSub wraps subquery", () => {
      const sub = new Builder(db, "products").where("price", ">", 10);
      const sql = new Builder(db, "products").fromSub(sub, "expensive").toSql();
      expect(sql).toContain("(SELECT");
      expect(sql).toContain("AS");
    });
  });

  describe("withRecursive", () => {
    test("compiles a recursive CTE", () => {
      const sql = Folder.query()
        .withRecursive(
          "folder_tree",
          Folder.query().select("folders.*").selectRaw("0 as depth").where("id", 1),
          Folder.query()
            .from("folders as child")
            .select("child.*")
            .selectRaw("folder_tree.depth + 1 as depth")
            .join("folder_tree", "child.parent_id", "=", "folder_tree.id"),
        )
        .from("folder_tree")
        .toSql();

      expect(sql).toStartWith('WITH RECURSIVE "folder_tree" AS');
      expect(sql).toContain("UNION ALL");
      expect(sql).toContain('FROM "folder_tree"');
    });

    test("hydrates recursive CTE results as model instances", async () => {
      const folders = await Folder
        .withRecursive(
          "folder_tree",
          Folder.query().select("folders.*").selectRaw("0 as depth").where("id", 1),
          Folder.query()
            .from("folders as child")
            .select("child.*")
            .selectRaw("folder_tree.depth + 1 as depth")
            .join("folder_tree", "child.parent_id", "=", "folder_tree.id"),
        )
        .from("folder_tree")
        .orderBy("depth")
        .orderBy("name")
        .get();

      expect(folders.map((folder) => folder.getAttribute("name"))).toEqual([
        "Root",
        "Admissions",
        "Billing",
        "Forms",
      ]);
      expect(folders.map((folder) => folder.getAttribute("depth"))).toEqual([0, 1, 1, 2]);
      expect(folders[0]).toBeInstanceOf(Folder);
    });

    test("recursive convenience starts at null parents by default", async () => {
      const folders = await Folder
        .recursive("parent_id")
        .orderBy("depth")
        .orderBy("name")
        .get();

      expect(folders.map((folder) => folder.getAttribute("name"))).toEqual([
        "Root",
        "Admissions",
        "Billing",
        "Forms",
      ]);
      expect(folders.map((folder) => folder.getAttribute("depth"))).toEqual([0, 1, 1, 2]);
      expect(folders[0]).toBeInstanceOf(Folder);
    });

    test("recursive convenience can start at one model id", async () => {
      const folders = await Folder
        .recursive("parent_id", 1)
        .orderBy("depth")
        .orderBy("name")
        .get();

      expect(folders.map((folder) => folder.getAttribute("name"))).toEqual([
        "Root",
        "Admissions",
        "Billing",
        "Forms",
      ]);
      expect(folders.map((folder) => folder.getAttribute("depth"))).toEqual([0, 1, 1, 2]);
      expect(folders[0]).toBeInstanceOf(Folder);
    });

    test("recursive convenience can start at multiple model ids", async () => {
      const folders = await Folder
        .recursive("parent_id", [2, 3])
        .orderBy("depth")
        .orderBy("name")
        .get();

      expect(folders.map((folder) => folder.getAttribute("name"))).toEqual([
        "Admissions",
        "Billing",
        "Forms",
      ]);
      expect(folders.map((folder) => folder.getAttribute("depth"))).toEqual([0, 0, 1]);
      expect(folders[0]).toBeInstanceOf(Folder);
    });

    test("descendants helper infers the tree relation and can exclude the root", async () => {
      const folders = await Folder
        .descendants(1)
        .excludeRoot()
        .orderByDepth()
        .orderBy("name")
        .get();

      expect(folders.map((folder) => folder.getAttribute("name"))).toEqual([
        "Admissions",
        "Billing",
        "Forms",
      ]);
      expect(folders.map((folder) => folder.getAttribute("depth"))).toEqual([1, 1, 2]);
    });

    test("recursive convenience supports a max depth", async () => {
      const folders = await Folder
        .recursive("parent_id")
        .maxDepth(1)
        .orderBy("depth")
        .orderBy("name")
        .get();

      expect(folders.map((folder) => folder.getAttribute("name"))).toEqual([
        "Root",
        "Admissions",
        "Billing",
      ]);
      expect(folders.map((folder) => folder.getAttribute("depth"))).toEqual([0, 1, 1]);
    });

    test("ancestors helper returns the chain back to the root", async () => {
      const folders = await Folder
        .ancestors(4)
        .orderByDepth("desc")
        .get();

      expect(folders.map((folder) => folder.getAttribute("name"))).toEqual([
        "Root",
        "Admissions",
        "Forms",
      ]);
      expect(folders.map((folder) => folder.getAttribute("depth"))).toEqual([2, 1, 0]);
    });

    test("recursive helpers can add path and tree metadata", async () => {
      const folders = await Folder
        .descendants(1)
        .path("name")
        .hasChildren()
        .leaf()
        .orderByDepth()
        .orderBy("name")
        .get();

      expect(folders.map((folder) => folder.getAttribute("path"))).toEqual([
        "Root",
        "Root > Admissions",
        "Root > Billing",
        "Root > Admissions > Forms",
      ]);
      expect(folders.map((folder) => folder.getAttribute("has_children"))).toEqual([true, true, false, false]);
      expect(folders.map((folder) => folder.getAttribute("leaf"))).toEqual([false, false, true, true]);
    });

    test("direct JSON preserves flat recursive decorations", async () => {
      const query = () => Folder
        .descendants(1)
        .path("name")
        .hasChildren()
        .leaf()
        .orderByDepth()
        .orderBy("name");

      const direct = await query().json();
      const hydrated = (await query().get()).toJSON();

      // Compared as the JSON both paths actually emit. The fast path hands back
      // raw driver values while the hydrated path decodes date casts to Date,
      // a divergence that predates timestamp columns being cast — any model
      // with a datetime cast has always had it — and that disappears the moment
      // either side is serialized.
      const wire = (value: unknown) => JSON.parse(JSON.stringify(value));
      expect(wire(direct)).toEqual(wire(hydrated));
      expect(direct.map((folder) => (folder as any).path)).toEqual([
        "Root",
        "Root > Admissions",
        "Root > Billing",
        "Root > Admissions > Forms",
      ]);
      expect(direct.map((folder) => (folder as any).has_children)).toEqual([true, true, false, false]);
      expect(direct.map((folder) => (folder as any).leaf)).toEqual([false, false, true, true]);
    });

    test("getTree materializes recursive results into the matching hasMany relation", async () => {
      const tree = await Folder
        .recursive("parent_id")
        .orderBy("depth")
        .orderBy("name")
        .getTree();

      expect(tree).toHaveLength(1);
      expect(tree[0]).toBeInstanceOf(Folder);
      expect(tree[0].getAttribute("name")).toBe("Root");

      const rootChildren = tree[0].getRelation("items");
      expect(rootChildren.map((folder: Folder) => folder.getAttribute("name"))).toEqual([
        "Admissions",
        "Billing",
      ]);

      const admissionsChildren = rootChildren[0].getRelation("items");
      expect(admissionsChildren.map((folder: Folder) => folder.getAttribute("name"))).toEqual(["Forms"]);

      expect(tree.json()[0]).toMatchObject({
        name: "Root",
        items: [
          {
            name: "Admissions",
            items: [{ name: "Forms", items: [] }],
          },
          {
            name: "Billing",
            items: [],
          },
        ],
      });
    });

    test("getTree returns one model or null for one starting point", async () => {
      const root = await Folder
        .recursive("parent_id", 1)
        .orderBy("depth")
        .orderBy("name")
        .getTree();

      expect(root).toBeInstanceOf(Folder);
      expect(root?.getAttribute("name")).toBe("Root");
      expect(root?.getRelation("items").map((folder: Folder) => folder.getAttribute("name"))).toEqual([
        "Admissions",
        "Billing",
      ]);

      const missing = await Folder.recursive("parent_id", 999).getTree();
      expect(missing).toBeNull();
    });

    test("getTree returns a collection for multiple starting points", async () => {
      const tree = await Folder
        .recursive("parent_id", [2, 3])
        .orderBy("depth")
        .orderBy("name")
        .getTree();

      expect(tree.map((folder) => folder.getAttribute("name"))).toEqual([
        "Admissions",
        "Billing",
      ]);
      expect(tree[0].getRelation("items").map((folder: Folder) => folder.getAttribute("name"))).toEqual(["Forms"]);
    });

    test("getTree supports a max depth", async () => {
      const tree = await Folder
        .recursive("parent_id")
        .maxDepth(1)
        .orderBy("depth")
        .orderBy("name")
        .getTree();

      expect(tree).toHaveLength(1);
      expect(tree[0].getRelation("items").map((folder: Folder) => folder.getAttribute("name"))).toEqual([
        "Admissions",
        "Billing",
      ]);
      expect(tree[0].getRelation("items")[0].getRelation("items")).toHaveLength(0);
    });

    test("getTree can exclude the root and promote its children", async () => {
      const tree = await Folder
        .descendants(1)
        .excludeRoot()
        .orderByDepth()
        .orderBy("name")
        .getTree();

      expect(tree).toHaveLength(2);
      expect(tree.map((folder) => folder.getAttribute("name"))).toEqual([
        "Admissions",
        "Billing",
      ]);
      expect(tree[0].getRelation("items").map((folder: Folder) => folder.getAttribute("name"))).toEqual(["Forms"]);
    });

    test("getTree requires recursive to be called first", async () => {
      await expect(Folder.query().getTree()).rejects.toThrow("getTree() requires recursive");
    });
  });

  describe("updateFrom", () => {
    test("updateFrom populates updateJoins", () => {
      const builder = new Builder(db, "products")
        .updateFrom("categories", "products.category", "=", "categories.name");
      expect(builder.updateJoins.length).toBe(1);
      expect(builder.updateJoins[0]).toContain("INNER JOIN");
    });
  });

  describe("dump / dd", () => {
    test("dump returns builder", () => {
      const builder = new Builder(db, "products").where("name", "A");
      expect(builder.dump()).toBe(builder);
    });

    test("dd throws", () => {
      expect(() => new Builder(db, "products").dd()).toThrow("dd() called");
    });
  });
});
