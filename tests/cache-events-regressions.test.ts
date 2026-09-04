import { describe, test, expect, beforeEach } from "bun:test";
import { Cache, MemoryCacheStore } from "../src/cache/index.js";
import { Events } from "../src/events/Events.js";

describe("Cache: non-serializable values", () => {
  beforeEach(() => {
    Cache.configure({ store: new MemoryCacheStore() });
  });

  test("set() refuses undefined instead of poisoning the key", async () => {
    await expect(Cache.set("k", undefined as any)).rejects.toThrow(/JSON-serializable/);
    expect(await Cache.get("k")).toBeNull();
  });

  test("set() refuses functions and symbols", async () => {
    await expect(Cache.set("f", (() => 1) as any)).rejects.toThrow(/JSON-serializable/);
    await expect(Cache.set("s", Symbol("x") as any)).rejects.toThrow(/JSON-serializable/);
  });

  test("remember() passes an undefined resolver result through without caching", async () => {
    expect(await Cache.remember("k", () => undefined as any)).toBeUndefined();
    // The key stays readable because no unparseable value was stored.
    expect(await Cache.get("k")).toBeNull();
    expect(await Cache.get("k")).toBeNull();

    // And the key is still usable afterwards.
    expect(await Cache.remember("k", () => 42)).toBe(42);
    expect(await Cache.get("k")).toBe(42);
  });

  test("null is a cacheable value", async () => {
    await Cache.set("n", null);
    expect(await Cache.get("n")).toBeNull();
    expect(await Cache.remember("n", () => "must not run")).toBeNull();
  });

  test("a corrupt entry reads as a miss and is dropped", async () => {
    const store = new MemoryCacheStore();
    await store.set("bad", 1);
    (store as any).entries.get("bad").value = "undefined";
    expect(await store.get("bad")).toBeNull();
    expect((store as any).entries.has("bad")).toBe(false);
  });
});

describe("MemoryCacheStore tag bookkeeping", () => {
  test("forget() removes the key from its tag indexes", async () => {
    const store = new MemoryCacheStore();
    await store.set("a", 1, { tags: ["t"] });
    await store.forget("a");
    expect((store as any).tagKeys.size).toBe(0);
  });

  test("forgetTag() still clears every tagged key", async () => {
    const store = new MemoryCacheStore();
    await store.set("a", 1, { tags: ["t"] });
    await store.set("b", 2, { tags: ["t"] });
    await store.set("c", 3, { tags: ["other"] });
    await store.forgetTag("t");
    expect(await store.get("a")).toBeNull();
    expect(await store.get("b")).toBeNull();
    expect(await store.get("c")).toBe(3);
  });

  test("a key under two tags is cleaned out of both", async () => {
    const store = new MemoryCacheStore();
    await store.set("a", 1, { tags: ["t1", "t2"] });
    await store.forget("a");
    expect((store as any).tagKeys.size).toBe(0);
  });

  test("overwriting a tagged key drops the emptied tag index", async () => {
    const store = new MemoryCacheStore();
    await store.set("a", 1, { tags: ["t"] });
    await store.set("a", 2);
    // forget() cleaned up empty sets but set() only removed the key, leaving a
    // growing collection of dead tags behind.
    expect((store as any).tagKeys.size).toBe(0);
  });

  test("expired entries are swept as writes come in, not only when read", async () => {
    const store = new MemoryCacheStore();
    for (let i = 0; i < 100; i++) await store.set(`k${i}`, i, { ttl: 0.001 });
    await Bun.sleep(20);
    // Enough further writes to cross the sweep interval.
    for (let i = 0; i < 100; i++) await store.set(`live${i}`, i);

    const entries = (store as any).entries as Map<string, unknown>;
    for (let i = 0; i < 100; i++) expect(entries.has(`k${i}`)).toBe(false);
    expect(entries.size).toBe(100);
  });

  test("the sweep does not evict entries that are still live", async () => {
    const store = new MemoryCacheStore();
    await store.set("keep", "value", { ttl: 300 });
    await store.set("forever", "value");
    for (let i = 0; i < 200; i++) await store.set(`churn${i}`, i, { ttl: 0.001 });
    expect(await store.get("keep")).toBe("value");
    expect(await store.get("forever")).toBe("value");
  });
});

describe("Events: listener isolation", () => {
  class Ping { constructor(public n = 1) {} }

  beforeEach(() => Events.clear());

  test("a throwing listener does not cancel the ones after it", async () => {
    const ran: string[] = [];
    Events.listen(Ping, { handle: async () => { ran.push("first"); } });
    Events.listen(Ping, { handle: async () => { throw new Error("boom"); } });
    Events.listen(Ping, { handle: async () => { ran.push("third"); } });

    await expect(Events.dispatch(new Ping())).rejects.toThrow("boom");
    expect(ran).toEqual(["first", "third"]);
  });

  test("multiple failures are reported together", async () => {
    Events.listen(Ping, { handle: async () => { throw new Error("a"); } });
    Events.listen(Ping, { handle: async () => { throw new Error("b"); } });

    await expect(Events.dispatch(new Ping())).rejects.toThrow(AggregateError);
  });

  test("dispatch still resolves to the event when nothing throws", async () => {
    Events.listen(Ping, { handle: async () => {} });
    const event = new Ping(7);
    expect(await Events.dispatch(event)).toBe(event);
  });

  test("unlisten removes one registration, not every duplicate", async () => {
    let calls = 0;
    const subscriber = { handle: async () => { calls++; } };
    Events.listen(Ping, subscriber);
    Events.listen(Ping, subscriber);

    Events.unlisten(Ping, subscriber);
    await Events.dispatch(new Ping());
    expect(calls).toBe(1);

    Events.unlisten(Ping, subscriber);
    await Events.dispatch(new Ping());
    expect(calls).toBe(1);
  });
});
