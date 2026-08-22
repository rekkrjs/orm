import { expect, test, describe, beforeAll } from "bun:test";
import { Model, Schema, ModelNotFoundError } from "../src/index.js";
import { PermissiveModel, setupTestDb } from "./helpers.js";

function expectType<T>(_value: T): void {}

class Post extends PermissiveModel {
  static table = "posts";

  comments() {
    return this.hasMany(Comment, "post_id");
  }
}

class Comment extends PermissiveModel {
  static table = "comments";
}

class Vote extends PermissiveModel {
  static table = "votes";
  static timestamps = false;
}

class LookupPost extends Model.define<{ id: number; title: string; email: string | null }>("lookup_posts") {
  static guarded: string[] = [];
}

class LookupToken extends Model.define<{ slug: string; label: string }>("lookup_tokens") {
  static guarded: string[] = [];
  static primaryKey = "slug";
  static incrementing = false;
  static timestamps = false;
}

describe("Lazy Eager Loading", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("posts", (table) => {
      table.increments("id");
      table.string("title");
      table.timestamps();
    });
    await Schema.create("comments", (table) => {
      table.increments("id");
      table.integer("post_id");
      table.string("body");
      table.timestamps();
    });

    const post = await Post.create({ title: "Hello" });
    await Comment.create({ post_id: post.id, body: "Nice post" });
    await Comment.create({ post_id: post.id, body: "Thanks" });
  });

  test("load fetches relations on existing model", async () => {
    const post = await Post.first() as Post;
    expect(post.getRelation("comments")).toBeUndefined();

    await post.load("comments");
    const comments = post.getRelation("comments");
    expect(Array.isArray(comments)).toBe(true);
    expect(comments.length).toBe(2);
    expect(comments[0].body).toBe("Nice post");
  });
});

describe("Find-or-Fail", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("posts", (table) => {
      table.increments("id");
      table.string("title");
      table.timestamps();
    });
    await Post.create({ title: "Find Me" });
  });

  test("findOrFail returns model when found", async () => {
    const post = await Post.findOrFail(1);
    expect(post).toBeInstanceOf(Post);
    expect(post.title).toBe("Find Me");
  });

  test("findOrFail throws when not found", async () => {
    expect(Post.findOrFail(9999)).rejects.toBeInstanceOf(ModelNotFoundError);
  });

  test("firstOrFail returns model when found", async () => {
    const post = await Post.firstOrFail();
    expect(post).toBeInstanceOf(Post);
    expect(post.title).toBe("Find Me");
  });

  test("firstOrFail throws when not found", async () => {
    await Post.query().delete();
    expect(Post.firstOrFail()).rejects.toBeInstanceOf(ModelNotFoundError);
  });
});

describe("Fallback retrieval terminators", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("lookup_posts", (table) => {
      table.increments("id");
      table.string("title");
      table.string("email").nullable();
      table.timestamps();
    });
    await Schema.create("lookup_tokens", (table) => {
      table.string("slug").primary();
      table.string("label");
    });
    await LookupPost.create({ title: "Existing", email: null });
    await LookupToken.create({ slug: "token-a", label: "Token A" });
  });

  test("firstOr skips the callback on a hit and awaits it on a miss", async () => {
    let calls = 0;
    const found = await LookupPost.where("title", "Existing").firstOr(() => {
      calls++;
      return "fallback" as const;
    });
    expect(found).toBeInstanceOf(LookupPost);
    expect(calls).toBe(0);

    const fallback = await LookupPost.where("title", "Missing").firstOr(async () => {
      calls++;
      return "async fallback" as const;
    });
    expect(fallback).toBe("async fallback");
    expect(calls).toBe(1);
  });

  test("findOr uses the model primary key and returns its fallback", async () => {
    let calls = 0;
    const found = await LookupToken.findOr("token-a", () => {
      calls++;
      return "missing" as const;
    });
    expect(found).toBeInstanceOf(LookupToken);
    expect(calls).toBe(0);

    const fallback = await LookupToken.findOr("token-b", () => {
      calls++;
      return "missing" as const;
    });
    expect(fallback).toBe("missing");
    expect(calls).toBe(1);
  });

  test("valueOrFail distinguishes a nullable value from a missing row", async () => {
    expect(await LookupPost.where("title", "Existing").valueOrFail("email")).toBeNull();
    expect(await LookupPost.valueOrFail("title")).toBe("Existing");
    await expect(LookupPost.where("title", "Missing").valueOrFail("email"))
      .rejects.toBeInstanceOf(ModelNotFoundError);
  });

  test("fallback terminators preserve result and callback types", async () => {
    const firstOrAsync = LookupPost.where("title", "Missing").firstOr(async () => "missing" as const);
    const firstOrSync = LookupPost.firstOr(() => 404 as const);
    const findOr = LookupToken.findOr("token-b", () => "missing" as const);
    const valueOrFail = LookupPost.valueOrFail("email");

    expectType<Promise<LookupPost | "missing">>(firstOrAsync);
    expectType<Promise<LookupPost | 404>>(firstOrSync);
    expectType<Promise<LookupToken | "missing">>(findOr);
    expectType<Promise<string | null>>(valueOrFail);
    await Promise.all([firstOrAsync, firstOrSync, findOr, valueOrFail]);
  });
});

