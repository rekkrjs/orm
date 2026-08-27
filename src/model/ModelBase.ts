import { Builder } from "../query/Builder.js";
import { Collection } from "../support/Collection.js";
import { snakeCase } from "../utils.js";
import { BelongsToMany } from "./BelongsToMany.js";
import { MorphTo, MorphOne, MorphMany, MorphToMany } from "./MorphRelations.js";
export type {
  ModelConstructor,
  GlobalScope,
  EagerLoadConstraint,
  EagerLoadDefinition,
  EagerLoadInput,
  MorphEagerLoadMap,
  MorphCountLoadMap,
  ModelAttributes,
  ModelColumn,
  ModelColumnValue,
  ModelAttributeInput,
  ModelAttributeInputWithout,
  ModelMassAssignable,
  ModelMassAssignmentAttributes,
  ModelMassAssignmentInput,
  ModelMassAssignmentInputWithout,
  MorphRelationInput,
  StripTablePrefix,
  ModelInstanceAttributeKeys,
  BulkModelOptions,
  SaveOptions,
  CastDefinition,
  CastsAttributes,
  AttributeDefinition,
  AccessorMap,
  LiteralUnion,
} from "./ModelTypes.js";
import type {
  ModelConstructor,
  EagerLoadConstraint,
  EagerLoadDefinition,
  EagerLoadInput,
  MorphEagerLoadMap,
  MorphCountLoadMap,
  ModelAttributes,
  ModelColumn,
  ModelColumnValue,
  ModelAttributeInputWithout,
  ModelMassAssignmentInput,
  ModelMassAssignmentInputWithout,
  CastDefinition,
  CastsAttributes,
  AttributeDefinition,
  AccessorMap,
  GlobalScope,
  BulkModelOptions,
  SaveOptions,
  StripTablePrefix,
} from "./ModelTypes.js";

// Model class reference - set by Model.ts when it loads to avoid circular dependency
let _ModelClass: any = null;
export function setModelClass(ctor: any): void { _ModelClass = ctor; }
export function getModelClass(): any { return _ModelClass; }

// Forward reference to Model class (used in types below)
interface ModelType<T extends Record<string, any> = any> {
  $attributes: T;
  $original: Partial<T>;
  $changes: Partial<T>;
  $exists: boolean;
  $relations: Record<string, any>;
  $casts: Record<string, CastDefinition>;
  $castCache: Record<string, any>;
  $mergedCasts: Record<string, CastDefinition>;
  $dirtyKeys?: Set<string>;
  $connection?: any;
  $hidden: string[];
  $visible: string[];
  $appends: string[];
  $wasRecentlyCreated: boolean;
  getAttribute(key: string): any;
  setAttribute(key: string, value: any): void;
  setConnection(connection: any): this;
  getConnection(): any;
  getModelConstructor(): any;
  fill(attributes: Partial<T>): this;
  forceFill(attributes: Partial<T>): this;
  save(options?: any): Promise<this>;
  setRelation(name: string, value: any): void;
  getRelation(name: string): any;
  isInstanceOf<M extends ModelConstructor<any>>(modelClass: M): this is InstanceType<M>;
}

type BaseModelInstanceKey =
  | "$attributes" | "$original" | "$changes" | "$exists" | "$relations"
  | "$casts" | "$castCache" | "$mergedCasts" | "$dirtyKeys" | "$connection" | "$hidden" | "$visible" | "$appends"
  | "$wasRecentlyCreated" | "fill" | "setConnection" | "getConnection"
  | "forceFill"
  | "isFillable" | "getAttribute" | "setAttribute" | "castAttribute"
  | "serializeCastAttribute" | "mergeCasts" | "getDirty" | "isDirty" | "isClean"
  | "wasChanged" | "getChanges" | "getOriginal" | "syncOriginal" | "discardChanges"
  | "replicate" | "makeHidden" | "makeHiddenIf"
  | "makeVisible" | "makeVisibleIf" | "append" | "setAppends" | "getAppends" | "save" | "update" | "updateQuietly"
  | "updateTimestamps" | "touch" | "increment" | "decrement" | "is" | "isNot" | "isInstanceOf"
  | "load" | "loadMissing" | "loadMorph" | "loadCount" | "loadSum" | "loadAvg" | "loadMin"
  | "loadMax" | "delete" | "saveQuietly" | "deleteQuietly" | "restore"
  | "forceDelete" | "fresh" | "refresh" | "toJSON" | "json" | "toString" | "freshTimestamp"
  | "setRelation" | "getRelation" | "hasMany" | "belongsTo" | "hasOne"
  | "hasManyThrough" | "hasOneThrough" | "belongsToMany" | "morphTo" | "morphOne"
  | "morphMany" | "morphToMany" | "morphedByMany";

export type ModelRelationValue =
  | Relation<any>
  | MorphTo<any>
  | MorphOne<any>
  | MorphMany<any>
  | MorphToMany<any, any, any, any>
  | BelongsToMany<any, any, any>;

export type MorphToRelationName<T> = Extract<{
  [K in Exclude<keyof T, BaseModelInstanceKey>]-?: T[K] extends (...args: any[]) => MorphTo<any> ? K : never;
}[Exclude<keyof T, BaseModelInstanceKey>], string>;

export type BelongsToRelationName<T> = Extract<{
  [K in Exclude<keyof T, BaseModelInstanceKey>]-?: T[K] extends (...args: any[]) => BelongsTo<any> ? K : never;
}[Exclude<keyof T, BaseModelInstanceKey>], string>;

export type ChildRelationName<T> = Extract<{
  [K in Exclude<keyof T, BaseModelInstanceKey>]-?: T[K] extends (...args: any[]) => HasMany<any> | HasOne<any> | MorphMany<any> | MorphOne<any> ? K : never;
}[Exclude<keyof T, BaseModelInstanceKey>], string>;

export type AttachedToRelationName<T> = Extract<{
  [K in Exclude<keyof T, BaseModelInstanceKey>]-?: T[K] extends (...args: any[]) => BelongsToMany<any, any, any> | MorphToMany<any, any, any, any> ? K : never;
}[Exclude<keyof T, BaseModelInstanceKey>], string>;

