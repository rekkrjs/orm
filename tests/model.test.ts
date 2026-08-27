import { expect, test, describe, beforeAll } from "bun:test";
import { Model, ModelNotFoundError, Schema, type Connection } from "../src/index.js";
import { PermissiveModel, setupTestDb } from "./helpers.js";

function expectType<T>(_value: T): void {}

class TestUser extends PermissiveModel {
  static table = "test_users";
}

class DefaultUser extends PermissiveModel {
  static table = "default_users";
  static casts = {
    active: "boolean",
  };
  static attributes = {
    name: "Guest",
    active: true,
    role: "member",
  };
}

class UuidUser extends PermissiveModel {
  static table = "uuid_users";
}

class SerializedUser extends PermissiveModel {
  static timestamps = false;
  static hidden = ["secret"];
  static casts = { active: "boolean" };
  static accessors = {
    name: {
      get: (value: unknown) => String(value).toUpperCase(),
    },
  };
}

class VisibleUser extends PermissiveModel {
  static timestamps = false;
  static visible = ["name"];
}

class HiddenVisibleUser extends PermissiveModel {
  static timestamps = false;
  static hidden = ["secret"];
  static visible = ["name", "secret"];
}

class InstanceHiddenUser extends PermissiveModel {
  static timestamps = false;
  static visible = ["name", "secret"];
}

class OverrideHydrationUser extends TestUser {
  static hydrateCalls = 0;

  static override hydrate(row: Record<string, any>, connection?: Connection): OverrideHydrationUser {
    this.hydrateCalls++;
    return super.hydrate({ ...row, hydrated_by_override: true }, connection) as OverrideHydrationUser;
  }
}

