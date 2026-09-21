import { test, describe, beforeAll, afterAll } from "bun:test";
import { Model, Schema, Connection } from "../src/index.js";
import { ObserverRegistry, Observer } from "../src/model/Observer.js";
import type { ModelConstructor } from "../src/model/Model.js";

function setupDb() {
  const connection = new Connection({ url: "sqlite://:memory:" });
  Model.setConnection(connection);
  Schema.setConnection(connection);
  return connection;
}

class BenchUser extends Model {
  declare id: number;
  declare name: string;
  declare score: number;
  static table = "bench_users";
  static fillable = ["name", "email", "active", "score"];
  static casts = { active: "boolean", score: "number" };
}

class BenchPost extends Model {
  static table = "bench_posts";
  static fillable = ["title", "body"];

  author() {
    return this.belongsTo(BenchUser, "user_id");
  }

  comments() {
    return this.hasMany(BenchComment, "post_id");
  }
}

class BenchComment extends Model {
  static table = "bench_comments";
  static fillable = ["body"];

  post() {
    return this.belongsTo(BenchPost, "post_id");
  }
}

describe("Benchmark: CPU Optimizations", () => {
  let connection: Connection;

  beforeAll(async () => {
    connection = setupDb();
    await Schema.create("bench_users", (t) => {
      t.increments("id");
      t.string("name");
      t.string("email");
      t.boolean("active");
      t.float("score");
      t.timestamps();
    });
    await Schema.create("bench_posts", (t) => {
      t.increments("id");
      t.string("title");
      t.text("body").nullable();
      t.integer("user_id").nullable();
      t.timestamps();
    });
    await Schema.create("bench_comments", (t) => {
      t.increments("id");
      t.text("body");
      t.integer("post_id").nullable();
      t.timestamps();
    });
  });

  afterAll(async () => {
    await connection.driver.close();
  });

  test("getDirty() x10000 (dirty key tracking)", async () => {
    const user = await BenchUser.create({ name: "Test", email: "dirty@t.com", active: true, score: 5 });
    user.name = "Updated";

    const iterations = 10000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      user.getDirty();
    }
    const ms = performance.now() - start;
    console.log(`  getDirty() x${iterations}: ${ms.toFixed(2)}ms (${(ms / iterations * 1000).toFixed(3)}μs/op)`);
  });

  test("setAttribute + getDirty() x5000 (dirty tracking overhead)", async () => {
    const user = await BenchUser.create({ name: "Test", email: "track@t.com", active: true, score: 5 });

    const iterations = 5000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      user.name = `Name${i}`;
      user.getDirty();
    }
    const ms = performance.now() - start;
    console.log(`  setAttribute+getDirty() x${iterations}: ${ms.toFixed(2)}ms (${(ms / iterations * 1000).toFixed(3)}μs/op)`);
  });

  test("findRelationMethod() x10000 (relation cache)", async () => {
    const post = new BenchPost({ title: "Test", body: "test" });

    const iterations = 10000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const { findRelationMethod } = await import("../src/model/Model.js");
      findRelationMethod(post, "author");
      findRelationMethod(post, "comments");
    }
    const ms = performance.now() - start;
    console.log(`  findRelationMethod() x${iterations * 2}: ${ms.toFixed(2)}ms (${(ms / (iterations * 2) * 1000).toFixed(3)}μs/op)`);
  });

  test("getCastDefinition() x10000 (merged casts)", async () => {
    const user = new BenchUser({ name: "Test", email: "cast@t.com", active: true, score: 5 });

    const iterations = 10000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      user.getAttribute("active");
      user.getAttribute("score");
      user.getAttribute("name");
    }
    const ms = performance.now() - start;
    console.log(`  getAttribute() x${iterations * 3}: ${ms.toFixed(2)}ms (${(ms / (iterations * 3) * 1000).toFixed(3)}μs/op)`);
  });

  test("Observer dispatch x5000 (event-indexed dispatch)", async () => {
    class TestUser extends Model {
      declare name: string;
      static table = "bench_users";
      static fillable = ["name"];
    }

    const events: string[] = [];
    class TestObserver extends Observer<TestUser> {
      override creating(model: TestUser) {
        events.push(model.name);
      }
    }

    TestObserver.observe(TestUser);

    const iterations = 5000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      await ObserverRegistry.dispatch("creating", new TestUser({ name: `U${i}` }));
    }
    const ms = performance.now() - start;
    console.log(`  Observer.dispatch() x${iterations}: ${ms.toFixed(2)}ms (${(ms / iterations * 1000).toFixed(3)}μs/op)`);
  });

  test("Model instantiation x5000 (cast merge at construction)", async () => {
    const iterations = 5000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      new BenchUser({ name: `U${i}`, email: `inst${i}@t.com`, active: true, score: i });
    }
    const ms = performance.now() - start;
    console.log(`  new Model() x${iterations}: ${ms.toFixed(2)}ms (${(ms / iterations * 1000).toFixed(3)}μs/op)`);
  });

  test("Model.hydrate() x5000 (dirty key reset)", async () => {
    const iterations = 5000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      BenchUser.hydrate({ id: i, name: `U${i}`, email: `h${i}@t.com`, active: true, score: i });
    }
    const ms = performance.now() - start;
    console.log(`  Model.hydrate() x${iterations}: ${ms.toFixed(2)}ms (${(ms / iterations * 1000).toFixed(3)}μs/op)`);
  });
});
