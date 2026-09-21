import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { MissingAttributeError, Model, ObserverRegistry, Schema } from "../src/index.js";
import { PermissiveModel, setupTestDb } from "./helpers.js";

// ─── Models ──────────────────────────────────────────────────────────────────

class PushUser extends PermissiveModel {
  declare id: number;
  declare name: string;
  static table = "push_users";
  posts() { return this.hasMany(PushPost, "push_user_id"); }
}

class PushPost extends PermissiveModel {
  declare id: number;
  declare push_user_id: number | null;
  declare title: string;
  static table = "push_posts";
  author() { return this.belongsTo(PushUser, "push_user_id"); }
  comments() { return this.hasMany(PushComment, "push_post_id"); }
}

class PushComment extends PermissiveModel {
  declare id: number;
  declare push_post_id: number | null;
  declare body: string;
  static table = "push_comments";
  post() { return this.belongsTo(PushPost, "push_post_id"); }
}

class KeyedTicket extends PermissiveModel {
  declare code: string;
  declare subject: string;
  static table = "keyed_tickets";
  static primaryKey = "code";
  static incrementing = false;
  static keyType = "string" as const;
}

class Preference extends PermissiveModel {
  declare id: number;
  declare label: string;
  declare settings: { theme: string };
  declare active: boolean;
  static table = "preferences";
  static casts = { settings: "json", active: "boolean" };
}

/** Strict mode is set on this class only — never on `Model`. */
class StrictArticle extends PermissiveModel {
  declare id: number;
  declare title: string;
  declare body?: string | null;
  declare views?: number;
  declare created_at?: string;
  static table = "strict_articles";
  static casts = { views: "number" };
  author() { return this.belongsTo(PushUser, "push_user_id"); }
}

class LooseArticle extends PermissiveModel {
  declare id: number;
  declare title: string;
  declare body?: string | null;
  static table = "strict_articles";
}

async function setup() {
  setupTestDb();
  await Schema.create("push_users", (t) => {
    t.increments("id");
    t.string("name");
    t.timestamps();
  });
  await Schema.create("push_posts", (t) => {
    t.increments("id");
    t.integer("push_user_id").nullable();
    t.string("title");
    t.timestamps();
  });
  await Schema.create("push_comments", (t) => {
    t.increments("id");
    t.integer("push_post_id").nullable();
    t.string("body");
    t.timestamps();
  });
  await Schema.create("keyed_tickets", (t) => {
    t.string("code").primary();
    t.string("subject");
    t.timestamps();
  });
  await Schema.create("preferences", (t) => {
    t.increments("id");
    t.string("label");
    t.text("settings").nullable();
    t.boolean("active").default(true);
    t.timestamps();
  });
  await Schema.create("strict_articles", (t) => {
    t.increments("id");
    t.integer("push_user_id").nullable();
    t.string("title");
    t.text("body").nullable();
    t.integer("views").nullable();
    t.timestamps();
  });
}

// ─── push() ──────────────────────────────────────────────────────────────────