describe("First-or-Create / Update-or-Create", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("posts", (table) => {
      table.increments("id");
      table.string("title");
      table.string("slug").nullable();
      table.timestamps();
    });
  });

  test("firstOrCreate finds existing record", async () => {
    const existing = await Post.create({ title: "Existing", slug: "existing" });
    const found = await Post.firstOrCreate({ title: "Existing" }, { slug: "new-slug" });
    expect(found.id).toBe(existing.id);
    expect(found.slug).toBe("existing");
  });

  test("firstOrCreate creates new record when not found", async () => {
    const created = await Post.firstOrCreate({ title: "Brand New" }, { slug: "brand-new" });
    expect(created).toBeInstanceOf(Post);
    expect(created.title).toBe("Brand New");
    expect(created.slug).toBe("brand-new");
    expect(created.$exists).toBe(true);
  });

  test("updateOrCreate updates existing record", async () => {
    const existing = await Post.create({ title: "Update Me", slug: "update-me" });
    const updated = await Post.updateOrCreate({ title: "Update Me" }, { slug: "updated-slug" });
    expect(updated.id).toBe(existing.id);
    expect(updated.slug).toBe("updated-slug");
  });

  test("updateOrCreate creates new record when not found", async () => {
    const created = await Post.updateOrCreate({ title: "Not Found" }, { slug: "not-found" });
    expect(created).toBeInstanceOf(Post);
    expect(created.title).toBe("Not Found");
    expect(created.slug).toBe("not-found");
  });
});

describe("Increment / Decrement", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("votes", (table) => {
      table.increments("id");
      table.integer("count").default(0);
      table.timestamps();
    });
  });

  test("increment adds amount and updates timestamps", async () => {
    const vote = await Vote.create({ count: 5 });
    const oldUpdated = vote.getAttribute("updated_at");
    await new Promise((r) => setTimeout(r, 10));

    await vote.increment("count", 3);
    expect(vote.count).toBe(8);

    const refreshed = await Vote.find(vote.id);
    expect(refreshed!.count).toBe(8);
  });

  test("decrement subtracts amount", async () => {
    const vote = await Vote.create({ count: 10 });
    await vote.decrement("count", 4);
    expect(vote.count).toBe(6);

    const refreshed = await Vote.find(vote.id);
    expect(refreshed!.count).toBe(6);
  });

  test("increment with extra attributes", async () => {
    await Schema.table("votes", (table) => {
      table.string("label").nullable();
    });
    const vote = await Vote.create({ count: 0 });
    await vote.increment("count", 1, { label: "boosted" });
    expect(vote.count).toBe(1);
    expect(vote.getAttribute("label")).toBe("boosted");

    const refreshed = await Vote.find(vote.id);
    expect(refreshed!.count).toBe(1);
    expect(refreshed!.getAttribute("label")).toBe("boosted");
  });
});

describe("Touch", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("posts", (table) => {
      table.increments("id");
      table.string("title");
      table.timestamps();
    });
  });

  test("touch updates only updated_at", async () => {
    const post = await Post.create({ title: "Touch Test" });
    const oldUpdated = post.getAttribute("updated_at");
    await new Promise((r) => setTimeout(r, 10));

    const result = await post.touch();
    expect(result).toBe(true);
    expect(post.getAttribute("updated_at")).not.toBe(oldUpdated);
    expect(post.title).toBe("Touch Test");

    const refreshed = await Post.find(post.id);
    expect(refreshed!.getAttribute("updated_at")).not.toBe(oldUpdated);
    expect(refreshed!.title).toBe("Touch Test");
  });

  test("touch returns false for unsaved model", async () => {
    const post = new Post({ title: "Unsaved" });
    const result = await post.touch();
    expect(result).toBe(false);
  });
});

describe("Chunk / Cursor / Each / Lazy", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("posts", (table) => {
      table.increments("id");
      table.string("title");
      table.timestamps();
    });

    for (let i = 1; i <= 5; i++) {
      await Post.create({ title: `Post ${i}` });
    }
  });

  test("chunk iterates in batches", async () => {
    const titles: string[] = [];
    await Post.chunk(2, (posts) => {
      for (const post of posts) {
        titles.push(post.title);
      }
    });
    expect(titles).toEqual(["Post 1", "Post 2", "Post 3", "Post 4", "Post 5"]);
  });

  test("each iterates individual items", async () => {
    const titles: string[] = [];
    await Post.each(2, (post) => {
      titles.push(post.title);
    });
    expect(titles).toEqual(["Post 1", "Post 2", "Post 3", "Post 4", "Post 5"]);
  });

  test("cursor yields items one by one", async () => {
    const titles: string[] = [];
    for await (const post of Post.cursor()) {
      titles.push(post.title);
    }
    expect(titles).toEqual(["Post 1", "Post 2", "Post 3", "Post 4", "Post 5"]);
  });

  test("lazy yields items with chunking", async () => {
    const titles: string[] = [];
    for await (const post of Post.lazy(2)) {
      titles.push(post.title);
    }
    expect(titles).toEqual(["Post 1", "Post 2", "Post 3", "Post 4", "Post 5"]);
  });
});
