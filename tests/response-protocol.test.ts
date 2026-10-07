import { afterAll, beforeAll, describe, expect, test } from "./harness.js";
import { CursorPaginator, Model, Paginator, Schema, SimplePaginator } from "../src/index.js";
import { PermissiveModel, setupTestDb, teardownTestDb } from "./helpers.js";

type Equal<X, Y> = (<V>() => V extends X ? 1 : 2) extends (<V>() => V extends Y ? 1 : 2) ? true : false;

/**
 * Elysia 2 serializes only plain objects and arrays as JSON. Any other class
 * instance goes through `toResponse()` when it has one, and is otherwise sent as
 * `String(value)` without a content type. Whatever `toResponse()` returns is
 * mapped again, so it must be a plain object for the body to be JSON.
 */
function expectPlainResponse(value: { toResponse(): unknown; toJSON(): unknown }, expected: unknown): void {
  const response = value.toResponse();
  expect(Object.getPrototypeOf(response)).toBe(Object.prototype);
  expect(response).toEqual(expected);
  expect(response).toEqual(value.toJSON());
  expect(JSON.stringify(response)).toBe(JSON.stringify(value));
}

class RpAuthor extends PermissiveModel {
  static table = "rp_authors";
  static timestamps = false;
}

class RpPost extends PermissiveModel {
  static table = "rp_posts";
  static hidden = ["secret"];
  static appends = ["shout"];
  static casts = { published_on: "date" as const, created_at: "datetime" as const };
  static timestamps = false;

  get shout(): string {
    return String(this.getAttribute("title")).toUpperCase();
  }

  author() {
    return this.belongsTo(RpAuthor, "author_id");
  }
}

const AUTHOR = { id: 1, name: "Ñúria Gómez" };
const POSTS = [1, 2, 3].map((id) => ({
  id,
  author_id: 1,
  title: `Título ${id}`,
  secret: `s${id}`,
  published_on: "2026-01-15",
  created_at: "2026-01-15T23:30:00.250Z",
}));

/** A post as the requirements say it serializes: hidden dropped, date-only cast, appends and relation added. */
function postJson(id: number, withAuthor: boolean) {
  const { secret: _secret, ...visible } = POSTS[id - 1]!;
  return { ...visible, shout: `TÍTULO ${id}`, ...(withAuthor ? { author: AUTHOR } : {}) };
}

describe("toResponse() for Elysia 2", () => {
  let connection: ReturnType<typeof setupTestDb>;

  beforeAll(async () => {
    connection = setupTestDb();
    await Schema.create("rp_authors", (table) => {
      table.increments("id");
      table.string("name");
    });
    await Schema.create("rp_posts", (table) => {
      table.increments("id");
      table.integer("author_id");
      table.string("title");
      table.string("secret");
      table.date("published_on");
      table.timestamp("created_at");
    });
    await RpAuthor.create(AUTHOR);
    for (const post of POSTS) await RpPost.create(post);
  });

  afterAll(async () => {
    await teardownTestDb(connection);
  });

  test("a model returns its JSON form as a plain object", async () => {
    const post = await RpPost.with("author").findOrFail(1);
    expectPlainResponse(post, postJson(1, true));
  });

  test("a model honours per-instance visibility in its response", async () => {
    const post = (await RpPost.findOrFail(2)).makeVisible("secret").makeHidden("created_at");
    const { created_at: _created, ...rest } = postJson(2, false);
    expectPlainResponse(post, { ...rest, secret: "s2" });
  });

  test("a model limited by visible returns only those keys", async () => {
    class RpVisiblePost extends RpPost {
      static visible = ["id", "title"];
    }
    expectPlainResponse(await RpVisiblePost.findOrFail(3), { id: 3, title: "Título 3" });
  });

  test("a model whose toJSON() is overridden responds with the override", async () => {
    class RpCustomPost extends RpPost {
      override toJSON(): any {
        return { custom: this.getAttribute("id") };
      }
    }
    expectPlainResponse(await RpCustomPost.findOrFail(1), { custom: 1 });
  });

  test("paginate() returns its JSON form as a plain object", async () => {
    const page = await RpPost.with("author").orderBy("id").paginate(2, 1);
    expect(page).toBeInstanceOf(Paginator);
    expectPlainResponse(page, {
      data: [postJson(1, true), postJson(2, true)],
      current_page: 1,
      per_page: 2,
      total: 3,
      last_page: 2,
      from: 1,
      to: 2,
    });
  });

  test("simplePaginate() returns its JSON form as a plain object", async () => {
    const page = await RpPost.orderBy("id").simplePaginate(2, 2);
    expect(page).toBeInstanceOf(SimplePaginator);
    expectPlainResponse(page, {
      data: [postJson(3, false)],
      current_page: 2,
      per_page: 2,
      from: 3,
      to: 3,
      has_more_pages: false,
      next_page: null,
      prev_page: 1,
    });
  });

  test("cursorPaginate() returns its JSON form as a plain object", async () => {
    const page = await RpPost.orderBy("id").cursorPaginate(2);
    expect(page).toBeInstanceOf(CursorPaginator);
    const response = page.toResponse();
    expect(Object.getPrototypeOf(response)).toBe(Object.prototype);
    expect(response.data).toEqual([postJson(1, false), postJson(2, false)]);
    expect(response.per_page).toBe(2);
    expect(response.prev_cursor).toBeNull();
    expect(response.has_more_pages).toBe(true);
    expect(typeof response.next_cursor).toBe("string");
    expect(Object.keys(response).sort()).toEqual(["data", "has_more_pages", "next_cursor", "per_page", "prev_cursor"]);
    expectPlainResponse(page, page.toJSON());
  });

  test("toResponse() is typed as toJSON(), loaded relations included", async () => {
    class RpTypedAuthor extends PermissiveModel.define<{ id: number; name: string }>("rp_authors") {}
    class RpTypedPost extends PermissiveModel.define<{ id: number; title: string; author_id: number }>("rp_posts") {
      static override hidden = ["secret"];
      author() {
        return this.belongsTo(RpTypedAuthor, "author_id");
      }
    }
    const post = await RpTypedPost.with("author").findOrFail(1);
    const page = await RpTypedPost.with("author").orderBy("id").paginate(2, 1);
    const simple = await RpTypedPost.orderBy("id").simplePaginate(2, 1);
    const cursor = await RpTypedPost.orderBy("id").cursorPaginate(2);
    const sameTypes: [
      Equal<ReturnType<typeof post.toResponse>, ReturnType<typeof post.toJSON>>,
      Equal<ReturnType<typeof page.toResponse>, ReturnType<typeof page.toJSON>>,
      Equal<ReturnType<typeof simple.toResponse>, ReturnType<typeof simple.toJSON>>,
      Equal<ReturnType<typeof cursor.toResponse>, ReturnType<typeof cursor.toJSON>>,
    ] = [true, true, true, true];
    expect(sameTypes).toEqual([true, true, true, true]);
    expect(post.toResponse().author?.name).toBe(AUTHOR.name);
  });

  test("toResponse is a member, not an attribute, on every model", () => {
    expect(Object.keys(new Model())).not.toContain("toResponse");
    expect(typeof Model.prototype.toResponse).toBe("function");
  });
});
