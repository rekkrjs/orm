import { Builder } from "../query/Builder.js";
import { insertAndResolveKey, type PrimaryKeyColumn } from "./PrimaryKeyResolution.js";
import { Schema } from "../schema/Schema.js";
import { Collection } from "../support/Collection.js";
import { pluralize, shouldGeneratePrimaryKeyForColumn, snakeCase } from "../utils.js";
import { MorphMap } from "./MorphMap.js";
import type {
  Model,
  ModelMassAssignmentInputWithout,
  ModelConstructor,
  EagerLoadInput,
  MorphCountLoadMap,
  MorphEagerLoadMap,
  MorphRelationInput,
  PivotQueryBuilder,
  StripTablePrefix,
} from "./Model.js";

function getModelConstructor(model: Model): typeof Model {
  return Object.getPrototypeOf(model).constructor as typeof Model;
}

function newRelatedInstance<T>(parent: Model, related: ModelConstructor, attributes: Record<string, any>): T {
  const instance = new (related as any)(attributes) as T;
  (instance as any).setConnection(parent.getConnection());
  return instance;
}

export class MorphTo<T extends Record<string, any> = Model> {
  protected parent: Model;
  protected name: string;
  protected typeColumn: string;
  protected idColumn: string;
  protected typeMap?: Record<string, ModelConstructor>;
  protected eagerModels: Model[] = [];
  protected morphWithLoads: MorphEagerLoadMap = {};
  protected morphWithCounts: MorphCountLoadMap = {};

  constructor(parent: Model, name: string, typeMap?: Record<string, ModelConstructor>) {
    this.parent = parent;
    this.name = name;
    this.typeColumn = `${name}_type`;
    this.idColumn = `${name}_id`;
    this.typeMap = typeMap;

    // Wrap getResults with lazy-loading guard
    const originalGetResults = (this as any).getResults.bind(this);
    (this as any).getResults = async () => {
      const parentConstructor = getModelConstructor(this.parent);
      if (parentConstructor.preventLazyLoading) {
        throw new Error(
          `Lazy loading is prevented on ${parentConstructor.name}. ` +
            `Eager load the relation using with().`
        );
      }
      return await originalGetResults();
    };
  }

  async getResults(): Promise<T | null> {
    const type = this.parent.getAttribute(this.typeColumn) as string;
    const id = this.parent.getAttribute(this.idColumn);
    // `!id` would also reject a legitimate key of 0 (or ""), so test for the
    // absence of a value rather than for falsiness.
    if (!type || id === null || id === undefined) return null;
    return this.resolveAndFind(type, id);
  }

  get(): Promise<T | null> { return this.getResults(); }

  getTypeColumn(): string {
    return this.typeColumn;
  }

  getIdColumn(): string {
    return this.idColumn;
  }

  getMorphType(): string {
    return String(this.parent.getAttribute(this.typeColumn) || "");
  }

  resolveRelated(type: string): ModelConstructor | undefined {
    let Related: ModelConstructor | undefined;
    if (this.typeMap) {
      Related = this.typeMap[type];
    }
    if (!Related) {
      Related = MorphMap.get(type);
    }
    return Related;
  }

  morphWith(relations: MorphEagerLoadMap): this {
    this.morphWithLoads = { ...this.morphWithLoads, ...relations };
    return this;
  }

  morphWithCount(relations: MorphCountLoadMap): this {
    this.morphWithCounts = { ...this.morphWithCounts, ...relations };
    return this;
  }

  protected getQueryForType(type: string): Builder<T> {
    const Related = this.resolveRelated(type);
    if (!Related) this.throwMissingMorph(type);
    return (Related as any).on(this.parent.getConnection());
  }

  protected async fetchRelatedForType(type: string, ids: any[]): Promise<Model[]> {
    const Related = this.resolveRelated(type);
    if (!Related) this.throwMissingMorph(type);
    let query = (Related as any).on(this.parent.getConnection());
    if (this.morphWithCounts[type]) {
      const counts = Array.isArray(this.morphWithCounts[type]) ? this.morphWithCounts[type] : [this.morphWithCounts[type]];
      query = query.withCount(...counts);
    }
    query = query.whereIn(Related.primaryKey, ids);
    const relatedModels = await query.get();
    const nested = this.morphWithLoads[type];
    if (nested) {
      await (Related as any).eagerLoadRelations(relatedModels, Array.isArray(nested) ? nested : [nested]);
    }
    return relatedModels as Model[];
  }

  getRelationExistenceSqlForType(parentTable: string, type: string, callback?: (query: Builder<any>) => void | Builder<any>): string {
    const Related = this.resolveRelated(type);
    if (!Related) this.throwMissingMorph(type);
    const query = (Related as any).on(this.parent.getConnection()).selectRaw("1");
    query.whereColumn(`${Related.getQualifiedTable(this.parent.getConnection())}.${Related.primaryKey}`, "=", `${parentTable}.${this.idColumn}`);
    query.where(`${parentTable}.${this.typeColumn}`, type);
    if (callback) callback(query);
    return query.toSql();
  }

  private async resolveAndFind(type: string, id: any): Promise<T | null> {
    const Related = this.resolveRelated(type);
    if (!Related) this.throwMissingMorph(type);
    return (Related as any).on(this.parent.getConnection()).find(id) as Promise<T | null>;
  }

