import type { Model, ModelConstructor, ModelColumn } from "../model/Model.js";
import { Collection } from "../support/Collection.js";
import { getSearchEngine } from "./SearchManager.js";
import type {
  CmpOp,
  FacetDistribution,
  FacetRange,
  SearchCrop,
  SearchFilter,
  SearchHighlight,
  SearchHit,
  SearchPage,
  SearchQuery,
  SearchSort,
} from "./SearchEngine.js";
import type { SearchableModelConstructor } from "./Searchable.js";
import {
  finiteSearchNumber,
  nonNegativeSearchInteger,
  positiveSearchInteger,
  validSearchDirection,
  validSearchOperator,
} from "./sqlSafety.js";

type Field<M> = ModelColumn<M>;
type ValueOf<M, K> = K extends keyof M ? M[K] : any;

export interface SearchPaginatorResult<T> {
  data: Collection<T>;
  total: number;
  page: number;
  perPage: number;
  facetDistribution?: FacetDistribution;
}

export interface SearchSimplePaginatorResult<T> {
  data: Collection<T>;
  page: number;
  perPage: number;
  hasMore: boolean;
}

export interface SearchFetchResult<T> {
  data: Collection<T>;
  total: number;
  facetDistribution?: FacetDistribution;
}

type CallbackArg<M> = (builder: SearchBuilder<M>) => void;

export class SearchBuilder<M = Model> {
  private filters: SearchFilter[] = [];
  private sorts: SearchSort[] = [];
  private limitValue?: number;
  private withRels: any[] = [];
  private facetFields: string[] = [];
  private facetRangeList: FacetRange[] = [];
  private minScoreValue?: number;
  private searchOnFields?: string[];
  private retrieveFields?: string[];
  private highlightConfig?: SearchHighlight;
  private cropConfig: SearchCrop[] = [];
  private showScore = false;
  private rawQueryFlag = false;
  private bm25WeightsList?: number[];

  constructor(
    private readonly modelClass: SearchableModelConstructor & ModelConstructor,
    private readonly query: string,
  ) {}

  /** @internal Exposed for Search.multi() — do not call directly. */
  _toQuery(): SearchQuery {
    return this.buildQuery();
  }

  // ── Filters: top-level joined by AND unless built via or*  ─────────────────

  where<K extends Field<M>>(field: K, value: ValueOf<M, K>): this;
  where<K extends Field<M>>(field: K, op: CmpOp, value: ValueOf<M, K>): this;
  where(callback: CallbackArg<M>): this;
  where(fieldOrCb: Field<M> | CallbackArg<M>, opOrValue?: unknown, value?: unknown): this {
    return this.addCmpOrGroup("and", fieldOrCb as any, opOrValue, value);
  }

  orWhere<K extends Field<M>>(field: K, value: ValueOf<M, K>): this;
  orWhere<K extends Field<M>>(field: K, op: CmpOp, value: ValueOf<M, K>): this;
  orWhere(callback: CallbackArg<M>): this;
  orWhere(fieldOrCb: Field<M> | CallbackArg<M>, opOrValue?: unknown, value?: unknown): this {
    return this.addCmpOrGroup("or", fieldOrCb as any, opOrValue, value);
  }

  whereNot<K extends Field<M>>(field: K, value: ValueOf<M, K>): this {
    return this.where(field, "!=", value);
  }

  orWhereNot<K extends Field<M>>(field: K, value: ValueOf<M, K>): this {
    return this.orWhere(field, "!=", value);
  }

  whereIn<K extends Field<M>>(field: K, values: readonly ValueOf<M, K>[]): this {
    this.filters.push({ kind: "in", bool: "and", field: field as string, values: [...values] });
    return this;
  }

  orWhereIn<K extends Field<M>>(field: K, values: readonly ValueOf<M, K>[]): this {
    this.filters.push({ kind: "in", bool: "or", field: field as string, values: [...values] });
    return this;
  }

  whereNotIn<K extends Field<M>>(field: K, values: readonly ValueOf<M, K>[]): this {
    this.filters.push({ kind: "in", bool: "and", field: field as string, values: [...values], negate: true });
    return this;
  }

