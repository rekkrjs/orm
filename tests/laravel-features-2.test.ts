import { expect, test, describe, beforeAll, mock } from "bun:test";
import { Model, Schema, ObserverRegistry } from "../src/index.js";
import { PermissiveModel, setupTestDb } from "./helpers.js";

// ─── Models ──────────────────────────────────────────────────────────────────

class Article extends PermissiveModel {
  static table = "lf2_articles";
  static fillable = ["title", "slug"];
}

class SoftPost extends PermissiveModel {
  static table = "lf2_soft_posts";
  static softDeletes = true;
}

class LfUser extends PermissiveModel {
  static table = "lf2_users";
  roles() {
    return this.belongsToMany(LfRole, "lf2_role_lf2_user", "lf2_user_id", "lf2_role_id");
  }
  subscriptions() {
    return this.belongsToMany(LfRole, "lf2_role_lf2_user", "lf2_user_id", "lf2_role_id")
      .as("subscription")
      .withPivot("expires_at");
  }
}

class LfRole extends PermissiveModel {
  static table = "lf2_roles";
}

// ─── Setup helpers ────────────────────────────────────────────────────────────

async function setupArticles() {
  setupTestDb();
  await Schema.create("lf2_articles", (t) => {
    t.increments("id");
    t.string("title").nullable();
    t.string("slug").nullable();
    t.string("secret").nullable();
    t.timestamps();
  });
}

async function setupSoftPost() {
  setupTestDb();
  await Schema.create("lf2_soft_posts", (t) => {
    t.increments("id");
    t.string("title").nullable();
    t.timestamp("deleted_at").nullable();
    t.timestamps();
  });
}

async function setupPivot() {
  setupTestDb();
  await Schema.create("lf2_users", (t) => {
    t.increments("id");
    t.string("name");
    t.timestamps();
  });
  await Schema.create("lf2_roles", (t) => {
    t.increments("id");
    t.string("label");
    t.timestamps();
  });
  await Schema.create("lf2_role_lf2_user", (t) => {
    t.increments("id");
    t.integer("lf2_user_id");
    t.integer("lf2_role_id");
    t.string("expires_at").nullable();
    t.timestamps();
  });
}

// ─── firstOrNew ───────────────────────────────────────────────────────────────

describe("firstOrNew()", () => {
  beforeAll(setupArticles);

  test("returns existing record without saving", async () => {
    const existing = await Article.create({ title: "Existing", slug: "existing" });
    const found = await Article.firstOrNew({ title: "Existing" }, { slug: "new" });
    expect(found.id).toBe(existing.id);
    expect(found.$exists).toBe(true);
  });

  test("returns new unsaved instance when not found", async () => {
    const instance = await Article.firstOrNew({ title: "Not Found" }, { slug: "not-found" });
    expect(instance.$exists).toBe(false);
    expect(instance.getAttribute("title")).toBe("Not Found");
    expect(instance.getAttribute("slug")).toBe("not-found");
    expect(await Article.where("title", "Not Found").exists()).toBe(false);
  });

  test("works on a constrained builder without copying prior wheres", async () => {
    const existing = await Article.create({ title: "Builder Existing", slug: "existing-scope" });
    const found = await Article.query()
      .where("slug", "existing-scope")
      .firstOrNew({ title: "Builder Existing" });
    expect(found.id).toBe(existing.id);

    const unsaved = await Article.query()
      .where("slug", "query-only")
      .firstOrNew({ title: "Builder New" });
    expect(unsaved.$exists).toBe(false);
    expect(unsaved.getAttribute("title")).toBe("Builder New");
    expect(unsaved.getAttribute("slug")).toBeUndefined();
  });

  test("create persists through a model builder", async () => {
    const created = await Article.query().create({ title: "Builder Create", slug: "builder-create" });
    expect(created.$exists).toBe(true);
    expect((await Article.findOrFail(created.id)).slug).toBe("builder-create");
  });
});

// ─── forceCreate ─────────────────────────────────────────────────────────────

describe("forceCreate()", () => {
  beforeAll(setupArticles);

  test("creates record bypassing fillable guard", async () => {
    const article = await Article.forceCreate({ title: "Force", slug: "force", secret: "shhh" });
    expect(article.$exists).toBe(true);
    expect(article.getAttribute("secret")).toBe("shhh");

    const db = await Article.where("secret", "shhh").first();
    expect(db).not.toBeNull();
    expect(db!.getAttribute("secret")).toBe("shhh");
  });

  test("normal create() blocks unfillable columns", async () => {
    const article = await Article.create({ title: "Normal", secret: "blocked" } as any);
    const db = await Article.where("title", "Normal").first();
    expect(db!.getAttribute("secret")).toBeNull();
  });
});

// ─── truncate ────────────────────────────────────────────────────────────────