export type ModelRelationName<T> = Extract<{
  [K in Exclude<keyof T, BaseModelInstanceKey>]-?: T[K] extends (...args: any[]) => ModelRelationValue ? K : never;
}[Exclude<keyof T, BaseModelInstanceKey>], string>;

type RelationReturnModel<F> =
  F extends (...args: any[]) => BelongsToMany<infer R, any, any> ? R
  : F extends (...args: any[]) => MorphToMany<infer R, any, any, any> ? R
  : F extends (...args: any[]) => Relation<infer R> ? R
  : ModelType;

export type RelationRelatedModel<T, R extends string> =
  R extends keyof T
    ? T[R] extends (...args: any[]) => ModelRelationValue
      ? RelationReturnModel<T[R]>
      : ModelType
    : ModelType;

type RelationReturnType<F> = F extends (...args: any[]) => infer R ? R : never;
type PrevDepth = [never, 0, 1, 2, 3];
type IsSameType<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false;

export type NestedRelationPath<T, D extends number = 3> = [D] extends [0] ? never : {
  [K in Exclude<keyof T, BaseModelInstanceKey>]: T[K] extends (...args: any[]) => ModelRelationValue
    ? K extends string
      ? IsSameType<RelationReturnModel<T[K]>, T> extends true
        ? K
        : K | `${K}.${string & NestedRelationPath<RelationReturnModel<T[K]>, PrevDepth[D]>}`
      : never
    : never;
}[Exclude<keyof T, BaseModelInstanceKey>];

type PathToModel<T, Path extends string> =
  Path extends `${infer Head}.${infer Tail}`
    ? Head extends keyof T
      ? T[Head] extends (...args: any[]) => ModelRelationValue
        ? PathToModel<RelationReturnModel<T[Head]>, Tail>
        : never
      : never
    : Path extends keyof T
      ? T[Path] extends (...args: any[]) => ModelRelationValue
        ? RelationReturnModel<T[Path]>
        : never
      : never;

export interface PivotQueryBuilder {
  wherePivot(column: string, operator: string | any, value?: any): any;
  orWherePivot(column: string, operator: string | any, value?: any): any;
  wherePivotIn(column: string, values: any[]): any;
  wherePivotNotIn(column: string, values: any[]): any;
  orWherePivotIn(column: string, values: any[]): any;
  wherePivotNull(column: string): any;
  wherePivotNotNull(column: string): any;
  orWherePivotNull(column: string): any;
  wherePivotBetween(column: string, values: [any, any]): any;
  withPivotValue(column: string, value: any): any;
}

type RelationInstanceAtPath<T, Path extends string> =
  Path extends `${infer Head}.${infer Tail}`
    ? Head extends keyof T
      ? T[Head] extends (...args: any[]) => ModelRelationValue
        ? RelationInstanceAtPath<RelationReturnModel<T[Head]>, Tail>
        : never
      : never
    : Path extends keyof T
      ? T[Path] extends (...args: any[]) => ModelRelationValue
        ? RelationReturnType<T[Path]>
        : never
      : never;

type PivotRelationValue = BelongsToMany<any, any, any> | MorphToMany<any, any, any, any>;

export type RelationConstraintQuery<T, P extends string> =
  Builder<PathToModel<T, P>> &
  (RelationInstanceAtPath<T, P> extends PivotRelationValue ? PivotQueryBuilder : {});

export type TypedConstraintCallback<T, P extends string> = (query: RelationConstraintQuery<T, P>) => void | Builder<any> | RelationConstraintQuery<T, P>;
export type MorphToConstraintCallback = (query: MorphTo<any>) => void | MorphTo<any>;

type ConstraintCallbackForPath<T, P extends string> =
  RelationInstanceAtPath<T, P> extends MorphTo<any>
    ? MorphToConstraintCallback
    : TypedConstraintCallback<T, P>;

export type AggregateAlias<RelationName extends string, Alias extends string | undefined, DefaultSuffix extends string> =
  Alias extends string ? Alias : `${RelationName}_${DefaultSuffix}`;

export type AggregateLoaded<T, Alias extends string, Value> = T & Record<Alias, Value>;

export type AggregateValueForRelation<T, R extends string, Column extends string> = ModelColumnValue<RelationRelatedModel<T, R>, Column>;

export type TypedConstraintMap<T> = Partial<{
  [P in NestedRelationPath<T>]: ConstraintCallbackForPath<T, P>;
}>;

export type TypedConstraintSelection<T, K extends string & NestedRelationPath<T>> = {
  [P in K]: ConstraintCallbackForPath<T, P>;
};

export type ExistsRelationPath<T> = NestedRelationPath<T> | `${NestedRelationPath<T>} as ${string}`;

type RelationPathFromExistsKey<Key extends string> = Key extends `${infer Relation} as ${string}` ? Relation : Key;

export type TypedExistsConstraintMap<T> = Partial<{
  [K in ExistsRelationPath<T>]: TypedConstraintCallback<T, RelationPathFromExistsKey<K> & NestedRelationPath<T>>;
}>;

export type TypedEagerLoad<T> =
  | (string & NestedRelationPath<T>)
  | { name: string & NestedRelationPath<T>; constraint?: EagerLoadConstraint }
  | TypedConstraintMap<T>;

export type StrictTypedEagerLoad<T> =
  | (string & NestedRelationPath<T>)
  | { name: string & NestedRelationPath<T>; constraint?: EagerLoadConstraint }
  | TypedConstraintMap<T>;

type LoadedRelationType<F> =
  F extends (...args: any[]) => HasMany<infer R, any> ? Collection<R>
  : F extends (...args: any[]) => HasOne<infer R> ? R | null
  : F extends (...args: any[]) => BelongsTo<infer R> ? R | null
  : F extends (...args: any[]) => BelongsToMany<infer R, any, any> ? Collection<R>
  : F extends (...args: any[]) => MorphMany<infer R> ? Collection<R>
  : F extends (...args: any[]) => MorphOne<infer R> ? R | null
  : F extends (...args: any[]) => MorphToMany<infer R, any, any, any> ? Collection<R>
  : F extends (...args: any[]) => Relation<infer R> ? Collection<R> | R
  : unknown;

