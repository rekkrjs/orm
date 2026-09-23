import { describe, expect, test } from "./harness.js";
import { MeilisearchEngine } from "../src/search/index.js";

type FetchCall = { url: string; init?: RequestInit };

function mockFetch(handler: (call: FetchCall) => { status?: number; body?: unknown }) {
  const calls: FetchCall[] = [];
  const fn = async (url: any, init?: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    const result = handler(call);
    const status = result.status ?? 200;
    const body = result.body === undefined ? "" : JSON.stringify(result.body);
    return new Response(body, { status, headers: { "content-type": "application/json" } });
  };
  return { fn: fn as unknown as typeof fetch, calls };
}

describe("MeilisearchEngine.waitForTask()", () => {
  test("polls /tasks/{uid} until succeeded", async () => {
    let calls = 0;
    const { fn } = mockFetch(({ url }) => {
      if (url.endsWith("/tasks/7")) {
        calls++;
        const status = calls < 3 ? "processing" : "succeeded";
        return { body: { uid: 7, status, type: "documentAdditionOrUpdate" } };
      }
      return { body: {} };
    });
    const engine = new MeilisearchEngine({ host: "http://x", fetch: fn, taskPollMs: 1, taskTimeoutMs: 1000 });
    const result = await engine.waitForTask(7);
    expect(result.status).toBe("succeeded");
    expect(calls).toBe(3);
  });

  test("throws when task fails", async () => {
    const { fn } = mockFetch(() => ({ body: { uid: 1, status: "failed", error: { message: "bad doc" } } }));
    const engine = new MeilisearchEngine({ host: "http://x", fetch: fn, taskPollMs: 1 });
    await expect(engine.waitForTask(1)).rejects.toThrow(/bad doc/);
  });

  test("times out when task never settles", async () => {
    const { fn } = mockFetch(() => ({ body: { uid: 2, status: "processing" } }));
    const engine = new MeilisearchEngine({ host: "http://x", fetch: fn, taskPollMs: 1 });
    await expect(engine.waitForTask(2, { timeoutMs: 30 })).rejects.toThrow(/did not settle/);
  });
});

describe("MeilisearchEngine — waitForTasks default polls after every write", () => {
  test("update waits before resolving", async () => {
    let updates = 0;
    let polls = 0;
    const { fn } = mockFetch(({ url, init }) => {
      if (init?.method === "POST" && url.includes("/documents")) {
        updates++;
        return { body: { taskUid: 100 } };
      }
      if (url.endsWith("/tasks/100")) {
        polls++;
        return { body: { uid: 100, status: polls < 2 ? "processing" : "succeeded" } };
      }
      return { body: {} };
    });
    const engine = new MeilisearchEngine({ host: "http://x", fetch: fn, waitForTasks: true, taskPollMs: 1 });
    await engine.update([{ index: "posts", id: 1, data: { title: "x" } }]);
    expect(updates).toBe(1);
    expect(polls).toBe(2);
  });
});

describe("MeilisearchEngine.swapIndexes()", () => {
  test("posts /swap-indexes with the pair", async () => {
    const { fn, calls } = mockFetch(() => ({ body: { taskUid: 11 } }));
    const engine = new MeilisearchEngine({ host: "http://x", fetch: fn });
    await engine.swapIndexes("posts", "posts_next");
    expect(calls[0].url).toBe("http://x/swap-indexes");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual([{ indexes: ["posts", "posts_next"] }]);
  });
});

describe("MeilisearchEngine — vector / hybrid / geo body mapping", () => {
  test("vector + hybrid body fields", async () => {
    const { fn, calls } = mockFetch(() => ({ body: { hits: [], totalHits: 0, hitsPerPage: 10, page: 1 } }));
    const engine = new MeilisearchEngine({ host: "http://x", fetch: fn });
    await engine.search({
      index: "posts",
      query: "rust",
      filters: [],
      sorts: [],
      vector: [0.1, 0.2, 0.3],
      hybrid: { semanticRatio: 0.7, embedder: "default" },
    });
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.vector).toEqual([0.1, 0.2, 0.3]);
    expect(body.hybrid).toEqual({ semanticRatio: 0.7, embedder: "default" });
  });

  test("geoSort emits `_geoPoint` sort fragment first", async () => {
    const { fn, calls } = mockFetch(() => ({ body: { hits: [], totalHits: 0, hitsPerPage: 10, page: 1 } }));
    const engine = new MeilisearchEngine({ host: "http://x", fetch: fn });
    await engine.search({
      index: "places",
      query: "coffee",
      filters: [],
      sorts: [{ field: "rating", direction: "desc" }],
      geoSort: { lat: 48.8566, lng: 2.3522, direction: "asc" },
    });
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.sort).toEqual(["_geoPoint(48.8566,2.3522):asc", "rating:desc"]);
  });
});

describe("MeilisearchEngine.createTenantToken()", () => {
  test("returns a 3-part JWT with embedded searchRules + apiKeyUid", () => {
    const engine = new MeilisearchEngine({ host: "http://x", apiKey: "masterkey-with-enough-entropy-1234" });
    const token = engine.createTenantToken(
      { posts: { filter: "tenant_id = 42" } },
      { apiKeyUid: "deadbeef-uid", expiresAt: new Date(Date.UTC(2030, 0, 1)) },
    );
    const [header64, payload64, sig] = token.split(".");
    expect(header64 && payload64 && sig).toBeTruthy();
    const headerStr = Buffer.from(header64.replace(/-/g, "+").replace(/_/g, "/") + "==", "base64").toString();
    const payloadStr = Buffer.from(payload64.replace(/-/g, "+").replace(/_/g, "/") + "==", "base64").toString();
    expect(JSON.parse(headerStr)).toEqual({ alg: "HS256", typ: "JWT" });
    const payload = JSON.parse(payloadStr);
    expect(payload.searchRules).toEqual({ posts: { filter: "tenant_id = 42" } });
    expect(payload.apiKeyUid).toBe("deadbeef-uid");
    expect(payload.exp).toBe(Math.floor(Date.UTC(2030, 0, 1) / 1000));
  });

  test("throws without apiKey", () => {
    const engine = new MeilisearchEngine({ host: "http://x" });
    expect(() => engine.createTenantToken({ posts: {} }, { apiKeyUid: "uid" })).toThrow(/API key/);
  });

  test("throws without apiKeyUid", () => {
    const engine = new MeilisearchEngine({ host: "http://x", apiKey: "k-long-enough-1234" });
    expect(() => engine.createTenantToken({ posts: {} }, { apiKeyUid: "" })).toThrow(/apiKeyUid/);
  });
});

describe("MeilisearchEngine.getApiKey()", () => {
  test("fetches /keys/{key} and returns the record", async () => {
    const { fn, calls } = mockFetch(() => ({ body: { uid: "u-1", name: "search", actions: ["search"] } }));
    const engine = new MeilisearchEngine({ host: "http://x", apiKey: "key", fetch: fn });
    const info = await engine.getApiKey();
    expect(info.uid).toBe("u-1");
    expect(calls[0].url).toBe("http://x/keys/key");
  });
});
