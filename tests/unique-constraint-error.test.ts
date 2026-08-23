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
