import { expect, test, describe, beforeAll } from "bun:test";
import { Connection, Model, Schema, IdentityMap, ObserverRegistry } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

class User extends Model {
  static table = "users";
  static fillable = ["name", "counter"];
}

class SoftUser extends Model {
  static table = "identity_soft_users";
  static fillable = ["name"];
  static softDeletes = true;
}

describe("Identity Map", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("users", (table) => {
      table.increments("id");
      table.string("name");
      table.integer("counter").default(0);
      table.timestamps();
    });
    await Schema.create("identity_soft_users", (table) => {
      table.increments("id");
      table.string("name");
      table.timestamps();
      table.softDeletes();
    });
  });

  test("find returns same instance within identity map context", async () => {
    await IdentityMap.run(async () => {
      const user = await User.create({ name: "Alice" });
      const found = await User.find(user.id);

      expect(found).toBe(user); // Same object reference
    });
  });

  test("find returns different instances outside identity map context", async () => {
    const user = await User.create({ name: "Bob" });
    const found1 = await User.find(user.id);
    const found2 = await User.find(user.id);

    expect(found1).not.toBe(found2); // Different object references
    expect(found1!.id).toBe(found2!.id);
  });

  test("multiple queries return cached instances", async () => {
    await IdentityMap.run(async () => {
      const user = await User.create({ name: "Charlie" });

      const a = await User.find(user.id);
      const b = await User.query().where("id", user.id).first();
      const c = await User.query().where("name", "Charlie").first();

      expect(a).toBe(user);
      expect(b).toBe(user);
      expect(c).toBe(user);
    });
  });

  test("created models are registered in identity map", async () => {
    await IdentityMap.run(async () => {
      const user = await User.create({ name: "Dave" });
      const cached = IdentityMap.get("users", user.id);

      expect(cached).toBe(user);
    });
  });

  test("saved models are registered in identity map", async () => {
    await IdentityMap.run(async () => {
      const user = new User({ name: "Eve" });
      await user.save();
      const cached = IdentityMap.get("users", user.id);

      expect(cached).toBe(user);
    });
  });

  test("identity map does not leak across contexts", async () => {
    let userId: number;

    await IdentityMap.run(async () => {
      const user = await User.create({ name: "Frank" });
      userId = user.id;
    });

    // Outside the context, identity map is empty
    const cached = IdentityMap.get("users", userId!);
    expect(cached).toBeUndefined();

    const found = await User.find(userId!);
    expect(found).toBeDefined();
  });

  test("identity map survives within same async context", async () => {
    await IdentityMap.run(async () => {
      const user = await User.create({ name: "Grace" });

      // Simulate multiple operations in same request
      const found1 = await User.find(user.id);
      const found2 = await User.find(user.id);
      const found3 = await User.find(user.id);

      expect(found1).toBe(user);
      expect(found2).toBe(user);
      expect(found3).toBe(user);
    });
  });

  test("bulk get() registers all rows in identity map", async () => {
    await IdentityMap.run(async () => {
      const hank = await User.create({ name: "Hank" });
      const ivy = await User.create({ name: "Ivy" });

      const users = await User.query().whereIn("id", [hank.id, ivy.id]).get();
      expect(users).toHaveLength(2);

      for (const user of users) {
        const cached = IdentityMap.get("users", user.id);
        expect(cached).toBe(user);
      }
    });
  });

  test("mutations on cached instance are visible to subsequent finds", async () => {
    await IdentityMap.run(async () => {
      const user = await User.create({ name: "Jack" });

      user.name = "Jackson";

      const found = await User.find(user.id);
      expect(found!.name).toBe("Jackson");
    });
  });

  test("fresh returns a different instance inside an identity map", async () => {
    await IdentityMap.run(async () => {
      const user = await User.create({ name: "Fresh cached" });
      await User.where("id", user.id).update({ name: "Fresh database" });

      const fresh = await user.fresh();

      expect(fresh).not.toBe(user);
      expect(fresh!.name).toBe("Fresh database");
      expect(user.name).toBe("Fresh cached");
      expect(await User.find(user.id)).toBe(user);
    });
  });

  test("builder updates and increments evict stale identity map entries", async () => {
    await IdentityMap.run(async () => {
      const user = await User.create({ name: "Cached write", counter: 0 });

      await User.where("id", user.id).update({ name: "Updated write" });
      const updated = await User.find(user.id);
      expect(updated).not.toBe(user);
      expect(updated!.name).toBe("Updated write");

      await User.where("id", user.id).increment("counter", 3);
      const incremented = await User.find(user.id);
      expect(incremented).not.toBe(updated);
      expect(incremented!.counter).toBe(3);

      await User.where("id", user.id).decrement("counter");
      const decremented = await User.find(user.id);
      expect(decremented).not.toBe(incremented);
      expect(decremented!.counter).toBe(2);
    });
  });

  test("upsert clears cached rows for its model table", async () => {
    await IdentityMap.run(async () => {
      const user = await User.create({ name: "Cached upsert", counter: 0 });

      await User.query().upsert({
        id: user.id,
        name: "Updated upsert",
        counter: 0,
        created_at: user.created_at,
        updated_at: user.updated_at,
      }, "id", ["name"]);

      const updated = await User.find(user.id);
      expect(updated).not.toBe(user);
      expect(updated!.name).toBe("Updated upsert");
    });
  });

  test("limited builder updates affect and evict only selected rows", async () => {
    await IdentityMap.run(async () => {
      const first = await User.create({ name: "Limited update first" });
      const second = await User.create({ name: "Limited update second" });

      await User.whereIn("id", [first.id, second.id]).orderBy("id").limit(1).update({ name: "Limited updated" });

      const reloadedFirst = await User.find(first.id);
      const reloadedSecond = await User.find(second.id);
      expect(reloadedFirst).not.toBe(first);
      expect(reloadedFirst!.name).toBe("Limited updated");
      expect(reloadedSecond).toBe(second);
      expect(reloadedSecond!.name).toBe("Limited update second");
    });
  });

  test("builder soft deletes evict affected identity map entries", async () => {
    await IdentityMap.run(async () => {
      const user = await SoftUser.create({ name: "Soft cached" });

      await SoftUser.where("id", user.id).delete();

      expect(IdentityMap.get("identity_soft_users", user.id)).toBeUndefined();
      const deleted = await SoftUser.withTrashed().find(user.id);
      expect(deleted).not.toBe(user);
      expect(deleted?.trashed()).toBe(true);
    });
  });

  test("separates identical table keys across connections", async () => {
    const first = new Connection({ url: "sqlite://:memory:" });
    const second = new Connection({ url: "sqlite://:memory:" });

    try {
      await first.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
      await second.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
      await first.run("INSERT INTO users (id, name) VALUES (1, 'First database')");
      await second.run("INSERT INTO users (id, name) VALUES (1, 'Second database')");

      await IdentityMap.run(async () => {
        const firstUser = await User.on(first).find(1);
        const secondUser = await User.on(second).find(1);

        expect(firstUser).not.toBe(secondUser);
        expect(firstUser?.name).toBe("First database");
        expect(secondUser?.name).toBe("Second database");
      });
    } finally {
      await first.close();
      await second.close();
    }
  });

  test("builder update observers use the builder connection", async () => {
    const landlord = await User.create({ name: "Landlord row" });
    const tenant = new Connection({ url: "sqlite://:memory:" });
    let observed: User | undefined;

    try {
      await tenant.run("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
      await tenant.run(`INSERT INTO users (id, name) VALUES (${landlord.id}, 'Tenant row')`);
      ObserverRegistry.register(User, {
        updated(model) { observed = model; },
      });

      await User.on(tenant).where("id", landlord.id).update({ name: "Tenant updated" });

      expect(observed?.name).toBe("Tenant updated");
      expect(observed?.getConnection()).toBe(tenant);
      expect((await User.find(landlord.id))?.name).toBe("Landlord row");
    } finally {
      ObserverRegistry.unregister(User);
      await tenant.close();
    }
  });
});
