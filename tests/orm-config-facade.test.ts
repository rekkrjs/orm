import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { ConnectionManager, configureOrm, reconfigureOrm, Schema } from "../src/index.js";
import { cleanupSqliteFile } from "./helpers.js";

const MIGRATIONS_DIR = join(process.cwd(), "tests", "temp_bcf_migrations");
const TENANT_MIGRATIONS_DIR = join(process.cwd(), "tests", "temp_bcf_tenant_migrations");
const SEEDERS_DIR = join(process.cwd(), "tests", "temp_bcf_seeders");

async function writeMigration(dir: string, name: string, body: string): Promise<void> {
  await writeFile(join(dir, name), body, "utf-8");
}

describe("configureOrm facade", () => {
  beforeAll(async () => {
    await mkdir(MIGRATIONS_DIR, { recursive: true });
    await mkdir(TENANT_MIGRATIONS_DIR, { recursive: true });
    await mkdir(SEEDERS_DIR, { recursive: true });

    await writeMigration(
      MIGRATIONS_DIR,
      "20260101000000_create_widgets.ts",
      `import { Migration, Schema } from "../../src/index.js";
export default class CreateWidgets extends Migration {
  async up() {
    await Schema.create("bcf_widgets", (t) => {
      t.increments("id");
      t.string("name");
    });
  }
  async down() { await Schema.dropIfExists("bcf_widgets"); }
}
`
    );

    await writeMigration(
      TENANT_MIGRATIONS_DIR,
      "20260101000001_create_gadgets.ts",
      `import { Migration, Schema } from "../../src/index.js";
export default class CreateGadgets extends Migration {
  async up() {
    await Schema.create("bcf_gadgets", (t) => {
      t.increments("id");
      t.string("label");
    });
  }
  async down() { await Schema.dropIfExists("bcf_gadgets"); }
}
`
    );

    await writeFile(
      join(SEEDERS_DIR, "WidgetSeeder.ts"),
      `import { Seeder } from "../../src/index.js";
export default class WidgetSeeder extends Seeder {
  async run() {
    await this.connection.run("INSERT INTO bcf_widgets (name) VALUES ('seeded-a'), ('seeded-b')");
  }
}
`
    );
  });

  afterAll(async () => {
    await ConnectionManager.closeAll();
    await rm(MIGRATIONS_DIR, { recursive: true, force: true });
    await rm(TENANT_MIGRATIONS_DIR, { recursive: true, force: true });
    await rm(SEEDERS_DIR, { recursive: true, force: true });
  });

  test("reconfigureOrm closes the previous default connection before replacing it", async () => {
    const first = configureOrm({
      connection: { url: "sqlite://:memory:" },
      migrationsPath: MIGRATIONS_DIR,
    });

    let closed = false;
    const originalClose = first.connection.close.bind(first.connection);
    first.connection.close = async () => {
      closed = true;
      await originalClose();
    };

    await reconfigureOrm({
      connection: { url: "sqlite://:memory:" },
      migrationsPath: MIGRATIONS_DIR,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(closed).toBe(true);
  });

  test("migrate() runs landlord migrations from config.migrationsPath", async () => {
    const orm = await reconfigureOrm({
      connection: { url: "sqlite://:memory:" },
      migrationsPath: MIGRATIONS_DIR,
      seedersPath: SEEDERS_DIR,
    });

    await orm.migrate();

    expect(await Schema.hasTable("bcf_widgets")).toBe(true);
    expect(await Schema.hasTable("migrations")).toBe(true);
  });

  test("migrator() exposes underlying instance", async () => {
    const orm = await reconfigureOrm({
      connection: { url: "sqlite://:memory:" },
      migrationsPath: MIGRATIONS_DIR,
    });

    const migrator = orm.migrator();
    await migrator.run();
    const status = await migrator.status();
    expect(status.length).toBeGreaterThan(0);
  });

  test("seed() runs seeders from config.seedersPath", async () => {
    const orm = await reconfigureOrm({
      connection: { url: "sqlite://:memory:" },
      migrationsPath: MIGRATIONS_DIR,
      seedersPath: SEEDERS_DIR,
    });

    await orm.migrate();
    await orm.seed();

    const rows = await orm.connection.query("SELECT COUNT(*) as c FROM bcf_widgets");
    expect(Number(rows[0].c)).toBe(2);
  });

  test("seed() throws when seedersPath missing", async () => {
    const orm = await reconfigureOrm({
      connection: { url: "sqlite://:memory:" },
      migrationsPath: MIGRATIONS_DIR,
    });
    expect(orm.seed()).rejects.toThrow(/seedersPath/);
  });

  test("rollback() reverses last batch", async () => {
    const orm = await reconfigureOrm({
      connection: { url: "sqlite://:memory:" },
      migrationsPath: MIGRATIONS_DIR,
    });

    await orm.migrate();
    expect(await Schema.hasTable("bcf_widgets")).toBe(true);

    await orm.rollback();
    expect(await Schema.hasTable("bcf_widgets")).toBe(false);
  });

  test("fresh() drops all + re-runs", async () => {
    const orm = await reconfigureOrm({
      connection: { url: "sqlite://:memory:" },
      migrationsPath: MIGRATIONS_DIR,
    });

    await orm.migrate();
    await orm.connection.run("INSERT INTO bcf_widgets (name) VALUES ('keep-me')");

    await orm.fresh();

    const rows = await orm.connection.query("SELECT COUNT(*) as c FROM bcf_widgets");
    expect(Number(rows[0].c)).toBe(0);
  });

  test("migrate('tenant') uses config.migrations.tenant path", async () => {
    const orm = await reconfigureOrm({
      connection: { url: "sqlite://:memory:" },
      migrations: {
        landlord: MIGRATIONS_DIR,
        tenant: TENANT_MIGRATIONS_DIR,
      },
    });

    await orm.migrate("landlord");
    await orm.migrate("tenant");

    expect(await Schema.hasTable("bcf_widgets")).toBe(true);
    expect(await Schema.hasTable("bcf_gadgets")).toBe(true);
  });

  test("migrate() throws when scope path not configured", async () => {
    const orm = await reconfigureOrm({
      connection: { url: "sqlite://:memory:" },
      migrations: { landlord: MIGRATIONS_DIR },
    });
    expect(orm.migrate("tenant")).rejects.toThrow(/tenant/);
  });

  test("overrides pass through to Migrator", async () => {
    const orm = await reconfigureOrm({
      connection: { url: "sqlite://:memory:" },
      migrationsPath: MIGRATIONS_DIR,
    });

    const migrator = orm.migrator("landlord", { lock: false });
    expect(migrator).toBeDefined();
    await migrator.run();
  });

  test("createIfMissing is a no-op for SQLite (no error)", async () => {
    const orm = await reconfigureOrm({
      connection: { url: "sqlite://:memory:" },
      migrations: {
        landlord: MIGRATIONS_DIR,
        createIfMissing: { database: true, schema: true },
      },
    });

    await orm.migrate();
    expect(await Schema.hasTable("bcf_widgets")).toBe(true);
  });

  test("createIfMissing creates SQLite file on disk if missing", async () => {
    const dbPath = join(process.cwd(), "tests", `temp_bcf_${Date.now()}.sqlite`);

    const orm = await reconfigureOrm({
      connection: { url: `sqlite://${dbPath}` },
      migrations: {
        landlord: MIGRATIONS_DIR,
        createIfMissing: true,
      },
    });

    try {
      await orm.migrate();
      expect(await Schema.hasTable("bcf_widgets")).toBe(true);
      const file = Bun.file(dbPath);
      expect(await file.exists()).toBe(true);
    } finally {
      await orm.connection.close();
      await cleanupSqliteFile(dbPath);
    }
  });
});
