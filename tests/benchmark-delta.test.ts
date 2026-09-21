import { test, describe, beforeAll } from "bun:test";
import { Model, Connection } from "../src/index.js";
import { ObserverRegistry, Observer } from "../src/model/Observer.js";
import { findRelationMethod } from "../src/model/Model.js";

function setupDb() {
  const connection = new Connection({ url: "sqlite://:memory:" });
  Model.setConnection(connection);
  return connection;
}

class BenchUser extends Model {
  declare id: number;
  declare name: string;
  declare score: number;
  static table = "bench_users";
  static fillable = ["name", "email", "active", "score", "meta"];
  static casts = { active: "boolean", score: "number", meta: "json" };
}

class BenchPost extends Model {
  static table = "bench_posts";
  static fillable = ["title"];
  author() { return this.belongsTo(BenchUser, "user_id"); }
  comments() { return this.hasMany(BenchComment, "post_id"); }
}

class BenchComment extends Model {
  static table = "bench_comments";
  static fillable = ["body"];
}

describe("Benchmark: Optimization Deltas", () => {
  beforeAll(() => { setupDb(); });

  // 1. getDirty() — dirty key tracking vs full object scan
  test("getDirty() with 2 dirty keys", () => {
    const user = new BenchUser({ name: "Test", email: "d@t.com", active: true, score: 5, meta: "{}" });
    user.name = "Changed";
    user.score = 99;

    const N = 100000;
    const start = performance.now();
    for (let i = 0; i < N; i++) user.getDirty();
    const ms = performance.now() - start;
    console.log(`  getDirty() x${N} (2 dirty keys): ${ms.toFixed(2)}ms`);
  });

  test("getDirty() with 0 dirty keys", () => {
    const user = new BenchUser({ name: "Test", email: "d@t.com", active: true, score: 5, meta: "{}" });

    const N = 100000;
    const start = performance.now();
    for (let i = 0; i < N; i++) user.getDirty();
    const ms = performance.now() - start;
    console.log(`  getDirty() x${N} (0 dirty keys): ${ms.toFixed(2)}ms`);
  });

  // 2. getAttribute() — merged cast lookup vs prototype chain walk
  test("getAttribute() x100000 (with cast)", () => {
    const user = new BenchUser({ name: "Test", email: "g@t.com", active: true, score: 42, meta: '{"k":"v"}' });

    const N = 100000;
    const start = performance.now();
    for (let i = 0; i < N; i++) user.getAttribute("active");
    const ms = performance.now() - start;
    console.log(`  getAttribute("active") x${N}: ${ms.toFixed(2)}ms`);
  });

  test("getAttribute() x100000 (no cast)", () => {
    const user = new BenchUser({ name: "Test", email: "g@t.com", active: true, score: 42, meta: '{"k":"v"}' });

    const N = 100000;
    const start = performance.now();
    for (let i = 0; i < N; i++) user.getAttribute("name");
    const ms = performance.now() - start;
    console.log(`  getAttribute("name") x${N}: ${ms.toFixed(2)}ms`);
  });

  // 3. findRelationMethod() — cached vs uncached
  test("findRelationMethod() x100000 (cached)", () => {
    const post = new BenchPost({ title: "Test" });

    // Warm the cache
    findRelationMethod(post, "author");
    findRelationMethod(post, "comments");

    const N = 100000;
    const start = performance.now();
    for (let i = 0; i < N; i++) {
      findRelationMethod(post, "author");
      findRelationMethod(post, "comments");
    }
    const ms = performance.now() - start;
    console.log(`  findRelationMethod() x${N * 2} (cached): ${ms.toFixed(2)}ms`);
  });

  // 4. Observer dispatch — event-indexed vs iterate all
  test("Observer.dispatch() x50000 (with handler)", () => {
    class TestUser extends Model { static table = "bench_users"; }
    class TestObs extends Observer<TestUser> {
      override creating() {}
      override saving() {}
    }
    TestObs.observe(TestUser);

    const N = 50000;
    const start = performance.now();
    for (let i = 0; i < N; i++) {
      ObserverRegistry.dispatch("creating", new TestUser());
      ObserverRegistry.dispatch("saving", new TestUser());
    }
    const ms = performance.now() - start;
    console.log(`  Observer.dispatch() x${N * 2} (with handler): ${ms.toFixed(2)}ms`);
  });

  test("Observer.dispatch() x50000 (no handler for event)", () => {
    class TestUser2 extends Model { static table = "bench_users"; }
    class TestObs2 extends Observer<TestUser2> {
      override creating() {}
    }
    TestObs2.observe(TestUser2);

    const N = 50000;
    const start = performance.now();
    for (let i = 0; i < N; i++) {
      ObserverRegistry.dispatch("deleted", new TestUser2());
    }
    const ms = performance.now() - start;
    console.log(`  Observer.dispatch() x${N} (no handler): ${ms.toFixed(2)}ms`);
  });

  // 5. Model construction — cast merge cost
  test("new Model() x50000 (with casts)", () => {
    const N = 50000;
    const start = performance.now();
    for (let i = 0; i < N; i++) {
      new BenchUser({ name: `U${i}`, email: `c${i}@t.com`, active: true, score: i, meta: "{}" });
    }
    const ms = performance.now() - start;
    console.log(`  new Model() x${N} (with casts): ${ms.toFixed(2)}ms`);
  });

  // 6. Hydrate — dirty key reset cost
  test("Model.hydrate() x50000", () => {
    const N = 50000;
    const row = { id: 1, name: "Test", email: "h@t.com", active: true, score: 42, meta: '{"k":"v"}' };
    const start = performance.now();
    for (let i = 0; i < N; i++) {
      BenchUser.hydrate({ ...row, id: i });
    }
    const ms = performance.now() - start;
    console.log(`  Model.hydrate() x${N}: ${ms.toFixed(2)}ms`);
  });
});
