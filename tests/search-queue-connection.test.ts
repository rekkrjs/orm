import { describe, expect, test, beforeEach } from "bun:test";
import { Model, Schema } from "../src/index.js";
import { Queue, type QueueDriver, type JobRecord, DispatchableJob, registerJob } from "../src/queue/index.js";
import { Search } from "../src/search/index.js";
import type { SearchEngine, SearchableRecord } from "../src/search/index.js";
import { setupTestDb } from "./helpers.js";

class FakeDriver implements QueueDriver {
  dispatched: Array<{ queue: string; jobClass: string; payload: string }> = [];
  async migrate() {}
  async dispatch(queue: string, jobClass: string, payload: string) {
    this.dispatched.push({ queue, jobClass, payload });
  }
  async reserve(): Promise<JobRecord | null> { return null; }
  async complete() { return true; }
  async heartbeat() { return true; }
  async fail() { return true; }
  async release() { return true; }
  async size() { return this.dispatched.length; }
}

class FakeEngine implements SearchEngine {
  async update(_r: SearchableRecord[]) {}
  async delete(_r: SearchableRecord[]) {}
  async search() { return []; }
  async paginate() { return { hits: [], total: 0, page: 1, perPage: 10 }; }
  async flush() {} async createIndex() {} async deleteIndex() {} async updateIndexSettings() {}
}

describe("Queue connection routing", () => {
  beforeEach(() => Search.reset());

  test("Queue.dispatch routes by `connection` option to the named driver", async () => {
    const primary = new FakeDriver();
    const secondary = new FakeDriver();
    Queue.configure(primary, "default");
    Queue.registerDriver("secondary", secondary);

    class HelloJob extends DispatchableJob {
      static queue = "default";
      constructor(public msg: string) { super(msg); }
      async handle() {}
    }
    registerJob(HelloJob as any);

    await Queue.dispatch(new HelloJob("a"));
    await Queue.dispatch(new HelloJob("b"), { connection: "secondary" });

    expect(primary.dispatched).toHaveLength(1);
    expect(secondary.dispatched).toHaveLength(1);
    expect(secondary.dispatched[0].jobClass).toBe("HelloJob");
  });

  test("unknown connection throws", async () => {
    const driver = new FakeDriver();
    Queue.configure(driver, "default");
    class X extends DispatchableJob { async handle() {} }
    await expect(Queue.dispatch(new X(), { connection: "missing" })).rejects.toThrow(/missing/);
  });

  test("SearchObserver passes search.queue.connection through to Queue.dispatch", async () => {
    setupTestDb();
    await Schema.create("widgets_qc", (t) => { t.increments("id"); t.string("name"); t.timestamps(); });

    const defaultDriver = new FakeDriver();
    const searchDriver = new FakeDriver();
    Queue.configure(defaultDriver, "default");
    Queue.registerDriver("search-driver", searchDriver);

    class _Widget extends Model.define<{ id: number; name: string }>("widgets_qc") {
      static fillable = ["name"];
    }
    const Widget = Search.register(_Widget, { index: "widgets_qc" });

    Search.configure({
      engine: new FakeEngine(),
      queue: { name: "search", connection: "search-driver" },
    });
    Search.register(_Widget, { index: "widgets_qc" });

    await Widget.create({ name: "x" } as any);

    expect(searchDriver.dispatched).toHaveLength(1);
    expect(searchDriver.dispatched[0].queue).toBe("search");
    expect(searchDriver.dispatched[0].jobClass).toBe("MakeSearchableJob");
    expect(defaultDriver.dispatched).toHaveLength(0);
  });
});
