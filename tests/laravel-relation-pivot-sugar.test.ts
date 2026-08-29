import { beforeAll, describe, expect, test } from "bun:test";
import { Collection, Schema } from "../src/index.js";
import { PermissiveModel, setupTestDb } from "./helpers.js";

interface UserAttrs { id: number; name: string }
interface PostAttrs { id: number; user_id: number; title: string; status: string; score: number }
interface TagAttrs { id: number; name: string }
interface VideoAttrs { id: number; title: string }
interface ActivityAttrs { id: number; label: string; subject_id: number; subject_type: string }
interface PivotOwnerAttrs { id: number; name: string }
interface PivotItemAttrs { id: number; name: string }

class SugarRelationTag extends PermissiveModel.define<TagAttrs>("laravel_relation_tags") {
  static override timestamps = false;
}

class SugarRelationUser extends PermissiveModel.define<UserAttrs>("laravel_relation_users") {
  static override timestamps = false;

  posts() {
    return this.hasMany(SugarRelationPost, "user_id");
  }
}

class SugarRelationPost extends PermissiveModel.define<PostAttrs>("laravel_relation_posts") {
  static override timestamps = false;

  author() {
    return this.belongsTo(SugarRelationUser, "user_id");
  }

  tags() {
    return this.belongsToMany(SugarRelationTag, "laravel_relation_post_tag", "post_id", "tag_id")
      .withPivot("priority", "note");
  }
}

class SugarRelationVideo extends PermissiveModel.define<VideoAttrs>("laravel_relation_videos") {
  static override timestamps = false;
}

class SugarRelationActivity extends PermissiveModel.define<ActivityAttrs>("laravel_relation_activities") {
  static override timestamps = false;

  subject() {
    return this.morphTo("subject");
  }
}

class SugarPivotItem extends PermissiveModel.define<PivotItemAttrs>("laravel_pivot_items") {
  static override timestamps = false;
}

class SugarPivotOwner extends PermissiveModel.define<PivotOwnerAttrs>("laravel_pivot_owners") {
  static override timestamps = false;

  items() {
    return this.belongsToMany(SugarPivotItem, "laravel_pivot_owner_item", "owner_id", "item_id")
      .withPivot("priority", "note");
  }

  rankedItems() {
    return this.belongsToMany(SugarPivotItem, "laravel_pivot_owner_item", "owner_id", "item_id")
      .withPivot("priority", "note")
      .orderByPivotDesc("priority");
  }
}

class SugarMorphPivotOwner extends PermissiveModel.define<PivotOwnerAttrs>("laravel_morph_pivot_owners") {
  static override timestamps = false;

  items() {
    return this.morphToMany(
      SugarPivotItem,
      "itemable",
      "laravel_morph_itemables",
      "itemable_id",
      "item_id",
    ).withPivot("priority", "note");
  }

  rankedItems() {
    return this.morphToMany(
      SugarPivotItem,
      "itemable",
      "laravel_morph_itemables",
      "itemable_id",
      "item_id",
    ).withPivot("priority", "note").orderByPivotDesc("priority");
  }
}

const names = (items: Collection<any>) => items.map((item) => item.name);

