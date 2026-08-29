import { beforeAll, describe, expect, test } from "bun:test";
import { Collection, DB, ModelNotFoundError, Schema } from "../src/index.js";
import { PermissiveModel, setupTestDb } from "./helpers.js";

interface SugarUserAttrs {
  uuid: string;
  name: string;
  team: string;
  score: number;
  email: string | null;
}

interface SugarPostAttrs {
  id: number;
  user_uuid: string;
  title: string;
}

class SugarUser extends PermissiveModel.define<SugarUserAttrs>("laravel_sugar_users") {
  static override primaryKey = "uuid";
  static override incrementing = false;
  static override timestamps = false;

  posts() {
    return this.hasMany(SugarPost, "user_uuid", "uuid");
  }
}

class SugarPost extends PermissiveModel.define<SugarPostAttrs>("laravel_sugar_posts") {
  static override timestamps = false;
}

function expectType<T>(_value: T): void {}

describe("Laravel query syntax sugar", () => {
  beforeAll(async () => {
    setupTestDb();

    await Schema.create("laravel_sugar_users", (table) => {
      table.string("uuid").primary();
      table.string("name");
      table.string("team");
      table.integer("score");
      table.string("email").nullable();
    });
    await Schema.create("laravel_sugar_posts", (table) => {
      table.increments("id");
      table.string("user_uuid");
      table.string("title");
    });

    await SugarUser.create({ uuid: "u-a", name: "Ada", team: "red", score: 10, email: "ada@example.test" });
    await SugarUser.create({ uuid: "u-b", name: "Bob", team: "red", score: 20, email: null });
    await SugarUser.create({ uuid: "u-c", name: "Cyd", team: "blue", score: 30, email: "cyd@example.test" });
    await SugarUser.create({ uuid: "u-d", name: "Dee", team: "blue", score: 40, email: "dee@example.test" });
    await SugarUser.create({ uuid: "u-e", name: "O'Reilly", team: "green", score: 50, email: "oreilly@example.test" });

    await SugarPost.create({ user_uuid: "u-a", title: "Ada 1" });
    await SugarPost.create({ user_uuid: "u-a", title: "Ada 2" });
    await SugarPost.create({ user_uuid: "u-c", title: "Cyd 1" });
  });

  test("dumpRawSql and ddRawSql output interpolated SQL and keep dump chainable", () => {
    const query = SugarUser.where("name", "O'Reilly");
    const rawSql = query.toRawSql();
    const logs: unknown[][] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(args); };

    try {
      expect(query.dumpRawSql()).toBe(query);
      expect(() => query.ddRawSql()).toThrow("dd() called");
    } finally {
      console.log = originalLog;
    }

    expect(rawSql).toContain("O''Reilly");
    expect(logs).toEqual([[rawSql], [rawSql]]);
  });

  test("implode supports ordering, filters, qualification, nulls, defaults, and empty results", async () => {
    expect(await SugarUser.where("team", "red").orderBy("score").implode("name", " / ")).toBe("Ada / Bob");
    expect(await SugarUser.where("team", "red").orderBy("score").implode("email", "|")).toBe("ada@example.test|");
    expect(await SugarUser.where("uuid", "u-a").implode("laravel_sugar_users.name")).toBe("Ada");
    expect(await SugarUser.where("score", ">", 999).implode("name", ",")).toBe("");

    const reusable = SugarUser.where("team", "red").orderBy("score");
    expect(await reusable.implode("name", ",")).toBe("Ada,Bob");
    expect((await reusable.get()).map((user) => user.score)).toEqual([10, 20]);
  });

  test("soleValue returns typed model and raw values without mutating the source builder", async () => {
    expect(await SugarUser.where("uuid", "u-a").soleValue("name")).toBe("Ada");
    expect(await SugarUser.where("uuid", "u-b").soleValue("email")).toBeNull();
    expect(await SugarUser.where("uuid", "u-c").soleValue("laravel_sugar_users.score")).toBe(30);
    expect(await DB.table<SugarUserAttrs>("laravel_sugar_users").where("uuid", "u-d").soleValue("name")).toBe("Dee");
    await expect(SugarUser.where("uuid", "missing").soleValue("name")).rejects.toBeInstanceOf(ModelNotFoundError);
    await expect(SugarUser.where("team", "red").soleValue("name")).rejects.toThrow("Multiple records found");

    const reusable = SugarUser.where("uuid", "u-a");
    expect(await reusable.soleValue("name")).toBe("Ada");
    const model = await reusable.first();
    expect(model).toBeInstanceOf(SugarUser);
    expect(model?.score).toBe(10);
  });

  test("existsOr and doesntExistOr implement both truth tables and await fallbacks", async () => {
    let calls = 0;
    expect(await SugarUser.where("uuid", "u-a").existsOr(() => { calls++; return "miss"; })).toBe(true);
    expect(await SugarUser.where("uuid", "missing").existsOr(async () => { calls++; return "fallback" as const; })).toBe("fallback");
    expect(await SugarUser.where("uuid", "missing").doesntExistOr(() => { calls++; return "hit"; })).toBe(true);
    expect(await SugarUser.where("uuid", "u-a").doesntExistOr(async () => { calls++; return 42 as const; })).toBe(42);
    expect(calls).toBe(2);

    const grouped = SugarUser.select("team").groupBy("team").havingRaw("COUNT(*) >= ?", [2]);
    expect(await grouped.existsOr(() => false)).toBe(true);
    expect((await grouped.get()).map((row) => row.team).sort()).toEqual(["blue", "red"]);

    await expect(SugarUser.where("uuid", "missing").existsOr(() => { throw new Error("fallback failed"); }))
      .rejects.toThrow("fallback failed");
    await expect(SugarUser.where("uuid", "u-a").doesntExistOr(async () => { throw new Error("async failed"); }))
      .rejects.toThrow("async failed");
  });

  test("findSole enforces exactly one match and findOrNew returns existing or fresh models", async () => {
    expect((await SugarUser.query().findSole("u-a")).name).toBe("Ada");
    expect((await SugarUser.query().findSole(["u-c"])).name).toBe("Cyd");
    await expect(SugarUser.query().findSole("missing")).rejects.toBeInstanceOf(ModelNotFoundError);
    await expect(SugarUser.query().findSole(["u-a", "u-b"])).rejects.toThrow("Multiple records found");

    const existing = await SugarUser.query().findOrNew("u-b");
    expect(existing).toBeInstanceOf(SugarUser);
    expect(existing.name).toBe("Bob");

    const fresh = await SugarUser.where("team", "missing").findOrNew("new-uuid");
    expect(fresh).toBeInstanceOf(SugarUser);
    expect(fresh.getAttribute("uuid")).toBeUndefined();
    expect(fresh.$wasRecentlyCreated).toBe(false);
    expect(fresh.getConnection()).toBe(SugarUser.getConnection());
    await expect(DB.table<SugarUserAttrs>("laravel_sugar_users").findOrNew("missing"))
      .rejects.toThrow("findOrNew requires a model");
  });

  test("orWhereKey and orWhereKeyNot combine scalar and array custom keys", async () => {
    const scalar = await SugarUser.where("uuid", "u-a").orWhereKey("u-c").orderBy("uuid").get();
    expect(scalar.map((user) => user.uuid)).toEqual(["u-a", "u-c"]);

    const array = await SugarUser.where("uuid", "u-e").orWhereKey(["u-b", "u-d"]).orderBy("uuid").get();
    expect(array.map((user) => user.uuid)).toEqual(["u-b", "u-d", "u-e"]);

    const scalarNot = await SugarUser.whereRaw("0 = 1").orWhereKeyNot("u-a").orderBy("uuid").get();
    expect(scalarNot.map((user) => user.uuid)).toEqual(["u-b", "u-c", "u-d", "u-e"]);

    const arrayNot = await SugarUser.whereRaw("0 = 1").orWhereKeyNot(["u-a", "u-b"]).orderBy("uuid").get();
    expect(arrayNot.map((user) => user.uuid)).toEqual(["u-c", "u-d", "u-e"]);
  });

  test("regression: builder find family honors a model's custom primary key", async () => {
    expect((await SugarUser.query().find("u-a"))?.name).toBe("Ada");

    let calls = 0;
    expect((await SugarUser.query().findOr("u-b", () => { calls++; return null; }))?.name).toBe("Bob");
    expect(await SugarUser.query().findOr("missing", async () => { calls++; return "fallback" as const; })).toBe("fallback");
    expect(calls).toBe(1);

    expect((await SugarUser.query().findOrFail("u-c")).name).toBe("Cyd");
    await expect(SugarUser.query().findOrFail("missing")).rejects.toBeInstanceOf(ModelNotFoundError);
    expect((await SugarUser.query().find("Ada", "name"))?.uuid).toBe("u-a");
  });

  test("regression: empty IN lists compile to portable constants for every boolean and polarity", async () => {
    expect(await SugarUser.whereIn("uuid", []).count()).toBe(0);
    expect(await SugarUser.whereNotIn("uuid", []).count()).toBe(5);
    expect((await SugarUser.where("uuid", "u-a").orWhereKey([]).get()).map((user) => user.uuid)).toEqual(["u-a"]);
    expect(await SugarUser.whereRaw("0 = 1").orWhereKeyNot([]).count()).toBe(5);

    const sql = [
      SugarUser.whereIn("uuid", []).toSql(),
      SugarUser.whereNotIn("uuid", []).toSql(),
      SugarUser.query().orWhereKey([]).toSql(),
      SugarUser.query().orWhereKeyNot([]).toSql(),
    ].join("\n");
    expect(sql).not.toContain("IN ()");
    expect(sql).toContain("0 = 1");
    expect(sql).toContain("1 = 1");
  });

  test("regression: nested key clauses retain custom model primary-key metadata", async () => {
    const query = SugarUser.where((nested) => nested.whereKey("u-b").orWhereKey("u-d"));
    expect(query.toSql()).toContain('"uuid"');
    expect(query.toSql()).not.toContain('"id"');
    expect((await query.orderBy("uuid").get()).map((user) => user.uuid)).toEqual(["u-b", "u-d"]);
  });

  test("static get, forPage, orHas, SQL debug helpers, and explain proxy the model query", async () => {
    const all = await SugarUser.get();
    expect(all).toBeInstanceOf(Collection);
    expect(all).toHaveLength(5);

    const page = await SugarUser.forPage(2, 2).orderBy("uuid").get();
    expect(page.map((user) => user.uuid)).toEqual(["u-c", "u-d"]);
    expect(() => SugarUser.forPage(0, 2)).toThrow("Page");
    expect(() => SugarUser.forPage(1, 0)).toThrow("Per-page");

    expect((await SugarUser.orHas("posts").orderBy("uuid").get()).map((user) => user.uuid)).toEqual(["u-a", "u-c"]);
    expect((await SugarUser.where("uuid", "u-b").orHas("posts").orderBy("uuid").get()).map((user) => user.uuid))
      .toEqual(["u-a", "u-b", "u-c"]);
    expect((await SugarUser.where("uuid", "u-d").orHas("posts", ">=", 2).orderBy("uuid").get()).map((user) => user.uuid))
      .toEqual(["u-a", "u-d"]);

    expect(SugarUser.toSql()).toBe(SugarUser.query().toSql());
    expect(SugarUser.toRawSql()).toBe(SugarUser.query().toRawSql());
    const plan = await SugarUser.explain();
    expect(Array.isArray(plan)).toBe(true);
    expect(plan.length).toBeGreaterThan(0);

    const logs: unknown[][] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(args); };
    try {
      expect(SugarUser.dump().toSql()).toBe(SugarUser.toSql());
      expect(() => SugarUser.dd()).toThrow("dd() called");
    } finally {
      console.log = originalLog;
    }
    expect(logs).toEqual([[SugarUser.toRawSql()], [SugarUser.toRawSql()]]);

    if (false) {
      expectType<Collection<SugarUser>>(await SugarUser.get());
      expectType<SugarUser[]>(await SugarUser.forPage(1).get());
      expectType<string>(SugarUser.toSql());
      SugarUser.orHas("posts").get();
    }
  });
});
