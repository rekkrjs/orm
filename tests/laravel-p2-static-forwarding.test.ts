import { beforeAll, describe, expect, test } from "bun:test";
import { Builder, Model, Schema } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

interface P2UserAttributes {
  id: number;
  team_id: number | null;
  name: string;
  rank: number;
  active: boolean;
  secret: string | null;
  deleted_at: string | null;
}

class P2User extends Model.define<P2UserAttributes>("p2_users") {
  static override timestamps = false;
  static override fillable = ["team_id", "name", "rank", "active"];
  static override casts = { active: "boolean" } as const;
}

class P2SoftUser extends P2User {
  static override softDeletes = true;
}

interface P2TokenAttributes {
  slug: string;
  label: string;
}

class P2Token extends Model.define<P2TokenAttributes>("p2_tokens") {
  static override timestamps = false;
  static override primaryKey = "slug";
  static override incrementing = false;
  static override fillable = ["label"];
}

function expectType<T>(_value: T): void {}

function typeAssertions(): void {
  if (false as boolean) {
    expectType<Builder<P2User>>(P2User.join("p2_teams", "p2_users.team_id", "=", "p2_teams.id"));
    expectType<Builder<P2User>>(P2User.leftJoin("p2_teams", "p2_users.team_id", "=", "p2_teams.id"));
    expectType<Builder<P2User>>(P2User.rightJoin("p2_teams", "p2_users.team_id", "=", "p2_teams.id"));
    expectType<Builder<P2User>>(P2User.crossJoin("p2_teams"));
    expectType<Builder<P2User>>(P2User.union(P2User.where("rank", 1)));
    expectType<Builder<P2User>>(P2User.unionAll(P2User.where("rank", 1)));
    expectType<Promise<any>>(P2User.insertGetId({ name: "typed", rank: 1 }));
    expectType<Promise<any>>(P2User.insertOrIgnore([{ name: "typed", rank: 1 }]));

    // These are raw Builder writes: criteria include every model attribute,
    // independently of the model's mass-assignment policy.
    P2User.insertGetId({ secret: "allowed" });
    P2User.insertOrIgnore({ secret: "allowed" });
    // @ts-expect-error known model attributes retain their declared value type.
    P2User.insertGetId({ rank: "not a number" });
    // @ts-expect-error every record in a bulk call is model-typed.
    P2User.insertOrIgnore([{ active: "not a boolean" }]);
    // @ts-expect-error regression: arrays cannot masquerade as one loose record.
    P2User.query().insertOrIgnore([{ rank: "not a number" }]);
  }
}