type LoadedTypeWithNested<F, ElemType> =
  F extends (...args: any[]) => HasMany<any, any> ? Collection<ElemType>
  : F extends (...args: any[]) => HasOne<any> ? ElemType | null
  : F extends (...args: any[]) => BelongsTo<any> ? ElemType | null
  : F extends (...args: any[]) => BelongsToMany<any, any, any> ? Collection<ElemType>
  : F extends (...args: any[]) => MorphMany<any> ? Collection<ElemType>
  : F extends (...args: any[]) => MorphOne<any> ? ElemType | null
  : F extends (...args: any[]) => MorphToMany<any, any, any, any> ? Collection<ElemType>
  : unknown;

type RelModelOf<F> =
  F extends (...args: any[]) => HasMany<infer R, any> ? R
  : F extends (...args: any[]) => HasOne<infer R> ? R
  : F extends (...args: any[]) => BelongsTo<infer R> ? R
  : F extends (...args: any[]) => BelongsToMany<infer R, any, any> ? R
  : F extends (...args: any[]) => MorphMany<infer R> ? R
  : F extends (...args: any[]) => MorphOne<infer R> ? R
  : F extends (...args: any[]) => MorphToMany<infer R, any, any, any> ? R
  : unknown;

type CallbackResultModel<CB, Fallback> =
  NonNullable<CB> extends (...args: any[]) => Builder<any, infer TResult> ? TResult : Fallback;

type TopLevelKey<S extends string> = S extends `${infer Head}.${string}` ? Head : S;

export type ExtractStringPaths<R> =
  R extends string ? R
  : R extends ReadonlyArray<infer Item> ? ExtractStringPaths<Item>
  : R extends object ? keyof R & string
  : never;

type WithJsonMethods<T> = Omit<T, "json" | "toJSON"> & {
  toJSON(): ModelJson<T>;
  json(): ModelJson<T>;
  json(options: { relations?: boolean }): ModelJson<T>;
  json<P extends DotPaths<ModelJson<T>>>(...paths: P[]): DeepPick<ModelJson<T>, P>;
};

type NestedRelationPaths<Paths extends string, Key extends string> =
  Paths extends `${Key}.${infer Tail}` ? Tail : never;

type LoadedRelationValueForPaths<F, Paths extends string> =
  F extends (...args: any[]) => HasMany<infer R, any> ? Collection<WithLoadedRelations<R, Paths>>
  : F extends (...args: any[]) => HasOne<infer R> ? WithLoadedRelations<R, Paths> | null
  : F extends (...args: any[]) => BelongsTo<infer R> ? WithLoadedRelations<R, Paths> | null
  : F extends (...args: any[]) => BelongsToMany<infer R, any, any> ? Collection<WithLoadedRelations<R, Paths>>
  : F extends (...args: any[]) => MorphMany<infer R> ? Collection<WithLoadedRelations<R, Paths>>
  : F extends (...args: any[]) => MorphOne<infer R> ? WithLoadedRelations<R, Paths> | null
  : F extends (...args: any[]) => MorphToMany<infer R, any, any, any> ? Collection<WithLoadedRelations<R, Paths>>
  : F extends (...args: any[]) => MorphTo<infer R> ? WithLoadedRelations<R, Paths> | null
  : F extends (...args: any[]) => Relation<infer R> ? Collection<WithLoadedRelations<R, Paths>> | WithLoadedRelations<R, Paths>
  : never;

type WithLoadedRelationsShape<T, Paths extends string> =
  Omit<T, TopLevelKey<Paths> & keyof T> & {
    [K in TopLevelKey<Paths> & keyof T]: T[K] extends (...args: any[]) => ModelRelationValue
      ? LoadedRelationValueForPaths<T[K], NestedRelationPaths<Paths, Extract<K, string>>>
      : T[K];
  };

export type WithLoadedRelations<T, Paths extends string> = WithJsonMethods<WithLoadedRelationsShape<T, Paths>>;

export type WithRelationCount<T, RelationName extends string, Alias extends string | undefined = undefined> =
  WithJsonMethods<T & {
    [K in Alias extends string ? Alias : `${RelationName}_count`]: number;
  }>;

export type WithRelationExists<T, RelationName extends string, Alias extends string | undefined = undefined> =
  WithJsonMethods<T & {
    [K in Alias extends string ? Alias : `${RelationName}_exists`]: boolean;
  }>;

type RelationExistsAlias<Key extends string> = Key extends `${string} as ${infer Alias}` ? Alias : `${Key}_exists`;

export type WithRelationExistsMap<T, R extends object> =
  WithJsonMethods<T & {
    [K in keyof R & string as RelationExistsAlias<K>]: boolean;
  }>;

export type AggregateConstraint<T, R extends string> = TypedConstraintCallback<T, R & NestedRelationPath<T>>;
export type AggregateColumn<T, R extends string> = ModelColumn<RelationRelatedModel<T, R>>;

type AggregateLoadRelationName<T> = [ModelRelationName<T>] extends [never] ? string : string & ModelRelationName<T>;
type AggregateLoadColumn<T, R extends string> = [ModelRelationName<T>] extends [never] ? string : AggregateColumn<T, R & ModelRelationName<T>>;
type AggregateLoadConstraint<T, R extends string> = [ModelRelationName<T>] extends [never] ? EagerLoadConstraint : AggregateConstraint<T, R & ModelRelationName<T>>;
type AggregateLoadValue<T, R extends string, C extends string> = [ModelRelationName<T>] extends [never] ? any : AggregateValueForRelation<T, R & ModelRelationName<T>, C>;

type WithLoadedRelationsFromConstraintMapShape<T, R extends object> =
  Omit<T, keyof R & keyof T> & {
    [K in keyof R & keyof T & string]: T[K] extends (...args: any[]) => ModelRelationValue
      ? LoadedTypeWithNested<T[K], CallbackResultModel<R[K], RelModelOf<T[K]>>>
      : T[K];
  };

export type WithLoadedRelationsFromConstraintMap<T, R extends object> = WithJsonMethods<WithLoadedRelationsFromConstraintMapShape<T, R>>;

type JsonRelationKeys<T> = Extract<{
  [K in Exclude<keyof T, BaseModelInstanceKey>]-?:
    T[K] extends (...args: any[]) => any ? never
    : NonNullable<T[K]> extends Collection<any> ? K
    : NonNullable<T[K]> extends { $attributes: Record<string, any> } ? K
    : never;
}[Exclude<keyof T, BaseModelInstanceKey>], string>;

