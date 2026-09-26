export interface SearchableRecord {
  index: string;
  id: string | number;
  data: Record<string, unknown>;
}

export interface MatchPosition {
  start: number;
  length: number;
}

export interface SearchHit {
  id: string | number;
  data: Record<string, unknown>;
  score?: number;
  formatted?: Record<string, unknown>;
  matchesPosition?: Record<string, MatchPosition[]>;
}

export type FacetDistribution = Record<string, Record<string, number>>;

export interface SearchPage {
  hits: SearchHit[];
  total: number;
  page: number;
  perPage: number;
  facetDistribution?: FacetDistribution;
}

export interface SearchSimplePage {
  hits: SearchHit[];
  page: number;
  perPage: number;
  hasMore: boolean;
}

export type CmpOp = "=" | "!=" | ">" | ">=" | "<" | "<=";

export type SearchFilter =
  | { kind: "cmp"; bool: "and" | "or"; field: string; op: CmpOp; value: unknown; negate?: boolean }
  | { kind: "in"; bool: "and" | "or"; field: string; values: unknown[]; negate?: boolean }
  | { kind: "between"; bool: "and" | "or"; field: string; from: unknown; to: unknown; negate?: boolean }
  | { kind: "null"; bool: "and" | "or"; field: string; negate?: boolean }
  | { kind: "exists"; bool: "and" | "or"; field: string; negate?: boolean }
  | { kind: "group"; bool: "and" | "or"; filters: SearchFilter[]; negate?: boolean }
  | { kind: "raw"; bool: "and" | "or"; expr: string; bindings?: readonly unknown[] };

export interface SearchSort {
  field: string;
  direction: "asc" | "desc";
}

export interface SearchHighlight {
  fields: string[];
  preTag?: string;
  postTag?: string;
}

export interface SearchCrop {
  field: string;
  length?: number;
}

export interface FacetRange {
  field: string;
  buckets: number[];
  labels?: string[];
}

export interface SearchQuery {
  index: string;
  query: string;
  filters: SearchFilter[];
  sorts: SearchSort[];
  limit?: number;
  offset?: number;
  facets?: string[];
  facetRanges?: FacetRange[];
  minScore?: number;
  attributesToSearchOn?: string[];
  attributesToRetrieve?: string[];
  highlight?: SearchHighlight;
  crop?: SearchCrop[];
  showRankingScore?: boolean;
  /** When true, `query` is passed verbatim to the engine — no escaping. */
  rawQuery?: boolean;
  /** Per-column bm25 weights, applied in the order columns appear in the index. */
  bm25Weights?: number[];
}

export interface SearchMultiResult {
  index: string;
  hits: SearchHit[];
  total?: number;
  facetDistribution?: FacetDistribution;
}

export interface SearchHealth {
  status: string;
  details?: unknown;
}

export type SearchMatchesPositionSupport = "native" | "approximate" | false;

export interface SearchCapabilities {
  /** Engine can execute multi-search in one native engine call. False means Search.multi() falls back to sequential queries. */
  nativeMultiSearch: boolean;
  /** Engine supports applying index settings via updateIndexSettings(). */
  indexSettings: boolean;
  /** Match position source/quality. */
  matchesPosition: SearchMatchesPositionSupport;
  highlight: boolean;
  crop: boolean;
  facets: boolean;
  minScore: boolean;
  searchOn: boolean;
  rawQuery: boolean;
}

export type SearchCapability = keyof SearchCapabilities;

export interface SearchEngine {
  update(records: SearchableRecord[]): Promise<void>;
  delete(records: SearchableRecord[]): Promise<void>;
  search(query: SearchQuery): Promise<SearchHit[]>;
  paginate(query: SearchQuery, perPage: number, page: number): Promise<SearchPage>;
  flush(index: string): Promise<void>;
  createIndex(name: string, options?: Record<string, unknown>): Promise<void>;
  deleteIndex(name: string): Promise<void>;
  updateIndexSettings?(name: string, settings: Record<string, unknown>): Promise<void>;
  capabilities?(): SearchCapabilities;
  health?(): Promise<SearchHealth>;
  multiSearch?(queries: SearchQuery[]): Promise<SearchMultiResult[]>;
  /** Returns true if the named index already exists in the engine. */
  indexExists?(name: string): Promise<boolean>;
  /** Atomically swap two indexes. Used by `search:reindex`. */
  swapIndexes?(a: string, b: string): Promise<void>;
}