  orWhereNotIn<K extends Field<M>>(field: K, values: readonly ValueOf<M, K>[]): this {
    this.filters.push({ kind: "in", bool: "or", field: field as string, values: [...values], negate: true });
    return this;
  }

  whereBetween<K extends Field<M>>(field: K, range: [ValueOf<M, K>, ValueOf<M, K>]): this {
    this.filters.push({ kind: "between", bool: "and", field: field as string, from: range[0], to: range[1] });
    return this;
  }

  orWhereBetween<K extends Field<M>>(field: K, range: [ValueOf<M, K>, ValueOf<M, K>]): this {
    this.filters.push({ kind: "between", bool: "or", field: field as string, from: range[0], to: range[1] });
    return this;
  }

  whereNotBetween<K extends Field<M>>(field: K, range: [ValueOf<M, K>, ValueOf<M, K>]): this {
    this.filters.push({ kind: "between", bool: "and", field: field as string, from: range[0], to: range[1], negate: true });
    return this;
  }

  orWhereNotBetween<K extends Field<M>>(field: K, range: [ValueOf<M, K>, ValueOf<M, K>]): this {
    this.filters.push({ kind: "between", bool: "or", field: field as string, from: range[0], to: range[1], negate: true });
    return this;
  }

  whereNull<K extends Field<M>>(field: K): this {
    this.filters.push({ kind: "null", bool: "and", field: field as string });
    return this;
  }

  whereNotNull<K extends Field<M>>(field: K): this {
    this.filters.push({ kind: "null", bool: "and", field: field as string, negate: true });
    return this;
  }

  whereExists<K extends Field<M>>(field: K): this {
    this.filters.push({ kind: "exists", bool: "and", field: field as string });
    return this;
  }

  whereDoesntExist<K extends Field<M>>(field: K): this {
    this.filters.push({ kind: "exists", bool: "and", field: field as string, negate: true });
    return this;
  }

  whereRaw(expression: string, bindings?: readonly unknown[]): this {
    this.filters.push({ kind: "raw", bool: "and", expr: expression, bindings });
    return this;
  }

  orWhereRaw(expression: string, bindings?: readonly unknown[]): this {
    this.filters.push({ kind: "raw", bool: "or", expr: expression, bindings });
    return this;
  }

  // ── Sort / limit / eager ────────────────────────────────────────────────────

  orderBy<K extends Field<M>>(field: K, direction: "asc" | "desc" = "asc"): this {
    this.sorts.push({ field: field as string, direction: validSearchDirection(direction) });
    return this;
  }

  /** Alias of `orderBy()` — improves readability for tie-breaker sort fields. */
  thenBy<K extends Field<M>>(field: K, direction: "asc" | "desc" = "asc"): this {
    return this.orderBy(field, direction);
  }

  take(n: number): this {
    this.limitValue = nonNegativeSearchInteger(n, "Search limit");
    return this;
  }

  with(...relations: any[]): this {
    this.withRels.push(...relations);
    return this;
  }

  facet<K extends Field<M>>(field: K): this {
    this.facetFields.push(field as string);
    return this;
  }

  facets<K extends Field<M>>(...fields: K[]): this {
    for (const f of fields) this.facetFields.push(f as string);
    return this;
  }

  /**
   * Bucket-range facet over a numeric field. `buckets` are the lower bounds
   * for each bucket; results are labelled `lo-hi` (or via `labels`).
   *
   * Example:
   * ```ts
   * .facetRange("price", [0, 100, 500])
   * // → { price: { "0-100": 12, "100-500": 30, "500+": 4 } }
   * ```
   */
  facetRange<K extends Field<M>>(field: K, buckets: number[], labels?: string[]): this {
    this.facetRangeList.push({
      field: field as string,
      buckets: buckets.map((bucket) => finiteSearchNumber(bucket, "Facet bucket")),
      labels,
    });
    return this;
  }

  /** Ranking score threshold (0..1). Drops hits below the floor. */
  minScore(value: number): this {
    this.minScoreValue = finiteSearchNumber(value, "Minimum score");
    return this;
  }

