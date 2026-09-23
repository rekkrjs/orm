import { describe, test, expect, beforeAll, afterAll } from "./harness.js";
import { Connection, Model, Schema } from "../src/index.js";
import { PermissiveModel, setupTestDb, teardownTestDb } from "./helpers.js";

interface AuthorAttributes { id: number; name: string }
interface CommentAttributes { id: number; author_id: number; body: string; approved: number }
interface TagAttributes { id: number; label: string }

class Author extends PermissiveModel.define<AuthorAttributes>("authors") {
  static override timestamps = false;

  comments() {
    return this.hasMany(Comment, "author_id").where("approved", 1);
  }

  allComments() {
    return this.hasMany(Comment, "author_id");
  }

  recentComments() {
    return this.hasMany(Comment, "author_id").orderBy("body", "desc");
  }

  firstComments() {
    return this.hasMany(Comment, "author_id").limit(1);
  }

  recentApproved() {
    return this.hasMany(Comment, "author_id").where("approved", 1).orderBy("body", "desc");
  }

  tags() {
    return this.belongsToMany(Tag, "author_tag", "author_id", "tag_id").where("label", "featured");
  }
}

class Comment extends PermissiveModel.define<CommentAttributes>("comments") {
  static override timestamps = false;
}

class Tag extends PermissiveModel.define<TagAttributes>("tags") {
  static override timestamps = false;
}

let connection: Connection;

beforeAll(async () => {
  connection = setupTestDb();

  await Schema.create("authors", (table) => {
    table.increments("id");
    table.string("name");
  });
  await Schema.create("comments", (table) => {
    table.increments("id");
    table.integer("author_id");
    table.string("body");
    table.integer("approved");
  });
  await Schema.create("tags", (table) => {
    table.increments("id");
    table.string("label");
  });
  await Schema.create("author_tag", (table) => {
    table.integer("author_id");
    table.integer("tag_id");
  });

  const ada = await Author.create({ name: "Ada" });
  const linus = await Author.create({ name: "Linus" });

  await Comment.create({ author_id: ada.getAttribute("id"), body: "yes", approved: 1 });
  await Comment.create({ author_id: ada.getAttribute("id"), body: "nope", approved: 0 });
  await Comment.create({ author_id: ada.getAttribute("id"), body: "also nope", approved: 0 });
  // Linus only ever wrote unapproved comments.
  await Comment.create({ author_id: linus.getAttribute("id"), body: "spam", approved: 0 });

  const featured = await Tag.create({ label: "featured" });
  const boring = await Tag.create({ label: "boring" });
  await linus.tags().attach([featured.getAttribute("id")]);
  await ada.tags().attach([boring.getAttribute("id")]);
});

afterAll(async () => {
  await teardownTestDb(connection);
});

describe("relation constraints in existence queries", () => {
  test("withCount() honours the relation's own where(), matching with()", async () => {
    const [ada] = await Author.withCount("comments").where("name", "Ada").get();
    const eager = await Author.with("comments").where("name", "Ada").first();

    expect(ada!.getAttribute("comments_count")).toBe(1);
    expect(eager!.getRelation("comments")).toHaveLength(1);
    // The whole point: the two paths must agree.
    expect(ada!.getAttribute("comments_count")).toBe(eager!.getRelation("comments").length);
  });

  test("an unconstrained relation still counts everything", async () => {
    const [ada] = await Author.withCount("allComments").where("name", "Ada").get();
    expect(ada!.getAttribute("allComments_count")).toBe(3);
  });

  test("has() honours the relation's own where()", async () => {
    const authors = await Author.has("comments").get();
    expect(authors.map((a) => a.getAttribute("name"))).toEqual(["Ada"]);
  });

  test("doesntHave() honours the relation's own where()", async () => {
    const authors = await Author.doesntHave("comments").get();
    expect(authors.map((a) => a.getAttribute("name"))).toEqual(["Linus"]);
  });

  test("has() honours constraints on a belongsToMany relation", async () => {
    const authors = await Author.has("tags").get();
    expect(authors.map((a) => a.getAttribute("name"))).toEqual(["Linus"]);
  });

  test("withCount() honours constraints on a belongsToMany relation", async () => {
    const authors = await Author.withCount("tags").get();
    const byName = Object.fromEntries(authors.map((a) => [a.getAttribute("name"), a.getAttribute("tags_count")]));
    expect(byName).toEqual({ Ada: 0, Linus: 1 });
  });
});

describe("sync()/toggle() id comparison", () => {
  test("string ids from the driver match numeric ids from the caller", async () => {
    const [ada] = await Author.query().where("name", "Ada").get();
    const featured = await Tag.query().where("label", "featured").first();
    const boring = await Tag.query().where("label", "boring").first();

    const featuredId = featured!.getAttribute("id");
    const boringId = boring!.getAttribute("id");

    // Seed the pivot with the two tags.
    await ada!.tags().sync([featuredId, boringId]);

    // Re-syncing with the *string* forms — what a Postgres bigint column hands
    // back — must be a no-op, not a full detach + re-attach.
    const result = await ada!.tags().sync([String(featuredId), String(boringId)]);
    expect(result.attached).toEqual([]);
    expect(result.detached).toEqual([]);
  });

  test("toggle() sees an existing row regardless of id type", async () => {
    const [linus] = await Author.query().where("name", "Linus").get();
    const featured = await Tag.query().where("label", "featured").first();
    const id = featured!.getAttribute("id");

    const first = await linus!.tags().toggle([String(id)]);
    // Linus already has the featured tag from the fixture, so it detaches.
    expect(first.detached.map(String)).toEqual([String(id)]);
    expect(first.attached).toEqual([]);

    const second = await linus!.tags().toggle([Number(id)]);
    expect(second.attached.map(String)).toEqual([String(id)]);
    expect(second.detached).toEqual([]);
  });
});

describe("constraints that must not reach an aggregate subquery", () => {
  test("orderBy() is not replayed into COUNT(*)", () => {
    // `SELECT COUNT(*) ... ORDER BY created_at` is rejected by PostgreSQL and by
    // MySQL under ONLY_FULL_GROUP_BY: the column is neither grouped nor
    // aggregated. SQLite accepts it, so only the SQL shape can catch this.
    const sql = Author.withCount("recentComments").toSql();
    expect(sql).toContain("COUNT(*)");
    expect(sql).not.toContain("ORDER BY");
  });

  test("limit() is not replayed into COUNT(*), where it would be a silent no-op", () => {
    const sql = Author.withCount("firstComments").toSql();
    expect(sql).toContain("COUNT(*)");
    expect(sql).not.toContain("LIMIT");
  });

  test("orderBy() is not replayed into EXISTS either", () => {
    expect(Author.has("recentComments").toSql()).not.toContain("ORDER BY");
  });

  test("where() constraints are still replayed alongside them", async () => {
    const sql = Author.withCount("recentApproved").toSql();
    expect(sql).toContain("approved");
    expect(sql).not.toContain("ORDER BY");

    const [ada] = await Author.withCount("recentApproved").where("name", "Ada").get();
    expect(ada!.getAttribute("recentApproved_count")).toBe(1);
  });

  test("the eager-loading path still honours orderBy and limit", async () => {
    const author = await Author.with("firstComments").where("name", "Ada").first();
    expect(author!.getRelation("firstComments")).toHaveLength(1);

    const ordered = await Author.with("recentComments").where("name", "Ada").first();
    const bodies = ordered!.getRelation("recentComments").map((c: any) => c.getAttribute("body"));
    expect(bodies).toEqual([...bodies].sort().reverse());
  });
});
