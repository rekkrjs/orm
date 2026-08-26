import { Connection } from "../connection/Connection.js";
import { TransactionContext } from "../connection/TransactionContext.js";
import { Cache } from "../cache/index.js";
import { MorphTo } from "../model/MorphRelations.js";
import type { WhereClause, OrderClause, HavingClause } from "../types/index.js";
import type { AttachedToRelationName, BelongsToRelationName, EagerLoadDefinition, EagerLoadInput, Model, ModelAttributeInput, ModelMassAssignmentInput, ModelColumn, ModelColumnValue, ModelConstructor, ModelRelationName, MorphToRelationName, SaveOptions, TypedEagerLoad, TypedConstraintMap, TypedConstraintSelection, TypedExistsConstraintMap, ExtractStringPaths, WithLoadedRelations, WithLoadedRelationsFromConstraintMap, WithRelationCount, WithRelationExists, WithRelationExistsMap, Relation, RelationConstraintQuery, NestedRelationPath, LiteralUnion, RelationRelatedModel, MorphToConstraintCallback } from "../model/Model.js";
import { findRelationMethod, HasMany, Model as BaseModel } from "../model/Model.js";
import { ObserverRegistry } from "../model/Observer.js";
import { ModelNotFoundError } from "../model/ModelNotFoundError.js";
import { IdentityMap } from "../model/IdentityMap.js";
import { createFastJsonPlan, serializeJsonRow } from "../model/ModelJsonRow.js";
import {
  assertBackedEnumValue,
  assertDeclaredEnumCast,
  isBackedEnumDefinition,
} from "../model/BackedEnum.js";
import { Collection, type CollectionJson } from "../support/Collection.js";

/**
 * The field a driver returns a selected column under: "users.email" comes back
 * as "email", and "email as contact" as "contact".
 */
