import { afterAll, afterEach, beforeAll, describe, expect, test } from "./harness.js";
import { Connection, DB, Model, Schema, type QueryEvent } from "../src/index.js";
import { PermissiveModel } from "./helpers.js";

// Builder.json() with eager loads serializes simple models straight from their
// rows. Every test compares it with the hydrated graph — get().toJSON(), which
// is what json() returned before — byte for byte, key order included.

class EagerAuthor extends PermissiveModel {
  static override table = "eager_json_authors";
  static override timestamps = false;
  static override hidden = ["secret"];
  static override casts = { active: "boolean", meta: "json" };

  posts() {
    return this.hasMany(EagerPost, "author_id");
  }

  profile() {
    return this.hasOne(EagerProfile, "author_id");
  }

  team() {
    return this.belongsTo(EagerTeam, "team_id");
  }

  teamOrDefault() {
    return this.belongsTo(EagerTeam, "team_id").withDefault({ name: "No team" });
  }

  // A text parent key: match() pairs "1" with the integer foreign key 1 through String().
  refPosts() {
    return this.hasMany(EagerPost, "author_id", "ref");
  }

  appendedPosts() {
    return this.hasMany(EagerAppendedPost, "author_id");
  }
}

class EagerPost extends PermissiveModel {
  static override table = "eager_json_posts";
  static override timestamps = false;
  static override casts = { published: "boolean" };

  comments() {
    return this.hasMany(EagerComment, "post_id");
  }
}

class EagerComment extends PermissiveModel {
  static override table = "eager_json_comments";
  static override timestamps = false;
}

class EagerProfile extends PermissiveModel {
  static override table = "eager_json_profiles";
  static override timestamps = false;
}

class EagerTeam extends PermissiveModel {
  static override table = "eager_json_teams";
  static override timestamps = false;
}

// An append keeps these children on the hydrated path while the parents stay direct.
class EagerAppendedPost extends EagerPost {
  static override appends = ["shout"];
  get shout(): string {
    return String(this.getAttribute("title")).toUpperCase();
  }
}

class EagerHiddenRelationAuthor extends EagerAuthor {
  static override hidden = ["secret", "posts"];
}

// A cast on the parent key changes what match() compares ("1.00" is not "1"), so it hydrates.
class EagerCastKeyAuthor extends EagerAuthor {
  static override casts = { ...EagerAuthor.casts, id: "decimal:2" };
}

