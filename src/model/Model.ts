import { setModelClass } from "./ModelBase.js";
import { ModelAggregates } from "./ModelAggregates.js";
import type {
  ModelConstructor,
  EagerLoadConstraint,
  EagerLoadDefinition,
  EagerLoadInput,
  MorphEagerLoadMap,
  LiteralUnion,
  TypedConstraintMap,
  TypedConstraintSelection,
  TypedExistsConstraintMap,
  TypedEagerLoad,
  StrictTypedEagerLoad,
  WithLoadedRelations,
  WithLoadedRelationsFromConstraintMap,
  WithRelationCount,
  WithRelationExists,
  WithRelationExistsMap,
  AggregateAlias,
  AggregateLoaded,
  AggregateConstraint,
  AggregateColumn,
  RelationConstraintQuery,
  MorphToRelationName,
  BelongsToRelationName,
  ChildRelationName,
  AttachedToRelationName,
  ModelRelationName,
  RelationRelatedModel,
  MorphToConstraintCallback,
  NestedRelationPath,
  ExtractStringPaths,
  TypedConstraintCallback,
  ModelColumn,
  ModelColumnValue,
  ModelAttributeInput,
  ModelMassAssignable,
  ModelMassAssignmentAttributes,
  ModelMassAssignmentInput,
  ModelMassAssignmentInputWithout,
  LoadMorphRelationName,
  ModelJson,
  DirectJson,
} from "./ModelBase.js";
import { Builder } from "../query/Builder.js";
import { Collection } from "../support/Collection.js";
import type { Factory } from "../seeding/Factory.js";

export { backedEnum } from "./BackedEnum.js";
export type { BackedEnumDefinition, EnumValue } from "./BackedEnum.js";
export { InvalidEnumValueError } from "./InvalidEnumValueError.js";

// Re-export types from ModelTypes
export type {
  ModelConstructor,
  GlobalScope,
  EagerLoadConstraint,
  EagerLoadDefinition,
  EagerLoadInput,
  MorphEagerLoadMap,
  MorphCountLoadMap,
  BulkModelOptions,
  SaveOptions,
  CastDefinition,
  CastsAttributes,
  AttributeDefinition,
  AccessorMap,
  ModelAttributeInput,
  ModelAttributes,
  ModelColumn,
  ModelColumnValue,
  ModelAttributeInputWithout,
  ModelMassAssignable,
  ModelMassAssignmentAttributes,
  ModelMassAssignmentInput,
  ModelMassAssignmentInputWithout,
  MorphRelationInput,
  StripTablePrefix,
  ModelInstanceAttributeKeys,
} from "./ModelTypes.js";
export type {
  ModelRelationValue,
  MorphToRelationName,
  BelongsToRelationName,
  ChildRelationName,
  AttachedToRelationName,
  ModelRelationName,
  RelationRelatedModel,
  NestedRelationPath,
  PivotQueryBuilder,
  RelationConstraintQuery,
  TypedConstraintCallback,
  MorphToConstraintCallback,
  AggregateAlias,
  AggregateLoaded,
  AggregateValueForRelation,
  TypedConstraintMap,
  TypedConstraintSelection,
  ExistsRelationPath,
  TypedExistsConstraintMap,
  TypedEagerLoad,
  StrictTypedEagerLoad,
  WithLoadedRelations,
  WithRelationCount,
  WithRelationExists,
  WithRelationExistsMap,
  AggregateConstraint,
  AggregateColumn,
  WithLoadedRelationsFromConstraintMap,
  LoadMorphRelationName,
  ModelJson,
  DirectJson,
  ExtractStringPaths,
  LiteralUnion,
} from "./ModelBase.js";
export {
  Relation,
  HasMany,
  BelongsTo,
  HasOne,
  HasManyThrough,
  HasOneThrough,
  findRelationMethod,
} from "./ModelBase.js";

// Factory blueprints are registered out-of-band (separate factory files,
// Laravel-style) — the model carries no definition. Kept here, not in the
// Factory module, to avoid a Model<->Factory import cycle.
const factoryRegistry = new Map<Function, () => any>();

export function __registerModelFactory(model: Function, build: () => any): void {
  factoryRegistry.set(model, build);
}

export function __resolveModelFactory(model: Function): any {
  // Walk the prototype chain so subclasses inherit a parent's factory.
  let ctor: any = model;
  while (ctor && ctor !== Function.prototype) {
    const build = factoryRegistry.get(ctor);
    if (build) return build();
    ctor = Object.getPrototypeOf(ctor);
  }
  return undefined;
}

export class Model<T extends Record<string, any> = any> extends ModelAggregates<T> {
  static define<A extends Record<string, any>>(
    tableName: string,
    modelNameOrColumns?: string | Partial<Record<keyof A, string>>,
    columnsArg?: Partial<Record<keyof A, string>>
  ): typeof Model & (new (...args: any[]) => Model<A> & A) {
    return (this as any)._defineBase(tableName, modelNameOrColumns, columnsArg);
  }