describe("truncate()", () => {
  beforeAll(setupArticles);

  test("deletes all rows", async () => {
    await Article.create({ title: "A" });
    await Article.create({ title: "B" });
    expect(await Article.count()).toBeGreaterThan(0);

    await Article.truncate();
    expect(await Article.count()).toBe(0);
  });
});

// ─── withoutTimestamps ────────────────────────────────────────────────────────

describe("withoutTimestamps()", () => {
  beforeAll(setupArticles);

  test("created_at and updated_at are not set inside callback", async () => {
    const article = await Article.withoutTimestamps(async () => {
      return Article.create({ title: "No TS" });
    });
    expect(article.getAttribute("created_at")).toBeUndefined();
    expect(article.getAttribute("updated_at")).toBeUndefined();
  });

  test("timestamps resume after callback", async () => {
    await Article.withoutTimestamps(async () => {
      await Article.create({ title: "Temp" });
    });
    const after = await Article.create({ title: "After" });
    expect(after.getAttribute("created_at")).not.toBeUndefined();
  });
});

// ─── saveQuietly ─────────────────────────────────────────────────────────────

describe("saveQuietly()", () => {
  beforeAll(setupArticles);

  test("saves without firing observers", async () => {
    let fired = false;
    ObserverRegistry.register(Article, { async saving() { fired = true; } });

    const article = new Article({ title: "Quiet" });
    await article.saveQuietly();

    expect(article.$exists).toBe(true);
    expect(fired).toBe(false);

    ObserverRegistry.unregister(Article);
  });

  test("persists to database", async () => {
    const article = new Article({ title: "Quiet Persist" });
    await article.saveQuietly();
    const found = await Article.find(article.getAttribute("id"));
    expect(found).not.toBeNull();
    expect(found!.getAttribute("title")).toBe("Quiet Persist");
  });
});

// ─── updateQuietly ───────────────────────────────────────────────────────────

describe("updateQuietly()", () => {
  beforeAll(setupArticles);

  test("updates without firing observers", async () => {
    let fired = false;
    ObserverRegistry.register(Article, { async updating() { fired = true; } });

    const article = await Article.create({ title: "Before quiet update" });
    await article.updateQuietly({ title: "After quiet update" });

    expect(fired).toBe(false);
    expect((await Article.findOrFail(article.id)).title).toBe("After quiet update");
    ObserverRegistry.unregister(Article);
  });
});

// ─── deleteQuietly ───────────────────────────────────────────────────────────

describe("deleteQuietly()", () => {
  beforeAll(setupArticles);

  test("deletes without firing observers", async () => {
    let fired = false;
    ObserverRegistry.register(Article, { async deleting() { fired = true; } });

    const article = await Article.create({ title: "Delete Quiet" });
    await article.deleteQuietly();

    expect(article.$exists).toBe(false);
    expect(fired).toBe(false);

    ObserverRegistry.unregister(Article);
  });

  test("soft delete without observers", async () => {
    await setupSoftPost();
    let fired = false;
    ObserverRegistry.register(SoftPost, { async deleting() { fired = true; } });

    const post = await SoftPost.create({ title: "Soft Quiet" });
    await post.deleteQuietly();

    expect(fired).toBe(false);
    expect(post.getAttribute("deleted_at")).not.toBeNull();
    ObserverRegistry.unregister(SoftPost);
  });
});

// ─── wasChanged / getChanges ─────────────────────────────────────────────────

describe("wasChanged() / getChanges()", () => {
  beforeAll(setupArticles);

  test("wasChanged() false before any save", async () => {
    const article = new Article({ title: "New" });
    expect(article.wasChanged()).toBe(false);
  });

  test("wasChanged() true after update save", async () => {
    const article = await Article.create({ title: "Original" });
    article.setAttribute("title", "Updated");
    await article.save();
    expect(article.wasChanged()).toBe(true);
    expect(article.wasChanged("title")).toBe(true);
    expect(article.wasChanged("slug")).toBe(false);
    expect(article.wasChanged(["slug", "title"])).toBe(true);
    expect(article.wasChanged(["slug", "secret"])).toBe(false);
  });

  test("isDirty and isClean accept one or many attributes", async () => {
    const article = await Article.create({ title: "Original", slug: "stable" });
    article.setAttribute("title", "Changed");

    expect(article.isDirty("title")).toBe(true);
    expect(article.isDirty("slug")).toBe(false);
    expect(article.isDirty(["slug", "title"])).toBe(true);
    expect(article.isClean("slug")).toBe(true);
    expect(article.isClean(["slug", "title"])).toBe(false);
    expect(article.isDirty("toString")).toBe(false);
    expect(article.wasChanged("constructor")).toBe(false);
    expect(article.isClean("__proto__")).toBe(true);
  });

  test("getChanges() returns what changed in last save", async () => {
    const article = await Article.create({ title: "Base" });
    article.setAttribute("title", "Changed");
    await article.save();
    const changes = article.getChanges();
    expect(changes).toHaveProperty("title", "Changed");
  });

  test("wasChanged() resets on next save with no changes", async () => {
    const article = await Article.create({ title: "Stable" });
    article.setAttribute("title", "Stable Changed");
    await article.save();
    expect(article.wasChanged()).toBe(true);
    await article.save();
    expect(article.wasChanged()).toBe(false);
  });
});