describe("Model", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("test_users", (table) => {
      table.increments("id");
      table.string("name");
      table.string("email").nullable();
      table.timestamps();
    });
    await Schema.create("default_users", (table) => {
      table.increments("id");
      table.string("name");
      table.boolean("active");
      table.string("role");
      table.timestamps();
    });
    await Schema.create("uuid_users", (table) => {
      table.uuid("id").primary();
      table.string("name");
      table.timestamps();
    });
  });

  test("create returns model instance", async () => {
    const user = await TestUser.create({ name: "Alice", email: "a@example.com" });
    expect(user).toBeInstanceOf(TestUser);
    expect(user.getAttribute("name")).toBe("Alice");
    expect(user.$exists).toBe(true);
    expect(user.getAttribute("id")).toBeDefined();
  });

  test("pluck reads one column from the model", async () => {
    const pluckUser = await TestUser.create({ name: "Pluck One", email: "pluck-one@example.com" });

    const emails = await TestUser.where("id", pluckUser.getAttribute("id")).pluck("email");
    expect(emails).toEqual(["pluck-one@example.com"]);
  });

  test("pluck keyed by a column returns a map", async () => {
    const first = await TestUser.create({ name: "Pluck Keyed A", email: "keyed-a@example.com" });
    const second = await TestUser.create({ name: "Pluck Keyed B", email: "keyed-b@example.com" });

    const byId = await TestUser.whereIn("id", [first.getAttribute("id"), second.getAttribute("id")])
      .pluck("email", "id");

    expect(byId).toEqual({
      [first.getAttribute("id")]: "keyed-a@example.com",
      [second.getAttribute("id")]: "keyed-b@example.com",
    });
  });

  test("pluck works straight off the model, with and without a key", async () => {
    const emails = await TestUser.pluck("email");
    expect(Array.isArray(emails)).toBe(true);

    const byId = await TestUser.pluck("email", "id");
    expect(Array.isArray(byId)).toBe(false);
    expect(Object.keys(byId).length).toBe(emails.length);
  });

  test("find retrieves existing model", async () => {
    const created = await TestUser.create({ name: "Bob" });
    const found = await TestUser.find(created.getAttribute("id"));
    expect(found).not.toBeNull();
    expect(found!.getAttribute("name")).toBe("Bob");
    expect(found!.$exists).toBe(true);
  });

  test("find returns null for missing id", async () => {
    const found = await TestUser.find(99999);
    expect(found).toBeNull();
  });

  test("save updates existing model", async () => {
    const user = await TestUser.create({ name: "Carl" });
    user.setAttribute("name", "Carl Updated");
    await user.save();
    const refreshed = await TestUser.find(user.getAttribute("id"));
    expect(refreshed!.getAttribute("name")).toBe("Carl Updated");
  });

  test("update fills and saves existing model", async () => {
    const user = await TestUser.create({ name: "Cora", email: "cora@example.com" });
    const result = await user.update({ name: "Cora Updated", email: "updated@example.com" });

    expect(result).toBe(user);
    expect(user.getAttribute("name")).toBe("Cora Updated");

    const refreshed = await TestUser.find(user.getAttribute("id"));
    expect(refreshed!.getAttribute("name")).toBe("Cora Updated");
    expect(refreshed!.getAttribute("email")).toBe("updated@example.com");
  });

  test("delete removes model", async () => {
    const user = await TestUser.create({ name: "Dan" });
    const id = user.getAttribute("id");
    await user.delete();
    expect(user.$exists).toBe(false);
    const found = await TestUser.find(id);
    expect(found).toBeNull();
  });

  test("fill populates attributes", () => {
    const user = new TestUser();
    user.fill({ name: "Eve", email: "eve@example.com" });
    expect(user.getAttribute("name")).toBe("Eve");
    expect(user.getAttribute("email")).toBe("eve@example.com");
  });

  test("getDirty tracks changed attributes", () => {
    const user = new TestUser({ name: "Frank" });
    expect(user.isDirty()).toBe(true);
    expect(user.isClean()).toBe(false);
    user.save = async () => user; // mock save to avoid db call
    user.$exists = true;
    user.$original = { ...user.$attributes };
    expect(user.isDirty()).toBe(false);
    expect(user.isClean()).toBe(true);
    user.setAttribute("name", "Frankie");
    expect(user.isDirty()).toBe(true);
    expect(user.isClean()).toBe(false);
    expect(user.getDirty()).toEqual({ name: "Frankie" });
  });

  test("fresh returns a new database instance without mutating the current one", async () => {
    const user = await TestUser.create({ name: "Fresh original" });
    await TestUser.where("id", user.getAttribute("id")).update({ name: "Fresh database" });
    user.setAttribute("name", "Fresh local");

    const fresh = await user.fresh();

    expect(fresh).toBeInstanceOf(TestUser);
    expect(fresh).not.toBe(user);
    expect(fresh!.getAttribute("name")).toBe("Fresh database");
    expect(user.getAttribute("name")).toBe("Fresh local");
    expect(await new TestUser().fresh()).toBeNull();
  });

  test("refresh throws when the persisted row no longer exists", async () => {
    const user = await TestUser.create({ name: "Refresh missing" });
    await TestUser.where("id", user.getAttribute("id")).forceDelete();

    await expect(user.refresh()).rejects.toBeInstanceOf(ModelNotFoundError);
  });

  test("model proxies preserve prototype properties", async () => {
    const user = await TestUser.create({ name: "Proxy prototype" });
    const hydrated = await TestUser.find(user.getAttribute("id"));

    expect(hydrated!.constructor).toBe(TestUser);
    expect(Object.getPrototypeOf(hydrated)).toBe(TestUser.prototype);
    expect(String(hydrated)).toBe(JSON.stringify(hydrated!.toJSON()));
  });

  test("sets timestamps on create", async () => {
    const user = await TestUser.create({ name: "Grace" });
    expect(user.getAttribute("created_at")).toBeDefined();
    expect(user.getAttribute("updated_at")).toBeDefined();
  });

  test("updates updated_at on save", async () => {
    const user = await TestUser.create({ name: "Hank" });
    const oldUpdated = user.getAttribute("updated_at");
    await new Promise((r) => setTimeout(r, 10));
    user.setAttribute("name", "Hank 2");
    await user.save();
    expect(user.getAttribute("updated_at")).not.toBe(oldUpdated);
  });

  test("toJSON returns plain object", async () => {
    const user = await TestUser.create({ name: "Ivy" });
    const json = user.toJSON();
    expect(json.name).toBe("Ivy");
    expect(json).not.toHaveProperty("$exists");
  });

  test("toJSON preserves visibility, casts, accessors, and relations", () => {
    const user = new SerializedUser({ name: "ivy", active: 1, secret: "hidden", plain: "value" });
    user.setRelation("profile", { toJSON: () => ({ role: "admin" }) });

    expect(user.toJSON()).toEqual({
      name: "IVY",
      active: true,
      plain: "value",
      profile: { role: "admin" },
    });

    expect(new VisibleUser({ name: "Visible", secret: "hidden" }).toJSON()).toEqual({
      name: "Visible",
    });

    const madeVisible = new SerializedUser({
      name: "visible",
      active: 1,
      secret: "shown",
      plain: "preserved",
    }).makeVisible("secret");
    madeVisible.setRelation("profile", { toJSON: () => ({ role: "admin" }) });
    expect(madeVisible.toJSON()).toEqual({
      name: "VISIBLE",
      active: true,
      secret: "shown",
      plain: "preserved",
      profile: { role: "admin" },
    });

    const hiddenVisible = new HiddenVisibleUser({ name: "Hidden wins", secret: "shown", extra: "filtered" });
    expect(hiddenVisible.toJSON()).toEqual({
      name: "Hidden wins",
    });
    expect(hiddenVisible.makeVisible("secret").toJSON()).toEqual({
      name: "Hidden wins",
      secret: "shown",
    });

    const instanceHidden = new InstanceHiddenUser({ name: "Visible", secret: "hidden" });
    instanceHidden.makeHidden("secret");
    expect(instanceHidden.toJSON()).toEqual({ name: "Visible" });
  });

  test("makeHiddenIf / makeVisibleIf apply only when the guard holds", async () => {
    const attributes = { name: "Visible", secret: "shown" };

    expect(new InstanceHiddenUser(attributes).makeHiddenIf(true, "secret").toJSON())
      .toEqual({ name: "Visible" });
    expect(new InstanceHiddenUser(attributes).makeHiddenIf(false, "secret").toJSON())
      .toEqual({ name: "Visible", secret: "shown" });

    expect(new HiddenVisibleUser(attributes).makeVisibleIf(true, "secret").toJSON())
      .toEqual({ name: "Visible", secret: "shown" });
    expect(new HiddenVisibleUser(attributes).makeVisibleIf(false, "secret").toJSON())
      .toEqual({ name: "Visible" });

    // A predicate receives the model, so the guard can read its own attributes.
    const guarded = new InstanceHiddenUser(attributes)
      .makeHiddenIf((model) => model.getAttribute("name") === "Visible", "secret");
    expect(guarded.toJSON()).toEqual({ name: "Visible" });

    // Same variadic shape as makeHidden/makeVisible, and chainable either way.
    const untouched = new InstanceHiddenUser(attributes);
    expect(untouched.makeHiddenIf(false, ["secret", "name"])).toBe(untouched);
    expect(untouched.makeHiddenIf(true, "secret", ["name"]).toJSON()).toEqual({});
  });

  test("json aliases toJSON", async () => {
    const user = await TestUser.create({ name: "Iris" });
    expect(user.json()).toEqual(user.toJSON());
    expect(user.json().name).toBe("Iris");
  });

  test("all returns all records", async () => {
    await TestUser.create({ name: "Jack" });
    const all = await TestUser.all();
    expect(all.length).toBeGreaterThanOrEqual(1);
    expect(all[0]).toBeInstanceOf(TestUser);
  });

  test("isInstanceOf narrows the current model", async () => {
    const user = await TestUser.create({ name: "Jill" });
    if (user.isInstanceOf(TestUser)) {
      expectType<TestUser>(user);
      expect(user.getAttribute("name")).toBe("Jill");
    } else {
      throw new Error("expected model to match TestUser");
    }
  });

  test("where returns builder", async () => {
    await TestUser.create({ name: "Kate" });
    const results = await TestUser.where("name", "Kate").get();
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  test("applies default attributes to new models", () => {
    const user = new DefaultUser();
    expect(user.getAttribute("name")).toBe("Guest");
    expect(user.getAttribute("active")).toBe(true);
    expect(user.getAttribute("role")).toBe("member");
  });

  test("provided attributes override default attributes", () => {
    const user = new DefaultUser({ name: "Ada", role: "admin" });
    expect(user.getAttribute("name")).toBe("Ada");
    expect(user.getAttribute("active")).toBe(true);
    expect(user.getAttribute("role")).toBe("admin");
  });

  test("hydrate keeps defaults, isolates the source row, and starts clean", () => {
    const row = { id: 42, name: "Hydrated", active: 0 };
    const user = DefaultUser.hydrate(row);
    row.name = "Changed outside";

    expect(user.name).toBe("Hydrated");
    expect(user.active).toBe(false);
    expect(user.role).toBe("member");
    expect(user.isDirty()).toBe(false);
    expect(user.getOriginal()).toEqual({ id: 42, name: "Hydrated", active: 0 });
  });

  test("hydrate routes through a setConnection override declared as an instance field", () => {
    let calls = 0;
    class FieldOverrideUser extends PermissiveModel {
      static table = "field_override_users";
      // An arrow-function field never lands on the prototype.
      setConnection = (conn: any): this => {
        calls++;
        this.$connection = conn;
        return this;
      };
    }

    const connection = Model.getConnection();
    const user = FieldOverrideUser.hydrate({ id: 1 }, connection);

    expect(calls).toBe(1);
    expect(user.$connection).toBe(connection);
  });

  test("query hydration owns fresh rows while keeping attributes and original state separate", async () => {
    const created = await TestUser.create({ name: "Owned", email: "owned@example.com" });
    const connection = Model.getConnection();
    const originalQuery = connection.query.bind(connection);
    let returnedRow: Record<string, any> | undefined;
    connection.query = (async (sql: string, bindings?: any[]) => {
      const rows = await originalQuery(sql, bindings);
      if (sql.includes("test_users") && rows.length === 1) returnedRow = rows[0];
      return rows;
    }) as any;

    try {
      const user = await TestUser.find(created.id);

      expect(user).not.toBeNull();
      expect(user!.$original).toBe(returnedRow!);
      expect(user!.$attributes).not.toBe(returnedRow!);
      expect(user!.isDirty()).toBe(false);
      user!.name = "Changed";
      expect(user!.getOriginal("name")).toBe("Owned");
      expect(user!.getDirty()).toMatchObject({ name: "Changed" });
    } finally {
      connection.query = originalQuery as any;
    }
  });

  test("query hydration preserves overridden hydrate methods", async () => {
    const created = await TestUser.create({ name: "Override", email: "override@example.com" });
    OverrideHydrationUser.hydrateCalls = 0;

    const user = await OverrideHydrationUser.find(created.id);

    expect(OverrideHydrationUser.hydrateCalls).toBe(1);
    expect(user!.getAttribute("hydrated_by_override")).toBe(true);
  });

  test("create persists default attributes", async () => {
    const user = await DefaultUser.create({ name: "Persisted" });
    const found = await DefaultUser.find(user.getAttribute("id"));
    expect(found!.getAttribute("name")).toBe("Persisted");
    expect(found!.getAttribute("active")).toBe(true);
    expect(found!.getAttribute("role")).toBe("member");
  });

  test("attributes can be read and written as model properties", async () => {
    const user = new DefaultUser({ name: "Property User" });

    expect(user.name).toBe("Property User");
    expect(user.active).toBe(true);
    expect(user.role).toBe("member");

    user.role = "admin";
    user.active = false;

    expect(user.getAttribute("role")).toBe("admin");
    expect(user.getAttribute("active")).toBe(false);
    expect(user.getDirty()).toMatchObject({ name: "Property User", role: "admin", active: 0 });
  });

  test("hydrated models expose attributes as properties", async () => {
    const created = await DefaultUser.create({ name: "Hydrated" });
    const found = await DefaultUser.find(created.id);

    expect(found!.id).toBe(created.id);
    expect(found!.name).toBe("Hydrated");
    expect(found!.active).toBe(true);
  });

  test("auto-generates uuid primary keys", async () => {
    const created = await UuidUser.create({ name: "Uuid User" });
    expect(created.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );

    const found = await UuidUser.find(created.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Uuid User");
  });

  test("auto-generates uuid primary key when saving a new instance", async () => {
    const user = new UuidUser();
    user.name = "Saved Uuid User";
    await user.save();

    expect(user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(user.$exists).toBe(true);

    const found = await UuidUser.find(user.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Saved Uuid User");
  });

  test("uses provided uuid primary key when explicitly set", async () => {
    const explicitId = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
    const user = await UuidUser.create({ id: explicitId, name: "Explicit Uuid" });

    expect(user.id).toBe(explicitId);

    const found = await UuidUser.find(explicitId);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("Explicit Uuid");
  });

  test("creates uuid user with name 'test'", async () => {
    const user = await UuidUser.create({ name: "test" });
    expect(user.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(user.name).toBe("test");
    expect(user.$exists).toBe(true);

    const found = await UuidUser.find(user.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe("test");
  });
});

describe("Model query terminators as statics", () => {
  class TermPost extends PermissiveModel {
    static table = "term_posts";
    comments() {
      return this.hasMany(TermComment, "term_post_id");
    }
  }

  class TermComment extends PermissiveModel {
    static table = "term_comments";
  }

  class TermEmpty extends PermissiveModel {
    static table = "term_empty";
  }

  beforeAll(async () => {
    setupTestDb();
    await Schema.create("term_posts", (table) => {
      table.increments("id");
      table.string("title");
      table.integer("views");
      table.timestamps();
    });
    await Schema.create("term_comments", (table) => {
      table.increments("id");
      table.integer("term_post_id");
      table.timestamps();
    });
    await Schema.create("term_empty", (table) => {
      table.increments("id");
      table.timestamps();
    });

    const commented = await TermPost.create({ title: "Commented", views: 10 });
    await TermPost.create({ title: "Standalone", views: 30 });
    await TermPost.create({ title: "Quiet", views: 20 });
    await TermComment.create({ term_post_id: commented.getAttribute("id") });
  });

  test("sum, avg, average, min and max run off the model", async () => {
    expect(await TermPost.sum("views")).toBe(60);
    expect(await TermPost.avg("views")).toBe(20);
    expect(await TermPost.average("views")).toBe(20);
    expect(await TermPost.min("views")).toBe(10);
    expect(await TermPost.max("views")).toBe(30);
  });

  test("the static aggregates match the builder ones", async () => {
    expect(await TermPost.sum("views")).toBe(await TermPost.query().sum("views"));
    expect(await TermPost.average("views")).toBe(await TermPost.query().average("views"));
    expect(await TermPost.max("views")).toBe(await TermPost.query().max("views"));
  });

  test("exists reports whether the table has any row", async () => {
    expect(await TermPost.exists()).toBe(true);
    expect(await TermEmpty.exists()).toBe(false);
  });

  test("sole returns the only row and throws when there is more than one", async () => {
    const only = await TermPost.where("title", "Standalone").sole();
    expect(only.getAttribute("title")).toBe("Standalone");

    await expect(TermPost.sole()).rejects.toThrow(/Multiple records found/);
    await expect(TermEmpty.sole()).rejects.toThrow();
  });

  test("orWhereHas starts a query the same way the builder does", async () => {
    expect(TermPost.orWhereHas("comments").toSql()).toBe(TermPost.query().orWhereHas("comments").toSql());

    const posts = await TermPost.orWhereHas("comments")
      .orWhere("title", "Standalone")
      .orderBy("title")
      .get();

    expect(posts.map((post) => post.getAttribute("title"))).toEqual(["Commented", "Standalone"]);
  });

  test("orDoesntHave and orWhereDoesntHave add OR relation branches", async () => {
    expect(TermPost.orDoesntHave("comments").toSql()).toBe(TermPost.query().orDoesntHave("comments").toSql());

    const withoutComments = await TermPost.where("title", "Commented")
      .orDoesntHave("comments")
      .orderBy("title")
      .get();
    expect(withoutComments.map((post) => post.getAttribute("title"))).toEqual(["Commented", "Quiet", "Standalone"]);

    const withoutMatchingComments = await TermPost.where("title", "Standalone")
      .orWhereDoesntHave("comments", (query) => query.where("id", "<", 0))
      .orderBy("title")
      .get();
    expect(withoutMatchingComments.map((post) => post.getAttribute("title"))).toEqual(["Commented", "Quiet", "Standalone"]);

    if (false) {
      TermPost.query().orDoesntHave("comments");
      TermPost.orWhereDoesntHave("comments", (query) => query.where("id", ">", 0));
      // @ts-expect-error Only relation names should be accepted on typed builders.
      TermPost.query().orDoesntHave("missing");
    }
  });
});
