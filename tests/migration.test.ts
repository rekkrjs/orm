import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { mkdir, readdir, unlink, rm } from "fs/promises";
import { join } from "path";
import { Connection, Schema, Migration, Migrator, MigrationCreator, ConnectionManager, Model } from "../src/index.js";
import { runConfiguredMigrationCommand } from "../src/cli/MigrationHelpers.js";
import { setupTestDb } from "./helpers.js";

const TEST_MIGRATIONS_DIR = join(process.cwd(), "tests", "temp_migrations");
const TEST_MIGRATIONS_DIR_A = join(process.cwd(), "tests", "temp_migrations_a");
const TEST_MIGRATIONS_DIR_B = join(process.cwd(), "tests", "temp_migrations_b");
const TEST_MIGRATIONS_DIR_C = join(process.cwd(), "tests", "temp_migrations_c");
const TEST_MIGRATIONS_DIR_D = join(process.cwd(), "tests", "temp_migrations_d");
const TEST_MIGRATIONS_DIR_TENANT = join(process.cwd(), "tests", "temp_migrations_tenant");
const TEST_MIGRATIONS_DIR_LOCKS = join(process.cwd(), "tests", "temp_migrations_locks");
const TEST_MIGRATIONS_DIR_COMMANDS = join(process.cwd(), "tests", "temp_migrations_commands");
const TEST_MIGRATIONS_DIR_RESTORE = join(process.cwd(), "tests", "temp_migrations_restore");

describe("MigrationCreator", () => {
  test("creates migration file with class", async () => {
    await mkdir(TEST_MIGRATIONS_DIR, { recursive: true });
    const creator = new MigrationCreator();
    const path = await creator.create("CreateUsersTable", TEST_MIGRATIONS_DIR);
    expect(path).toContain("create_users_table");
    const content = await Bun.file(path).text();
    expect(content).toContain("extends Migration");
    expect(content).toContain("async up()");
    expect(content).toContain("async down()");
    await unlink(path);
  });
});