  /**
   * Restrict matching to a subset of indexed fields. Effectively per-query
   * field weighting — the field list determines what contributes to ranking.
   */
  searchOn<K extends Field<M>>(...fields: K[]): this {
    this.searchOnFields = fields.map((f) => f as string);
    return this;
  }

  /** Alias of `searchOn()` — frames the call as boosting specific fields. */
  boost<K extends Field<M>>(...fields: K[]): this {
    return this.searchOn(...fields);
  }

  /**
   * Restrict fields returned by raw engine hits. Hydrated `.get()` still uses
   * hit IDs to load full ORM models from the database.
   */
  retrieve<K extends Field<M>>(...fields: K[]): this {
    this.retrieveFields = fields.map((f) => f as string);
    return this;
  }

  /** Alias of `retrieve()` for display-focused raw search result payloads. */
  display<K extends Field<M>>(...fields: K[]): this {
    return this.retrieve(...fields);
  }

  highlight<K extends Field<M>>(...fields: K[]): this {
    this.highlightConfig = {
      ...(this.highlightConfig ?? { fields: [] }),
      fields: [...(this.highlightConfig?.fields ?? []), ...fields.map((f) => f as string)],
    };
    return this;
  }

  highlightTags(preTag: string, postTag: string): this {
    this.highlightConfig = {
      fields: this.highlightConfig?.fields ?? [],
      preTag,
      postTag,
    };
    return this;
  }

  crop<K extends Field<M>>(field: K, length?: number): this {
    this.cropConfig.push({
      field: field as string,
      length: length === undefined ? undefined : positiveSearchInteger(length, "Crop length"),
    });
    return this;
  }

  withScore(): this {
    this.showScore = true;
    return this;
  }

  /**
   * Pass the query string verbatim to the engine. Enables FTS5 prefix
   * (`rust*`), boolean (`a OR b`, `+must`, `-not`), and `NEAR()` operators
   * without escaping. Caller is responsible for syntax correctness.
   */
  matchRaw(expression: string): this {
    this.rawQueryFlag = true;
    return this.withQueryOverride(expression);
  }

  /** Per-column bm25 weights — order matches the FTS5 column order. */
  bm25Weights(weights: number[]): this {
    this.bm25WeightsList = weights.map((weight) => finiteSearchNumber(weight, "BM25 weight"));
    return this;
  }

  private withQueryOverride(expr: string): this {
    (this as any).query = expr;
    return this;
  }

  // ── Execution ──────────────────────────────────────────────────────────────

  async raw(): Promise<SearchHit[]> {
    return getSearchEngine().search(this.buildQuery());
  }

  async get(): Promise<Collection<M>> {
    return this.hydrate(await this.raw());
  }

  async paginate(perPage = 15, page = 1): Promise<SearchPaginatorResult<M>> {
    positiveSearchInteger(perPage, "Search page size");
    positiveSearchInteger(page, "Search page");
    const result: SearchPage = await getSearchEngine().paginate(this.buildQuery(), perPage, page);
    const data = await this.hydrate(result.hits);
    return {
      data,
      total: result.total,
      page: result.page,
      perPage: result.perPage,
      ...(result.facetDistribution ? { facetDistribution: result.facetDistribution } : {}),
    };
  }

  /**
   * Raw page result from the active search engine.
   * Returns engine hits and pagination metadata without ORM hydration.
   */
  async rawPaginate(perPage = 15, page = 1): Promise<SearchPage> {
    positiveSearchInteger(perPage, "Search page size");
    positiveSearchInteger(page, "Search page");
    return getSearchEngine().paginate(this.buildQuery(), perPage, page);
  }

  /** Page-shape result that always carries facet distribution when facets are set. */
  async fetch(limit?: number): Promise<SearchFetchResult<M>> {
    if (limit !== undefined) nonNegativeSearchInteger(limit, "Search limit");
    const result = await getSearchEngine().paginate(this.buildQuery(), limit ?? this.limitValue ?? 20, 1);
    const data = await this.hydrate(result.hits);
    return {
      data,
      total: result.total,
      ...(result.facetDistribution ? { facetDistribution: result.facetDistribution } : {}),
    };
  }

