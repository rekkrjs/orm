import type { Model, ModelConstructor } from "../model/Model.js";
import { TenantContext } from "../connection/TenantContext.js";
import { Schema } from "../schema/Schema.js";
import { SearchBuilder } from "./SearchBuilder.js";
import { getSearchConfig, getSearchEngine } from "./SearchManager.js";
import type { SearchableRecord } from "./SearchEngine.js";

export interface SearchableOptions<M extends Model = Model> {
  index?: string;
  settings?: Record<string, unknown>;
  toSearchableArray?(model: M): Record<string, unknown>;
  shouldBeSearchable?(model: M): boolean;
  /**
   * Index schema for the built-in PostgreSQL and SQLite engines: which columns
   * are searched and which are stored for filtering. Optional: without it the
   * index covers the model's table, searching its text columns. Kept as an
   * opaque `Record<string, unknown>` so the core type doesn't import engine modules.
   */
  fts?: Record<string, unknown>;
}

export interface SearchableInstance {
  searchable(): Promise<void>;
  unsearchable(): Promise<void>;
}

export interface SearchableModelStatics<M = Model> {
  searchable: true;
  searchIndex?: string;
  searchIndexSettings?: Record<string, unknown>;
  searchFtsConfig?: Record<string, unknown>;
  toSearchableArray(model: M): Record<string, unknown>;
  shouldBeSearchable(model: M): boolean;
  searchableAs(): string;
  search(query: string): SearchBuilder<M>;
  makeAllSearchable(chunk?: number): Promise<void>;
  removeAllFromSearch(): Promise<void>;
}

export type SearchableModelConstructor<M = Model> =
  ModelConstructor & SearchableModelStatics<M>;

// Newest last, so a model redefined under the same index name wins.
const registered = new Set<SearchableModelConstructor>();
const tableConfigs = new WeakMap<SearchableModelConstructor, Record<string, unknown>>();

function modelFor(index: string): SearchableModelConstructor | undefined {
  return [...registered].reverse().find((model) => model.searchableAs() === index);
}

/** The index schema of the searchable model whose `searchableAs()` is `index` in the current tenant context. */
export function modelFtsConfig(index: string): Record<string, unknown> | undefined {
  const model = modelFor(index);
  return model && (model.searchFtsConfig ?? tableConfigs.get(model));
}

/**
 * For a model without `fts`, reads its table once and indexes every column but
 * the primary key and `hidden` ones: text columns are searched, the rest stored
 * for filters and sorting. Engines await this before reading `modelFtsConfig()`.
 */
export async function loadModelFtsConfig(index: string): Promise<void> {
  const model = modelFor(index) as (SearchableModelConstructor & { hidden?: readonly string[] }) | undefined;
  if (!model || model.searchFtsConfig || tableConfigs.has(model)) return;
  const connection = model.getConnection();
  const hidden = new Set(model.hidden ?? []);
  const fields = (await Schema.getColumns(model.getQualifiedTable(connection), connection))
    .filter((column) => !column.primary && !hidden.has(column.name));
  const isText = (type: string) => /char|text|clob/i.test(type);
  const columns = fields.filter((column) => isText(column.type)).map((column) => column.name);
  if (columns.length === 0) {
    throw new Error(`${model.name}: table "${model.getTable()}" has no text columns to search. Declare \`fts\` on the model.`);
  }
  tableConfigs.set(model, { columns, unindexed: fields.filter((column) => !isText(column.type)).map((column) => column.name) });
}

function defaultToSearchableArray(model: Model): Record<string, unknown> {
  return (model as any).toJSON ? (model as any).toJSON() : { ...(model as any).$attributes };
}

export function applySearchableStatics<M extends Model>(
  modelClass: ModelConstructor,
  options: SearchableOptions<M> = {},
): SearchableModelConstructor<M> {
  const ctor = modelClass as any;
  if (ctor.searchable === true && ctor.__searchableApplied) {
    return ctor as SearchableModelConstructor<M>;
  }

  ctor.searchable = true;
  ctor.__searchableApplied = true;
  registered.add(ctor);

  if (options.index !== undefined) ctor.searchIndex = options.index;
  if (options.settings !== undefined) ctor.searchIndexSettings = options.settings;
  if (options.fts !== undefined) ctor.searchFtsConfig = options.fts;

  if (typeof ctor.searchableAs !== "function") {
    ctor.searchableAs = function (): string {
      const base = this.searchIndex ?? this.getTable();
      const cfg = getSearchConfig();
      if (!cfg?.tenantScope) return base;
      const tenantId = TenantContext.current()?.tenantId ?? null;
      return cfg.tenantScope(base, tenantId);
    };
  }

  if (options.toSearchableArray) {
    ctor.toSearchableArray = options.toSearchableArray;
  } else if (typeof ctor.toSearchableArray !== "function") {
    ctor.toSearchableArray = defaultToSearchableArray;
  }

  if (options.shouldBeSearchable) {
    ctor.shouldBeSearchable = options.shouldBeSearchable;
  } else if (typeof ctor.shouldBeSearchable !== "function") {
    ctor.shouldBeSearchable = () => true;
  }

  if (typeof ctor.search !== "function") {
    ctor.search = function (query: string) {
      return new SearchBuilder(this, query);
    };
  }

  if (typeof ctor.prototype.searchable !== "function") {
    ctor.prototype.searchable = async function (): Promise<void> {
      const record = makeSearchableRecord(this);
      if (record) await getSearchEngine().update([record]);
    };
  }
  if (typeof ctor.prototype.unsearchable !== "function") {
    ctor.prototype.unsearchable = async function (): Promise<void> {
      const record = makeSearchableRecord(this);
      if (record) await getSearchEngine().delete([record]);
    };
  }

  if (typeof ctor.makeAllSearchable !== "function") {
    ctor.makeAllSearchable = async function (chunk = 500): Promise<void> {
      const engine = getSearchEngine();
      await this.query().chunk(chunk, async (items: any) => {
        const rows = typeof items.all === "function" ? items.all() : items;
        const records = rows.map((m: any) => makeSearchableRecord(m)).filter(Boolean);
        if (records.length > 0) await engine.update(records);
      });
    };
  }
  if (typeof ctor.removeAllFromSearch !== "function") {
    ctor.removeAllFromSearch = async function (): Promise<void> {
      await getSearchEngine().flush(this.searchableAs());
    };
  }

  return ctor as SearchableModelConstructor<M>;
}

export function makeSearchableRecord(model: Model): SearchableRecord | null {
  const ctor = Object.getPrototypeOf(model).constructor as SearchableModelConstructor;
  if (!ctor.searchable) return null;
  const data = ctor.toSearchableArray
    ? ctor.toSearchableArray(model)
    : defaultToSearchableArray(model);
  const pk = (ctor as unknown as { primaryKey: string }).primaryKey;
  const id = (model as any).getAttribute(pk);
  if (id == null) return null;
  return { index: ctor.searchableAs(), id, data };
}

/**
 * Optional mixin for explicit class-syntax setup.
 * Equivalent to calling `Search.register(Model)` — useful when you want
 * static type completion for `Model.search(...)` without a cast.
 */
export function Searchable<TBase extends ModelConstructor>(
  Base: TBase,
  options: SearchableOptions = {},
): TBase
  & SearchableModelStatics<InstanceType<TBase>>
  & { new (...args: any[]): InstanceType<TBase> & SearchableInstance } {
  return applySearchableStatics(Base, options) as any;
}
