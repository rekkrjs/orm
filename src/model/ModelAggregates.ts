import { Builder, type NumericAggregate } from "../query/Builder.js";
import { Collection } from "../support/Collection.js";
import type {
  ModelConstructor,
  ModelColumn,
  ModelColumnValue,
  EagerLoadConstraint,
  EagerLoadDefinition,
  EagerLoadInput,
  MorphEagerLoadMap,
  LiteralUnion,
  WithRelationCount,
  WithRelationExists,
  WithRelationExistsMap,
  TypedExistsConstraintMap,
  AggregateAlias,
  AggregateLoaded,
  AggregateConstraint,
  AggregateColumn,
  ModelRelationName,
  NestedRelationPath,
  TypedEagerLoad,
  StrictTypedEagerLoad,
  WithLoadedRelations,
  ExtractStringPaths,
  TypedConstraintCallback,
  LoadMorphRelationName,
} from "./ModelBase.js";
import { ModelQuerying } from "./ModelQuerying.js";

export class ModelAggregates<T extends Record<string, any> = any> extends ModelQuerying<T> {
  // Static aggregate query builders
  static withCount<M extends ModelConstructor>(this: M, relationName: string, alias?: string): Builder<InstanceType<M>> {
    return (this as any).query().withCount(relationName, alias);
  }

  static withExists<M extends ModelConstructor>(this: M, relationOrMap: any, aliasOrCallback?: any, callback?: any): any {
    return (this as any).query().withExists(relationOrMap, aliasOrCallback, callback);
  }

  static withSum<M extends ModelConstructor>(this: M, relationName: string, column: string, aliasOrCallback?: string | EagerLoadConstraint, callback?: EagerLoadConstraint): Builder<InstanceType<M>> {
    return (this as any).query().withSum(relationName, column, aliasOrCallback as any, callback as any);
  }

  static withAvg<M extends ModelConstructor>(this: M, relationName: string, column: string, aliasOrCallback?: string | EagerLoadConstraint, callback?: EagerLoadConstraint): Builder<InstanceType<M>> {
    return (this as any).query().withAvg(relationName, column, aliasOrCallback as any, callback as any);
  }

  static withMin<M extends ModelConstructor>(this: M, relationName: string, column: string, aliasOrCallback?: string | EagerLoadConstraint, callback?: EagerLoadConstraint): Builder<InstanceType<M>> {
    return (this as any).query().withMin(relationName, column, aliasOrCallback as any, callback as any);
  }

  static withMax<M extends ModelConstructor>(this: M, relationName: string, column: string, aliasOrCallback?: string | EagerLoadConstraint, callback?: EagerLoadConstraint): Builder<InstanceType<M>> {
    return (this as any).query().withMax(relationName, column, aliasOrCallback as any, callback as any);
  }

  static async all<M extends ModelConstructor>(this: M): Promise<Collection<InstanceType<M>>> {
    return (this as any).query().get();
  }

  static async count<M extends ModelConstructor>(this: M): Promise<number> {
    return (this as any).query().count();
  }

