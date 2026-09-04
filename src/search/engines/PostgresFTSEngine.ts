import { Connection } from "../../connection/Connection.js";
import { resolveConnection } from "../../connection/ExecutionContext.js";
import type {
  FacetDistribution,
  SearchEngine,
  SearchFilter,
  SearchHealth,
  SearchHit,
  SearchMultiResult,
  SearchPage,
  SearchQuery,
  SearchCapabilities,
  SearchableRecord,
} from "../SearchEngine.js";
import { finiteSearchNumber, nonNegativeSearchInteger, validSearchOperator } from "../sqlSafety.js";
import { computeMatchesPosition } from "../matchPositions.js";

export interface PostgresFTSIndexConfig {
  /** Columns indexed for full-text search. */
  columns: string[];
  /** Columns stored alongside but not tokenized — used for filtering/facets. */
  unindexed?: string[];
  /** The language/dictionary config to use (default: 'english'). */
  language?: string;
  /**
   * When set, the engine creates AFTER INSERT/UPDATE/DELETE triggers keeping
   * the shadow table in sync with this source table.
   */
  contentTable?: string;
  contentRowid?: string;
  /** Optional PL/pgSQL expression condition (without WHEN) gating triggers. */
  triggerWhere?: { insert?: string; update?: string; delete?: string };
}

export interface PostgresFTSEngineOptions {
  /** Reuse the default ORM connection. Mutually exclusive with `connection`. */
  shared?: boolean;
  /** Explicit Connection instance. */
  connection?: Connection;
  /** Optional prefix for shadow tables to avoid clashes (default: '_fts_'). */
  prefix?: string;
  /** Default language/dictionary to use (default: 'english'). */
  defaultLanguage?: string;
  /** Automatically run triggers setup when creating indexes (default: true). */
  useTriggers?: boolean;
  /** Pre-registered index configurations. */
  indexes?: Record<string, PostgresFTSIndexConfig>;
}

export class PostgresFTSEngine implements SearchEngine {
  private readonly indexConfigs = new Map<string, PostgresFTSIndexConfig>();
  private readonly useTriggers: boolean;
  private readonly explicitConnection?: Connection;
  private readonly shared: boolean;
  private readonly prefix: string;
  private readonly defaultLanguage: string;

  constructor(options: PostgresFTSEngineOptions = {}) {
    if (options.connection && options.shared) {
      throw new Error("PostgresFTSEngine: pass at most one of `connection` or `shared`.");
    }
    this.explicitConnection = options.connection;
    this.shared = options.shared !== false; // defaults to true
    this.useTriggers = options.useTriggers !== false; // defaults to true
    this.prefix = options.prefix ?? "_fts_";
    this.defaultLanguage = options.defaultLanguage ?? "english";

    if (options.indexes) {
      for (const [name, cfg] of Object.entries(options.indexes)) {
        this.indexConfigs.set(name, cfg);
      }
    }
  }

  capabilities(): SearchCapabilities {
    return {
      nativeMultiSearch: false,
      indexSettings: false,
      matchesPosition: "approximate",
      highlight: true,
      crop: true,
      facets: true,
      minScore: true,
      searchOn: true,
      rawQuery: true,
      typoTolerance: false,
      vector: false,
      hybrid: false,
    };
  }

  configureIndex(name: string, config: PostgresFTSIndexConfig): void {
    this.indexConfigs.set(name, config);
  }

  private connection(): Connection {
    if (this.explicitConnection) return resolveConnection(this.explicitConnection, undefined, true);
    if (this.shared) return resolveConnection();
    throw new Error("PostgresFTSEngine: no active connection configured.");
  }

  private assertPostgres(): void {
    const driver = this.connection().getDriverName();
    if (driver !== "postgres") {
      throw new Error(`PostgresFTSEngine requires a PostgreSQL connection (got "${driver}").`);
    }
  }

  private requireConfig(name: string): PostgresFTSIndexConfig {
    const cfg = this.indexConfigs.get(name);
    if (!cfg) throw new Error(`PostgresFTSEngine: no schema configured for index "${name}".`);
    return cfg;
  }

  private allColumns(cfg: PostgresFTSIndexConfig): string[] {
    return [...cfg.columns, ...(cfg.unindexed ?? [])];
  }

  private quoteIdent(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }

  private qualifyTable(name: string): string {
    const table = this.prefix + name;
    const conn = this.connection();
    const schema = conn.getSchema();
    if (schema) {
      return `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`;
    }
    return `"${table.replace(/"/g, '""')}"`;
  }