  private throwMissingMorph(type: string): never {
    throw new Error(
      `No morph mapping found for type: ${type}. Register it with MorphMap.register() or pass a typeMap.`
    );
  }

  addEagerConstraints(models: Model[]): void {
    this.eagerModels = models;
  }

  async getEager(): Promise<Collection<any>> {
    const results: Array<{ __morphType: string; model: Model }> = [];
    const groups: Record<string, Model[]> = {};

    for (const model of this.eagerModels) {
      const type = model.getAttribute(this.typeColumn) as string;
      if (!type) continue;
      if (!groups[type]) groups[type] = [];
      groups[type].push(model);
    }

    for (const [type, models] of Object.entries(groups)) {
      const ids = [...new Set(models.map((model) => model.getAttribute(this.idColumn)).filter((id) => id !== null && id !== undefined))];
      if (ids.length === 0) continue;

      const relatedModels = await this.fetchRelatedForType(type, ids);
      for (const model of relatedModels as Model[]) {
        results.push({ __morphType: type, model });
      }
    }

    return new Collection(results);
  }

  match(models: Model[], results: Collection<{ __morphType: string; model: Model }>, relationName: string): void {
    const dictionary: Record<string, Model> = {};
    for (const result of results) {
      const key = result.model.getAttribute(getModelConstructor(result.model).primaryKey);
      dictionary[`${result.__morphType}:${String(key)}`] = result.model;
    }

    for (const model of models) {
      const type = model.getAttribute(this.typeColumn) as string;
      const id = model.getAttribute(this.idColumn);
      model.setRelation(relationName, dictionary[`${type}:${String(id)}`] || null);
    }
  }
}

export class MorphOne<T extends Record<string, any> = Model, N extends string = string, Fixed extends string = never> {
  protected builder: Builder<T>;
  protected parent: Model;
  protected related: ModelConstructor;
  protected name: N;
  protected typeColumn: string;
  protected idColumn: string;
  protected localKey: string;
  protected extraConstraints: Array<{ apply: (builder: Builder<any>) => void; aggregateSafe: boolean }> = [];
  protected whereConstraints: Array<{ column: string; operator: string; value: any; boolean: "and" | "or" }> = [];
  protected $skipEagerQuery = false;

  constructor(
    parent: Model,
    related: ModelConstructor,
    name: N,
    typeColumn?: string,
    idColumn?: string,
    localKey?: string
  ) {
    this.parent = parent;
    this.related = related;
    this.name = name;
    this.typeColumn = typeColumn || `${name}_type`;
    this.idColumn = idColumn || `${name}_id`;
    this.localKey = localKey || getModelConstructor(parent).primaryKey;
    this.builder = (related as any).on(parent.getConnection());
    this.builder.where(this.typeColumn, this.getMorphType());
    this.builder.where(this.idColumn, this.parent.getAttribute(this.localKey));

    // Wrap getResults with lazy-loading guard
    const originalGetResults = (this as any).getResults.bind(this);
    (this as any).getResults = async () => {
      const parentConstructor = getModelConstructor(this.parent);
      if (parentConstructor.preventLazyLoading) {
        throw new Error(
          `Lazy loading is prevented on ${parentConstructor.name}. ` +
            `Eager load the relation using with().`
        );
      }
      return await originalGetResults();
    };
  }

  protected getMorphType(): string {
    const parentConstructor = getModelConstructor(this.parent);
    return parentConstructor.morphName || parentConstructor.name;
  }

  getQuery(): Builder<T> {
    return this.builder;
  }

  addEagerConstraints(models: Model[]): void {
    this.builder = (this.related as any).on(this.parent.getConnection());
    const keys = models.map((m) => m.getAttribute(this.localKey)).filter((k) => k != null);
    if (keys.length === 0) { this.$skipEagerQuery = true; return; }
    this.builder.whereIn(this.idColumn, keys);
    this.builder.where(this.typeColumn, this.getMorphType());
    this.applyExtraConstraints();
  }

  where<K extends string>(column: K, operatorOrValue: any, value?: any): MorphOne<T, N, Fixed | StripTablePrefix<K>> {
    const args: any[] = value !== undefined ? [column, operatorOrValue, value] : [column, operatorOrValue];
    const operator = value !== undefined ? operatorOrValue : "=";
    const whereValue = value !== undefined ? value : operatorOrValue;
    this.whereConstraints.push({
      column: String(column),
      operator,
      value: whereValue,
      boolean: "and",
    });
    this.extraConstraints.push({ apply: (b: Builder<any>) => (b.where as any)(...args), aggregateSafe: true });
    (this.builder.where as any)(...args);
    return this as MorphOne<T, N, Fixed | StripTablePrefix<K>>;
  }

  protected getDefaultAttributes(): Record<string, any> {
    const defaults: Record<string, any> = {};
    for (const where of this.whereConstraints) {
      if (where.boolean !== "and") continue;
      if (where.operator !== "=") continue;
      const column = where.column.includes(".") ? where.column.split(".").pop()! : where.column;
      defaults[column] = where.value;
    }
    return defaults;
  }

  protected applyExtraConstraints(): void {
    this.applyExtraConstraintsTo(this.builder as Builder<any>);
  }

