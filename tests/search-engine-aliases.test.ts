import { beforeEach, describe, expect, test } from "./harness.js";
import { Connection } from "../src/index.js";
import {
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

  // The config type already rejects this; the @ts-expect-error directive
  // asserts that, and the matcher asserts the runtime guard behind it.
  test("rejects a connection passed next to a custom engine instance", () => {
    expect(() => Search.configure({
      engine: new CustomEngine(),
      // @ts-expect-error connection is only supported with the built-in engine aliases.
      connection: { url: "sqlite://:memory:" },
    })).toThrow("only supported with built-in engine aliases");
  });

  test("rejects unknown engine names at runtime", () => {
    expect(() => Search.configure({ engine: "elastic" as any })).toThrow('Unknown search engine "elastic". Expected one of: pg, sqlite.');
    // The Meilisearch engine was removed; its old aliases must not resolve to anything.
    expect(() => Search.configure({ engine: "meilisearch" as any })).toThrow('Unknown search engine "meilisearch"');
    expect(() => Search.configure({ engine: "meili" as any })).toThrow('Unknown search engine "meili"');
    expect(Search.config()).toBeNull();
  });
});
