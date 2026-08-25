import { beforeAll, describe, expect, test } from "bun:test";
import { Builder, Model, ObserverRegistry, Schema } from "../src/index.js";
import { PermissiveModel, setupTestDb } from "./helpers.js";

class ScopedUser extends PermissiveModel {
  static table = "scoped_users";
  static softDeletes = true;

  static scopeActive(query: Builder<any>) {
    return query.where("active", true);
  }

  posts() {
    return this.hasMany(ScopedPost);
  }
}

class ScopedPost extends PermissiveModel {
  static table = "scoped_posts";
  static softDeletes = true;

  user() {
    return this.belongsTo(ScopedUser);
  }
}

class ScopedRole extends PermissiveModel {
  static table = "scoped_roles";

  users() {
    return this.belongsToMany(ScopedUser, "scoped_role_user", "scoped_role_id", "scoped_user_id");
  }
}

class TenantItem extends PermissiveModel {
  static table = "tenant_items";
}

describe("Soft Deletes, Scopes, and Relation Queries", () => {
  beforeAll(async () => {
    setupTestDb();

    TenantItem.addGlobalScope("tenant", (query) => {
      query.where("tenant_id", 1);
    });

    await Schema.create("scoped_users", (table) => {
      table.increments("id");
      table.string("name");
      table.boolean("active").default(true);
      table.timestamps();
      table.softDeletes();
    });
    await Schema.create("scoped_posts", (table) => {
      table.increments("id");
      table.integer("scoped_user_id");
      table.string("title");
      table.integer("views").default(0);
      table.timestamps();
      table.softDeletes();
    });
    await Schema.create("scoped_roles", (table) => {
      table.increments("id");
      table.string("title");
      table.timestamps();
    });
    await Schema.create("scoped_role_user", (table) => {
      table.increments("id");
      table.integer("scoped_user_id");
      table.integer("scoped_role_id");
      table.timestamps();
    });
    await Schema.create("tenant_items", (table) => {
      table.increments("id");
      table.integer("tenant_id");
      table.string("name");
      table.timestamps();
    });
  });

  test("soft deletes hide rows by default and can be included or restored", async () => {
    const user = await ScopedUser.create({ name: "Archived", active: true });

    await user.delete();

    expect(await ScopedUser.find(user.getAttribute("id"))).toBeNull();
    expect(await ScopedUser.withTrashed().find(user.getAttribute("id"))).not.toBeNull();
    expect(await ScopedUser.onlyTrashed().count()).toBe(1);

    const fresh = await user.fresh();
    expect(fresh).not.toBe(user);
    expect(fresh?.trashed()).toBe(true);

    user.setAttribute("name", "Dirty archived");
    await user.refresh();
    expect(user.getAttribute("name")).toBe("Archived");
    expect(user.trashed()).toBe(true);

    await user.restore();

    expect(await ScopedUser.find(user.getAttribute("id"))).not.toBeNull();
    expect(await ScopedUser.onlyTrashed().count()).toBe(0);

    await user.forceDelete();
    expect(await ScopedUser.withTrashed().find(user.getAttribute("id"))).toBeNull();
  });

  test("builder delete soft deletes rows and dispatches only deleted", async () => {
    const user = await ScopedUser.create({ name: "Bulk archived", active: true });
    const id = user.getAttribute("id");
    const events: string[] = [];
    let observedDeletedAt: unknown;

    ObserverRegistry.register(ScopedUser, {
      updated() { events.push("updated"); },
      saved() { events.push("saved"); },
      deleted(model) {
        events.push("deleted");
        observedDeletedAt = model.getAttribute("deleted_at");
      },
    });

    try {
      await ScopedUser.where("id", id).delete();
    } finally {
      ObserverRegistry.unregister(ScopedUser);
    }

    expect(await ScopedUser.find(id)).toBeNull();
    expect(await ScopedUser.withTrashed().find(id)).not.toBeNull();
    expect(observedDeletedAt).toBeDefined();
    // deleted_at is a date the model declared through softDeletes, so an
    // observer reads it as the same Date any other read of that column yields.
    expect(observedDeletedAt).toBeInstanceOf(Date);
    expect(events).toEqual(["deleted"]);

    await ScopedUser.onlyTrashed().where("id", id).restore();
    expect(await ScopedUser.find(id)).not.toBeNull();
  });

  test("withoutTrashed reapplies visibility and forceDelete removes rows", async () => {
    const active = await ScopedUser.create({ name: "Bulk active", active: true });
    const trashed = await ScopedUser.create({ name: "Bulk force delete", active: true });
    await trashed.delete();
    const ids = [active.getAttribute("id"), trashed.getAttribute("id")];

    const visible = await ScopedUser.withTrashed().withoutTrashed().whereIn("id", ids).get();
    expect(visible.map((user) => user.getAttribute("id"))).toEqual([active.getAttribute("id")]);
    expect(await ScopedUser.withoutTrashed().whereIn("id", ids).count()).toBe(1);
    expect(await ScopedUser.onlyTrashed().withoutTrashed().whereIn("id", ids).pluck("id")).toEqual([active.getAttribute("id")]);
    expect(await ScopedUser.onlyTrashed().onlyTrashed().whereIn("id", ids).pluck("id")).toEqual([trashed.getAttribute("id")]);

    await ScopedUser.onlyTrashed().where("id", trashed.getAttribute("id")).forceDelete();
    expect(await ScopedUser.withTrashed().find(trashed.getAttribute("id"))).toBeNull();
  });

  test("builder soft delete limits both updated rows and deleted events", async () => {
    const first = await ScopedUser.create({ name: "Limited first", active: true });
    const second = await ScopedUser.create({ name: "Limited second", active: true });
    const ids = [first.getAttribute("id"), second.getAttribute("id")];
    const deletedIds: unknown[] = [];

    ObserverRegistry.register(ScopedUser, {
      deleted(model) { deletedIds.push(model.getAttribute("id")); },
    });

    try {
      await ScopedUser.whereIn("id", ids).orderBy("id").limit(1).delete();
    } finally {
      ObserverRegistry.unregister(ScopedUser);
    }

    expect(await ScopedUser.onlyTrashed().whereIn("id", ids).pluck("id")).toEqual([ids[0]]);
    expect(await ScopedUser.whereIn("id", ids).pluck("id")).toEqual([ids[1]]);
    expect(deletedIds).toEqual([ids[0]]);
  });

  test("limited physical delete removes and reports the ordered row", async () => {
    const first = await TenantItem.create({ tenant_id: 1, name: "Physical first" });
    const second = await TenantItem.create({ tenant_id: 1, name: "Physical second" });
    const third = await TenantItem.create({ tenant_id: 1, name: "Physical third" });
    const ids = [first.getAttribute("id"), second.getAttribute("id"), third.getAttribute("id")];
    const deletedIds: unknown[] = [];

    ObserverRegistry.register(TenantItem, {
      deleted(model) { deletedIds.push(model.getAttribute("id")); },
    });

    try {
      await TenantItem.whereIn("id", ids).orderByDesc("id").limit(1).forceDelete();
    } finally {
      ObserverRegistry.unregister(TenantItem);
    }

    expect(await TenantItem.whereIn("id", ids).orderBy("id").pluck("id")).toEqual(ids.slice(0, 2));
    expect(deletedIds).toEqual([ids[2]]);
    await TenantItem.whereIn("id", ids).forceDelete();
  });

  test("builder update observers can see rows that leave a global scope", async () => {
    const item = await TenantItem.create({ tenant_id: 1, name: "Scoped update" });
    const updatedIds: unknown[] = [];

    ObserverRegistry.register(TenantItem, {
      updated(model) { updatedIds.push(model.getAttribute("id")); },
    });

    try {
      await TenantItem.where("id", item.getAttribute("id")).update({ tenant_id: 2 });
    } finally {
      ObserverRegistry.unregister(TenantItem);
    }

    expect(updatedIds).toEqual([item.getAttribute("id")]);
    expect(await TenantItem.find(item.getAttribute("id"))).toBeNull();
    expect(await TenantItem.withoutGlobalScopes().find(item.getAttribute("id"))).not.toBeNull();
    await TenantItem.withoutGlobalScopes().where("id", item.getAttribute("id")).forceDelete();
  });

  test("limited soft delete qualifies primary keys when the selection joins", async () => {
    const user = await ScopedUser.create({ name: "Joined delete owner", active: true });
    const first = await ScopedPost.create({ scoped_user_id: user.getAttribute("id"), title: "Joined first" });
    const second = await ScopedPost.create({ scoped_user_id: user.getAttribute("id"), title: "Joined second" });
    const ids = [first.getAttribute("id"), second.getAttribute("id")];

    await ScopedPost.query()
      .join("scoped_users", "scoped_posts.scoped_user_id", "=", "scoped_users.id")
      .where("scoped_users.id", user.getAttribute("id"))
      .orderBy("scoped_posts.id")
      .limit(1)
      .delete();

    expect(await ScopedPost.onlyTrashed().whereIn("id", ids).pluck("id")).toEqual([ids[0]]);
    expect(await ScopedPost.whereIn("id", ids).pluck("id")).toEqual([ids[1]]);
  });

  test("delete remains physical for regular models and raw builders", async () => {
    const item = await TenantItem.create({ tenant_id: 1, name: "Physical model delete" });
    await TenantItem.where("id", item.getAttribute("id")).delete();
    expect(await TenantItem.find(item.getAttribute("id"))).toBeNull();

    const user = await ScopedUser.create({ name: "Physical raw delete", active: true });
    await new Builder(ScopedUser.getConnection(), ScopedUser.getQualifiedTable())
      .where("id", user.getAttribute("id"))
      .delete();
    expect(await ScopedUser.withTrashed().find(user.getAttribute("id"))).toBeNull();
  });

  test("local and global scopes constrain queries", async () => {
    await ScopedUser.create({ name: "Active", active: true });
    await ScopedUser.create({ name: "Inactive", active: false });
    await TenantItem.create({ tenant_id: 1, name: "Visible" });
    await TenantItem.create({ tenant_id: 2, name: "Hidden" });

    const activeUsers = await ScopedUser.scope("active").get();
    expect(activeUsers.every((user) => user.getAttribute("active"))).toBe(true);

    const tenantItems = await TenantItem.all();
    expect(tenantItems).toHaveLength(1);
    expect(tenantItems[0].getAttribute("name")).toBe("Visible");

    const allTenantItems = await TenantItem.withoutGlobalScope("tenant").get();
    expect(allTenantItems).toHaveLength(2);
  });

  test("has, whereHas, doesntHave, and aggregates query related rows", async () => {
    const ada = await ScopedUser.create({ name: "Ada", active: true });
    const linus = await ScopedUser.create({ name: "Linus", active: true });
    const grace = await ScopedUser.create({ name: "Grace", active: true });

    await ScopedPost.create({ scoped_user_id: ada.getAttribute("id"), title: "Intro", views: 10 });
    await ScopedPost.create({ scoped_user_id: ada.getAttribute("id"), title: "Deep Dive", views: 30 });
    const hiddenPost = await ScopedPost.create({ scoped_user_id: linus.getAttribute("id"), title: "Draft", views: 99 });
    await hiddenPost.delete();

    const usersWithPosts = await ScopedUser.has("posts").get();
    expect(usersWithPosts.map((user) => user.getAttribute("name"))).toContain("Ada");
    expect(usersWithPosts.map((user) => user.getAttribute("name"))).not.toContain("Linus");

    const deepDiveUsers = await ScopedUser.whereHas("posts", (query) => {
      query.where("title", "Deep Dive");
    }).get();
    expect(deepDiveUsers).toHaveLength(1);
    expect(deepDiveUsers[0].getAttribute("name")).toBe("Ada");

    const usersWithoutPosts = await ScopedUser.doesntHave("posts").get();
    const namesWithoutPosts = usersWithoutPosts.map((user) => user.getAttribute("name"));
    expect(namesWithoutPosts).toContain("Linus");
    expect(namesWithoutPosts).toContain("Grace");

    const usersWithCounts = await ScopedUser.withCount("posts").withSum("posts", "views").where("id", ada.getAttribute("id")).get();
    expect(usersWithCounts[0].getAttribute("posts_count")).toBe(2);
    expect(usersWithCounts[0].getAttribute("posts_sum_views")).toBe(40);
  });

  test("whereHas quotes callback values that look like SQL expressions", async () => {
    const malicious = "CURRENT_TIMESTAMP OR 1=1 --";
    const query = ScopedUser.whereHas("posts", (related) => related.where("title", malicious));

    expect(query.toSql()).toContain("'CURRENT_TIMESTAMP OR 1=1 --'");
    expect(await query.get()).toHaveLength(0);
  });

  test("whereHas works for belongsToMany relations", async () => {
    const user = await ScopedUser.create({ name: "Role User", active: true });
    const role = await ScopedRole.create({ title: "Maintainer" });
    await role.users().attach(user.getAttribute("id"));

    const roles = await ScopedRole.whereHas("users", (query) => {
      query.where("name", "Role User");
    }).get();

    expect(roles).toHaveLength(1);
    expect(roles[0].getAttribute("title")).toBe("Maintainer");
  });
});
