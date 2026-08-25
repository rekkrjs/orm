import { expect, test, describe, beforeEach } from "bun:test";
import { Builder, DB, Model, Schema, TransactionContext } from "../src/index.js";
import { PermissiveModel, setupTestDb } from "./helpers.js";

class User extends PermissiveModel {
  static override table = "users";
}

class Post extends PermissiveModel {
  static override table = "posts";
}

async function setupTables() {
  const connection = setupTestDb();
  await Schema.create("users", (t) => {
    t.increments("id");
    t.string("name");
    t.timestamps();
  });
  await Schema.create("posts", (t) => {
    t.increments("id");
    t.string("title");
    t.integer("user_id");
    t.timestamps();
  });
  return connection;
}

describe("TransactionContext", () => {
  test("Model.create() inside DB.transaction() uses trx automatically", async () => {
    await setupTables();

    await DB.transaction(async () => {
      await User.create({ name: "Alice" });
      await Post.create({ title: "Hello", user_id: 1 });
    });

    expect(await User.count()).toBe(1);
    expect(await Post.count()).toBe(1);
  });

  test("rollback reverts all models created without explicit trx", async () => {
    await setupTables();

    await expect(
      DB.transaction(async () => {
        await User.create({ name: "Bob" });
        await Post.create({ title: "Rolled back", user_id: 1 });
        throw new Error("abort");
      })
    ).rejects.toThrow("abort");

    expect(await User.count()).toBe(0);
    expect(await Post.count()).toBe(0);
  });

  test("DB.table() inside transaction uses trx automatically", async () => {
    await setupTables();

    await DB.transaction(async () => {
      await DB.table("users").insert({ name: "Carol" });
      await DB.table("posts").insert({ title: "Via DB.table", user_id: 1 });
    });

    expect(await User.count()).toBe(1);
    expect(await Post.count()).toBe(1);
  });

  test("DB.table() rollback reverts inserts", async () => {
    await setupTables();

    await expect(
      DB.transaction(async () => {
        await DB.table("users").insert({ name: "Dave" });
        throw new Error("abort");
      })
    ).rejects.toThrow("abort");

    expect(await User.count()).toBe(0);
  });

  test("queries outside transaction are unaffected", async () => {
    await setupTables();

    await User.create({ name: "Outside" });

    await expect(
      DB.transaction(async () => {
        await User.create({ name: "Inside" });
        throw new Error("abort");
      })
    ).rejects.toThrow("abort");

    const users = await User.all();
    expect(users).toHaveLength(1);
    expect(users[0].name).toBe("Outside");
  });

  test("connection.transaction() installs the ambient context", async () => {
    const connection = await setupTables();

    await connection.transaction(async (trx) => {
      expect(TransactionContext.current()).toBe(trx);
      expect((User as any).getConnection()).toBe(trx);
      expect(Schema.getConnection()).toBe(trx);
    });

    expect(TransactionContext.current()).toBeUndefined();
  });

  test("unbound Model.create() inside connection.transaction() joins the transaction", async () => {
    const connection = await setupTables();

    await expect(
      connection.transaction(async () => {
        await User.create({ name: "Unbound" });
        throw new Error("abort");
      })
    ).rejects.toThrow("abort");

    expect(await User.count()).toBe(0);

    await connection.transaction(async () => {
      await User.create({ name: "Committed" });
    });

    expect(await User.count()).toBe(1);
  });

  test("a package holding the Connection can resolve the ambient transaction", async () => {
    const connection = await setupTables();

    // The shape @rekkr/cache and @rekkr/better-auth-adapter use: the package is
    // handed a Connection and never sees the caller's transaction handle.
    class HeldConnectionAdapter {
      constructor(private readonly connection: import("../src/index.js").Connection) {}
      private resolve() {
        return TransactionContext.current() ?? this.connection;
      }
      write(name: string) {
        return new Builder(this.resolve(), "users").insert({ name });
      }
    }

    const adapter = new HeldConnectionAdapter(connection);

    await expect(
      DB.transaction(async () => {
        await adapter.write("from-adapter");
        throw new Error("abort");
      })
    ).rejects.toThrow("abort");

    expect(await User.count()).toBe(0);
  });

  test("nested connection.transaction() savepoints keep the ambient context", async () => {
    const connection = await setupTables();

    await connection.transaction(async (trx) => {
      await User.create({ name: "Outer" });

      await expect(
        trx.transaction(async (inner) => {
          expect(TransactionContext.current()).toBe(inner);
          await User.create({ name: "Inner" });
          throw new Error("inner abort");
        })
      ).rejects.toThrow("inner abort");

      expect(TransactionContext.current()).toBe(trx);
    });

    const users = await User.all();
    expect(users).toHaveLength(1);
    expect(users[0].name).toBe("Outer");
  });

  test("nested transactions use savepoints", async () => {
    await setupTables();

    await DB.transaction(async () => {
      await User.create({ name: "Outer" });

      await expect(
        DB.transaction(async () => {
          await User.create({ name: "Inner" });
          throw new Error("inner abort");
        })
      ).rejects.toThrow("inner abort");
    });

    const users = await User.all();
    expect(users).toHaveLength(1);
    expect(users[0].name).toBe("Outer");
  });
});
