import { beforeEach, describe, expect, test } from "./harness.js";
import { Connection } from "../src/index.js";
import {
  MeilisearchEngine,
  PostgresFTSEngine,
  Search,
  type SearchEngine,
  type SearchHit,
  type SearchPage,
  type SearchQuery,
  type SearchableRecord,
  SqliteFTS5Engine,
} from "../src/search/index.js";

class CustomEngine implements SearchEngine {
  async update(_records: SearchableRecord[]): Promise<void> {}
  async delete(_records: SearchableRecord[]): Promise<void> {}
  async search(_query: SearchQuery): Promise<SearchHit[]> { return []; }
  async paginate(_query: SearchQuery, perPage: number, page: number): Promise<SearchPage> {
    return { hits: [], total: 0, page, perPage };
  }
  async flush(_index: string): Promise<void> {}
  async createIndex(_name: string): Promise<void> {}
  async deleteIndex(_name: string): Promise<void> {}
  async updateIndexSettings(_name: string, _settings: Record<string, unknown>): Promise<void> {}
}

describe("Search.configure engine aliases", () => {
  beforeEach(() => Search.reset());

  test("resolves built-in engine names to default engine instances", () => {
    Search.configure({ engine: "sqlite" });
    expect(Search.engine()).toBeInstanceOf(SqliteFTS5Engine);
    expect(Search.capabilities().matchesPosition).toBe("approximate");
    expect(Search.supports("indexSettings")).toBe(false);

    Search.configure({ engine: "pg" });
    expect(Search.engine()).toBeInstanceOf(PostgresFTSEngine);
    expect(Search.capabilities().matchesPosition).toBe("approximate");
    expect(Search.supports("nativeMultiSearch")).toBe(false);

    Search.configure({ engine: "meilisearch" });
    expect(Search.engine()).toBeInstanceOf(MeilisearchEngine);
    expect(Search.capabilities().matchesPosition).toBe("native");
    expect(Search.supports("indexSettings")).toBe(true);
  });

  test("keeps custom engine instances unchanged", () => {
    const engine = new CustomEngine();

    Search.configure({ engine });

    expect(Search.engine()).toBe(engine);
  });

  test("uses search.connection for connection-backed engine aliases", async () => {
    Search.configure({
      engine: "sqlite",
      connection: { url: "sqlite://:memory:" },
    });

    const health = await Search.engine().health?.();

    expect(Search.engine()).toBeInstanceOf(SqliteFTS5Engine);
    expect(health?.status).toBe("available");
  });

  test("passes host and apiKey to the meilisearch alias", async () => {
    const calls: Array<{ url: string; authorization?: string }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push({
        url: String(input),
        authorization: init?.headers && typeof init.headers === "object" && !Array.isArray(init.headers)
          ? (init.headers as Record<string, string>).authorization
          : undefined,
      });
      return new Response(JSON.stringify({ hits: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      Search.configure({
        engine: "meilisearch",
        host: "http://search.test",
        apiKey: "secret",
      });

      await Search.engine().search({ index: "posts", query: "rust", filters: [], sorts: [] });

      expect(calls[0]).toEqual({
        url: "http://search.test/indexes/posts/search",
        authorization: "Bearer secret",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("accepts a Connection instance for connection-backed engine aliases", async () => {
    const connection = new Connection({ url: "sqlite://:memory:" });
    try {
      Search.configure({ engine: "sqlite", connection });

      const health = await Search.engine().health?.();

      expect(Search.engine()).toBeInstanceOf(SqliteFTS5Engine);
      expect(health?.status).toBe("available");
    } finally {
      await connection.close();
    }
  });

  // The config type already rejects each of these combinations; the @ts-expect-error
  // directives assert that, and the matchers assert the runtime guard behind it.
  test("rejects incompatible alias options", () => {
    expect(() => Search.configure({
      engine: "meilisearch",
      // @ts-expect-error connection is not a Meilisearch option.
      connection: { url: "sqlite://:memory:" },
    })).toThrow("not supported for the Meilisearch");

    expect(() => Search.configure({
      engine: "sqlite",
      // @ts-expect-error host is a Meilisearch-only option.
      host: "http://search.test",
    })).toThrow("only supported for the Meilisearch");

    expect(() => Search.configure({
      engine: "pg",
      // @ts-expect-error apiKey is a Meilisearch-only option.
      apiKey: "secret",
    })).toThrow("only supported for the Meilisearch");

    expect(() => Search.configure({
      engine: new CustomEngine(),
      // @ts-expect-error host is only supported with the built-in engine aliases.
      host: "http://search.test",
    })).toThrow("only supported with built-in engine aliases");
  });

  test("rejects unknown engine names at runtime", () => {
    expect(() => Search.configure({ engine: "elastic" as any })).toThrow("Unknown search engine");
  });
});