describe("push()", () => {
  beforeAll(setup);
  afterAll(() => {
    ObserverRegistry.unregister(PushPost);
    ObserverRegistry.unregister(PushUser);
  });

  test("saves the model and every loaded relation", async () => {
    const user = await PushUser.create({ name: "Ada" });
    await PushPost.create({ push_user_id: user.id, title: "First" });

    const loaded = (await PushUser.with("posts").find(user.id))!;
    loaded.name = "Ada Lovelace";
    loaded.posts[0].title = "First, edited";
    await loaded.push();

    expect((await PushUser.find(user.id))!.name).toBe("Ada Lovelace");
    expect((await PushPost.where("push_user_id", user.id).first())!.title).toBe("First, edited");
  });

  test("returns the model itself", async () => {
    const user = await PushUser.create({ name: "Returned" });
    expect(await user.push()).toBe(user);
  });

  test("cascades through nested relations", async () => {
    const user = await PushUser.create({ name: "Grace" });
    const post = await PushPost.create({ push_user_id: user.id, title: "Deep" });
    const comment = await PushComment.create({ push_post_id: post.id, body: "Nested" });

    const loaded = (await PushComment.with("post.author").find(comment.id))!;
    loaded.body = "Nested, edited";
    loaded.post!.title = "Deep, edited";
    loaded.post!.author!.name = "Grace Hopper";
    await loaded.push();

    expect((await PushComment.find(comment.id))!.body).toBe("Nested, edited");
    expect((await PushPost.find(post.id))!.title).toBe("Deep, edited");
    expect((await PushUser.find(user.id))!.name).toBe("Grace Hopper");
  });

  test("inserts a loaded relation that does not exist yet", async () => {
    const user = await PushUser.create({ name: "Inserter" });
    const loaded = (await PushUser.find(user.id))!;
    const fresh = new PushPost({ push_user_id: user.id, title: "Unsaved" });
    loaded.setRelation("posts", [fresh]);

    await loaded.push();

    expect(fresh.$exists).toBe(true);
    expect((await PushPost.where("title", "Unsaved").first())!.push_user_id).toBe(user.id);
  });

  test("leaves rows outside the loaded relations untouched", async () => {
    const user = await PushUser.create({ name: "Partial" });
    const kept = await PushPost.create({ push_user_id: user.id, title: "Kept" });
    const edited = await PushPost.create({ push_user_id: user.id, title: "Edited" });
    const otherUser = await PushUser.create({ name: "Bystander" });
    const keptBefore = { ...(await PushPost.find(kept.id))!.getAttributes() };

    const loaded = (await PushUser.with({ posts: (q) => q.where("id", edited.id) }).find(user.id))!;
    loaded.posts[0].title = "Edited twice";
    await loaded.push();

    expect((await PushPost.find(kept.id))!.getAttributes()).toEqual(keptBefore);
    expect((await PushUser.find(otherUser.id))!.name).toBe("Bystander");
    expect(await PushComment.count()).toBe(await PushComment.count());
  });

  test("never re-associates a relation: foreign keys stay as they are", async () => {
    const owner = await PushUser.create({ name: "Owner" });
    const stranger = await PushUser.create({ name: "Stranger" });
    const post = await PushPost.create({ push_user_id: stranger.id, title: "Borrowed" });

    const loaded = (await PushUser.find(owner.id))!;
    loaded.setRelation("posts", [post]);
    await loaded.push();

    expect((await PushPost.find(post.id))!.push_user_id).toBe(stranger.id);
  });

  test("saves each model once when relations form a cycle", async () => {
    const saved: string[] = [];
    ObserverRegistry.register(PushUser, { saved: (m: any) => { saved.push(`user:${m.id}`); } });
    ObserverRegistry.register(PushPost, { saved: (m: any) => { saved.push(`post:${m.id}`); } });

    const user = await PushUser.create({ name: "Cyclic" });
    const post = await PushPost.create({ push_user_id: user.id, title: "Cyclic post" });
    saved.length = 0;

    user.setRelation("posts", [post]);
    post.setRelation("author", user);
    user.name = "Cyclic, edited";
    post.title = "Cyclic post, edited";
    await user.push();

    expect(saved).toEqual([`user:${user.id}`, `post:${post.id}`]);
    expect((await PushPost.find(post.id))!.title).toBe("Cyclic post, edited");

    ObserverRegistry.unregister(PushUser);
    ObserverRegistry.unregister(PushPost);
  });

  test("forwards save options to the whole cascade", async () => {
    const saved: string[] = [];
    ObserverRegistry.register(PushUser, { saved: (m: any) => { saved.push(`user:${m.id}`); } });
    ObserverRegistry.register(PushPost, { saved: (m: any) => { saved.push(`post:${m.id}`); } });

    const user = await PushUser.create({ name: "Quiet" });
    const post = await PushPost.create({ push_user_id: user.id, title: "Quiet post" });
    user.setRelation("posts", [post]);
    saved.length = 0;

    user.name = "Quiet, edited";
    post.title = "Quiet post, edited";
    await user.push({ events: false });

    expect(saved).toEqual([]);
    expect((await PushPost.find(post.id))!.title).toBe("Quiet post, edited");

    ObserverRegistry.unregister(PushUser);
    ObserverRegistry.unregister(PushPost);
  });
});

// ─── getKey() / getKeyName() / getAttributes() ───────────────────────────────

