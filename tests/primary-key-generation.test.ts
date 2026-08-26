import { beforeAll, describe, expect, test } from "bun:test";
import { Model, Schema } from "../src/index.js";
import { shouldGeneratePrimaryKeyForColumn } from "../src/utils.js";
import { setupTestDb } from "./helpers.js";

class DefaultedKey extends Model {
  static table = "defaulted_keys";
  static primaryKey = "id";
  static incrementing = false;
  static keyType = "string";
  static fillable = ["name"];
  static timestamps = false;
}

class RoundTripKey extends Model {
  static table = "roundtrip_keys";
  static primaryKey = "id";
  static incrementing = false;
  static keyType = "string";
  static fillable = ["name"];
  static timestamps = false;
}

class BigIntDefaultKey extends Model {
  static table = "bigint_default_keys";
  static primaryKey = "id";
  static incrementing = false;
  static fillable = ["name"];
  static timestamps = false;
}

class BulkDefaultKey extends Model {
  static table = "bulk_default_keys";
  static primaryKey = "id";
  static incrementing = false;
  static keyType = "string";
  static fillable = ["name"];
  static timestamps = false;
}

class WithoutRowidKey extends Model {
  static table = "without_rowid_keys";
  static primaryKey = "id";
  static incrementing = false;
  static keyType = "string";
  static fillable = ["name"];
  static timestamps = false;
}

class UlidKey extends Model {
  static table = "ulid_keys";
  static primaryKey = "id";
  static incrementing = false;
  static keyType = "string";
  static fillable = ["id", "name"];
  static timestamps = false;
}

class ApplicationGeneratedKey extends Model {
  static table = "application_generated_keys";
  static primaryKey = "id";
  static incrementing = false;
  static keyType = "string";
  static fillable = ["name"];
  static timestamps = false;

  static override async shouldAutoGeneratePrimaryKey(): Promise<boolean> {
    return true;
  }
}

const pkColumn = (over: Record<string, any> = {}) => ({
  type: "text",
  primary: true,
  autoIncrement: false,
  ...over,
});

