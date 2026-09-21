import { setModelClass } from "./ModelBase.js";
import { ModelAggregates } from "./ModelAggregates.js";
import type {
  ModelConstructor,
  EagerLoadConstraint,
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
  AggregateValueForRelation,
  AggregateConstraint,
  AggregateColumn,
  RelationConstraintQuery,
  MorphToRelationName,
  BelongsToRelationName,
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
  LoadMorphRelationName,
} from "./ModelBase.js";
import { Builder } from "../query/Builder.js";
import type { NumericAggregate } from "../query/Builder.js";
import { Collection } from "../support/Collection.js";
import type { Factory } from "../seeding/Factory.js";


export { backedEnum } from "./BackedEnum.js";
export type { BackedEnumDefinition, EnumValue } from "./BackedEnum.js";
export { InvalidEnumValueError } from "./InvalidEnumValueError.js";

// Re-export types from ModelTypes
export type {
  ModelConstructor,
  GlobalScope,
  ModelKey,
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
  ModelType,
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

  async loadMissing<R extends string & NestedRelationPath<this>>(relation: R, ...relations: R[]): Promise<WithLoadedRelations<this, R>>;
  async loadMissing<Rs extends ReadonlyArray<string & NestedRelationPath<this>>>(relations: Rs): Promise<WithLoadedRelations<this, Rs[number]>>;
  async loadMissing<Rs extends ReadonlyArray<string & NestedRelationPath<this>>>(...relations: Rs): Promise<WithLoadedRelations<this, Rs[number]>>;
  async loadMissing(...relations: (string | string[])[]): Promise<this> {
    await Collection.make([this]).loadMissing(relations.flat() as any);
    return this;
  }

}

// Register Model class with ModelBase to resolve circular dependency
setModelClass(Model);