describe("Laravel relation and pivot syntax sugar", () => {
  let ada: SugarRelationUser;
  let bob: SugarRelationUser;
  let cyd: SugarRelationUser;
  let dee: SugarRelationUser;
  let adaPublished: SugarRelationPost;
  let adaDraft: SugarRelationPost;
  let bobDraft: SugarRelationPost;
  let deePublished: SugarRelationPost;
  let relationTagA: SugarRelationTag;
  let relationTagB: SugarRelationTag;
  let video: SugarRelationVideo;
  let pivotOwner: SugarPivotOwner;
  let morphPivotOwner: SugarMorphPivotOwner;
  let unattachedMorphOwner: SugarMorphPivotOwner;

  beforeAll(async () => {
    setupTestDb();

    await Schema.create("laravel_relation_users", (table) => {
      table.increments("id");
      table.string("name");
    });
    await Schema.create("laravel_relation_posts", (table) => {
      table.increments("id");
      table.integer("user_id");
      table.string("title");
      table.string("status");
      table.integer("score");
    });
    await Schema.create("laravel_relation_tags", (table) => {
      table.increments("id");
      table.string("name");
    });
    await Schema.create("laravel_relation_post_tag", (table) => {
      table.increments("id");
      table.integer("post_id");
      table.integer("tag_id");
      table.integer("priority").nullable();
      table.string("note").nullable();
    });
    await Schema.create("laravel_relation_videos", (table) => {
      table.increments("id");
      table.string("title");
    });
    await Schema.create("laravel_relation_activities", (table) => {
      table.increments("id");
      table.string("label");
      table.integer("subject_id");
      table.string("subject_type");
    });
    await Schema.create("laravel_pivot_items", (table) => {
      table.increments("id");
      table.string("name");
    });
    await Schema.create("laravel_pivot_owners", (table) => {
      table.increments("id");
      table.string("name");
    });
    await Schema.create("laravel_pivot_owner_item", (table) => {
      table.increments("id");
      table.integer("owner_id");
      table.integer("item_id");
      table.integer("priority");
      table.string("note").nullable();
    });
    await Schema.create("laravel_morph_pivot_owners", (table) => {
      table.increments("id");
      table.string("name");
    });
    await Schema.create("laravel_morph_itemables", (table) => {
      table.increments("id");
      table.integer("itemable_id");
      table.integer("item_id");
      table.string("itemable_type");
      table.integer("priority");
      table.string("note").nullable();
    });

    ada = await SugarRelationUser.create({ name: "Ada" });
    bob = await SugarRelationUser.create({ name: "Bob" });
    cyd = await SugarRelationUser.create({ name: "Cyd" });
    dee = await SugarRelationUser.create({ name: "Dee" });
    adaPublished = await SugarRelationPost.create({ user_id: ada.id, title: "Ada published", status: "published", score: 10 });
    adaDraft = await SugarRelationPost.create({ user_id: ada.id, title: "Ada draft", status: "draft", score: 20 });
    bobDraft = await SugarRelationPost.create({ user_id: bob.id, title: "Bob draft", status: "draft", score: 30 });
    deePublished = await SugarRelationPost.create({ user_id: dee.id, title: "Dee published", status: "published", score: 40 });

    relationTagA = await SugarRelationTag.create({ name: "Relation A" });
    relationTagB = await SugarRelationTag.create({ name: "Relation B" });
    await adaPublished.tags().attach(relationTagA.id, { priority: 1, note: null });
    await deePublished.tags().attach(relationTagB.id, { priority: 2, note: "attached" });

    video = await SugarRelationVideo.create({ title: "Video" });
    await SugarRelationActivity.create({ label: "Ada activity", subject_id: adaPublished.id, subject_type: "SugarRelationPost" });
    await SugarRelationActivity.create({ label: "Bob activity", subject_id: bobDraft.id, subject_type: "SugarRelationPost" });
    await SugarRelationActivity.create({ label: "Video activity", subject_id: video.id, subject_type: "SugarRelationVideo" });

    const pivotItems = await Promise.all([1, 2, 3, 4].map((number) => SugarPivotItem.create({ name: `Item ${number}` })));
    pivotOwner = await SugarPivotOwner.create({ name: "Pivot owner" });
    morphPivotOwner = await SugarMorphPivotOwner.create({ name: "Morph pivot owner" });
    unattachedMorphOwner = await SugarMorphPivotOwner.create({ name: "Unattached morph owner" });
    const notes = [null, "two", null, "four"];
    for (let index = 0; index < pivotItems.length; index++) {
      const attributes = { priority: index + 1, note: notes[index] };
      await pivotOwner.items().attach(pivotItems[index].id, attributes);
      await morphPivotOwner.items().attach(pivotItems[index].id, attributes);
    }
  });

  test("whereDoesntHaveRelation supports shorthand, operators, misses, builder, and static calls", async () => {
    const noPublished = await SugarRelationUser.whereDoesntHaveRelation("posts", "status", "published").orderBy("name").get();
    expect(names(noPublished)).toEqual(["Bob", "Cyd"]);

    const noHighScore = await SugarRelationUser.query()
      .whereDoesntHaveRelation("posts", "score", ">=", 30)
      .orderBy("name")
      .get();
    expect(names(noHighScore)).toEqual(["Ada", "Cyd"]);

    expect(await SugarRelationUser.whereDoesntHaveRelation("posts", "status", "missing").count()).toBe(4);
    expect(SugarRelationUser.whereDoesntHaveRelation("posts", "status", "published").toSql()).toContain(") < 1");
  });

  test("orWhereDoesntHaveRelation keeps its OR branch and supports comparison form", async () => {
    const shorthand = await SugarRelationUser.where("name", "Ada")
      .orWhereDoesntHaveRelation("posts", "status", "published")
      .orderBy("name")
      .get();
    expect(names(shorthand)).toEqual(["Ada", "Bob", "Cyd"]);

    const compared = await SugarRelationUser.where("name", "Dee")
      .orWhereDoesntHaveRelation("posts", "score", ">=", 30)
      .orderBy("name")
      .get();
    expect(names(compared)).toEqual(["Ada", "Cyd", "Dee"]);
    expect(SugarRelationUser.where("name", "Ada").orWhereDoesntHaveRelation("posts", "status", "published").toSql())
      .toContain(" OR (SELECT COUNT(*)");
  });

  test("withWhereRelation filters parents and eager loads only matching children", async () => {
    const published = await SugarRelationUser.withWhereRelation("posts", "status", "published").orderBy("name").get();
    expect(names(published)).toEqual(["Ada", "Dee"]);
    for (const user of published) {
      const posts = user.getRelation("posts") as Collection<SugarRelationPost>;
      expect(posts.length).toBe(1);
      expect(posts.every((post) => post.status === "published")).toBe(true);
    }

    const scored = await SugarRelationUser.query().withWhereRelation("posts", "score", ">=", 30).orderBy("name").get();
    expect(names(scored)).toEqual(["Bob", "Dee"]);
    expect(scored.flatMap((user) => user.getRelation("posts")).map((post: SugarRelationPost) => post.score)).toEqual([30, 40]);
  });

  test("regression: withWhereHas applies its callback to the eager-loaded relation too", async () => {
    const users = await SugarRelationUser.withWhereHas("posts", (query) => query.where("status", "published"))
      .orderBy("name")
      .get();
    expect(names(users)).toEqual(["Ada", "Dee"]);
    expect(users.flatMap((user) => user.getRelation("posts")).map((post: SugarRelationPost) => post.title))
      .toEqual(["Ada published", "Dee published"]);
  });

  test("orWhereNotMorphedTo supports model, class, and morph-name forms", async () => {
    const byModel = await SugarRelationActivity.whereRaw("0 = 1")
      .orWhereNotMorphedTo("subject", adaPublished)
      .orderBy("label")
      .get();
    expect(byModel.map((activity) => activity.label)).toEqual(["Bob activity", "Video activity"]);

    const byClass = await SugarRelationActivity.where("label", "Ada activity")
      .orWhereNotMorphedTo("subject", SugarRelationPost)
      .orderBy("label")
      .get();
    expect(byClass.map((activity) => activity.label)).toEqual(["Ada activity", "Video activity"]);

    const byName = await SugarRelationActivity.query().orWhereNotMorphedTo("subject", "SugarRelationPost").get();
    expect(byName.map((activity) => activity.label)).toEqual(["Video activity"]);
  });

  test("regression: relation shortcuts accept typed define models, collections, and unsaved instances", async () => {
    const scalar = await SugarRelationPost.where("title", "Ada draft").orWhereBelongsTo("author", bob).orderBy("title").get();
    expect(scalar.map((post) => post.title)).toEqual(["Ada draft", "Bob draft"]);

    const collection = await SugarRelationPost.where("title", "Ada draft")
      .orWhereBelongsTo("author", new Collection([bob, dee]))
      .orderBy("title")
      .get();
    expect(collection.map((post) => post.title)).toEqual(["Ada draft", "Bob draft", "Dee published"]);

    const unsaved = await SugarRelationPost.where("title", "Ada draft")
      .orWhereBelongsTo("author", new SugarRelationUser())
      .get();
    expect(unsaved.map((post) => post.title)).toEqual(["Ada draft"]);
  });

  test("orWhereAttachedTo handles belongsToMany, arrays, and morphToMany", async () => {
    const scalar = await SugarRelationPost.where("title", "Ada draft")
      .orWhereAttachedTo("tags", relationTagB)
      .orderBy("title")
      .get();
    expect(scalar.map((post) => post.title)).toEqual(["Ada draft", "Dee published"]);

    const multiple = await SugarRelationPost.whereRaw("0 = 1")
      .orWhereAttachedTo("tags", [relationTagA, relationTagB])
      .orderBy("title")
      .get();
    expect(multiple.map((post) => post.title)).toEqual(["Ada published", "Dee published"]);

    const morph = await SugarMorphPivotOwner.where("name", unattachedMorphOwner.name)
      .orWhereAttachedTo("items", await SugarPivotItem.findOrFail(1))
      .orderBy("name")
      .get();
    expect(names(morph)).toEqual(["Morph pivot owner", "Unattached morph owner"]);
  });

  test("BelongsToMany pivot OR and range helpers cover null, empty, scalar, and array cases", async () => {
    expect(names(await pivotOwner.items().wherePivot("priority", 1).orWherePivotNotIn("priority", [1, 2, 3]).orderByPivot("priority").get()))
      .toEqual(["Item 1", "Item 4"]);
    expect(names(await pivotOwner.items().wherePivot("priority", 1).orWherePivotNotIn("priority", []).orderByPivot("priority").get()))
      .toEqual(["Item 1", "Item 2", "Item 3", "Item 4"]);
    expect(names(await pivotOwner.items().wherePivot("priority", 1).orWherePivotNotNull("note").orderByPivot("priority").get()))
      .toEqual(["Item 1", "Item 2", "Item 4"]);
    expect(names(await pivotOwner.items().wherePivot("priority", 1).orWherePivotBetween("priority", [3, 4]).orderByPivot("priority").get()))
      .toEqual(["Item 1", "Item 3", "Item 4"]);
    expect(names(await pivotOwner.items().wherePivotNotBetween("priority", [2, 3]).orderByPivot("priority").get()))
      .toEqual(["Item 1", "Item 4"]);
    expect(names(await pivotOwner.items().wherePivot("priority", 2).orWherePivotNotBetween("priority", [2, 3]).orderByPivot("priority").get()))
      .toEqual(["Item 1", "Item 2", "Item 4"]);
  });

  test("pivot ordering supports defaults, explicit directions, desc sugar, validation, and eager replay", async () => {
    expect(names(await pivotOwner.items().orderByPivot("priority").get())).toEqual(["Item 1", "Item 2", "Item 3", "Item 4"]);
    expect(names(await pivotOwner.items().orderByPivot("priority", "desc").get())).toEqual(["Item 4", "Item 3", "Item 2", "Item 1"]);
    expect(names(await pivotOwner.items().orderByPivotDesc("priority").get())).toEqual(["Item 4", "Item 3", "Item 2", "Item 1"]);
    expect(() => pivotOwner.items().orderByPivot("priority", "sideways" as any)).toThrow("Invalid order direction");

    const loaded = await SugarPivotOwner.with("rankedItems").where("id", pivotOwner.id).firstOrFail();
    expect(names(loaded.getRelation("rankedItems"))).toEqual(["Item 4", "Item 3", "Item 2", "Item 1"]);

    const constrained = await SugarMorphPivotOwner.with("items", (query) => query.orderByPivotDesc("priority"))
      .where("id", morphPivotOwner.id)
      .firstOrFail();
    expect(names(constrained.getRelation("items"))).toEqual(["Item 4", "Item 3", "Item 2", "Item 1"]);
  });

  test("MorphToMany exposes the complete pivot helper family with matching behavior", async () => {
    expect(names(await morphPivotOwner.items().wherePivot("priority", 1).orWherePivotNotIn("priority", [1, 2, 3]).orderByPivot("priority").get()))
      .toEqual(["Item 1", "Item 4"]);
    expect(names(await morphPivotOwner.items().wherePivot("priority", 1).orWherePivotNotNull("note").orderByPivot("priority").get()))
      .toEqual(["Item 1", "Item 2", "Item 4"]);
    expect(names(await morphPivotOwner.items().wherePivot("priority", 1).orWherePivotBetween("priority", [3, 4]).orderByPivot("priority").get()))
      .toEqual(["Item 1", "Item 3", "Item 4"]);
    expect(names(await morphPivotOwner.items().wherePivotNotBetween("priority", [2, 3]).orderByPivot("priority").get()))
      .toEqual(["Item 1", "Item 4"]);
    expect(names(await morphPivotOwner.items().wherePivot("priority", 2).orWherePivotNotBetween("priority", [2, 3]).orderByPivotDesc("priority").get()))
      .toEqual(["Item 4", "Item 2", "Item 1"]);

    const loaded = await SugarMorphPivotOwner.with("rankedItems").where("id", morphPivotOwner.id).firstOrFail();
    expect(names(loaded.getRelation("rankedItems"))).toEqual(["Item 4", "Item 3", "Item 2", "Item 1"]);
  });

  test("regression: relation callback OR clauses stay grouped with their parent correlation", async () => {
    const owners = await SugarMorphPivotOwner.whereHas("items", (query) =>
      query.wherePivot("priority", 99).orWherePivotNotNull("note")
    ).orderBy("name").get();

    expect(names(owners)).toEqual(["Morph pivot owner"]);
    const sql = SugarMorphPivotOwner.whereHas("items", (query) =>
      query.wherePivot("priority", 99).orWherePivotNotNull("note")
    ).toSql();
    expect(sql).toContain("AND (");
    expect(sql).toContain(" OR ");
  });

  test("regression: qualified pivot columns are not prefixed twice", async () => {
    const belongs = pivotOwner.items().wherePivotNotBetween("laravel_pivot_owner_item.priority", [2, 3]);
    expect(belongs.getQuery().toSql()).not.toContain("laravel_pivot_owner_item.laravel_pivot_owner_item");
    expect(names(await belongs.orderByPivot("laravel_pivot_owner_item.priority").get())).toEqual(["Item 1", "Item 4"]);

    const morph = morphPivotOwner.items().wherePivotNotBetween("laravel_morph_itemables.priority", [2, 3]);
    expect(morph.getQuery().toSql()).not.toContain("laravel_morph_itemables.laravel_morph_itemables");
    expect(names(await morph.orderByPivotDesc("laravel_morph_itemables.priority").get())).toEqual(["Item 4", "Item 1"]);
  });

  test("relation and decorated pivot helpers remain type-visible throughout chains", async () => {
    if (false) {
      const user = await SugarRelationUser.withWhereRelation("posts", "status", "published").firstOrFail();
      user.posts[0]?.title.toUpperCase();
      SugarRelationUser.whereDoesntHaveRelation("posts", "score", ">", 10).get();
      SugarRelationUser.orWhereDoesntHaveRelation("posts", "status", "draft").get();
      SugarRelationPost.orWhereBelongsTo("author", ada).get();
      SugarRelationPost.orWhereAttachedTo("tags", relationTagA).get();
      SugarRelationActivity.orWhereNotMorphedTo("subject", SugarRelationPost).get();
      SugarPivotOwner.whereHas("items", (query) => query
        .orWherePivotNotIn("priority", [1])
        .orWherePivotNotNull("note")
        .orWherePivotBetween("priority", [1, 2])
        .wherePivotNotBetween("priority", [3, 4])
        .orWherePivotNotBetween("priority", [2, 3])
        .orderByPivot("priority")
        .orderByPivotDesc("priority"));
    }
    expect(true).toBe(true);
  });
});
