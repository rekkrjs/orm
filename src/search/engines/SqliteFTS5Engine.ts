import { Connection } from "../../connection/Connection.js";
import { ConnectionManager } from "../../connection/ConnectionManager.js";
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

/** Type-safe helper for defining an FTS5 schema from a model's attribute interface. */
export function defineFtsConfig<Attrs>(
  config: {
    columns: Array<keyof Attrs & string>;
    unindexed?: Array<keyof Attrs & string>;
    tokenizer?: string;
    contentTable?: string;
    contentRowid?: keyof Attrs & string;
    triggerWhere?: { insert?: string; update?: string; delete?: string };
  },
): SqliteFTS5IndexConfig {
  return config as SqliteFTS5IndexConfig;
}

export interface SqliteFTS5IndexConfig {
  /** Columns indexed for full-text search. */
  columns: string[];
  /** Columns stored alongside but not tokenized — used for filtering. */
  unindexed?: string[];
  /** Tokenizer. Default `unicode61`. Examples: `porter`, `trigram`, `ascii`. */
  tokenizer?: string;
  /**
   * When set, the FTS5 table is wired as a content-less external table that
   * mirrors `contentTable.contentRowid`. Required for trigger-driven sync.
   */
  contentTable?: string;
  contentRowid?: string;
  /**
   * Optional SQL fragments (without leading `WHEN `) that gate AI/AU/AD
   * triggers. Example: `triggerWhere: { insert: "new.status = 'published'" }`.
   * Only honored when `useTriggers: true` and `contentTable` is set.
   */
  triggerWhere?: { insert?: string; update?: string; delete?: string };
}

export interface SqliteFTS5EngineOptions {
  /** Reuse the default ORM connection. Mutually exclusive with `connection` / `memory`. */
  shared?: boolean;
  /** Explicit Connection instance (e.g. a separate SQLite file). */
  connection?: Connection;
  /** Open an in-memory SQLite (`sqlite://:memory:`) — useful for tests. */
  memory?: boolean;
  /**
   * When true, `createIndex()` also emits AFTER INSERT/UPDATE/DELETE triggers
   * keeping the FTS5 table in sync with the source table. Requires
   * `contentTable` in the index config.
   */
  useTriggers?: boolean;
  /** Per-index FTS5 schema. Set before `createIndex(name)` runs. */
  indexes?: Record<string, SqliteFTS5IndexConfig>;
  /** Run `PRAGMA journal_mode=WAL` on first connection use. */
  walMode?: boolean;
  /** Override journal mode (`WAL`, `MEMORY`, `DELETE`, etc.). Wins over `walMode`. */
  journalMode?: string;
}

interface CompiledFilter {
  sql: string;
  bindings: any[];
}

export class SqliteFTS5Engine implements SearchEngine {
  private readonly indexConfigs = new Map<string, SqliteFTS5IndexConfig>();
  private readonly useTriggers: boolean;
  private readonly explicitConnection?: Connection;
  private readonly shared: boolean;
  private readonly journalModeTarget?: string;
  private journalApplied = false;