  /** See `Relation.applyExtraConstraintsTo`: existence queries need the same replay. */
  protected applyExtraConstraintsTo(query: Builder<any>): void {
    for (const constraint of this.extraConstraints) constraint.apply(query);
  }

  /** See `Relation.applyAggregateSafeConstraintsTo`. */
  protected applyAggregateSafeConstraintsTo(query: Builder<any>): void {
    for (const constraint of this.extraConstraints) {
      if (constraint.aggregateSafe) constraint.apply(query);
    }
  }

  async attach(attributes: MorphRelationInput<T, N, Fixed>): Promise<T> {
    const instance = newRelatedInstance<T>(this.parent, this.related, attributes);
    for (const [key, value] of Object.entries(this.getDefaultAttributes())) {
      instance.setAttribute(key as any, value);
    }
    instance.setAttribute(this.idColumn as any, this.parent.getAttribute(this.localKey));
    instance.setAttribute(this.typeColumn as any, this.getMorphType());
    await instance.save();
    return instance;
  }

  async getEager(): Promise<Collection<any>> {
    if (this.$skipEagerQuery) return new Collection<any>([]);
    return this.builder.get();
  }

  match(models: Model[], results: Collection<any>, relationName: string): void {
    const dictionary: Record<string, any> = {};
    for (const result of results) {
      const key = (result.$attributes as any)[this.idColumn];
      dictionary[String(key)] = result;
    }
    for (const model of models) {
      const key = model.getAttribute(this.localKey);
      model.setRelation(relationName, dictionary[String(key)] || null);
    }
  }

  async getResults(): Promise<T | null> {
    return this.builder.first();
  }

  get(): Promise<T | null> { return this.getResults(); }

  qualifyRelatedColumn(column: string): string {
    return column.includes(".") ? column : `${this.related.getQualifiedTable(this.parent.getConnection())}.${column}`;
  }

  protected newExistenceQuery(parentTable: string, aggregate: string, callback?: (query: Builder<any>) => void | Builder<any>): Builder<any> {
    const query = (this.related as any).on(this.parent.getConnection()).selectRaw(aggregate);
    query.whereColumn(`${this.related.getQualifiedTable(this.parent.getConnection())}.${this.idColumn}`, "=", `${parentTable}.${this.localKey}`);
    query.where(`${this.related.getQualifiedTable(this.parent.getConnection())}.${this.typeColumn}`, this.getMorphType());
    this.applyAggregateSafeConstraintsTo(query);
    if (callback) callback(query);
    return query;
  }

  getRelationExistenceSql(parentQuery: Builder<any>, callback?: (query: Builder<any>) => void | Builder<any>): string {
    return this.newExistenceQuery(parentQuery.tableName, "1", callback).toSql();
  }

  getRelationCountSql(parentQuery: Builder<any>, callback?: (query: Builder<any>) => void | Builder<any>): string {
    return this.getRelationAggregateSql(parentQuery, "COUNT(*)", callback);
  }

  getRelationAggregateSql(parentQuery: Builder<any>, aggregate: string, callback?: (query: Builder<any>) => void | Builder<any>): string {
    return this.newExistenceQuery(parentQuery.tableName, aggregate, callback).toSql();
  }
}

export class MorphMany<T extends Record<string, any> = Model, N extends string = string, Fixed extends string = never> {
  protected builder: Builder<T>;
  protected parent: Model;
  protected related: ModelConstructor;
  protected name: N;
  protected typeColumn: string;
  protected idColumn: string;
  protected localKey: string;
  protected extraConstraints: Array<{ apply: (builder: Builder<any>) => void; aggregateSafe: boolean }> = [];
  protected whereConstraints: Array<{ column: string; operator: string; value: any; boolean: "and" | "or" }> = [];
  protected $skipEagerQuery = false;

  constructor(
    parent: Model,
    related: ModelConstructor,
    name: N,
    typeColumn?: string,
    idColumn?: string,
    localKey?: string
  ) {
    this.parent = parent;
    this.related = related;
    this.name = name;
    this.typeColumn = typeColumn || `${name}_type`;
    this.idColumn = idColumn || `${name}_id`;
    this.localKey = localKey || getModelConstructor(parent).primaryKey;
    this.builder = (related as any).on(parent.getConnection());
    this.builder.where(this.typeColumn, this.getMorphType());
    this.builder.where(this.idColumn, this.parent.getAttribute(this.localKey));

    // Wrap getResults with lazy-loading guard
    const originalGetResults = (this as any).getResults.bind(this);
    (this as any).getResults = async () => {
      const parentConstructor = getModelConstructor(this.parent);
      if (parentConstructor.preventLazyLoading) {
        throw new Error(
          `Lazy loading is prevented on ${parentConstructor.name}. ` +
            `Eager load the relation using with().`
        );
      }
      return await originalGetResults();
    };
  }

  protected getMorphType(): string {
    const parentConstructor = getModelConstructor(this.parent);
    return parentConstructor.morphName || parentConstructor.name;
  }

  getQuery(): Builder<T> {
    return this.builder;
  }

  addEagerConstraints(models: Model[]): void {
    this.builder = (this.related as any).on(this.parent.getConnection());
    const keys = models.map((m) => m.getAttribute(this.localKey)).filter((k) => k != null);
    if (keys.length === 0) { this.$skipEagerQuery = true; return; }
    this.builder.whereIn(this.idColumn, keys);
    this.builder.where(this.typeColumn, this.getMorphType());
    this.applyExtraConstraints();
  }

