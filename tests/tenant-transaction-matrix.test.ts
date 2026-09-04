/** Tenant/transaction acceptance matrix: cross-resource switches reject;
 * schema + qualify on the same session participates in the root transaction.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Connection, ConnectionManager, DB, Model, TenantContext } from "../src/index.js";

const postgresUrl = process.env.POSTGRES_TEST_URL;
const runIfPostgres = postgresUrl ? test : test.skip;

class Widget extends Model<{ id: number; name: string }> {
  static table = "widgets";
  static guarded: string[] = [];
  static timestamps = false;
}

const DDL = "CREATE TABLE widgets (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL)";

let landlord: Connection;
let acme: Connection;
let globex: Connection;

async function names(connection: Connection, table = "widgets"): Promise<string[]> {
  const rows = (await connection.query(`SELECT name FROM ${table} ORDER BY name`)) as { name: string }[];
  return rows.map((row) => row.name);
}

/** Each tenant lives in its own physical SQLite database. */
function useDatabaseStrategy(): void {
  ConnectionManager.setTenantResolver((tenantId) => ({
    strategy: "database",
    name: `db:${tenantId}`,
    // Never used: `db:<tenant>` is pre-registered, so the manager reuses the
    // connection the test holds a handle to.
    config: { url: "sqlite://:memory:" },
  }));
}

/** Tenants share one connection; on SQLite `withTenant()` degrades to a plain transaction. */
function useRlsStrategy(): void {
  ConnectionManager.setTenantResolver((tenantId) => ({
    strategy: "rls",
    name: `rls:${tenantId}`,
    connection: tenantId === "acme" ? acme : globex,
  }));
}

