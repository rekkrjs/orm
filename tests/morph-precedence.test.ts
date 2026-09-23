import { describe, test, expect, beforeAll, afterAll } from "./harness.js";
import { Connection, Model, MorphMap, Schema } from "../src/index.js";
import { PermissiveModel, setupTestDb, teardownTestDb } from "./helpers.js";

class PComment extends PermissiveModel {
  static override table = "p_comments";
  static override timestamps = false;
  static override softDeletes = true;

  commentable() {
    return this.morphTo("commentable");
  }
}

class PPost extends PermissiveModel {
  static override table = "p_posts";
  static override timestamps = false;
}

class PVideo extends PermissiveModel {
  static override table = "p_videos";
  static override timestamps = false;
}

let connection: Connection;

beforeAll(async () => {
  connection = setupTestDb();

  MorphMap.register("PPost", PPost);
  MorphMap.register("PVideo", PVideo);

  await Schema.create("p_posts", (table) => {
    table.increments("id");
    table.string("title");
  });
  await Schema.create("p_videos", (table) => {
    table.increments("id");
    table.string("title");
  });
  await Schema.create("p_comments", (table) => {
    table.increments("id");
    table.string("body");
    table.integer("commentable_id");
    table.string("commentable_type");
    table.timestamp("deleted_at").nullable();
  });

  const post = await PPost.create({ title: "Target" });
  const video = await PVideo.create({ title: "Target" });

  await PComment.create({ body: "live post comment", commentable_id: post.getAttribute("id"), commentable_type: "PPost" });
  const deletedVideoComment = await PComment.create({
    body: "deleted video comment",
    commentable_id: video.getAttribute("id"),
    commentable_type: "PVideo",
  });
  await deletedVideoComment.delete();
});

afterAll(async () => {
  await teardownTestDb(connection);
});

describe("whereHasMorph precedence", () => {
  test("the soft-delete scope applies to every morph branch, not just the first", async () => {
    const rows = await PComment.whereHasMorph("commentable", [PPost, PVideo], (query) => {
      query.where("title", "Target");
    }).get();

    // Without parentheses this compiles to
    //   (deleted_at IS NULL AND EXISTS(post)) OR EXISTS(video)
    // and the trashed PVideo comment leaks back into the result set.
    expect(rows.map((row) => row.getAttribute("body"))).toEqual(["live post comment"]);
  });

  test("the generated SQL groups the morph branches", () => {
    const sql = PComment.whereHasMorph("commentable", [PPost, PVideo], (query) => {
      query.where("title", "Target");
    }).toSql();

    expect(sql).toMatch(/\(\s*EXISTS.*OR EXISTS.*\)/s);
  });

  test("an explicit where still ANDs against the whole morph group", async () => {
    const rows = await PComment.whereHasMorph("commentable", [PPost, PVideo], (query) => {
      query.where("title", "Target");
    }).where("body", "deleted video comment").withTrashed().get();

    expect(rows.map((row) => row.getAttribute("body"))).toEqual(["deleted video comment"]);
  });

  test("a single morph type is unaffected", async () => {
    const rows = await PComment.whereHasMorph("commentable", [PPost], (query) => {
      query.where("title", "Target");
    }).get();

    expect(rows.map((row) => row.getAttribute("body"))).toEqual(["live post comment"]);
  });

  test("whereDoesntHaveMorph keeps its AND-of-NOT-EXISTS semantics", async () => {
    const rows = await PComment.withTrashed()
      .whereDoesntHaveMorph("commentable", [PPost], (query) => {
        query.where("title", "Target");
      })
      .get();

    expect(rows.map((row) => row.getAttribute("body"))).toEqual(["deleted video comment"]);
  });
});
