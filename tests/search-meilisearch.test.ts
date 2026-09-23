import { describe, expect, test } from "./harness.js";
import { MeilisearchEngine } from "../src/search/index.js";

type FetchCall = { url: string; init?: RequestInit };

function mockFetch(handler: (call: FetchCall) => { status?: number; body?: unknown; contentType?: string }) {
  const calls: FetchCall[] = [];
  const fn = async (url: any, init?: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    const result = handler(call);
    const status = result.status ?? 200;
    const contentType = result.contentType ?? "application/json";
    const bodyText = result.body === undefined ? null : JSON.stringify(result.body);
    return new Response(bodyText, { status, headers: { "content-type": contentType } });
  };
  return { fn: fn as unknown as typeof fetch, calls };
}

describe("MeilisearchEngine", () => {
  test("update groups by index and posts documents with primary key", async () => {
    const { fn, calls } = mockFetch(() => ({ body: { taskUid: 1 } }));
    const engine = new MeilisearchEngine({ host: "http://meili:7700", apiKey: "k", fetch: fn });
    await engine.update([
      { index: "posts", id: 1, data: { title: "Hello" } },
      { index: "posts", id: 2, data: { title: "World" } },
      { index: "users", id: 9, data: { name: "Jo" } },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe("http://meili:7700/indexes/posts/documents?primaryKey=id");
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body).toEqual([
      { title: "Hello", id: 1 },
      { title: "World", id: 2 },
    ]);
    expect((calls[0].init?.headers as any).authorization).toBe("Bearer k");
  });

  test("delete posts id batch per index", async () => {
    const { fn, calls } = mockFetch(() => ({ body: {} }));
    const engine = new MeilisearchEngine({ host: "http://meili:7700", fetch: fn });
    await engine.delete([
      { index: "posts", id: 1, data: {} },
      { index: "posts", id: 2, data: {} },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/indexes/posts/documents/delete-batch");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual([1, 2]);
  });

  test("search compiles filters and sorts", async () => {
    const { fn, calls } = mockFetch(() => ({ body: { hits: [{ id: 5, title: "Hi" }] } }));
    const engine = new MeilisearchEngine({ host: "http://meili:7700", fetch: fn });
    const hits = await engine.search({
      index: "posts",
      query: "hi",
      filters: [
        { kind: "cmp", bool: "and", field: "status", op: "=", value: "published" },
        { kind: "in", bool: "and", field: "tag", values: ["a", "b"] },
      ],
      sorts: [{ field: "created_at", direction: "desc" }],
    });
    expect(hits).toEqual([{ id: 5, data: { id: 5, title: "Hi" } }]);
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.q).toBe("hi");
    expect(body.filter).toBe('status = "published" AND tag IN ["a","b"]');
    expect(body.sort).toEqual(["created_at:desc"]);
  });

  test("paginate returns total/page/perPage", async () => {
    const { fn } = mockFetch(() => ({ body: { hits: [{ id: 1 }], totalHits: 42, page: 2, hitsPerPage: 10 } }));
    const engine = new MeilisearchEngine({ host: "http://meili:7700", fetch: fn });
    const page = await engine.paginate({ index: "posts", query: "", filters: [], sorts: [] }, 10, 2);
    expect(page).toMatchObject({ total: 42, page: 2, perPage: 10 });
    expect(page.hits[0].id).toBe(1);
  });

  test("flush DELETEs documents", async () => {
    const { fn, calls } = mockFetch(() => ({ status: 204 }));
    const engine = new MeilisearchEngine({ host: "http://meili:7700", fetch: fn });
    await engine.flush("posts");
    expect(calls[0].init?.method).toBe("DELETE");
    expect(calls[0].url).toContain("/indexes/posts/documents");
  });

  test("compiles between, null, exists, group, raw, and OR boolean", async () => {
    const { fn, calls } = mockFetch(() => ({ body: { hits: [] } }));
    const engine = new MeilisearchEngine({ host: "http://meili:7700", fetch: fn });
    await engine.search({
      index: "posts",
      query: "",
      sorts: [],
      filters: [
        { kind: "cmp", bool: "and", field: "status", op: "=", value: "published" },
        { kind: "cmp", bool: "or", field: "featured", op: "=", value: true },
        { kind: "between", bool: "and", field: "rank", from: 1, to: 10, negate: true },
        { kind: "null", bool: "and", field: "deleted_at" },
        { kind: "exists", bool: "and", field: "title", negate: true },
        {
          kind: "group", bool: "and",
          filters: [
            { kind: "cmp", bool: "and", field: "a", op: ">", value: 5 },
            { kind: "raw", bool: "or", expr: "b < 1" },
          ],
        },
      ],
    });
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.filter).toBe(
      'status = "published"' +
      ' OR featured = true' +
      ' AND NOT rank 1 TO 10' +
      ' AND deleted_at IS NULL' +
      ' AND title NOT EXISTS' +
      ' AND (a > 5 OR b < 1)',
    );
  });

  test("propagates limit + offset", async () => {
    const { fn, calls } = mockFetch(() => ({ body: { hits: [] } }));
    const engine = new MeilisearchEngine({ host: "http://meili:7700", fetch: fn });
    await engine.search({ index: "posts", query: "", filters: [], sorts: [], limit: 25, offset: 50 });
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.limit).toBe(25);
    expect(body.offset).toBe(50);
  });

  test("non-OK response throws with status", async () => {
    const { fn } = mockFetch(() => ({ status: 401, body: { message: "bad token" } }));
    const engine = new MeilisearchEngine({ host: "http://meili:7700", fetch: fn });
    await expect(engine.update([{ index: "posts", id: 1, data: {} }])).rejects.toThrow(/401/);
  });
});