describe("key and attribute accessors", () => {
  beforeAll(setup);

  test("getKeyName() and getKey() read the configured primary key", async () => {
    const user = await PushUser.create({ name: "Keyed" });
    expect(user.getKeyName()).toBe("id");
    expect(user.getKey()).toBe(user.id);

    const ticket = await KeyedTicket.create({ code: "T-1", subject: "Broken" });
    expect(ticket.getKeyName()).toBe("code");
    expect(ticket.getKey()).toBe("T-1");
  });

  test("getAttributes() returns the raw bag, not cast values", async () => {
    const pref = await Preference.create({ label: "raw", settings: { theme: "dark" }, active: true });
    const raw = pref.getAttributes();

    expect(typeof raw.settings).toBe("string");
    expect(raw.label).toBe("raw");
    expect(pref.settings).toEqual({ theme: "dark" });
  });

  test("the returned bag is a copy: editing it does not reach the model", async () => {
    const pref = await Preference.create({ label: "copy", settings: { theme: "dark" } });
    const raw = pref.getAttributes();
    raw.label = "hijacked";
    (raw as any).injected = true;

    expect(pref.label).toBe("copy");
    expect(pref.getAttribute("label")).toBe("copy");
    expect(Object.hasOwn(pref.$attributes, "injected")).toBe(false);
    expect((await Preference.find(pref.id))!.label).toBe("copy");
  });

  test("folds a mutated json cast back in without settling the dirty state", async () => {
    const pref = await Preference.create({ label: "mutable", settings: { theme: "dark" } });
    pref.settings.theme = "light";

    expect(JSON.parse(pref.getAttributes().settings)).toEqual({ theme: "light" });
    expect(pref.isDirty("settings")).toBe(true);
    expect((await Preference.find(pref.id))!.settings).toEqual({ theme: "dark" });
  });
});

// ─── Strict mode ─────────────────────────────────────────────────────────────

describe("strict mode", () => {
  beforeAll(setup);

  test("ships disabled: a column the query skipped reads as undefined", async () => {
    await LooseArticle.create({ title: "Default", body: "Present" });
    const partial = (await LooseArticle.select("id", "title").first())!;

    expect(Model.preventAccessingMissingAttributes).toBe(false);
    expect(Model.preventSilentlyDiscardingAttributes).toBe(false);
    expect(Model.preventLazyLoading).toBe(false);
    expect(partial.body).toBeUndefined();
    expect(partial.getAttribute("body")).toBeUndefined();
  });

  test("shouldBeStrict() flips the three guards on that model alone", () => {
    try {
      StrictArticle.shouldBeStrict();

      expect(StrictArticle.preventAccessingMissingAttributes).toBe(true);
      expect(StrictArticle.preventSilentlyDiscardingAttributes).toBe(true);
      expect(StrictArticle.preventLazyLoading).toBe(true);

      // Blast radius: the base class and its other subclasses stay permissive.
      expect(Model.preventAccessingMissingAttributes).toBe(false);
      expect(Model.preventSilentlyDiscardingAttributes).toBe(false);
      expect(Model.preventLazyLoading).toBe(false);
      expect(PermissiveModel.preventAccessingMissingAttributes).toBe(false);
      expect(LooseArticle.preventAccessingMissingAttributes).toBe(false);
      expect(PushUser.preventAccessingMissingAttributes).toBe(false);
    } finally {
      StrictArticle.shouldBeStrict(false);
    }
    expect(StrictArticle.preventAccessingMissingAttributes).toBe(false);
    expect(StrictArticle.preventLazyLoading).toBe(false);
  });

  test("throws on a column the query never selected", async () => {
    await StrictArticle.create({ title: "Strict", body: "Hidden", views: 3 });
    try {
      StrictArticle.shouldBeStrict();
      const partial = (await StrictArticle.select("id", "title").where("title", "Strict").first())!;

      expect(() => partial.body).toThrow(MissingAttributeError);
      expect(() => partial.getAttribute("body")).toThrow(
        "The attribute [body] either does not exist or was not retrieved for model [StrictArticle]"
      );
      expect(partial.title).toBe("Strict");
      expect(partial.getKey()).toBe(partial.id);

      // Same row, same partial select, on a model that is not strict.
      const loose = (await LooseArticle.select("id", "title").where("title", "Strict").first())!;
      expect(loose.body).toBeUndefined();
    } finally {
      StrictArticle.shouldBeStrict(false);
    }
  });

  test("stays quiet for names the model knows about", async () => {
    const created = await StrictArticle.create({ title: "Exempt" });
    const plain = (await StrictArticle.select("id", "title").where("title", "Exempt").first())!;
    const loaded = (await StrictArticle.select("id", "title").where("title", "Exempt").first())!;
    loaded.setRelation("author", null);
    try {
      StrictArticle.shouldBeStrict();

      expect(created.body).toBeUndefined();           // just created: defaults may be unread
      expect(new StrictArticle().body).toBeUndefined(); // never persisted
      expect(plain.views).toBeUndefined();             // declared cast
      expect(plain.created_at).toBeUndefined();        // implicit timestamp cast
      expect(loaded.getRelation("author")).toBeNull(); // loaded relation
      expect(typeof plain.author).toBe("function");    // relation method
      expect(await plain).toBe(plain);                 // `then` probe stays a no-op
      expect(() => plain.toJSON()).not.toThrow();
      expect(plain.toJSON().title).toBe("Exempt");
    } finally {
      StrictArticle.shouldBeStrict(false);
    }
  });
});