describe("Primary key auto-generation", () => {
  beforeAll(async () => {
    const connection = setupTestDb();
    await connection.run(
      "CREATE TABLE defaulted_keys (id TEXT PRIMARY KEY DEFAULT 'fixed-id', name TEXT)"
    );
    await connection.run(
      "CREATE TABLE roundtrip_keys (id TEXT PRIMARY KEY DEFAULT 'assigned-id', name TEXT)"
    );
    await connection.run(
      "CREATE TABLE bigint_default_keys (id BIGINT PRIMARY KEY DEFAULT 42, name TEXT)"
    );
    await connection.run(
      "CREATE TABLE bulk_default_keys (id TEXT PRIMARY KEY DEFAULT 'bulk-id', name TEXT)"
    );
    await connection.run(
      "CREATE TABLE without_rowid_keys (id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))), name TEXT) WITHOUT ROWID"
    );
    await connection.run("CREATE TABLE ulid_keys (id CHAR(26) PRIMARY KEY, name TEXT)");
    await connection.run("CREATE TABLE application_generated_keys (id CHAR(26) PRIMARY KEY, name TEXT)");
  });

  test("generates for key columns that can hold a UUID and have no default", () => {
    expect(shouldGeneratePrimaryKeyForColumn(pkColumn())).toBe(true);
    expect(shouldGeneratePrimaryKeyForColumn(pkColumn({ type: "uuid" }))).toBe(true);
    expect(shouldGeneratePrimaryKeyForColumn(pkColumn({ type: "char(36)" }))).toBe(true);
    expect(shouldGeneratePrimaryKeyForColumn(pkColumn({ type: "varchar(255)" }))).toBe(true);
  });

  test("leaves the value to the database when the column has a default", () => {
    expect(shouldGeneratePrimaryKeyForColumn(pkColumn({ default: "fixed-id" }))).toBe(false);
    expect(shouldGeneratePrimaryKeyForColumn(pkColumn({ default: "gen_random_uuid()" }))).toBe(false);
    // No default at all still generates.
    expect(shouldGeneratePrimaryKeyForColumn(pkColumn({ default: null }))).toBe(true);
  });

  test("refuses columns too short to hold a UUID", () => {
    expect(shouldGeneratePrimaryKeyForColumn(pkColumn({ type: "char(26)" }))).toBe(false);
    expect(shouldGeneratePrimaryKeyForColumn(pkColumn({ type: "varchar(20)" }))).toBe(false);
    expect(shouldGeneratePrimaryKeyForColumn(pkColumn({ type: "character", length: 26 }))).toBe(false);
    expect(shouldGeneratePrimaryKeyForColumn(pkColumn({ type: "character", length: 36 }))).toBe(true);
  });

  test("never generates for numeric or auto-incrementing keys", () => {
    expect(shouldGeneratePrimaryKeyForColumn(pkColumn({ type: "integer" }))).toBe(false);
    expect(shouldGeneratePrimaryKeyForColumn(pkColumn({ type: "bigint" }))).toBe(false);
    expect(shouldGeneratePrimaryKeyForColumn(pkColumn({ autoIncrement: true }))).toBe(false);
    expect(shouldGeneratePrimaryKeyForColumn(pkColumn({ primary: false }))).toBe(false);
  });

  test("a TEXT key with a database default keeps the default, not a random UUID", async () => {
    expect(await (DefaultedKey as any).shouldAutoGeneratePrimaryKey()).toBe(false);

    const created = await DefaultedKey.create({ name: "uses the default" } as any);

    const rows = await Schema.getConnection().query("SELECT id FROM defaulted_keys");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("fixed-id");

    // The model has to carry what the database stored, not the rowid.
    expect((created as any).id).toBe("fixed-id");
  });

  test("a database-assigned key survives a round trip through update", async () => {
    const created = await RoundTripKey.create({ name: "first" } as any);
    expect((created as any).id).toBe("assigned-id");

    (created as any).name = "second";
    await created.save();

    const rows = await Schema.getConnection().query(
      "SELECT id, name FROM roundtrip_keys WHERE id = 'assigned-id'"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("second");

    const reloaded = await RoundTripKey.find("assigned-id");
    expect((reloaded as any)?.name).toBe("second");
  });

  test("refuses to update a record with no primary key value", async () => {
    const orphan = new RoundTripKey({ name: "no key" } as any);
    (orphan as any).$exists = true;
    (orphan as any).name = "changed";

    await expect(orphan.save()).rejects.toThrow(/carries no "id" value/);
  });

  test("a numeric key with a default is read back, not taken from the rowid", async () => {
    // In SQLite only "INTEGER PRIMARY KEY" aliases the rowid; BIGINT does not,
    // so the last-insert id has nothing to do with this row's key.
    const created = await BigIntDefaultKey.create({ name: "answer" } as any);

    const rows = await Schema.getConnection().query("SELECT id FROM bigint_default_keys");
    expect(Number(rows[0]?.id)).toBe(42);
    expect(Number((created as any).id)).toBe(42);
  });

  test("saveMany without events resolves the key the same way", async () => {
    const model = new BulkDefaultKey({ name: "bulk" } as any);
    await (BulkDefaultKey as any).saveMany([model], { events: false });

    const rows = await Schema.getConnection().query("SELECT id, name FROM bulk_default_keys");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("bulk-id");
    expect((model as any).id).toBe("bulk-id");
  });

  test("reads a generated key from a SQLite WITHOUT ROWID table", async () => {
    const created = await WithoutRowidKey.create({ name: "returned" } as any);

    expect((created as any).id).toMatch(/^[0-9a-f]{32}$/);
    const rows = await Schema.getConnection().query("SELECT id FROM without_rowid_keys");
    expect(rows[0]?.id).toBe((created as any).id);
  });

  test("a CHAR(26) key is left to the application instead of overflowed", async () => {
    expect(await (UlidKey as any).shouldAutoGeneratePrimaryKey()).toBe(false);

    await UlidKey.create({ id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", name: "ulid" } as any);

    const rows = await Schema.getConnection().query("SELECT id FROM ulid_keys");
    expect(rows[0]?.id).toBe("01ARZ3NDEKTSV4RRFFQ69G5FAV");
  });

  test("an explicit uuid keyType still opts in regardless of the column", async () => {
    class ForcedUuid extends DefaultedKey {
      static override table = "defaulted_keys";
      static override keyType = "uuid";
    }
    expect(await (ForcedUuid as any).shouldAutoGeneratePrimaryKey()).toBe(true);
  });

  test("bulk inserts respect an application override of primary-key generation", async () => {
    await ApplicationGeneratedKey.insert({ name: "generated by override" });
    const rows = await Schema.getConnection().query("SELECT id FROM application_generated_keys");
    expect(rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
