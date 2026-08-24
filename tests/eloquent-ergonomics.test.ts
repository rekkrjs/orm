import { expect, test, describe, beforeAll } from "bun:test";
import { Collection, Model, Schema } from "../src/index.js";
import { PermissiveModel, setupTestDb } from "./helpers.js";

interface ErgUserAttrs {
  id: number;
  name: string;
  group_name: string;
  score: number;
}

class ErgUser extends PermissiveModel.define<ErgUserAttrs>("erg_users") {
  declare label: string;
  declare upper_name: string;

  static appends = ["label"];
  static accessors = {
    label: {
      get: (_value: any, attributes: ErgUserAttrs) => `${attributes.name}:${attributes.score}`,
    },
    upper_name: {
      get: (_value: any, attributes: ErgUserAttrs) => attributes.name.toUpperCase(),
    },
  };
}

const FULLTEXT_COLUMNS = ["name", "group_name"] as const;

describe("Eloquent-style ergonomics", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("erg_users", (table) => {
      table.increments("id");
      table.string("name");
      table.string("group_name");
      table.integer("score");
      table.timestamps();
    });

    for (let i = 1; i <= 6; i++) {
      await ErgUser.create({
        name: `User ${i}`,
        group_name: i % 2 === 0 ? "even" : "odd",
        score: i,
      });
    }
  });

  test("whereKey, whereKeyNot, findMany, and firstWhere filter by primary keys and typed columns", async () => {
    const one = await ErgUser.whereKey(1).first();
    expect(one?.name).toBe("User 1");

    const some = await ErgUser.whereKey([1, 3]).orderBy("id").get();
    expect(some.map((user) => user.id)).toEqual([1, 3]);

    const others = await ErgUser.whereKeyNot([1, 2]).orderBy("id").get();
    expect(others.map((user) => user.id)).toEqual([3, 4, 5, 6]);

    const found = await ErgUser.findMany([2, 4]);
    expect(found).toBeInstanceOf(Collection);
    expect(found.map((user) => user.name).sort()).toEqual(["User 2", "User 4"]);

    const first = await ErgUser.firstWhere("score", ">", 4);
    expect(first?.score).toBe(5);

    if (false) {
      const typed = await ErgUser.firstWhere("name", "User 1");
      typed?.name.toUpperCase();
      // Column names stay a LiteralUnion on purpose: known columns are
      // suggested, but computed/joined names must remain callable.
      await ErgUser.firstWhere("missing", "value");
      // @ts-expect-error findMany returns ErgUser models, not arbitrary fields.
      found[0]?.missing;
    }
  });

  test("orderByRaw and groupByRaw support raw SQL clauses", async () => {
    const ordered = await ErgUser.orderByRaw("score + 1 DESC").get();
    expect(ordered[0].score).toBe(6);

    const grouped = await ErgUser.query()
      .select("group_name")
      .selectRaw("COUNT(*) as total")
      .groupByRaw("group_name")
      .orderByRaw("total DESC")
      .get();

    expect(grouped).toHaveLength(2);
    expect(grouped[0].getAttribute("total")).toBe(3);

    if (false) {
      ErgUser.orderByRaw("score DESC");
      ErgUser.groupByRaw("group_name");
    }
  });

  test("model static query helper proxies expose the builder where family", async () => {
    const exists = await ErgUser.whereExists("SELECT 1")
      .whereBetween("score", [2, 4])
      .orWhereNotExists("SELECT 1 WHERE 0")
      .orderByDesc("score")
      .get();

    expect(exists[0].score).toBe(6);

    const filtered = await ErgUser
      .whereNotIn("score", [1, 6])
      .whereNotNull("group_name")
      .whereColumn("erg_users.id", "=", "erg_users.id")
      .whereRaw("score >= 2")
      .reorder("id")
      .get();

    expect(filtered.map((user) => user.score)).toEqual([2, 3, 4, 5]);

    const grouped = await ErgUser
      .select("group_name")
      .selectRaw("COUNT(*) as total")
      .groupBy("group_name")
      .havingRaw("COUNT(*) >= 3")
      .get();

    expect(grouped).toHaveLength(2);

    if (false) {
      ErgUser.whereExists("SELECT 1").get();
      ErgUser.whereNotExists("SELECT 1 WHERE 0").get();
      ErgUser.orWhereExists("SELECT 1").get();
      ErgUser.whereRaw("score > 0").get();
      ErgUser.whereColumn("erg_users.id", "=", "erg_users.id").get();
      ErgUser.whereColumn("erg_users.id", "erg_users.id").get();
      ErgUser.whereColumn([["erg_users.id", "=", "erg_users.id"]]).get();
      ErgUser.whereNull(["group_name", "name"]).get();
      ErgUser.whereBetweenColumns("score", ["id", "score"]).get();
      ErgUser.wherePast(["created_at", "updated_at"]).get();
      ErgUser.whereNone(["name", "group_name"], "=", "blocked").get();
      ErgUser.havingBetween("score", [1, 5]).get();
      ErgUser.whereNotIn("score", [1, 2]).get();
      ErgUser.whereBetween("score", [1, 4]).get();
      ErgUser.whereNotBetween("score", [1, 4]).get();
      ErgUser.orWhereNull("group_name").get();
      ErgUser.whereLike("name", "User%").get();
      ErgUser.orWhereLike("name", "Admin%").get();
      ErgUser.orWhereNotLike("name", "Bot%").get();
      ErgUser.whereJsonDoesntContain("name", "blocked").get();
      ErgUser.orWhereJsonContains("name", "allowed").get();
      ErgUser.orWhereJsonDoesntContain("name", "blocked").get();
      ErgUser.orWhereJsonLength("name", 2).get();
      ErgUser.orWhereFullText("name", "user").get();
      ErgUser.whereAll(["name", "group_name"], "!=", "").get();
      ErgUser.select("name").addSelect("score").distinct().get();
      ErgUser.limit(2).offset(1).get();
      ErgUser.doesntExist();

      const optionalName = undefined as string | undefined;
      ErgUser.when(optionalName, (query, name) => query.where("name", name.toUpperCase()));
      ErgUser.query().when(
        () => optionalName,
        (query, name) => query.where("name", name.toUpperCase()),
        (query, name) => query.where("name", name ?? "guest"),
      );
      ErgUser.unless(
        optionalName,
        (query, name) => query.where("name", name ?? "guest"),
        (query, name) => query.where("name", name.toUpperCase()),
      );

      // Static aliases keep returning a Builder of ErgUser models.
      (await ErgUser.orWhereLike("name", "Admin%").get())[0]?.name.toUpperCase();
      // value() widens with null even on a non-nullable column: the row may be absent.
      (await ErgUser.value("name"))?.toUpperCase();
      (await ErgUser.value("score"))?.toFixed();
      (await ErgUser.orWhereFullText(FULLTEXT_COLUMNS, "user").get())[0]?.score.toFixed();

      // @ts-expect-error JSON length requires a comparison value.
      ErgUser.orWhereJsonLength("name");
      // @ts-expect-error findMany returns ErgUser models, not arbitrary fields.
      (await ErgUser.orWhereNotLike("name", "Bot%").get())[0]?.missing;
    }
  });

  test("chunkByIdDesc and lazyById variants iterate by primary key without offsets", async () => {
    const descIds: number[] = [];
    await ErgUser.chunkByIdDesc(2, (users) => {
      descIds.push(...users.map((user) => user.id));
    });
    expect(descIds).toEqual([6, 5, 4, 3, 2, 1]);

    const lazyIds: number[] = [];
    for await (const user of ErgUser.orderByDesc("id").lazyById(2)) {
      lazyIds.push(user.id);
    }
    expect(lazyIds).toEqual([1, 2, 3, 4, 5, 6]);

    const lazyDescIds: number[] = [];
    for await (const user of ErgUser.orderBy("id").lazyByIdDesc(2)) {
      lazyDescIds.push(user.id);
    }
    expect(lazyDescIds).toEqual([6, 5, 4, 3, 2, 1]);
  });

  test("static appends and append() include computed accessors in JSON", async () => {
    const user = await ErgUser.findOrFail(1);

    const json = user.json();
    expect(json.label).toBe("User 1:1");

    const appended = user.append("upper_name");
    const appendedJson = appended.json();
    expect(appendedJson.upper_name).toBe("USER 1");

    user.makeHidden("label");
    expect(user.json()).not.toHaveProperty("label");

    if (false) {
      const typed = appended.json();
      typed.upper_name;
      typed.label;
      // @ts-expect-error Appended JSON rows should not admit unknown keys.
      typed.missing;
    }
  });
});
