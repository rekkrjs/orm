import { test, describe, beforeAll } from "./harness.js";
import { Model, Connection } from "../src/index.js";
import { ObserverRegistry, Observer } from "../src/model/Observer.js";
import { findRelationMethod } from "../src/model/Model.js";

function setupDb() {
  const connection = new Connection({ url: "sqlite://:memory:" });
  Model.setConnection(connection);
  return connection;
}

class CpuUser extends Model {
  declare id: number;
  declare name: string;
  declare score: number;
  static table = "cpu_users";
  static fillable = ["name", "email", "active", "score", "meta"];
  static casts = { active: "boolean", score: "number", meta: "json" };
}

class CpuPost extends Model {
  static table = "cpu_posts";
  static fillable = ["title", "body"];

  author() {
    return this.belongsTo(CpuUser, "user_id");
  }

  comments() {
    return this.hasMany(CpuComment, "post_id");
  }
}

class CpuComment extends Model {
  static table = "cpu_comments";
  static fillable = ["body"];
}

describe("Benchmark: Pure CPU (no DB)", () => {
  beforeAll(() => { setupDb(); });

  test("new Model() x10000 (construction only)", () => {
    const iterations = 10000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      new CpuUser({ name: `U${i}`, email: `n${i}@t.com`, active: true, score: i, meta: JSON.stringify({ i }) });
    }
    const ms = performance.now() - start;
    console.log(`  new Model() x${iterations}: ${ms.toFixed(2)}ms (${(ms / iterations * 1000).toFixed(3)}μs/op)`);
  });

  test("getAttribute() x50000 (cast lookup only)", () => {
    const user = new CpuUser({ name: "Test", email: "g@t.com", active: true, score: 42, meta: '{"k":"v"}' });
    const iterations = 50000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      user.getAttribute("active");
      user.getAttribute("score");
      user.getAttribute("name");
      user.getAttribute("meta");
    }
    const ms = performance.now() - start;
    console.log(`  getAttribute() x${iterations}: ${ms.toFixed(2)}ms (${(ms / iterations * 1000).toFixed(3)}μs/op)`);
  });

  test("setAttribute() x20000 (dirty tracking only)", () => {
    const user = new CpuUser({ name: "Test", email: "s@t.com", active: true, score: 5 });
    const iterations = 20000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      user.name = `Name${i}`;
    }
    const ms = performance.now() - start;
    console.log(`  setAttribute() x${iterations}: ${ms.toFixed(2)}ms (${(ms / iterations * 1000).toFixed(3)}μs/op)`);
  });

  test("getDirty() x50000 (dirty scan only)", () => {
    const user = new CpuUser({ name: "Test", email: "d@t.com", active: true, score: 5 });
    user.name = "Changed";
    user.score = 99;
    const iterations = 50000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      user.getDirty();
    }
    const ms = performance.now() - start;
    console.log(`  getDirty() x${iterations}: ${ms.toFixed(2)}ms (${(ms / iterations * 1000).toFixed(3)}μs/op)`);
  });

  test("findRelationMethod() x50000 (prototype walk cache)", () => {
    const post = new CpuPost({ title: "Test", body: "test" });
    const iterations = 50000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      findRelationMethod(post, "author");
      findRelationMethod(post, "comments");
    }
    const ms = performance.now() - start;
    console.log(`  findRelationMethod() x${iterations * 2}: ${ms.toFixed(2)}ms (${(ms / (iterations * 2) * 1000).toFixed(3)}μs/op)`);
  });

  test("Observer dispatch x20000 (event-indexed)", () => {
    class TestUser extends Model {
      declare name: string;
      static table = "cpu_users";
      static fillable = ["name"];
    }
    const events: string[] = [];
    class TestObserver extends Observer<TestUser> {
      override creating(model: TestUser) { events.push(model.name); }
    }
    TestObserver.observe(TestUser);

    const iterations = 20000;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      ObserverRegistry.dispatch("creating", new TestUser({ name: `U${i}` }));
    }
    const ms = performance.now() - start;
    console.log(`  Observer.dispatch() x${iterations}: ${ms.toFixed(2)}ms (${(ms / iterations * 1000).toFixed(3)}μs/op)`);
  });

  test("Model.hydrate() x20000 (row to model)", () => {
    const iterations = 20000;
    const row = { id: 1, name: "Test", email: "h@t.com", active: true, score: 42, meta: '{"k":"v"}' };
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      CpuUser.hydrate({ ...row, id: i });
    }
    const ms = performance.now() - start;
    console.log(`  Model.hydrate() x${iterations}: ${ms.toFixed(2)}ms (${(ms / iterations * 1000).toFixed(3)}μs/op)`);
  });
});