type JsonExtraKeys<T> = Extract<{
  [K in Exclude<keyof T, BaseModelInstanceKey | keyof ModelAttributes<T> | JsonRelationKeys<T>>]-?:
    T[K] extends (...args: any[]) => any ? never
    : NonNullable<T[K]> extends Collection<any> ? never
    : NonNullable<T[K]> extends { $attributes: Record<string, any> } ? never
    : K;
}[Exclude<keyof T, BaseModelInstanceKey | keyof ModelAttributes<T> | JsonRelationKeys<T>>], string>;

export type LoadMorphRelationName<T> = MorphToRelationName<T> | JsonRelationKeys<T>;

type JsonRelationValue<T> =
  T extends { toJSON(): infer R } ? R
  : T;

export type ModelJson<T> =
  Omit<ModelAttributes<T>, JsonRelationKeys<T>> &
  { [K in JsonRelationKeys<T>]: JsonRelationValue<T[K]>; } &
  { [K in JsonExtraKeys<T>]: T[K]; };

type DirectSelectionSource<S extends string> =
  S extends `${infer Source} as ${string}` ? StripTablePrefix<Source>
  : S extends `${infer Source} AS ${string}` ? StripTablePrefix<Source>
  : StripTablePrefix<S>;

type DirectSelectionKey<S extends string> =
  S extends `${string} as ${infer Alias}` ? Alias
  : S extends `${string} AS ${infer Alias}` ? Alias
  : StripTablePrefix<S>;

type DirectSelectionField<T, S extends string> = {
  [K in DirectSelectionKey<S>]: DirectSelectionSource<S> extends keyof ModelAttributes<T>
    ? ModelAttributes<T>[DirectSelectionSource<S>]
    : unknown;
};

type UnionToIntersection<T> =
  (T extends unknown ? (value: T) => void : never) extends (value: infer I) => void ? I : never;

type DirectSelectedAttributes<T, S extends string> =
  string extends S ? Record<string, unknown>
  : Extract<S, "*" | `${string}.*`> extends never
    ? UnionToIntersection<S extends string ? DirectSelectionField<T, S> : never>
    : ModelAttributes<T>;

/** Plain JSON attributes plus query-added aggregates, without appends or relations. */
export type DirectJson<TResult, TSelected extends string = "*", TWith = TResult> = {
  [K in keyof (
    DirectSelectedAttributes<TResult, TSelected>
    & Pick<TWith, Exclude<keyof TWith, keyof TResult>>
  )]: (
    DirectSelectedAttributes<TResult, TSelected>
    & Pick<TWith, Exclude<keyof TWith, keyof TResult>>
  )[K];
};

// ─── Dot-path type utilities ──────────────────────────────────────────────────

type Prev<N extends number> = [never, 0, 1, 2, 3][N];

type RootKey<P extends string> = P extends `${infer R}.${string}` ? R : P;
type TailPath<P extends string> = P extends `${string}.${infer T}` ? T : never;

/** All valid dot-paths into T up to depth D */
export type DotPaths<T, D extends number = 3> =
  [D] extends [never] ? never :
  keyof T & string | (D extends 0 ? never : {
    [K in keyof T & string]-?:
      NonNullable<T[K]> extends (infer I extends object)[]
        ? `${K}.${DotPaths<I, Prev<D>>}`
        : NonNullable<T[K]> extends object
          ? `${K}.${DotPaths<NonNullable<T[K]>, Prev<D>>}`
          : never
  }[keyof T & string]);

/** Pick a nested subset of T using dot-path strings */
export type DeepPick<T, Paths extends string> = {
  [K in RootKey<Paths> & keyof T]:
    Extract<Paths, `${K}.${string}`> extends never
      ? T[K]
      : NonNullable<T[K]> extends (infer I)[]
        ? DeepPick<I & object, TailPath<Extract<Paths, `${K}.${string}`>>>[]
          | Extract<T[K], null | undefined>
        : NonNullable<T[K]> extends object
          ? DeepPick<NonNullable<T[K]>, TailPath<Extract<Paths, `${K}.${string}`>>>
            | Extract<T[K], null | undefined>
          : T[K]
};

// ============================================================
// Helper functions
// ============================================================

function getAccessors(target: ModelType<any>): AccessorMap {
  return (Object.getPrototypeOf(target).constructor as any).accessors || {};
}

const globalScopes = new WeakMap<ModelConstructor, Map<string, GlobalScope>>();
export { globalScopes };
const globalScopesCache = new WeakMap<ModelConstructor, Map<string, GlobalScope>>();
export { globalScopesCache };

export function getGlobalScopes(model: any): Map<string, GlobalScope> {
  const cached = globalScopesCache.get(model);
  if (cached) return cached;

  const scopes = new Map<string, GlobalScope>();
  const chain: any[] = [];
  let current: any = model;
  while (current && current.prototype instanceof _ModelClass) {
    chain.unshift(current);
    current = Object.getPrototypeOf(current);
  }
  for (const item of chain) {
    const ownScopes = globalScopes.get(item);
    if (ownScopes) {
      for (const [name, scope] of ownScopes) scopes.set(name, scope);
    }
  }
  globalScopesCache.set(model, scopes);
  return scopes;
}

const relationMethodCache = new WeakMap<ModelConstructor, Map<string, Function | null>>();

export function findRelationMethod(model: any, relationName: string): Function | null {
  const ctor = model instanceof _ModelClass ? Object.getPrototypeOf(model).constructor as ModelConstructor : model;
  const cached = relationMethodCache.get(ctor);
  if (cached?.has(relationName)) return cached.get(relationName)!;

  let current = model instanceof _ModelClass ? Object.getPrototypeOf(model) : model.prototype;
  while (current && current !== _ModelClass.prototype) {
    const descriptor = Object.getOwnPropertyDescriptor(current, relationName);
    if (typeof descriptor?.value === "function") {
      const map = relationMethodCache.get(ctor) || new Map<string, Function | null>();
      map.set(relationName, descriptor.value);
      relationMethodCache.set(ctor, map);
      return descriptor.value;
    }
    current = Object.getPrototypeOf(current);
  }
  const descriptor = Object.getOwnPropertyDescriptor(_ModelClass.prototype, relationName);
  const result = typeof descriptor?.value === "function" ? descriptor.value : null;
  const map = relationMethodCache.get(ctor) || new Map<string, Function | null>();
  map.set(relationName, result);
  relationMethodCache.set(ctor, map);
  return result;
}

