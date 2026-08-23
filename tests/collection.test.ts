import { beforeEach, describe, expect, test } from "bun:test";
import { PermissiveModel } from "./helpers.js";
import { Collection, Connection, Model, Schema, collect } from "../src/index.js";

class CollectionUser extends PermissiveModel {
  static table = "collection_users";
  static timestamps = false;
}

class ConnectedCollectionPost extends PermissiveModel {
  static table = "connected_collection_posts";
  static timestamps = false;
}

class ConnectedCollectionUser extends PermissiveModel {
  static table = "connected_collection_users";
  static timestamps = false;

  posts() {
    return this.hasMany(ConnectedCollectionPost, "user_id");
  }
}

describe("Collection", () => {
  let connection: Connection;

  beforeEach(async () => {
    connection = new Connection({ url: "sqlite://:memory:" });
    Model.setConnection(connection);
    Schema.setConnection(connection);
    await Schema.create("collection_users", (table) => {
      table.increments("id");
      table.string("name");
      table.string("role");
      table.integer("score");
    });
    await CollectionUser.insert([
      { name: "Ada", role: "admin", score: 10 },
      { name: "Linus", role: "user", score: 20 },
      { name: "Grace", role: "user", score: 15 },
    ]);
  });

  test("wraps arrays with collection helpers", () => {
    const items = new Collection([
      { name: "Ada", role: "admin", score: 10 },
      { name: "Linus", role: "user", score: 20 },
      { name: "Grace", role: "user", score: 15 },
    ]);

    expect(items).toHaveLength(3);
    expect(items.first()?.name).toBe("Ada");
    expect(items.last()?.name).toBe("Grace");
    expect(items.isNotEmpty()).toBe(true);
    expect(items.pluck("name")).toEqual(["Ada", "Linus", "Grace"]);
    expect(items.where("role", "user").pluck("name")).toEqual(["Linus", "Grace"]);
    expect(items.whereIn("score", [10, 15]).pluck("name")).toEqual(["Ada", "Grace"]);
    expect(items.keyBy("name").Ada.score).toBe(10);
    expect(items.groupBy("role").user.pluck("name")).toEqual(["Linus", "Grace"]);
    expect(items.sortBy("score").pluck("name")).toEqual(["Ada", "Grace", "Linus"]);
    expect(items.sortByDesc("score").pluck("name")).toEqual(["Linus", "Grace", "Ada"]);
    expect(items.take(2).pluck("name")).toEqual(["Ada", "Linus"]);
    expect(items.skip(1).pluck("name")).toEqual(["Linus", "Grace"]);
    expect(items.contains("name", "Ada")).toBe(true);
    expect(items.firstWhere("role", "user")?.name).toBe("Linus");
    expect(items.count()).toBe(3);
    expect(items.sum("score")).toBe(45);
    expect(items.avg("score")).toBe(15);
    expect(items.min("score")).toBe(10);
    expect(items.max("score")).toBe(20);
  });

  test("query get and model all return collections", async () => {
    const users = await CollectionUser.orderBy("id").get();
    expect(users).toBeInstanceOf(Collection);
    expect(users[0].getAttribute("name")).toBe("Ada");
    expect(users.pluck("name")).toEqual(["Ada", "Linus", "Grace"]);
    expect(users.all()).toBeArray();

    const allUsers = await CollectionUser.all();
    expect(allUsers).toBeInstanceOf(Collection);
    expect(allUsers.toArray()).toHaveLength(3);
  });

  test("model key helpers compare model class, connection, and primary key", async () => {
    const users = await CollectionUser.orderBy("id").get();
    const sameUsers = await CollectionUser.orderBy("id").get();

    expect(users.modelKeys()).toEqual([1, 2, 3]);
    expect(users.find(2)?.getAttribute("name")).toBe("Linus");
    expect(users.find([1, 3]).pluck("name")).toEqual(["Ada", "Grace"]);
    expect(users.find((user) => user.getAttribute("score") > 10)?.getAttribute("name")).toBe("Linus");
    expect(users.findOrFail(1).getAttribute("name")).toBe("Ada");
    expect(users.findOrFail([1, 3]).modelKeys()).toEqual([1, 3]);
    expect(new Collection([users[0], sameUsers[0]]).findOrFail([1])).toHaveLength(2);
    expect(() => users.findOrFail(99)).toThrow("No query results for model [CollectionUser]");
    expect(() => users.findOrFail([1, 99])).toThrow("No query results for model [CollectionUser]");

    expect(users.contains(1)).toBe(true);
    expect(users.contains(sameUsers[0])).toBe(true);
    expect(new Collection<any>([users[0], "literal"]).contains("literal")).toBe(true);
    expect(users.only([1, 3]).modelKeys()).toEqual([1, 3]);
    expect(users.except([1, 3]).modelKeys()).toEqual([2]);
    expect(users.diff([sameUsers[0], sameUsers[2]]).modelKeys()).toEqual([2]);
    expect(users.intersect([sameUsers[0], sameUsers[2]]).modelKeys()).toEqual([1, 3]);
    expect(new Collection([...users, sameUsers[0]]).unique().modelKeys()).toEqual([1, 2, 3]);
  });

  test("model identity and eager loading keep connections isolated", async () => {
    const first = new Connection({ url: "sqlite://:memory:" });
    const second = new Connection({ url: "sqlite://:memory:" });

    try {
      for (const database of [first, second]) {
        await Schema.create("connected_collection_users", (table) => {
          table.increments("id");
          table.string("name");
        }, database);
        await Schema.create("connected_collection_posts", (table) => {
          table.increments("id");
          table.integer("user_id");
          table.string("title");
        }, database);
      }

      const firstUser = await ConnectedCollectionUser.on(first).create({ name: "First" });
      const secondUser = await ConnectedCollectionUser.on(second).create({ name: "Second" });
      await ConnectedCollectionPost.on(first).create({ user_id: firstUser.getAttribute("id"), title: "First post" });
      await ConnectedCollectionPost.on(second).create({ user_id: secondUser.getAttribute("id"), title: "Second post" });
      await ConnectedCollectionPost.on(second).create({ user_id: secondUser.getAttribute("id"), title: "Another second post" });

      expect(firstUser.is(secondUser)).toBe(false);
      expect(new Collection([firstUser]).contains(secondUser)).toBe(false);
      expect(new Collection([firstUser, secondUser]).unique()).toHaveLength(2);

      const users = new Collection([firstUser, secondUser]);
      await users.load("posts");
      expect(users.map((user) => user.getRelation("posts").pluck("title"))).toEqual([
        ["First post"],
        ["Second post", "Another second post"],
      ]);

      const missingUsers = new Collection([
        await ConnectedCollectionUser.on(first).findOrFail(firstUser.getAttribute("id")),
        await ConnectedCollectionUser.on(second).findOrFail(secondUser.getAttribute("id")),
      ]);
      await missingUsers.loadMissing("posts");
      expect(missingUsers.map((user) => user.getRelation("posts").pluck("title"))).toEqual([
        ["First post"],
        ["Second post", "Another second post"],
      ]);

      await missingUsers.loadCount("posts");
      expect(missingUsers.pluck("posts_count")).toEqual([1, 2]);
    } finally {
      await first.close();
      await second.close();
    }
  });

  test("find(predicate) preserves the native default thisArg", () => {
    let context: unknown = "unset";
    new Collection([1]).find(function (this: unknown) {
      context = this;
      return false;
    });

    expect(context).toBeUndefined();
  });

  test("model serialization helpers are passed through to every item", async () => {
    const users = await CollectionUser.orderBy("id").get();

    expect(users.makeHidden("role")).toBe(users);
    expect(users.every((user) => !("role" in user.toJSON()))).toBe(true);
    expect(users.makeVisible("role")).toBe(users);
    expect(users.every((user) => user.toJSON().role !== undefined)).toBe(true);

    expect(users.append("display_name")).toBe(users);
    expect(users.every((user) => user.getAppends().includes("display_name"))).toBe(true);
    expect(users.setAppends(["summary"])).toBe(users);
    expect(users.every((user) => user.getAppends().includes("summary"))).toBe(true);
  });

  test("collections serialize as JSON arrays", async () => {
    const users = await CollectionUser.orderBy("id").get();
    const json = JSON.parse(JSON.stringify(users));
    expect(Array.isArray(json)).toBe(true);
    expect(json.map((user: any) => user.name)).toEqual(["Ada", "Linus", "Grace"]);
  });

  test("collection json aliases toJSON", async () => {
    const users = await CollectionUser.orderBy("id").get();
    expect(users.json()).toEqual(users.toJSON());
  });

  test("query json returns serialized rows", async () => {
    const users = await CollectionUser.query().orderBy("score", "desc").json();
    expect(users).toEqual([
      { id: 2, name: "Linus", role: "user", score: 20 },
      { id: 3, name: "Grace", role: "user", score: 15 },
      { id: 1, name: "Ada", role: "admin", score: 10 },
    ]);
  });

  test("getArray returns a plain array compatibility escape hatch", async () => {
    const users = await CollectionUser.orderBy("id").getArray();
    expect(users).toBeArray();
    expect(users).not.toBeInstanceOf(Collection);
    expect(users.map((user) => user.getAttribute("name"))).toEqual(["Ada", "Linus", "Grace"]);
  });

  test("paginator data and chunk callbacks use collections", async () => {
    const page = await CollectionUser.orderBy("id").paginate(2, 1);
    expect(page.data).toBeInstanceOf(Collection);
    expect(page.data.pluck("name")).toEqual(["Ada", "Linus"]);

    const chunks: Collection<CollectionUser>[] = [];
    await CollectionUser.orderBy("id").chunk(2, (items) => {
      expect(items).toBeInstanceOf(Collection);
      chunks.push(items);
    });
    expect(chunks).toHaveLength(2);
    expect(chunks[0].pluck("name")).toEqual(["Ada", "Linus"]);
    expect(chunks[1].pluck("name")).toEqual(["Grace"]);
  });

  test("reports itself as an Array so consumers dispatching on constructor.name agree", () => {
    const items = collect([{ id: 1 }]);

    expect(items.constructor.name).toBe("Array");
    expect(Array.isArray(items)).toBe(true);
    expect(items).toBeInstanceOf(Collection);
    expect(items.pluck("id")).toEqual([1]);
  });
});