  private qualifyFunction(name: string): string {
    const conn = this.connection();
    const schema = conn.getSchema();
    if (schema) {
      return `"${schema.replace(/"/g, '""')}"."${name.replace(/"/g, '""')}"`;
    }
    return `"${name.replace(/"/g, '""')}"`;
  }

  private qualifySrcTable(table: string): string {
    const conn = this.connection();
    const schema = conn.getSchema();
    if (schema && !table.includes(".")) {
      return `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`;
    }
    return table.split(".").map((t) => `"${t.replace(/"/g, '""')}"`).join(".");
  }

  private quoteLiteral(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
  }

  private generatedName(name: string, suffix = ""): string {
    const schema = this.connection().getSchema();
    const base = [schema, this.prefix, name, suffix].filter(Boolean).join("_");
    const clean = base.replace(/[^A-Za-z0-9_]/g, "_").replace(/_+/g, "_");
    return clean.slice(0, 50) || `fts_${suffix || "object"}`;
  }

  private dataColumns(query: SearchQuery, cfg: PostgresFTSIndexConfig): string[] {
    const cols = this.allColumns(cfg);
    if (!query.attributesToRetrieve || query.attributesToRetrieve.length === 0) {
      return cols;
    }
    this.assertKnownColumns(query.attributesToRetrieve, cols, "attributesToRetrieve");
    return cols.filter((c) => query.attributesToRetrieve!.includes(c));
  }

  private searchColumns(query: SearchQuery, cfg: PostgresFTSIndexConfig): string[] {
    if (!query.attributesToSearchOn || query.attributesToSearchOn.length === 0) {
      return cfg.columns;
    }
    this.assertKnownColumns(query.attributesToSearchOn, cfg.columns, "attributesToSearchOn");
    return cfg.columns.filter((c) => query.attributesToSearchOn!.includes(c));
  }

  private assertKnownColumns(fields: readonly string[], allowed: readonly string[], label: string): void {
    const invalid = fields.filter((field) => !allowed.includes(field));
    if (invalid.length > 0) {
      throw new Error(`PostgresFTSEngine: ${label} contains unknown column(s): ${invalid.join(", ")}.`);
    }
  }

  private searchVectorExpr(query: SearchQuery, cfg: PostgresFTSIndexConfig, lang: string): string {
    if (!query.attributesToSearchOn || query.attributesToSearchOn.length === 0) {
      return "search_vector";
    }
    const columns = this.searchColumns(query, cfg);
    if (columns.length === 0) {
      return `to_tsvector(${this.quoteLiteral(lang)}, '')`;
    }
    const concats = columns.map((c) => `coalesce(${this.quoteIdent(c)}, '')`);
    return `to_tsvector(${this.quoteLiteral(lang)}, ${concats.join(" || ' ' || ")})`;
  }

  private tsQueryExpr(query: SearchQuery, lang: string, placeholder: string): string {
    const fn = query.rawQuery ? "to_tsquery" : "websearch_to_tsquery";
    return `${fn}(${this.quoteLiteral(lang)}, ${placeholder})`;
  }

  private textValue(value: unknown): unknown {
    if (typeof value === "boolean") return value ? "true" : "false";
    if (value instanceof Date) return value.toISOString();
    return value;
  }

  async update(records: SearchableRecord[]): Promise<void> {
    if (records.length === 0) return;
    this.assertPostgres();
    const conn = this.connection();
    const byIndex = new Map<string, SearchableRecord[]>();
    for (const r of records) {
      const bucket = byIndex.get(r.index) ?? [];
      bucket.push(r);
      byIndex.set(r.index, bucket);
    }

    for (const [index, group] of byIndex) {
      const cfg = this.requireConfig(index);
      const cols = this.allColumns(cfg);
      const t = this.qualifyTable(index);
      const lang = cfg.language ?? this.defaultLanguage;

      for (const r of group) {
        const colNames = ["rowid", ...cols];
        const values: any[] = [String(r.id), ...cols.map((c) => r.data[c] ?? null)];

        // Build vectors concatenation for FTS
        const searchableCols = cfg.columns;
        let vectorExpr = "";
        if (searchableCols.length > 0) {
          const concats = searchableCols.map((_, i) => {
            const bindIdx = cols.indexOf(searchableCols[i]) + 2; // +1 for rowid, +1 for 1-based index
            return `coalesce($${bindIdx}, '')`;
          });
          vectorExpr = `to_tsvector(${this.quoteLiteral(lang)}, ${concats.join(" || ' ' || ")})`;
        } else {
          vectorExpr = `to_tsvector(${this.quoteLiteral(lang)}, '')`;
        }

        const placeholders = colNames.map((_, i) => `$${i + 1}`);
        const updateSets = [
          ...cols.map((c) => `${this.quoteIdent(c)} = EXCLUDED.${this.quoteIdent(c)}`),
          "search_vector = EXCLUDED.search_vector",
        ];

        const sql = `
          INSERT INTO ${t} (${colNames.map((c) => this.quoteIdent(c)).join(", ")}, search_vector)
          VALUES (${placeholders.join(", ")}, ${vectorExpr})
          ON CONFLICT (rowid) DO UPDATE SET
            ${updateSets.join(", ")}
        `;

        await conn.run(sql, values);
      }
    }
  }