function resultFieldFor(column: string): string {
  const aliased = /\s+as\s+(.+)$/i.exec(column);
  const name = (aliased ? aliased[1]! : column).trim().replace(/^["`\[]|["`\]]$/g, "");
  return name.includes(".") ? name.split(".").pop()! : name;
}

/**
 * The key a row actually carries for a field. PostgreSQL folds unquoted
 * identifiers to lower case, so `select("name as Label")` comes back as
 * `label`; matching the casing we wrote would read undefined off every row.
 */
function resolveResultField(row: Record<string, any> | undefined, field: string): string {
  if (!row || Object.prototype.hasOwnProperty.call(row, field)) return field;
  const lowered = field.toLowerCase();
  for (const key of Object.keys(row)) {
    if (key.toLowerCase() === lowered) return key;
  }
  return field;
}

type RelationConstraint<TModel = any, TRelation extends string = string> = (query: RelationConstraintQuery<TModel, TRelation>) => void | Builder<any> | RelationConstraintQuery<TModel, TRelation>;
type ExistsConstraintMap<TResult> = Record<string, RelationConstraint<TResult, any> | undefined>;
type RelatedColumn<TResult, R extends string> = ModelColumn<RelationRelatedModel<TResult, R>>;
type RelationShortcutInput = Model | Model[] | Collection<Model>;
type RecursiveCteDefinition = {
  name: string;
  anchor: Builder<any> | string;
  recursive: Builder<any> | string;
};
export interface LikeOptions { caseSensitive?: boolean }
type RawFragment = { sql: string; bindings: readonly unknown[] };
type UnionDefinition = { query: Builder<any> | string; all: boolean };
export type NumericAggregate = number | string | bigint;

// Several of these are dialect-specific by design — `<=>` is MySQL, `GLOB` is
// SQLite, `REGEXP` is neither on PostgreSQL. The list is an injection-safety
// allowlist, not a portability guarantee: an operator passed here is emitted
// verbatim and it is the caller's business whether the target accepts it. Use
// whereLike()/whereRegexp() for the forms the grammars compile per dialect.
const QUERY_OPERATORS = new Set([
  "=", "!=", "<>", "<", "<=", ">", ">=", "<=>",
  "LIKE", "NOT LIKE", "ILIKE", "NOT ILIKE",
  "REGEXP", "NOT REGEXP", "GLOB", "IS", "IS NOT",
]);

function validOperator(operator: unknown): string {
  const value = String(operator).trim();
  if (!QUERY_OPERATORS.has(value.toUpperCase())) {
    throw new Error(`Invalid query operator: ${String(operator)}`);
  }
  return value;
}

function validBoolean(boolean: unknown): "and" | "or" {
  const value = String(boolean).toLowerCase();
  if (value !== "and" && value !== "or") {
    throw new Error(`Invalid query boolean: ${String(boolean)}`);
  }
  return value;
}

function validDirection(direction: unknown): "asc" | "desc" {
  const value = String(direction).toLowerCase();
  if (value !== "asc" && value !== "desc") {
    throw new Error(`Invalid order direction: ${String(direction)}`);
  }
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}
type RecursiveTreeConfig = {
  parentColumn: string;
  primaryKey: string;
  mode: "roots" | "single" | "multiple";
  direction: "descendants" | "ancestors";
  startKeys: any[];
  cteName: string;
  includeRoot: boolean;
  depthOrder: "asc" | "desc";
  maxDepth?: number;
  depthFilterApplied?: number;
  path?: {
    column: string;
    alias: string;
    delimiter: string;
  };
  hasChildrenAlias?: string;
  leafAlias?: string;
};

type CachedRelationValue =
  | { type: "collection"; models: CachedModelGraph[] }
  | { type: "model"; model: CachedModelGraph | null }
  | { type: "value"; value: any };

interface CachedModelGraph {
  attributes: Record<string, any>;
  relations: Record<string, CachedRelationValue>;
}

export interface PaginatorJson<T> {
  data: CollectionJson<T>;
  current_page: number;
  per_page: number;
  total: number;
  last_page: number;
  from: number;
  to: number;
}

export interface SimplePaginatorJson<T> {
  data: CollectionJson<T>;
  current_page: number;
  per_page: number;
  from: number;
  to: number;
  has_more_pages: boolean;
  next_page: number | null;
  prev_page: number | null;
}

export interface CursorPaginatorJson<T> {
  data: CollectionJson<T>;
  per_page: number;
  next_cursor: string | null;
  prev_cursor: string | null;
  has_more_pages: boolean;
}

export class Paginator<T> {
  data: Collection<T>;
  current_page: number;
  per_page: number;
  total: number;
  last_page: number;
  from: number;
  to: number;

  constructor(init: {
    data: Collection<T>;
    current_page: number;
    per_page: number;
    total: number;
    last_page: number;
    from: number;
    to: number;
  }) {
    this.data = init.data;
    this.current_page = init.current_page;
    this.per_page = init.per_page;
    this.total = init.total;
    this.last_page = init.last_page;
    this.from = init.from;
    this.to = init.to;
  }

  json(): PaginatorJson<T> {
    return {
      data: this.data.toJSON(),
      current_page: this.current_page,
      per_page: this.per_page,
      total: this.total,
      last_page: this.last_page,
      from: this.from,
      to: this.to,
    } as PaginatorJson<T>;
  }

  toJSON(): PaginatorJson<T> {
    return this.json();
  }
}

export class SimplePaginator<T> {
  data: Collection<T>;
  current_page: number;
  per_page: number;
  from: number;
  to: number;
  has_more_pages: boolean;
  next_page: number | null;
  prev_page: number | null;

  constructor(init: {
    data: Collection<T>;
    current_page: number;
    per_page: number;
    from: number;
    to: number;
    has_more_pages: boolean;
    next_page: number | null;
    prev_page: number | null;
  }) {
    this.data = init.data;
    this.current_page = init.current_page;
    this.per_page = init.per_page;
    this.from = init.from;
    this.to = init.to;
    this.has_more_pages = init.has_more_pages;
    this.next_page = init.next_page;
    this.prev_page = init.prev_page;
  }

  json(): SimplePaginatorJson<T> {
    return {
      data: this.data.toJSON(),
      current_page: this.current_page,
      per_page: this.per_page,
      from: this.from,
      to: this.to,
      has_more_pages: this.has_more_pages,
      next_page: this.next_page,
      prev_page: this.prev_page,
    } as SimplePaginatorJson<T>;
  }

  toJSON(): SimplePaginatorJson<T> {
    return this.json();
  }
}

export class CursorPaginator<T> {
  data: Collection<T>;
  per_page: number;
  next_cursor: string | null;
  prev_cursor: string | null;
  has_more_pages: boolean;

  constructor(init: {
    data: Collection<T>;
    per_page: number;
    next_cursor: string | null;
    prev_cursor: string | null;
    has_more_pages: boolean;
  }) {
    this.data = init.data;
    this.per_page = init.per_page;
    this.next_cursor = init.next_cursor;
    this.prev_cursor = init.prev_cursor;
    this.has_more_pages = init.has_more_pages;
  }

  json(): CursorPaginatorJson<T> {
    return {
      data: this.data.toJSON(),
      per_page: this.per_page,
      next_cursor: this.next_cursor,
      prev_cursor: this.prev_cursor,
      has_more_pages: this.has_more_pages,
    } as CursorPaginatorJson<T>;
  }

  toJSON(): CursorPaginatorJson<T> {
    return this.json();
  }
}

export class Builder<T = Record<string, any>, TResult = T> {
  connection: Connection;
  tableName: string;
  columns: Array<string | RawFragment> = ["*"];
  wheres: WhereClause[] = [];
  orders: OrderClause[] = [];
  groups: Array<string | RawFragment> = [];
  havings: HavingClause[] = [];
  limitValue?: number;
  offsetValue?: number;
  joins: string[] = [];
  distinctFlag = false;
  model?: ModelConstructor;
  eagerLoads: EagerLoadDefinition[] = [];
  randomOrderFlag = false;
  lockMode?: string;
  unions: UnionDefinition[] = [];
  recursiveCtes: RecursiveCteDefinition[] = [];
  recursiveTreeConfig?: RecursiveTreeConfig;
  fromRaw?: string;
  private fromSubQuery?: Builder<any> | string;
  private fromSubAlias?: string;
  updateJoins: string[] = [];
  bindings: any[] = [];
  private parameterize = false;
  private sqlCache?: string;
  private booleanResultColumns = new Set<string>();
  private cacheKey?: string;
  private cacheTtl?: number;
  private cacheTagNames: string[] = [];

  constructor(connection: Connection, table: string) {
    this.connection = connection;
    this.tableName = table;
  }

  private get grammar() {
    return this.connection.getGrammar();
  }

  private invalidateSqlCache(): void {
    this.sqlCache = undefined;
  }

  private coerceBooleanResultColumns(row: any): any {
    for (const column of this.booleanResultColumns) {
      if (!(column in row)) continue;
      const value = row[column];
      row[column] = value === true || value === 1 || value === "1" || value === "t" || value === "true";
    }
    return row;
  }

  private isModelLike(value: any): value is Model {
    return Boolean(value) && typeof value === "object" && "$attributes" in value && "$relations" in value;
  }

  private serializeModelGraph(model: any): CachedModelGraph {
    const relations: Record<string, CachedRelationValue> = {};
    for (const [name, value] of Object.entries(model.$relations ?? {})) {
      if (value instanceof Collection || Array.isArray(value)) {
        const items = Array.from(value as any[]);
        relations[name] = items.every((item) => this.isModelLike(item))
          ? { type: "collection", models: items.map((item) => this.serializeModelGraph(item)) }
          : { type: "value", value: items };
      } else if (value === null || this.isModelLike(value)) {
        relations[name] = { type: "model", model: value ? this.serializeModelGraph(value) : null };
      } else {
        relations[name] = { type: "value", value };
      }
    }
    return {
      attributes: { ...(model.$attributes ?? {}) },
      relations,
    };
  }

  private hydrateCachedGraph(graph: CachedModelGraph, model: ModelConstructor): any {
    const instance = (model as any).hydrate(graph.attributes, this.connection);

    for (const [name, cached] of Object.entries(graph.relations)) {
      if (cached.type === "value") {
        instance.setRelation(name, cached.value);
        continue;
      }

      const relationMethod = findRelationMethod(model, name);
      const relation = relationMethod ? relationMethod.call(instance) as any : null;
      const relatedModel = relation?.getRelatedModelConstructor?.();

      if (!relatedModel) {
        instance.setRelation(name, cached.type === "collection" ? new Collection([]) : null);
        continue;
      }

      if (cached.type === "collection") {
        instance.setRelation(
          name,
          new Collection(cached.models.map((item) => this.hydrateCachedGraph(item, relatedModel)))
        );
      } else {
        instance.setRelation(
          name,
          cached.model ? this.hydrateCachedGraph(cached.model, relatedModel) : null
        );
      }
    }

    return instance;
  }

  private parseRelationAlias(relation: string, defaultSuffix: string): { relationName: string; alias: string } {
    const match = relation.match(/^(.+?)\s+as\s+(.+)$/i);
    if (!match) return { relationName: relation, alias: `${relation}${defaultSuffix}` };
    return { relationName: match[1].trim(), alias: match[2].trim() };
  }

  private normalizeEagerLoads(relations: any[]): EagerLoadDefinition[] {
    const normalized: EagerLoadDefinition[] = [];
    const flattened = relations.flat() as any[];
    for (let i = 0; i < flattened.length; i++) {
      const relation = flattened[i];
      if (typeof relation === "string") {
        const next = flattened[i + 1];
        if (typeof next === "function") {
          normalized.push({ name: relation, constraint: next });
          i++;
        } else {
          normalized.push({ name: relation });
        }
      } else if ("name" in relation && typeof (relation as EagerLoadDefinition).name === "string") {
        normalized.push(relation as EagerLoadDefinition);
      } else {
        for (const [name, constraint] of Object.entries(relation) as [string, EagerLoadDefinition["constraint"]][]) {
          normalized.push({ name, constraint });
        }
      }
    }
    return normalized;
  }

  private normalizeMorphTypes(types: string | string[] | ModelConstructor | ModelConstructor[]): string[] {
    const list = Array.isArray(types) ? types : [types];
    return list.map((type) => {
      if (typeof type === "string") return type;
      return (type as any).morphName || (type as any).name;
    });
  }

  setModel(model: ModelConstructor): this {
    this.model = model;
    return this;
  }

  table(table: string): this {
    this.invalidateSqlCache();
    this.tableName = table;
    this.fromRaw = undefined;
    this.fromSubQuery = undefined;
    this.fromSubAlias = undefined;
    return this;
  }

  from(table: string): this {
    return this.table(table);
  }

  select(...columns: ModelColumn<T>[]): this {
    this.invalidateSqlCache();
    this.columns = columns as string[];
    return this;
  }

  distinct(): this {
    this.invalidateSqlCache();
    this.distinctFlag = true;
    return this;
  }

  where(column: ModelColumn<T>, value: any): this;
  where(column: ModelColumn<T>, operator: string, value: any, boolean?: "and" | "or", scope?: string): this;
  where(column: ModelAttributeInput<T> | ((query: Builder<T>) => void), operator?: string | any, value?: any, boolean?: "and" | "or", scope?: string): this;
  where(column: ModelColumn<T> | ModelAttributeInput<T> | ((query: Builder<T>) => void), operator?: string | any, value?: any, boolean: "and" | "or" = "and", scope?: string): this {
    if (typeof column === "function") {
      return this.whereNested(column as (query: Builder<T>) => void, boolean);
    }

    if (typeof column === "object" && column !== null) {
      for (const [key, val] of Object.entries(column)) {
        this.where(key, "=", val, boolean, scope);
      }
      return this;
    }

    if (value === undefined) {
      value = operator;
      operator = "=";
    }

    this.invalidateSqlCache();
    this.wheres.push({
      type: "basic",
      column,
      operator: validOperator(operator),
      value,
      boolean: validBoolean(boolean),
      scope,
    });
    return this;
  }

  whereKey(value: ModelColumnValue<T, any> | ModelColumnValue<T, any>[]): this {
    const key = this.getModelPrimaryKey();
    return Array.isArray(value)
      ? this.whereIn(key as any, value as any[])
      : this.where(key as any, value);
  }

  whereKeyNot(value: ModelColumnValue<T, any> | ModelColumnValue<T, any>[]): this {
    const key = this.getModelPrimaryKey();
    return Array.isArray(value)
      ? this.whereNotIn(key as any, value as any[])
      : this.where(key as any, "!=", value);
  }

  private whereNested(callback: (query: Builder<T>) => void, boolean: "and" | "or" = "and"): this {
    const nested = new Builder<T>(this.connection, this.tableName);
    callback(nested);
    if (nested.wheres.length > 0) {
      this.invalidateSqlCache();
      this.wheres.push({ type: "nested", column: "", query: nested.wheres, boolean, scope: undefined });
    }
    return this;
  }

  orWhere(column: ModelColumn<T>, value: any): this;
  orWhere(column: ModelColumn<T>, operator: string, value: any): this;
  orWhere(column: ModelAttributeInput<T> | ((query: Builder<T>) => void), operator?: string | any, value?: any): this;
  orWhere(column: ModelColumn<T> | ModelAttributeInput<T> | ((query: Builder<T>) => void), operator?: string | any, value?: any): this {
    return this.where(column as any, operator, value, "or");
  }

  whereNot(column: ModelColumn<T> | ModelAttributeInput<T>, value?: any, boolean: "and" | "or" = "and"): this {
    if (typeof column === "object" && column !== null) {
      for (const [key, val] of Object.entries(column)) {
        this.whereNot(key, val, boolean);
      }
      return this;
    }
    return this.where(column, "!=", value, boolean);
  }

  orWhereNot(column: ModelColumn<T> | ModelAttributeInput<T>, value?: any): this {
    return this.whereNot(column, value, "or");
  }

  whereIn<K extends ModelColumn<T>>(column: K, values: ModelColumnValue<T, K>[], boolean: "and" | "or" = "and", scope?: string): this {
    this.invalidateSqlCache();
    this.wheres.push({ type: "in", column, value: values, boolean, scope });
    return this;
  }

  whereNotIn<K extends ModelColumn<T>>(column: K, values: ModelColumnValue<T, K>[], boolean: "and" | "or" = "and", scope?: string): this {
    this.invalidateSqlCache();
    this.wheres.push({ type: "in", column, value: values, boolean, operator: "NOT IN" as any, scope });
    return this;
  }

  whereNull(column: ModelColumn<T> | readonly ModelColumn<T>[], boolean: "and" | "or" = "and", scope?: string): this {
    for (const item of Array.isArray(column) ? column : [column]) {
      this.invalidateSqlCache();
      this.wheres.push({ type: "null", column: item, boolean, scope });
    }
    return this;
  }

  whereNotNull(column: ModelColumn<T> | readonly ModelColumn<T>[], boolean: "and" | "or" = "and", scope?: string): this {
    for (const item of Array.isArray(column) ? column : [column]) {
      this.invalidateSqlCache();
      this.wheres.push({ type: "null", column: item, boolean, operator: "NOT NULL" as any, scope });
    }
    return this;
  }

  whereBetween<K extends ModelColumn<T>>(column: K, values: [ModelColumnValue<T, K>, ModelColumnValue<T, K>], boolean: "and" | "or" = "and", scope?: string): this {
    this.invalidateSqlCache();
    this.wheres.push({ type: "between", column, value: values, boolean, scope });
    return this;
  }

  whereNotBetween<K extends ModelColumn<T>>(column: K, values: [ModelColumnValue<T, K>, ModelColumnValue<T, K>], boolean: "and" | "or" = "and", scope?: string): this {
    this.invalidateSqlCache();
    this.wheres.push({ type: "between", column, value: values, boolean, operator: "NOT BETWEEN" as any, scope });
    return this;
  }

  whereBetweenColumns(column: ModelColumn<T>, values: readonly [ModelColumn<T>, ModelColumn<T>], boolean: "and" | "or" = "and", not: boolean = false): this {
    this.invalidateSqlCache();
    this.wheres.push({ type: "between_columns", column, value: values, boolean: validBoolean(boolean), not });
    return this;
  }

  whereNotBetweenColumns(column: ModelColumn<T>, values: readonly [ModelColumn<T>, ModelColumn<T>], boolean: "and" | "or" = "and"): this {
    return this.whereBetweenColumns(column, values, boolean, true);
  }

  whereDate(column: ModelColumn<T>, operator?: string | any, value?: any, boolean: "and" | "or" = "and"): this {
    return this.addDateWhere("date", column, operator, value, boolean);
  }

  orWhereDate(column: ModelColumn<T>, operator?: string | any, value?: any): this {
    return this.whereDate(column, operator, value, "or");
  }

  whereDay(column: ModelColumn<T>, operator?: string | any, value?: any, boolean: "and" | "or" = "and"): this {
    return this.addDateWhere("day", column, operator, value, boolean);
  }

  orWhereDay(column: ModelColumn<T>, operator?: string | any, value?: any): this {
    return this.whereDay(column, operator, value, "or");
  }

  whereMonth(column: ModelColumn<T>, operator?: string | any, value?: any, boolean: "and" | "or" = "and"): this {
    return this.addDateWhere("month", column, operator, value, boolean);
  }

  orWhereMonth(column: ModelColumn<T>, operator?: string | any, value?: any): this {
    return this.whereMonth(column, operator, value, "or");
  }

  whereYear(column: ModelColumn<T>, operator?: string | any, value?: any, boolean: "and" | "or" = "and"): this {
    return this.addDateWhere("year", column, operator, value, boolean);
  }

  orWhereYear(column: ModelColumn<T>, operator?: string | any, value?: any): this {
    return this.whereYear(column, operator, value, "or");
  }

  whereTime(column: ModelColumn<T>, operator?: string | any, value?: any, boolean: "and" | "or" = "and"): this {
    return this.addDateWhere("time", column, operator, value, boolean);
  }

  orWhereTime(column: ModelColumn<T>, operator?: string | any, value?: any): this {
    return this.whereTime(column, operator, value, "or");
  }

  wherePast(columns: ModelColumn<T> | readonly ModelColumn<T>[]): this {
    return this.addRelativeDateWhere(columns, "<", new Date());
  }

  whereNowOrPast(columns: ModelColumn<T> | readonly ModelColumn<T>[]): this {
    return this.addRelativeDateWhere(columns, "<=", new Date());
  }

  whereFuture(columns: ModelColumn<T> | readonly ModelColumn<T>[]): this {
    return this.addRelativeDateWhere(columns, ">", new Date());
  }

  whereNowOrFuture(columns: ModelColumn<T> | readonly ModelColumn<T>[]): this {
    return this.addRelativeDateWhere(columns, ">=", new Date());
  }

  whereToday(columns: ModelColumn<T> | readonly ModelColumn<T>[]): this {
    return this.addRelativeDateWhere(columns, "=", this.today(), true);
  }

  whereBeforeToday(columns: ModelColumn<T> | readonly ModelColumn<T>[]): this {
    return this.addRelativeDateWhere(columns, "<", this.today(), true);
  }

  whereAfterToday(columns: ModelColumn<T> | readonly ModelColumn<T>[]): this {
    return this.addRelativeDateWhere(columns, ">", this.today(), true);
  }

  whereTodayOrBefore(columns: ModelColumn<T> | readonly ModelColumn<T>[]): this {
    return this.addRelativeDateWhere(columns, "<=", this.today(), true);
  }

  whereTodayOrAfter(columns: ModelColumn<T> | readonly ModelColumn<T>[]): this {
    return this.addRelativeDateWhere(columns, ">=", this.today(), true);
  }

  whereRaw(sql: string, boolean?: "and" | "or", scope?: string): this;
  whereRaw(sql: string, bindings?: readonly unknown[], boolean?: "and" | "or", scope?: string): this;
  whereRaw(
    sql: string,
    bindingsOrBoolean: readonly unknown[] | "and" | "or" = [],
    booleanOrScope: "and" | "or" | string = "and",
    scope?: string,
  ): this {
    const legacy = typeof bindingsOrBoolean === "string";
    const bindings = legacy ? [] : bindingsOrBoolean;
    const boolean = validBoolean(legacy ? bindingsOrBoolean : booleanOrScope);
    const resolvedScope = legacy ? booleanOrScope === "and" || booleanOrScope === "or" ? scope : booleanOrScope : scope;
    this.invalidateSqlCache();
    this.wheres.push({ type: "raw", column: sql, bindings, boolean, scope: resolvedScope });
    return this;
  }

  whereColumn(comparisons: readonly (readonly [ModelColumn<T>, string, ModelColumn<T>])[]): this;
  whereColumn(first: string, second: string): this;
  whereColumn(first: string, operator: string, second: string, boolean?: "and" | "or"): this;
  whereColumn(first: string | readonly (readonly [ModelColumn<T>, string, ModelColumn<T>])[], operatorOrSecond?: string, second?: string, boolean: "and" | "or" = "and"): this {
    if (typeof first !== "string") {
      if (first.length === 0) return this;
      return this.whereNested((query) => {
        for (const [left, operator, right] of first) {
          query.whereColumn(left, operator, right);
        }
      }, boolean);
    }

    const operator = second === undefined ? "=" : operatorOrSecond!;
    const right = second === undefined ? operatorOrSecond! : second;
    this.invalidateSqlCache();
    this.wheres.push({ type: "column", column: first, operator: validOperator(operator), value: right, boolean: validBoolean(boolean) });
    return this;
  }

  whereExists(sql: string, boolean?: "and" | "or", not?: boolean): this;
  whereExists(sql: string, bindings?: readonly unknown[], boolean?: "and" | "or", not?: boolean): this;
  whereExists(
    sql: string,
    bindingsOrBoolean: readonly unknown[] | "and" | "or" = [],
    booleanOrNot: "and" | "or" | boolean = "and",
    not: boolean = false,
  ): this {
    const legacy = typeof bindingsOrBoolean === "string";
    const bindings = legacy ? [] : bindingsOrBoolean;
    const boolean = validBoolean(legacy ? bindingsOrBoolean : booleanOrNot);
    const negate = legacy && typeof booleanOrNot === "boolean" ? booleanOrNot : not;
    this.invalidateSqlCache();
    this.wheres.push({ type: "exists", column: sql, bindings, boolean, operator: negate ? "NOT EXISTS" : "EXISTS" });
    return this;
  }

  whereNotExists(sql: string): this {
    return this.whereExists(sql, "and", true);
  }

  orWhereNull(column: ModelColumn<T> | readonly ModelColumn<T>[], scope?: string): this {
    return this.whereNull(column, "or", scope);
  }

  orWhereNotNull(column: ModelColumn<T> | readonly ModelColumn<T>[], scope?: string): this {
    return this.whereNotNull(column, "or", scope);
  }

  orWhereBetween<K extends ModelColumn<T>>(column: K, values: [ModelColumnValue<T, K>, ModelColumnValue<T, K>], scope?: string): this {
    return this.whereBetween(column, values, "or", scope);
  }

  orWhereNotBetween<K extends ModelColumn<T>>(column: K, values: [ModelColumnValue<T, K>, ModelColumnValue<T, K>], scope?: string): this {
    return this.whereNotBetween(column, values, "or", scope);
  }

  orWhereBetweenColumns(column: ModelColumn<T>, values: readonly [ModelColumn<T>, ModelColumn<T>]): this {
    return this.whereBetweenColumns(column, values, "or");
  }

  orWhereNotBetweenColumns(column: ModelColumn<T>, values: readonly [ModelColumn<T>, ModelColumn<T>]): this {
    return this.whereBetweenColumns(column, values, "or", true);
  }

  orWhereIn<K extends ModelColumn<T>>(column: K, values: ModelColumnValue<T, K>[], scope?: string): this {
    return this.whereIn(column, values, "or", scope);
  }

  orWhereNotIn<K extends ModelColumn<T>>(column: K, values: ModelColumnValue<T, K>[], scope?: string): this {
    return this.whereNotIn(column, values, "or", scope);
  }

  orWhereExists(sql: string, bindings: readonly unknown[] = []): this {
    return this.whereExists(sql, bindings, "or");
  }

  orWhereNotExists(sql: string, bindings: readonly unknown[] = []): this {
    return this.whereExists(sql, bindings, "or", true);
  }

  orWhereColumn(comparisons: readonly (readonly [ModelColumn<T>, string, ModelColumn<T>])[]): this;
  orWhereColumn(first: string, second: string): this;
  orWhereColumn(first: string, operator: string, second: string): this;
  orWhereColumn(first: string | readonly (readonly [ModelColumn<T>, string, ModelColumn<T>])[], operatorOrSecond?: string, second?: string): this {
    if (typeof first !== "string") {
      return this.whereNested((query) => {
        for (const [left, operator, right] of first) {
          query.whereColumn(left, operator, right);
        }
      }, "or");
    }
    return second === undefined
      ? this.whereColumn(first, "=", operatorOrSecond!, "or")
      : this.whereColumn(first, operatorOrSecond!, second, "or");
  }

  orWhereRaw(sql: string, bindings?: readonly unknown[], scope?: string): this;
  orWhereRaw(sql: string, scope?: string): this;
  orWhereRaw(sql: string, bindingsOrScope: readonly unknown[] | string = [], scope?: string): this {
    return Array.isArray(bindingsOrScope)
      ? this.whereRaw(sql, bindingsOrScope, "or", scope)
      : this.whereRaw(sql, "or", bindingsOrScope as string);
  }

  whereJsonContains(column: ModelColumn<T>, value: any, boolean: "and" | "or" = "and", not: boolean = false): this {
    this.invalidateSqlCache();
    this.wheres.push({ type: "json_contains", column, value, boolean, scope: undefined, not });
    return this;
  }

  whereJsonDoesntContain(column: ModelColumn<T>, value: any): this {
    return this.whereJsonContains(column, value, "and", true);
  }

  orWhereJsonContains(column: ModelColumn<T>, value: any): this {
    return this.whereJsonContains(column, value, "or");
  }

  orWhereJsonDoesntContain(column: ModelColumn<T>, value: any): this {
    return this.whereJsonContains(column, value, "or", true);
  }

  whereJsonLength(column: ModelColumn<T>, value: number): this;
  whereJsonLength(column: ModelColumn<T>, operator: string, value: number, boolean?: "and" | "or", not?: boolean): this;
  whereJsonLength(column: ModelColumn<T>, value: number, noValue: undefined, boolean: "and" | "or", not?: boolean): this;
  whereJsonLength(column: ModelColumn<T>, operatorOrValue: string | number, value?: number, boolean: "and" | "or" = "and", not: boolean = false): this {
    return this.addJsonLengthWhere(column, operatorOrValue, value, boolean, not);
  }

  orWhereJsonLength(column: ModelColumn<T>, value: number): this;
  orWhereJsonLength(column: ModelColumn<T>, operator: string, value: number): this;
  orWhereJsonLength(column: ModelColumn<T>, operatorOrValue: string | number, value?: number): this {
    return this.addJsonLengthWhere(column, operatorOrValue, value, "or", false);
  }

  private addJsonLengthWhere(column: ModelColumn<T>, operatorOrValue: string | number, value: number | undefined, boolean: "and" | "or", not: boolean): this {
    const shorthand = value === undefined;
    const expected = shorthand ? operatorOrValue : value;
    if (typeof expected !== "number" || !Number.isFinite(expected)) {
      throw new TypeError("JSON length must be a finite number.");
    }
    if (!shorthand && typeof operatorOrValue !== "string") {
      throw new TypeError("JSON length operator must be a string.");
    }
    const operator = shorthand ? "=" : validOperator(operatorOrValue as string);
    this.invalidateSqlCache();
    this.wheres.push({ type: "json_length", column, operator, value: expected, boolean: validBoolean(boolean), scope: undefined, not });
    return this;
  }

  /**
   * Pattern matching, **case-insensitive by default** — `ILIKE` on PostgreSQL,
   * `LIKE` on SQLite and MySQL, whose `LIKE` already ignores case. Pass
   * `{ caseSensitive: true }` for the exact comparison: `LIKE` on PostgreSQL,
   * `LIKE BINARY` on MySQL, `GLOB` on SQLite.
   */
  whereLike(column: ModelColumn<T>, value: string, options?: LikeOptions): this {
    return this.addLike(column, value, { boolean: "and", not: false, options });
  }

  whereNotLike(column: ModelColumn<T>, value: string, options?: LikeOptions): this {
    return this.addLike(column, value, { boolean: "and", not: true, options });
  }

  orWhereLike(column: ModelColumn<T>, value: string, options?: LikeOptions): this {
    return this.addLike(column, value, { boolean: "or", not: false, options });
  }

  orWhereNotLike(column: ModelColumn<T>, value: string, options?: LikeOptions): this {
    return this.addLike(column, value, { boolean: "or", not: true, options });
  }

  /**
   * The and/or connector stays here rather than in the four signatures above:
   * `orWhereLike()` already expresses it, so a caller never has to name it.
   */
  private addLike(
    column: ModelColumn<T>,
    value: string,
    { boolean, not, options }: { boolean: "and" | "or"; not: boolean; options?: LikeOptions }
  ): this {
    this.invalidateSqlCache();
    this.wheres.push({
      type: "like",
      column,
      value,
      boolean,
      scope: undefined,
      not,
      caseSensitive: options?.caseSensitive ?? false,
    });
    return this;
  }

  whereRegexp(column: ModelColumn<T>, value: string, boolean: "and" | "or" = "and", not: boolean = false): this {
    this.invalidateSqlCache();
    this.wheres.push({ type: "regexp", column, value, boolean, scope: undefined, not });
    return this;
  }

  whereFullText(columns: ModelColumn<T> | readonly ModelColumn<T>[], value: string, boolean: "and" | "or" = "and", not: boolean = false): this {
    const cols = Array.isArray(columns) ? columns : [columns];
    if (cols.length === 0) throw new Error("whereFullText() requires at least one column.");
    this.invalidateSqlCache();
    this.wheres.push({ type: "fulltext", column: "", columns: cols as string[], value, boolean, scope: undefined, not });
    return this;
  }

  orWhereFullText(columns: ModelColumn<T> | readonly ModelColumn<T>[], value: string): this {
    return this.whereFullText(columns, value, "or");
  }

  whereAll(columns: ModelColumn<T>[], operator: string, value: any, boolean: "and" | "or" = "and"): this {
    if (columns.length === 0) return this;
    this.invalidateSqlCache();
    this.wheres.push({ type: "all", column: "", columns: columns as string[], operator: validOperator(operator), value, boolean: validBoolean(boolean), scope: undefined });
    return this;
  }

  whereAny(columns: ModelColumn<T>[], operator: string, value: any, boolean: "and" | "or" = "and"): this {
    if (columns.length === 0) return this;
    this.invalidateSqlCache();
    this.wheres.push({ type: "any", column: "", columns: columns as string[], operator: validOperator(operator), value, boolean: validBoolean(boolean), scope: undefined });
    return this;
  }

  whereNone(columns: ModelColumn<T>[], operator: string, value: any, boolean: "and" | "or" = "and"): this {
    if (columns.length === 0) return this;
    this.invalidateSqlCache();
    this.wheres.push({ type: "any", column: "", columns: columns as string[], operator: validOperator(operator), value, boolean: validBoolean(boolean), scope: undefined, not: true });
    return this;
  }

  orWhereAny(columns: ModelColumn<T>[], operator: string, value: any): this {
    return this.whereAny(columns, operator, value, "or");
  }

  orWhereAll(columns: ModelColumn<T>[], operator: string, value: any): this {
    return this.whereAll(columns, operator, value, "or");
  }

  orWhereNone(columns: ModelColumn<T>[], operator: string, value: any): this {
    return this.whereNone(columns, operator, value, "or");
  }

  orderBy(column: ModelColumn<T>, direction: "asc" | "desc" = "asc"): this {
    this.invalidateSqlCache();
    this.orders.push({ column, direction: validDirection(direction) });
    return this;
  }

  orderByRaw(sql: string, bindings: readonly unknown[] = []): this {
    this.invalidateSqlCache();
    this.orders.push({ column: sql, bindings, direction: "asc", raw: true });
    return this;
  }

  latest(column?: ModelColumn<T>): this {
    const selected = column ?? (this.model ? this.model.getCreatedAtColumn() : "created_at");
    return this.orderBy(selected as ModelColumn<T>, "desc");
  }

  oldest(column?: ModelColumn<T>): this {
    const selected = column ?? (this.model ? this.model.getCreatedAtColumn() : "created_at");
    return this.orderBy(selected as ModelColumn<T>, "asc");
  }

  inRandomOrder(): this {
    this.invalidateSqlCache();
    this.randomOrderFlag = true;
    return this;
  }

  orderByDesc(column: ModelColumn<T>): this {
    return this.orderBy(column, "desc");
  }

  reorder(column?: ModelColumn<T>, direction: "asc" | "desc" = "asc"): this {
    this.invalidateSqlCache();
    this.orders = [];
    this.randomOrderFlag = false;
    if (column) {
      this.orderBy(column, direction);
    }
    return this;
  }

  reorderDesc(column?: ModelColumn<T>): this {
    return this.reorder(column, "desc");
  }

  groupBy(...columns: ModelColumn<T>[]): this {
    this.invalidateSqlCache();
    this.groups.push(...columns);
    return this;
  }

  groupByRaw(sql: string, bindings: readonly unknown[] = []): this {
    this.invalidateSqlCache();
    this.groups.push({ sql, bindings });
    return this;
  }

  having(column: ModelColumn<T>, operator: string, value: any): this {
    this.invalidateSqlCache();
    this.havings.push({ column, operator: validOperator(operator), value, boolean: "and" });
    return this;
  }

  orHaving(column: ModelColumn<T>, operator: string, value: any): this {
    this.invalidateSqlCache();
    this.havings.push({ column, operator: validOperator(operator), value, boolean: "or" });
    return this;
  }

  havingRaw(sql: string, boolean?: "and" | "or"): this;
  havingRaw(sql: string, bindings?: readonly unknown[], boolean?: "and" | "or"): this;
  havingRaw(sql: string, bindingsOrBoolean: readonly unknown[] | "and" | "or" = [], boolean: "and" | "or" = "and"): this {
    const legacy = typeof bindingsOrBoolean === "string";
    this.invalidateSqlCache();
    this.havings.push({
      sql,
      bindings: legacy ? [] : bindingsOrBoolean,
      boolean: validBoolean(legacy ? bindingsOrBoolean : boolean),
    });
    return this;
  }

  orHavingRaw(sql: string, bindings: readonly unknown[] = []): this {
    return this.havingRaw(sql, bindings, "or");
  }

  havingBetween(column: ModelColumn<T>, values: readonly [any, any], boolean: "and" | "or" = "and", not: boolean = false): this {
    this.invalidateSqlCache();
    this.havings.push({ type: "between", column, value: values, boolean: validBoolean(boolean), not });
    return this;
  }

  havingNotBetween(column: ModelColumn<T>, values: readonly [any, any]): this {
    return this.havingBetween(column, values, "and", true);
  }

  orHavingBetween(column: ModelColumn<T>, values: readonly [any, any]): this {
    return this.havingBetween(column, values, "or");
  }

  orHavingNotBetween(column: ModelColumn<T>, values: readonly [any, any]): this {
    return this.havingBetween(column, values, "or", true);
  }

  limit(count: number): this {
    this.invalidateSqlCache();
    this.limitValue = nonNegativeInteger(count, "Limit");
    return this;
  }

  offset(count: number): this {
    this.invalidateSqlCache();
    this.offsetValue = nonNegativeInteger(count, "Offset");
    return this;
  }

  forPage(page: number, perPage: number = 15): this {
    return this.offset((positiveInteger(page, "Page") - 1) * positiveInteger(perPage, "Per-page value")).limit(perPage);
  }

  join(table: string, first: string, operator: string, second: string, type: string = "INNER"): this {
    const joinType = String(type).toUpperCase();
    if (!new Set(["INNER", "LEFT", "RIGHT", "FULL"]).has(joinType)) {
      throw new Error(`Invalid join type: ${type}`);
    }
    const joinSql = `${joinType} JOIN ${this.grammar.wrap(table)} ON ${this.grammar.wrap(first)} ${validOperator(operator)} ${this.grammar.wrap(second)}`;
    this.invalidateSqlCache();
    this.joins.push(joinSql);
    return this;
  }

  leftJoin(table: string, first: string, operator: string, second: string): this {
    return this.join(table, first, operator, second, "LEFT");
  }

  rightJoin(table: string, first: string, operator: string, second: string): this {
    return this.join(table, first, operator, second, "RIGHT");
  }

  crossJoin(table: string): this {
    this.invalidateSqlCache();
    this.joins.push(`CROSS JOIN ${this.grammar.wrap(table)}`);
    return this;
  }

  union(query: Builder<T> | string, all: boolean = false): this {
    this.invalidateSqlCache();
    this.unions.push({ query, all });
    return this;
  }

  unionAll(query: Builder<T> | string): this {
    return this.union(query, true);
  }

  withRecursive(name: string, anchor: Builder<any> | string, recursive: Builder<any> | string): this {
    Connection.assertSafeIdentifier(name, "recursive CTE name");
    this.invalidateSqlCache();
    this.recursiveCtes.push({ name, anchor, recursive });
    return this;
  }

  recursive(parentColumn: string): this;
  recursive(parentColumn: string, startingId: any): this;
  recursive(parentColumn: string, startingIds: any[]): this;
  recursive(parentColumn: string, startingPoint?: any | any[]): this {
    return this.configureRecursiveTree("descendants", parentColumn, startingPoint);
  }

  descendants(): this;
  descendants(startingId: any): this;
  descendants(startingIds: any[]): this;
  descendants(startingPoint?: any | any[]): this {
    const relation = this.inferRecursiveRelationMetadata();
    if (!relation) {
      throw new Error("descendants() requires a self-referencing hasMany relation to infer the parent column.");
    }
    return this.configureRecursiveTree("descendants", relation.parentColumn, startingPoint);
  }

  ancestors(): this;
  ancestors(startingId: any): this;
  ancestors(startingIds: any[]): this;
  ancestors(startingPoint?: any | any[]): this {
    const relation = this.inferRecursiveRelationMetadata();
    if (!relation) {
      throw new Error("ancestors() requires a self-referencing hasMany relation to infer the parent column.");
    }
    return this.configureRecursiveTree("ancestors", relation.parentColumn, startingPoint);
  }

  includeRoot(): this {
    if (!this.recursiveTreeConfig) {
      throw new Error("includeRoot() requires recursive(parentColumn) to be called first.");
    }
    this.recursiveTreeConfig.includeRoot = true;
    this.invalidateSqlCache();
    return this;
  }

  excludeRoot(): this {
    if (!this.recursiveTreeConfig) {
      throw new Error("excludeRoot() requires recursive(parentColumn) to be called first.");
    }
    this.recursiveTreeConfig.includeRoot = false;
    this.invalidateSqlCache();
    return this;
  }

  orderByDepth(direction: "asc" | "desc" = "asc"): this {
    if (!this.recursiveTreeConfig) {
      throw new Error("orderByDepth() requires recursive(parentColumn) to be called first.");
    }
    this.recursiveTreeConfig.depthOrder = direction;
    return this.orderBy("depth" as any, direction);
  }

  breadthFirst(): this {
    return this.orderByDepth("asc");
  }

  depthFirst(): this {
    return this.orderByDepth("desc");
  }

  path(column: string = "name", alias: string = "path", delimiter: string = " > "): this {
    if (!this.recursiveTreeConfig) {
      throw new Error("path() requires recursive(parentColumn) to be called first.");
    }
    Connection.assertSafeIdentifier(column, "recursive path column");
    Connection.assertSafeIdentifier(alias, "recursive path alias");
    this.recursiveTreeConfig.path = { column, alias, delimiter };
    this.invalidateSqlCache();
    return this;
  }

  hasChildren(alias: string = "has_children"): this {
    if (!this.recursiveTreeConfig) {
      throw new Error("hasChildren() requires recursive(parentColumn) to be called first.");
    }
    Connection.assertSafeIdentifier(alias, "recursive hasChildren alias");
    this.recursiveTreeConfig.hasChildrenAlias = alias;
    this.invalidateSqlCache();
    return this;
  }

  leaf(alias: string = "leaf"): this {
    if (!this.recursiveTreeConfig) {
      throw new Error("leaf() requires recursive(parentColumn) to be called first.");
    }
    Connection.assertSafeIdentifier(alias, "recursive leaf alias");
    this.recursiveTreeConfig.leafAlias = alias;
    this.invalidateSqlCache();
    return this;
  }

  cycleGuard(maxDepth: number = 1000): this {
    return this.maxDepth(maxDepth);
  }

  maxDepth(depth: number): this {
    if (!Number.isInteger(depth) || depth < 0) {
      throw new Error(`Invalid recursive max depth: ${depth}`);
    }
    if (!this.recursiveTreeConfig) {
      throw new Error("maxDepth() requires recursive(parentColumn) to be called first.");
    }
    if (this.recursiveTreeConfig.depthFilterApplied !== undefined) {
      throw new Error("maxDepth() can only be set once on a recursive query.");
    }

    this.recursiveTreeConfig.maxDepth = depth;
    this.recursiveTreeConfig.depthFilterApplied = depth;
    this.invalidateSqlCache();
    return this;
  }

  private configureRecursiveTree(direction: "descendants" | "ancestors", parentColumn: string, startingPoint?: any | any[]): this {
    Connection.assertSafeIdentifier(parentColumn, "recursive parent column");
    const primaryKey = String((this.model as any)?.primaryKey || "id");
    Connection.assertSafeIdentifier(primaryKey, "recursive primary key");

    const cteName = "recursive_tree";
    const depthColumn = "depth";
    const baseTable = this.tableName;
    const relationAlias = direction === "ancestors" ? "recursive_parent" : "recursive_child";

    const anchor = new Builder<any>(this.connection, baseTable)
      .select(`${baseTable}.*`)
      .selectRaw(`0 as ${depthColumn}`);

    const hasStartingPoint = startingPoint !== undefined && startingPoint !== null;
    const startKeys = hasStartingPoint
      ? Array.isArray(startingPoint) ? startingPoint : [startingPoint]
      : [];

    if (!hasStartingPoint) {
      anchor.whereNull(parentColumn as any);
    } else if (startKeys.length === 0) {
      anchor.whereRaw("0 = 1");
    } else if (startKeys.length === 1) {
      anchor.where(primaryKey as any, startKeys[0]);
    } else {
      anchor.whereIn(primaryKey as any, startKeys);
    }

    const recursive = direction === "descendants"
      ? new Builder<any>(this.connection, `${baseTable} as ${relationAlias}`)
          .select(`${relationAlias}.*`)
          .selectRaw(`${cteName}.${depthColumn} + 1 as ${depthColumn}`)
          .join(cteName, `${relationAlias}.${parentColumn}`, "=", `${cteName}.${primaryKey}`)
      : new Builder<any>(this.connection, `${baseTable} as ${relationAlias}`)
          .select(`${relationAlias}.*`)
          .selectRaw(`${cteName}.${depthColumn} + 1 as ${depthColumn}`)
          .join(cteName, `${relationAlias}.${primaryKey}`, "=", `${cteName}.${parentColumn}`);

    this.recursiveTreeConfig = {
      parentColumn,
      primaryKey,
      mode: !hasStartingPoint ? "roots" : startKeys.length === 1 ? "single" : "multiple",
      direction,
      startKeys,
      cteName,
      includeRoot: true,
      depthOrder: "asc",
    };

    this.withRecursive(cteName, anchor, recursive);
    this.from(cteName);
    return this;
  }

  with<K extends string & NestedRelationPath<T>>(constraint: TypedConstraintSelection<T, K>): Builder<T, WithLoadedRelationsFromConstraintMap<TResult, TypedConstraintSelection<T, K>>>;
  with<R extends TypedConstraintMap<T> & object>(constraint: R): Builder<T, WithLoadedRelationsFromConstraintMap<TResult, R>>;
  with<Rs extends ReadonlyArray<TypedEagerLoad<T>>>(relations: Rs): Builder<T, WithLoadedRelations<TResult, ExtractStringPaths<Rs[number]>>>;
  with<Rs extends ReadonlyArray<TypedEagerLoad<T>>>(...relations: Rs): Builder<T, WithLoadedRelations<TResult, ExtractStringPaths<Rs[number]>>>;
  with<R extends string & NestedRelationPath<T>>(relation: R): Builder<T, WithLoadedRelations<TResult, R>>;
  with(relation: LiteralUnion<string & NestedRelationPath<T>>): Builder<T, WithLoadedRelations<TResult, string>>;
  with<R extends string & MorphToRelationName<T>>(relation: R, callback: MorphToConstraintCallback): Builder<T, WithLoadedRelations<TResult, R>>;
  with<R extends string & NestedRelationPath<T>>(relation: R, callback: RelationConstraint<T, R>): Builder<T, WithLoadedRelations<TResult, R>>;
  with(relation: LiteralUnion<string & NestedRelationPath<T>>, callback: EagerLoadDefinition["constraint"]): Builder<T, WithLoadedRelations<TResult, string>>;
  with(...relations: any[]): any {
    this.eagerLoads.push(...this.normalizeEagerLoads(relations as any));
    return this as any;
  }

  remember(key: string, ttl?: number): this {
    this.cacheKey = key;
    this.cacheTtl = ttl;
    return this;
  }

  cacheTags(...tags: (string | string[])[]): this {
    const next = new Set(this.cacheTagNames);
    for (const tag of tags.flat()) {
      next.add(tag);
    }
    this.cacheTagNames = [...next];
    return this;
  }

  private withoutCache(): this {
    this.cacheKey = undefined;
    this.cacheTtl = undefined;
    this.cacheTagNames = [];
    return this;
  }

  withoutGlobalScope(scope: string): this {
    this.invalidateSqlCache();
    this.wheres = this.wheres.filter((where) => where.scope !== scope);
    return this;
  }

  withoutGlobalScopes(): this {
    this.invalidateSqlCache();
    this.wheres = this.wheres.filter((where) => !where.scope);
    return this;
  }

  withTrashed(): this {
    return this.withoutGlobalScope("softDeletes").withoutGlobalScope("onlyTrashed");
  }

  withoutTrashed(): this {
    this.withTrashed();
    const model = this.model as any;
    if (model?.softDeletes) {
      this.whereNull(model.getQualifiedDeletedAtColumn(), "and", "softDeletes");
    }
    return this;
  }

  onlyTrashed(): this {
    this.withTrashed();
    const model = this.model as any;
    if (model?.softDeletes) {
      this.whereNotNull(model.getQualifiedDeletedAtColumn(), "and", "onlyTrashed");
    }
    return this;
  }

  scope(name: string, ...args: any[]): this {
    if (!this.model) {
      throw new Error(`Cannot apply scope "${name}" without a model`);
    }
    const method = `scope${name.charAt(0).toUpperCase()}${name.slice(1)}`;
    const scope = (this.model as any)[method] || (this.model as any).scopes?.[name];
    if (typeof scope !== "function") {
      throw new Error(`Scope "${name}" is not defined on model ${(this.model as any).name}`);
    }
    const result = scope.call(this.model, this, ...args);
    return (result || this) as this;
  }

  private resolveConditionalValue<TValue>(value: TValue | ((query: this) => TValue)): TValue {
    return typeof value === "function" ? (value as (query: this) => TValue)(this) : value;
  }

  when<TValue>(value: TValue | ((query: this) => TValue), callback: (query: this, value: NonNullable<TValue>) => void | this, defaultCallback?: (query: this, value: TValue) => void | this): this {
    const resolved = this.resolveConditionalValue(value);
    if (resolved) {
      const result = callback(this, resolved as NonNullable<TValue>);
      return (result || this) as this;
    } else if (defaultCallback) {
      const result = defaultCallback(this, resolved);
      return (result || this) as this;
    }
    return this;
  }

  unless<TValue>(value: TValue | ((query: this) => TValue), callback: (query: this, value: TValue) => void | this, defaultCallback?: (query: this, value: NonNullable<TValue>) => void | this): this {
    const resolved = this.resolveConditionalValue(value);
    if (!resolved) {
      const result = callback(this, resolved);
      return (result || this) as this;
    } else if (defaultCallback) {
      const result = defaultCallback(this, resolved as NonNullable<TValue>);
      return (result || this) as this;
    }
    return this;
  }

  tap(callback: (query: this) => void | this): this {
    const result = callback(this);
    return (result || this) as this;
  }

  pipe<R>(callback: (query: this) => R): R {
    return callback(this);
  }

  whereBelongsTo<R extends string & BelongsToRelationName<TResult>>(relationName: R, model: RelationShortcutInput): this {
    const models = this.normalizeRelationShortcutModels(model);
    if (models.length === 0) return this.whereRaw("0 = 1");
    const { relation } = this.resolveRelationShortcut(models[0], relationName, "belongsTo");
    const foreignKey = relation.getForeignKeyName();
    const ownerKey = relation.getOwnerKeyName();
    const values = models.map((item) => item.getAttribute(ownerKey)).filter((value) => value !== undefined && value !== null);

    if (values.length === 0) return this.whereRaw("0 = 1");
    return values.length === 1
      ? this.where(foreignKey as any, values[0])
      : this.whereIn(foreignKey as any, values as any[]);
  }

  whereAttachedTo<R extends string & AttachedToRelationName<TResult>>(relationName: R, model: RelationShortcutInput): this {
    const models = this.normalizeRelationShortcutModels(model);
    if (models.length === 0) return this.whereRaw("0 = 1");
    const shortcut = this.resolveRelationShortcut(models[0], relationName, "attachedTo");
    const relatedKey = shortcut.relation.getRelatedKeyName();
    const values = models.map((item) => item.getAttribute(relatedKey)).filter((value) => value !== undefined && value !== null);

    if (values.length === 0) return this.whereRaw("0 = 1");
    return this.whereHas(shortcut.name as any, (query: Builder<any>) => {
      const column = shortcut.relation.qualifyRelatedColumn(relatedKey);
      values.length === 1
        ? query.where(column as any, values[0])
        : query.whereIn(column as any, values as any[]);
    }) as this;
  }

  has<R extends ModelRelationName<TResult>>(relationName: R, operator: string | RelationConstraint<TResult, R> = ">=", count: number = 1, callback?: RelationConstraint<TResult, R>): this {
    if (typeof operator === "function") {
      callback = operator;
      operator = ">=";
      count = 1;
    }
    operator = validOperator(operator);
    nonNegativeInteger(count, "Relation count");
    const relation = this.getModelRelation(relationName);
    if (operator === ">=" && count === 1) {
      return this.whereExists(relation.getRelationExistenceSql(this, callback));
    }
    if ((operator === "<" || operator === "=") && count <= 0) {
      return this.whereExists(relation.getRelationExistenceSql(this, callback), "and", true);
    }
    return this.whereRaw(`(${relation.getRelationCountSql(this, callback)}) ${operator} ${this.grammar.escape(count)}`);
  }

  orHas<R extends ModelRelationName<TResult>>(relationName: R, operator: string | RelationConstraint<TResult, R> = ">=", count: number = 1, callback?: RelationConstraint<TResult, R>): this {
    if (typeof operator === "function") {
      callback = operator;
      operator = ">=";
      count = 1;
    }
    operator = validOperator(operator);
    nonNegativeInteger(count, "Relation count");
    const relation = this.getModelRelation(relationName);
    if (operator === ">=" && count === 1) {
      return this.whereExists(relation.getRelationExistenceSql(this, callback), "or");
    }
    if ((operator === "<" || operator === "=") && count <= 0) {
      return this.whereExists(relation.getRelationExistenceSql(this, callback), "or", true);
    }
    return this.whereRaw(`(${relation.getRelationCountSql(this, callback)}) ${operator} ${this.grammar.escape(count)}`, "or");
  }

  whereHas<R extends ModelRelationName<TResult>>(relationName: R, callback?: RelationConstraint<TResult, R>, operator: string = ">=", count: number = 1): this {
    return this.has(relationName, operator, count, callback);
  }

  orWhereHas<R extends ModelRelationName<TResult>>(relationName: R, callback?: RelationConstraint<TResult, R>, operator: string = ">=", count: number = 1): this {
    return this.orHas(relationName, operator, count, callback);
  }

  whereRelation(relationName: string, column: ModelColumn<T>, operator: string | any, value?: any): this {
    return (this as any).whereHas(relationName, (q: Builder<any>) => {
      value === undefined ? q.where(column as any, operator) : q.where(column as any, operator, value);
    }) as this;
  }

  orWhereRelation(relationName: string, column: ModelColumn<T>, operator: string | any, value?: any): this {
    return (this as any).orWhereHas(relationName, (q: Builder<any>) => {
      value === undefined ? q.where(column as any, operator) : q.where(column as any, operator, value);
    }) as this;
  }

  withWhereHas<R extends TypedEagerLoad<T>>(
    relation: R,
    callback?: RelationConstraint<any, any>
  ): Builder<T, WithLoadedRelations<TResult, ExtractStringPaths<R>>> {
    this.whereHas(relation as string, callback);
    return (this as any).with(relation);
  }

  doesntHave<R extends ModelRelationName<TResult>>(relationName: R, callback?: RelationConstraint<TResult, R>): this {
    return this.has(relationName, "<", 1, callback);
  }

  orDoesntHave<R extends ModelRelationName<TResult>>(relationName: R): this {
    return this.orHas(relationName, "<", 1);
  }

  whereDoesntHave<R extends ModelRelationName<TResult>>(relationName: R, callback?: RelationConstraint<TResult, R>): this {
    return this.doesntHave(relationName, callback);
  }

  orWhereDoesntHave<R extends ModelRelationName<TResult>>(relationName: R, callback?: RelationConstraint<TResult, R>): this {
    return this.orHas(relationName, "<", 1, callback);
  }

  whereHasMorph<R extends MorphToRelationName<TResult>>(
    relationName: R,
    types: string | string[] | ModelConstructor | ModelConstructor[],
    callback?: EagerLoadDefinition["constraint"],
    operator: string = ">=",
    count: number = 1
  ): this {
    operator = validOperator(operator);
    nonNegativeInteger(count, "Relation count");
    if (!this.model) {
      throw new Error(`Cannot query morph relation "${relationName}" without a model`);
    }
    const relationMethod = findRelationMethod(this.model, relationName);
    if (!relationMethod) {
      throw new Error(`Relation "${relationName}" is not defined on model ${(this.model as any).name}`);
    }
    const relation = relationMethod.call(new (this.model as any)()) as any;
    const typeList = this.normalizeMorphTypes(types);
    if (typeList.length === 0) {
      return this.whereRaw(`0 ${operator} ${this.grammar.escape(count)}`);
    }

    const shouldNotExist = operator === "<" || (operator === "=" && count <= 0);

    if (shouldNotExist) {
      // NOT EXISTS branches are ANDed together, which is already associative.
      typeList.forEach((type) => {
        this.whereExists(relation.getRelationExistenceSqlForType(this.tableName, type, callback as any), "and", true);
      });
      return this;
    }

    // The branches are ORed, so they have to be parenthesized as a group.
    // Emitting them flat lets any AND clause already on the query (a soft-delete
    // scope, a user where) bind to the first branch only:
    //   deleted_at IS NULL AND EXISTS(a) OR EXISTS(b)
    // which SQL reads as (deleted_at IS NULL AND EXISTS(a)) OR EXISTS(b).
    this.whereNested((nested) => {
      typeList.forEach((type, index) => {
        const sql = relation.getRelationExistenceSqlForType(nested.tableName, type, callback as any);
        if (index === 0) nested.whereExists(sql);
        else nested.orWhereExists(sql);
      });
    });

    return this;
  }

  whereDoesntHaveMorph<R extends MorphToRelationName<TResult>>(
    relationName: R,
    types: string | string[] | ModelConstructor | ModelConstructor[],
    callback?: EagerLoadDefinition["constraint"]
  ): this {
    return this.whereHasMorph(relationName, types, callback, "<", 1);
  }

  whereMorphRelation<R extends MorphToRelationName<TResult>>(
    relationName: R,
    types: string | string[] | ModelConstructor | ModelConstructor[],
    column: RelatedColumn<TResult, R>,
    operator: string | any,
    value?: any
  ): this {
    return this.whereHasMorph(relationName, types, (query) => {
      value === undefined ? query.where(column as any, operator) : query.where(column as any, operator, value);
    });
  }

  whereMorphedTo<R extends MorphToRelationName<TResult>>(relationName: R, model: Model | ModelConstructor | string): this {
    return this.applyWhereMorphedTo(relationName, model, "and", false);
  }

  orWhereMorphedTo<R extends MorphToRelationName<TResult>>(relationName: R, model: Model | ModelConstructor | string): this {
    return this.applyWhereMorphedTo(relationName, model, "or", false);
  }

  whereNotMorphedTo<R extends MorphToRelationName<TResult>>(relationName: R, model: Model | ModelConstructor | string): this {
    return this.applyWhereMorphedTo(relationName, model, "and", true);
  }

  withCount<R extends string & ModelRelationName<TResult>, A extends string | undefined = undefined>(relationName: R, alias?: A): Builder<T, WithRelationCount<TResult, R, A>>;
  withCount<A extends string | undefined = undefined>(relationName: LiteralUnion<string & ModelRelationName<TResult>>, alias?: A): Builder<T, WithRelationCount<TResult, string, A>>;
  withCount(relationName: string, alias?: string): any {
    const relation = this.getModelRelation(relationName);
    const resultAlias = alias || `${relationName}_count`;
    Connection.assertSafeIdentifier(resultAlias, "relation count alias");
    this.addSelectRaw(`(${relation.getRelationCountSql(this)}) AS ${this.grammar.wrap(resultAlias)}`);
    return this as any;
  }

  private addExistsSelect(relationName: string, alias: string, callback?: RelationConstraint<TResult, any>): void {
    const relation = this.getModelRelation(relationName);
    Connection.assertSafeIdentifier(alias, "relation exists alias");
    this.addSelectRaw(`CASE WHEN EXISTS (${relation.getRelationExistenceSql(this, callback)}) THEN 1 ELSE 0 END AS ${this.grammar.wrap(alias)}`);
    this.booleanResultColumns.add(alias);
  }

  withExists<R extends TypedExistsConstraintMap<T> & object>(relations: R): Builder<T, WithRelationExistsMap<TResult, R>>;
  withExists<R extends ExistsConstraintMap<T>>(relations: R): Builder<T, WithRelationExistsMap<TResult, R>>;
  withExists<R extends string & NestedRelationPath<T>>(relationName: R, callback?: RelationConstraint<T, R>): Builder<T, WithRelationExists<TResult, R>>;
  withExists(relationName: LiteralUnion<string & NestedRelationPath<T>>, callback?: RelationConstraint<any, any>): Builder<T, WithRelationExists<TResult, string>>;
  withExists<R extends string & NestedRelationPath<T>, A extends string>(relationName: R, alias: A, callback?: RelationConstraint<T, R>): Builder<T, WithRelationExists<TResult, R, A>>;
  withExists<A extends string>(relationName: LiteralUnion<string & NestedRelationPath<T>>, alias: A, callback?: RelationConstraint<any, any>): Builder<T, WithRelationExists<TResult, string, A>>;
  withExists(relationOrMap: any, aliasOrCallback?: any, callback?: any): any {
    if (typeof relationOrMap === "object" && relationOrMap !== null) {
      for (const [relation, constraint] of Object.entries(relationOrMap) as [string, RelationConstraint<TResult, any> | undefined][]) {
        const parsed = this.parseRelationAlias(relation, "_exists");
        this.addExistsSelect(parsed.relationName, parsed.alias, constraint);
      }
      return this;
    }

    const relationName = relationOrMap as string;
    const alias = typeof aliasOrCallback === "string" ? aliasOrCallback : undefined;
    const constraint = typeof aliasOrCallback === "function" ? aliasOrCallback : callback;
    this.addExistsSelect(relationName, alias || `${relationName}_exists`, constraint);
    return this as any;
  }

  withSum<R extends string & ModelRelationName<TResult>>(relationName: R, column: RelatedColumn<TResult, R>, callback: RelationConstraint<TResult, R>): this;
  withSum<R extends string & ModelRelationName<TResult>>(relationName: R, column: RelatedColumn<TResult, R>, alias?: string): this;
  withSum<R extends string & ModelRelationName<TResult>>(relationName: R, column: RelatedColumn<TResult, R>, alias: string, callback: RelationConstraint<TResult, R>): this;
  withSum(relationName: LiteralUnion<string & ModelRelationName<TResult>>, column: string, callback: EagerLoadDefinition["constraint"]): this;
  withSum(relationName: LiteralUnion<string & ModelRelationName<TResult>>, column: string, alias?: string): this;
  withSum(relationName: LiteralUnion<string & ModelRelationName<TResult>>, column: string, alias: string, callback: EagerLoadDefinition["constraint"]): this;
  withSum(relationName: string, column: string, aliasOrCallback?: string | RelationConstraint<any, any>, callback?: RelationConstraint<any, any>): this {
    return this.withAggregate(relationName, column, "SUM", aliasOrCallback, callback);
  }

  withAvg<R extends string & ModelRelationName<TResult>>(relationName: R, column: RelatedColumn<TResult, R>, callback: RelationConstraint<TResult, R>): this;
  withAvg<R extends string & ModelRelationName<TResult>>(relationName: R, column: RelatedColumn<TResult, R>, alias?: string): this;
  withAvg<R extends string & ModelRelationName<TResult>>(relationName: R, column: RelatedColumn<TResult, R>, alias: string, callback: RelationConstraint<TResult, R>): this;
  withAvg(relationName: LiteralUnion<string & ModelRelationName<TResult>>, column: string, callback: EagerLoadDefinition["constraint"]): this;
  withAvg(relationName: LiteralUnion<string & ModelRelationName<TResult>>, column: string, alias?: string): this;
  withAvg(relationName: LiteralUnion<string & ModelRelationName<TResult>>, column: string, alias: string, callback: EagerLoadDefinition["constraint"]): this;
  withAvg(relationName: string, column: string, aliasOrCallback?: string | RelationConstraint<any, any>, callback?: RelationConstraint<any, any>): this {
    return this.withAggregate(relationName, column, "AVG", aliasOrCallback, callback);
  }

  withMin<R extends string & ModelRelationName<TResult>>(relationName: R, column: RelatedColumn<TResult, R>, callback: RelationConstraint<TResult, R>): this;
  withMin<R extends string & ModelRelationName<TResult>>(relationName: R, column: RelatedColumn<TResult, R>, alias?: string): this;
  withMin<R extends string & ModelRelationName<TResult>>(relationName: R, column: RelatedColumn<TResult, R>, alias: string, callback: RelationConstraint<TResult, R>): this;
  withMin(relationName: LiteralUnion<string & ModelRelationName<TResult>>, column: string, callback: EagerLoadDefinition["constraint"]): this;
  withMin(relationName: LiteralUnion<string & ModelRelationName<TResult>>, column: string, alias?: string): this;
  withMin(relationName: LiteralUnion<string & ModelRelationName<TResult>>, column: string, alias: string, callback: EagerLoadDefinition["constraint"]): this;
  withMin(relationName: string, column: string, aliasOrCallback?: string | RelationConstraint<any, any>, callback?: RelationConstraint<any, any>): this {
    return this.withAggregate(relationName, column, "MIN", aliasOrCallback, callback);
  }

  withMax<R extends string & ModelRelationName<TResult>>(relationName: R, column: RelatedColumn<TResult, R>, callback: RelationConstraint<TResult, R>): this;
  withMax<R extends string & ModelRelationName<TResult>>(relationName: R, column: RelatedColumn<TResult, R>, alias?: string): this;
  withMax<R extends string & ModelRelationName<TResult>>(relationName: R, column: RelatedColumn<TResult, R>, alias: string, callback: RelationConstraint<TResult, R>): this;
  withMax(relationName: LiteralUnion<string & ModelRelationName<TResult>>, column: string, callback: EagerLoadDefinition["constraint"]): this;
  withMax(relationName: LiteralUnion<string & ModelRelationName<TResult>>, column: string, alias?: string): this;
  withMax(relationName: LiteralUnion<string & ModelRelationName<TResult>>, column: string, alias: string, callback: EagerLoadDefinition["constraint"]): this;
  withMax(relationName: string, column: string, aliasOrCallback?: string | RelationConstraint<any, any>, callback?: RelationConstraint<any, any>): this {
    return this.withAggregate(relationName, column, "MAX", aliasOrCallback, callback);
  }

  addSelect(...columns: ModelColumn<T>[]): this {
    this.invalidateSqlCache();
    if (this.columns.length === 1 && this.columns[0] === "*") {
      this.columns = [`${this.tableName}.*`];
    }
    this.columns.push(...columns);
    return this;
  }

  selectRaw(sql: string, bindings: readonly unknown[] = []): this {
    this.invalidateSqlCache();
    if (this.columns.length === 1 && this.columns[0] === "*") {
      this.columns = [];
    }
    this.columns.push({ sql, bindings });
    return this;
  }

  private addSelectRaw(sql: string, bindings: readonly unknown[] = []): this {
    this.invalidateSqlCache();
    if (this.columns.length === 1 && this.columns[0] === "*") {
      this.columns = [`${this.tableName}.*`];
    }
    this.columns.push({ sql, bindings });
    return this;
  }

  fromSub(query: Builder<any> | string, as: string): this {
    Connection.assertSafeIdentifier(as, "subquery alias");
    this.invalidateSqlCache();
    this.fromRaw = undefined;
    this.fromSubQuery = query;
    this.fromSubAlias = as;
    return this;
  }

  updateFrom(table: string, first: string, operator: string, second: string): this {
    this.invalidateSqlCache();
    this.updateJoins.push(`INNER JOIN ${this.grammar.wrap(table)} ON ${this.grammar.wrap(first)} ${validOperator(operator)} ${this.grammar.wrap(second)}`);
    return this;
  }

  clone(): Builder<T> {
    const cloned = new Builder<T>(this.connection, this.tableName);
    cloned.columns = [...this.columns];
    cloned.wheres = [...this.wheres];
    cloned.orders = [...this.orders];
    cloned.groups = [...this.groups];
    cloned.havings = [...this.havings];
    cloned.limitValue = this.limitValue;
    cloned.offsetValue = this.offsetValue;
    cloned.joins = [...this.joins];
    cloned.distinctFlag = this.distinctFlag;
    cloned.model = this.model;
    cloned.eagerLoads = [...this.eagerLoads];
    cloned.randomOrderFlag = this.randomOrderFlag;
    cloned.lockMode = this.lockMode;
    cloned.unions = [...this.unions];
    cloned.recursiveCtes = [...this.recursiveCtes];
    cloned.recursiveTreeConfig = this.recursiveTreeConfig ? { ...this.recursiveTreeConfig } : undefined;
    cloned.fromRaw = this.fromRaw;
    cloned.fromSubQuery = this.fromSubQuery;
    cloned.fromSubAlias = this.fromSubAlias;
    cloned.updateJoins = [...this.updateJoins];
    cloned.bindings = [...this.bindings];
    cloned.parameterize = this.parameterize;
    cloned.booleanResultColumns = new Set(this.booleanResultColumns);
    cloned.cacheKey = this.cacheKey;
    cloned.cacheTtl = this.cacheTtl;
    cloned.cacheTagNames = [...this.cacheTagNames];
    return cloned;
  }

  wrapColumn(value: string): string {
    return this.grammar.wrap(value);
  }

  escapeValue(value: any): string {
    return this.grammar.escape(value);
  }

  private addBinding(value: any): string {
    this.bindings.push(value);
    return this.grammar.placeholder(this.bindings.length);
  }

  private compileRaw(sql: string, bindings: readonly unknown[] = []): string {
    if (bindings.length === 0) return sql;
    let index = 0;
    const compiled = sql.replace(/\?/g, () => {
      if (index >= bindings.length) {
        throw new Error("Raw SQL has fewer bindings than placeholders.");
      }
      const value = bindings[index++];
      return this.parameterize ? this.addBinding(value) : this.grammar.escape(value);
    });
    if (index !== bindings.length) {
      throw new Error("Raw SQL has fewer placeholders than bindings.");
    }
    return compiled;
  }

  private compileEmbedded(query: Builder<any> | string): string {
    if (typeof query === "string") return query;
    const previousBindings = query.bindings;
    const previousParameterize = query.parameterize;
    query.bindings = this.bindings;
    query.parameterize = this.parameterize;
    try {
      return query.toSql();
    } finally {
      this.bindings = query.bindings;
      query.bindings = previousBindings;
      query.parameterize = previousParameterize;
    }
  }

  private compileFrom(): string {
    if (this.fromSubQuery && this.fromSubAlias) {
      return `(${this.compileEmbedded(this.fromSubQuery)}) AS ${this.grammar.wrap(this.fromSubAlias)}`;
    }
    return this.fromRaw || this.grammar.wrap(this.tableName);
  }

  private compileWhereClause(where: WhereClause, prefix: string): string {
    if (where.type === "basic") {
      const value = this.parameterize ? this.addBinding(where.value) : this.grammar.escape(where.value);
      return `${prefix} ${this.grammar.wrap(where.column)} ${validOperator(where.operator)} ${value}`;
    } else if (where.type === "in") {
      const op = where.operator === "NOT IN" ? "NOT IN" : "IN";
      const values = this.parameterize
        ? (where.value as any[]).map((v: any) => this.addBinding(v)).join(", ")
        : (where.value as any[]).map((v: any) => this.grammar.escape(v)).join(", ");
      return `${prefix} ${this.grammar.wrap(where.column)} ${op} (${values})`;
    } else if (where.type === "null") {
      const op = where.operator === "NOT NULL" ? "IS NOT NULL" : "IS NULL";
      return `${prefix} ${this.grammar.wrap(where.column)} ${op}`;
    } else if (where.type === "between") {
      const op = where.operator === "NOT BETWEEN" ? "NOT BETWEEN" : "BETWEEN";
      const low = this.parameterize ? this.addBinding((where.value as any[])[0]) : this.grammar.escape((where.value as any[])[0]);
      const high = this.parameterize ? this.addBinding((where.value as any[])[1]) : this.grammar.escape((where.value as any[])[1]);
      return `${prefix} ${this.grammar.wrap(where.column)} ${op} ${low} AND ${high}`;
    } else if (where.type === "between_columns") {
      const op = where.not ? "NOT BETWEEN" : "BETWEEN";
      return `${prefix} ${this.grammar.wrap(where.column)} ${op} ${this.grammar.wrap(where.value[0])} AND ${this.grammar.wrap(where.value[1])}`;
    } else if (where.type === "raw") {
      return `${prefix} ${this.compileRaw(where.column, where.bindings)}`;
    } else if (where.type === "nested") {
      const sql = this.compileWhereClauses(where.query || [], "");
      return `${prefix} (${sql})`;
    } else if (where.type === "like") {
      const sql = this.grammar.compileLike(this.grammar.wrap(where.column), where.value as string, !!where.not, this.parameterize ? (v) => this.addBinding(v) : undefined, !!where.caseSensitive);
      return `${prefix} ${sql}`;
    } else if (where.type === "regexp") {
      const sql = this.grammar.compileRegexp(this.grammar.wrap(where.column), where.value as string, !!where.not, this.parameterize ? (v) => this.addBinding(v) : undefined);
      return `${prefix} ${sql}`;
    } else if (where.type === "fulltext") {
      const cols = (where.columns || []).map((c) => this.grammar.wrap(c));
      let sql = this.grammar.compileFullText(cols, where.value as string, this.parameterize ? (v) => this.addBinding(v) : undefined);
      if (where.not) sql = `NOT (${sql})`;
      return `${prefix} ${sql}`;
    } else if (where.type === "json_contains") {
      const column = this.grammar.wrap(where.column);
      const binding = this.parameterize ? (v: any) => this.addBinding(v) : undefined;
      const sql = where.not
        ? this.grammar.compileJsonDoesntContain(column, where.value, binding)
        : this.grammar.compileJsonContains(column, where.value, binding);
      return `${prefix} ${sql}`;
    } else if (where.type === "json_length") {
      let sql = this.grammar.compileJsonLength(this.grammar.wrap(where.column), validOperator(where.operator || "="), where.value, this.parameterize ? (v) => this.addBinding(v) : undefined);
      if (where.not) sql = `NOT (${sql})`;
      return `${prefix} ${sql}`;
    } else if (where.type === "date") {
      const sql = this.grammar.compileDateWhere(where.dateType || "date", this.grammar.wrap(where.column), validOperator(where.operator || "="), where.value, this.parameterize ? (v) => this.addBinding(v) : undefined);
      return `${prefix} ${sql}`;
    } else if (where.type === "all" || where.type === "any") {
      const cols = (where.columns || []).map((c) => this.grammar.wrap(c));
      const inner = cols.map((c) => {
        const val = this.parameterize ? this.addBinding(where.value) : this.grammar.escape(where.value);
        return `${c} ${validOperator(where.operator)} ${val}`;
      }).join(where.type === "all" ? " AND " : " OR ");
      return `${prefix} ${where.not ? "NOT " : ""}(${inner})`;
    } else if (where.type === "column") {
      return `${prefix} ${this.grammar.wrap(where.column)} ${validOperator(where.operator)} ${this.grammar.wrap(where.value)}`;
    } else if (where.type === "exists") {
      return `${prefix} ${where.operator} (${this.compileRaw(where.column, where.bindings)})`;
    }
    return "";
  }

  private compileWheres(): string {
    return this.compileWhereClauses(this.wheres, "WHERE");
  }

  private compileWhereClauses(wheres: WhereClause[], firstPrefix: string): string {
    if (wheres.length === 0) return "";
    const clauses = wheres.map((where, index) => {
      const prefix = index === 0 ? "WHERE" : validBoolean(where.boolean).toUpperCase();
      const adjustedPrefix = index === 0 ? firstPrefix : prefix;
      return this.compileWhereClause(where, adjustedPrefix);
    });
    return clauses.join(" ").trim();
  }

  private compileOrders(): string {
    if (this.randomOrderFlag) {
      return this.grammar.compileRandomOrder();
    }
    if (this.orders.length === 0) return "";
    return `ORDER BY ${this.orders.map((o) => o.raw
      ? this.compileRaw(o.column, o.bindings)
      : `${this.grammar.wrap(o.column)} ${validDirection(o.direction).toUpperCase()}`
    ).join(", ")}`;
  }

  private compileGroups(): string {
    if (this.groups.length === 0) return "";
    return `GROUP BY ${this.groups.map((group) => typeof group === "string"
      ? this.grammar.wrap(group)
      : this.compileRaw(group.sql, group.bindings)
    ).join(", ")}`;
  }

  private compileHavings(): string {
    if (this.havings.length === 0) return "";
    const clauses = this.havings.map((h, index) => {
      const prefix = index === 0 ? "" : validBoolean(h.boolean).toUpperCase() + " ";
      if (h.sql) {
        return prefix + this.compileRaw(h.sql, h.bindings);
      }
      if (h.type === "between") {
        const low = this.parameterize ? this.addBinding(h.value[0]) : this.grammar.escape(h.value[0]);
        const high = this.parameterize ? this.addBinding(h.value[1]) : this.grammar.escape(h.value[1]);
        return prefix + `${this.grammar.wrap(h.column!)} ${h.not ? "NOT BETWEEN" : "BETWEEN"} ${low} AND ${high}`;
      }
      const value = this.parameterize ? this.addBinding(h.value) : this.grammar.escape(h.value);
      return prefix + `${this.grammar.wrap(h.column!)} ${validOperator(h.operator)} ${value}`;
    });
    return `HAVING ${clauses.join(" ")}`;
  }

  private compileLimit(): string {
    if (this.limitValue === undefined) return "";
    return `LIMIT ${this.limitValue}`;
  }

  private compileOffset(): string {
    if (this.offsetValue === undefined) return "";
    return this.grammar.compileOffset(this.offsetValue, this.limitValue);
  }

  private compileColumns(): string {
    return this.columns.map((column) => typeof column === "string"
      ? this.grammar.wrap(column)
      : this.compileRaw(column.sql, column.bindings)
    ).join(", ");
  }

  private compileRecursiveCtes(): string {
    if (this.recursiveCtes.length === 0) return "";
    const ctes = this.recursiveCtes.map((cte) => {
      const anchorSql = this.compileEmbedded(cte.anchor);
      let recursiveSql: string;
      if (this.recursiveTreeConfig && cte.name === this.recursiveTreeConfig.cteName && this.recursiveTreeConfig.maxDepth !== undefined) {
        const recursiveBuilder = typeof cte.recursive === "string" ? null : cte.recursive.clone();
        if (recursiveBuilder) {
          recursiveBuilder.whereRaw(`${cte.name}.depth < ?`, [this.recursiveTreeConfig.maxDepth]);
          recursiveSql = this.compileEmbedded(recursiveBuilder);
        } else {
          recursiveSql = this.compileEmbedded(cte.recursive);
        }
      } else {
        recursiveSql = this.compileEmbedded(cte.recursive);
      }
      return `${this.grammar.wrap(cte.name)} AS (${anchorSql} UNION ALL ${recursiveSql})`;
    });
    return `WITH RECURSIVE ${ctes.join(", ")}`;
  }

  /** True when this arm carries clauses that must not leak to the compound query. */
  private static needsUnionArmScope(query: Builder<any>): boolean {
    return query.limitValue !== undefined || query.offsetValue !== undefined || query.orders.length > 0;
  }

  toSql(): string {
    if (!this.parameterize && this.sqlCache) return this.sqlCache;
    const cteSql = this.compileRecursiveCtes();
    const distinct = this.distinctFlag ? "DISTINCT " : "";
    const columns = this.compileColumns();
    const from = this.compileFrom();
    let sql = `SELECT ${distinct}${columns} FROM ${from}`;
    if (this.joins.length > 0) sql += " " + this.joins.join(" ");
    sql += " " + this.compileWheres();
    sql += " " + this.compileGroups();
    sql += " " + this.compileHavings();
    sql += " " + this.compileOrders();
    sql += " " + this.compileLimit();
    sql += " " + this.compileOffset();
    sql += this.grammar.compileLock(this.lockMode);
    if (this.unions.length > 0) {
      // An arm that declares its own ORDER BY / LIMIT / OFFSET has to be scoped,
      // otherwise `SELECT ... LIMIT 5 UNION SELECT ...` is a syntax error: the
      // clause is read as belonging to the whole compound query.
      if (Builder.needsUnionArmScope(this)) sql = this.grammar.compileUnionArm(sql.trim());
      for (const union of this.unions) {
        const armSql = this.compileEmbedded(union.query).trim();
        const scoped = typeof union.query !== "string" && Builder.needsUnionArmScope(union.query)
          ? this.grammar.compileUnionArm(armSql)
          : armSql;
        sql += ` UNION${union.all ? " ALL" : ""} ${scoped}`;
      }
    }
    if (cteSql) sql = `${cteSql} ${sql}`;
    const compiled = sql.replace(/\s+/g, " ").trim();
    if (!this.parameterize) this.sqlCache = compiled;
    return compiled;
  }

  toSqlWithEagerLoads(models: Model[]): string {
    if (!this.model || this.eagerLoads.length === 0) return this.toSql();
    if (models.length === 0) throw new Error("toSqlWithEagerLoads requires at least one model");

    const queries: string[] = [this.toSql()];

    for (const eagerLoad of this.eagerLoads) {
      const relationName = eagerLoad.name;
      const relationMethod = findRelationMethod(this.model!, relationName);
      if (!relationMethod) continue;

      const firstModel = models[0];
      const relation = relationMethod.call(firstModel) as any;

      relation.addEagerConstraints(models);
      if (relation instanceof MorphTo) {
        if (eagerLoad.constraint) {
          (eagerLoad.constraint as any)(relation);
        }
        continue;
      }
      queries.push(relation.getQuery().toSql());
    }

    return queries.join(";\n");
  }

  async get(): Promise<Collection<TResult>> {
    this.bindings = [];
    this.parameterize = true;
    const sql = this.toSql();
    this.parameterize = false;
    const bindings = [...this.bindings];
    const cacheable = this.shouldUseCache();
    const cachesEagerGraph = cacheable && Boolean(this.model) && this.eagerLoads.length > 0;
    const cachedGraph = cachesEagerGraph ? await Cache.get<CachedModelGraph[]>(this.cacheKey!) : null;
    if (cachedGraph) {
      return new Collection(
        cachedGraph.map((item) => this.hydrateCachedGraph(item, this.model!))
      ) as unknown as Collection<TResult>;
    }

    const cachedRows = cacheable && !cachesEagerGraph ? await Cache.get<any[]>(this.cacheKey!) : null;
    const rows = this.decorateRecursiveRows(
      cachedRows ?? Array.from(await this.connection.query(sql, bindings)).map((row: any) => this.coerceBooleanResultColumns(row))
    );

    if (cacheable && !cachesEagerGraph && cachedRows === null) {
      await Cache.set(this.cacheKey!, rows, {
        ttl: this.cacheTtl,
        tags: this.cacheTagNames,
      });
    }

    if (this.model) {
      const identityMap = IdentityMap.current();
      const table = typeof (this.model as any).getQualifiedTable === "function"
        ? (this.model as any).getQualifiedTable(this.connection)
        : (this.model as any).getTable();
      const primaryKey = (this.model as any).primaryKey || "id";

      const models = rows.map((row: any) => {
        if (identityMap) {
          const pk = row[primaryKey];
          if (pk !== null && pk !== undefined) {
            const cached = IdentityMap.get(table, pk, this.connection);
            if (cached) {
              for (const column of this.booleanResultColumns) {
                if (column in row) {
                  (cached.$attributes as any)[column] = row[column];
                }
              }
              return cached as T;
            }
          }
        }

        const instance = (this.model as any).hydrate(row, this.connection);

        if (identityMap) {
          const pk = row[primaryKey];
          if (pk !== null && pk !== undefined) {
            IdentityMap.set(table, pk, instance, this.connection);
          }
        }

        return instance as T;
      });

      if (this.eagerLoads.length > 0) {
        await (this.model as any).eagerLoadRelations(models, this.eagerLoads);
      }

      if (cachesEagerGraph) {
        await Cache.set(this.cacheKey!, models.map((model: any) => this.serializeModelGraph(model)), {
          ttl: this.cacheTtl,
          tags: this.cacheTagNames,
        });
      }

      return new Collection(models) as unknown as Collection<TResult>;
    }

    return new Collection(rows as T[]) as unknown as Collection<TResult>;
  }

  async getTree(childrenRelation?: string): Promise<Collection<TResult> | TResult | null> {
    if (!this.recursiveTreeConfig) {
      throw new Error("getTree() requires recursive(parentColumn) to be called first.");
    }
    childrenRelation ||= this.inferRecursiveChildrenRelation() || "children";
    Connection.assertSafeIdentifier(childrenRelation, "recursive children relation");

    const rows = await this.get();
    const { parentColumn, primaryKey, mode, startKeys } = this.recursiveTreeConfig;
    const startKeySet = new Set(startKeys);
    const byKey = new Map<any, any>();
    const roots = new Collection<any>();
    const rootKeys = new Set<any>();

    for (const item of rows as any) {
      byKey.set(this.valueFromResult(item, primaryKey), item);
      this.setTreeChildren(item, childrenRelation, new Collection<any>());
    }

    for (const item of rows as any) {
      const key = this.valueFromResult(item, primaryKey);
      const parentId = this.valueFromResult(item, parentColumn);
      const parent = byKey.get(parentId);
      if (parent) {
        this.getTreeChildren(parent, childrenRelation).push(item);
      } else if (!rootKeys.has(key)) {
        roots.push(item);
        rootKeys.add(key);
      }

      if (mode !== "roots" && startKeySet.has(key) && !rootKeys.has(key)) {
        roots.push(item);
        rootKeys.add(key);
      }
    }

    if (mode === "single" && this.recursiveTreeConfig.includeRoot) {
      return (roots[0] ?? null) as unknown as TResult | null;
    }
    return roots as unknown as Collection<TResult>;
  }

  private decorateRecursiveRows(rows: any[]): any[] {
    if (!this.recursiveTreeConfig || rows.length === 0) return rows;

    const config = this.recursiveTreeConfig;
    const keptRows = config.includeRoot ? rows : rows.filter((row) => this.valueFromResult(row, "depth") !== 0);
    if (keptRows.length === 0) return keptRows;

    const byKey = new Map<any, any>();
    const childCounts = new Map<any, number>();
    for (const row of keptRows) {
      const key = this.valueFromResult(row, config.primaryKey);
      byKey.set(key, row);
    }
    for (const row of keptRows) {
      const parentId = this.valueFromResult(row, config.parentColumn);
      if (parentId === null || parentId === undefined) continue;
      childCounts.set(parentId, (childCounts.get(parentId) || 0) + 1);
    }

    const pathCache = new Map<any, string>();
    const visiting = new Set<any>();
    const resolvePath = (row: any): string => {
      if (!config.path) return "";
      const key = this.valueFromResult(row, config.primaryKey);
      if (pathCache.has(key)) return pathCache.get(key)!;
      if (visiting.has(key)) {
        throw new Error(`Recursive cycle detected while building path for ${String(key)}`);
      }
      visiting.add(key);

      const label = this.valueFromResult(row, config.path.column);
      const labelText = label === null || label === undefined ? "" : String(label);
      const parentId = this.valueFromResult(row, config.parentColumn);
      const parent = byKey.get(parentId);
      const value = parent ? `${resolvePath(parent)}${config.path.delimiter}${labelText}` : labelText;

      visiting.delete(key);
      pathCache.set(key, value);
      return value;
    };

    for (const row of keptRows) {
      const key = this.valueFromResult(row, config.primaryKey);
      const hasChildren = (childCounts.get(key) || 0) > 0;

      if (config.path) {
        this.assignRecursiveAttribute(row, config.path.alias, resolvePath(row));
      }
      if (config.hasChildrenAlias) {
        this.assignRecursiveAttribute(row, config.hasChildrenAlias, hasChildren);
      }
      if (config.leafAlias) {
        this.assignRecursiveAttribute(row, config.leafAlias, !hasChildren);
      }
    }

    return keptRows;
  }

  private assignRecursiveAttribute(row: any, key: string, value: any): void {
    if (row && typeof row.setAttribute === "function") {
      row.setAttribute(key, value);
      return;
    }
    row[key] = value;
  }

  private valueFromResult(item: any, key: string): any {
    if (item && typeof item.getAttribute === "function") return item.getAttribute(key);
    return item?.[key];
  }

  private setTreeChildren(item: any, relation: string, children: Collection<any>): void {
    if (item && typeof item.setRelation === "function") {
      item.setRelation(relation, children);
      return;
    }
    item[relation] = children;
  }

  private getTreeChildren(item: any, relation: string): Collection<any> {
    if (item && typeof item.getRelation === "function") return item.getRelation(relation);
    return item[relation];
  }

  private inferRecursiveRelationMetadata(): { relationName?: string; parentColumn: string; primaryKey: string } | undefined {
    if (!this.model) return undefined;
    const model = this.model as any;
    const instance = new model();
    const targetTable = typeof model.getQualifiedTable === "function"
      ? model.getQualifiedTable(this.connection)
      : typeof model.getTable === "function"
      ? model.getTable()
      : undefined;
    const parentColumn = this.recursiveTreeConfig?.parentColumn;
    const primaryKey = this.recursiveTreeConfig?.primaryKey || (typeof model.primaryKey === "string" ? model.primaryKey : "id");

    let current = model.prototype;
    while (current && current !== BaseModel.prototype) {
      for (const name of Object.getOwnPropertyNames(current)) {
        if (name === "constructor") continue;
        const descriptor = Object.getOwnPropertyDescriptor(current, name);
        if (typeof descriptor?.value !== "function") continue;

        try {
          const relation = descriptor.value.call(instance);
          if (!(relation instanceof HasMany)) continue;
          const related = relation.getRelatedModelConstructor();
          const relatedTable = typeof related?.getQualifiedTable === "function"
            ? related.getQualifiedTable(this.connection)
            : typeof related?.getTable === "function"
            ? related.getTable()
            : undefined;
          if (related !== model && relatedTable !== targetTable) continue;
          const foreignKey = relation.getForeignKeyName();
          const localKey = relation.getLocalKeyName();
          if (parentColumn && foreignKey !== parentColumn) continue;
          if (primaryKey && localKey !== primaryKey) continue;
          return { relationName: name, parentColumn: foreignKey, primaryKey: localKey };
        } catch {
          // Ignore ordinary methods that are not relation factories.
        }
      }
      current = Object.getPrototypeOf(current);
    }
    return undefined;
  }

  private inferRecursiveChildrenRelation(): string | undefined {
    return this.inferRecursiveRelationMetadata()?.relationName;
  }

  private shouldUseCache(): boolean {
    return Boolean(this.cacheKey)
      && !this.randomOrderFlag
      && !this.lockMode
      && !this.connection.isInTransaction()
      && !TransactionContext.current();
  }

  async getArray(): Promise<TResult[]> {
    return (await this.get()).all();
  }

  async json(): Promise<CollectionJson<TResult>> {
    if (!this.model || this.eagerLoads.length > 0 || IdentityMap.current()) {
      return (await this.get()).toJSON();
    }

    const plan = createFastJsonPlan(this.model, BaseModel);
    if (!plan) return (await this.get()).toJSON();

    const query = this.clone();
    query.model = undefined;
    query.eagerLoads = [];
    const rows = await query.get();
    return rows.map((row) => serializeJsonRow(row as Record<string, unknown>, plan)) as CollectionJson<TResult>;
  }

  async first(): Promise<TResult | null> {
    return (await this.limit(1).get())[0] || null;
  }

  async firstOr<TFallback>(callback: () => TFallback): Promise<TResult | Awaited<TFallback>> {
    const result = await this.first();
    return result === null ? await callback() : result;
  }

  async find(id: any, column: ModelColumn<T> = "id"): Promise<TResult | null> {
    return this.where(column, id).first();
  }

  async findOr<TFallback>(id: any, callback: () => TFallback, column: ModelColumn<T> = "id"): Promise<TResult | Awaited<TFallback>> {
    return await this.where(column, id).firstOr(callback);
  }

  async findOrFail(id: any, column: ModelColumn<T> = "id"): Promise<TResult> {
    const result = await this.find(id, column);
    if (!result) {
      throw new ModelNotFoundError(this.model?.name || "Model", id);
    }
    return result;
  }

  async firstOrFail(): Promise<TResult> {
    const result = await this.first();
    if (!result) {
      throw new ModelNotFoundError(this.model?.name || "Model");
    }
    return result;
  }

  private newModelForCreation(
    method: string,
    attributes: ModelAttributeInput<T> = {},
    values: ModelMassAssignmentInput<T> = {}
  ): T & BaseModel {
    if (!this.model) {
      throw new Error(`${method} requires a model to be set on the builder`);
    }
    const instance = new (this.model as any)() as T & BaseModel;
    if (typeof instance.setConnection === "function") {
      instance.setConnection(this.connection);
    }
    instance.fill(values as any);
    instance.forceFill(attributes as any);
    return instance;
  }

  async create(attributes: ModelMassAssignmentInput<T>, options: SaveOptions = {}): Promise<T> {
    const instance = this.newModelForCreation("create", {}, attributes);
    await instance.save(options);
    return instance;
  }

  async forceCreate(attributes: ModelAttributeInput<T>, options: SaveOptions = {}): Promise<T> {
    const instance = this.newModelForCreation("forceCreate", attributes);
    await instance.save(options);
    return instance;
  }

  async firstOrNew(attributes: ModelAttributeInput<T> = {}, values: ModelMassAssignmentInput<T> = {}): Promise<T> {
    const found = await this.clone().where(attributes as any).first();
    return found ?? this.newModelForCreation("firstOrNew", attributes, values);
  }

  async firstOrCreate(attributes: ModelAttributeInput<T> = {}, values: ModelMassAssignmentInput<T> = {}): Promise<T> {
    const found = await this.clone().where(attributes as any).first();
    if (found) return found;
    const instance = this.newModelForCreation("firstOrCreate", attributes, values);
    await instance.save();
    return instance;
  }

  async updateOrCreate(attributes: ModelAttributeInput<T>, values: ModelMassAssignmentInput<T> = {}): Promise<T> {
    const found = await this.clone().where(attributes as any).first();
    if (found) {
      const model = found as any;
      if (typeof model.fill === "function") {
        model.fill(values);
        await model.save();
      }
      return found;
    }
    const instance = this.newModelForCreation("updateOrCreate", attributes, values);
    await instance.save();
    return instance;
  }

  async pluck<K extends ModelColumn<T>>(column: K): Promise<ModelColumnValue<T, K>[]>;
  async pluck<K extends ModelColumn<T>>(
    column: K,
    key: ModelColumn<T>
  ): Promise<Record<string, ModelColumnValue<T, K>>>;
  async pluck(column: any, key?: any): Promise<any> {
    // Compile off a clone: this used to overwrite the builder's own `columns`
    // and `bindings`, so a builder was silently narrowed to the plucked columns
    // for every later get()/count() on it.
    const query = this.clone();
    query.model = undefined as any;
    query.bindings = [];
    query.parameterize = true;
    const columns = key === undefined ? [column] : [column, key];
    const sql = query.select(...(columns as any)).toSql();
    query.parameterize = false;
    const rows = await this.connection.query(sql, query.bindings);

    const valueField = resolveResultField((rows as any[])[0], resultFieldFor(column));
    if (key === undefined) {
      return Array.from(rows).map((row: any) => row[valueField]);
    }

    const keyField = resolveResultField((rows as any[])[0], resultFieldFor(key));
    // Null prototype: a row keyed "__proto__" is data like any other, and on a
    // plain object it would vanish or rewrite the prototype instead.
    const plucked: Record<string, any> = Object.create(null);
    for (const row of rows as any[]) {
      plucked[row[keyField]] = row[valueField];
    }
    return plucked;
  }

  async findMany(ids: any[], column?: ModelColumn<T>): Promise<Collection<TResult>> {
    const key = column || this.getModelPrimaryKey();
    return this.clone().whereIn(key as any, ids as any[]).get() as unknown as Promise<Collection<TResult>>;
  }

  firstWhere<K extends ModelColumn<T>>(column: K, value: ModelColumnValue<T, K>): Promise<TResult | null>;
  firstWhere<K extends ModelColumn<T>>(column: K, operator: string, value: ModelColumnValue<T, K>): Promise<TResult | null>;
  firstWhere(column: any, operator: any, value?: any): Promise<TResult | null> {
    return value === undefined
      ? this.clone().where(column, operator).first() as unknown as Promise<TResult | null>
      : this.clone().where(column, operator, value).first() as unknown as Promise<TResult | null>;
  }

  private async aggregate(sql: string, alias: string): Promise<any> {
    const query = this.clone();
    query.model = undefined;
    query.columns = [{ sql: `${sql} as ${alias}`, bindings: [] }];
    query.orders = [];
    query.limitValue = undefined;
    query.offsetValue = undefined;
    query.eagerLoads = [];
    query.lockMode = undefined;
    query.invalidateSqlCache();
    const result = await query.first();
    return result ? (result as any)[alias] : null;
  }

  private async countSubquery(): Promise<number> {
    const query = this.clone();
    query.model = undefined;
    query.orders = [];
    query.limitValue = undefined;
    query.offsetValue = undefined;
    query.eagerLoads = [];
    query.lockMode = undefined;
    query.bindings = [];
    query.parameterize = true;
    query.invalidateSqlCache();
    const innerSql = query.toSql();
    const rows = await this.connection.query(
      `SELECT COUNT(*) AS orm_count FROM (${innerSql}) AS ${this.grammar.wrap("orm_count_query")}`,
      query.bindings
    );
    return rows.length > 0 ? Number((rows[0] as any).orm_count) : 0;
  }

  async count(column: ModelColumn<T> | "*" = "*"): Promise<number> {
    if (
      column === "*" &&
      (this.distinctFlag || this.groups.length > 0 || this.havings.length > 0 ||
        this.unions.length > 0 || this.recursiveCtes.length > 0)
    ) {
      return await this.countSubquery();
    }

    const query = this.clone();
    const countSql = column === "*" ? "COUNT(*)" : `COUNT(${this.grammar.wrap(column as string)})`;
    query.bindings = [];
    query.parameterize = true;
    const from = query.compileFrom();
    const joins = query.joins.length > 0 ? ` ${query.joins.join(" ")}` : "";
    const whereSql = query.compileWheres();
    query.parameterize = false;
    const sql = `SELECT ${countSql} as cnt FROM ${from}${joins}${whereSql ? " " + whereSql : ""}`;
    const rows = await this.connection.query(sql, query.bindings);
    return rows.length > 0 ? Number((rows[0] as any).cnt) : 0;
  }

  async sum(column: ModelColumn<T>): Promise<NumericAggregate> {
    return (await this.aggregate(`SUM(${this.grammar.wrap(column as string)})`, "sum_val")) ?? 0;
  }

  async avg(column: ModelColumn<T>): Promise<NumericAggregate> {
    return (await this.aggregate(`AVG(${this.grammar.wrap(column as string)})`, "avg_val")) ?? 0;
  }

  async average(column: ModelColumn<T>): Promise<NumericAggregate> {
    return this.avg(column);
  }

  async min<K extends ModelColumn<T>>(column: K): Promise<ModelColumnValue<T, K> | null> {
    return await this.aggregate(`MIN(${this.grammar.wrap(column as string)})`, "min_val");
  }

  async max<K extends ModelColumn<T>>(column: K): Promise<ModelColumnValue<T, K> | null> {
    return await this.aggregate(`MAX(${this.grammar.wrap(column as string)})`, "max_val");
  }

  async paginate(perPage: number = 15, page: number = 1): Promise<Paginator<TResult>> {
    positiveInteger(perPage, "Per-page value");
    positiveInteger(page, "Page");
    const countQuery = this.clone();
    countQuery.limitValue = undefined;
    countQuery.offsetValue = undefined;
    countQuery.orders = [];
    countQuery.invalidateSqlCache();
    const total = await countQuery.count();
    const data = await this.clone().forPage(page, perPage).get() as unknown as Collection<TResult>;
    return new Paginator({
      data,
      current_page: page,
      per_page: perPage,
      total,
      last_page: Math.max(1, Math.ceil(total / perPage)),
      from: total === 0 ? 0 : (page - 1) * perPage + 1,
      to: total === 0 ? 0 : Math.min(page * perPage, total),
    });
  }

  async simplePaginate(perPage: number = 15, page: number = 1): Promise<SimplePaginator<TResult>> {
    positiveInteger(perPage, "Per-page value");
    positiveInteger(page, "Page");
    const items = await this.clone().forPage(page, perPage + 1).get() as unknown as Collection<TResult>;
    const hasMore = items.length > perPage;
    const data = new Collection(items.slice(0, perPage));
    const from = data.length === 0 ? 0 : (page - 1) * perPage + 1;
    const to = data.length === 0 ? 0 : from + data.length - 1;

    return new SimplePaginator({
      data,
      current_page: page,
      per_page: perPage,
      from,
      to,
      has_more_pages: hasMore,
      next_page: hasMore ? page + 1 : null,
      prev_page: page > 1 ? page - 1 : null,
    });
  }

  async cursorPaginate(perPage: number = 15, cursor?: string | null): Promise<CursorPaginator<TResult>> {
    positiveInteger(perPage, "Per-page value");
    if (this.randomOrderFlag) {
      throw new Error("cursorPaginate() does not support inRandomOrder().");
    }

    const orders = this.getCursorOrders();
    const cursorValues = cursor ? this.decodeCursor(cursor) : undefined;
    const builder = this.clone();
    builder.orders = orders;
    builder.offsetValue = undefined;
    builder.limitValue = perPage + 1;

    if (cursorValues !== undefined) {
      if (builder.wheres.length > 0) {
        const hasOr = builder.wheres.some((w) => w.boolean === "or");
        if (hasOr) {
          builder.wheres = [{ type: "nested", column: "", query: builder.wheres, boolean: "and", scope: undefined }];
        }
      }
      builder.wheres.push({ type: "nested", column: "", query: this.compileCursorWheres(orders, cursorValues), boolean: "and", scope: undefined });
    }

    const items = await builder.withoutCache().get() as unknown as Collection<TResult>;
    const hasMore = items.length > perPage;
    const data = new Collection(items.slice(0, perPage));
    const lastItem = data[data.length - 1];
    const nextCursor = hasMore && lastItem
      ? this.encodeCursor(orders.map((order) => this.getResultValue(lastItem, order.column)))
      : null;

    return new CursorPaginator({
      data,
      per_page: perPage,
      next_cursor: nextCursor,
      prev_cursor: cursor || null,
      has_more_pages: hasMore,
    });
  }

  async chunk(count: number, callback: (items: Collection<TResult>) => void | Promise<void>): Promise<void> {
    positiveInteger(count, "Chunk size");
    let page = 1;
    while (true) {
      const items = await this.clone().withoutCache().forPage(page, count).get() as unknown as Collection<TResult>;
      if (items.length === 0) break;
      await callback(items);
      if (items.length < count) break;
      page++;
    }
  }

  async each(count: number, callback: (item: TResult) => void | Promise<void>): Promise<void> {
    await this.chunk(count, async (items) => {
      for (const item of items) {
        await callback(item);
      }
    });
  }

  async chunkById(count: number, callback: (items: Collection<TResult>) => void | Promise<void>, column?: ModelColumn<T>): Promise<void> {
    positiveInteger(count, "Chunk size");
    const model = this.model;
    const idColumn = column ?? ((model ? (model as any).primaryKey : null) || "id") as ModelColumn<T>;
    const qualifiedColumn = String(idColumn).includes(".") ? String(idColumn) : `${this.tableName}.${String(idColumn)}`;
    const accessColumn = String(idColumn).includes(".") ? String(idColumn).split(".").at(-1)! : String(idColumn);
    let lastId: any = null;

    while (true) {
      const builder = this.clone().reorder(qualifiedColumn as ModelColumn<T>, "asc").limit(count);
      if (lastId !== null) {
        builder.where(qualifiedColumn as ModelColumn<T>, ">", lastId);
      }
      const items = await builder.withoutCache().get() as unknown as Collection<TResult>;
      if (items.length === 0) break;
      await callback(items);
      const last = items[items.length - 1];
      lastId = last && typeof last === "object" ? (last as any)[accessColumn] ?? (last as any).getAttribute?.(accessColumn) ?? null : null;
      if (items.length < count || lastId === null) break;
    }
  }

  async chunkByIdDesc(count: number, callback: (items: Collection<TResult>) => void | Promise<void>, column?: ModelColumn<T>): Promise<void> {
    positiveInteger(count, "Chunk size");
    const idColumn = (column ?? this.getModelPrimaryKey()) as ModelColumn<T>;
    const qualifiedColumn = String(idColumn).includes(".") ? String(idColumn) : `${this.tableName}.${String(idColumn)}`;
    const accessColumn = this.getResultAccessColumn(String(idColumn));
    let lastId: any = null;

    while (true) {
      const builder = this.clone().reorder(qualifiedColumn as ModelColumn<T>, "desc").limit(count);
      if (lastId !== null) {
        builder.where(qualifiedColumn as ModelColumn<T>, "<", lastId);
      }
      const items = await builder.withoutCache().get() as unknown as Collection<TResult>;
      if (items.length === 0) break;
      await callback(items);
      const last = items[items.length - 1];
      lastId = this.getResultValue(last, accessColumn);
      if (items.length < count || lastId === null || lastId === undefined) break;
    }
  }

  async eachById(count: number, callback: (item: TResult) => void | Promise<void>, column?: ModelColumn<T>): Promise<void> {
    await this.chunkById(count, async (items) => {
      for (const item of items) {
        await callback(item);
      }
    }, column);
  }

  async *cursor(chunkSize: number = 1000): AsyncGenerator<T> {
    positiveInteger(chunkSize, "Cursor chunk size");
    // Cursor pagination is incompatible with random ordering
    if (this.randomOrderFlag) {
      throw new Error("cursor() does not support inRandomOrder(). Use lazy() instead.");
    }

    let lastValues: any[] | undefined = undefined;

    while (true) {
      const builder = this.clone();
      builder.orders = this.getCursorOrders();
      builder.offsetValue = undefined;
      builder.limitValue = chunkSize;

      if (lastValues !== undefined) {
        // Parenthesize existing wheres when appending cursor condition to preserve OR precedence
        if (builder.wheres.length > 0) {
          const hasOr = builder.wheres.some((w) => w.boolean === "or");
          if (hasOr) {
            builder.wheres = [{ type: "nested", column: "", query: builder.wheres, boolean: "and", scope: undefined }];
          }
        }
        builder.wheres.push({ type: "nested", column: "", query: this.compileCursorWheres(builder.orders, lastValues), boolean: "and", scope: undefined });
      }

      const items = await builder.withoutCache().get();
      if (items.length === 0) break;

      for (const item of items) {
        yield item;
      }

      if (items.length < chunkSize) break;

      const lastItem = items[items.length - 1];
      lastValues = lastItem && typeof lastItem === "object"
        ? builder.orders.map((order) => this.getResultValue(lastItem, order.column))
        : undefined;
    }
  }

  private getCursorOrders(): OrderClause[] {
    const model = this.model;
    const primaryKey = model ? (model as any).primaryKey || "id" : "id";
    const firstDirection = this.orders[0]?.direction || "asc";
    const orders = this.orders.length > 0
      ? [...this.orders]
      : [{ column: primaryKey, direction: firstDirection as "asc" | "desc" }];
    const hasPkOrder = orders.some((o) => this.getResultAccessColumn(o.column) === primaryKey);
    if (!hasPkOrder) {
      orders.push({ column: primaryKey, direction: firstDirection as "asc" | "desc" });
    }
    return orders;
  }

  private getModelPrimaryKey(): string {
    return this.model ? ((this.model as any).primaryKey || "id") : "id";
  }

  private getResultAccessColumn(column: string): string {
    return column.includes(".") ? column.split(".").at(-1)! : column;
  }

  private getResultValue(item: any, column: string): any {
    const key = this.getResultAccessColumn(column);
    if (item && typeof item.getAttribute === "function") {
      const value = item.getAttribute(key);
      if (value !== undefined) return value;
    }
    return item?.[key];
  }

  private encodeCursor(values: any[]): string {
    return Buffer.from(JSON.stringify(values)).toString("base64url");
  }

  private decodeCursor(cursor: string): any[] {
    try {
      const values = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (!Array.isArray(values)) throw new Error("Cursor payload must be an array");
      return values;
    } catch {
      throw new Error("Invalid cursor");
    }
  }

  private applyWhereMorphedTo(relationName: string, model: Model | ModelConstructor | string, boolean: "and" | "or", not: boolean): this {
    if (!this.model) {
      throw new Error(`Cannot query morph relation "${relationName}" without a model`);
    }
    const relationMethod = findRelationMethod(this.model, relationName);
    if (!relationMethod) {
      throw new Error(`Relation "${relationName}" is not defined on model ${(this.model as any).name}`);
    }
    const relation = relationMethod.call(new (this.model as any)()) as any;
    if (!(relation instanceof MorphTo)) {
      throw new Error(`Relation "${relationName}" is not a morphTo relation`);
    }

    const typeColumn = relation.getTypeColumn();
    const idColumn = relation.getIdColumn();
    const type = this.morphTypeFor(model);
    const id = typeof model === "object" && typeof (model as any).getAttribute === "function"
      ? (model as Model).getAttribute(((Object.getPrototypeOf(model).constructor as any).primaryKey || "id") as any)
      : undefined;

    if (!not) {
      this.where(typeColumn as any, "=", type, boolean);
      if (id !== undefined && id !== null) this.where(idColumn as any, "=", id);
      return this;
    }

    if (id === undefined || id === null) {
      return this.where(typeColumn as any, "!=", type, boolean);
    }

    return this.where((query) => {
      query.where(typeColumn as any, "!=", type).orWhere(idColumn as any, "!=", id);
    }, undefined, undefined, boolean);
  }

  private morphTypeFor(model: Model | ModelConstructor | string): string {
    if (typeof model === "string") return model;
    if (typeof model === "function") return (model as any).morphName || (model as any).name;
    const constructor = Object.getPrototypeOf(model).constructor as any;
    return constructor.morphName || constructor.name;
  }

  private compileCursorWheres(orders: OrderClause[], values: any[], index: number = 0): WhereClause[] {
    const order = orders[index];
    const op = order.direction === "asc" ? ">" : "<";
    const clauses: WhereClause[] = [{
      type: "basic",
      column: order.column,
      operator: op,
      value: values[index],
      boolean: "and",
      scope: undefined,
    }];

    if (index < orders.length - 1) {
      clauses.push({
        type: "nested",
        column: "",
        query: [
          {
            type: "basic",
            column: order.column,
            operator: "=",
            value: values[index],
            boolean: "and",
            scope: undefined,
          },
          ...this.compileCursorWheres(orders, values, index + 1),
        ],
        boolean: "or",
        scope: undefined,
      });
    }

    return clauses;
  }

  async *lazy(count: number = 1000): AsyncGenerator<T> {
    positiveInteger(count, "Lazy chunk size");
    let page = 1;
    while (true) {
      const items = await this.clone().withoutCache().forPage(page, count).get();
      if (items.length === 0) break;
      for (const item of items) {
        yield item;
      }
      if (items.length < count) break;
      page++;
    }
  }

  async *lazyById(count: number = 1000, column?: ModelColumn<T>): AsyncGenerator<TResult> {
    yield* this.lazyByIdDirection(count, column, "asc");
  }

  async *lazyByIdDesc(count: number = 1000, column?: ModelColumn<T>): AsyncGenerator<TResult> {
    yield* this.lazyByIdDirection(count, column, "desc");
  }

  private async *lazyByIdDirection(count: number, column: ModelColumn<T> | undefined, direction: "asc" | "desc"): AsyncGenerator<TResult> {
    positiveInteger(count, "Lazy chunk size");
    const idColumn = (column ?? this.getModelPrimaryKey()) as ModelColumn<T>;
    const qualifiedColumn = String(idColumn).includes(".") ? String(idColumn) : `${this.tableName}.${String(idColumn)}`;
    const accessColumn = this.getResultAccessColumn(String(idColumn));
    let lastId: any = null;

    while (true) {
      const builder = this.clone().reorder(qualifiedColumn as ModelColumn<T>, direction).limit(count);
      if (lastId !== null) {
        builder.where(qualifiedColumn as ModelColumn<T>, direction === "asc" ? ">" : "<", lastId);
      }
      const items = await builder.withoutCache().get() as unknown as Collection<TResult>;
      if (items.length === 0) break;
      for (const item of items) {
        yield item;
      }
      const last = items[items.length - 1];
      lastId = this.getResultValue(last, accessColumn);
      if (items.length < count || lastId === null || lastId === undefined) break;
    }
  }

  /**
   * Restores driver-native values before Connection sends model writes.
   *
   * Applied here rather than at each call site: a model has a dozen ways to
   * reach a write — insert, upsert, updateOrInsert, saveMany, touch, increment,
   * soft delete. MySQL needs native Date values and PostgreSQL needs booleans
   * rather than SQLite's portable 1/0 representation. One place means a new
   * write path cannot forget either conversion.
   */
  private serializeDriverValues<D>(data: D): D {
    const driver = this.connection.getDriverName();
    const model = this.model as any;
    const dateColumns: string[] = driver === "mysql" ? model?.dateColumns?.() ?? [] : [];
    const booleanColumns: string[] = driver === "postgres" ? model?.booleanColumns?.() ?? [] : [];
    if (dateColumns.length === 0 && booleanColumns.length === 0) return data;

    const render = (record: Record<string, any>): Record<string, any> => {
      let copy: Record<string, any> | undefined;
      for (const column of dateColumns) {
        const value = record?.[column];
        if (value === null || value === undefined) continue;
        if (typeof value !== "string" && !(value instanceof Date)) continue;
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) continue;
        copy = copy ?? { ...record };
        copy[column] = date;
      }
      for (const column of booleanColumns) {
        const value = record?.[column];
        if (value === null || value === undefined) continue;
        copy = copy ?? { ...record };
        copy[column] = Boolean(value);
      }
      return copy ?? record;
    };

    if (Array.isArray(data)) return (data as any[]).map(render) as unknown as D;
    return render(data as any) as unknown as D;
  }

  private definedRecord(record: ModelAttributeInput<T>): ModelAttributeInput<T> {
    return Object.fromEntries(
      Object.entries(record).filter(([, value]) => value !== undefined)
    ) as ModelAttributeInput<T>;
  }

  private validateModelBackedEnums(record: ModelAttributeInput<T>): void {
    const model = this.model as any;
    if (!model) return;

    for (const [attribute, cast] of Object.entries(model.casts ?? {})) {
      if (!Object.hasOwn(record, attribute)) continue;
      assertDeclaredEnumCast(cast);
      if (!isBackedEnumDefinition(cast)) continue;
      const value = (record as any)[attribute];
      if (value !== null) assertBackedEnumValue(cast, value, model.name, attribute);
    }
  }

  private validateModelBackedEnumIncrement(column: ModelColumn<T>, amount: number): void {
    const model = this.model as any;
    if (!model) return;

    const attribute = resultFieldFor(String(column));
    const cast = model.casts?.[attribute];
    assertDeclaredEnumCast(cast);
    if (isBackedEnumDefinition(cast)) {
      assertBackedEnumValue(cast, amount, model.name, attribute);
    }
  }

  private definedRecords(data: ModelAttributeInput<T> | ModelAttributeInput<T>[]): ModelAttributeInput<T>[] {
    const records = Array.isArray(data) ? data : [data];
    for (const record of records) this.validateModelBackedEnums(record);
    const serialized = this.serializeDriverValues(data);
    return (Array.isArray(serialized) ? serialized : [serialized]).map((record) => this.definedRecord(record));
  }

  async insert(data: ModelAttributeInput<T> | ModelAttributeInput<T>[]): Promise<any> {
    const records = this.definedRecords(data);
    if (records.length === 0) return;

    const columns = this.getUniformColumns(records);
    if (columns.length === 0) {
      let result: any;
      for (const _record of records) {
        result = await this.connection.run(this.grammar.compileInsertDefault(this.grammar.wrap(this.tableName)));
      }
      return result;
    }
    const bindings: any[] = [];
    const values = records.map((record) => {
      return `(${columns.map((col) => {
        bindings.push((record as any)[col]);
        return this.grammar.placeholder(bindings.length);
      }).join(", ")})`;
    });

    const sql = `INSERT INTO ${this.grammar.wrap(this.tableName)} (${columns.map((c) => this.grammar.wrap(c)).join(", ")}) VALUES ${values.join(", ")}`;
    return await this.connection.run(sql, bindings);
  }

  async insertGetId(data: ModelAttributeInput<T>, idColumn: ModelColumn<T> = "id"): Promise<any> {
    const records = this.definedRecords(data);
    if (records.length === 0) return null;

    const columns = this.getUniformColumns(records);
    const bindings: any[] = [];
    const values = records.map((record) => {
      return `(${columns.map((col) => {
        bindings.push((record as any)[col]);
        return this.grammar.placeholder(bindings.length);
      }).join(", ")})`;
    });

    let sql = columns.length === 0
      ? this.grammar.compileInsertDefault(this.grammar.wrap(this.tableName))
      : `INSERT INTO ${this.grammar.wrap(this.tableName)} (${columns.map((c) => this.grammar.wrap(c)).join(", ")}) VALUES ${values.join(", ")}`;

    const driver = this.connection.getDriverName();
    if (driver === "postgres" || driver === "sqlite") {
      const result = await this.connection.query(
        `${sql} RETURNING ${this.grammar.wrap(idColumn)}`,
        bindings
      );
      const row = result[0];
      if (row && Object.prototype.hasOwnProperty.call(row, idColumn)) {
        return (row as any)[idColumn] ?? null;
      }
      // SQLite reads a quoted identifier that matches no column as a string
      // literal, so RETURNING "id" on a table without an "id" column succeeds
      // and returns nothing usable instead of failing. Fall back to the rowid,
      // which is what this returned before RETURNING was used here.
      if (driver === "sqlite") {
        const rowid = await this.connection.query("SELECT last_insert_rowid() AS orm_rowid");
        return rowid[0]?.orm_rowid ?? null;
      }
      return null;
    }

    return await this.connection.runAndGetMysqlInsertId(sql, bindings);
  }

  async insertOrIgnore(data: ModelAttributeInput<T> | ModelAttributeInput<T>[]): Promise<any> {
    const records = this.definedRecords(data);
    if (records.length === 0) return;

    const columns = this.getUniformColumns(records);
    if (columns.length === 0) {
      let result: any;
      for (const _record of records) {
        result = await this.connection.run(
          this.grammar.compileInsertOrIgnore(this.grammar.wrap(this.tableName), [], [])
        );
      }
      return result;
    }
    const bindings: any[] = [];
    const values = records.map((record) => {
      return `(${columns.map((col) => {
        bindings.push((record as any)[col]);
        return this.grammar.placeholder(bindings.length);
      }).join(", ")})`;
    });

    const sql = this.grammar.compileInsertOrIgnore(
      this.grammar.wrap(this.tableName),
      columns,
      values
    );
    return await this.connection.run(sql, bindings);
  }

  async upsert(data: ModelAttributeInput<T> | ModelAttributeInput<T>[], uniqueBy: ModelColumn<T> | ModelColumn<T>[], updateColumns?: ModelColumn<T>[]): Promise<any> {
    const records = this.definedRecords(data);
    if (records.length === 0) return;

    const columns = this.getUniformColumns(records);
    if (columns.length === 0) throw new Error("Upsert requires at least one defined column.");
    const bindings: any[] = [];
    const values = records.map((record) => {
      return `(${columns.map((col) => {
        bindings.push((record as any)[col]);
        return this.grammar.placeholder(bindings.length);
      }).join(", ")})`;
    });

    const uniqueCols = Array.isArray(uniqueBy) ? uniqueBy : [uniqueBy];
    const updateCols = updateColumns ?? columns.filter((c) => !uniqueCols.includes(c));

    const sql = this.grammar.compileUpsert(
      this.grammar.wrap(this.tableName),
      columns,
      values,
      uniqueCols,
      updateCols
    );
    const result = await this.connection.run(sql, bindings);
    if (this.model && IdentityMap.current()) {
      IdentityMap.clearTable((this.model as any).getQualifiedTable(this.connection), this.connection);
    }
    return result;
  }

  private getUniformColumns(records: ModelAttributeInput<T>[]): string[] {
    const columns = Object.keys(records[0]);
    const signature = [...columns].sort().join("\0");
    for (let i = 1; i < records.length; i++) {
      const recordSignature = Object.keys(records[i]).sort().join("\0");
      if (recordSignature !== signature) {
        throw new Error("Bulk insert records must have the same columns.");
      }
    }
    return columns;
  }

  async update(data: ModelAttributeInput<T>): Promise<any> {
    data = this.definedRecords(data)[0]!;
    if (Object.keys(data).length === 0) return;
    const limited = this.limitValue !== undefined;
    if (limited && !this.model) {
      throw new Error("limit() on update() requires a model-backed query");
    }
    const dispatch = this.shouldDispatchObservers();
    const affectedIds = this.model && (limited || dispatch || IdentityMap.current())
      ? await this.pluckAffectedIds()
      : null;
    const query = limited ? this.queryForAffectedIds(affectedIds!) : this;

    const result = await query.performUpdate(data);
    this.invalidateAffectedIdentityMap(affectedIds);

    if (dispatch && affectedIds && affectedIds.length > 0) {
      await this.dispatchOnAffected(["updated", "saved"], affectedIds);
    }
    return result;
  }

  private async performUpdate(data: ModelAttributeInput<T>): Promise<any> {
    this.bindings = [];
    this.parameterize = true;
    const sets = Object.entries(data).map(([key, value]) => {
      this.bindings.push(value);
      return `${this.grammar.wrap(key)} = ${this.grammar.placeholder(this.bindings.length)}`;
    });
    const whereSql = this.compileWheres();
    this.parameterize = false;
    const sql = this.grammar.compileUpdate(
      this.grammar.wrap(this.tableName),
      sets,
      whereSql,
      this.updateJoins
    );
    return await this.connection.run(sql, this.bindings);
  }

  async delete(): Promise<any> {
    const model = this.model as any;
    if (!model?.softDeletes) return await this.forceDelete();

    const dispatch = this.shouldDispatchObservers();
    const limited = this.limitValue !== undefined;
    const affectedIds = limited || dispatch || IdentityMap.current()
      ? await this.pluckAffectedIds()
      : null;
    const limitedIds = limited ? affectedIds : null;
    const query = limitedIds === null ? this : this.queryForAffectedIds(limitedIds);
    const deletedAt = new model().freshTimestamp();
    const data = this.definedRecords({ [model.deletedAtColumn]: deletedAt } as any)[0]!;
    const result = await query.performUpdate(data);
    this.invalidateAffectedIdentityMap(affectedIds);

    if (dispatch && affectedIds && affectedIds.length > 0) {
      await this.dispatchDeleted(affectedIds, deletedAt);
    }
    return result;
  }

  async forceDelete(): Promise<any> {
    const dispatch = this.shouldDispatchObservers();
    const limited = Boolean(this.model) && this.limitValue !== undefined;
    const affectedIds = this.model && (limited || dispatch || IdentityMap.current())
      ? await this.pluckAffectedIds()
      : null;
    const query = limited ? this.queryForAffectedIds(affectedIds!) : this;

    const result = await query.performDelete();
    this.invalidateAffectedIdentityMap(affectedIds);

    if (dispatch && affectedIds && affectedIds.length > 0) {
      await this.dispatchDeleted(affectedIds);
    }
    return result;
  }

  private async performDelete(): Promise<any> {
    this.bindings = [];
    this.parameterize = true;
    const whereSql = this.compileWheres();
    this.parameterize = false;
    const sql = this.grammar.compileDelete(
      this.grammar.wrap(this.tableName),
      whereSql,
      this.updateJoins,
      this.limitValue
    );
    return await this.connection.run(sql, this.bindings);
  }

  private shouldDispatchObservers(): boolean {
    return Boolean(this.model) && !ObserverRegistry.eventsMuted() && ObserverRegistry.hasAny(this.model as any);
  }

  private async pluckAffectedIds(): Promise<any[]> {
    const model = this.model as any;
    const pk: string = model.primaryKey;
    const ids = await this.clone().pluck(`${this.tableName}.${pk}` as any);
    return [...new Map(ids.map((id) => [String(id), id])).values()];
  }

  private queryForAffectedIds(affectedIds: any[]): Builder<T, TResult> {
    const model = this.model as any;
    const query = new Builder<T, TResult>(this.connection, this.tableName).setModel(model);
    return affectedIds.length > 0
      ? query.whereIn(`${this.tableName}.${model.primaryKey}` as any, affectedIds)
      : query.whereRaw("0 = 1");
  }

  private invalidateAffectedIdentityMap(affectedIds: any[] | null): void {
    if (!affectedIds || !IdentityMap.current()) return;
    const model = this.model as any;
    const table = model.getQualifiedTable(this.connection);
    for (const id of affectedIds) IdentityMap.delete(table, id, this.connection);
  }

  private async dispatchDeleted(affectedIds: any[], deletedAt?: string): Promise<void> {
    const model = this.model as any;
    for (const id of affectedIds) {
      const instance = new model();
      instance.setConnection(this.connection);
      (instance as any).setAttribute(model.primaryKey, id);
      if (deletedAt !== undefined) {
        (instance as any).setAttribute(model.deletedAtColumn, deletedAt);
        (instance as any).$exists = true;
      } else {
        (instance as any).$exists = false;
      }
      await ObserverRegistry.dispatch("deleted", instance);
    }
  }

  private async dispatchOnAffected(events: Array<"updated" | "saved" | "deleted">, ids: any[]): Promise<void> {
    const rows = await this.queryForAffectedIds(ids).get();
    for (const row of rows) {
      for (const event of events) await ObserverRegistry.dispatch(event, row);
    }
  }

  async increment(column: ModelColumn<T>, amount: number = 1, extra: ModelAttributeInput<T> = {}): Promise<any> {
    if (typeof amount !== "number" || !Number.isFinite(amount)) {
      throw new Error("Increment amount must be a finite number.");
    }
    this.validateModelBackedEnumIncrement(column, amount);
    extra = this.definedRecords(extra)[0]!;
    const limited = this.limitValue !== undefined;
    if (limited && !this.model) {
      throw new Error("limit() on increment() requires a model-backed query");
    }
    const affectedIds = this.model && (limited || IdentityMap.current())
      ? await this.pluckAffectedIds()
      : null;
    const query = limited ? this.queryForAffectedIds(affectedIds!) : this;
    const result = await query.performIncrement(column, amount, extra);
    this.invalidateAffectedIdentityMap(affectedIds);
    return result;
  }

  private async performIncrement(column: ModelColumn<T>, amount: number, extra: ModelAttributeInput<T>): Promise<any> {
    this.bindings = [];
    this.parameterize = true;
    const sets = [`${this.grammar.wrap(column)} = ${this.grammar.wrap(column)} + ${this.addBinding(amount)}`];
    for (const [key, value] of Object.entries(extra)) {
      this.bindings.push(value);
      sets.push(`${this.grammar.wrap(key)} = ${this.grammar.placeholder(this.bindings.length)}`);
    }
    const whereSql = this.compileWheres();
    this.parameterize = false;
    const sql = `UPDATE ${this.grammar.wrap(this.tableName)} SET ${sets.join(", ")} ${whereSql}`;
    return await this.connection.run(sql.trim(), this.bindings);
  }

  async decrement(column: ModelColumn<T>, amount: number = 1, extra: ModelAttributeInput<T> = {}): Promise<any> {
    return this.increment(column, -amount, extra);
  }

  async restore(): Promise<any> {
    const model = this.model as any;
    if (!model?.softDeletes) {
      throw new Error("restore() is only available for soft deleting models");
    }
    return this.withTrashed().update({ [model.deletedAtColumn]: null } as any);
  }

  async exists(): Promise<boolean> {
    // Anything the flat SELECT below cannot express (grouping, unions, CTEs)
    // goes through a derived table, same split as count().
    if (this.distinctFlag || this.groups.length > 0 || this.havings.length > 0 ||
        this.unions.length > 0 || this.recursiveCtes.length > 0) {
      return await this.existsSubquery();
    }

    // Compile off a clone: exists() must not leave its bindings behind on a
    // builder the caller may still run.
    const query = this.clone();
    query.bindings = [];
    query.parameterize = true;
    const from = query.compileFrom();
    // Joins were missing here, so a where against a joined table compiled to
    // SQL referencing a table that was never in the FROM clause.
    const joins = query.joins.length > 0 ? ` ${query.joins.join(" ")}` : "";
    const whereSql = query.compileWheres();
    query.parameterize = false;
    const sql = `SELECT 1 FROM ${from}${joins}${whereSql ? " " + whereSql : ""} LIMIT 1`;
    const rows = await this.connection.query(sql, query.bindings);
    return rows.length > 0;
  }

  private async existsSubquery(): Promise<boolean> {
    const query = this.clone();
    query.model = undefined;
    query.orders = [];
    query.limitValue = undefined;
    query.offsetValue = undefined;
    query.eagerLoads = [];
    query.lockMode = undefined;
    query.bindings = [];
    query.parameterize = true;
    query.invalidateSqlCache();
    const innerSql = query.toSql();
    const rows = await this.connection.query(
      `SELECT 1 FROM (${innerSql}) AS ${this.grammar.wrap("orm_exists_query")} LIMIT 1`,
      query.bindings
    );
    return rows.length > 0;
  }

  async doesntExist(): Promise<boolean> {
    return !(await this.exists());
  }

  async sole(): Promise<TResult> {
    const results = await this.limit(2).get();
    if (results.length === 0) {
      throw new ModelNotFoundError(this.model?.name || "Model");
    }
    if (results.length > 1) {
      throw new Error("Multiple records found when only one was expected.");
    }
    return results[0];
  }

  async value<K extends ModelColumn<T>>(column: K): Promise<ModelColumnValue<T, K> | null> {
    const result = await this.first();
    return result ? (result as any)[column] : null;
  }

  async valueOrFail<K extends ModelColumn<T>>(column: K): Promise<ModelColumnValue<T, K>> {
    const result = await this.first();
    if (result === null) {
      throw new ModelNotFoundError(this.model?.name || "Model");
    }
    return (result as any)[column];
  }

  dump(): this {
    console.log(this.toSql());
    return this;
  }

  dd(): never {
    console.log(this.toSql());
    throw new Error("dd() called — execution halted.");
  }

  async explain(): Promise<any[]> {
    this.bindings = [];
    this.parameterize = true;
    const sql = this.grammar.compileExplain(this.toSql());
    this.parameterize = false;
    const results = await this.connection.query(sql, this.bindings);
    return Array.from(results);
  }

  take(count: number): this {
    return this.limit(count);
  }

  skip(count: number): this {
    return this.offset(count);
  }

  lockForUpdate(): this {
    const driver = this.connection.getDriverName();
    if (driver !== "sqlite") {
      this.invalidateSqlCache();
      this.lockMode = "FOR UPDATE";
    }
    return this;
  }

  sharedLock(): this {
    const driver = this.connection.getDriverName();
    if (driver === "mysql") {
      this.invalidateSqlCache();
      this.lockMode = "LOCK IN SHARE MODE";
    } else if (driver === "postgres") {
      this.invalidateSqlCache();
      this.lockMode = "FOR SHARE";
    }
    return this;
  }

  skipLocked(): this {
    if (this.lockMode) {
      this.invalidateSqlCache();
      this.lockMode += " SKIP LOCKED";
    }
    return this;
  }

  noWait(): this {
    if (this.lockMode) {
      this.invalidateSqlCache();
      this.lockMode += " NOWAIT";
    }
    return this;
  }

  private addDateWhere(type: string, column: ModelColumn<T>, operator?: string | any, value?: any, boolean: "and" | "or" = "and"): this {
    if (value === undefined) {
      value = operator;
      operator = "=";
    }
    this.invalidateSqlCache();
    this.wheres.push({ type: "date", column: column as string, operator: validOperator(operator), value, boolean: validBoolean(boolean), scope: undefined, dateType: type });
    return this;
  }

  private addRelativeDateWhere(columns: ModelColumn<T> | readonly ModelColumn<T>[], operator: string, value: Date | string, dateOnly: boolean = false): this {
    for (const column of Array.isArray(columns) ? columns : [columns]) {
      if (dateOnly) this.whereDate(column, operator, value);
      else if (this.connection.getDriverName() === "sqlite") {
        this.whereRaw(
          `julianday(${this.grammar.wrap(String(column))}) ${validOperator(operator)} julianday(?)`,
          [value],
        );
      } else this.where(column, operator, value);
    }
    return this;
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private normalizeRelationShortcutModels(input: RelationShortcutInput): Model[] {
    return (input instanceof Collection ? input.all() : Array.isArray(input) ? input : [input])
      .filter((item): item is Model => Boolean(item) && typeof (item as any).getAttribute === "function");
  }

  private resolveRelationShortcut(target: Model, relationName: string | undefined, kind: "belongsTo" | "attachedTo"): { name: string; relation: any } {
    if (!this.model) {
      throw new Error(`Cannot query ${kind} relation without a model`);
    }

    if (relationName) {
      const relation = this.getModelRelation(relationName);
      if (!this.matchesRelationShortcutKind(relation, kind)) {
        throw new Error(`Relation "${relationName}" is not a ${kind === "belongsTo" ? "belongsTo" : "belongsToMany or morphToMany"} relation`);
      }
      return { name: relationName, relation };
    }

    const candidates = this.getRelationShortcutCandidates(target, kind);
    if (candidates.length === 0) {
      const targetName = Object.getPrototypeOf(target).constructor?.name || "model";
      throw new Error(`No ${kind === "belongsTo" ? "belongsTo" : "belongsToMany or morphToMany"} relation found for ${targetName}; pass the relation name explicitly`);
    }
    if (candidates.length > 1) {
      throw new Error(`Ambiguous ${kind === "belongsTo" ? "belongsTo" : "belongsToMany or morphToMany"} relation; pass the relation name explicitly`);
    }
    return candidates[0];
  }

  private getRelationShortcutCandidates(target: Model, kind: "belongsTo" | "attachedTo"): Array<{ name: string; relation: any }> {
    const candidates: Array<{ name: string; relation: any }> = [];
    const instance = new (this.model as any)();
    const seen = new Set<string>();

    for (let proto = Object.getPrototypeOf(instance); proto && proto !== BaseModel.prototype && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === "constructor" || seen.has(name)) continue;
        seen.add(name);
        const descriptor = Object.getOwnPropertyDescriptor(proto, name);
        if (typeof descriptor?.value !== "function") continue;

        let relation: any;
        try {
          relation = descriptor.value.call(instance);
        } catch {
          continue;
        }

        if (!this.matchesRelationShortcutKind(relation, kind)) continue;
        if (this.relationTargetsModel(relation, target)) candidates.push({ name, relation });
      }
    }

    return candidates;
  }

  private matchesRelationShortcutKind(relation: any, kind: "belongsTo" | "attachedTo"): boolean {
    if (!relation || typeof relation !== "object") return false;
    if (kind === "belongsTo") {
      return typeof relation.getForeignKeyName === "function" && typeof relation.getOwnerKeyName === "function";
    }
    return typeof relation.getRelatedKeyName === "function" && typeof relation.getRelatedPivotKeyName === "function";
  }

  private relationTargetsModel(relation: any, target: Model): boolean {
    const related = relation.getRelatedModelConstructor?.();
    if (!related) return false;
    const targetConstructor = Object.getPrototypeOf(target).constructor as ModelConstructor;
    if (related === targetConstructor) return true;
    if (typeof related.getQualifiedTable === "function" && typeof targetConstructor.getQualifiedTable === "function") {
      return related.getQualifiedTable(this.connection) === targetConstructor.getQualifiedTable(this.connection);
    }
    return typeof related.getTable === "function"
      && typeof targetConstructor.getTable === "function"
      && related.getTable() === targetConstructor.getTable();
  }

  private getModelRelation(relationName: string): any {
    if (!this.model) {
      throw new Error(`Cannot query relation "${relationName}" without a model`);
    }
    const instance = new (this.model as any)();
    const relation = instance[relationName]?.();
    if (!relation) {
      throw new Error(`Relation "${relationName}" is not defined on model ${(this.model as any).name}`);
    }
    return relation;
  }

  private withAggregate(
    relationName: string,
    column: string,
    fn: string,
    aliasOrCallback?: string | RelationConstraint<any, any>,
    callback?: RelationConstraint<any, any>
  ): this {
    const alias = typeof aliasOrCallback === "string" ? aliasOrCallback : undefined;
    const constraint = typeof aliasOrCallback === "function" ? aliasOrCallback : callback;
    const relation = this.getModelRelation(relationName);
    const defaultAlias = `${relationName}_${fn.toLowerCase()}_${column.replace(/\W+/g, "_")}`;
    Connection.assertSafeIdentifier(alias || defaultAlias, "relation aggregate alias");
    const aggregate = `${fn}(${this.grammar.wrap(relation.qualifyRelatedColumn(column))})`;
    this.addSelectRaw(`(${relation.getRelationAggregateSql(this, aggregate, constraint)}) AS ${this.grammar.wrap(alias || defaultAlias)}`);
    return this;
  }
}