  where<K extends string>(column: K, operatorOrValue: any, value?: any): MorphMany<T, N, Fixed | StripTablePrefix<K>> {
    const args: any[] = value !== undefined ? [column, operatorOrValue, value] : [column, operatorOrValue];
    const operator = value !== undefined ? operatorOrValue : "=";
    const whereValue = value !== undefined ? value : operatorOrValue;
    this.whereConstraints.push({
      column: String(column),
      operator,
      value: whereValue,
      boolean: "and",
    });
    this.extraConstraints.push({ apply: (b: Builder<any>) => (b.where as any)(...args), aggregateSafe: true });
    (this.builder.where as any)(...args);
    return this as MorphMany<T, N, Fixed | StripTablePrefix<K>>;
  }

  protected getDefaultAttributes(): Record<string, any> {
    const defaults: Record<string, any> = {};
    for (const where of this.whereConstraints) {
      if (where.boolean !== "and") continue;
      if (where.operator !== "=") continue;
      const column = where.column.includes(".") ? where.column.split(".").pop()! : where.column;
      defaults[column] = where.value;
    }
    return defaults;
  }

  protected applyExtraConstraints(): void {
    this.applyExtraConstraintsTo(this.builder as Builder<any>);
  }

  /** See `Relation.applyExtraConstraintsTo`: existence queries need the same replay. */
  protected applyExtraConstraintsTo(query: Builder<any>): void {
    for (const constraint of this.extraConstraints) constraint.apply(query);
  }

  /** See `Relation.applyAggregateSafeConstraintsTo`. */
  protected applyAggregateSafeConstraintsTo(query: Builder<any>): void {
    for (const constraint of this.extraConstraints) {
      if (constraint.aggregateSafe) constraint.apply(query);
    }
  }

  async getEager(): Promise<Collection<any>> {
    if (this.$skipEagerQuery) return new Collection<any>([]);
    return this.builder.get();
  }

  match(models: Model[], results: Collection<any>, relationName: string): void {
    const dictionary: Record<string, any[]> = {};
    for (const result of results) {
      const key = (result.$attributes as any)[this.idColumn];
      if (!dictionary[key]) dictionary[key] = [];
      dictionary[key].push(result);
    }
    for (const model of models) {
      const key = model.getAttribute(this.localKey);
      model.setRelation(relationName, new Collection(dictionary[String(key)] || []));
    }
  }

  async getResults(): Promise<Collection<T>> {
    return this.builder.get();
  }

  get(): Promise<Collection<T>> { return this.getResults(); }

  async attach(attributes: MorphRelationInput<T, N, Fixed>): Promise<T> {
    const instance = newRelatedInstance<T>(this.parent, this.related, attributes);
    for (const [key, value] of Object.entries(this.getDefaultAttributes())) {
      instance.setAttribute(key as any, value);
    }
    instance.setAttribute(this.idColumn as any, this.parent.getAttribute(this.localKey));
    instance.setAttribute(this.typeColumn as any, this.getMorphType());
    await instance.save();
    return instance;
  }

  async attachMany(records: MorphRelationInput<T, N, Fixed>[]): Promise<T[]> {
    const results: T[] = [];
    for (const record of records) {
      results.push(await this.attach(record));
    }
    return results;
  }

  qualifyRelatedColumn(column: string): string {
    return column.includes(".") ? column : `${this.related.getQualifiedTable(this.parent.getConnection())}.${column}`;
  }

  protected newExistenceQuery(parentTable: string, aggregate: string, callback?: (query: Builder<any>) => void | Builder<any>): Builder<any> {
    const query = (this.related as any).on(this.parent.getConnection()).selectRaw(aggregate);
    query.whereColumn(`${this.related.getQualifiedTable(this.parent.getConnection())}.${this.idColumn}`, "=", `${parentTable}.${this.localKey}`);
    query.where(`${this.related.getQualifiedTable(this.parent.getConnection())}.${this.typeColumn}`, this.getMorphType());
    this.applyAggregateSafeConstraintsTo(query);
    if (callback) callback(query);
    return query;
  }

  getRelationExistenceSql(parentQuery: Builder<any>, callback?: (query: Builder<any>) => void | Builder<any>): string {
    return this.newExistenceQuery(parentQuery.tableName, "1", callback).toSql();
  }

  getRelationCountSql(parentQuery: Builder<any>, callback?: (query: Builder<any>) => void | Builder<any>): string {
    return this.getRelationAggregateSql(parentQuery, "COUNT(*)", callback);
  }

  getRelationAggregateSql(parentQuery: Builder<any>, aggregate: string, callback?: (query: Builder<any>) => void | Builder<any>): string {
    return this.newExistenceQuery(parentQuery.tableName, aggregate, callback).toSql();
  }
}

export class MorphToMany<
  T extends Record<string, any> = Model,
  N extends string = string,
  RelatedFixed extends string = never,
  PivotFixed extends string = never