  async delete(records: SearchableRecord[]): Promise<void> {
    if (records.length === 0) return;
    this.assertPostgres();
    const conn = this.connection();
    const byIndex = new Map<string, Array<string | number>>();
    for (const r of records) {
      const bucket = byIndex.get(r.index) ?? [];
      bucket.push(r.id);
      byIndex.set(r.index, bucket);
    }

    for (const [index, ids] of byIndex) {
      const t = this.qualifyTable(index);
      const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
      await conn.run(
        `DELETE FROM ${t} WHERE rowid IN (${placeholders})`,
        ids.map((id) => String(id)),
      );
    }
  }

  async search(query: SearchQuery): Promise<SearchHit[]> {
    this.assertPostgres();
    const { sql, bindings } = this.buildSelect(query, query.limit, query.offset);
    const rows = (await this.connection().query(sql, bindings)) as any[];
    return this.toHits(rows, query);
  }

  async paginate(query: SearchQuery, perPage: number, page: number): Promise<SearchPage> {
    this.assertPostgres();
    const offset = (Math.max(1, page) - 1) * perPage;
    const { sql, bindings } = this.buildSelect(query, perPage, offset);
    const rows = (await this.connection().query(sql, bindings)) as any[];
    const total = await this.countMatches(query);

    let facetDistribution: FacetDistribution | undefined;
    if ((query.facets && query.facets.length > 0) || (query.facetRanges && query.facetRanges.length > 0)) {
      facetDistribution = await this.computeFacets(query);
    }

    return {
      hits: this.toHits(rows, query),
      total,
      page,
      perPage,
      ...(facetDistribution ? { facetDistribution } : {}),
    };
  }

  async flush(index: string): Promise<void> {
    this.assertPostgres();
    await this.connection().run(`TRUNCATE TABLE ${this.qualifyTable(index)}`);
  }

  async createIndex(name: string, options: Record<string, unknown> = {}): Promise<void> {
    this.assertPostgres();
    const cfg = this.requireConfig(name);
    const conn = this.connection();
    const t = this.qualifyTable(name);

    const cols = this.allColumns(cfg);
    const colDefs = cols.map((c) => `${this.quoteIdent(c)} TEXT`);

    const extraColSql = colDefs.length > 0 ? `,\n        ${colDefs.join(",\n")}` : "";

    // Create shadow table
    await conn.run(`
      CREATE TABLE IF NOT EXISTS ${t} (
        rowid VARCHAR(255) PRIMARY KEY,
        search_vector tsvector${extraColSql}
      )
    `);

    // Create GIN index
    const cleanIndexName = this.generatedName(name, "vector");
    await conn.run(`
      CREATE INDEX IF NOT EXISTS ${this.quoteIdent(`${cleanIndexName}_idx`)} ON ${t} USING GIN(search_vector)
    `);

    if (this.useTriggers && cfg.contentTable) {
      await this.createTriggers(name, cfg);
    }
  }

  async deleteIndex(name: string): Promise<void> {
    this.assertPostgres();
    const conn = this.connection();
    const cfg = this.indexConfigs.get(name);
    if (this.useTriggers && cfg?.contentTable) {
      await this.dropTriggers(name, cfg);
    }
    await conn.run(`DROP TABLE IF EXISTS ${this.qualifyTable(name)}`);
  }