export async function loadAggregateResults(
  models: any[],
  queryFactory: (query: Builder<any>) => Builder<any>,
  aliases: string[]
): Promise<void> {
  const loadedModels = models.filter((model): model is ModelType => !!model);
  if (loadedModels.length === 0) return;

  const constructor = Object.getPrototypeOf(loadedModels[0]).constructor as any;
  const connection = loadedModels[0].getConnection();
  const primaryKey = constructor.primaryKey;
  const keys: any[] = [];
  const seen = new Set<string>();

  for (const model of loadedModels) {
    const key = model.getAttribute(primaryKey as any);
    if (key === null || key === undefined || key === "") continue;
    const normalized = String(key);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    keys.push(key);
  }

  if (keys.length === 0) return;

  let query = constructor.on(connection).whereIn(primaryKey as any, keys as any);
  query = queryFactory(query);
  const results = await query.get();
  const dictionary = new Map<string, any>();

  for (const result of results as any[]) {
    const key = result.getAttribute(primaryKey as any);
    if (key === null || key === undefined || key === "") continue;
    dictionary.set(String(key), result);
  }

  for (const model of loadedModels) {
    const key = model.getAttribute(primaryKey as any);
    if (key === null || key === undefined || key === "") continue;
    const result = dictionary.get(String(key));
    if (!result) continue;

    for (const alias of aliases) {
      const value = typeof result.getAttribute === "function" ? result.getAttribute(alias) : result[alias];
      (model.$attributes as any)[alias] = value;
      (model.$original as any)[alias] = value;
      delete (model.$castCache as any)[alias];
    }
  }
}

// ============================================================
// Model proxy handler
// ============================================================

export const modelProxyHandler: ProxyHandler<any> = {
  get(target, prop, receiver) {
    if (typeof prop === "string") {
      const accessors = getAccessors(target);
      if (Object.hasOwn(accessors, prop) && accessors[prop].get) {
        return accessors[prop].get!((target.$attributes as any)[prop], target.$attributes as any, target);
      }
      if (Object.hasOwn(target.$relations, prop)) return target.$relations[prop];
      if (!(prop in target) && Object.hasOwn(target.$attributes, prop)) return target.getAttribute(prop);
    }
    return Reflect.get(target, prop, receiver);
  },
  set(target, prop, value, receiver) {
    if (typeof prop === "string" && !prop.startsWith("$") && !(prop in target)) {
      const accessors = getAccessors(target);
      if (Object.hasOwn(accessors, prop) && accessors[prop].set) {
        (target.$attributes as any)[prop] = accessors[prop].set!(value, target.$attributes as any, target);
        delete target.$castCache[prop];
        return true;
      }
      target.setAttribute(prop, value);
      return true;
    }
    return Reflect.set(target, prop, value, receiver);
  },
  has(target, prop) {
    if (typeof prop === "string" && Object.hasOwn(target.$relations, prop)) return true;
    if (typeof prop === "string" && Object.hasOwn(target.$attributes, prop)) return true;
    if (typeof prop === "string") {
      const accessors = getAccessors(target);
      if (Object.hasOwn(accessors, prop)) return true;
    }
    return Reflect.has(target, prop);
  },
  getOwnPropertyDescriptor(target, prop) {
    if (typeof prop === "string" && Object.hasOwn(target.$relations, prop)) {
      return { enumerable: true, configurable: true, value: target.$relations[prop] };
    }
    if (typeof prop === "string") {
      const accessors = getAccessors(target);
      if (Object.hasOwn(accessors, prop) && accessors[prop].get) {
        return { enumerable: true, configurable: true, value: accessors[prop].get!((target.$attributes as any)[prop], target.$attributes as any, target) };
      }
    }
    if (typeof prop === "string" && Object.hasOwn(target.$attributes, prop)) {
      return { enumerable: true, configurable: true, value: target.getAttribute(prop) };
    }
    return Reflect.getOwnPropertyDescriptor(target, prop);
  },
  ownKeys(target) {
    const keys = new Set(Reflect.ownKeys(target) as string[]);
    for (const key of Object.keys(target.$relations)) {
      if (!key.startsWith("$")) keys.add(key);
    }
    const accessors = getAccessors(target);
    for (const key of Object.keys(accessors)) {
      keys.add(key);
    }
    for (const key of Object.keys(target.$attributes)) {
      if (!key.startsWith("$")) keys.add(key);
    }
    return Array.from(keys);
  },
};

// ============================================================
// Relation classes
// ============================================================

/** A constraint chained onto a relation, plus whether it may be replayed into an aggregate subquery. */
export interface RelationConstraintEntry<T extends ModelType = ModelType> {
  apply: (builder: Builder<T>) => void;
  /**
   * False for clauses that are invalid or misleading inside `SELECT COUNT(*)`
   * / `EXISTS` — see `applyAggregateSafeConstraintsTo`.
   */
  aggregateSafe: boolean;
}

export abstract class Relation<T extends ModelType = ModelType> {
  protected builder: Builder<T>;
  protected parent: ModelType;
  protected related: any;
  protected foreignKey: string;
  protected localKey: string;
  protected extraConstraints: Array<RelationConstraintEntry<T>> = [];
  protected whereConstraints: Array<{ column: string; operator: string; value: any; boolean: "and" | "or" }> = [];
  protected $skipEagerQuery = false;