  static async sum<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>): Promise<NumericAggregate> {
    return (this as any).query().sum(column);
  }

  static async avg<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>): Promise<NumericAggregate> {
    return (this as any).query().avg(column);
  }

  static async average<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>): Promise<NumericAggregate> {
    return (this as any).query().average(column);
  }

  static async min<M extends ModelConstructor, K extends ModelColumn<InstanceType<M>>>(
    this: M,
    column: K
  ): Promise<ModelColumnValue<InstanceType<M>, K> | null> {
    return (this as any).query().min(column);
  }

  static async max<M extends ModelConstructor, K extends ModelColumn<InstanceType<M>>>(
    this: M,
    column: K
  ): Promise<ModelColumnValue<InstanceType<M>, K> | null> {
    return (this as any).query().max(column);
  }

  static async exists<M extends ModelConstructor>(this: M): Promise<boolean> {
    return (this as any).query().exists();
  }

  static async sole<M extends ModelConstructor>(this: M): Promise<InstanceType<M>> {
    return (this as any).query().sole();
  }

  static async valueOrFail<M extends ModelConstructor, K extends ModelColumn<InstanceType<M>>>(
    this: M,
    column: K
  ): Promise<ModelColumnValue<InstanceType<M>, K>> {
    return (this as any).query().valueOrFail(column);
  }

  static async pluck<M extends ModelConstructor, K extends ModelColumn<InstanceType<M>>>(
    this: M,
    column: K
  ): Promise<ModelColumnValue<InstanceType<M>, K>[]>;
  static async pluck<M extends ModelConstructor, K extends ModelColumn<InstanceType<M>>>(
    this: M,
    column: K,
    key: ModelColumn<InstanceType<M>>
  ): Promise<Record<string, ModelColumnValue<InstanceType<M>, K>>>;
  static async pluck<M extends ModelConstructor>(this: M, column: any, key?: any): Promise<any> {
    return key === undefined
      ? (this as any).query().pluck(column)
      : (this as any).query().pluck(column, key);
  }

  static async paginate<M extends ModelConstructor>(this: M, perPage?: number, page?: number): Promise<import("../query/Builder.js").Paginator<InstanceType<M>>> {
    return (this as any).query().paginate(perPage, page);
  }

  static async simplePaginate<M extends ModelConstructor>(this: M, perPage?: number, page?: number): Promise<import("../query/Builder.js").SimplePaginator<InstanceType<M>>> {
    return (this as any).query().simplePaginate(perPage, page);
  }

  static async cursorPaginate<M extends ModelConstructor>(this: M, perPage?: number, cursor?: string | null): Promise<import("../query/Builder.js").CursorPaginator<InstanceType<M>>> {
    return (this as any).query().cursorPaginate(perPage, cursor);
  }

  static async chunk<M extends ModelConstructor>(this: M, count: number, callback: (items: Collection<InstanceType<M>>) => void | Promise<void>): Promise<void> {
    return (this as any).query().chunk(count, callback);
  }

  static async each<M extends ModelConstructor>(this: M, count: number, callback: (item: InstanceType<M>) => void | Promise<void>): Promise<void> {
    return (this as any).query().each(count, callback);
  }

  static async chunkById<M extends ModelConstructor>(this: M, count: number, callback: (items: Collection<InstanceType<M>>) => void | Promise<void>, column?: string): Promise<void> {
    return (this as any).query().chunkById(count, callback as any, column as any);
  }

  static async chunkByIdDesc<M extends ModelConstructor>(this: M, count: number, callback: (items: Collection<InstanceType<M>>) => void | Promise<void>, column?: string): Promise<void> {
    return (this as any).query().chunkByIdDesc(count, callback as any, column as any);
  }

  static async eachById<M extends ModelConstructor>(this: M, count: number, callback: (item: InstanceType<M>) => void | Promise<void>, column?: string): Promise<void> {
    return (this as any).query().eachById(count, callback as any, column as any);
  }

  static cursor<M extends ModelConstructor>(this: M): AsyncGenerator<InstanceType<M>> {
    return (this as any).query().cursor() as AsyncGenerator<InstanceType<M>>;
  }

  static lazy<M extends ModelConstructor>(this: M, count?: number): AsyncGenerator<InstanceType<M>> {
    return (this as any).query().lazy(count) as AsyncGenerator<InstanceType<M>>;
  }

  static lazyById<M extends ModelConstructor>(this: M, count?: number, column?: string): AsyncGenerator<InstanceType<M>> {
    return (this as any).query().lazyById(count, column as any) as AsyncGenerator<InstanceType<M>>;
  }

  // Instance load methods
  async load(...relations: (EagerLoadInput | EagerLoadInput[])[]): Promise<this> {
    const constructor = this.getModelConstructor() as typeof ModelAggregates;
    await constructor.eagerLoadRelations([this] as any, relations as any);
    return this;
  }

  async loadMorph(relationName: string, relations: MorphEagerLoadMap): Promise<this> {
    const constructor = this.getModelConstructor() as typeof ModelAggregates;
    await constructor.loadMorph([this] as any, relationName as string, relations);
    return this;
  }

  async loadCount(relationName: string, alias?: string): Promise<this> {
    const constructor = this.getModelConstructor() as typeof ModelAggregates;
    await constructor.loadCount([this] as any, relationName as string, alias as string | undefined);
    return this as any;
  }

  async loadSum(relationName: string, column: string, aliasOrCallback?: string | AggregateConstraint<this, any>, callback?: AggregateConstraint<this, any>): Promise<any> {
    const constructor = this.getModelConstructor() as typeof ModelAggregates;
    await constructor.loadSum([this] as any, relationName as string, column as string, aliasOrCallback as any, callback as any);
    return this as any;
  }

  async loadAvg(relationName: string, column: string, aliasOrCallback?: string | AggregateConstraint<this, any>, callback?: AggregateConstraint<this, any>): Promise<any> {
    const constructor = this.getModelConstructor() as typeof ModelAggregates;
    await constructor.loadAvg([this] as any, relationName as string, column as string, aliasOrCallback as any, callback as any);
    return this as any;
  }

  async loadMin(relationName: string, column: string, aliasOrCallback?: string | AggregateConstraint<this, any>, callback?: AggregateConstraint<this, any>): Promise<any> {
    const constructor = this.getModelConstructor() as typeof ModelAggregates;
    await constructor.loadMin([this] as any, relationName as string, column as string, aliasOrCallback as any, callback as any);
    return this as any;
  }

  async loadMax(relationName: string, column: string, aliasOrCallback?: string | AggregateConstraint<this, any>, callback?: AggregateConstraint<this, any>): Promise<any> {
    const constructor = this.getModelConstructor() as typeof ModelAggregates;
    await constructor.loadMax([this] as any, relationName as string, column as string, aliasOrCallback as any, callback as any);
    return this as any;
  }
}