describe("Migrator", () => {
  let connection: Connection;

  beforeAll(async () => {
    connection = setupTestDb();
    await mkdir(TEST_MIGRATIONS_DIR, { recursive: true });
  });

  afterAll(async () => {
    await rm(TEST_MIGRATIONS_DIR, { recursive: true, force: true });
  });

  test("creates migrations table on first run", async () => {
    const migrator = new Migrator(connection, TEST_MIGRATIONS_DIR);
    await migrator.run();
    expect(await Schema.hasTable("migrations", connection)).toBe(true);
  });

  test("Migrator restores global bindings when no default existed", async () => {
    const previousSchemaConnection = (Schema as any).connection as Connection | undefined;
    const previousModelConnection = (Model as any).connection as Connection | undefined;
    const previousDefaultConnection = ConnectionManager.getDefault();

    delete (Schema as any).connection;
    delete (Model as any).connection;
    ConnectionManager.clearDefault();

    await mkdir(TEST_MIGRATIONS_DIR_RESTORE, { recursive: true });
    const filePath = join(TEST_MIGRATIONS_DIR_RESTORE, "20260408000000_create_restore_check_table.ts");
    await Bun.write(
      filePath,
      `
import { Migration, Schema } from "../../src/index.js";
export default class CreateRestoreCheckTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("restore_check_table", (table) => {
      table.increments("id");
    });
  }
  async down(): Promise<void> {
    await Schema.dropIfExists("restore_check_table");
  }
}`
    );

    const isolated = new Connection({ url: "sqlite://:memory:" });

    try {
      const migrator = new Migrator(isolated, TEST_MIGRATIONS_DIR_RESTORE);
      await migrator.run();

      expect(ConnectionManager.getDefault()).toBeUndefined();
      expect((Model as any).connection).toBeUndefined();
    } finally {
      await isolated.close();
      await rm(TEST_MIGRATIONS_DIR_RESTORE, { recursive: true, force: true });
      if (previousSchemaConnection) {
        Schema.setConnection(previousSchemaConnection);
      } else {
        delete (Schema as any).connection;
      }
      if (previousModelConnection) {
        Model.setConnection(previousModelConnection);
      } else {
        delete (Model as any).connection;
      }
      if (previousDefaultConnection) {
        ConnectionManager.setDefault(previousDefaultConnection);
      } else {
        ConnectionManager.clearDefault();
      }
    }
  });

  test("runs pending migrations", async () => {
    const fileName = `20260101000000_create_test_items.ts`;
    const filePath = join(TEST_MIGRATIONS_DIR, fileName);
    const content = `
import { Migration, Schema } from "../../src/index.js";
export default class CreateTestItems extends Migration {
  async up(): Promise<void> {
    await Schema.create("test_items", (table) => {
      table.increments("id");
      table.string("name");
    });
  }
  async down(): Promise<void> {
    await Schema.dropIfExists("test_items");
  }
}`;
    await Bun.write(filePath, content);

    const migrator = new Migrator(connection, TEST_MIGRATIONS_DIR);
    const applied = await migrator.run();
    expect(applied).toEqual([`tests/temp_migrations/${fileName}`]);
    expect(await Schema.hasTable("test_items", connection)).toBe(true);
  });

  test("disables query logging while running migrations", async () => {
    const dir = join(process.cwd(), "tests", "temp_migrations_no_query_logs");
    await mkdir(dir, { recursive: true });
    const isolated = setupTestDb();
    const filePath = join(dir, "20260409000000_create_no_query_log_items.ts");
    await Bun.write(
      filePath,
      `
import { Migration, Schema } from "../../src/index.js";
export default class CreateNoQueryLogItems extends Migration {
  async up(): Promise<void> {
    await Schema.create("no_query_log_items", (table) => {
      table.increments("id");
      table.string("name");
    });
  }
  async down(): Promise<void> {
    await Schema.dropIfExists("no_query_log_items");
  }
}`,
    );

    const previousLogQueries = Connection.logQueries;
    const logs: unknown[][] = [];
    const previousConsoleLog = console.log;
    Connection.logQueries = true;
    console.log = (...args: unknown[]) => { logs.push(args); };

    try {
      await new Migrator(isolated, dir).run();
    } finally {
      console.log = previousConsoleLog;
      Connection.logQueries = previousLogQueries;
      await isolated.close();
      await rm(dir, { recursive: true, force: true });
    }

    expect(logs.some((args) => args[0] === "[QUERY]")).toBe(false);
    expect(logs.some((args) => String(args[0]).startsWith("Migrating:"))).toBe(true);
  });

  test("disables query logging while selecting landlord and tenants", async () => {
    const dir = join(process.cwd(), "tests", "temp_migrations_no_selection_logs");
    await mkdir(dir, { recursive: true });
    const isolated = setupTestDb();

    const previousLogQueries = Connection.logQueries;
    const logs: unknown[][] = [];
    const previousConsoleLog = console.log;
    const previousConsoleTable = console.table;
    Connection.logQueries = true;
    console.log = (...args: unknown[]) => { logs.push(args); };
    console.table = (...args: unknown[]) => { logs.push(["table", ...args]); };

    try {
      await runConfiguredMigrationCommand(
        "migrate:status",
        {
          migrations: { landlord: dir, tenant: dir },
          tenancy: {
            listTenants: async () => {
              await isolated.query("SELECT 1 as landlord_selection");
              return ["acme"];
            },
            resolveTenant: async (tenantId: string) => {
              await isolated.query("SELECT 1 as tenant_selection");
              return {
                strategy: "database",
                name: `tenant:${tenantId}`,
                config: { url: "sqlite://:memory:" },
              };
            },
          },
        } as any,
        isolated,
        { scope: "default" },
      );
    } finally {
      console.log = previousConsoleLog;
      console.table = previousConsoleTable;
      Connection.logQueries = previousLogQueries;
      await ConnectionManager.closeAll();
      await isolated.close();
      await rm(dir, { recursive: true, force: true });
    }

    expect(logs.some((args) => args[0] === "[QUERY]")).toBe(false);
    expect(logs.some((args) => args[0] === "Landlord migrations")).toBe(true);
    expect(logs.some((args) => args[0] === "Tenant: acme")).toBe(true);
  });

  test("emits one JSON document for a landlord + tenants run, progress on stderr", async () => {
    const dir = join(process.cwd(), "tests", "temp_migrations_json_scopes");
    await mkdir(dir, { recursive: true });
    await Bun.write(
      join(dir, "20260101000000_create_json_scope_table.ts"),
      `
import { Migration, Schema } from "../../src/index.js";
export default class CreateJsonScopeTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("json_scope", (table) => { table.increments("id"); });
  }
  async down(): Promise<void> {
    await Schema.dropIfExists("json_scope");
  }
}`
    );
    const isolated = setupTestDb();

    const stdout: string[] = [];
    const stderr: string[] = [];
    const previousStdout = process.stdout.write;
    const previousStderr = process.stderr.write;
    process.stdout.write = ((chunk: any) => { stdout.push(String(chunk)); return true; }) as any;
    process.stderr.write = ((chunk: any) => { stderr.push(String(chunk)); return true; }) as any;

    try {
      await runConfiguredMigrationCommand(
        "migrate:status",
        {
          migrations: { landlord: dir, tenant: dir },
          tenancy: {
            listTenants: async () => ["acme", "globex"],
            resolveTenant: async (tenantId: string) => ({
              strategy: "database",
              name: `tenant:${tenantId}`,
              config: { url: "sqlite://:memory:" },
            }),
          },
        } as any,
        isolated,
        { scope: "default" },
        { json: true },
      );
    } finally {
      process.stdout.write = previousStdout;
      process.stderr.write = previousStderr;
      await ConnectionManager.closeAll();
      await isolated.close();
      await rm(dir, { recursive: true, force: true });
    }

    // One document for the whole run, not one per tenant.
    const documents = stdout.join("").trim().split("\n").filter(Boolean);
    expect(documents).toHaveLength(1);
    const payload = JSON.parse(documents[0]);
    expect(payload.migrations.map((row: any) => row.tenant)).toEqual([null, "acme", "globex"]);
    expect(payload.migrations.every((row: any) => row.status === "Pending")).toBe(true);

    const progress = stderr.join("");
    expect(progress).toContain("Landlord migrations");
    expect(progress).toContain("Tenant: acme");
    expect(stdout.join("")).not.toContain("Tenant: acme");
  });

  test("status shows ran migrations", async () => {
    const migrator = new Migrator(connection, TEST_MIGRATIONS_DIR);
    const status = await migrator.status();
    const ran = status.filter((s) => s.status === "Ran");
    expect(ran.length).toBeGreaterThanOrEqual(1);
  });

  test("rollback undoes last batch", async () => {
    const migrator = new Migrator(connection, TEST_MIGRATIONS_DIR);
    await migrator.rollback();
    expect(await Schema.hasTable("test_items", connection)).toBe(false);
  });

  test("status shows pending after rollback", async () => {
    const migrator = new Migrator(connection, TEST_MIGRATIONS_DIR);
    const status = await migrator.status();
    const pending = status.filter((s) => s.status === "Pending");
    expect(pending.length).toBeGreaterThanOrEqual(1);
  });

  test("regenerates types beside configured model roots after migration", async () => {
    const modelsDir = join(process.cwd(), "tests", "temp_migration_models");
    const typesDir = join(modelsDir, "types");
    const fileName = `20260301000000_create_type_test_table.ts`;
    const filePath = join(TEST_MIGRATIONS_DIR, fileName);
    const content = `
import { Migration, Schema } from "../../src/index.js";
export default class CreateTypeTestTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("type_test_table", (table) => {
      table.increments("id");
      table.string("label");
    });
  }
  async down(): Promise<void> {
    await Schema.dropIfExists("type_test_table");
  }
}`;
    await Bun.write(filePath, content);
    await mkdir(modelsDir, { recursive: true });
    await Bun.write(join(modelsDir, "TypeTestTable.ts"), `
import { Model } from "../../src/index.js";
export class TypeTestTable extends Model { static table = "type_test_table"; }
`);

    const migrator = new Migrator(connection, TEST_MIGRATIONS_DIR, { modelDirectory: modelsDir });
    await migrator.run();

    // Verify types were generated
    const files = await readdir(typesDir);
    expect(files).toContain("type_test_table.d.ts");
    expect(files).toContain("index.d.ts");

    const content_gen = await Bun.file(join(typesDir, "type_test_table.d.ts")).text();
    expect(content_gen).toContain("export interface TypeTestTableAttributes {");
    expect(content_gen).toContain("label: string;");

    // Cleanup
    await unlink(filePath);
    await rm(modelsDir, { recursive: true, force: true });
  });

  test("dispatches migration events and dumps schema", async () => {
    const fileName = `20260302000000_create_event_test_table.ts`;
    const filePath = join(TEST_MIGRATIONS_DIR, fileName);
    const dumpPath = join(process.cwd(), "tests", "temp_schema_dump.sql");
    const events: string[] = [];
    const content = `
import { Migration, Schema } from "../../src/index.js";
export default class CreateEventTestTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("event_test_table", (table) => {
      table.increments("id");
    });
  }
  async down(): Promise<void> {
    await Schema.dropIfExists("event_test_table");
  }
}`;
    await Bun.write(filePath, content);

    Migrator.clearListeners();
    Migrator.on("migrating", ({ migration }) => events.push(`migrating:${migration}`));
    Migrator.on("migrated", ({ migration }) => events.push(`migrated:${migration}`));
    Migrator.on("schemaDumped", ({ path }) => events.push(`dumped:${path}`));

    const migrator = new Migrator(connection, TEST_MIGRATIONS_DIR);
    await migrator.run();
    await migrator.dumpSchema(dumpPath);

    const dump = await Bun.file(dumpPath).text();
    expect(events).toContain(`migrating:tests/temp_migrations/${fileName}`);
    expect(events).toContain(`migrated:tests/temp_migrations/${fileName}`);
    expect(events).toContain(`dumped:${dumpPath}`);
    expect(dump).toContain("CREATE TABLE");
    expect(dump).toContain("event_test_table");

    Migrator.clearListeners();
    await unlink(filePath);
    await rm(dumpPath, { force: true });
  });

  test("postgres schema dump parameterizes schema metadata queries", async () => {
    const postgres = new Connection({ url: "postgres://user:pass@localhost:5432/db", schema: "public'; DROP SCHEMA public; --" });
    const calls: { sql: string; bindings: any[] }[] = [];
    postgres.query = async (sql: string, bindings?: any[]) => {
      calls.push({ sql, bindings: bindings || [] });
      return [];
    };

    const dumpPath = join(process.cwd(), "tests", "temp_postgres_schema_dump.sql");
    const migrator = new Migrator(postgres, TEST_MIGRATIONS_DIR);
    await migrator.dumpSchema(dumpPath);

    expect(calls[0].sql).toContain("table_schema = $1");
    expect(calls[0].sql).not.toContain("DROP SCHEMA");
    expect(calls[0].bindings).toEqual(["public'; DROP SCHEMA public; --"]);

    await rm(dumpPath, { force: true });
  });

  test("createIfMissing resolves database and schema targets", async () => {
    const fakeConnection = {
      getDriverName: () => "postgres" as const,
      getConfig: () => ({ url: "postgres://user:pass@localhost:5432/app_db" }),
      getSchema: () => "tenant_demo",
      qualifyTable: (table: string) => table,
    } as unknown as Connection;

    const migrator = new Migrator(fakeConnection, TEST_MIGRATIONS_DIR, {}, {
      createIfMissing: {
        database: true,
        schema: true,
      },
    });

    expect((migrator as any).getTargetDatabase()).toBe("app_db");
    expect((migrator as any).getTargetSchema()).toBe("tenant_demo");

    const calls: string[] = [];
    (migrator as any).ensureDatabaseIfMissing = async () => {
      calls.push("database");
    };
    (migrator as any).ensureSchemaIfMissing = async () => {
      calls.push("schema");
    };

    await (migrator as any).ensureCreateIfMissing();
    expect(calls).toEqual(["database", "schema"]);
  });
});

