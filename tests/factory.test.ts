import { expect, test, describe, beforeAll } from "bun:test";
import { Connection, Model, Schema, Factory, ObserverRegistry, Sequence, backedEnum } from "../src/index.js";
import { PermissiveModel, setupTestDb } from "./helpers.js";

class FUser extends PermissiveModel {
  static table = "f_users";
  posts() {
    return this.hasMany(FPost);
  }
  roles() {
    return this.belongsToMany(FRole, "f_role_f_user").withPivot("source");
  }
}

class FPost extends PermissiveModel {
  static table = "f_posts";
  fuser() {
    return this.belongsTo(FUser);
  }
  roles() {
    return this.belongsToMany(FRole, "f_post_role");
  }
}

class FRole extends PermissiveModel {
  static table = "f_roles";
}

// Class-based factories — model carries no factory code.
class FUserFactory extends Factory<FUser> {
  definition(seq: number) {
    return { name: `User ${seq}`, email: `user${seq}@test.com`, role: "member", active: true };
  }
  admin() {
    return this.state({ role: "admin" });
  }
  inactive() {
    return this.state((_a, seq) => ({ active: false, name: `Inactive ${seq}` }));
  }
}

class FPostFactory extends Factory<FPost> {
  definition(seq: number) {
    return { title: `Post ${seq}` };
  }
}

class FRoleFactory extends Factory<FRole> {
  definition(seq: number) {
    return { name: `Role ${seq}` };
  }
}

class FSoftUser extends PermissiveModel {
  static table = "f_soft_users";
  static softDeletes = true;
  static deletedAtColumn = "removed_at";
}

class FSoftUserFactory extends Factory<FSoftUser> {
  definition(seq: number) {
    return { name: `Soft ${seq}` };
  }
}

class ConfiguredFUser extends FUser {}

class ConfiguredFUserFactory extends Factory<ConfiguredFUser> {
  definition() {
    return { name: "Before configure", email: "configured@test.com", role: "member", active: true };
  }

  configure() {
    return this.afterMaking((user) => user.setAttribute("name", "Configured"));
  }
}

Factory.register(FUser, FUserFactory);
Factory.register(FPost, FPostFactory);
Factory.register(FRole, FRoleFactory);
Factory.register(FSoftUser, FSoftUserFactory);
Factory.register(ConfiguredFUser, ConfiguredFUserFactory);

const FactoryStatus = backedEnum({ Draft: "draft", Published: "published" });

class GuardedFactoryUser extends Model {
  static table = "guarded_factory_users";
  static guarded = ["id", "admin"];
  static casts = {
    admin: "boolean",
    status: FactoryStatus,
    active: "boolean",
    amount: "decimal:2",
    metadata: "json",
    happened_at: "datetime",
  };
}

class GuardedFactoryUserFactory extends Factory<GuardedFactoryUser> {
  definition(sequence: number) {
    return {
      id: 10_000 + sequence,
      admin: true,
      name: `Guarded ${sequence}`,
      status: FactoryStatus.Draft,
      active: true,
      amount: "12.345",
      metadata: { sequence },
      happened_at: new Date("2026-08-26T10:00:00.000Z"),
    };
  }
}

class FactoryUuidUser extends Model {
  static table = "factory_uuid_users";
  static keyType = "uuid" as const;
  static guarded = ["id"];
}

class FactoryUuidUserFactory extends Factory<FactoryUuidUser> {
  definition(sequence: number) {
    return { name: `UUID ${sequence}` };
  }
}

Factory.register(GuardedFactoryUser, GuardedFactoryUserFactory);
Factory.register(FactoryUuidUser, FactoryUuidUserFactory);