  async indexExists(name: string): Promise<boolean> {
    this.assertPostgres();
    const conn = this.connection();
    const schema = conn.getSchema() ?? "public";
    const tableName = this.prefix + name;

    const rows = await conn.query(`
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1
      AND c.relname = $2
      AND c.relkind = 'r'
    `, [schema, tableName]);

    return rows.length > 0;
  }

  async health(): Promise<SearchHealth> {
    try {
      this.assertPostgres();
      await this.connection().query("SELECT 1");
      return { status: "available" };
    } catch (err) {
      return { status: "unavailable", details: err instanceof Error ? err.message : String(err) };
    }
  }

  async multiSearch(queries: SearchQuery[]): Promise<SearchMultiResult[]> {
    const out: SearchMultiResult[] = [];
    for (const q of queries) {
      const hits = await this.search(q);
      out.push({ index: q.index, hits });
    }
    return out;
  }

  async rebuild(name: string): Promise<void> {
    this.assertPostgres();
    const cfg = this.requireConfig(name);
    if (!cfg.contentTable) {
      throw new Error(`PostgresFTSEngine.rebuild("${name}"): rebuild requires contentTable configured.`);
    }

    const conn = this.connection();
    const t = this.qualifyTable(name);
    const src = this.qualifySrcTable(cfg.contentTable);
    const cols = this.allColumns(cfg);
    const rowid = cfg.contentRowid ?? "id";
    const lang = cfg.language ?? this.defaultLanguage;

    // Clear existing
    await conn.run(`TRUNCATE TABLE ${t}`);

    // Rebuild vectors concatenation
    let vectorExpr = "";
    if (cfg.columns.length > 0) {
      const concats = cfg.columns.map((c) => `coalesce(${this.quoteIdent(c)}, '')`);
      vectorExpr = `to_tsvector(${this.quoteLiteral(lang)}, ${concats.join(" || ' ' || ")})`;
    } else {
      vectorExpr = `to_tsvector(${this.quoteLiteral(lang)}, '')`;
    }

    const colList = ["rowid", ...cols].map((c) => this.quoteIdent(c)).join(", ");
    const srcColList = [this.quoteIdent(rowid), ...cols].map((c) => `${src}.${c}`).join(", ");

    await conn.run(`
      INSERT INTO ${t} (${colList}, search_vector)
      SELECT ${srcColList}, ${vectorExpr} FROM ${src}
    `);
  }

