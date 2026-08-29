import { SQL } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  Builder,
  Connection,
  Model,
  Schema,
  UniqueConstraintViolationError,
} from "../src/index.js";

interface UniqueRecordAttributes {
  id: number;
  email: string;
  required_value: string;
  internal: string | null;
}

class UniqueRecord extends Model.define<UniqueRecordAttributes>("unique_error_records") {
  static override fillable = ["email", "required_value"];
  static override timestamps = false;
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected promise to reject");
}

function expectWrappedSqliteUnique(error: unknown): asserts error is UniqueConstraintViolationError {
  expect(error).toBeInstanceOf(UniqueConstraintViolationError);
  expect((error as Error).name).toBe("UniqueConstraintViolationError");
  expect((error as Error).message).toBe("A unique constraint was violated.");
  expect((error as Error).cause).toBeInstanceOf(SQL.SQLiteError);
  expect(["SQLITE_CONSTRAINT_UNIQUE", "SQLITE_CONSTRAINT_PRIMARYKEY"])
    .toContain(((error as Error).cause as SQL.SQLiteError).code);
  expect(error).not.toHaveProperty("sql");
  expect(error).not.toHaveProperty("bindings");
  expect(error).not.toHaveProperty("constraint");
}

describe.serial("UniqueConstraintViolationError on SQLite", () => {
  const connection = new Connection({ url: "sqlite://:memory:" });

  beforeAll(async () => {
    await Schema.create("unique_error_records", (table) => {
      table.increments("id");
      table.string("email").unique();
      table.string("required_value");
      table.string("internal").nullable();
    }, connection);
    await connection.run(
      "CREATE TABLE checked_unique_errors (id INTEGER PRIMARY KEY, state TEXT NOT NULL CHECK (state IN ('ready', 'done')))"
    );
    await Schema.create("unique_error_parents", (table) => {
      table.increments("id");
    }, connection);
    await Schema.create("unique_error_children", (table) => {
      table.increments("id");
      table.integer("parent_id").unsigned();
      table.foreign("parent_id").references("id").on("unique_error_parents");
    }, connection);
  });

  afterAll(async () => {
    await connection.close();
  });

  test("normalizes duplicate unique columns, primary keys, model creation, and updates", async () => {
    const first = await UniqueRecord.on(connection).forceCreate({
      email: "first@example.test",
      required_value: "first",
      internal: "trusted",
    });
    expect(first.getAttribute("internal")).toBe("trusted");

    expectWrappedSqliteUnique(await caught(new Builder(connection, "unique_error_records").insert({
      email: "first@example.test",
      required_value: "duplicate",
    })));
    expectWrappedSqliteUnique(await caught(UniqueRecord.on(connection).forceCreate({
      email: "first@example.test",
      required_value: "model duplicate",
    })));
    expectWrappedSqliteUnique(await caught(new Builder(connection, "unique_error_records").insert({
      id: first.getAttribute("id"),
      email: "primary@example.test",
      required_value: "duplicate primary",
    })));

    const second = await UniqueRecord.on(connection).create({
      email: "second@example.test",
      required_value: "second",
    });
    expectWrappedSqliteUnique(await caught(
      UniqueRecord.on(connection).where("id", second.getAttribute("id")).update({ email: "first@example.test" })
    ));
  });

  test("createOrFirst inserts first and returns the existing row after a UNIQUE conflict", async () => {
    const { statements } = await connection.pretend(() => UniqueRecord.on(connection).createOrFirst(
      { email: "pretend-create-or-first@example.test" },
      { required_value: "pretend" },
    ));
    expect(statements.some(({ sql }) => /^insert\s+into\s+/i.test(sql))).toBe(true);
    expect(statements.some(({ sql }) => /select\b.*\bfrom\s+["`]?unique_error_records["`]?.*\bwhere\b/is.test(sql))).toBe(false);

    const created = await UniqueRecord.on(connection).createOrFirst(
      { email: "create-or-first@example.test" },
      { required_value: "created" },
    );
    const existing = await UniqueRecord.on(connection).createOrFirst(
      { email: "create-or-first@example.test" },
      { required_value: "must not overwrite" },
    );

    expect(created.$wasRecentlyCreated).toBe(true);
    expect(existing.$wasRecentlyCreated).toBe(false);
    expect(existing.getAttribute("id")).toBe(created.getAttribute("id"));
    expect(existing.getAttribute("required_value")).toBe("created");
    expect(await UniqueRecord.on(connection).where("email", "create-or-first@example.test").count()).toBe(1);
  });

  test("createOrFirst rethrows conflicts that its attributes do not identify", async () => {
    await UniqueRecord.on(connection).createOrFirst(
      { email: "other-unique-key@example.test" },
      { required_value: "original" },
    );

    const unrelatedConflict = await caught(UniqueRecord.on(connection).createOrFirst(
      { required_value: "different lookup" },
      { email: "other-unique-key@example.test" },
    ));
    expectWrappedSqliteUnique(unrelatedConflict);

    const constrainedFallback = await caught(
      UniqueRecord.on(connection)
        .where("required_value", "excluded by builder constraint")
        .createOrFirst(
          { email: "other-unique-key@example.test" },
          { required_value: "attempted" },
        )
    );
    expectWrappedSqliteUnique(constrainedFallback);
  });

  test("createOrFirst only catches UNIQUE violations", async () => {
    const notNull = await caught(UniqueRecord.on(connection).createOrFirst({
      email: "create-or-first-not-null@example.test",
    }));
    expect(notNull).toBeInstanceOf(SQL.SQLiteError);
    expect(notNull).not.toBeInstanceOf(UniqueConstraintViolationError);
    expect((notNull as SQL.SQLiteError).code).toBe("SQLITE_CONSTRAINT_NOTNULL");
  });

  test("createOrFirst contains a failed insert in a savepoint", async () => {
    await connection.transaction(async (transaction) => {
      const existing = await UniqueRecord.on(transaction).createOrFirst(
        { email: "create-or-first@example.test" },
        { required_value: "must not overwrite" },
      );
      expect(existing.getAttribute("required_value")).toBe("created");

      await UniqueRecord.on(transaction).createOrFirst(
        { email: "after-savepoint@example.test" },
        { required_value: "transaction remains usable" },
      );
    });

    expect(await UniqueRecord.on(connection).where("email", "after-savepoint@example.test").count()).toBe(1);
  });

  test("concurrent create helpers converge on one row", async () => {
    const direct = await Promise.all(Array.from({ length: 12 }, () =>
      UniqueRecord.on(connection).createOrFirst(
        { email: "concurrent-create-or-first@example.test" },
        { required_value: "winner" },
      )
    ));
    expect(new Set(direct.map((record) => record.getAttribute("id"))).size).toBe(1);
    expect(await UniqueRecord.on(connection).where("email", "concurrent-create-or-first@example.test").count()).toBe(1);

    const selected = await Promise.all(Array.from({ length: 12 }, () =>
      UniqueRecord.on(connection).firstOrCreate(
        { email: "concurrent-first-or-create@example.test" },
        { required_value: "winner" },
      )
    ));
    expect(new Set(selected.map((record) => record.getAttribute("id"))).size).toBe(1);
    expect(await UniqueRecord.on(connection).where("email", "concurrent-first-or-create@example.test").count()).toBe(1);
  });

  test("updateOrCreate delegates creation safely and updates only existing rows", async () => {
    const created = await UniqueRecord.on(connection).updateOrCreate(
      { email: "update-or-create@example.test" },
      { required_value: "created once" },
    );
    expect(created.$wasRecentlyCreated).toBe(true);

    const updated = await UniqueRecord.on(connection).updateOrCreate(
      { email: "update-or-create@example.test" },
      { required_value: "updated" },
    );
    expect(updated.$wasRecentlyCreated).toBe(false);
    expect(updated.getAttribute("id")).toBe(created.getAttribute("id"));
    expect(updated.getAttribute("required_value")).toBe("updated");
    expect(await UniqueRecord.on(connection).where("email", "update-or-create@example.test").count()).toBe(1);
  });

  test("updateOrCreate updates a freshly cached identity-map instance", async () => {
    await UniqueRecord.useIdentityMap(async () => {
      const created = await UniqueRecord.on(connection).createOrFirst(
        { email: "identity-update-or-create@example.test" },
        { required_value: "created" },
      );
      expect(created.$wasRecentlyCreated).toBe(true);

      const updated = await UniqueRecord.on(connection).updateOrCreate(
        { email: "identity-update-or-create@example.test" },
        { required_value: "updated despite cached creation state" },
      );
      expect(updated).toBe(created);
      expect(updated.$wasRecentlyCreated).toBe(false);
      expect(updated.getAttribute("required_value")).toBe("updated despite cached creation state");
    });
  });

  test("createOrFirst requires a model-backed builder", async () => {
    await expect(new Builder(connection, "unique_error_records").createOrFirst({
      email: "raw-builder@example.test",
    })).rejects.toThrow("createOrFirst requires a model to be set on the builder");
  });

  test("keeps insertOrIgnore behavior and non-unique constraint errors unchanged", async () => {
    const before = await new Builder(connection, "unique_error_records").count();
    await new Builder(connection, "unique_error_records").insertOrIgnore({
      email: "first@example.test",
      required_value: "ignored",
    });
    expect(await new Builder(connection, "unique_error_records").count()).toBe(before);

    const notNull = await caught(new Builder(connection, "unique_error_records").insert({
      email: "missing-required@example.test",
    }));
    expect(notNull).toBeInstanceOf(SQL.SQLiteError);
    expect(notNull).not.toBeInstanceOf(UniqueConstraintViolationError);
    expect((notNull as SQL.SQLiteError).code).toBe("SQLITE_CONSTRAINT_NOTNULL");

    const check = await caught(new Builder(connection, "checked_unique_errors").insert({ id: 1, state: "invalid" }));
    expect(check).toBeInstanceOf(SQL.SQLiteError);
    expect(check).not.toBeInstanceOf(UniqueConstraintViolationError);
    expect((check as SQL.SQLiteError).code).toBe("SQLITE_CONSTRAINT_CHECK");

    const foreignKey = await caught(new Builder(connection, "unique_error_children").insert({ parent_id: 999 }));
    expect(foreignKey).toBeInstanceOf(SQL.SQLiteError);
    expect(foreignKey).not.toBeInstanceOf(UniqueConstraintViolationError);
    expect((foreignKey as SQL.SQLiteError).code).toBe("SQLITE_CONSTRAINT_FOREIGNKEY");
  });

  test("preserves the exact driver error as a non-enumerable cause", async () => {
    const original = new SQL.SQLiteError("private driver detail", {
      code: "SQLITE_CONSTRAINT_UNIQUE",
      errno: 2067,
    });
    const driver = { unsafe: async () => { throw original; } } as unknown as SQL;
    const fake = new Connection(
      { url: "sqlite://:memory:" },
      { driver, ownsDriver: false, sqliteDefaultsApplied: true },
    );

    const error = await caught(fake.run("INSERT INTO hidden VALUES (?)", ["secret"]));
    expectWrappedSqliteUnique(error);
    expect((error as Error).cause).toBe(original);
    expect(Object.prototype.propertyIsEnumerable.call(error, "cause")).toBe(false);
    expect(JSON.stringify(error)).not.toContain("private driver detail");
  });

  test("propagates the normalized error and rolls the transaction back", async () => {
    const error = await caught(connection.transaction(async (transaction) => {
      await new Builder(transaction, "unique_error_records").insert({
        email: "rolled-back@example.test",
        required_value: "temporary",
      });
      await new Builder(transaction, "unique_error_records").insert({
        email: "first@example.test",
        required_value: "duplicate",
      });
    }));

    expectWrappedSqliteUnique(error);
    expect(await UniqueRecord.on(connection).where("email", "rolled-back@example.test").count()).toBe(0);
  });
});