  /**
   * Build a factory for this model. Available on every model — no mixin.
   * Define a `class XFactory extends Factory<X>` and register it once with
   * `Factory.register(X, XFactory)` (typically in a factories/ file imported
   * at startup).
   */
  static factory<M extends ModelConstructor>(this: M): Factory<InstanceType<M>>;
  static factory<F extends Factory<any>>(this: ModelConstructor): F;
  static factory(this: any): any {
    const resolved = __resolveModelFactory(this as unknown as Function);
    if (!resolved) {
      throw new Error(
        `No factory registered for ${(this as any).name}. Define class ${(this as any).name}Factory extends Factory<${(this as any).name}> and call Factory.register(${(this as any).name}, ${(this as any).name}Factory) — usually in a factories/ file imported at startup.`
      );
    }
    return resolved;
  }

  // Typed overloads for where (restore full type safety)
  static where<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, value: any): Builder<InstanceType<M>>;
  static where<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, operator: string, value: any): Builder<InstanceType<M>>;
  static where<M extends ModelConstructor>(this: M, column: (query: Builder<InstanceType<M>>) => void | Builder<InstanceType<M>>): Builder<InstanceType<M>>;
  static where<M extends ModelConstructor>(this: M, column: ModelAttributeInput<InstanceType<M>>, operator?: string | any, value?: any): Builder<InstanceType<M>>;
  static where<M extends ModelConstructor>(this: M, column: any, operator?: any, value?: any): Builder<InstanceType<M>> {
    return (this as any).query().where(column, operator, value);
  }

  static firstWhere<M extends ModelConstructor, K extends ModelColumn<InstanceType<M>>>(this: M, column: K, value: ModelColumnValue<InstanceType<M>, K>): Promise<InstanceType<M> | null>;
  static firstWhere<M extends ModelConstructor, K extends ModelColumn<InstanceType<M>>>(this: M, column: K, operator: string, value: ModelColumnValue<InstanceType<M>, K>): Promise<InstanceType<M> | null>;
  static firstWhere<M extends ModelConstructor>(this: M, column: any, operator: any, value?: any): Promise<InstanceType<M> | null> {
    return (this as any).query().firstWhere(column, operator, value);
  }

  static orWhere<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, value: any): Builder<InstanceType<M>>;
  static orWhere<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, operator: string, value: any): Builder<InstanceType<M>>;
  static orWhere<M extends ModelConstructor>(this: M, column: (query: Builder<InstanceType<M>>) => void | Builder<InstanceType<M>>): Builder<InstanceType<M>>;
  static orWhere<M extends ModelConstructor>(this: M, column: ModelAttributeInput<InstanceType<M>>, operator?: string | any, value?: any): Builder<InstanceType<M>>;
  static orWhere<M extends ModelConstructor>(this: M, column: any, operator?: any, value?: any): Builder<InstanceType<M>> {
    return (this as any).query().orWhere(column, operator, value);
  }

  static whereIn<M extends ModelConstructor, K extends ModelColumn<InstanceType<M>>>(this: M, column: K, values: ModelColumnValue<InstanceType<M>, K>[]): Builder<InstanceType<M>> {
    return (this as any).query().whereIn(column, values);
  }

  static whereNotIn<M extends ModelConstructor, K extends ModelColumn<InstanceType<M>>>(this: M, column: K, values: ModelColumnValue<InstanceType<M>, K>[]): Builder<InstanceType<M>> {
    return (this as any).query().whereNotIn(column, values);
  }

  static orderBy<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, direction?: "asc" | "desc"): Builder<InstanceType<M>> {
    return (this as any).query().orderBy(column, direction);
  }

  static orderByDesc<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>): Builder<InstanceType<M>> {
    return (this as any).query().orderByDesc(column);
  }

  static groupBy<M extends ModelConstructor>(this: M, ...columns: ModelColumn<InstanceType<M>>[]): Builder<InstanceType<M>> {
    return (this as any).query().groupBy(...columns);
  }

  static select<M extends ModelConstructor, K extends ModelColumn<InstanceType<M>>>(this: M, ...columns: K[]): Builder<InstanceType<M>, InstanceType<M>, K> {
    return (this as any).query().select(...columns);
  }

  static addSelect<M extends ModelConstructor, K extends ModelColumn<InstanceType<M>>>(this: M, ...columns: K[]): Builder<InstanceType<M>, InstanceType<M>, "*" | K> {
    return (this as any).query().addSelect(...columns);
  }

  static whereNull<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>> | readonly ModelColumn<InstanceType<M>>[]): Builder<InstanceType<M>> {
    return (this as any).query().whereNull(column);
  }

  static whereNotNull<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>> | readonly ModelColumn<InstanceType<M>>[]): Builder<InstanceType<M>> {
    return (this as any).query().whereNotNull(column);
  }

  static orWhereNull<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>> | readonly ModelColumn<InstanceType<M>>[]): Builder<InstanceType<M>> {
    return (this as any).query().orWhereNull(column);
  }

  static orWhereNotNull<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>> | readonly ModelColumn<InstanceType<M>>[]): Builder<InstanceType<M>> {
    return (this as any).query().orWhereNotNull(column);
  }

  static whereBetween<M extends ModelConstructor, K extends ModelColumn<InstanceType<M>>>(this: M, column: K, values: [ModelColumnValue<InstanceType<M>, K>, ModelColumnValue<InstanceType<M>, K>]): Builder<InstanceType<M>> {
    return (this as any).query().whereBetween(column, values);
  }

  static whereNotBetween<M extends ModelConstructor, K extends ModelColumn<InstanceType<M>>>(this: M, column: K, values: [ModelColumnValue<InstanceType<M>, K>, ModelColumnValue<InstanceType<M>, K>]): Builder<InstanceType<M>> {
    return (this as any).query().whereNotBetween(column, values);
  }

  static orWhereBetween<M extends ModelConstructor, K extends ModelColumn<InstanceType<M>>>(this: M, column: K, values: [ModelColumnValue<InstanceType<M>, K>, ModelColumnValue<InstanceType<M>, K>]): Builder<InstanceType<M>> {
    return (this as any).query().orWhereBetween(column, values);
  }

  static orWhereNotBetween<M extends ModelConstructor, K extends ModelColumn<InstanceType<M>>>(this: M, column: K, values: [ModelColumnValue<InstanceType<M>, K>, ModelColumnValue<InstanceType<M>, K>]): Builder<InstanceType<M>> {
    return (this as any).query().orWhereNotBetween(column, values);
  }

  static whereColumn<M extends ModelConstructor>(this: M, comparisons: readonly (readonly [ModelColumn<InstanceType<M>>, string, ModelColumn<InstanceType<M>>])[]): Builder<InstanceType<M>>;
  static whereColumn<M extends ModelConstructor>(this: M, first: string, second: string): Builder<InstanceType<M>>;
  static whereColumn<M extends ModelConstructor>(this: M, first: string, operator: string, second: string): Builder<InstanceType<M>>;
  static whereColumn<M extends ModelConstructor>(this: M, first: string | readonly (readonly [ModelColumn<InstanceType<M>>, string, ModelColumn<InstanceType<M>>])[], operatorOrSecond?: string, second?: string): Builder<InstanceType<M>> {
    return (this as any).query().whereColumn(first, operatorOrSecond, second);
  }

  static orWhereColumn<M extends ModelConstructor>(this: M, comparisons: readonly (readonly [ModelColumn<InstanceType<M>>, string, ModelColumn<InstanceType<M>>])[]): Builder<InstanceType<M>>;
  static orWhereColumn<M extends ModelConstructor>(this: M, first: string, second: string): Builder<InstanceType<M>>;
  static orWhereColumn<M extends ModelConstructor>(this: M, first: string, operator: string, second: string): Builder<InstanceType<M>>;
  static orWhereColumn<M extends ModelConstructor>(this: M, first: string | readonly (readonly [ModelColumn<InstanceType<M>>, string, ModelColumn<InstanceType<M>>])[], operatorOrSecond?: string, second?: string): Builder<InstanceType<M>> {
    return (this as any).query().orWhereColumn(first, operatorOrSecond, second);
  }

  static whereRelation<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, column: ModelColumn<RelationRelatedModel<InstanceType<M>, R>>, operator: string | any, value?: any): Builder<InstanceType<M>>;
  static whereRelation<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, column: string, operator: string | any, value?: any): Builder<InstanceType<M>>;
  static whereRelation<M extends ModelConstructor>(this: M, relationName: string, column: any, operator: any, value?: any): Builder<InstanceType<M>> {
    return (this as any).query().whereRelation(relationName, column, operator, value);
  }

  static orWhereRelation<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, column: ModelColumn<RelationRelatedModel<InstanceType<M>, R>>, operator: string | any, value?: any): Builder<InstanceType<M>>;
  static orWhereRelation<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, column: string, operator: string | any, value?: any): Builder<InstanceType<M>>;
  static orWhereRelation<M extends ModelConstructor>(this: M, relationName: string, column: any, operator: any, value?: any): Builder<InstanceType<M>> {
    return (this as any).query().orWhereRelation(relationName, column, operator, value);
  }

  static whereBelongsTo<M extends ModelConstructor, R extends string & BelongsToRelationName<InstanceType<M>>>(this: M, relationName: R, model: Model | Model[] | Collection<Model>): Builder<InstanceType<M>> {
    return (this as any).query().whereBelongsTo(relationName as any, model as any);
  }

  static whereAttachedTo<M extends ModelConstructor, R extends string & AttachedToRelationName<InstanceType<M>>>(this: M, relationName: R, model: Model | Model[] | Collection<Model>): Builder<InstanceType<M>> {
    return (this as any).query().whereAttachedTo(relationName as any, model as any);
  }

  static whereMorphedTo<M extends ModelConstructor, R extends string & MorphToRelationName<InstanceType<M>>>(this: M, relationName: R, model: Model | ModelConstructor | string): Builder<InstanceType<M>>;
  static whereMorphedTo<M extends ModelConstructor>(this: M, relationName: string, model: Model | ModelConstructor | string): Builder<InstanceType<M>> {
    return (this as any).query().whereMorphedTo(relationName as any, model as any);
  }

  static orWhereMorphedTo<M extends ModelConstructor, R extends string & MorphToRelationName<InstanceType<M>>>(this: M, relationName: R, model: Model | ModelConstructor | string): Builder<InstanceType<M>>;
  static orWhereMorphedTo<M extends ModelConstructor>(this: M, relationName: string, model: Model | ModelConstructor | string): Builder<InstanceType<M>> {
    return (this as any).query().orWhereMorphedTo(relationName as any, model as any);
  }

  static whereNotMorphedTo<M extends ModelConstructor, R extends string & MorphToRelationName<InstanceType<M>>>(this: M, relationName: R, model: Model | ModelConstructor | string): Builder<InstanceType<M>>;
  static whereNotMorphedTo<M extends ModelConstructor>(this: M, relationName: string, model: Model | ModelConstructor | string): Builder<InstanceType<M>> {
    return (this as any).query().whereNotMorphedTo(relationName as any, model as any);
  }

  static has<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, operator?: string, count?: number): Builder<InstanceType<M>>;
  static has<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, operator?: string, count?: number): Builder<InstanceType<M>>;
  static has<M extends ModelConstructor>(this: M, relationName: string, operator?: string, count?: number): Builder<InstanceType<M>> {
    return (this as any).query().has(relationName as any, operator as any, count as any);
  }

  static orHas<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, operator?: string, count?: number): Builder<InstanceType<M>>;
  static orHas<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, operator?: string, count?: number): Builder<InstanceType<M>>;
  static orHas<M extends ModelConstructor>(this: M, relationName: string, operator?: string, count?: number): Builder<InstanceType<M>> {
    return (this as any).query().orHas(relationName as any, operator as any, count as any);
  }

  static whereHas<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, callback?: (query: RelationConstraintQuery<InstanceType<M>, R>) => void | Builder<any>, operator?: string, count?: number): Builder<InstanceType<M>>;
  static whereHas<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, callback?: (query: Builder<any>) => void | Builder<any>, operator?: string, count?: number): Builder<InstanceType<M>>;
  static whereHas<M extends ModelConstructor>(this: M, relationName: string, callback?: (query: Builder<any>) => void | Builder<any>, operator?: string, count?: number): Builder<InstanceType<M>> {
    return (this as any).query().whereHas(relationName as any, callback as any, operator as any, count as any);
  }

  static doesntHave<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R): Builder<InstanceType<M>>;
  static doesntHave<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>): Builder<InstanceType<M>>;
  static doesntHave<M extends ModelConstructor>(this: M, relationName: string): Builder<InstanceType<M>> {
    return (this as any).query().doesntHave(relationName as any);
  }

  static orDoesntHave<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R): Builder<InstanceType<M>>;
  static orDoesntHave<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>): Builder<InstanceType<M>>;
  static orDoesntHave<M extends ModelConstructor>(this: M, relationName: string): Builder<InstanceType<M>> {
    return (this as any).query().orDoesntHave(relationName as any);
  }

  static whereDoesntHave<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, callback?: (query: RelationConstraintQuery<InstanceType<M>, R>) => void | Builder<any>): Builder<InstanceType<M>>;
  static whereDoesntHave<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, callback?: (query: Builder<any>) => void | Builder<any>): Builder<InstanceType<M>>;
  static whereDoesntHave<M extends ModelConstructor>(this: M, relationName: string, callback?: (query: Builder<any>) => void | Builder<any>): Builder<InstanceType<M>> {
    return (this as any).query().whereDoesntHave(relationName as any, callback as any);
  }

  static orWhereDoesntHave<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, callback?: (query: RelationConstraintQuery<InstanceType<M>, R>) => void | Builder<any>): Builder<InstanceType<M>>;
  static orWhereDoesntHave<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, callback?: (query: Builder<any>) => void | Builder<any>): Builder<InstanceType<M>>;
  static orWhereDoesntHave<M extends ModelConstructor>(this: M, relationName: string, callback?: (query: Builder<any>) => void | Builder<any>): Builder<InstanceType<M>> {
    return (this as any).query().orWhereDoesntHave(relationName as any, callback as any);
  }

  static whereHasMorph<M extends ModelConstructor, R extends string & MorphToRelationName<InstanceType<M>>>(this: M, relationName: R, types: string | string[] | ModelConstructor | ModelConstructor[], callback?: EagerLoadConstraint, operator?: string, count?: number): Builder<InstanceType<M>>;
  static whereHasMorph<M extends ModelConstructor>(this: M, relationName: string, types: string | string[] | ModelConstructor | ModelConstructor[], callback?: EagerLoadConstraint, operator?: string, count?: number): Builder<InstanceType<M>>;
  static whereHasMorph<M extends ModelConstructor>(this: M, relationName: string, types: string | string[] | ModelConstructor | ModelConstructor[], callback?: EagerLoadConstraint, operator?: string, count?: number): Builder<InstanceType<M>> {
    return (this as any).query().whereHasMorph(relationName as any, types as any, callback as any, operator as any, count as any);
  }

  static whereDoesntHaveMorph<M extends ModelConstructor, R extends string & MorphToRelationName<InstanceType<M>>>(this: M, relationName: R, types: string | string[] | ModelConstructor | ModelConstructor[], callback?: EagerLoadConstraint): Builder<InstanceType<M>>;
  static whereDoesntHaveMorph<M extends ModelConstructor>(this: M, relationName: string, types: string | string[] | ModelConstructor | ModelConstructor[], callback?: EagerLoadConstraint): Builder<InstanceType<M>>;
  static whereDoesntHaveMorph<M extends ModelConstructor>(this: M, relationName: string, types: string | string[] | ModelConstructor | ModelConstructor[], callback?: EagerLoadConstraint): Builder<InstanceType<M>> {
    return (this as any).query().whereDoesntHaveMorph(relationName as any, types as any, callback as any);
  }

  static whereMorphRelation<M extends ModelConstructor, R extends string & MorphToRelationName<InstanceType<M>>>(this: M, relationName: R, types: string | string[] | ModelConstructor | ModelConstructor[], column: ModelColumn<RelationRelatedModel<InstanceType<M>, R>>, operator: any, value?: any): Builder<InstanceType<M>>;
  static whereMorphRelation<M extends ModelConstructor>(this: M, relationName: string, types: string | string[] | ModelConstructor | ModelConstructor[], column: string, operator: any, value?: any): Builder<InstanceType<M>> {
    return (this as any).query().whereMorphRelation(relationName as any, types as any, column, operator, value);
  }

  static with<M extends ModelConstructor, Rs extends ReadonlyArray<TypedEagerLoad<InstanceType<M>>>>(this: M, relations: Rs): Builder<InstanceType<M>, WithLoadedRelations<InstanceType<M>, ExtractStringPaths<Rs[number]>>>;
  static with<M extends ModelConstructor, Rs extends ReadonlyArray<TypedEagerLoad<InstanceType<M>>>>(this: M, ...relations: Rs): Builder<InstanceType<M>, WithLoadedRelations<InstanceType<M>, ExtractStringPaths<Rs[number]>>>;
  static with<M extends ModelConstructor, K extends string & NestedRelationPath<InstanceType<M>>>(this: M, constraint: TypedConstraintSelection<InstanceType<M>, K>): Builder<InstanceType<M>, WithLoadedRelationsFromConstraintMap<InstanceType<M>, TypedConstraintSelection<InstanceType<M>, K>>>;
  static with<M extends ModelConstructor, R extends TypedConstraintMap<InstanceType<M>> & object>(this: M, constraint: R): Builder<InstanceType<M>, WithLoadedRelationsFromConstraintMap<InstanceType<M>, R>>;
  static with<M extends ModelConstructor, R extends string & NestedRelationPath<InstanceType<M>>>(this: M, relation: R): Builder<InstanceType<M>, WithLoadedRelations<InstanceType<M>, R>>;
  static with<M extends ModelConstructor>(this: M, relation: LiteralUnion<string & NestedRelationPath<InstanceType<M>>>): Builder<InstanceType<M>, WithLoadedRelations<InstanceType<M>, string>>;
  static with<M extends ModelConstructor, R extends string & MorphToRelationName<InstanceType<M>>>(this: M, relation: R, callback: MorphToConstraintCallback): Builder<InstanceType<M>, WithLoadedRelations<InstanceType<M>, R>>;
  static with<M extends ModelConstructor, R extends string & NestedRelationPath<InstanceType<M>>>(this: M, relation: R, callback: TypedConstraintCallback<InstanceType<M>, R>): Builder<InstanceType<M>, WithLoadedRelations<InstanceType<M>, R>>;
  static with<M extends ModelConstructor>(this: M, relation: LiteralUnion<string & NestedRelationPath<InstanceType<M>>>, callback: EagerLoadConstraint): Builder<InstanceType<M>, WithLoadedRelations<InstanceType<M>, string>>;
  static with<M extends ModelConstructor>(this: M, ...relations: any[]): any {
    return (this as any).query().with(...relations) as any;
  }

  static withCount<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>, A extends string | undefined = undefined>(this: M, relationName: R, alias?: A): Builder<InstanceType<M>, WithRelationCount<InstanceType<M>, R, A>>;
  static withCount<M extends ModelConstructor, A extends string | undefined = undefined>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, alias?: A): Builder<InstanceType<M>, WithRelationCount<InstanceType<M>, string, A>>;
  static withCount<M extends ModelConstructor>(this: M, relationName: string, alias?: string): Builder<InstanceType<M>, WithRelationCount<InstanceType<M>, string, string | undefined>> {
    return (this as any).query().withCount(relationName, alias);
  }

  static withExists<M extends ModelConstructor, R extends TypedExistsConstraintMap<InstanceType<M>> & object>(this: M, relations: R): Builder<InstanceType<M>, WithRelationExistsMap<InstanceType<M>, R>>;
  static withExists<M extends ModelConstructor, R extends Record<string, ((query: Builder<any>) => any) | undefined>>(this: M, relations: R): Builder<InstanceType<M>, WithRelationExistsMap<InstanceType<M>, R>>;
  static withExists<M extends ModelConstructor, R extends string & NestedRelationPath<InstanceType<M>>>(this: M, relationName: R, callback?: TypedConstraintCallback<InstanceType<M>, R>): Builder<InstanceType<M>, WithRelationExists<InstanceType<M>, R>>;
  static withExists<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & NestedRelationPath<InstanceType<M>>>, callback?: (query: Builder<any>) => any): Builder<InstanceType<M>, WithRelationExists<InstanceType<M>, string>>;
  static withExists<M extends ModelConstructor, R extends string & NestedRelationPath<InstanceType<M>>, A extends string>(this: M, relationName: R, alias: A, callback?: TypedConstraintCallback<InstanceType<M>, R>): Builder<InstanceType<M>, WithRelationExists<InstanceType<M>, R, A>>;
  static withExists<M extends ModelConstructor, A extends string>(this: M, relationName: LiteralUnion<string & NestedRelationPath<InstanceType<M>>>, alias: A, callback?: (query: Builder<any>) => any): Builder<InstanceType<M>, WithRelationExists<InstanceType<M>, string, A>>;
  static withExists<M extends ModelConstructor>(this: M, relationOrMap: any, aliasOrCallback?: any, callback?: any): any {
    return (this as any).query().withExists(relationOrMap, aliasOrCallback, callback);
  }

  static withSum<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, column: AggregateColumn<InstanceType<M>, R>, callback: AggregateConstraint<InstanceType<M>, R>): Builder<InstanceType<M>>;
  static withSum<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, column: AggregateColumn<InstanceType<M>, R>, alias?: string): Builder<InstanceType<M>>;
  static withSum<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, column: AggregateColumn<InstanceType<M>, R>, alias: string, callback: AggregateConstraint<InstanceType<M>, R>): Builder<InstanceType<M>>;
  static withSum<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, column: string, callback: EagerLoadConstraint): Builder<InstanceType<M>>;
  static withSum<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, column: string, alias?: string): Builder<InstanceType<M>>;
  static withSum<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, column: string, alias: string, callback: EagerLoadConstraint): Builder<InstanceType<M>>;
  static withSum<M extends ModelConstructor>(this: M, relationName: string, column: string, aliasOrCallback?: string | EagerLoadConstraint, callback?: EagerLoadConstraint): Builder<InstanceType<M>> {
    return (this as any).query().withSum(relationName, column, aliasOrCallback as any, callback as any);
  }

  static withAvg<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, column: AggregateColumn<InstanceType<M>, R>, callback: AggregateConstraint<InstanceType<M>, R>): Builder<InstanceType<M>>;
  static withAvg<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, column: AggregateColumn<InstanceType<M>, R>, alias?: string): Builder<InstanceType<M>>;
  static withAvg<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, column: AggregateColumn<InstanceType<M>, R>, alias: string, callback: AggregateConstraint<InstanceType<M>, R>): Builder<InstanceType<M>>;
  static withAvg<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, column: string, callback: EagerLoadConstraint): Builder<InstanceType<M>>;
  static withAvg<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, column: string, alias?: string): Builder<InstanceType<M>>;
  static withAvg<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, column: string, alias: string, callback: EagerLoadConstraint): Builder<InstanceType<M>>;
  static withAvg<M extends ModelConstructor>(this: M, relationName: string, column: string, aliasOrCallback?: string | EagerLoadConstraint, callback?: EagerLoadConstraint): Builder<InstanceType<M>> {
    return (this as any).query().withAvg(relationName, column, aliasOrCallback as any, callback as any);
  }

  static withMin<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, column: AggregateColumn<InstanceType<M>, R>, callback: AggregateConstraint<InstanceType<M>, R>): Builder<InstanceType<M>>;
  static withMin<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, column: AggregateColumn<InstanceType<M>, R>, alias?: string): Builder<InstanceType<M>>;
  static withMin<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, column: AggregateColumn<InstanceType<M>, R>, alias: string, callback: AggregateConstraint<InstanceType<M>, R>): Builder<InstanceType<M>>;
  static withMin<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, column: string, callback: EagerLoadConstraint): Builder<InstanceType<M>>;
  static withMin<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, column: string, alias?: string): Builder<InstanceType<M>>;
  static withMin<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, column: string, alias: string, callback: EagerLoadConstraint): Builder<InstanceType<M>>;
  static withMin<M extends ModelConstructor>(this: M, relationName: string, column: string, aliasOrCallback?: string | EagerLoadConstraint, callback?: EagerLoadConstraint): Builder<InstanceType<M>> {
    return (this as any).query().withMin(relationName, column, aliasOrCallback as any, callback as any);
  }

  static withMax<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, column: AggregateColumn<InstanceType<M>, R>, callback: AggregateConstraint<InstanceType<M>, R>): Builder<InstanceType<M>>;
  static withMax<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, column: AggregateColumn<InstanceType<M>, R>, alias?: string): Builder<InstanceType<M>>;
  static withMax<M extends ModelConstructor, R extends string & ModelRelationName<InstanceType<M>>>(this: M, relationName: R, column: AggregateColumn<InstanceType<M>, R>, alias: string, callback: AggregateConstraint<InstanceType<M>, R>): Builder<InstanceType<M>>;
  static withMax<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, column: string, callback: EagerLoadConstraint): Builder<InstanceType<M>>;
  static withMax<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, column: string, alias?: string): Builder<InstanceType<M>>;
  static withMax<M extends ModelConstructor>(this: M, relationName: LiteralUnion<string & ModelRelationName<InstanceType<M>>>, column: string, alias: string, callback: EagerLoadConstraint): Builder<InstanceType<M>>;
  static withMax<M extends ModelConstructor>(this: M, relationName: string, column: string, aliasOrCallback?: string | EagerLoadConstraint, callback?: EagerLoadConstraint): Builder<InstanceType<M>> {
    return (this as any).query().withMax(relationName, column, aliasOrCallback as any, callback as any);
  }

  static withWhereHas<M extends ModelConstructor, R extends TypedEagerLoad<InstanceType<M>>>(this: M, relation: R, callback?: (query: Builder<any>) => void | Builder<any>): Builder<InstanceType<M>>;
  static withWhereHas<M extends ModelConstructor>(this: M, relation: TypedEagerLoad<InstanceType<M>>, callback?: (query: Builder<any>) => void | Builder<any>): Builder<InstanceType<M>>;
  static withWhereHas<M extends ModelConstructor>(this: M, relation: any, callback?: (query: Builder<any>) => void | Builder<any>): Builder<InstanceType<M>> {
    return (this as any).query().withWhereHas(relation, callback) as any;
  }

  // Typed instance load overloads
  async load<R extends string & NestedRelationPath<this>>(relation: R, ...relations: R[]): Promise<WithLoadedRelations<this, R>>;
  async load<Rs extends ReadonlyArray<StrictTypedEagerLoad<this>>>(relations: Rs): Promise<WithLoadedRelations<this, ExtractStringPaths<Rs[number]>>>;
  async load<Rs extends ReadonlyArray<StrictTypedEagerLoad<this>>>(...relations: Rs): Promise<WithLoadedRelations<this, ExtractStringPaths<Rs[number]>>>;
  async load(...relations: (EagerLoadInput | EagerLoadInput[])[]): Promise<this> {
    const constructor = this.getModelConstructor() as typeof Model;
    await constructor.eagerLoadRelations([this] as any, relations as any);
    return this;
  }

  async loadMissing<R extends string & NestedRelationPath<this>>(relation: R, ...relations: R[]): Promise<WithLoadedRelations<this, R>>;
  async loadMissing<Rs extends ReadonlyArray<string & NestedRelationPath<this>>>(relations: Rs): Promise<WithLoadedRelations<this, Rs[number]>>;
  async loadMissing<Rs extends ReadonlyArray<string & NestedRelationPath<this>>>(...relations: Rs): Promise<WithLoadedRelations<this, Rs[number]>>;
  async loadMissing(...relations: (string | string[])[]): Promise<this> {
    await Collection.make([this]).loadMissing(relations.flat() as any);
    return this;
  }

  async loadMorph<R extends LoadMorphRelationName<this>>(relationName: R, relations: MorphEagerLoadMap): Promise<this> {
    const constructor = this.getModelConstructor() as typeof Model;
    await constructor.loadMorph([this] as any, relationName as string, relations);
    return this;
  }

  async loadCount<R extends string & ModelRelationName<this>, A extends string | undefined = undefined>(relationName: R, alias?: A): Promise<AggregateLoaded<this, AggregateAlias<R, A, "count">, number>> {
    const constructor = this.getModelConstructor() as typeof Model;
    await constructor.loadCount([this] as any, relationName as string, alias as string | undefined);
    return this as any;
  }

  async loadSum<R extends string & ModelRelationName<this>, C extends AggregateColumn<this, R>>(relationName: R, column: C, callback: AggregateConstraint<this, R>): Promise<this>;
  async loadSum<R extends string & ModelRelationName<this>, C extends AggregateColumn<this, R>, A extends string | undefined = undefined>(relationName: R, column: C, alias?: A): Promise<this>;
  async loadSum<R extends string & ModelRelationName<this>, C extends AggregateColumn<this, R>, A extends string>(relationName: R, column: C, alias: A, callback: AggregateConstraint<this, R>): Promise<this>;
  async loadSum(relationName: LiteralUnion<string & ModelRelationName<this>>, column: string, callback: EagerLoadConstraint): Promise<this>;
  async loadSum<A extends string | undefined = undefined>(relationName: LiteralUnion<string & ModelRelationName<this>>, column: string, alias?: A): Promise<this>;
  async loadSum<A extends string>(relationName: LiteralUnion<string & ModelRelationName<this>>, column: string, alias: A, callback: EagerLoadConstraint): Promise<this>;
  async loadSum(relationName: string, column: string, aliasOrCallback?: string | AggregateConstraint<this, any>, callback?: AggregateConstraint<this, any>): Promise<any> {
    const constructor = this.getModelConstructor() as typeof Model;
    await constructor.loadSum([this] as any, relationName, column, aliasOrCallback as any, callback as any);
    return this as any;
  }

  async loadAvg<R extends string & ModelRelationName<this>, C extends AggregateColumn<this, R>>(relationName: R, column: C, callback: AggregateConstraint<this, R>): Promise<this>;
  async loadAvg<R extends string & ModelRelationName<this>, C extends AggregateColumn<this, R>, A extends string | undefined = undefined>(relationName: R, column: C, alias?: A): Promise<this>;
  async loadAvg<R extends string & ModelRelationName<this>, C extends AggregateColumn<this, R>, A extends string>(relationName: R, column: C, alias: A, callback: AggregateConstraint<this, R>): Promise<this>;
  async loadAvg(relationName: LiteralUnion<string & ModelRelationName<this>>, column: string, callback: EagerLoadConstraint): Promise<this>;
  async loadAvg<A extends string | undefined = undefined>(relationName: LiteralUnion<string & ModelRelationName<this>>, column: string, alias?: A): Promise<this>;
  async loadAvg<A extends string>(relationName: LiteralUnion<string & ModelRelationName<this>>, column: string, alias: A, callback: EagerLoadConstraint): Promise<this>;
  async loadAvg(relationName: string, column: string, aliasOrCallback?: string | AggregateConstraint<this, any>, callback?: AggregateConstraint<this, any>): Promise<any> {
    const constructor = this.getModelConstructor() as typeof Model;
    await constructor.loadAvg([this] as any, relationName, column, aliasOrCallback as any, callback as any);
    return this as any;
  }

  async loadMin<R extends string & ModelRelationName<this>, C extends AggregateColumn<this, R>>(relationName: R, column: C, callback: AggregateConstraint<this, R>): Promise<this>;
  async loadMin<R extends string & ModelRelationName<this>, C extends AggregateColumn<this, R>, A extends string | undefined = undefined>(relationName: R, column: C, alias?: A): Promise<this>;
  async loadMin<R extends string & ModelRelationName<this>, C extends AggregateColumn<this, R>, A extends string>(relationName: R, column: C, alias: A, callback: AggregateConstraint<this, R>): Promise<this>;
  async loadMin(relationName: LiteralUnion<string & ModelRelationName<this>>, column: string, callback: EagerLoadConstraint): Promise<this>;
  async loadMin<A extends string | undefined = undefined>(relationName: LiteralUnion<string & ModelRelationName<this>>, column: string, alias?: A): Promise<this>;
  async loadMin<A extends string>(relationName: LiteralUnion<string & ModelRelationName<this>>, column: string, alias: A, callback: EagerLoadConstraint): Promise<this>;
  async loadMin(relationName: string, column: string, aliasOrCallback?: string | AggregateConstraint<this, any>, callback?: AggregateConstraint<this, any>): Promise<any> {
    const constructor = this.getModelConstructor() as typeof Model;
    await constructor.loadMin([this] as any, relationName, column, aliasOrCallback as any, callback as any);
    return this as any;
  }

  async loadMax<R extends string & ModelRelationName<this>, C extends AggregateColumn<this, R>>(relationName: R, column: C, callback: AggregateConstraint<this, R>): Promise<this>;
  async loadMax<R extends string & ModelRelationName<this>, C extends AggregateColumn<this, R>, A extends string | undefined = undefined>(relationName: R, column: C, alias?: A): Promise<this>;
  async loadMax<R extends string & ModelRelationName<this>, C extends AggregateColumn<this, R>, A extends string>(relationName: R, column: C, alias: A, callback: AggregateConstraint<this, R>): Promise<this>;
  async loadMax(relationName: LiteralUnion<string & ModelRelationName<this>>, column: string, callback: EagerLoadConstraint): Promise<this>;
  async loadMax<A extends string | undefined = undefined>(relationName: LiteralUnion<string & ModelRelationName<this>>, column: string, alias?: A): Promise<this>;
  async loadMax<A extends string>(relationName: LiteralUnion<string & ModelRelationName<this>>, column: string, alias: A, callback: EagerLoadConstraint): Promise<this>;
  async loadMax(relationName: string, column: string, aliasOrCallback?: string | AggregateConstraint<this, any>, callback?: AggregateConstraint<this, any>): Promise<any> {
    const constructor = this.getModelConstructor() as typeof Model;
    await constructor.loadMax([this] as any, relationName, column, aliasOrCallback as any, callback as any);
    return this as any;
  }
}

// Register Model class with ModelBase to resolve circular dependency
setModelClass(Model);