  constructor(options: SqliteFTS5EngineOptions = {}) {
    const exclusiveCount = [options.connection, options.shared, options.memory].filter(Boolean).length;
    if (exclusiveCount > 1) {
      throw new Error("SqliteFTS5Engine: pass at most one of `connection`, `shared`, `memory`.");
    }
    if (options.memory) {
      this.explicitConnection = new Connection({ url: "sqlite://:memory:" });
    } else {
      this.explicitConnection = options.connection;
    }
    this.shared = options.shared === true;
    this.useTriggers = options.useTriggers === true;
    const journalMode = options.journalMode ?? (options.walMode ? "WAL" : undefined);
    if (journalMode) {
      const normalized = journalMode.toUpperCase();
      if (!["DELETE", "TRUNCATE", "PERSIST", "MEMORY", "WAL", "OFF"].includes(normalized)) {
        throw new Error(`Invalid SQLite journal mode: ${journalMode}`);
      }
      this.journalModeTarget = normalized;
    }
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

  /** Register or replace the FTS5 schema for an index. */
  configureIndex(name: string, config: SqliteFTS5IndexConfig): void {
    this.indexConfigs.set(name, config);
  }

  private connection(): Connection {
    if (this.explicitConnection) return this.explicitConnection;
    if (this.shared) {
      const def = ConnectionManager.getDefault();
      if (!def) throw new Error("SqliteFTS5Engine: shared mode requires a default ORM connection (call configureOrm first).");
      return def;
    }
    throw new Error("SqliteFTS5Engine: no connection. Pass `{ connection }` or `{ shared: true }`.");
  }

  private assertSqlite(): void {
    const driver = this.connection().getDriverName();
    if (driver !== "sqlite") {
      throw new Error(`SqliteFTS5Engine requires a SQLite connection (got "${driver}").`);
    }
    void this.applyJournalMode();
  }

  private async applyJournalMode(): Promise<void> {
    if (this.journalApplied || !this.journalModeTarget) return;
    this.journalApplied = true;
    try {
      await this.connection().run(`PRAGMA journal_mode=${this.journalModeTarget}`);
    } catch {
      // ignore; user can apply manually
    }
  }

  private requireConfig(name: string): SqliteFTS5IndexConfig {
    const cfg = this.indexConfigs.get(name);
    if (!cfg) throw new Error(`SqliteFTS5Engine: no schema configured for index "${name}". Call configureIndex() or pass options.indexes.`);
    return cfg;
  }

  private allColumns(cfg: SqliteFTS5IndexConfig): string[] {
    return [...cfg.columns, ...(cfg.unindexed ?? [])];
  }

  private quoteIdent(name: string): string {
    return `"${name.replace(/"/g, '""')}"`;
  }

  async update(records: SearchableRecord[]): Promise<void> {
    if (records.length === 0) return;
    this.assertSqlite();
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
      const colList = ["rowid", ...cols].map((c) => this.quoteIdent(c)).join(", ");
      const placeholders = `(${["?", ...cols.map(() => "?")].join(", ")})`;
      for (const r of group) {
        const row = [r.id, ...cols.map((c) => (r.data as any)[c] ?? null)];
        // INSERT OR REPLACE on rowid upserts the document.
        await conn.run(
          `INSERT OR REPLACE INTO ${this.quoteIdent(index)} (${colList}) VALUES ${placeholders}`,
          row,
        );
      }
    }
  }

  async delete(records: SearchableRecord[]): Promise<void> {
    if (records.length === 0) return;
    this.assertSqlite();
    const conn = this.connection();
    const byIndex = new Map<string, Array<string | number>>();
    for (const r of records) {
      const bucket = byIndex.get(r.index) ?? [];
      bucket.push(r.id);
      byIndex.set(r.index, bucket);
    }
    for (const [index, ids] of byIndex) {
      const placeholders = ids.map(() => "?").join(", ");
      await conn.run(
        `DELETE FROM ${this.quoteIdent(index)} WHERE rowid IN (${placeholders})`,
        ids,
      );
    }
  }

  async search(query: SearchQuery): Promise<SearchHit[]> {
    this.assertSqlite();
    const { sql, bindings } = this.buildSelect(query, query.limit, query.offset);
    const rows = (await this.connection().query(sql, bindings)) as any[];
    return this.toHits(rows, query);
  }

  async paginate(query: SearchQuery, perPage: number, page: number): Promise<SearchPage> {
    this.assertSqlite();
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
    this.assertSqlite();
    await this.connection().run(`DELETE FROM ${this.quoteIdent(index)}`);
  }