describe("Factory (class-based, Laravel parity)", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("f_users", (t) => {
      t.increments("id");
      t.string("name");
      t.string("email");
      t.string("role");
      t.boolean("active");
      t.timestamps();
    });
    await Schema.create("f_posts", (t) => {
      t.increments("id");
      t.integer("f_user_id");
      t.string("title");
      t.timestamps();
    });
    await Schema.create("f_roles", (t) => {
      t.increments("id");
      t.string("name");
      t.timestamps();
    });
    await Schema.create("f_role_f_user", (t) => {
      t.increments("id");
      t.integer("f_user_id");
      t.integer("f_role_id");
      t.string("source").nullable();
    });
    await Schema.create("f_post_role", (t) => {
      t.increments("id");
      t.integer("f_post_id");
      t.integer("f_role_id");
    });
    await Schema.create("f_soft_users", (t) => {
      t.increments("id");
      t.string("name");
      t.dateTime("removed_at").nullable();
      t.timestamps();
    });
    await Schema.create("guarded_factory_users", (t) => {
      t.increments("id");
      t.boolean("admin").default(false);
      t.string("name");
      t.string("status");
      t.boolean("active");
      t.string("amount");
      t.text("metadata");
      t.dateTime("happened_at");
      t.timestamps();
    });
    await Schema.create("factory_uuid_users", (t) => {
      t.uuid("id").primary();
      t.string("name");
      t.timestamps();
    });
  });

  test("Model.factory() resolves the registered factory class", () => {
    expect(FUser.factory()).toBeInstanceOf(FUserFactory);
  });

  test("make() builds unsaved instance with sequence", () => {
    const u = FUser.factory().make() as FUser;
    expect(u).toBeInstanceOf(FUser);
    expect(u.getAttribute("name")).toBe("User 1");
    expect(u.getAttribute("id")).toBeUndefined();
  });

  test("count() returns array; single returns scalar", () => {
    expect(Array.isArray(FUser.factory().make())).toBe(false);
    const many = FUser.factory().count(3).make() as FUser[];
    expect(many.map((m) => m.getAttribute("name"))).toEqual(["User 1", "User 2", "User 3"]);
  });

  test("typed one/many terminals override or preserve count as advertised", async () => {
    expect(FUser.factory().count(3).rawOne()).toMatchObject({ name: "User 1" });
    expect(FUser.factory().count(3).makeOne()).toBeInstanceOf(FUser);

    const before = await FUser.query().count();
    const one = await FUser.factory().count(3).createOne({ email: "create-one@test.com" });
    const many = await FUser.factory().count(3).createMany({ email: "create-many@test.com" });

    expect(one).toBeInstanceOf(FUser);
    expect(many).toHaveLength(3);
    expect(await FUser.query().count()).toBe(before + 4);
    expect(await FUser.factory().count(0).createMany()).toEqual([]);
  });

  test("count() rejects values that cannot represent a finite record count", () => {
    for (const amount of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => FUser.factory().count(amount)).toThrow("non-negative integer");
    }
    expect(FUser.factory().count(0).make()).toEqual([]);
  });

  test("configure() registers default factory hooks", () => {
    const user = ConfiguredFUser.factory().make() as ConfiguredFUser;
    expect(user.getAttribute("name")).toBe("Configured");
  });

  test("create() persists; raw() returns attributes only", async () => {
    const created = (await FUser.factory().create()) as FUser;
    expect(created.getAttribute("id")).toBeDefined();
    expect(await FUser.where("email", "user1@test.com").first()).not.toBeNull();

    const raw = FUser.factory().raw() as any;
    expect(raw).toEqual({ name: "User 1", email: "user1@test.com", role: "member", active: true });
  });

  test("state methods on the factory class", async () => {
    const admin = (await FUser.factory().admin().create()) as FUser;
    expect(admin.getAttribute("role")).toBe("admin");

    const inactive = FUser.factory().inactive().make() as FUser;
    expect(inactive.getAttribute("active")).toBe(false);
    expect(inactive.getAttribute("name")).toBe("Inactive 1");
  });

  test("precedence: definition -> state -> override", () => {
    const u = FUser.factory().admin().make({ role: "owner" }) as FUser;
    expect(u.getAttribute("role")).toBe("owner");
  });

  test("factory attributes bypass guarded for make(), create(), and insert()", async () => {
    const made = GuardedFactoryUser.factory().make() as GuardedFactoryUser;
    expect(made.getAttribute("id")).toBe(10_001);
    expect(made.getAttribute("admin")).toBe(true);

    const created = await GuardedFactoryUser.factory().create({ id: 20_001, name: "Trusted create" }) as GuardedFactoryUser;
    expect(created.getAttribute("id")).toBe(20_001);
    expect(created.getAttribute("admin")).toBe(true);

    await GuardedFactoryUser.factory().insert({ id: 20_002, name: "Trusted insert" });
    const inserted = await GuardedFactoryUser.findOrFail(20_002);
    expect(inserted.getAttribute("admin")).toBe(true);
  });

  test("normal Model.insert() remains mass-assignment protected", async () => {
    await GuardedFactoryUser.insert({
      id: 99_999,
      admin: true,
      name: "Normal insert",
      status: FactoryStatus.Draft,
      active: true,
      amount: "1.00",
      metadata: {},
      happened_at: new Date("2026-08-26T10:00:00.000Z"),
    });

    const inserted = await GuardedFactoryUser.where("name", "Normal insert").firstOrFail();
    expect(inserted.getAttribute("id")).not.toBe(99_999);
    expect(inserted.getAttribute("admin")).toBe(false);
  });

  test("protected attributes keep definition < state < overrides precedence", async () => {
    await GuardedFactoryUser.factory()
      .state({ id: 21_001, admin: false })
      .insert({ id: 21_002, admin: true, name: "Protected precedence" });

    const inserted = await GuardedFactoryUser.findOrFail(21_002);
    expect(inserted.getAttribute("admin")).toBe(true);
    expect(await GuardedFactoryUser.find(21_001)).toBeNull();
  });

  test("Sequence cycles patches across count()", () => {
    const users = FUser.factory()
      .count(4)
      .state(new Sequence({ role: "a" }, { role: "b" }))
      .make() as FUser[];
    expect(users.map((u) => u.getAttribute("role"))).toEqual(["a", "b", "a", "b"]);
  });

  test("afterMaking / afterCreating hooks run per model", async () => {
    const made: number[] = [];
    const createdNames: string[] = [];
    const f = FUser.factory()
      .count(2)
      .afterMaking((_m, seq) => { made.push(seq); })
      .afterCreating((m) => { createdNames.push(m.getAttribute("name")); });

    f.make();
    expect(made).toEqual([1, 2]);
    made.length = 0;
    await f.create();
    expect(made).toEqual([1, 2]);
    expect(createdNames).toEqual(["User 1", "User 2"]);
  });

  test("make() rejects async afterMaking hooks instead of starting unawaited work", () => {
    let started = false;
    expect(() => FUser.factory().afterMaking(async () => { started = true; }).make())
      .toThrow("cannot run asynchronous afterMaking hooks");
    expect(started).toBe(false);
  });

  test("insert awaits afterMaking, skips model events and afterCreating", async () => {
    const modelEvents: string[] = [];
    const hooks: string[] = [];
    ObserverRegistry.register(GuardedFactoryUser, {
      creating: (model) => { modelEvents.push(`creating:${model.getAttribute("name")}`); },
      created: () => { modelEvents.push("created"); },
      saving: () => { modelEvents.push("saving"); },
      saved: () => { modelEvents.push("saved"); },
    });

    try {
      await GuardedFactoryUser.factory()
        .afterMaking(async (model) => {
          await Promise.resolve();
          model.setAttribute("name", "Awaited afterMaking");
          hooks.push("afterMaking");
        })
        .afterCreating(() => { hooks.push("afterCreating"); })
        .insert({ id: 22_001 });

      expect(hooks).toEqual(["afterMaking"]);
      expect(modelEvents).toEqual([]);
      expect((await GuardedFactoryUser.findOrFail(22_001)).getAttribute("name")).toBe("Awaited afterMaking");

      hooks.length = 0;
      await GuardedFactoryUser.factory()
        .afterMaking(async (model) => {
          await Promise.resolve();
          model.setAttribute("name", "Awaited create afterMaking");
          hooks.push("afterMaking");
        })
        .afterCreating(() => { hooks.push("afterCreating"); })
        .create({ id: 22_002, name: "Observed create" });
      expect(hooks).toEqual(["afterMaking", "afterCreating"]);
      expect(modelEvents).toEqual(["creating:Awaited create afterMaking", "saving", "created", "saved"]);
    } finally {
      ObserverRegistry.unregister(GuardedFactoryUser);
    }
  });

  test("insert applies backed enum, boolean, decimal, JSON, and datetime casts", async () => {
    await GuardedFactoryUser.factory().insert({ id: 23_001, name: "Factory casts" });
    const inserted = await GuardedFactoryUser.findOrFail(23_001);

    expect(inserted.getAttribute("status")).toBe(FactoryStatus.Draft);
    expect(inserted.getAttribute("active")).toBe(true);
    expect(inserted.getAttribute("amount")).toBe("12.35");
    expect(inserted.getAttribute("metadata")).toEqual({ sequence: 1 });
    expect(inserted.getAttribute("happened_at")).toEqual(new Date("2026-08-26T10:00:00.000Z"));
  });

  test("insert persists in-place cast mutations made by afterMaking", async () => {
    await GuardedFactoryUser.factory()
      .afterMaking((model) => {
        model.getAttribute("metadata").hooked = true;
        model.getAttribute("happened_at").setUTCFullYear(2030);
      })
      .insert({ id: 23_002, name: "Mutable hook casts" });

    const inserted = await GuardedFactoryUser.findOrFail(23_002);
    expect(inserted.getAttribute("metadata")).toEqual({ sequence: 1, hooked: true });
    expect(inserted.getAttribute("happened_at").getUTCFullYear()).toBe(2030);
  });

  test("insert validates every trusted enum before writing the first chunk", async () => {
    await expect(GuardedFactoryUser.factory()
      .count(101)
      .state((_attributes, sequence) => ({
        id: 31_000 + sequence,
        name: `Invalid enum ${sequence}`,
      }))
      .afterMaking((model, sequence) => {
        if (sequence === 101) model.$attributes.status = "archived";
      })
      .insert({}, { chunkSize: 100 }))
      .rejects.toThrow("Invalid enum value");

    expect(await GuardedFactoryUser.where("name", "like", "Invalid enum %").count()).toBe(0);
  });

  test("insert preserves explicit keys/timestamps and generates missing UUIDs/timestamps", async () => {
    const createdAt = new Date("2020-01-02T03:04:05.000Z");
    const updatedAt = new Date("2020-02-03T04:05:06.000Z");
    await GuardedFactoryUser.factory().insert({
      id: 24_001,
      name: "Explicit timestamps",
      created_at: createdAt,
      updated_at: updatedAt,
    });
    await FactoryUuidUser.factory().insert({ name: "Generated UUID" });

    const explicit = await GuardedFactoryUser.findOrFail(24_001);
    const generated = await FactoryUuidUser.where("name", "Generated UUID").firstOrFail();
    expect(explicit.getAttribute("created_at")).toEqual(createdAt);
    expect(explicit.getAttribute("updated_at")).toEqual(updatedAt);
    expect(generated.getAttribute("id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(generated.getAttribute("created_at")).toBeInstanceOf(Date);
    expect(generated.getAttribute("updated_at")).toBeInstanceOf(Date);
  });

  test("insert does not apply global scopes", async () => {
    let scopeCalls = 0;
    GuardedFactoryUser.addGlobalScope("factory-insert", () => { scopeCalls++; });
    try {
      await GuardedFactoryUser.factory().insert({ id: 24_002, name: "Without scopes" });
      expect(scopeCalls).toBe(0);
    } finally {
      GuardedFactoryUser.removeGlobalScope("factory-insert");
    }
    expect(await GuardedFactoryUser.find(24_002)).not.toBeNull();
  });

  test("insert writes exact counts, chunks 1,000 rows, and validates before SQL", async () => {
    const connection = GuardedFactoryUser.getConnection();
    const originalRun = connection.run;
    const calls: string[] = [];
    const inserts: string[] = [];
    (connection as any).run = async (sql: string, ...args: any[]) => {
      calls.push(sql);
      if (sql.startsWith('INSERT INTO "guarded_factory_users"')) inserts.push(sql);
      return await (originalRun as any).call(connection, sql, ...args);
    };

    try {
      const before = await GuardedFactoryUser.query().count();
      calls.length = 0;
      await GuardedFactoryUser.factory().count(0).insert();
      expect(calls).toHaveLength(0);
      expect(await GuardedFactoryUser.query().count()).toBe(before);

      await GuardedFactoryUser.factory().insert({ id: 25_001, name: "One row" });
      expect(inserts).toHaveLength(1);

      inserts.length = 0;
      await GuardedFactoryUser.factory().count(1_000).insert({}, { chunkSize: 100 });
      expect(inserts).toHaveLength(10);
      expect(await GuardedFactoryUser.query().count()).toBe(before + 1_001);

      calls.length = 0;
      inserts.length = 0;
      for (const chunkSize of [0, -1, 1.5]) {
        await expect(GuardedFactoryUser.factory().insert({ id: 30_000 + chunkSize }, { chunkSize }))
          .rejects.toThrow("positive integer");
      }
      expect(calls).toHaveLength(0);
    } finally {
      (connection as any).run = originalRun;
    }
  });

  test(".for() sets belongsTo FK from a parent model", async () => {
    const parent = (await FUser.factory().create()) as FUser;
    const post = (await FPost.factory().for(parent, "fuser").create()) as FPost;
    expect(post.getAttribute("f_user_id")).toBe(parent.getAttribute("id"));
  });

  test("make() applies .for(model) and rejects parents that require I/O", async () => {
    const parent = await FUser.factory().createOne({ email: "make-parent@test.com" });
    const post = FPost.factory().for(parent, "fuser").makeOne();

    expect(post.$exists).toBe(false);
    expect(post.getAttribute("f_user_id")).toBe(parent.getAttribute("id"));
    expect(() => FPost.factory().for(new FUser(), "fuser").make())
      .toThrow("requires models passed to for() to be persisted");
    expect(() => FPost.factory().for(FUser.factory(), "fuser").make())
      .toThrow("cannot resolve a parent Factory");
  });

  test(".for() accepts a parent Factory (created lazily)", async () => {
    const post = (await FPost.factory().for(FUser.factory(), "fuser").create()) as FPost;
    const owner = await FUser.find(post.getAttribute("f_user_id"));
    expect(owner).not.toBeNull();
  });

  test(".for() resolves one parent factory per generated batch", async () => {
    const created = await FPost.factory()
      .count(3)
      .for(FUser.factory().state({ email: "shared-create-parent@test.com" }), "fuser")
      .create({ title: "Shared create parent" }) as FPost[];

    expect(new Set(created.map((post) => post.getAttribute("f_user_id"))).size).toBe(1);
    expect(await FUser.where("email", "shared-create-parent@test.com").count()).toBe(1);

    await FPost.factory()
      .count(3)
      .for(FUser.factory().state({ email: "shared-insert-parent@test.com" }), "fuser")
      .insert({ title: "Shared insert parent" });
    const inserted = await FPost.where("title", "Shared insert parent").get();

    expect(new Set(inserted.map((post) => post.getAttribute("f_user_id"))).size).toBe(1);
    expect(await FUser.where("email", "shared-insert-parent@test.com").count()).toBe(1);
  });

  test("insert resolves belongsTo models and factories in bulk", async () => {
    const parent = await FUser.factory().create({ email: "bulk-parent@test.com" }) as FUser;
    await FPost.factory().count(2).for(parent, "fuser").insert({ title: "Bulk model parent" });
    await FPost.factory().for(FUser.factory(), "fuser").insert({ title: "Bulk factory parent" });

    expect(await FPost.where("f_user_id", parent.getAttribute("id")).count()).toBe(2);
    const factoryParentPost = await FPost.where("title", "Bulk factory parent").firstOrFail();
    expect(await FUser.find(factoryParentPost.getAttribute("f_user_id"))).not.toBeNull();
  });

  test(".has() creates related children through hasMany", async () => {
    const user = (await FUser.factory()
      .has(FPost.factory().count(3), "posts")
      .create()) as FUser;
    const posts = await FPost.where("f_user_id", user.getAttribute("id")).get();
    expect(posts).toHaveLength(3);
  });

  test("hasAttached() creates and attaches many-to-many models with pivot attributes", async () => {
    const user = await FUser.factory()
      .hasAttached(FRole.factory().count(2), { source: "factory" }, "roles")
      .create({ email: "attached@test.com" }) as FUser;

    const roles = await user.roles().get();
    expect(roles).toHaveLength(2);
    expect(roles.map((role) => role.pivot.source)).toEqual(["factory", "factory"]);
  });

  test("recycle() reuses models through nested for() and hasAttached() factories", async () => {
    const parent = await FUser.factory().createOne({ email: "recycled-parent@test.com" });
    const usersBefore = await FUser.query().count();
    const posts = await FPost.factory()
      .count(2)
      .for(FUser.factory(), "fuser")
      .recycle(parent)
      .createMany({ title: "Recycled parent" });

    expect(await FUser.query().count()).toBe(usersBefore);
    expect(posts.every((post) => post.getAttribute("f_user_id") === parent.getAttribute("id"))).toBe(true);

    const choices = await FUser.factory().count(2).createMany({ email: "recycled-choice@test.com" });
    const originalRandom = Math.random;
    (Math as any).random = () => 0.999;
    try {
      const selected = await FPost.factory()
        .for(FUser.factory().count(99), "fuser")
        .recycle(choices)
        .createOne({ title: "Random recycled parent" });
      expect(selected.getAttribute("f_user_id")).toBe(choices[1].getAttribute("id"));
    } finally {
      (Math as any).random = originalRandom;
    }

    const roles = await FRole.factory().count(3).createMany();
    const rolesBefore = await FRole.query().count();
    await FUser.factory()
      .count(2)
      .has(FPost.factory().count(2).hasAttached(FRole.factory().count(3), "roles"), "posts")
      .recycle(roles)
      .createMany({ email: "recycled-graph@test.com" });

    expect(await FRole.query().count()).toBe(rolesBefore);
    const pivots = await Schema.getConnection().query("SELECT f_role_id FROM f_post_role");
    expect(pivots).toHaveLength(12);
    expect(new Set(pivots.map((pivot: any) => pivot.f_role_id))).toEqual(
      new Set(roles.map((role) => role.getAttribute("id")))
    );
  });

  test("trashed() creates a restorable soft-deleted model", async () => {
    const user = await FSoftUser.factory().trashed().createOne();
    expect(user.getAttribute("removed_at")).toBeInstanceOf(Date);
    expect(await FSoftUser.find(user.getAttribute("id"))).toBeNull();

    const trashed = await FSoftUser.withTrashed().findOrFail(user.getAttribute("id"));
    await trashed.restore();
    expect(await FSoftUser.find(user.getAttribute("id"))).not.toBeNull();
    expect(() => FUser.factory().trashed()).toThrow("enable soft deletes");
  });

  test("connection() keeps create graphs and bulk inserts off the default connection", async () => {
    const alternate = new Connection({ url: "sqlite://:memory:" });
    await alternate.run("CREATE TABLE f_users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, email TEXT, role TEXT, active INTEGER, created_at TEXT, updated_at TEXT)");
    await alternate.run("CREATE TABLE f_posts (id INTEGER PRIMARY KEY AUTOINCREMENT, f_user_id INTEGER, title TEXT, created_at TEXT, updated_at TEXT)");

    try {
      const email = "alternate-connection@test.com";
      const user = await FUser.factory()
        .connection(alternate)
        .has(FPost.factory(), "posts")
        .createOne({ email });
      await FUser.factory().connection(alternate).count(2).insert({ email: "alternate-bulk@test.com" });

      expect(user.getConnection()).toBe(alternate);
      expect((await alternate.query("SELECT COUNT(*) AS total FROM f_users"))[0].total).toBe(3);
      expect((await alternate.query("SELECT COUNT(*) AS total FROM f_posts"))[0].total).toBe(1);
      expect(await FUser.where("email", email).count()).toBe(0);
    } finally {
      await alternate.close();
    }
  });

  test("createQuietly() suppresses observers across parents and children but keeps factory hooks", async () => {
    const events: string[] = [];
    let factoryCallbacks = 0;
    ObserverRegistry.register(FUser, { created: () => { events.push("user"); } });
    ObserverRegistry.register(FPost, { created: () => { events.push("post"); } });
    ObserverRegistry.register(FRole, { created: () => { events.push("role"); } });

    try {
      await FUser.factory()
        .has(FPost.factory(), "posts")
        .hasAttached(FRole.factory(), "roles")
        .afterCreating(() => { factoryCallbacks++; })
        .createQuietly({ email: "quiet-factory@test.com" });

      expect(events).toEqual([]);
      expect(factoryCallbacks).toBe(1);

      await FUser.factory().create({ email: "events-restored@test.com" });
      expect(events).toEqual(["user"]);

      events.length = 0;
      await Promise.all([
        FUser.factory().afterMaking(async () => { await Promise.resolve(); }).createQuietly({ email: "parallel-quiet@test.com" }),
        FUser.factory().afterMaking(async () => { await Promise.resolve(); }).create({ email: "parallel-loud@test.com" }),
      ]);
      expect(events).toEqual(["user"]);
    } finally {
      ObserverRegistry.unregister(FUser);
      ObserverRegistry.unregister(FPost);
      ObserverRegistry.unregister(FRole);
    }
  });

  test("insert rejects .has() instead of silently dropping children", async () => {
    await expect(FUser.factory().has(FPost.factory(), "posts").insert())
      .rejects.toThrow("Factory.insert() cannot create child relationships");
    await expect(FUser.factory().hasAttached(FRole.factory(), "roles").insert())
      .rejects.toThrow("Factory.insert() cannot create child relationships");
  });

  test("unregistered model.factory() throws a clear error", () => {
    class Orphan extends PermissiveModel {
      static table = "orphans";
    }
    expect(() => (Orphan as any).factory()).toThrow("No factory registered for Orphan");
  });

  test("immutability: chained builders return new factories, base untouched", () => {
    const base = FUser.factory();
    const derived = base.count(5).admin();
    expect((base.make() as FUser).getAttribute("role")).toBe("member");
    expect(Array.isArray(base.make())).toBe(false);
    expect(derived.make()).toHaveLength(5);
    expect((derived.make() as FUser[])[0].getAttribute("role")).toBe("admin");
  });

  test("chained state methods compose (admin + inactive)", () => {
    const u = FUser.factory().admin().inactive().make() as FUser;
    expect(u.getAttribute("role")).toBe("admin");
    expect(u.getAttribute("active")).toBe(false);
  });
});
