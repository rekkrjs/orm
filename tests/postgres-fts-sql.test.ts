import { describe, expect, test } from "bun:test";
import type { Connection } from "../src/index.js";
import { PostgresFTSEngine } from "../src/search/engines/PostgresFTSEngine.js";

class FakePostgresConnection {
  runs: Array<{ sql: string; bindings?: unknown[] }> = [];
  queries: Array<{ sql: string; bindings?: unknown[] }> = [];

  constructor(private readonly schema?: string) {}

  reusableConnection() { return this; }
  isRetired() { return false; }

  getDriverName(): string {
    return "postgres";
  }

  getSchema(): string | undefined {
    return this.schema;
  }

  async run(sql: string, bindings?: unknown[]): Promise<void> {
    this.runs.push({ sql: compact(sql), bindings });
  }

  async query(sql: string, bindings?: unknown[]): Promise<Array<Record<string, unknown>>> {
    this.queries.push({ sql: compact(sql), bindings });
    return [{ c: 1 }];
  }
}

function compact(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

function makeEngine(connection = new FakePostgresConnection()): PostgresFTSEngine {
  const engine = new PostgresFTSEngine({ connection: connection as unknown as Connection });
  engine.configureIndex("students", {
    columns: ["first_name", "last_name", "full_name"],
    unindexed: ["status", "views", "published"],
    contentTable: "students",
  });
  return engine;
}

describe("PostgresFTSEngine SQL generation", () => {
  test("searchOn uses only selected indexed columns and raw queries use to_tsquery", () => {
    const engine = makeEngine();

    const { sql, bindings } = (engine as any).buildSelect({
      index: "students",
      query: "Jane:* & Doe",
      filters: [],
      sorts: [],
      attributesToSearchOn: ["full_name"],
      attributesToRetrieve: ["full_name"],
      rawQuery: true,
    });

    expect(compact(sql)).toContain(`SELECT rowid, "full_name",`);
    expect(compact(sql)).toContain(`FROM "_fts_students"`);
    expect(compact(sql)).toContain(`to_tsvector('english', coalesce("full_name", '')) @@ to_tsquery('english', $1)`);
    expect(compact(sql)).not.toContain(`coalesce("first_name", '')`);
    expect(bindings).toEqual(["Jane:* & Doe"]);
  });

  test("toHits returns only requested retrieve fields", () => {
    const engine = makeEngine();
    const hits = (engine as any).toHits(
      [{ rowid: "1", first_name: "Jane", last_name: "Doe", full_name: "Jane Doe" }],
      {
        index: "students",
        query: "Jane",
        filters: [],
        sorts: [],
        attributesToRetrieve: ["full_name"],
      },
    );

    expect(hits[0].data).toEqual({ full_name: "Jane Doe" });
  });

  test("toHits includes matchesPosition without leaking internally selected fields", () => {
    const engine = makeEngine();
    const hits = (engine as any).toHits(
      [{
        rowid: "1",
        first_name: "Jane",
        last_name: "Doe",
        full_name: "Jane Doe",
        status: "active",
      }],
      {
        index: "students",
        query: "Jane Doe",
        filters: [],
        sorts: [],
        attributesToSearchOn: ["full_name"],
        attributesToRetrieve: ["status"],
      },
    );

    expect(hits[0].data).toEqual({ status: "active" });
    expect(hits[0].matchesPosition).toEqual({
      full_name: [
        { start: 0, length: 4 },
        { start: 5, length: 3 },
      ],
    });
  });

  test("countMatches applies minScore to pagination totals", async () => {
    const connection = new FakePostgresConnection();
    const engine = makeEngine(connection);

    await (engine as any).countMatches({
      index: "students",
      query: "Jane",
      filters: [],
      sorts: [],
      minScore: 0.25,
    });

    expect(connection.queries[0].sql).toContain(`ts_rank(search_vector, websearch_to_tsquery('english', $1)) >= $2`);
    expect(connection.queries[0].bindings).toEqual(["Jane", 0.25]);
  });

  test("filters normalize text-stored values and cast numeric whereIn", () => {
    const engine = makeEngine();

    const { sql, bindings } = (engine as any).buildSelect({
      index: "students",
      query: "",
      filters: [
        { kind: "cmp", bool: "and", field: "published", op: "=", value: true },
        { kind: "in", bool: "and", field: "views", values: [10, 20] },
      ],
      sorts: [],
    });

    expect(compact(sql)).toContain(`"published" = $1 AND "views"::numeric IN ($2, $3)`);
    expect(bindings).toEqual(["true", 10, 20]);
  });

  test("trigger functions are schema-qualified for schema-per-tenant usage", async () => {
    const connection = new FakePostgresConnection("tenant_a");
    const engine = makeEngine(connection);

    await engine.createIndex("students");

    const functionSql = connection.runs.find((run) => run.sql.includes("CREATE OR REPLACE FUNCTION"))?.sql;
    const triggerSql = connection.runs.find((run) => run.sql.includes("CREATE TRIGGER") && run.sql.includes("_ins"))?.sql;

    expect(functionSql).toContain(`CREATE OR REPLACE FUNCTION "tenant_a"."tenant_a_fts_students_sync"()`);
    expect(triggerSql).toContain(`EXECUTE FUNCTION "tenant_a"."tenant_a_fts_students_sync"()`);
  });
});