  async diagnostics(): Promise<Record<string, unknown>> {
    this.assertPostgres();
    const conn = this.connection();
    const result: Record<string, unknown> = { driver: "postgres" };

    try {
      const rows = await conn.query("SELECT version() as v");
      result.version = rows[0]?.v;
    } catch {
      // ignore
    }

    result.indexes = [...this.indexConfigs.keys()];
    const counts: Record<string, number> = {};
    for (const name of this.indexConfigs.keys()) {
      try {
        const rows = await conn.query(`SELECT COUNT(*) AS c FROM ${this.qualifyTable(name)}`);
        counts[name] = Number(rows[0]?.c ?? 0);
      } catch {
        counts[name] = -1;
      }
    }
    result.index_rows = counts;
    return result;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async createTriggers(name: string, cfg: PostgresFTSIndexConfig): Promise<void> {
    if (!cfg.contentTable) return;
    const conn = this.connection();
    const t = this.qualifyTable(name);
    const src = this.qualifySrcTable(cfg.contentTable);
    const cols = this.allColumns(cfg);
    const rowid = cfg.contentRowid ?? "id";
    const lang = cfg.language ?? this.defaultLanguage;
    const cleanIndexName = this.generatedName(name);

    const funcName = `${cleanIndexName}_sync`;
    const qualifiedFuncName = this.qualifyFunction(funcName);
    const triggerName = `${cleanIndexName}_trig`;

    // Drop first for idempotency
    await this.dropTriggers(name, cfg);

    // Build trigger function
    let vectorExpr = "";
    if (cfg.columns.length > 0) {
      const concats = cfg.columns.map((c) => `coalesce(NEW.${this.quoteIdent(c)}, '')`);
      vectorExpr = `to_tsvector(${this.quoteLiteral(lang)}, ${concats.join(" || ' ' || ")})`;
    } else {
      vectorExpr = `to_tsvector(${this.quoteLiteral(lang)}, '')`;
    }

    const colList = ["rowid", ...cols].map((c) => this.quoteIdent(c)).join(", ");
    const newColList = [`NEW.${this.quoteIdent(rowid)}::text`, ...cols.map((c) => `NEW.${this.quoteIdent(c)}`)].join(", ");
    const updateSets = [
      ...cols.map((c) => `${this.quoteIdent(c)} = EXCLUDED.${this.quoteIdent(c)}`),
      "search_vector = EXCLUDED.search_vector",
    ];

    const plpgsql = `
      CREATE OR REPLACE FUNCTION ${qualifiedFuncName}() RETURNS TRIGGER AS $$
      BEGIN
        IF (TG_OP = 'DELETE') THEN
          DELETE FROM ${t} WHERE rowid = OLD.${this.quoteIdent(rowid)}::text;
          RETURN OLD;
        ELSIF (TG_OP = 'UPDATE') THEN
          DELETE FROM ${t} WHERE rowid = OLD.${this.quoteIdent(rowid)}::text;
        END IF;

        INSERT INTO ${t} (${colList}, search_vector)
        VALUES (${newColList}, ${vectorExpr})
        ON CONFLICT (rowid) DO UPDATE SET ${updateSets.join(", ")};
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `;

    await conn.run(plpgsql);

    // Hook triggers
    const where = cfg.triggerWhere ?? {};
    const whenIns = where.insert ? ` WHEN (${where.insert})` : "";
    const whenUpd = where.update ? ` WHEN (${where.update})` : "";
    const whenDel = where.delete ? ` WHEN (${where.delete})` : "";

    await conn.run(`
      CREATE TRIGGER ${this.quoteIdent(`${triggerName}_ins`)}
      AFTER INSERT ON ${src}
      FOR EACH ROW
      ${whenIns}
      EXECUTE FUNCTION ${qualifiedFuncName}()
    `);

    await conn.run(`
      CREATE TRIGGER ${this.quoteIdent(`${triggerName}_upd`)}
      AFTER UPDATE ON ${src}
      FOR EACH ROW
      ${whenUpd}
      EXECUTE FUNCTION ${qualifiedFuncName}()
    `);

    await conn.run(`
      CREATE TRIGGER ${this.quoteIdent(`${triggerName}_del`)}
      AFTER DELETE ON ${src}
      FOR EACH ROW
      ${whenDel}
      EXECUTE FUNCTION ${qualifiedFuncName}()
    `);
  }

  private async dropTriggers(name: string, cfg: PostgresFTSIndexConfig): Promise<void> {
    if (!cfg.contentTable) return;
    const conn = this.connection();
    const src = this.qualifySrcTable(cfg.contentTable);
    const cleanIndexName = this.generatedName(name);

    const funcName = `${cleanIndexName}_sync`;
    const qualifiedFuncName = this.qualifyFunction(funcName);
    const triggerName = `${cleanIndexName}_trig`;

    for (const suffix of ["ins", "upd", "del"]) {
      await conn.run(`DROP TRIGGER IF EXISTS ${this.quoteIdent(`${triggerName}_${suffix}`)} ON ${src}`);
    }
    await conn.run(`DROP FUNCTION IF EXISTS ${qualifiedFuncName}()`);
  }

  private buildSelect(query: SearchQuery, limit?: number, offset?: number): { sql: string; bindings: any[] } {
    const cfg = this.requireConfig(query.index);
    const cols = this.allColumns(cfg);
    const dataCols = this.dataColumns(query, cfg);
    const t = this.qualifyTable(query.index);
    const lang = cfg.language ?? this.defaultLanguage;

    const matchFields = this.searchColumns(query, cfg);
    const selectCols = [...new Set([...dataCols, ...matchFields])];
    const selectFrags: string[] = ["rowid", ...selectCols.map((c) => this.quoteIdent(c))];
    const selectBindings: any[] = [];
    const counter = { val: 1 };

    const hasMatch = query.query.trim().length > 0;
    const vectorExpr = this.searchVectorExpr(query, cfg, lang);

    if (hasMatch) {
      selectBindings.push(query.query);
      const matchIdx = counter.val++;
      const tsQuery = this.tsQueryExpr(query, lang, `$${matchIdx}`);
      selectFrags.push(`ts_rank(${vectorExpr}, ${tsQuery}) AS _score`);

      if (query.highlight && query.highlight.fields.length > 0) {
        const pre = query.highlight.preTag ?? "<mark>";
        const post = query.highlight.postTag ?? "</mark>";
        const tagOption = `StartSel=${pre}, StopSel=${post}`;

        for (const field of query.highlight.fields) {
          if (!cols.includes(field)) continue;
          selectFrags.push(`ts_headline(${this.quoteLiteral(lang)}, ${this.quoteIdent(field)}, ${tsQuery}, ${this.quoteLiteral(tagOption)}) AS ${this.quoteIdent(`_hl_${field}`)}`);
        }
      }

      if (query.crop && query.crop.length > 0) {
        const pre = query.highlight?.preTag ?? "<mark>";
        const post = query.highlight?.postTag ?? "</mark>";

        for (const c of query.crop) {
          if (!cols.includes(c.field)) continue;
          const tokens = c.length ?? 16;
          const tagOption = `StartSel=${pre}, StopSel=${post}, MinWords=1, MaxWords=${tokens}`;
          selectFrags.push(`ts_headline(${this.quoteLiteral(lang)}, ${this.quoteIdent(c.field)}, ${tsQuery}, ${this.quoteLiteral(tagOption)}) AS ${this.quoteIdent(`_snip_${c.field}`)}`);

        }
      }
    } else {
      if (query.showRankingScore || (query.minScore !== undefined && query.minScore > 0)) {
        selectFrags.push("0.0 AS _score");
      }
    }

    const where: string[] = [];
    const whereBindings: any[] = [];

    if (hasMatch) {
      const matchIdx = selectBindings.indexOf(query.query) + 1; // 1-based index
      where.push(`${vectorExpr} @@ ${this.tsQueryExpr(query, lang, `$${matchIdx}`)}`);
    }

    const filterSql = this.compileFilters(query.filters, whereBindings, counter);
    if (filterSql) {
      where.push(filterSql);
    }

    // Combine select and where bindings
    const allBindings = [...selectBindings, ...whereBindings];

    let havingClause = "";
    if (query.minScore !== undefined && query.minScore > 0) {
      if (hasMatch) {
        const matchIdx = selectBindings.indexOf(query.query) + 1;
        havingClause = ` HAVING ts_rank(${vectorExpr}, ${this.tsQueryExpr(query, lang, `$${matchIdx}`)}) >= $${counter.val++}`;
        allBindings.push(query.minScore);
      }
    }

    const groupCols = [...new Set([...selectCols, ...(query.highlight?.fields ?? []), ...(query.crop ?? []).map((c) => c.field)])]
      .filter((c) => cols.includes(c));
    const groupBy = ["rowid", ...groupCols.map((c) => this.quoteIdent(c)), "search_vector"];
    const groupClause = havingClause ? ` GROUP BY ${groupBy.join(", ")}` : "";

    const sortClause = this.compileSort(query, hasMatch, lang, vectorExpr);
    const limitClause = limit !== undefined
      ? ` LIMIT ${nonNegativeSearchInteger(limit, "Search limit")}`
      : "";
    const offsetClause = offset !== undefined && offset > 0
      ? ` OFFSET ${nonNegativeSearchInteger(offset, "Search offset")}`
      : "";

    const sql = `SELECT ${selectFrags.join(", ")} FROM ${t}` +
      (where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "") +
      groupClause + havingClause + sortClause + limitClause + offsetClause;

    return { sql, bindings: allBindings };
  }

  private async countMatches(query: SearchQuery): Promise<number> {
    const cfg = this.requireConfig(query.index);
    const bindings: any[] = [];
    const where: string[] = [];
    const counter = { val: 1 };
    const lang = cfg.language ?? this.defaultLanguage;
    const vectorExpr = this.searchVectorExpr(query, cfg, lang);

    if (query.query && query.query.trim().length > 0) {
      bindings.push(query.query);
      const matchIdx = counter.val++;
      const tsQuery = this.tsQueryExpr(query, lang, `$${matchIdx}`);
      where.push(`${vectorExpr} @@ ${tsQuery}`);
      if (query.minScore !== undefined && query.minScore > 0) {
        bindings.push(query.minScore);
        where.push(`ts_rank(${vectorExpr}, ${tsQuery}) >= $${counter.val++}`);
      }
    }

    const filterSql = this.compileFilters(query.filters, bindings, counter);
    if (filterSql) where.push(filterSql);

    const sql = `SELECT COUNT(*) AS c FROM ${this.qualifyTable(query.index)}` +
      (where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "");

    const rows = (await this.connection().query(sql, bindings)) as any[];
    return Number(rows[0]?.c ?? 0);
  }

  private async computeFacets(query: SearchQuery): Promise<FacetDistribution> {
    const out: FacetDistribution = {};
    const cfg = this.requireConfig(query.index);
    const cols = this.allColumns(cfg);
    const lang = cfg.language ?? this.defaultLanguage;

    const baseWhere = (): { where: string[]; bindings: any[]; counter: { val: number } } => {
      const bindings: any[] = [];
      const where: string[] = [];
      const counter = { val: 1 };
      const vectorExpr = this.searchVectorExpr(query, cfg, lang);
      if (query.query && query.query.trim().length > 0) {
        bindings.push(query.query);
        const matchIdx = counter.val++;
        const tsQuery = this.tsQueryExpr(query, lang, `$${matchIdx}`);
        where.push(`${vectorExpr} @@ ${tsQuery}`);
        if (query.minScore !== undefined && query.minScore > 0) {
          bindings.push(query.minScore);
          where.push(`ts_rank(${vectorExpr}, ${tsQuery}) >= $${counter.val++}`);
        }
      }
      const filterSql = this.compileFilters(query.filters, bindings, counter);
      if (filterSql) where.push(filterSql);
      return { where, bindings, counter };
    };

    for (const field of query.facets ?? []) {
      if (!cols.includes(field)) {
        throw new Error(`PostgresFTSEngine: facet contains unknown column: ${field}.`);
      }
      const { where, bindings } = baseWhere();
      const t = this.qualifyTable(query.index);
      const f = this.quoteIdent(field);
      const sql = `SELECT ${f} AS value, COUNT(*) AS c FROM ${t}` +
        (where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "") +
        ` GROUP BY ${f}`;
      const rows = (await this.connection().query(sql, bindings)) as any[];
      const bucket: Record<string, number> = {};
      for (const r of rows) {
        if (r.value == null) continue;
        bucket[String(r.value)] = Number(r.c);
      }
      out[field] = bucket;
    }

    for (const range of query.facetRanges ?? []) {
      if (!cols.includes(range.field)) {
        throw new Error(`PostgresFTSEngine: facetRange contains unknown column: ${range.field}.`);
      }
      const buckets = range.buckets;
      if (buckets.length === 0) continue;
      const caseFrags: string[] = [];
      const labels: string[] = [];
      const f = this.quoteIdent(range.field);

      for (let i = 0; i < buckets.length; i++) {
        const lo = finiteSearchNumber(buckets[i], "Facet bucket");
        const hi = buckets[i + 1] === undefined
          ? undefined
          : finiteSearchNumber(buckets[i + 1], "Facet bucket");
        const label = range.labels?.[i] ?? (hi !== undefined ? `${lo}-${hi}` : `${lo}+`);
        labels.push(label);
        if (hi !== undefined) {
          caseFrags.push(`WHEN ${f}::numeric >= ${lo} AND ${f}::numeric < ${hi} THEN ${this.quoteLiteral(label)}`);
        } else {
          caseFrags.push(`WHEN ${f}::numeric >= ${lo} THEN ${this.quoteLiteral(label)}`);
        }
      }
      const { where, bindings } = baseWhere();
      const caseExpr = `CASE ${caseFrags.join(" ")} ELSE NULL END`;
      const t = this.qualifyTable(query.index);
      const sql = `SELECT ${caseExpr} AS bucket, COUNT(*) AS c FROM ${t}` +
        (where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "") +
        ` GROUP BY bucket`;
      const rows = (await this.connection().query(sql, bindings)) as any[];
      const bucket: Record<string, number> = {};
      for (const label of labels) bucket[label] = 0;
      for (const r of rows) {
        if (r.bucket == null) continue;
        bucket[String(r.bucket)] = Number(r.c);
      }
      out[range.field] = bucket;
    }
    return out;
  }

  private compileFilters(filters: SearchFilter[], bindings: any[], counter: { val: number }): string {
    if (filters.length === 0) return "";
    return this.joinFilters(filters, bindings, counter);
  }

  private joinFilters(filters: SearchFilter[], bindings: any[], counter: { val: number }): string {
    let out = "";
    filters.forEach((f, i) => {
      const expr = this.compileFilter(f, bindings, counter);
      if (i === 0) out = expr;
      else out += ` ${f.bool === "or" ? "OR" : "AND"} ${expr}`;
    });
    return out;
  }

  private compileFilter(f: SearchFilter, bindings: any[], counter: { val: number }): string {
    const nextPlaceholder = () => `$${counter.val++}`;
    switch (f.kind) {
      case "cmp": {
        const operator = validSearchOperator(f.op);
        if (f.value === null) {
          const expr = operator === "!=" ? `${this.quoteIdent(f.field)} IS NOT NULL` : `${this.quoteIdent(f.field)} IS NULL`;
          return f.negate ? `NOT (${expr})` : expr;
        }
        if (typeof f.value === "number") {
          // Cast field to numeric for proper comparison.
          bindings.push(f.value);
          return `${this.quoteIdent(f.field)}::numeric ${operator} ${nextPlaceholder()}`;
        }
        bindings.push(this.textValue(f.value));
        const expr = `${this.quoteIdent(f.field)} ${operator} ${nextPlaceholder()}`;
        return f.negate ? `NOT (${expr})` : expr;
      }
      case "in": {
        const allNumbers = f.values.every((val) => typeof val === "number");
        const phs = f.values.map((val) => {
          bindings.push(allNumbers ? val : this.textValue(val));
          return nextPlaceholder();
        }).join(", ");
        const field = allNumbers ? `${this.quoteIdent(f.field)}::numeric` : this.quoteIdent(f.field);
        const expr = `${field} IN (${phs})`;
        return f.negate ? `NOT (${expr})` : expr;
      }
      case "between": {
        // Push both bounds for binding.
        bindings.push(f.from, f.to);
        // Use numeric cast for field.
        const placeholderFrom = nextPlaceholder();
        const placeholderTo = nextPlaceholder();
        const expr = `${this.quoteIdent(f.field)}::numeric BETWEEN ${placeholderFrom} AND ${placeholderTo}`;
        return f.negate ? `NOT (${expr})` : expr;
      }
      case "null": {
        return f.negate
          ? `${this.quoteIdent(f.field)} IS NOT NULL`
          : `${this.quoteIdent(f.field)} IS NULL`;
      }
      case "exists": {
        return f.negate
          ? `${this.quoteIdent(f.field)} IS NULL`
          : `${this.quoteIdent(f.field)} IS NOT NULL`;
      }
      case "group": {
        const inner = this.joinFilters(f.filters, bindings, counter);
        const wrapped = `(${inner})`;
        return f.negate ? `NOT ${wrapped}` : wrapped;
      }
      case "raw": {
        if (f.bindings && f.bindings.length > 0) {
          bindings.push(...f.bindings);
          // Simple naive mapping of ? to numbered placeholders
          let expr = f.expr;
          while (expr.includes("?")) {
            expr = expr.replace("?", nextPlaceholder());
          }
          return expr;
        }
        return f.expr;
      }
    }
  }

  private compileSort(query: SearchQuery, hasMatch: boolean, lang: string, vectorExpr: string): string {
    if (query.sorts.length === 0) {
      if (hasMatch) {
        return ` ORDER BY ts_rank(${vectorExpr}, ${this.tsQueryExpr(query, lang, "$1")}) DESC`;
      }
      return ` ORDER BY rowid`;
    }
    const parts = query.sorts.map(
      (s) => `${this.quoteIdent(s.field)} ${s.direction === "desc" ? "DESC" : "ASC"}`,
    );
    return ` ORDER BY ${parts.join(", ")}`;
  }

  private toHits(rows: any[], query: SearchQuery): SearchHit[] {
    const cfg = this.requireConfig(query.index);
    const cols = this.dataColumns(query, cfg);
    const matchFields = this.searchColumns(query, cfg);
    return rows.map((row) => {
      const data: Record<string, unknown> = {};
      for (const c of cols) data[c] = row[c];
      const hit: SearchHit = { id: row.rowid, data };
      if (row._score !== undefined) {
        hit.score = Number(row._score);
      }
      const formatted: Record<string, unknown> = {};
      if (query.highlight) {
        for (const f of query.highlight.fields) {
          const key = `_hl_${f}`;
          if (row[key] !== undefined) formatted[f] = row[key];
        }
      }
      if (query.crop) {
        for (const c of query.crop) {
          const key = `_snip_${c.field}`;
          if (row[key] !== undefined) formatted[c.field] = row[key];
        }
      }
      if (Object.keys(formatted).length > 0) hit.formatted = formatted;
      const matchData: Record<string, unknown> = {};
      for (const field of matchFields) matchData[field] = row[field];
      const matchesPosition = computeMatchesPosition(query, matchData, matchFields);
      if (matchesPosition) hit.matchesPosition = matchesPosition;
      return hit;
    });
  }
}