  constructor(parent: ModelType, related: any, foreignKey?: string, localKey?: string) {
    this.parent = parent;
    this.related = related;
    this.builder = related.on(parent.getConnection());
    this.foreignKey = foreignKey || this.defaultForeignKey();
    this.localKey = localKey || related.primaryKey;

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

  abstract addConstraints(): void;
  abstract getResults(): Promise<T | Collection<T> | null>;
  get(): Promise<T | Collection<T> | null> { return this.getResults(); }
  abstract addEagerConstraints(models: ModelType[]): void;
  abstract getEager(): Promise<Collection<any>>;
  abstract match(models: ModelType[], results: Collection<any>, relationName: string): void;

  protected defaultForeignKey(): string {
    return `${snakeCase(getModelConstructor(this.parent).name)}_id`;
  }

  getQuery(): Builder<T> { return this.builder; }
  getForeignKeyName(): string { return this.foreignKey; }
  getLocalKeyName(): string { return this.localKey; }
  first(): Promise<T | null> { return this.builder.first(); }
  find(id: any): Promise<T | null> { return this.builder.find(id); }
  whereIn(column: string, values: any[]): this {
    this.extraConstraints.push({ apply: (b) => b.whereIn(column, values), aggregateSafe: true });
    return this;
  }
  orderBy(column: string, direction: "asc" | "desc" = "asc"): this {
    // Not aggregateSafe: ORDER BY on a plain column inside `SELECT COUNT(*)`
    // is rejected by PostgreSQL and MySQL under ONLY_FULL_GROUP_BY.
    this.extraConstraints.push({ apply: (b) => b.orderBy(column, direction), aggregateSafe: false });
    return this;
  }
  limit(value: number): this {
    // Not aggregateSafe: LIMIT inside COUNT(*) caps the result rows, not the
    // rows counted, so it silently reads as a no-op.
    this.extraConstraints.push({ apply: (b) => b.limit(value), aggregateSafe: false });
    return this;
  }
  count(): Promise<number> { return this.builder.count(); }
  pluck(column: string): Promise<any[]>;
  pluck(column: string, key: string): Promise<Record<string, any>>;
  pluck(column: string, key?: string): Promise<any> {
    return key === undefined ? this.builder.pluck(column) : this.builder.pluck(column, key as any);
  }

  getRelatedModelConstructor(): any { return this.related; }

  protected newRelatedInstance(attributes: Record<string, any> = {}): T {
    const instance = new this.related(attributes) as T;
    instance.setConnection(this.parent.getConnection());
    return instance;
  }

  qualifyRelatedColumn(column: string): string {
    return column.includes(".") ? column : `${this.related.getQualifiedTable(this.parent.getConnection())}.${column}`;
  }

  protected newExistenceQuery(parentQuery: Builder<any>, aggregate: string, callback?: (query: Builder<any>) => void | Builder<any>): Builder<any> {
    const query = (this.related as any).on(parentQuery.connection).selectRaw(aggregate);
    query.whereColumn(`${this.related.getQualifiedTable(parentQuery.connection)}.${this.foreignKey}`, "=", `${parentQuery.tableName}.${this.localKey}`);
    this.applyAggregateSafeConstraintsTo(query);
    if (callback) callback(query);
    return query;
  }

  getRelationExistenceSql(parentQuery: Builder<any>, callback?: (query: Builder<any>) => void | Builder<any>): string {
    return this.newExistenceQuery(parentQuery, "1", callback).toRawSql();
  }

  getRelationCountSql(parentQuery: Builder<any>, callback?: (query: Builder<any>) => void | Builder<any>): string {
    return this.getRelationAggregateSql(parentQuery, "COUNT(*)", callback);
  }

  getRelationAggregateSql(parentQuery: Builder<any>, aggregate: string, callback?: (query: Builder<any>) => void | Builder<any>): string {
    return this.newExistenceQuery(parentQuery, aggregate, callback).toRawSql();
  }

  where(column: any, operatorOrValue: any, value?: any): this {
    const args: any[] = value !== undefined ? [column, operatorOrValue, value] : [column, operatorOrValue];
    const operator = value !== undefined ? operatorOrValue : "=";
    const whereValue = value !== undefined ? value : operatorOrValue;
    this.whereConstraints.push({ column: String(column), operator, value: whereValue, boolean: "and" });
    this.extraConstraints.push({ apply: (b) => (b.where as any)(...args), aggregateSafe: true });
    (this.builder.where as any)(...args);
    return this;
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
    this.applyExtraConstraintsTo(this.builder);
  }

  /**
   * Replays the constraints chained onto the relation (`->where(...)`,
   * `->whereIn(...)`, ...) onto an arbitrary builder. Existence queries build a
   * fresh builder, so without this `withCount()`/`has()` would aggregate over
   * every related row while `with()` returns only the constrained ones.
   */
  protected applyExtraConstraintsTo(query: Builder<any>): void {
    for (const constraint of this.extraConstraints) constraint.apply(query as Builder<T>);
  }

  /**
   * Same replay, minus the clauses that do not belong inside an aggregate or
   * EXISTS subquery — `ORDER BY` on a plain column is invalid next to
   * `COUNT(*)`, and `LIMIT` there caps result rows rather than counted rows.
   */
  protected applyAggregateSafeConstraintsTo(query: Builder<any>): void {
    for (const constraint of this.extraConstraints) {
      if (constraint.aggregateSafe) constraint.apply(query as Builder<T>);
    }
  }
}

function getModelConstructor(model: ModelType): any {
  return Object.getPrototypeOf(model).constructor as any;
}

export class HasMany<T extends ModelType = ModelType, ForeignKey extends string = `${string}_id`> extends Relation<T> {
  constructor(parent: ModelType, related: any, foreignKey?: string, localKey?: string) {
    super(parent, related, foreignKey, localKey);
    this.localKey = localKey || getModelConstructor(parent).primaryKey;
    this.foreignKey = foreignKey || this.defaultForeignKey();
    this.addConstraints();
  }

  async saveMany(models: T[]): Promise<T[]> {
    const defaults = this.getDefaultAttributes();
    for (const model of models) {
      for (const [key, value] of Object.entries(defaults)) {
        model.setAttribute(key as any, value);
      }
      model.setAttribute(this.foreignKey as any, this.parent.getAttribute(this.localKey));
      await model.save();
    }
    return models;
  }

  async create(attributes: ModelMassAssignmentInputWithout<T, ForeignKey>): Promise<T> {
    const instance = this.newRelatedInstance(attributes);
    for (const [key, value] of Object.entries(this.getDefaultAttributes())) {
      instance.setAttribute(key as any, value);
    }
    instance.setAttribute(this.foreignKey as any, this.parent.getAttribute(this.localKey));
    await instance.save();
    return instance;
  }