> {
  protected builder: Builder<T>;
  protected parent: Model;
  protected related: ModelConstructor;
  protected name: N;
  protected table: string;
  protected foreignPivotKey: string;
  protected relatedPivotKey: string;
  protected parentKey: string;
  protected relatedKey: string;
  protected morphType: string;
  protected pivotColumns: string[] = [];
  protected pivotTimestamps = false;
  protected pivotAccessor = "pivot";
  protected whereConstraints: Array<{ column: string; operator: string; value: any; boolean: "and" | "or" }> = [];
  protected pivotWheres: Array<{ column: string; operator: string; value: any; boolean: "and" | "or" }> = [];
  protected extraConstraints: Array<{ apply: (builder: Builder<any>) => void; aggregateSafe: boolean }> = [];
  protected $skipEagerQuery = false;

  protected decoratePivotQuery(builder: Builder<any>): Builder<any> & PivotQueryBuilder {
    const query = builder as Builder<any> & PivotQueryBuilder;
    const relation = this;

    const define = (name: keyof PivotQueryBuilder, fn: (...args: any[]) => any) => {
      if (!(name in query)) {
        Object.defineProperty(query, name, {
          configurable: true,
          enumerable: false,
          value: fn,
          writable: true,
        });
      }
    };

    define("wherePivot", (column: string, operator: string | any, value?: any) => {
      relation.applyPivotWhere(query, column, operator, value, "and");
      return query;
    });
    define("orWherePivot", (column: string, operator: string | any, value?: any) => {
      relation.applyPivotWhere(query, column, operator, value, "or");
      return query;
    });
    define("wherePivotIn", (column: string, values: any[]) => {
      relation.applyPivotWhere(query, column, "IN", values, "and");
      return query;
    });
    define("wherePivotNotIn", (column: string, values: any[]) => {
      relation.applyPivotWhere(query, column, "NOT IN", values, "and");
      return query;
    });
    define("orWherePivotIn", (column: string, values: any[]) => {
      relation.applyPivotWhere(query, column, "IN", values, "or");
      return query;
    });
    define("wherePivotNull", (column: string) => {
      relation.applyPivotWhere(query, column, "IS NULL", null, "and");
      return query;
    });
    define("wherePivotNotNull", (column: string) => {
      relation.applyPivotWhere(query, column, "IS NOT NULL", null, "and");
      return query;
    });
    define("orWherePivotNull", (column: string) => {
      relation.applyPivotWhere(query, column, "IS NULL", null, "or");
      return query;
    });
    define("wherePivotBetween", (column: string, values: [any, any]) => {
      relation.applyPivotWhere(query, column, "BETWEEN", values, "and");
      return query;
    });
    define("withPivotValue", (column: string, value: any) => {
      relation.applyPivotWhere(query, column, "=", value, "and");
      return query;
    });

    return query;
  }

  constructor(
    parent: Model,
    related: ModelConstructor,
    name: N,
    table?: string,
    foreignPivotKey?: string,
    relatedPivotKey?: string,
    parentKey?: string,
    relatedKey?: string,
    morphType?: string
  ) {
    const parentConstructor = getModelConstructor(parent);
    this.parent = parent;
    this.related = related;
    this.name = name;
    // `${name}s` produced "categorys" for a `category` morph name.
    this.table = table || pluralize(name);
    this.parentKey = parentKey || parentConstructor.primaryKey;
    this.relatedKey = relatedKey || related.primaryKey;
    this.morphType = morphType || parentConstructor.morphName || parentConstructor.name;
    this.foreignPivotKey = foreignPivotKey || `${snakeCase(name)}_id`;
    this.relatedPivotKey = relatedPivotKey || `${snakeCase(related.name)}_id`;
    this.builder = (related as any).on(parent.getConnection());
    this.addConstraints();

    // Wrap getResults with lazy-loading guard
    const originalGetResults = (this as any).getResults.bind(this);
    (this as any).getResults = async () => {
      const parentConstructor = getModelConstructor(this.parent);
      if (parentConstructor.preventLazyLoading) {
        throw new Error(
          `Lazy loading is prevented on ${parentConstructor.name}. ` +
            `Eager load the relation using with().`
        );
      }
      return await originalGetResults();
    };
  }

  protected qualifiedPivotTable(): string {
    return this.parent.getConnection().qualifyTable(this.table);
  }

  protected applyStoredPivotWhere(builder: Builder<any>, where: { column: string; operator: string; value: any; boolean: "and" | "or" }): Builder<any> {
    if (where.operator === "IN") {
      builder.whereIn(where.column as any, where.value, where.boolean);
    } else if (where.operator === "NOT IN") {
      builder.whereNotIn(where.column as any, where.value, where.boolean);
    } else if (where.operator === "BETWEEN") {
      builder.whereBetween(where.column as any, where.value, where.boolean);
    } else if (where.operator === "IS NULL") {
      builder.whereNull(where.column as any, where.boolean);
    } else if (where.operator === "IS NOT NULL") {
      builder.whereNotNull(where.column as any, where.boolean);
    } else if (where.boolean === "or") {
      builder.orWhere(where.column as any, where.operator, where.value);
    } else {
      builder.where(where.column as any, where.operator, where.value);
    }
    return builder;
  }

  protected applyPivotWhere(builder: Builder<any>, column: string, operator: string | any, value?: any, boolean: "and" | "or" = "and"): Builder<any> {
    if (value === undefined) {
      value = operator;
      operator = "=";
    }
    const entry = { column: `${this.table}.${column}`, operator, value, boolean };
    this.pivotWheres.push(entry);
    return this.applyStoredPivotWhere(builder, entry);
  }

  wherePivot<K extends string>(column: K, operator: string | any, value?: any): MorphToMany<T, N, RelatedFixed, PivotFixed | StripTablePrefix<K>> {
    this.applyPivotWhere(this.builder, column, operator, value, "and");
    return this as MorphToMany<T, N, RelatedFixed, PivotFixed | StripTablePrefix<K>>;
  }

  orWherePivot<K extends string>(column: K, operator: string | any, value?: any): MorphToMany<T, N, RelatedFixed, PivotFixed | StripTablePrefix<K>> {
    this.applyPivotWhere(this.builder, column, operator, value, "or");
    return this as MorphToMany<T, N, RelatedFixed, PivotFixed | StripTablePrefix<K>>;
  }

  wherePivotIn<K extends string>(column: K, values: any[]): MorphToMany<T, N, RelatedFixed, PivotFixed | StripTablePrefix<K>> {
    this.applyPivotWhere(this.builder, column, "IN", values, "and");
    return this as MorphToMany<T, N, RelatedFixed, PivotFixed | StripTablePrefix<K>>;
  }

  wherePivotNotIn<K extends string>(column: K, values: any[]): MorphToMany<T, N, RelatedFixed, PivotFixed | StripTablePrefix<K>> {
    this.applyPivotWhere(this.builder, column, "NOT IN", values, "and");
    return this as MorphToMany<T, N, RelatedFixed, PivotFixed | StripTablePrefix<K>>;
  }

  orWherePivotIn<K extends string>(column: K, values: any[]): MorphToMany<T, N, RelatedFixed, PivotFixed | StripTablePrefix<K>> {
    this.applyPivotWhere(this.builder, column, "IN", values, "or");
    return this as MorphToMany<T, N, RelatedFixed, PivotFixed | StripTablePrefix<K>>;
  }

  wherePivotNull<K extends string>(column: K): MorphToMany<T, N, RelatedFixed, PivotFixed | StripTablePrefix<K>> {
    this.applyPivotWhere(this.builder, column, "IS NULL", null, "and");
    return this as MorphToMany<T, N, RelatedFixed, PivotFixed | StripTablePrefix<K>>;
  }

  wherePivotNotNull<K extends string>(column: K): MorphToMany<T, N, RelatedFixed, PivotFixed | StripTablePrefix<K>> {
    this.applyPivotWhere(this.builder, column, "IS NOT NULL", null, "and");
    return this as MorphToMany<T, N, RelatedFixed, PivotFixed | StripTablePrefix<K>>;
  }

  orWherePivotNull<K extends string>(column: K): MorphToMany<T, N, RelatedFixed, PivotFixed | StripTablePrefix<K>> {
    this.applyPivotWhere(this.builder, column, "IS NULL", null, "or");
    return this as MorphToMany<T, N, RelatedFixed, PivotFixed | StripTablePrefix<K>>;
  }

  wherePivotBetween<K extends string>(column: K, values: [any, any]): MorphToMany<T, N, RelatedFixed, PivotFixed | StripTablePrefix<K>> {
    this.applyPivotWhere(this.builder, column, "BETWEEN", values, "and");
    return this as MorphToMany<T, N, RelatedFixed, PivotFixed | StripTablePrefix<K>>;
  }

  withPivotValue<K extends string>(column: K, value: any): MorphToMany<T, N, RelatedFixed, PivotFixed | StripTablePrefix<K>> {
    this.applyPivotWhere(this.builder, column, "=", value, "and");
    return this as MorphToMany<T, N, RelatedFixed, PivotFixed | StripTablePrefix<K>>;
  }

  where<K extends string>(column: K, operatorOrValue: any, value?: any): MorphToMany<T, N, RelatedFixed | StripTablePrefix<K>, PivotFixed> {
    const args: any[] = value !== undefined ? [column, operatorOrValue, value] : [column, operatorOrValue];
    const operator = value !== undefined ? operatorOrValue : "=";
    const whereValue = value !== undefined ? value : operatorOrValue;
    this.whereConstraints.push({
      column: String(column),
      operator,
      value: whereValue,
      boolean: "and",
    });
    this.extraConstraints.push({ apply: (b: Builder<any>) => (b.where as any)(...args), aggregateSafe: true });
    (this.builder.where as any)(...args);
    return this as MorphToMany<T, N, RelatedFixed | StripTablePrefix<K>, PivotFixed>;
  }

  withPivot(...columns: (string | string[])[]): this {
    const cols = columns.flat();
    this.pivotColumns.push(...cols);
    this.builder.addSelect(...cols.map((c) => `${this.table}.${c}`) as any);
    return this;
  }

  withTimestamps(): this {
    this.pivotTimestamps = true;
    this.builder.addSelect(`${this.table}.created_at` as any, `${this.table}.updated_at` as any);
    return this;
  }

  protected getPivotColumnName(column: string): string {
    return column.startsWith(`${this.table}.`) ? column.slice(this.table.length + 1) : column;
  }

  protected getPivotSelectColumns(): string[] {
    const pivot = [...this.pivotColumns];
    if (this.pivotTimestamps) {
      pivot.push("created_at", "updated_at");
    }
    return pivot.map((col) => `${this.table}.${col}`);
  }

  protected attachPivotToResults(results: Collection<any>): void {
    if (this.pivotColumns.length === 0 && !this.pivotTimestamps) return;
    const pivotCols = this.getPivotSelectColumns().map((col) => col.replace(`${this.table}.`, ""));
    for (const result of results) {
      const pivot: Record<string, any> = {};
      for (const col of pivotCols) {
        pivot[col] = (result.$attributes as any)[col];
        delete (result.$attributes as any)[col];
      }
      (result as any)[this.pivotAccessor] = pivot;
    }
  }

  protected getDefaultPivotAttributes(): Record<string, any> {
    const defaults: Record<string, any> = {};

    for (const where of this.pivotWheres) {
      if (where.boolean !== "and") continue;

      const column = this.getPivotColumnName(where.column);
      if (where.operator === "=") {
        defaults[column] = where.value;
      } else if (where.operator === "IS NULL") {
        defaults[column] = null;
      }
    }

    return defaults;
  }

  protected getDefaultAttributes(): Record<string, any> {
    const defaults: Record<string, any> = {};

    for (const where of this.whereConstraints) {
      if (where.boolean !== "and") continue;

      const column = where.column.includes(".") ? where.column.split(".").pop()! : where.column;
      if (where.operator === "=") {
        defaults[column] = where.value;
      } else if (where.operator === "IS NULL") {
        defaults[column] = null;
      }
    }

    return defaults;
  }

  protected applyRelatedDefaults(model: T): void {
    const defaults = this.getDefaultAttributes();
    for (const [key, value] of Object.entries(defaults)) {
      model.setAttribute(key as any, value);
    }
  }

  protected applyExtraConstraints(): void {
    this.applyExtraConstraintsTo(this.builder as Builder<any>);
  }

  /** See `Relation.applyExtraConstraintsTo`: existence queries need the same replay. */
  protected applyExtraConstraintsTo(query: Builder<any>): void {
    for (const constraint of this.extraConstraints) constraint.apply(query);
  }

  /** See `Relation.applyAggregateSafeConstraintsTo`. */
  protected applyAggregateSafeConstraintsTo(query: Builder<any>): void {
    for (const constraint of this.extraConstraints) {
      if (constraint.aggregateSafe) constraint.apply(query);
    }
  }

  protected addConstraints(): void {
    const relatedTable = this.related.getQualifiedTable(this.parent.getConnection());
    const pivotSelect = this.getPivotSelectColumns();
    this.builder.select(`${relatedTable}.*`, ...pivotSelect);
    this.builder.join(
      this.qualifiedPivotTable(),
      `${this.table}.${this.relatedPivotKey}`,
      "=",
      `${relatedTable}.${this.relatedKey}`
    );
    this.builder.where(`${this.table}.${this.foreignPivotKey}`, this.parent.getAttribute(this.parentKey));
    this.builder.where(`${this.table}.${this.name}_type`, this.morphType);
  }

  getQuery(): Builder<T> {
    return this.builder;
  }

  addEagerConstraints(models: Model[]): void {
    const keys = models.map((m) => m.getAttribute(this.parentKey)).filter((k) => k != null);
    if (keys.length === 0) { this.$skipEagerQuery = true; return; }
    const relatedTable = this.related.getQualifiedTable(this.parent.getConnection());
    this.builder = this.decoratePivotQuery((this.related as any).on(this.parent.getConnection()));
    const pivotSelect = this.getPivotSelectColumns();
    this.builder.select(`${relatedTable}.*`, `${this.table}.${this.foreignPivotKey}`, ...pivotSelect);
    this.builder.join(
      this.qualifiedPivotTable(),
      `${this.table}.${this.relatedPivotKey}`,
      "=",
      `${relatedTable}.${this.relatedKey}`
    );
    this.builder.whereIn(`${this.table}.${this.foreignPivotKey}`, keys);
    this.builder.where(`${this.table}.${this.name}_type`, this.morphType);
    for (const where of this.pivotWheres) {
      this.applyStoredPivotWhere(this.builder, where);
    }
    this.applyExtraConstraints();
  }

  async getEager(): Promise<Collection<any>> {
    if (this.$skipEagerQuery) return new Collection<any>([]);
    const results = await this.builder.get();
    this.attachPivotToResults(results);
    return results;
  }

  match(models: Model[], results: Collection<any>, relationName: string): void {
    const dictionary: Record<string, any[]> = {};
    for (const result of results) {
      const key = (result.$attributes as any)[this.foreignPivotKey];
      if (!dictionary[key]) dictionary[key] = [];
      delete (result.$attributes as any)[this.foreignPivotKey];
      dictionary[key].push(result);
    }
    for (const model of models) {
      const key = model.getAttribute(this.parentKey);
      model.setRelation(relationName, new Collection(dictionary[String(key)] || []));
    }
  }

  async getResults(): Promise<Collection<T>> {
    const results = await this.builder.get();
    this.attachPivotToResults(results);
    return results;
  }

  get(): Promise<Collection<T>> { return this.getResults(); }

  protected async pivotPrimaryKeyColumn(primaryKey: string): Promise<PrimaryKeyColumn | null> {
    return await Schema.getColumn(this.qualifiedPivotTable(), primaryKey, this.parent.getConnection());
  }

  protected async shouldAutoGeneratePivotPrimaryKey(primaryKey: string): Promise<boolean> {
    return shouldGeneratePrimaryKeyForColumn(await this.pivotPrimaryKeyColumn(primaryKey));
  }

  async attach(ids: any | any[], attributes?: Record<string, any>): Promise<any> {
    const idList = Array.isArray(ids) ? ids : [ids];
    const pivotAttributes = {
      ...attributes,
      ...this.getDefaultPivotAttributes(),
    };
    const records = idList.map((id) => ({
      [this.foreignPivotKey]: this.parent.getAttribute(this.parentKey),
      [this.relatedPivotKey]: id,
      [`${this.name}_type`]: this.morphType,
      ...pivotAttributes,
    }));

    const pk = "id";
    const needsUuid = await this.shouldAutoGeneratePivotPrimaryKey(pk);

    for (const record of records) {
      if (needsUuid && !record[pk]) {
        record[pk] = crypto.randomUUID();
      }
    }

    const connection = this.parent.getConnection();
    const builder = new Builder(connection, this.qualifiedPivotTable());

    if (idList.length === 1) {
      if (needsUuid) {
        await builder.insert(records[0]);
        return records[0][pk];
      }
      return await insertAndResolveKey(
        connection,
        this.qualifiedPivotTable(),
        records[0],
        pk,
        await this.pivotPrimaryKeyColumn(pk)
      );
    }

    await builder.insert(records);
    return;
  }

  async save(model: T, attributes?: Record<string, any>): Promise<T> {
    this.applyRelatedDefaults(model);
    await model.save();
    await this.attach(model.getAttribute(this.relatedKey), attributes);
    return model;
  }

  async saveMany(models: T[], attributes?: Record<string, any>): Promise<T[]> {
    const saved: T[] = [];
    for (const model of models) {
      saved.push(await this.save(model, attributes));
    }
    return saved;
  }

  async create(attributes: ModelMassAssignmentInputWithout<T, RelatedFixed>, pivotAttributes?: Record<string, any>): Promise<T> {
    const instance = newRelatedInstance<T>(this.parent, this.related, attributes);
    this.applyRelatedDefaults(instance);
    await instance.save();
    await this.attach(instance.getAttribute(this.relatedKey), pivotAttributes);
    return instance;
  }

  async createQuietly(attributes: ModelMassAssignmentInputWithout<T, RelatedFixed>, pivotAttributes?: Record<string, any>): Promise<T> {
    const instance = newRelatedInstance<T>(this.parent, this.related, attributes);
    this.applyRelatedDefaults(instance);
    await instance.save({ events: false });
    await this.attach(instance.getAttribute(this.relatedKey), pivotAttributes);
    return instance;
  }

  async createMany(records: ModelMassAssignmentInputWithout<T, RelatedFixed>[], pivotAttributes?: Record<string, any>): Promise<T[]> {
    const created: T[] = [];
    for (const record of records) {
      created.push(await this.create(record, pivotAttributes));
    }
    return created;
  }

  async createManyQuietly(records: ModelMassAssignmentInputWithout<T, RelatedFixed>[], pivotAttributes?: Record<string, any>): Promise<T[]> {
    const created: T[] = [];
    for (const record of records) {
      created.push(await this.createQuietly(record, pivotAttributes));
    }
    return created;
  }

  getRelatedModelConstructor(): ModelConstructor {
    return this.related;
  }

  getRelatedKeyName(): string {
    return this.relatedKey;
  }

  getRelatedPivotKeyName(): string {
    return this.relatedPivotKey;
  }

  qualifyRelatedColumn(column: string): string {
    return column.includes(".") ? column : `${this.related.getQualifiedTable(this.parent.getConnection())}.${column}`;
  }

  protected newExistenceQuery(parentTable: string, aggregate: string, callback?: (query: Builder<any>) => void | Builder<any>): Builder<any> {
    const relatedTable = this.related.getQualifiedTable(this.parent.getConnection());
    const query = this.decoratePivotQuery((this.related as any).on(this.parent.getConnection()).selectRaw(aggregate));
    query.join(
      this.qualifiedPivotTable(),
      `${this.table}.${this.relatedPivotKey}`,
      "=",
      `${relatedTable}.${this.relatedKey}`
    );
    query.whereColumn(`${this.table}.${this.foreignPivotKey}`, "=", `${parentTable}.${this.parentKey}`);
    query.where(`${this.table}.${this.name}_type`, this.morphType);
    for (const where of this.pivotWheres) {
      this.applyStoredPivotWhere(query, where);
    }
    this.applyAggregateSafeConstraintsTo(query);
    if (callback) callback(query);
    return query;
  }

  getRelationExistenceSql(parentQuery: Builder<any>, callback?: (query: Builder<any>) => void | Builder<any>): string {
    return this.newExistenceQuery(parentQuery.tableName, "1", callback).toSql();
  }

  getRelationCountSql(parentQuery: Builder<any>, callback?: (query: Builder<any>) => void | Builder<any>): string {
    return this.getRelationAggregateSql(parentQuery, "COUNT(*)", callback);
  }

  getRelationAggregateSql(parentQuery: Builder<any>, aggregate: string, callback?: (query: Builder<any>) => void | Builder<any>): string {
    return this.newExistenceQuery(parentQuery.tableName, aggregate, callback).toSql();
  }
}