describe("Builder.json() with eager loads", () => {
  const connection = new Connection({ url: "sqlite://:memory:" });
  const hydrateOwnedRow = (Model as any).hydrateOwnedRow;
  let hydrated = 0;
  let statements: string[] = [];
  let stopListening: () => void;

  beforeAll(async () => {
    Model.setConnection(connection);
    Schema.setConnection(connection);
    await Schema.create("eager_json_teams", (table) => {
      table.increments("id");
      table.string("name");
    });
    await Schema.create("eager_json_authors", (table) => {
      table.increments("id");
      table.string("name");
      table.boolean("active");
      table.json("meta");
      table.string("secret");
      table.integer("team_id").nullable();
      table.string("ref");
    });
    await Schema.create("eager_json_posts", (table) => {
      table.increments("id");
      table.integer("author_id").nullable();
      table.string("title");
      table.boolean("published");
    });
    await Schema.create("eager_json_comments", (table) => {
      table.increments("id");
      table.integer("post_id");
      table.string("body");
    });
    await Schema.create("eager_json_profiles", (table) => {
      table.increments("id");
      table.integer("author_id");
      table.string("bio");
    });
    await DB.table("eager_json_teams").insert([{ name: "Núñez" }, { name: "Unused" }]);
    await DB.table("eager_json_authors").insert([
      { name: "Ada", active: 1, meta: JSON.stringify({ tags: ["a"] }), secret: "s1", team_id: 1, ref: "1" },
      { name: "Grace", active: 0, meta: JSON.stringify({ tags: [] }), secret: "s2", team_id: null, ref: "2" },
      { name: "Linus", active: 1, meta: "{}", secret: "s3", team_id: 99, ref: "x" },
    ]);
    await DB.table("eager_json_posts").insert([
      { author_id: 1, title: "One", published: 1 },
      { author_id: 2, title: "Two", published: 0 },
      { author_id: 1, title: "Three", published: 0 },
      { author_id: 42, title: "Orphan", published: 1 },
      { author_id: null, title: "Nobody", published: 1 },
    ]);
    await DB.table("eager_json_comments").insert([{ post_id: 1, body: "Hi" }]);
    // Two profiles for Ada: HasOne keeps the last one match() reads, as before.
    await DB.table("eager_json_profiles").insert([
      { author_id: 1, bio: "first" },
      { author_id: 1, bio: "second" },
      { author_id: 3, bio: "Ångström" },
    ]);
  });

  afterAll(async () => {
    await connection.close();
  });

  const watch = () => {
    stopListening?.();
    hydrated = 0;
    statements = [];
    (Model as any).hydrateOwnedRow = function (this: unknown, ...args: unknown[]) {
      hydrated++;
      return hydrateOwnedRow.apply(this, args);
    };
    stopListening = DB.listen((event: QueryEvent) => { statements.push(event.sql); });
  };

  afterEach(() => {
    (Model as any).hydrateOwnedRow = hydrateOwnedRow;
    stopListening?.();
  });

  /** json() and the hydrated graph, each with the statements and hydrations it took. */
  const both = async (query: () => { json(): Promise<unknown>; get(): Promise<{ toJSON(): unknown }> }) => {
    watch();
    const json = await query().json();
    const direct = { statements: [...statements], hydrated };
    watch();
    const expected = (await query().get()).toJSON();
    const graph = { statements: [...statements], hydrated };
    return { json, expected, direct, graph };
  };

  test("serializes HasMany, HasOne and BelongsTo from rows, as the hydrated graph does", async () => {
    const { json, expected, direct, graph } = await both(() =>
      EagerAuthor.with("posts", "profile", "team").orderBy("id"));

    expect(JSON.stringify(json)).toBe(JSON.stringify(expected));
    expect(json).toEqual([
      {
        id: 1, name: "Ada", active: true, meta: { tags: ["a"] }, team_id: 1, ref: "1",
        posts: [
          { id: 1, author_id: 1, title: "One", published: true },
          { id: 3, author_id: 1, title: "Three", published: false },
        ],
        profile: { id: 2, author_id: 1, bio: "second" },
        team: { id: 1, name: "Núñez" },
      },
      {
        id: 2, name: "Grace", active: false, meta: { tags: [] }, team_id: null, ref: "2",
        posts: [{ id: 2, author_id: 2, title: "Two", published: false }],
        profile: null,
        team: null,
      },
      {
        id: 3, name: "Linus", active: true, meta: {}, team_id: 99, ref: "x",
        posts: [],
        profile: { id: 3, author_id: 3, bio: "Ångström" },
        team: null,
      },
    ]);
    // No model per row, parent or child; the same four statements.
    expect(direct.hydrated).toBe(0);
    expect(graph.hydrated).toBe(3 + 3 + 3 + 1);
    expect(direct.statements).toEqual(graph.statements);
    expect(direct.statements).toHaveLength(4);
  });

  test("applies eager constraints and keeps a relation the parent hides out of the output", async () => {
    const constrained = await both(() => EagerAuthor.with({
      posts: (query: any) => query.where("published", true).orderBy("id", "desc"),
    }).orderBy("id"));
    expect(JSON.stringify(constrained.json)).toBe(JSON.stringify(constrained.expected));
    expect((constrained.json as any[])[0].posts.map((post: any) => post.title)).toEqual(["One"]);
    expect(constrained.direct.statements).toEqual(constrained.graph.statements);
    expect(constrained.direct.hydrated).toBe(0);

    const hidden = await both(() => EagerHiddenRelationAuthor.with("posts").orderBy("id"));
    expect(JSON.stringify(hidden.json)).toBe(JSON.stringify(hidden.expected));
    expect((hidden.json as any[]).some((author) => "posts" in author)).toBe(false);
    // Hidden from the output, still loaded: the query runs as it did.
    expect(hidden.direct.statements).toEqual(hidden.graph.statements);
    expect(hidden.direct.statements).toHaveLength(2);
  });

  test("pairs keys as match() does, across column types", async () => {
    const { json, expected, direct } = await both(() => EagerAuthor.with("refPosts").orderBy("id"));
    expect(JSON.stringify(json)).toBe(JSON.stringify(expected));
    expect((json as any[]).map((author) => author.refPosts.map((post: any) => post.title)))
      .toEqual([["One", "Three"], ["Two"], []]);
    expect(direct.hydrated).toBe(0);
  });

  test("hydrates only the children that need a model, without querying the parents twice", async () => {
    const { json, expected, direct, graph } = await both(() => EagerAuthor.with("appendedPosts").orderBy("id"));
    expect(JSON.stringify(json)).toBe(JSON.stringify(expected));
    expect((json as any[])[0].appendedPosts[0].shout).toBe("ONE");
    expect(direct.hydrated).toBe(3);
    expect(graph.hydrated).toBe(3 + 3);
    expect(direct.statements).toEqual(graph.statements);
  });

  test("hydrates the rows it read when the plan cannot reproduce the graph", async () => {
    for (const query of [
      () => EagerAuthor.with("teamOrDefault").orderBy("id"),
      () => EagerCastKeyAuthor.with("posts").orderBy("id"),
      () => EagerAuthor.select("name").with("posts").orderBy("id"),
    ]) {
      const { json, expected, direct, graph } = await both(query);
      expect(JSON.stringify(json)).toBe(JSON.stringify(expected));
      expect(direct.statements).toEqual(graph.statements);
      expect(direct.hydrated).toBe(graph.hydrated);
    }
    expect((await EagerAuthor.with("teamOrDefault").orderBy("id").json() as any[])
      .map((author) => author.teamOrDefault.name)).toEqual(["Núñez", "No team", "No team"]);
    expect((await EagerCastKeyAuthor.with("posts").orderBy("id").json() as any[])
      .map((author) => author.posts.length)).toEqual([0, 0, 0]);
  });

  test("keeps nested eager loads, unknown relations and empty results as they were", async () => {
    const nested = await both(() => EagerAuthor.with("posts.comments").orderBy("id"));
    expect(JSON.stringify(nested.json)).toBe(JSON.stringify(nested.expected));
    expect(nested.direct.statements).toEqual(nested.graph.statements);

    await expect(EagerAuthor.with("missing" as any).orderBy("id").json())
      .rejects.toThrow("Relation missing is not defined on EagerAuthor.");

    watch();
    expect(await EagerAuthor.with("posts").where("id", 0).json()).toEqual([]);
    expect(statements).toHaveLength(1);
  });
});