describe("tenant × transaction matrix", () => {
  beforeEach(async () => {
    landlord = new Connection({ url: "sqlite://:memory:" });
    acme = new Connection({ url: "sqlite://:memory:" });
    globex = new Connection({ url: "sqlite://:memory:" });
    for (const connection of [landlord, acme, globex]) {
      await connection.run(DDL);
    }
    ConnectionManager.setDefault(landlord);
    ConnectionManager.add("db:acme", acme);
    ConnectionManager.add("db:globex", globex);
    Model.setConnection(landlord);
  });

  afterEach(async () => {
    await ConnectionManager.closeAll();
    ConnectionManager.clearDefault();
  });

  // ── Group A — must fail closed ────────────────────────────────────────────

  describe("A. entering a tenant scope with a transaction open", () => {
    test("database: DB.tenant() inside a landlord transaction is refused", async () => {
      useDatabaseStrategy();

      await expect(
        DB.transaction(async () => {
          await DB.tenant("acme", async () => {
            await DB.table("widgets").insert({ name: "should-never-persist" });
          });
        }),
      ).rejects.toThrow(/transaction/i);

      // Today the row lands here instead: the tenant scope never took effect.
      expect(await names(landlord)).toEqual([]);
      expect(await names(acme)).toEqual([]);
    });

    test("database: Model writes inside a nested tenant scope are refused", async () => {
      useDatabaseStrategy();

      await expect(
        DB.transaction(async () => {
          await DB.tenant("acme", async () => {
            await Widget.create({ name: "should-never-persist" });
          });
        }),
      ).rejects.toThrow(/transaction/i);

      expect(await names(landlord)).toEqual([]);
      expect(await names(acme)).toEqual([]);
    });

    test("database: reads inside a nested tenant scope never return landlord rows", async () => {
      useDatabaseStrategy();
      await landlord.run("INSERT INTO widgets (name) VALUES ('landlord-secret')");
      await acme.run("INSERT INTO widgets (name) VALUES ('acme-row')");

      let seen: string[] | undefined;
      const run = DB.transaction(async () => {
        await DB.tenant("acme", async () => {
          seen = (await DB.table("widgets").get()).map((row: any) => row.name);
        });
      });

      // Whatever the resolution, the one unacceptable outcome is tenant code
      // reading the landlord's rows.
      await expect(run).rejects.toThrow(/transaction/i);
      expect(seen).not.toEqual(["landlord-secret"]);
    });

    test("database: switching from tenant A to tenant B inside A's transaction is refused", async () => {
      useDatabaseStrategy();

      await expect(
        DB.tenant("acme", async () => {
          await DB.transaction(async () => {
            await DB.tenant("globex", async () => {
              await DB.table("widgets").insert({ name: "for-globex" });
            });
          });
        }),
      ).rejects.toThrow(/transaction/i);

      // Today this lands in acme — a write attributed to the wrong tenant.
      expect(await names(acme)).toEqual([]);
      expect(await names(globex)).toEqual([]);
    });

    test("database: asLandlord() inside a tenant transaction is refused", async () => {
      useDatabaseStrategy();

      await expect(
        DB.tenant("acme", async () => {
          await DB.transaction(async () => {
            await TenantContext.asLandlord(async () => {
              await DB.table("widgets").insert({ name: "landlord-only" });
            });
          });
        }),
      ).rejects.toThrow(/transaction/i);

      // `asLandlord()` clears TenantContext but not TransactionContext, so
      // today this row lands in acme — the opposite of what the call means.
      // This path is live in production: Job.dispatch() and Queue.push() both
      // wrap their driver call in asLandlord().
      expect(await names(acme)).toEqual([]);
      expect(await names(landlord)).toEqual([]);
    });

    test("rls: DB.tenant() inside a landlord transaction is refused", async () => {
      useRlsStrategy();

      // Passes routing today by accident — withTenant() opens its own
      // transaction, which reinstalls TransactionContext. But that means the
      // tenant work commits independently of the enclosing transaction, so the
      // enclosing rollback no longer covers it.
      await expect(
        DB.transaction(async () => {
          await DB.tenant("acme", async () => {
            await DB.table("widgets").insert({ name: "independent-commit" });
          });
          throw new Error("outer rollback");
        }),
      ).rejects.toThrow();

      expect(await names(acme)).toEqual([]);
    });

    runIfPostgres("schema/search_path: DB.tenant() inside a landlord transaction is refused", async () => {
      const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const tenantSchema = `tx_matrix_${suffix}`;
      const admin = new Connection({ url: postgresUrl! });
      await admin.run(`CREATE SCHEMA "${tenantSchema}"`);
      await admin.run(`CREATE TABLE "${tenantSchema}".widgets (id serial PRIMARY KEY, name text NOT NULL)`);
      await admin.run("CREATE TABLE IF NOT EXISTS public.widgets (id serial PRIMARY KEY, name text NOT NULL)");

      const pg = new Connection({ url: postgresUrl! });
      ConnectionManager.setDefault(pg);
      ConnectionManager.setTenantResolver((tenantId) => ({
        strategy: "schema",
        name: `sp:${tenantId}`,
        connection: pg,
        schema: tenantSchema,
        mode: "search_path",
      }));

      try {
        // withSearchPath() reserves a separate pooled session and sets the
        // search_path on it, but resolveDefaultConnection() still prefers the
        // enclosing transaction's connection. Measured: the row lands in
        // `public`, and the reserved session was wasted.
        await expect(
          DB.transaction(async () => {
            await DB.tenant("acme", async () => {
              await DB.table("widgets").insert({ name: "wrong-session" });
            });
          }),
        ).rejects.toThrow(/transaction/i);

        expect(await names(admin, `"${tenantSchema}".widgets`)).toEqual([]);
        expect(await names(admin, "public.widgets")).toEqual([]);
      } finally {
        await pg.close();
        await admin.run(`DROP SCHEMA IF EXISTS "${tenantSchema}" CASCADE`);
        await admin.run("DROP TABLE IF EXISTS public.widgets");
        await admin.close();
      }
    });

    runIfPostgres("schema/qualify: DB.tenant() inside a landlord transaction does not write to public", async () => {
      const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const tenantSchema = `tx_matrix_q_${suffix}`;
      const admin = new Connection({ url: postgresUrl! });
      await admin.run(`CREATE SCHEMA "${tenantSchema}"`);
      await admin.run(`CREATE TABLE "${tenantSchema}".widgets (id serial PRIMARY KEY, name text NOT NULL)`);
      await admin.run("CREATE TABLE IF NOT EXISTS public.widgets (id serial PRIMARY KEY, name text NOT NULL)");

      const pg = new Connection({ url: postgresUrl! });
      ConnectionManager.setDefault(pg);
      Model.setConnection(pg);
      ConnectionManager.setTenantResolver((tenantId) => ({
        strategy: "schema",
        name: `q:${tenantId}`,
        connection: pg,
        schema: tenantSchema,
        mode: "qualify",
      }));

      try {
        await DB.transaction(async () => {
          await DB.tenant("acme", async () => {
            await Widget.create({ name: "tenant-row" });
          });
        });

        // Same connection and same transaction, so correct routing IS
        // achievable here. What must never happen is the row landing in public.
        expect(await names(admin, "public.widgets")).toEqual([]);
        expect(await names(admin, `"${tenantSchema}".widgets`)).toEqual(["tenant-row"]);
      } finally {
        await pg.close();
        await admin.run(`DROP SCHEMA IF EXISTS "${tenantSchema}" CASCADE`);
        await admin.run("DROP TABLE IF EXISTS public.widgets");
        await admin.close();
      }
    });
  });

  // ── Group B — must keep working ───────────────────────────────────────────

  describe("B. paths a fix must not break", () => {
    test("database: tenant scope with no transaction routes to the tenant", async () => {
      useDatabaseStrategy();

      await DB.tenant("acme", async () => {
        await DB.table("widgets").insert({ name: "acme-row" });
      });

      expect(await names(acme)).toEqual(["acme-row"]);
      expect(await names(landlord)).toEqual([]);
    });

    test("database: a transaction opened inside a tenant scope stays on the tenant", async () => {
      useDatabaseStrategy();

      await DB.tenant("acme", async () => {
        await DB.transaction(async () => {
          await DB.table("widgets").insert({ name: "acme-tx-row" });
        });
      });

      expect(await names(acme)).toEqual(["acme-tx-row"]);
      expect(await names(landlord)).toEqual([]);
    });

    test("database: a rollback inside a tenant scope rolls back the tenant's write", async () => {
      useDatabaseStrategy();

      await expect(
        DB.tenant("acme", async () => {
          await DB.transaction(async () => {
            await DB.table("widgets").insert({ name: "rolled-back" });
            throw new Error("boom");
          });
        }),
      ).rejects.toThrow("boom");

      expect(await names(acme)).toEqual([]);
    });

    test("database: sequential tenant scopes route independently", async () => {
      useDatabaseStrategy();

      await DB.tenant("acme", async () => {
        await DB.table("widgets").insert({ name: "for-acme" });
      });
      await DB.tenant("globex", async () => {
        await DB.table("widgets").insert({ name: "for-globex" });
      });

      expect(await names(acme)).toEqual(["for-acme"]);
      expect(await names(globex)).toEqual(["for-globex"]);
      expect(await names(landlord)).toEqual([]);
    });

    test("database: nested tenant scopes without a transaction route to the inner tenant", async () => {
      useDatabaseStrategy();

      await DB.tenant("acme", async () => {
        await DB.tenant("globex", async () => {
          await DB.table("widgets").insert({ name: "for-globex" });
        });
        await DB.table("widgets").insert({ name: "for-acme" });
      });

      expect(await names(globex)).toEqual(["for-globex"]);
      expect(await names(acme)).toEqual(["for-acme"]);
    });

    test("database: asLandlord() with no transaction open reaches the landlord", async () => {
      useDatabaseStrategy();

      await DB.tenant("acme", async () => {
        await TenantContext.asLandlord(async () => {
          await DB.table("widgets").insert({ name: "landlord-row" });
        });
      });

      expect(await names(landlord)).toEqual(["landlord-row"]);
      expect(await names(acme)).toEqual([]);
    });
  });
});