  async createQuietly(attributes: ModelMassAssignmentInputWithout<T, ForeignKey>): Promise<T> {
    const instance = this.newRelatedInstance(attributes);
    for (const [key, value] of Object.entries(this.getDefaultAttributes())) {
      instance.setAttribute(key as any, value);
    }
    instance.setAttribute(this.foreignKey as any, this.parent.getAttribute(this.localKey));
    await instance.save({ events: false });
    return instance;
  }

  async createMany(records: ModelMassAssignmentInputWithout<T, ForeignKey>[]): Promise<T[]> {
    const models: T[] = [];
    for (const record of records) {
      models.push(await this.create(record));
    }
    return models;
  }

  async createManyQuietly(records: ModelMassAssignmentInputWithout<T, ForeignKey>[]): Promise<T[]> {
    const models: T[] = [];
    for (const record of records) {
      models.push(await this.createQuietly(record));
    }
    return models;
  }

  async createOrUpdate(attributes: ModelAttributeInputWithout<T, "">, values: ModelMassAssignmentInput<T> = {}): Promise<T> {
    const found = await this.getQuery().where(attributes as any).first();
    if (found) {
      found.fill(values);
      await found.save();
      return found;
    }
    const instance = this.newRelatedInstance(values);
    instance.forceFill(attributes as any);
    await this.saveMany([instance]);
    return instance;
  }

  addConstraints(): void {
    const parentValue = this.parent.getAttribute(this.localKey);
    this.builder.where(this.foreignKey, parentValue);
  }

  addEagerConstraints(models: ModelType[]): void {
    this.builder = (this.related as any).on(this.parent.getConnection());
    const keys = models.map((m) => m.getAttribute(this.localKey)).filter((k) => k != null);
    if (keys.length === 0) { this.$skipEagerQuery = true; return; }
    this.builder.whereIn(this.foreignKey, keys);
    this.applyExtraConstraints();
  }

  async getEager(): Promise<Collection<any>> {
    if (this.$skipEagerQuery) return new Collection<any>([]);
    return this.builder.get();
  }

