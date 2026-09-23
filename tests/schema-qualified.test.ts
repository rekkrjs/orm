import { afterEach, describe, expect, test } from "./harness.js";
import { Connection, ConnectionManager, Schema } from "../src/index.js";

const postgresUrl = process.env.POSTGRES_TEST_URL;
const runIfPostgres = postgresUrl ? test.serial : test.skip;

describe.serial("Schema qualified-table operations", () => {
  afterEach(async () => {
    await ConnectionManager.closeAll();
  });

  runIfPostgres("all Schema functions target the connection schema, not public", async () => {
    const base = new Connection({ url: postgresUrl! });
    const grammar = base.getGrammar();
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const schema = `fluent_q_${suffix}`;

    Schema.setConnection(base);
    ConnectionManager.setDefault(base);

    try {
      await Schema.createSchema(schema);
      // Decoy tables in public with the SAME names. If any Schema op forgets
      // to qualify, it would hit these and the assertions below would fail.
      await base.run(`CREATE TABLE public.q_authors (id SERIAL PRIMARY KEY, name TEXT)`);
      await base.run(`CREATE TABLE public.q_books (id SERIAL PRIMARY KEY)`);

      const conn = base.withSchema(schema);
      Schema.setConnection(conn);
      ConnectionManager.setDefault(conn);

      const inSchema = (table: string) =>
        conn.query(
          `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
          [schema, table]
        );
      const publicColumns = (table: string) =>
        base.query(
          `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
          [table]
        );

      // create / createIfNotExists
      await Schema.create("q_authors", (t) => {
        t.increments("id");
        t.string("name");
        t.string("nickname").nullable();
      });
      await Schema.createIfNotExists("q_books", (t) => {
        t.increments("id");
        t.integer("author_id");
        t.string("title");
        t.index(["title"]);
      });
      expect((await inSchema("q_authors")).length).toBe(1);
      expect((await inSchema("q_books")).length).toBe(1);

      // hasTable / hasColumn — scoped to the connection schema
      expect(await Schema.hasTable("q_authors")).toBe(true);
      expect(await Schema.hasColumn("q_authors", "nickname")).toBe(true);
      expect(await Schema.hasColumn("q_authors", "not_a_col")).toBe(false);

      // table: add FK + index + unique (FK created without explicit name ->
      // postgres auto-names it q_books_author_id_fkey)
      await Schema.table("q_books", (t) => {
        t.foreign("author_id").references("id").on("q_authors").onDelete("cascade");
        t.uniqueIndex(["title"], "q_books_title_unique");
      });

      const fks = await Schema.getForeignKeys("q_books");
      expect(fks.some((fk) => fk.columns[0] === "author_id")).toBe(true);

      // dropForeign BY COLUMN NAME (the resolved-constraint-name path)
      await Schema.table("q_books", (t) => {
        t.dropForeign("author_id");
      });
      expect((await Schema.getForeignKeys("q_books")).length).toBe(0);

      // dropUnique + dropIndex (schema-qualified DROP INDEX)
      await Schema.table("q_books", (t) => {
        t.dropUnique("q_books_title_unique");
      });
      const idxNames = (await Schema.getIndexes("q_books")).map((i) => i.name);
      expect(idxNames).not.toContain("q_books_title_unique");

      // addColumn / renameColumn / change / dropColumn
      await Schema.table("q_authors", (t) => {
        t.integer("age").nullable();
      });
      expect(await Schema.hasColumn("q_authors", "age")).toBe(true);

      await Schema.table("q_authors", (t) => {
        t.renameColumn("age", "age_years");
      });
      expect(await Schema.hasColumn("q_authors", "age_years")).toBe(true);

      await Schema.table("q_authors", (t) => {
        t.dropColumn("nickname");
      });
      expect(await Schema.hasColumn("q_authors", "nickname")).toBe(false);

      // getColumns scoped to schema
      const cols = (await Schema.getColumns("q_authors")).map((c) => c.name);
      expect(cols).toContain("name");
      expect(cols).toContain("age_years");

      // The public decoys must be untouched the whole time
      const decoyAuthorCols = (await publicColumns("q_authors")).map(
        (r: any) => r.column_name
      );
      expect(decoyAuthorCols.sort()).toEqual(["id", "name"]);
      expect((await publicColumns("q_books")).map((r: any) => r.column_name)).toEqual([
        "id",
      ]);

      // rename
      await Schema.rename("q_authors", "q_writers");
      expect(await Schema.hasTable("q_writers")).toBe(true);
      expect(await Schema.hasTable("q_authors")).toBe(false);
      // public decoy still named q_authors
      expect((await inSchema("q_authors")).length).toBe(0);

      // drop / dropIfExists
      await Schema.drop("q_writers");
      await Schema.dropIfExists("q_books");
      await Schema.dropIfExists("q_books"); // idempotent
      expect(await Schema.hasTable("q_writers")).toBe(false);
      expect(await Schema.hasTable("q_books")).toBe(false);

      // public decoys survived everything
      const publicTables = await base.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('q_authors','q_books') ORDER BY table_name`
      );
      expect(publicTables.map((r: any) => r.table_name)).toEqual([
        "q_authors",
        "q_books",
      ]);
    } finally {
      Schema.setConnection(base);
      ConnectionManager.setDefault(base);
      await base.run(`DROP TABLE IF EXISTS public.q_books`);
      await base.run(`DROP TABLE IF EXISTS public.q_authors`);
      await base.run(`DROP SCHEMA IF EXISTS ${grammar.wrap(schema)} CASCADE`);
      await base.close();
    }
  });

  runIfPostgres("search_path tenancy: introspection resolves the tenant schema, not public", async () => {
    const base = new Connection({ url: postgresUrl! });
    const grammar = base.getGrammar();
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const schema = `fluent_sp_${suffix}`;

    Schema.setConnection(base);
    ConnectionManager.setDefault(base);

    try {
      await Schema.createSchema(schema);
      // Decoy in public — introspection must NOT see this as the tenant table.
      await base.run(`CREATE TABLE public.sp_orders (id SERIAL PRIMARY KEY)`);

      await base.withSearchPath(schema, async (conn) => {
        Schema.setConnection(conn);
        ConnectionManager.setDefault(conn);

        // getSchema() must now report the search_path target, so all
        // information_schema-based introspection targets the tenant schema.
        expect(conn.getSchema()).toBe(schema);

        await Schema.create("sp_orders", (t) => {
          t.increments("id");
          t.integer("customer_id");
          t.string("ref");
        });
        await Schema.table("sp_orders", (t) => {
          t.uniqueIndex(["ref"], "sp_orders_ref_unique");
        });

        // hasTable / hasColumn read the tenant schema (not public decoy,
        // which has only an id column).
        expect(await Schema.hasTable("sp_orders")).toBe(true);
        expect(await Schema.hasColumn("sp_orders", "customer_id")).toBe(true);

        // getIndexes sees the tenant index.
        const idx = (await Schema.getIndexes("sp_orders")).map((i) => i.name);
        expect(idx).toContain("sp_orders_ref_unique");

        // dropForeign-by-column path depends on getForeignKeys hitting the
        // right schema: add then drop a FK by column name.
        await Schema.create("sp_customers", (t) => {
          t.increments("id");
        });
        await Schema.table("sp_orders", (t) => {
          t.foreign("customer_id").references("id").on("sp_customers").onDelete("cascade");
        });
        expect((await Schema.getForeignKeys("sp_orders")).length).toBe(1);
        await Schema.table("sp_orders", (t) => {
          t.dropForeign("customer_id");
        });
        expect((await Schema.getForeignKeys("sp_orders")).length).toBe(0);
      });

      // public decoy untouched (still just id).
      const decoyCols = await base.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'sp_orders'`
      );
      expect(decoyCols.map((r: any) => r.column_name)).toEqual(["id"]);
    } finally {
      Schema.setConnection(base);
      ConnectionManager.setDefault(base);
      await base.run(`DROP TABLE IF EXISTS public.sp_orders`);
      await base.run(`DROP SCHEMA IF EXISTS ${grammar.wrap(schema)} CASCADE`);
      await base.close();
    }
  });
});