describe.serial("Laravel P2 static forwarding", () => {
  const connection = setupTestDb();

  beforeAll(async () => {
    await Schema.create("p2_teams", (table) => {
      table.increments("id");
      table.string("label").unique();
    }, connection);
    await Schema.create("p2_users", (table) => {
      table.increments("id");
      table.integer("team_id").nullable();
      table.string("name").unique();
      table.integer("rank");
      table.boolean("active").default(true);
      table.string("secret").nullable();
      table.timestamp("deleted_at").nullable();
    }, connection);
    await Schema.create("p2_tokens", (table) => {
      table.string("slug").primary();
      table.string("label");
    }, connection);

    await new Builder(connection, "p2_teams").insert([
      { id: 1, label: "Core" },
      { id: 2, label: "Edge" },
      { id: 3, label: "Empty" },
    ]);
    await new Builder(connection, "p2_users").insert([
      { id: 1, team_id: 1, name: "Ada", rank: 1, active: true, secret: null, deleted_at: null },
      { id: 2, team_id: 1, name: "Linus", rank: 2, active: true, secret: null, deleted_at: null },
      { id: 3, team_id: 2, name: "Grace", rank: 3, active: false, secret: null, deleted_at: null },
      { id: 4, team_id: null, name: "Orphan", rank: 4, active: true, secret: null, deleted_at: null },
      { id: 5, team_id: 2, name: "Deleted", rank: 5, active: false, secret: null, deleted_at: "2026-08-29 10:00:00" },
    ]);
  });

  test("join and leftJoin execute, hydrate the base model, and remain chainable", async () => {
    const inner = P2User.join("p2_teams", "p2_users.team_id", "=", "p2_teams.id")
      .select("p2_users.*")
      .orderBy("p2_users.id");
    expect(inner).toBeInstanceOf(Builder);
    expect((await inner.get()).map((user) => user.getAttribute("name"))).toEqual([
      "Ada", "Linus", "Grace", "Deleted",
    ]);
    expect((await inner.get())[0]).toBeInstanceOf(P2User);

    const left = await P2User.leftJoin("p2_teams", "p2_users.team_id", "=", "p2_teams.id")
      .select("p2_users.name", "p2_teams.label")
      .orderBy("p2_users.id")
      .get();
    expect(left.map((user) => [user.getAttribute("name"), user.getAttribute("label")])).toEqual([
      ["Ada", "Core"],
      ["Linus", "Core"],
      ["Grace", "Edge"],
      ["Orphan", null],
      ["Deleted", "Edge"],
    ]);
  });

  test("rightJoin, crossJoin, and custom join types forward without losing scopes", async () => {
    const right = await P2User.rightJoin("p2_teams", "p2_users.team_id", "=", "p2_teams.id")
      .select("p2_teams.label")
      .get();
    expect(right.map((row) => row.getAttribute("label")).sort()).toEqual([
      "Core", "Core", "Edge", "Edge", "Empty",
    ]);

    expect(await P2User.crossJoin("p2_teams").count()).toBe(15);
    expect(await P2SoftUser.crossJoin("p2_teams").count()).toBe(12);
    expect(P2SoftUser.join("p2_teams", "p2_users.team_id", "=", "p2_teams.id").toRawSql())
      .toContain('"p2_users"."deleted_at" IS NULL');
    expect(P2User.join("p2_teams", "p2_users.team_id", "=", "p2_teams.id", "FULL").toSql())
      .toContain("FULL JOIN");
  });

  test("join forwards Builder validation errors", () => {
    expect(() => P2User.join("p2_teams", "p2_users.team_id", "DROP", "p2_teams.id"))
      .toThrow("Invalid query operator");
    expect(() => P2User.join("p2_teams", "p2_users.team_id", "=", "p2_teams.id", "SIDEWAYS"))
      .toThrow("Invalid join type");
  });

  test("union and unionAll preserve de-duplication, hydration, and the all shortcut", async () => {
    const union = await P2User.union(P2User.select("name").where("rank", 2))
      .select("name")
      .where("rank", "<=", 2)
      .get();
    expect(union.map((user) => user.getAttribute("name")).sort()).toEqual(["Ada", "Linus"]);
    expect(union[0]).toBeInstanceOf(P2User);

    const unionAll = await P2User.unionAll(P2User.select("name").where("rank", 2))
      .select("name")
      .where("rank", "<=", 2)
      .get();
    expect(unionAll.map((user) => user.getAttribute("name")).sort()).toEqual(["Ada", "Linus", "Linus"]);
    expect(P2User.union(P2User.select("name"), true).toSql()).toContain("UNION ALL");
  });

  test("static unions retain base and arm bindings without mutating the arm", async () => {
    const arm = P2User.select("name").where("name", "Grace");
    const { statements } = await connection.pretend(() => P2User.union(arm)
      .select("name")
      .where("name", "Ada")
      .get());

    expect(statements).toHaveLength(1);
    expect(statements[0]!.bindings).toEqual(["Ada", "Grace"]);
    expect(arm.bindings).toEqual([]);
    expect(P2User.union('SELECT "name" FROM "p2_users" WHERE 0 = 1').toSql()).toContain("UNION SELECT");
  });

  test("insertGetId returns generated and explicitly selected keys", async () => {
    const id = await P2User.insertGetId({
      team_id: null,
      name: "Raw id",
      rank: 6,
      active: undefined,
      secret: "bypasses fillable",
      deleted_at: null,
    });
    expect(Number(id)).toBe(6);

    const inserted = await P2User.find(id);
    expect(inserted?.getAttribute("active")).toBe(true);
    expect(inserted?.getAttribute("secret")).toBe("bypasses fillable");

    const slug = await P2Token.insertGetId({ slug: "token-a", label: "Token A" }, "slug");
    expect(slug).toBe("token-a");
    expect((await P2Token.find("token-a"))?.getAttribute("label")).toBe("Token A");
  });

  test("insertOrIgnore supports single, bulk, empty, and parameterized writes", async () => {
    await P2User.insertOrIgnore({
      team_id: 1,
      name: "Ada",
      rank: 99,
      active: false,
      secret: "ignored",
      deleted_at: null,
    });
    await P2User.insertOrIgnore([
      { team_id: 1, name: "Linus", rank: 99, active: false, secret: "ignored", deleted_at: null },
      { team_id: 2, name: "Bulk new", rank: 7, active: true, secret: "raw bulk", deleted_at: null },
    ]);

    expect(await P2User.whereIn("name", ["Ada", "Linus"]).count()).toBe(2);
    expect((await P2User.where("name", "Bulk new").first())?.getAttribute("secret")).toBe("raw bulk");

    const empty = await connection.pretend(() => P2User.insertOrIgnore([]));
    expect(empty.statements).toEqual([]);

    const malicious = "x'); DROP TABLE p2_users; --";
    const captured = await connection.pretend(() => P2User.insertOrIgnore({
      team_id: null,
      name: malicious,
      rank: 8,
      active: true,
      secret: null,
      deleted_at: null,
    }));
    expect(captured.statements[0]!.sql).not.toContain(malicious);
    expect(captured.statements[0]!.bindings).toContain(malicious);
  });

  test("insertOrIgnore keeps Builder bulk-shape validation", async () => {
    await expect(P2User.insertOrIgnore([
      { name: "Shape A", rank: 9 },
      { name: "Shape B", rank: 10, active: true },
    ])).rejects.toThrow("Bulk insert records must have the same columns");
  });

  test("static forwarding type contracts compile", () => {
    void typeAssertions;
    expect(true).toBe(true);
  });
});