  /** Fetch only the facet distribution. Issues a 0-hits search under the hood. */
  async facetDistribution(): Promise<FacetDistribution> {
    const q = this.buildQuery();
    q.limit = 0;
    const result = await getSearchEngine().paginate(q, 0, 1);
    return result.facetDistribution ?? {};
  }

  async simplePaginate(perPage = 15, page = 1): Promise<SearchSimplePaginatorResult<M>> {
    positiveSearchInteger(perPage, "Search page size");
    positiveSearchInteger(page, "Search page");
    const q = this.buildQuery();
    q.limit = perPage + 1;
    q.offset = (page - 1) * perPage;
    const hits = await getSearchEngine().search(q);
    const hasMore = hits.length > perPage;
    const data = await this.hydrate(hits.slice(0, perPage));
    return { data, page, perPage, hasMore };
  }

  async *cursor(chunkSize = 100): AsyncGenerator<M> {
    positiveSearchInteger(chunkSize, "Search cursor chunk size");
    let offset = 0;
    while (true) {
      const q = this.buildQuery();
      q.limit = chunkSize;
      q.offset = offset;
      const hits = await getSearchEngine().search(q);
      if (hits.length === 0) return;
      const rows = await this.hydrate(hits);
      for (const row of rows) yield row;
      if (hits.length < chunkSize) return;
      offset += chunkSize;
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private addCmpOrGroup(
    bool: "and" | "or",
    fieldOrCb: string | CallbackArg<M>,
    opOrValue: unknown,
    value: unknown,
  ): this {
    if (typeof fieldOrCb === "function") {
      const nested = new SearchBuilder<M>(this.modelClass, this.query);
      fieldOrCb(nested);
      this.filters.push({ kind: "group", bool, filters: nested.filters });
      return this;
    }
    const hasOp = value !== undefined;
    const op = validSearchOperator(hasOp ? opOrValue : "=");
    const v = hasOp ? value : opOrValue;
    this.filters.push({ kind: "cmp", bool, field: fieldOrCb as string, op, value: v });
    return this;
  }

  private buildQuery(): SearchQuery {
    const q: SearchQuery = {
      index: this.modelClass.searchableAs(),
      query: this.query,
      filters: this.filters,
      sorts: this.sorts,
      limit: this.limitValue,
    };
    if (this.facetFields.length > 0) q.facets = this.facetFields;
    if (this.facetRangeList.length > 0) q.facetRanges = this.facetRangeList;
    if (this.minScoreValue !== undefined) q.minScore = this.minScoreValue;
    if (this.searchOnFields) q.attributesToSearchOn = this.searchOnFields;
    if (this.retrieveFields) q.attributesToRetrieve = this.retrieveFields;
    if (this.highlightConfig) q.highlight = this.highlightConfig;
    if (this.cropConfig.length > 0) q.crop = this.cropConfig;
    if (this.showScore) q.showRankingScore = true;
    if (this.rawQueryFlag) q.rawQuery = true;
    if (this.bm25WeightsList) q.bm25Weights = this.bm25WeightsList;
    return q;
  }

  private async hydrate(hits: SearchHit[]): Promise<Collection<M>> {
    if (hits.length === 0) return new Collection<M>();
    const ids = hits.map((h) => h.id);
    const pk = (this.modelClass as unknown as { primaryKey: string }).primaryKey;
    let q: any = (this.modelClass as any).whereIn(pk, ids);
    if (this.withRels.length > 0) q = q.with(...this.withRels);
    const rows = await q.get();
    const byId = new Map<string | number, M>();
    for (const row of rows as M[]) {
      const key = (row as any).getAttribute(pk);
      if (key != null) byId.set(key, row);
    }
    const ordered: M[] = [];
    for (const id of ids) {
      const row =
        byId.get(id) ??
        byId.get(String(id) as any) ??
        byId.get(Number(id) as any);
      if (row) ordered.push(row);
    }
    return new Collection<M>(ordered);
  }
}