describe("Migrator multi-path support", () => {
  let connection: Connection;

  beforeAll(async () => {
    connection = setupTestDb();
    await mkdir(TEST_MIGRATIONS_DIR_A, { recursive: true });
    await mkdir(TEST_MIGRATIONS_DIR_B, { recursive: true });
  });

  afterAll(async () => {
    for (const dir of [TEST_MIGRATIONS_DIR_A, TEST_MIGRATIONS_DIR_B, TEST_MIGRATIONS_DIR_C, TEST_MIGRATIONS_DIR_D, TEST_MIGRATIONS_DIR_TENANT, TEST_MIGRATIONS_DIR_LOCKS, TEST_MIGRATIONS_DIR_COMMANDS]) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("runs migrations from multiple configured folders", async () => {
    await Bun.write(
      join(TEST_MIGRATIONS_DIR_A, "20260401000000_create_alpha_table.ts"),
      `
import { Migration, Schema } from "../../src/index.js";
export default class CreateAlphaTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("alpha_table", (table) => {
      table.increments("id");
    });
  }
  async down(): Promise<void> {
    await Schema.dropIfExists("alpha_table");
  }
}`
    );

    await Bun.write(
      join(TEST_MIGRATIONS_DIR_B, "20260402000000_create_beta_table.ts"),
      `
import { Migration, Schema } from "../../src/index.js";
export default class CreateBetaTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("beta_table", (table) => {
      table.increments("id");
    });
  }
  async down(): Promise<void> {
    await Schema.dropIfExists("beta_table");
  }
}`
    );

    const migrator = new Migrator(connection, [TEST_MIGRATIONS_DIR_A, TEST_MIGRATIONS_DIR_B]);
    await migrator.run();

    expect(await Schema.hasTable("alpha_table", connection)).toBe(true);
    expect(await Schema.hasTable("beta_table", connection)).toBe(true);

    const status = await migrator.status();
    expect(status.filter((row) => row.status === "Ran").length).toBeGreaterThanOrEqual(2);
  });

  test("supports modular landlord and tenant migration path arrays", async () => {
    await mkdir(TEST_MIGRATIONS_DIR_C, { recursive: true });
    await mkdir(TEST_MIGRATIONS_DIR_D, { recursive: true });

    await Bun.write(
      join(TEST_MIGRATIONS_DIR_C, "20260403000000_create_landlord_settings_table.ts"),
      `
import { Migration, Schema } from "../../src/index.js";
export default class CreateLandlordSettingsTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("landlord_settings", (table) => {
      table.increments("id");
    });
  }
  async down(): Promise<void> {
    await Schema.dropIfExists("landlord_settings");
  }
}`
    );

    await Bun.write(
      join(TEST_MIGRATIONS_DIR_D, "20260404000000_create_tenant_notes_table.ts"),
      `
import { Migration, Schema } from "../../src/index.js";
export default class CreateTenantNotesTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("tenant_notes", (table) => {
      table.increments("id");
    });
  }
  async down(): Promise<void> {
    await Schema.dropIfExists("tenant_notes");
  }
}`
    );

    const landlordMigrator = new Migrator(connection, [TEST_MIGRATIONS_DIR_C, TEST_MIGRATIONS_DIR_A]);
    const tenantMigrator = new Migrator(connection, [TEST_MIGRATIONS_DIR_D, TEST_MIGRATIONS_DIR_B]);

    await landlordMigrator.run();
    await tenantMigrator.run();

    expect(await Schema.hasTable("landlord_settings", connection)).toBe(true);
    expect(await Schema.hasTable("tenant_notes", connection)).toBe(true);
  });

  test("scopes migration status and records by tenant", async () => {
    await mkdir(TEST_MIGRATIONS_DIR_TENANT, { recursive: true });
    const fileName = "20260405000000_create_tenant_status_marker.ts";
    await Bun.write(
      join(TEST_MIGRATIONS_DIR_TENANT, fileName),
      `
import { Migration, Schema } from "../../src/index.js";
export default class CreateTenantStatusMarker extends Migration {
  async up(): Promise<void> {
    await Schema.create("tenant_status_marker", (table) => {
      table.increments("id");
    });
  }
  async down(): Promise<void> {
    await Schema.dropIfExists("tenant_status_marker");
  }
}`
    );

    const acmeMigrator = new Migrator(connection, TEST_MIGRATIONS_DIR_TENANT, {}, { tenantId: "acme" });
    const betaMigrator = new Migrator(connection, TEST_MIGRATIONS_DIR_TENANT, {}, { tenantId: "beta" });
    await acmeMigrator.run();

    const acmeStatus = await acmeMigrator.status();
    const betaStatus = await betaMigrator.status();
    const rows = await connection.query("SELECT migration, tenant FROM migrations WHERE migration LIKE ?", [`%${fileName}`]);

    expect(acmeStatus[0]).toMatchObject({ status: "Ran", tenant: "acme" });
    expect(betaStatus[0]).toMatchObject({ status: "Pending", tenant: "beta" });
    expect(rows.some((row: any) => row.tenant === "acme")).toBe(true);
    expect(rows.some((row: any) => row.tenant === "beta")).toBe(false);
  });

  test("uses separate migration locks per tenant", async () => {
    await mkdir(TEST_MIGRATIONS_DIR_LOCKS, { recursive: true });
    const acmeMigrator = new Migrator(connection, TEST_MIGRATIONS_DIR_LOCKS, {}, { tenantId: "acme" });
    await acmeMigrator.run();

    await connection.run(
      "INSERT INTO migration_locks (name, owner, created_at) VALUES (?, ?, ?)",
      ["migrations:tenant:acme", "test-owner", new Date().toISOString()]
    );

    const lockedAcme = new Migrator(connection, TEST_MIGRATIONS_DIR_LOCKS, {}, { tenantId: "acme", lockTimeoutMs: 1 });
    const betaMigrator = new Migrator(connection, TEST_MIGRATIONS_DIR_LOCKS, {}, { tenantId: "beta", lockTimeoutMs: 1 });

    await expect(lockedAcme.run()).rejects.toThrow('Could not acquire migration lock "migrations:tenant:acme"');
    await betaMigrator.run();

    await connection.run("DELETE FROM migration_locks WHERE name = ?", ["migrations:tenant:acme"]);
  });

  test("takes over a migration lock orphaned by a dead process", async () => {
    await mkdir(TEST_MIGRATIONS_DIR_LOCKS, { recursive: true });
    await connection.run(
      "INSERT INTO migration_locks (name, owner, created_at) VALUES (?, ?, ?)",
      ["migrations:tenant:orphan", "dead-process", new Date(Date.now() - 60_000).toISOString()]
    );

    const migrator = new Migrator(connection, TEST_MIGRATIONS_DIR_LOCKS, {}, {
      tenantId: "orphan",
      lockTimeoutMs: 1,
      lockMaxAgeMs: 1_000,
    });
    await migrator.run();

    const rows = await connection.query("SELECT name FROM migration_locks WHERE name = ?", [
      "migrations:tenant:orphan",
    ]);
    expect(rows.length).toBe(0);
  });

  test("keeps waiting on a fresh lock instead of stealing it", async () => {
    await mkdir(TEST_MIGRATIONS_DIR_LOCKS, { recursive: true });
    await connection.run(
      "INSERT INTO migration_locks (name, owner, created_at) VALUES (?, ?, ?)",
      ["migrations:tenant:fresh", "live-process", new Date().toISOString()]
    );

    const migrator = new Migrator(connection, TEST_MIGRATIONS_DIR_LOCKS, {}, {
      tenantId: "fresh",
      lockTimeoutMs: 1,
      lockMaxAgeMs: 60_000,
    });

    await expect(migrator.run()).rejects.toThrow('Could not acquire migration lock "migrations:tenant:fresh"');

    const rows = await connection.query("SELECT owner FROM migration_locks WHERE name = ?", [
      "migrations:tenant:fresh",
    ]);
    expect(rows[0]?.owner).toBe("live-process");

    await connection.run("DELETE FROM migration_locks WHERE name = ?", ["migrations:tenant:fresh"]);
  });

  test("detects changed migration checksums", async () => {
    await mkdir(TEST_MIGRATIONS_DIR_COMMANDS, { recursive: true });
    const filePath = join(TEST_MIGRATIONS_DIR_COMMANDS, "20260406000000_create_checksum_table.ts");
    const original = `
import { Migration, Schema } from "../../src/index.js";
export default class CreateChecksumTable extends Migration {
  async up(): Promise<void> {
    await Schema.create("checksum_table", (table) => {
      table.increments("id");
    });
  }
  async down(): Promise<void> {
    await Schema.dropIfExists("checksum_table");
  }
}`;
    await Bun.write(filePath, original);

    const checksumConnection = setupTestDb();
    const migrator = new Migrator(checksumConnection, TEST_MIGRATIONS_DIR_COMMANDS);
    await migrator.run();
    await Bun.write(filePath, original.replace("table.increments", "table.increments"));
    await Bun.write(filePath, `${original}\n// changed after run\n`);

    const status = await migrator.status();

    expect(status[0].status).toBe("Changed");
    expect(status[0].checksum).not.toBe(status[0].storedChecksum);
    await checksumConnection.close();
  });

  test("supports reset, refresh, fresh, and multi-step rollback", async () => {
    const commandDir = join(TEST_MIGRATIONS_DIR_COMMANDS, "commands");
    await rm(commandDir, { recursive: true, force: true });
    await mkdir(commandDir, { recursive: true });
    await Bun.write(
      join(commandDir, "20260407000000_create_command_a.ts"),
      `
import { Migration, Schema } from "../../../src/index.js";
export default class CreateCommandA extends Migration {
  async up(): Promise<void> {
    await Schema.create("command_a", (table) => {
      table.increments("id");
    });
  }
  async down(): Promise<void> {
    await Schema.dropIfExists("command_a");
  }
}`
    );
    const commandBPath = join(commandDir, "20260408000000_create_command_b.ts");
    const commandB = `
import { Migration, Schema } from "../../../src/index.js";
export default class CreateCommandB extends Migration {
  async up(): Promise<void> {
    await Schema.create("command_b", (table) => {
      table.increments("id");
    });
  }
  async down(): Promise<void> {
    await Schema.dropIfExists("command_b");
  }
}`;

    const commandConnection = setupTestDb();
    const migrator = new Migrator(commandConnection, commandDir);
    await migrator.run();
    await Bun.write(commandBPath, commandB);
    await migrator.run();
    await migrator.rollback(2);
    expect(await Schema.hasTable("command_b", commandConnection)).toBe(false);
    expect(await Schema.hasTable("command_a", commandConnection)).toBe(false);

    await migrator.refresh();
    expect(await Schema.hasTable("command_a", commandConnection)).toBe(true);
    expect(await Schema.hasTable("command_b", commandConnection)).toBe(true);

    await migrator.reset();
    expect(await Schema.hasTable("command_a", commandConnection)).toBe(false);
    expect(await Schema.hasTable("command_b", commandConnection)).toBe(false);

    await Schema.create("unmanaged_table", (table) => {
      table.increments("id");
    }, commandConnection);
    await migrator.fresh();
    expect(await Schema.hasTable("unmanaged_table", commandConnection)).toBe(false);
    expect(await Schema.hasTable("command_a", commandConnection)).toBe(true);
    expect(await Schema.hasTable("command_b", commandConnection)).toBe(true);
    await commandConnection.close();
  });
});