  match(models: ModelType[], results: Collection<any>, relationName: string): void {
    const dictionary: Record<string, any[]> = {};
    for (const result of results) {
      const key = (result.$attributes as any)[this.foreignKey];
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

  latestOfMany(column: string = (this.related as any).primaryKey): HasOne<T> {
    return this.ofMany(column, "max");
  }

  oldestOfMany(column: string = (this.related as any).primaryKey): HasOne<T> {
    return this.ofMany(column, "min");
  }

  ofMany(column: string, aggregate: "max" | "min" = "max"): HasOne<T> {
    const relation = new HasOne<T>(this.parent, this.related, this.foreignKey, this.localKey);
    relation.getQuery().orderBy(column, aggregate === "max" ? "desc" : "asc");
    return relation;
  }
}

export class BelongsTo<T extends ModelType = ModelType> extends Relation<T> {
  private defaultAttributes?: Record<string, any>;

  constructor(parent: ModelType, related: any, foreignKey?: string, ownerKey?: string) {
    super(parent, related, foreignKey, ownerKey);
    this.foreignKey = foreignKey || `${snakeCase(related.name)}_id`;
    this.localKey = ownerKey || related.primaryKey;
    this.addConstraints();
  }

  withDefault(attributes: Record<string, any> = {}): this {
    this.defaultAttributes = attributes;
    return this;
  }

  getForeignKeyName(): string { return this.foreignKey; }
  getOwnerKeyName(): string { return this.localKey; }

  addConstraints(): void {
    const childValue = this.parent.getAttribute(this.foreignKey);
    this.builder.where(this.localKey, childValue);
  }

  addEagerConstraints(models: ModelType[]): void {
    this.builder = (this.related as any).on(this.parent.getConnection());
    const keys = models.map((m) => m.getAttribute(this.foreignKey)).filter((k) => k != null);
    if (keys.length === 0) { this.$skipEagerQuery = true; return; }
    this.builder.whereIn(this.localKey, keys);
    this.applyExtraConstraints();
  }

  async getEager(): Promise<Collection<any>> {
    if (this.$skipEagerQuery) return new Collection<any>([]);
    return this.builder.get();
  }

  match(models: ModelType[], results: Collection<any>, relationName: string): void {
    const dictionary: Record<string, any> = {};
    for (const result of results) {
      const key = (result.$attributes as any)[this.localKey];
      dictionary[String(key)] = result;
    }
    for (const model of models) {
      const key = model.getAttribute(this.foreignKey);
      const found = dictionary[String(key)] ?? null;
      model.setRelation(relationName, found ?? this.makeDefault());
    }
  }

  async getResults(): Promise<T | null> {
    const result = await this.builder.first();
    return result ?? (this.makeDefault() as T | null);
  }

  private makeDefault(): T | null {
    if (this.defaultAttributes === undefined) return null;
    const instance = this.newRelatedInstance();
    if (Object.keys(this.defaultAttributes).length > 0) instance.forceFill(this.defaultAttributes as any);
    return instance;
  }

  associate(model: ModelType | any): ModelType {
    const value = model instanceof _ModelClass ? model.getAttribute(this.localKey) : model;
    this.parent.setAttribute(this.foreignKey, value);
    return this.parent;
  }

  dissociate(): ModelType {
    this.parent.setAttribute(this.foreignKey, null);
    return this.parent;
  }

  protected newExistenceQuery(parentQuery: Builder<any>, aggregate: string, callback?: (query: Builder<any>) => void | Builder<any>): Builder<any> {
    const query = (this.related as any).on(parentQuery.connection).selectRaw(aggregate);
    query.whereColumn(`${this.related.getQualifiedTable(parentQuery.connection)}.${this.localKey}`, "=", `${parentQuery.tableName}.${this.foreignKey}`);
    this.applyAggregateSafeConstraintsTo(query);
    if (callback) callback(query);
    return query;
  }
}

export class HasManyThrough<T extends ModelType = ModelType> extends Relation<T> {
  protected through: ModelConstructor;
  protected firstKey: string;
  protected secondKey: string;
  protected secondLocalKey: string;

  constructor(
    parent: ModelType,
    related: ModelConstructor,
    through: ModelConstructor,
    firstKey?: string,
    secondKey?: string,
    localKey?: string,
    secondLocalKey?: string
  ) {
    super(parent, related, secondKey, localKey);
    const parentConstructor = getModelConstructor(parent);
    this.through = through;
    this.localKey = localKey || parentConstructor.primaryKey;
    this.firstKey = firstKey || `${snakeCase(parentConstructor.name)}_id`;
    this.secondKey = secondKey || `${snakeCase(through.name)}_id`;
    this.secondLocalKey = secondLocalKey || through.primaryKey;
    this.addConstraints();
  }

  protected qualifiedThroughTable(): string {
    return this.through.getQualifiedTable(this.parent.getConnection());
  }

  addConstraints(): void {
    const throughTable = this.through.getQualifiedTable(this.parent.getConnection());
    const relatedTable = this.related.getQualifiedTable(this.parent.getConnection());
    this.builder.select(`${relatedTable}.*`);
    this.builder.join(
      this.qualifiedThroughTable(),
      `${throughTable}.${this.secondLocalKey}`,
      "=",
      `${relatedTable}.${this.secondKey}`
    );
    this.builder.where(`${throughTable}.${this.firstKey}`, this.parent.getAttribute(this.localKey));
  }

  addEagerConstraints(models: ModelType[]): void {
    const throughTable = this.through.getQualifiedTable(this.parent.getConnection());
    const relatedTable = this.related.getQualifiedTable(this.parent.getConnection());
    const keys = models.map((m) => m.getAttribute(this.localKey)).filter((k) => k != null);
    if (keys.length === 0) { this.$skipEagerQuery = true; return; }
    this.builder = (this.related as any).on(this.parent.getConnection());
    this.builder.select(`${relatedTable}.*`, `${throughTable}.${this.firstKey}`);
    this.builder.join(
      this.qualifiedThroughTable(),
      `${throughTable}.${this.secondLocalKey}`,
      "=",
      `${relatedTable}.${this.secondKey}`
    );
    this.builder.whereIn(`${throughTable}.${this.firstKey}`, keys);
    this.applyExtraConstraints();
  }

  async getEager(): Promise<Collection<any>> {
    if (this.$skipEagerQuery) return new Collection<any>([]);
    return this.builder.get();
  }

  match(models: ModelType[], results: Collection<any>, relationName: string): void {
    const dictionary: Record<string, any[]> = {};
    for (const result of results) {
      const key = (result.$attributes as any)[this.firstKey];
      if (!dictionary[key]) dictionary[key] = [];
      delete (result.$attributes as any)[this.firstKey];
      dictionary[key].push(result);
    }
    for (const model of models) {
      const key = model.getAttribute(this.localKey);
      model.setRelation(relationName, new Collection(dictionary[String(key)] || []));
    }
  }

  async getResults(): Promise<Collection<T> | T | null> {
    return this.builder.get();
  }

  get(): Promise<Collection<T>> { return this.getResults() as Promise<Collection<T>>; }

  protected newExistenceQuery(parentQuery: Builder<any>, aggregate: string, callback?: (query: Builder<any>) => void | Builder<any>): Builder<any> {
    const throughTable = this.through.getQualifiedTable(parentQuery.connection);
    const relatedTable = this.related.getQualifiedTable(parentQuery.connection);
    const query = (this.related as any).on(parentQuery.connection).selectRaw(aggregate);
    query.join(
      throughTable,
      `${throughTable}.${this.secondLocalKey}`,
      "=",
      `${relatedTable}.${this.secondKey}`
    );
    query.whereColumn(`${throughTable}.${this.firstKey}`, "=", `${parentQuery.tableName}.${this.localKey}`);
    this.applyAggregateSafeConstraintsTo(query);
    if (callback) callback(query);
    return query;
  }
}

export class HasOneThrough<T extends ModelType = ModelType> extends HasManyThrough<T> {
  async getResults(): Promise<T | null> {
    return this.builder.first();
  }

  match(models: ModelType[], results: Collection<any>, relationName: string): void {
    const dictionary: Record<string, any> = {};
    for (const result of results) {
      const key = (result.$attributes as any)[this.firstKey];
      delete (result.$attributes as any)[this.firstKey];
      if (!dictionary[key]) dictionary[key] = result;
    }
    for (const model of models) {
      const key = model.getAttribute(this.localKey);
      model.setRelation(relationName, dictionary[String(key)] || null);
    }
  }
}

export class HasOne<T extends ModelType = ModelType> extends Relation<T> {
  private defaultAttributes?: Record<string, any>;

  constructor(parent: ModelType, related: ModelConstructor, foreignKey?: string, localKey?: string) {
    super(parent, related, foreignKey, localKey);
    this.localKey = localKey || getModelConstructor(parent).primaryKey;
    this.foreignKey = foreignKey || this.defaultForeignKey();
    this.addConstraints();
  }

  withDefault(attributes: Record<string, any> = {}): this {
    this.defaultAttributes = attributes;
    return this;
  }

  private makeDefault(): T | null {
    if (this.defaultAttributes === undefined) return null;
    const instance = this.newRelatedInstance();
    if (Object.keys(this.defaultAttributes).length > 0) instance.forceFill(this.defaultAttributes as any);
    return instance;
  }

  addConstraints(): void {
    const parentValue = this.parent.getAttribute(this.localKey);
    this.builder.where(this.foreignKey, parentValue);
  }

  addEagerConstraints(models: ModelType[]): void {
    this.builder = (this.related as any).on(this.parent.getConnection());
    const keys = models.map((m) => m.getAttribute(this.localKey)).filter((k) => k != null);
    if (keys.length === 0) { this.$skipEagerQuery = true; return; }
    this.builder.whereIn(this.foreignKey, keys);
    this.applyExtraConstraints();
  }

  async getEager(): Promise<Collection<any>> {
    if (this.$skipEagerQuery) return new Collection<any>([]);
    return this.builder.get();
  }

  match(models: ModelType[], results: Collection<any>, relationName: string): void {
    const dictionary: Record<string, any> = {};
    for (const result of results) {
      const key = (result.$attributes as any)[this.foreignKey];
      dictionary[String(key)] = result;
    }
    for (const model of models) {
      const key = model.getAttribute(this.localKey);
      const found = dictionary[String(key)] ?? null;
      model.setRelation(relationName, found ?? this.makeDefault());
    }
  }

  async getResults(): Promise<T | null> {
    const result = await this.builder.first();
    return result ?? (this.makeDefault() as T | null);
  }
}
