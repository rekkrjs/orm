import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "fs/promises";
import { join } from "path";
import { pathToFileURL } from "url";
import { Connection, ConnectionManager, Migrator, Model, Schema, TenantContext } from "../src/index.js";

class PgTenantUser extends Model {
  static table = "tenant_users";
  static timestamps = false;
}

class PgRlsItem extends Model {
  static table = "rls_items";
  static timestamps = false;
}

const postgresUrl = process.env.POSTGRES_TEST_URL;
const runIfPostgres = postgresUrl ? test.serial : test.skip;

describe.serial("PostgreSQL tenant integration", () => {
  afterEach(async () => {
    await ConnectionManager.closeAll();
  });

  runIfPostgres("isolates schema tenants with search_path", async () => {
    const connection = new Connection({ url: postgresUrl! });
    Schema.setConnection(connection);
    ConnectionManager.setDefault(connection);

    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const schemaA = `fluent_tenant_${suffix}_a`;
    const schemaB = `fluent_tenant_${suffix}_b`;
    const grammar = connection.getGrammar();

    try {
      await Schema.createSchema(schemaA);
      await Schema.createSchema(schemaB);
      for (const [schema, name] of [[schemaA, "Acme User"], [schemaB, "Beta User"]] as const) {
        await connection.run(`CREATE TABLE ${grammar.wrap(`${schema}.tenant_users`)} (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`);
        await connection.run(`INSERT INTO ${grammar.wrap(`${schema}.tenant_users`)} (id, name) VALUES (1, $1)`, [name]);
      }

      ConnectionManager.setTenantResolver((tenantId) => ({
        strategy: "schema",
        name: `pg-search-path:${tenantId}`,
        schema: tenantId === "acme" ? schemaA : schemaB,
        mode: "search_path",
      }));

      const acme = await TenantContext.run("acme", () => PgTenantUser.find(1));
      const beta = await TenantContext.run("beta", () => PgTenantUser.find(1));

      expect(acme?.getAttribute("name")).toBe("Acme User");
      expect(beta?.getAttribute("name")).toBe("Beta User");
    } finally {
      await connection.run(`DROP SCHEMA IF EXISTS ${grammar.wrap(schemaA)} CASCADE`);
      await connection.run(`DROP SCHEMA IF EXISTS ${grammar.wrap(schemaB)} CASCADE`);
      await connection.close();
    }
  });

  runIfPostgres("isolates RLS tenants with SET LOCAL tenant setting", async () => {
    const connection = new Connection({ url: postgresUrl! });
    Schema.setConnection(connection);
    ConnectionManager.setDefault(connection);

    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const table = `fluent_rls_items_${suffix}`;
    PgRlsItem.table = table;
    const grammar = connection.getGrammar();
    let testRole: string | undefined;
    let testSchema: string | undefined;

    try {
      await connection.run(`CREATE TABLE ${grammar.wrap(table)} (id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL)`);
      await connection.run(`INSERT INTO ${grammar.wrap(table)} (id, tenant_id, name) VALUES (1, 'acme', 'Acme Item'), (2, 'beta', 'Beta Item')`);
      await connection.run(`ALTER TABLE ${grammar.wrap(table)} ENABLE ROW LEVEL SECURITY`);
      await connection.run(`ALTER TABLE ${grammar.wrap(table)} FORCE ROW LEVEL SECURITY`);
      await connection.run(
        `CREATE POLICY ${grammar.wrap(`${table}_tenant_policy`)} ON ${grammar.wrap(table)} USING (tenant_id = current_setting('app.tenant_id', true))`
      );
      const [session] = await connection.query(
        "SELECT current_schema() AS schema, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user"
      );
      if (session.rolsuper || session.rolbypassrls) {
        testRole = `fluent_rls_reader_${suffix}`;
        testSchema = session.schema;
        await connection.run(`CREATE ROLE ${grammar.wrap(testRole)} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
        await connection.run(`GRANT USAGE ON SCHEMA ${grammar.wrap(testSchema!)} TO ${grammar.wrap(testRole)}`);
        await connection.run(`GRANT SELECT ON ${grammar.wrap(`${testSchema}.${table}`)} TO ${grammar.wrap(testRole)}`);
      }
      ConnectionManager.setTenantResolver((tenantId) => ({
        strategy: "rls",
        name: "pg-rls:main",
        tenantId,
        setting: "app.tenant_id",
        role: testRole,
      }));

      const acme = await TenantContext.run("acme", () => PgRlsItem.all());
      const beta = await TenantContext.run("beta", () => PgRlsItem.all());

      expect(acme.map((row) => row.getAttribute("name"))).toEqual(["Acme Item"]);
      expect(beta.map((row) => row.getAttribute("name"))).toEqual(["Beta Item"]);
    } finally {
      await connection.run("RESET ROLE").catch(() => null);
      await connection.run(`DROP TABLE IF EXISTS ${grammar.wrap(table)} CASCADE`).catch(() => null);
      if (testRole && testSchema) {
        await connection.run(`REVOKE USAGE ON SCHEMA ${grammar.wrap(testSchema)} FROM ${grammar.wrap(testRole)}`).catch(() => null);
        await connection.run(`DROP ROLE IF EXISTS ${grammar.wrap(testRole)}`).catch(() => null);
      }
      await connection.close();
    }
  });

  runIfPostgres("runs migration batches through Bun PostgreSQL transactions", async () => {
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const schema = `fluent_migration_tx_${suffix}`;
    const migrations = join(process.cwd(), "tests", `.tmp-pg-migrations-${suffix}`);
    const connection = new Connection({ url: postgresUrl!, schema, max: 1 });
    const grammar = connection.getGrammar();
    const ormUrl = pathToFileURL(join(process.cwd(), "src", "index.ts")).href;

    try {
      await Schema.createSchema(schema, connection);
      await mkdir(migrations, { recursive: true });
      await Bun.write(join(migrations, "20260819000000_create_batch_first.ts"), `
import { Migration, Schema } from ${JSON.stringify(ormUrl)};
export default class CreateBatchFirst extends Migration {
  async up() { await Schema.create("batch_first", (table) => table.increments("id")); }
  async down() { await Schema.dropIfExists("batch_first"); }
}
`);
      await Bun.write(join(migrations, "20260819000001_fail_batch_second.ts"), `
import { Migration, Schema } from ${JSON.stringify(ormUrl)};
export default class FailBatchSecond extends Migration {
  async up() {
    await Schema.create("batch_second", (table) => table.increments("id"));
    throw new Error("rollback the migration batch");
  }
  async down() { await Schema.dropIfExists("batch_second"); }
}
`);

      const migrator = new Migrator(connection, migrations);
      await expect(migrator.run()).rejects.toThrow("rollback the migration batch");
      expect(await Schema.hasTable("batch_first", connection)).toBe(false);
      expect(await Schema.hasTable("batch_second", connection)).toBe(false);
      const rows = await connection.query(`SELECT COUNT(*)::int AS count FROM ${grammar.wrap(`${schema}.migrations`)}`);
      expect(rows[0]?.count).toBe(0);
    } finally {
      await connection.run(`DROP SCHEMA IF EXISTS ${grammar.wrap(schema)} CASCADE`).catch(() => null);
      await connection.close();
      await rm(migrations, { recursive: true, force: true });
    }
  });

  runIfPostgres("supports manual transactions on pooled PostgreSQL connections", async () => {
    const connection = new Connection({ url: postgresUrl! });
    const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const table = `fluent_manual_tx_${suffix}`;
    const grammar = connection.getGrammar();

    try {
      await connection.run(`CREATE TABLE ${grammar.wrap(table)} (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`);
      await connection.beginTransaction();
      await connection.run(`INSERT INTO ${grammar.wrap(table)} (id, name) VALUES (1, 'rollback')`);
      await connection.rollback();

      const rows = await connection.query(`SELECT * FROM ${grammar.wrap(table)}`);
      expect(rows).toHaveLength(0);
    } finally {
      if (connection.isInTransaction()) {
        await connection.rollback().catch(() => null);
      }
      await connection.run(`DROP TABLE IF EXISTS ${grammar.wrap(table)} CASCADE`);
      await connection.close();
    }
  });
});