// ─── replicate ────────────────────────────────────────────────────────────────

describe("replicate()", () => {
  beforeAll(setupArticles);

  test("creates unsaved clone without PK or timestamps", async () => {
    const original = await Article.create({ title: "Original", slug: "original" });
    const clone = original.replicate();

    expect(clone.$exists).toBe(false);
    expect(clone.getAttribute("id")).toBeUndefined();
    expect(clone.getAttribute("title")).toBe("Original");
    expect(clone.getAttribute("slug")).toBe("original");
    expect(clone.getAttribute("created_at")).toBeUndefined();
  });

  test("clone can be saved as new record", async () => {
    const original = await Article.create({ title: "Clone Me" });
    const clone = original.replicate();
    clone.setAttribute("title", "Cloned");
    await clone.save();

    expect(clone.$exists).toBe(true);
    expect(clone.getAttribute("id")).not.toBe(original.getAttribute("id"));
  });

  test("replicate(except) excludes extra fields", async () => {
    const original = await Article.create({ title: "Ex", slug: "ex" });
    const clone = original.replicate(["slug"]);
    expect(clone.getAttribute("slug")).toBeUndefined();
    expect(clone.getAttribute("title")).toBe("Ex");
  });
});

// ─── BelongsToMany.updateExistingPivot ───────────────────────────────────────

describe("BelongsToMany updateExistingPivot()", () => {
  beforeAll(setupPivot);

  test("updates pivot attributes without detach/re-attach", async () => {
    const user = await LfUser.create({ name: "Pivot Update User" });
    const role = await LfRole.create({ label: "Editor" });
    await user.roles().attach(role.getAttribute("id"), { expires_at: "2025-01-01" });

    await user.roles().updateExistingPivot(role.getAttribute("id"), { expires_at: "2030-12-31" });

    const roles = await user.roles().withPivot("expires_at").get();
    expect(roles[0].pivot.expires_at).toBe("2030-12-31");
  });
});

// ─── BelongsToMany.syncWithoutDetaching ──────────────────────────────────────

describe("BelongsToMany syncWithoutDetaching()", () => {
  beforeAll(setupPivot);

  test("attaches new ids without removing existing", async () => {
    const user = await LfUser.create({ name: "Sync No Detach User" });
    const role1 = await LfRole.create({ label: "A" });
    const role2 = await LfRole.create({ label: "B" });
    await user.roles().attach(role1.getAttribute("id"));

    await user.roles().syncWithoutDetaching([role1.getAttribute("id"), role2.getAttribute("id")]);

    const roles = await user.roles().get();
    expect(roles).toHaveLength(2);
  });

  test("does not detach records missing from the list", async () => {
    const user = await LfUser.create({ name: "Keep Existing" });
    const role1 = await LfRole.create({ label: "Keep" });
    const role2 = await LfRole.create({ label: "Add" });
    await user.roles().attach(role1.getAttribute("id"));

    await user.roles().syncWithoutDetaching([role2.getAttribute("id")]);

    const roles = await user.roles().get();
    expect(roles).toHaveLength(2);
  });
});

// ─── BelongsToMany.as() ──────────────────────────────────────────────────────

describe("BelongsToMany as()", () => {
  beforeAll(setupPivot);

  test("renames pivot accessor on result", async () => {
    const user = await LfUser.create({ name: "As User" });
    const role = await LfRole.create({ label: "Sub" });
    await user.subscriptions().attach(role.getAttribute("id"), { expires_at: "2099-01-01" });

    const roles = await user.subscriptions().get();
    expect((roles[0] as any).subscription).toBeDefined();
    expect((roles[0] as any).subscription.expires_at).toBe("2099-01-01");
    expect((roles[0] as any).pivot).toBeUndefined();
  });

  test("custom accessor also works during eager loading", async () => {
    const user = await LfUser.create({ name: "As Eager User" });
    const role = await LfRole.create({ label: "EagerSub" });
    await user.subscriptions().attach(role.getAttribute("id"), { expires_at: "2088-06-15" });

    const users = await LfUser.with("subscriptions").where("id", user.getAttribute("id")).get();
    const loaded = users[0].getRelation("subscriptions");
    expect((loaded[0] as any).subscription).toBeDefined();
    expect((loaded[0] as any).subscription.expires_at).toBe("2088-06-15");
  });
});
