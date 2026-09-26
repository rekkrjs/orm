export { Search, getSearchEngine, getSearchConfig } from "./SearchManager.js";
export type { SearchConfig, SearchBatchConfig, SearchEngineName } from "./SearchManager.js";
export { Searchable, makeSearchableRecord, applySearchableStatics } from "./Searchable.js";
export type {
  SearchableModelConstructor,
  SearchableModelStatics,
  SearchableInstance,
  SearchableOptions,
} from "./Searchable.js";
export { SearchBuilder } from "./SearchBuilder.js";
export type {
  SearchPaginatorResult,
  SearchSimplePaginatorResult,
  SearchFetchResult,
} from "./SearchBuilder.js";
export { SqliteFTS5Engine, defineFtsConfig } from "./engines/SqliteFTS5Engine.js";
export type {
  SqliteFTS5EngineOptions,
  SqliteFTS5IndexConfig,
} from "./engines/SqliteFTS5Engine.js";
export { PostgresFTSEngine } from "./engines/PostgresFTSEngine.js";
export type {
  PostgresFTSEngineOptions,
  PostgresFTSIndexConfig,
} from "./engines/PostgresFTSEngine.js";
export { MakeSearchableJob } from "./jobs/MakeSearchableJob.js";
export { RemoveFromSearchJob } from "./jobs/RemoveFromSearchJob.js";
export type {
  SearchEngine,
  SearchableRecord,
  SearchHit,
  SearchPage,
  SearchSimplePage,
  SearchQuery,
  SearchFilter,
  SearchSort,
  SearchHealth,
  SearchHighlight,
  SearchCrop,
  SearchMultiResult,
  SearchCapabilities,
  SearchCapability,
  SearchMatchesPositionSupport,
  FacetDistribution,
  FacetRange,
  MatchPosition,
  CmpOp,
} from "./SearchEngine.js";