  async createIndex(name: string, options: Record<string, unknown> = {}): Promise<void> {
    this.assertSqlite();
    const cfg = this.requireConfig(name);
    const conn = this.connection();

    const colDefs = [
      ...cfg.columns.map((c) => this.quoteIdent(c)),
      ...(cfg.unindexed ?? []).map((c) => `${this.quoteIdent(c)} UNINDEXED`),
    ];
    const tokenizer = cfg.tokenizer ? `tokenize = ${this.quoteLiteral(cfg.tokenizer)}` : null;
    const contentClause: string[] = [];
    if (cfg.contentTable) contentClause.push(`content = ${this.quoteIdent(cfg.contentTable)}`);
    if (cfg.contentRowid) contentClause.push(`content_rowid = ${this.quoteIdent(cfg.contentRowid)}`);
    const opts = [...colDefs];
    if (tokenizer) opts.push(tokenizer);
    opts.push(...contentClause);

    await conn.run(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${this.quoteIdent(name)} USING fts5(${opts.join(", ")})`,
    );

    if (this.useTriggers) {
      if (!cfg.contentTable) {
        throw new Error(`SqliteFTS5Engine: useTriggers=true requires contentTable in index "${name}" config.`);
      }
      await this.createTriggers(name, cfg);
    }
  }

  async deleteIndex(name: string): Promise<void> {
    this.assertSqlite();
    const conn = this.connection();
    if (this.useTriggers) await this.dropTriggers(name);
    await conn.run(`DROP TABLE IF EXISTS ${this.quoteIdent(name)}`);
  }

  async indexExists(name: string): Promise<boolean> {
    this.assertSqlite();
    // FTS5 virtual tables are stored in sqlite_master with type='table' and a
    // `CREATE VIRTUAL TABLE ... USING fts5(...)` declaration. Filter on the
    // SQL fragment so a regular source table sharing the name doesn't match.
    const rows = (await this.connection().query(
      `SELECT name FROM sqlite_master WHERE type='table' AND name = ? AND sql LIKE 'CREATE VIRTUAL TABLE%USING fts5%'`,
      [name],
    )) as any[];
    return rows.length > 0;
  }

  async health(): Promise<SearchHealth> {
    try {
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

  /** FTS5 'optimize' command — merges b-tree levels, reduces fragmentation. */
  async optimize(name: string): Promise<void> {
    this.assertSqlite();
    const t = this.quoteIdent(name);
    await this.connection().run(`INSERT INTO ${t}(${t}) VALUES ('optimize')`);
  }

  /**
   * FTS5 'rebuild' command — rebuilds the index from the content table.
   * Requires the index to be defined with a `contentTable` (external content
   * mode); throws a clear error otherwise.
   */
  async rebuild(name: string): Promise<void> {
    this.assertSqlite();
    const cfg = this.indexConfigs.get(name);
    if (!cfg) {
      throw new Error(
        `SqliteFTS5Engine.rebuild("${name}"): no schema registered. ` +
        `Call configureIndex() or declare \`fts\` on the model first.`,
      );
    }
    if (!cfg.contentTable) {
      throw new Error(
        `SqliteFTS5Engine.rebuild("${name}"): rebuild requires the index to be configured ` +
        `with a contentTable (external content mode). Add \`contentTable\` to the model's ` +
        `fts config, drop+createIndex, then rebuild. Use search:reimport for non-external-content indexes.`,
      );
    }
    const t = this.quoteIdent(name);
    await this.connection().run(`INSERT INTO ${t}(${t}) VALUES ('rebuild')`);
  }

  /** FTS5 'integrity-check' command — throws if the index is corrupt. */
  async integrityCheck(name: string): Promise<void> {
    this.assertSqlite();
    const t = this.quoteIdent(name);
    await this.connection().run(`INSERT INTO ${t}(${t}) VALUES ('integrity-check')`);
  }

  /** Returns true if a config has been registered for the index. */
  hasConfig(name: string): boolean {
    return this.indexConfigs.has(name);
  }

  /**
   * SQLite-level diagnostics: file size, WAL size, page count, freelist,
   * journal mode, integrity check summary. Surfaced via `search:status`.
   */
  async diagnostics(): Promise<Record<string, unknown>> {
    this.assertSqlite();
    const conn = this.connection();
    const result: Record<string, unknown> = { driver: "sqlite" };
    const pragmas: Array<[string, string]> = [
      ["page_count", "page_count"],
      ["page_size", "page_size"],
      ["freelist_count", "freelist_count"],
      ["journal_mode", "journal_mode"],
      ["wal_autocheckpoint", "wal_autocheckpoint"],
      ["synchronous", "synchronous"],
      ["cache_size", "cache_size"],
    ];
    for (const [label, name] of pragmas) {
      try {
        const rows = (await conn.query(`PRAGMA ${name}`)) as any[];
        const row = rows[0];
        if (!row) continue;
        const v = row[name] ?? Object.values(row)[0];
        result[label] = v;
      } catch {
        // swallow per-pragma errors
      }
    }
    const pageCount = Number(result.page_count ?? 0);
    const pageSize = Number(result.page_size ?? 0);
    const freelist = Number(result.freelist_count ?? 0);
    if (pageCount && pageSize) {
      result.size_bytes = pageCount * pageSize;
      result.fragmentation_pct = freelist / pageCount;
    }
    // Configured FTS indexes
    result.indexes = [...this.indexConfigs.keys()];
    // FTS index row counts (best-effort)
    const counts: Record<string, number> = {};
    for (const name of this.indexConfigs.keys()) {
      try {
        const rows = (await conn.query(`SELECT COUNT(*) AS c FROM ${this.quoteIdent(name)}`)) as any[];
        counts[name] = Number(rows[0]?.c ?? 0);
      } catch {
        counts[name] = -1;
      }
    }
    result.index_rows = counts;
    return result;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async createTriggers(name: string, cfg: SqliteFTS5IndexConfig): Promise<void> {
    if (!cfg.contentTable) return;
    const conn = this.connection();
    const cols = this.allColumns(cfg);
    const colList = cols.map((c) => this.quoteIdent(c)).join(", ");
    const newList = cols.map((c) => `new.${this.quoteIdent(c)}`).join(", ");
    const oldList = cols.map((c) => `old.${this.quoteIdent(c)}`).join(", ");
    const rowid = cfg.contentRowid ?? "id";
    const src = this.quoteIdent(cfg.contentTable);
    const fts = this.quoteIdent(name);
    const ai = this.quoteIdent(`${name}_ai`);
    const ad = this.quoteIdent(`${name}_ad`);
    const au = this.quoteIdent(`${name}_au`);

    const where = cfg.triggerWhere ?? {};
    const whenIns = where.insert ? ` WHEN ${where.insert}` : "";
    const whenUpd = where.update ? ` WHEN ${where.update}` : "";
    const whenDel = where.delete ? ` WHEN ${where.delete}` : "";

    await conn.run(`CREATE TRIGGER IF NOT EXISTS ${ai} AFTER INSERT ON ${src}${whenIns} BEGIN
      INSERT INTO ${fts}(rowid, ${colList}) VALUES (new.${this.quoteIdent(rowid)}, ${newList});
    END`);
    await conn.run(`CREATE TRIGGER IF NOT EXISTS ${ad} AFTER DELETE ON ${src}${whenDel} BEGIN
      INSERT INTO ${fts}(${fts}, rowid, ${colList}) VALUES ('delete', old.${this.quoteIdent(rowid)}, ${oldList});
    END`);
    await conn.run(`CREATE TRIGGER IF NOT EXISTS ${au} AFTER UPDATE ON ${src}${whenUpd} BEGIN
      INSERT INTO ${fts}(${fts}, rowid, ${colList}) VALUES ('delete', old.${this.quoteIdent(rowid)}, ${oldList});
      INSERT INTO ${fts}(rowid, ${colList}) VALUES (new.${this.quoteIdent(rowid)}, ${newList});
    END`);
  }

  private async dropTriggers(name: string): Promise<void> {
    const conn = this.connection();
    for (const suffix of ["ai", "ad", "au"]) {
      await conn.run(`DROP TRIGGER IF EXISTS ${this.quoteIdent(`${name}_${suffix}`)}`);
    }
  }

  private bm25Expr(query: SearchQuery): string {
    const t = this.quoteIdent(query.index);
    if (query.bm25Weights && query.bm25Weights.length > 0) {
      // Number("abc") is NaN and interpolates straight into the SQL text.
      const args = query.bm25Weights.map((w) => finiteSearchNumber(Number(w), "bm25 weight")).join(", ");
      return `bm25(${t}, ${args})`;
    }
    return `bm25(${t})`;
  }

  private buildSelect(query: SearchQuery, limit?: number, offset?: number): { sql: string; bindings: any[] } {
    const cfg = this.requireConfig(query.index);
    const cols = this.allColumns(cfg);
    const ftsCols = cfg.columns;
    const t = this.quoteIdent(query.index);

    // SELECT clause + its bindings (must come before WHERE in placeholder order).
    const selectFrags: string[] = ["rowid", ...cols.map((c) => this.quoteIdent(c))];
    const selectBindings: any[] = [];

    if (query.showRankingScore || (query.minScore !== undefined && query.minScore > 0)) {
      selectFrags.push(`-${this.bm25Expr(query)} AS _score`);
    }

    if (query.highlight && query.highlight.fields.length > 0) {
      const pre = query.highlight.preTag ?? "<mark>";
      const post = query.highlight.postTag ?? "</mark>";
      for (const field of query.highlight.fields) {
        const idx = ftsCols.indexOf(field);
        if (idx === -1) continue;
        selectFrags.push(`highlight(${t}, ${idx}, ?, ?) AS ${this.quoteIdent(`_hl_${field}`)}`);
        selectBindings.push(pre, post);
      }
    }

    if (query.crop && query.crop.length > 0) {
      const pre = query.highlight?.preTag ?? "<mark>";
      const post = query.highlight?.postTag ?? "</mark>";
      for (const c of query.crop) {
        const idx = ftsCols.indexOf(c.field);
        if (idx === -1) continue;
        const tokens = c.length ?? 16;
        selectFrags.push(`snippet(${t}, ${idx}, ?, ?, '…', ?) AS ${this.quoteIdent(`_snip_${c.field}`)}`);
        selectBindings.push(pre, post, tokens);
      }
    }

    // WHERE clause + bindings.
    const whereBindings: any[] = [];
    const where: string[] = [];
    if (query.query && query.query.trim().length > 0) {
      where.push(`${t} MATCH ?`);
      whereBindings.push(this.compileMatch(query));
    }
    const filterSql = this.compileFilters(query.filters, whereBindings);
    if (filterSql) where.push(filterSql);

    const havingClause = query.minScore !== undefined && query.minScore > 0
      ? ` HAVING _score >= ?`
      : "";
    const havingBindings: any[] = [];
    if (havingClause) havingBindings.push(query.minScore);
    const groupClause = havingClause ? ` GROUP BY rowid` : "";

    const sortClause = this.compileSort(query);
    const limitClause = limit !== undefined
      ? ` LIMIT ${nonNegativeSearchInteger(limit, "Search limit")}`
      : "";
    const offsetClause = offset !== undefined && offset > 0
      ? ` OFFSET ${nonNegativeSearchInteger(offset, "Search offset")}`
      : "";

    const sql = `SELECT ${selectFrags.join(", ")} FROM ${t}` +
      (where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "") +
      groupClause + havingClause + sortClause + limitClause + offsetClause;

    return { sql, bindings: [...selectBindings, ...whereBindings, ...havingBindings] };
  }

  private async countMatches(query: SearchQuery): Promise<number> {
    const cfg = this.requireConfig(query.index);
    const bindings: any[] = [];
    const where: string[] = [];

    if (query.query && query.query.trim().length > 0) {
      where.push(`${this.quoteIdent(query.index)} MATCH ?`);
      bindings.push(this.compileMatch(query));
    }
    const filterSql = this.compileFilters(query.filters, bindings);
    if (filterSql) where.push(filterSql);

    const sql = `SELECT COUNT(*) AS c FROM ${this.quoteIdent(query.index)}` +
      (where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "");
    const rows = (await this.connection().query(sql, bindings)) as any[];
    const v = rows[0]?.c ?? rows[0]?.["COUNT(*)"] ?? 0;
    return Number(v);
  }

  private async computeFacets(query: SearchQuery): Promise<FacetDistribution> {
    const out: FacetDistribution = {};
    const baseWhere = (): { where: string[]; bindings: any[] } => {
      const bindings: any[] = [];
      const where: string[] = [];
      if (query.query && query.query.trim().length > 0) {
        where.push(`${this.quoteIdent(query.index)} MATCH ?`);
        bindings.push(this.compileMatch(query));
      }
      const filterSql = this.compileFilters(query.filters, bindings);
      if (filterSql) where.push(filterSql);
      return { where, bindings };
    };

    for (const field of query.facets ?? []) {
      const { where, bindings } = baseWhere();
      const sql = `SELECT ${this.quoteIdent(field)} AS value, COUNT(*) AS c FROM ${this.quoteIdent(query.index)}` +
        (where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "") +
        ` GROUP BY ${this.quoteIdent(field)}`;
      const rows = (await this.connection().query(sql, bindings)) as any[];
      const bucket: Record<string, number> = {};
      for (const r of rows) {
        if (r.value == null) continue;
        bucket[String(r.value)] = Number(r.c);
      }
      out[field] = bucket;
    }

    for (const range of query.facetRanges ?? []) {
      const buckets = range.buckets;
      if (buckets.length === 0) continue;
      const caseFrags: string[] = [];
      const labels: string[] = [];
      for (let i = 0; i < buckets.length; i++) {
        const lo = finiteSearchNumber(buckets[i], "Facet bucket");
        const hi = buckets[i + 1] === undefined
          ? undefined
          : finiteSearchNumber(buckets[i + 1], "Facet bucket");
        const label = range.labels?.[i] ?? (hi !== undefined ? `${lo}-${hi}` : `${lo}+`);
        labels.push(label);
        if (hi !== undefined) {
          caseFrags.push(`WHEN ${this.quoteIdent(range.field)} >= ${lo} AND ${this.quoteIdent(range.field)} < ${hi} THEN ${this.quoteLiteral(label)}`);
        } else {
          caseFrags.push(`WHEN ${this.quoteIdent(range.field)} >= ${lo} THEN ${this.quoteLiteral(label)}`);
        }
      }
      const { where, bindings } = baseWhere();
      const caseExpr = `CASE ${caseFrags.join(" ")} ELSE NULL END`;
      const sql = `SELECT ${caseExpr} AS bucket, COUNT(*) AS c FROM ${this.quoteIdent(query.index)}` +
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

  private quoteLiteral(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
  }

  private compileMatch(query: SearchQuery): string {
    const term = query.query.trim();
    // Raw mode: pass through verbatim — caller owns escaping. Supports FTS5
    // prefix (`rust*`), boolean (`a OR b`, `+must`, `-not`), `NEAR(a b, 5)`.
    if (query.rawQuery) {
      if (query.attributesToSearchOn && query.attributesToSearchOn.length > 0) {
        return `{${query.attributesToSearchOn.join(" ")}} : (${term})`;
      }
      return term;
    }
    if (query.attributesToSearchOn && query.attributesToSearchOn.length > 0) {
      return `{${query.attributesToSearchOn.join(" ")}} : ${this.escapeFTS(term)}`;
    }
    return this.escapeFTS(term);
  }

  private escapeFTS(term: string): string {
    // Wrap in double quotes; double any internal quotes.
    return `"${term.replace(/"/g, '""')}"`;
  }

  private compileFilters(filters: SearchFilter[], bindings: any[]): string {
    if (filters.length === 0) return "";
    return this.joinFilters(filters, bindings);
  }

  private joinFilters(filters: SearchFilter[], bindings: any[]): string {
    let out = "";
    filters.forEach((f, i) => {
      const expr = this.compileFilter(f, bindings);
      if (i === 0) out = expr;
      else out += ` ${f.bool === "or" ? "OR" : "AND"} ${expr}`;
    });
    return out;
  }

  private compileFilter(f: SearchFilter, bindings: any[]): string {
    switch (f.kind) {
      case "cmp": {
        const operator = validSearchOperator(f.op);
        bindings.push(f.value);
        return `${this.quoteIdent(f.field)} ${operator} ?`;
      }
      case "in": {
        const ph = f.values.map(() => "?").join(", ");
        bindings.push(...f.values);
        const expr = `${this.quoteIdent(f.field)} IN (${ph})`;
        return f.negate ? `NOT (${expr})` : expr;
      }
      case "between": {
        bindings.push(f.from, f.to);
        const expr = `${this.quoteIdent(f.field)} BETWEEN ? AND ?`;
        return f.negate ? `NOT (${expr})` : expr;
      }
      case "null": {
        return f.negate
          ? `${this.quoteIdent(f.field)} IS NOT NULL`
          : `${this.quoteIdent(f.field)} IS NULL`;
      }
      case "exists": {
        // SQLite doesn't have a native "exists" — treat as NOT NULL.
        return f.negate
          ? `${this.quoteIdent(f.field)} IS NULL`
          : `${this.quoteIdent(f.field)} IS NOT NULL`;
      }
      case "group": {
        const inner = this.joinFilters(f.filters, bindings);
        const wrapped = `(${inner})`;
        return f.negate ? `NOT ${wrapped}` : wrapped;
      }
      case "raw": {
        if (f.bindings && f.bindings.length > 0) {
          bindings.push(...f.bindings);
        }
        return f.expr;
      }
    }
  }

  private compileSort(query: SearchQuery): string {
    if (query.sorts.length === 0) {
      // Default sort depends on whether a MATCH clause exists. FTS5 `bm25()`
      // requires a MATCH context — calling it on an empty query raises
      // SQLITE_CORRUPT_VTAB. Fall back to rowid for unconstrained scans.
      if (query.query && query.query.trim().length > 0) {
        return ` ORDER BY ${this.bm25Expr(query)}`;
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
    const cols = this.allColumns(cfg);
    const matchFields = query.attributesToSearchOn && query.attributesToSearchOn.length > 0
      ? query.attributesToSearchOn.filter((field) => cfg.columns.includes(field))
      : cfg.columns;
    return rows.map((row) => {
      const data: Record<string, unknown> = {};
      for (const c of cols) data[c] = row[c];
      const hit: SearchHit = { id: row.rowid, data };
      if (query.showRankingScore && row._score !== undefined) {
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
      const matchesPosition = computeMatchesPosition(query, data, matchFields);
      if (matchesPosition) hit.matchesPosition = matchesPosition;
      return hit;
    });
  }
}
