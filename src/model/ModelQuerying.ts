import { Builder, type LikeOptions } from "../query/Builder.js";
import { Collection } from "../support/Collection.js";
import type {
  ModelConstructor,
  EagerLoadConstraint,
  EagerLoadDefinition,
  MorphEagerLoadMap,
  LiteralUnion,
  TypedConstraintMap,
  TypedConstraintSelection,
  TypedExistsConstraintMap,
  TypedEagerLoad,
  WithLoadedRelations,
  WithLoadedRelationsFromConstraintMap,
  WithRelationCount,
  WithRelationExists,
  WithRelationExistsMap,
  AggregateAlias,
  AggregateConstraint,
  AggregateColumn,
  RelationConstraintQuery,
  MorphToRelationName,
  ModelRelationName,
  RelationRelatedModel,
  MorphToConstraintCallback,
  BelongsToRelationName,
  AttachedToRelationName,
  NestedRelationPath,
  ExtractStringPaths,
  TypedConstraintCallback,
  ModelColumn,
  ModelColumnValue,
} from "./ModelBase.js";
import { ModelRelations } from "./ModelRelations.js";

export class ModelQuerying<T extends Record<string, any> = any> extends ModelRelations<T> {
  static where<M extends ModelConstructor>(this: M, column: any, operator?: any, value?: any): Builder<InstanceType<M>> {
    return (this as any).query().where(column as any, operator, value);
  }

  static whereKey<M extends ModelConstructor>(this: M, value: any | any[]): Builder<InstanceType<M>> {
    return (this as any).query().whereKey(value);
  }

  static whereKeyNot<M extends ModelConstructor>(this: M, value: any | any[]): Builder<InstanceType<M>> {
    return (this as any).query().whereKeyNot(value);
  }

  static forPage<M extends ModelConstructor>(this: M, page: number, perPage: number = 15): Builder<InstanceType<M>> {
    return (this as any).query().forPage(page, perPage);
  }

  static orderBy<M extends ModelConstructor>(this: M, column: any, direction?: "asc" | "desc"): Builder<InstanceType<M>> {
    return (this as any).query().orderBy(column, direction);
  }

  static orderByRaw<M extends ModelConstructor>(this: M, sql: string, bindings: readonly unknown[] = []): Builder<InstanceType<M>> {
    return (this as any).query().orderByRaw(sql, bindings);
  }

  static groupByRaw<M extends ModelConstructor>(this: M, sql: string, bindings: readonly unknown[] = []): Builder<InstanceType<M>> {
    return (this as any).query().groupByRaw(sql, bindings);
  }

  static orderByDesc<M extends ModelConstructor>(this: M, column: any): Builder<InstanceType<M>> {
    return (this as any).query().orderByDesc(column);
  }

  static reorder<M extends ModelConstructor>(this: M, column?: any, direction?: "asc" | "desc"): Builder<InstanceType<M>> {
    return (this as any).query().reorder(column, direction);
  }

  static reorderDesc<M extends ModelConstructor>(this: M, column?: any): Builder<InstanceType<M>> {
    return (this as any).query().reorderDesc(column);
  }

  static groupBy<M extends ModelConstructor>(this: M, ...columns: any[]): Builder<InstanceType<M>> {
    return (this as any).query().groupBy(...columns);
  }

  static having<M extends ModelConstructor>(this: M, column: any, operator: string, value: any): Builder<InstanceType<M>> {
    return (this as any).query().having(column, operator, value);
  }

  static orHaving<M extends ModelConstructor>(this: M, column: any, operator: string, value: any): Builder<InstanceType<M>> {
    return (this as any).query().orHaving(column, operator, value);
  }

  static havingRaw<M extends ModelConstructor>(this: M, sql: string, bindings: readonly unknown[] = []): Builder<InstanceType<M>> {
    return (this as any).query().havingRaw(sql, bindings);
  }

  static orHavingRaw<M extends ModelConstructor>(this: M, sql: string, bindings: readonly unknown[] = []): Builder<InstanceType<M>> {
    return (this as any).query().orHavingRaw(sql, bindings);
  }

  static havingBetween<M extends ModelConstructor>(this: M, column: any, values: readonly [any, any]): Builder<InstanceType<M>> {
    return (this as any).query().havingBetween(column, values);
  }

  static havingNotBetween<M extends ModelConstructor>(this: M, column: any, values: readonly [any, any]): Builder<InstanceType<M>> {
    return (this as any).query().havingNotBetween(column, values);
  }

  static orHavingBetween<M extends ModelConstructor>(this: M, column: any, values: readonly [any, any]): Builder<InstanceType<M>> {
    return (this as any).query().orHavingBetween(column, values);
  }

  static orHavingNotBetween<M extends ModelConstructor>(this: M, column: any, values: readonly [any, any]): Builder<InstanceType<M>> {
    return (this as any).query().orHavingNotBetween(column, values);
  }

  static select<M extends ModelConstructor>(this: M, ...columns: any[]): Builder<InstanceType<M>> {
    return (this as any).query().select(...columns);
  }

  static addSelect<M extends ModelConstructor>(this: M, ...columns: any[]): Builder<InstanceType<M>> {
    return (this as any).query().addSelect(...columns);
  }

  static selectRaw<M extends ModelConstructor>(this: M, sql: string, bindings: readonly unknown[] = []): Builder<InstanceType<M>> {
    return (this as any).query().selectRaw(sql, bindings);
  }

  static from<M extends ModelConstructor>(this: M, table: string): Builder<InstanceType<M>> {
    return (this as any).query().from(table);
  }

  static fromSub<M extends ModelConstructor>(this: M, query: Builder<any>, alias: string): Builder<InstanceType<M>> {
    return (this as any).query().fromSub(query, alias);
  }

  static withRecursive<M extends ModelConstructor>(this: M, name: string, anchor: Builder<any> | string, recursive: Builder<any> | string): Builder<InstanceType<M>> {
    return (this as any).query().withRecursive(name, anchor, recursive);
  }

  static recursive<M extends ModelConstructor>(this: M, parentColumn: string): Builder<InstanceType<M>>;
  static recursive<M extends ModelConstructor>(this: M, parentColumn: string, startingId: any): Builder<InstanceType<M>>;
  static recursive<M extends ModelConstructor>(this: M, parentColumn: string, startingIds: any[]): Builder<InstanceType<M>>;
  static recursive<M extends ModelConstructor>(this: M, parentColumn: string, startingPoint?: any | any[]): Builder<InstanceType<M>> {
    return (this as any).query().recursive(parentColumn, startingPoint);
  }

  static descendants<M extends ModelConstructor>(this: M): Builder<InstanceType<M>>;
  static descendants<M extends ModelConstructor>(this: M, startingId: any): Builder<InstanceType<M>>;
  static descendants<M extends ModelConstructor>(this: M, startingIds: any[]): Builder<InstanceType<M>>;
  static descendants<M extends ModelConstructor>(this: M, startingPoint?: any | any[]): Builder<InstanceType<M>> {
    return (this as any).query().descendants(startingPoint);
  }

  static ancestors<M extends ModelConstructor>(this: M): Builder<InstanceType<M>>;
  static ancestors<M extends ModelConstructor>(this: M, startingId: any): Builder<InstanceType<M>>;
  static ancestors<M extends ModelConstructor>(this: M, startingIds: any[]): Builder<InstanceType<M>>;
  static ancestors<M extends ModelConstructor>(this: M, startingPoint?: any | any[]): Builder<InstanceType<M>> {
    return (this as any).query().ancestors(startingPoint);
  }

  static includeRoot<M extends ModelConstructor>(this: M): Builder<InstanceType<M>> {
    return (this as any).query().includeRoot();
  }

  static excludeRoot<M extends ModelConstructor>(this: M): Builder<InstanceType<M>> {
    return (this as any).query().excludeRoot();
  }

  static orderByDepth<M extends ModelConstructor>(this: M, direction?: "asc" | "desc"): Builder<InstanceType<M>> {
    return (this as any).query().orderByDepth(direction);
  }

  static breadthFirst<M extends ModelConstructor>(this: M): Builder<InstanceType<M>> {
    return (this as any).query().breadthFirst();
  }

  static depthFirst<M extends ModelConstructor>(this: M): Builder<InstanceType<M>> {
    return (this as any).query().depthFirst();
  }

  static path<M extends ModelConstructor>(this: M, column?: string, alias?: string, delimiter?: string): Builder<InstanceType<M>> {
    return (this as any).query().path(column, alias, delimiter);
  }

  static hasChildren<M extends ModelConstructor>(this: M, alias?: string): Builder<InstanceType<M>> {
    return (this as any).query().hasChildren(alias);
  }

  static leaf<M extends ModelConstructor>(this: M, alias?: string): Builder<InstanceType<M>> {
    return (this as any).query().leaf(alias);
  }

  static cycleGuard<M extends ModelConstructor>(this: M, maxDepth?: number): Builder<InstanceType<M>> {
    return (this as any).query().cycleGuard(maxDepth);
  }

  static distinct<M extends ModelConstructor>(this: M): Builder<InstanceType<M>> {
    return (this as any).query().distinct();
  }

  static whereIn<M extends ModelConstructor>(this: M, column: any, values: any[]): Builder<InstanceType<M>> {
    return (this as any).query().whereIn(column, values);
  }

  static whereNotIn<M extends ModelConstructor>(this: M, column: any, values: any[]): Builder<InstanceType<M>> {
    return (this as any).query().whereNotIn(column, values);
  }

  static whereNull<M extends ModelConstructor>(this: M, column: any): Builder<InstanceType<M>> {
    return (this as any).query().whereNull(column);
  }

  static whereNotNull<M extends ModelConstructor>(this: M, column: any): Builder<InstanceType<M>> {
    return (this as any).query().whereNotNull(column);
  }

  static whereBetween<M extends ModelConstructor>(this: M, column: any, values: [any, any]): Builder<InstanceType<M>> {
    return (this as any).query().whereBetween(column, values);
  }

  static whereNotBetween<M extends ModelConstructor>(this: M, column: any, values: [any, any]): Builder<InstanceType<M>> {
    return (this as any).query().whereNotBetween(column, values);
  }

  static whereBetweenColumns<M extends ModelConstructor>(this: M, column: any, values: readonly [any, any]): Builder<InstanceType<M>> {
    return (this as any).query().whereBetweenColumns(column, values);
  }

  static whereNotBetweenColumns<M extends ModelConstructor>(this: M, column: any, values: readonly [any, any]): Builder<InstanceType<M>> {
    return (this as any).query().whereNotBetweenColumns(column, values);
  }

  static whereRaw<M extends ModelConstructor>(this: M, sql: string, bindings: readonly unknown[] = []): Builder<InstanceType<M>> {
    return (this as any).query().whereRaw(sql, bindings);
  }

  static whereColumn<M extends ModelConstructor>(this: M, first: string, operator: string, second: string): Builder<InstanceType<M>> {
    return (this as any).query().whereColumn(first, operator, second);
  }

  static whereExists<M extends ModelConstructor>(this: M, sql: string): Builder<InstanceType<M>> {
    return (this as any).query().whereExists(sql);
  }

  static whereNotExists<M extends ModelConstructor>(this: M, sql: string): Builder<InstanceType<M>> {
    return (this as any).query().whereNotExists(sql);
  }

  static orWhere<M extends ModelConstructor>(this: M, column: any, operator?: any, value?: any): Builder<InstanceType<M>> {
    return (this as any).query().orWhere(column as any, operator, value);
  }

  static whereNot<M extends ModelConstructor>(this: M, column: any, value?: any): Builder<InstanceType<M>> {
    return (this as any).query().whereNot(column as any, value);
  }

  static orWhereNot<M extends ModelConstructor>(this: M, column: any, value?: any): Builder<InstanceType<M>> {
    return (this as any).query().orWhereNot(column as any, value);
  }

  static orWhereIn<M extends ModelConstructor>(this: M, column: any, values: any[]): Builder<InstanceType<M>> {
    return (this as any).query().orWhereIn(column, values);
  }

  static orWhereNotIn<M extends ModelConstructor>(this: M, column: any, values: any[]): Builder<InstanceType<M>> {
    return (this as any).query().orWhereNotIn(column, values);
  }

  static orWhereNull<M extends ModelConstructor>(this: M, column: any): Builder<InstanceType<M>> {
    return (this as any).query().orWhereNull(column);
  }

  static orWhereNotNull<M extends ModelConstructor>(this: M, column: any): Builder<InstanceType<M>> {
    return (this as any).query().orWhereNotNull(column);
  }

  static orWhereBetween<M extends ModelConstructor>(this: M, column: any, values: [any, any]): Builder<InstanceType<M>> {
    return (this as any).query().orWhereBetween(column, values);
  }

  static orWhereNotBetween<M extends ModelConstructor>(this: M, column: any, values: [any, any]): Builder<InstanceType<M>> {
    return (this as any).query().orWhereNotBetween(column, values);
  }

  static orWhereBetweenColumns<M extends ModelConstructor>(this: M, column: any, values: readonly [any, any]): Builder<InstanceType<M>> {
    return (this as any).query().orWhereBetweenColumns(column, values);
  }

  static orWhereNotBetweenColumns<M extends ModelConstructor>(this: M, column: any, values: readonly [any, any]): Builder<InstanceType<M>> {
    return (this as any).query().orWhereNotBetweenColumns(column, values);
  }

  static orWhereRaw<M extends ModelConstructor>(this: M, sql: string): Builder<InstanceType<M>> {
    return (this as any).query().orWhereRaw(sql);
  }

  static orWhereColumn<M extends ModelConstructor>(this: M, first: string, operator: string, second: string): Builder<InstanceType<M>> {
    return (this as any).query().orWhereColumn(first, operator, second);
  }

  static orWhereExists<M extends ModelConstructor>(this: M, sql: string): Builder<InstanceType<M>> {
    return (this as any).query().orWhereExists(sql);
  }

  static orWhereNotExists<M extends ModelConstructor>(this: M, sql: string): Builder<InstanceType<M>> {
    return (this as any).query().orWhereNotExists(sql);
  }

  static whereDate<M extends ModelConstructor>(this: M, column: any, operator?: any, value?: any): Builder<InstanceType<M>> {
    return (this as any).query().whereDate(column, operator, value);
  }

  static orWhereDate<M extends ModelConstructor>(this: M, column: any, operator?: any, value?: any): Builder<InstanceType<M>> {
    return (this as any).query().orWhereDate(column, operator, value);
  }

  static whereDay<M extends ModelConstructor>(this: M, column: any, operator?: any, value?: any): Builder<InstanceType<M>> {
    return (this as any).query().whereDay(column, operator, value);
  }

  static orWhereDay<M extends ModelConstructor>(this: M, column: any, operator?: any, value?: any): Builder<InstanceType<M>> {
    return (this as any).query().orWhereDay(column, operator, value);
  }

  static whereMonth<M extends ModelConstructor>(this: M, column: any, operator?: any, value?: any): Builder<InstanceType<M>> {
    return (this as any).query().whereMonth(column, operator, value);
  }

  static orWhereMonth<M extends ModelConstructor>(this: M, column: any, operator?: any, value?: any): Builder<InstanceType<M>> {
    return (this as any).query().orWhereMonth(column, operator, value);
  }

  static whereYear<M extends ModelConstructor>(this: M, column: any, operator?: any, value?: any): Builder<InstanceType<M>> {
    return (this as any).query().whereYear(column, operator, value);
  }

  static orWhereYear<M extends ModelConstructor>(this: M, column: any, operator?: any, value?: any): Builder<InstanceType<M>> {
    return (this as any).query().orWhereYear(column, operator, value);
  }

  static whereTime<M extends ModelConstructor>(this: M, column: any, operator?: any, value?: any): Builder<InstanceType<M>> {
    return (this as any).query().whereTime(column, operator, value);
  }

  static orWhereTime<M extends ModelConstructor>(this: M, column: any, operator?: any, value?: any): Builder<InstanceType<M>> {
    return (this as any).query().orWhereTime(column, operator, value);
  }

  static wherePast<M extends ModelConstructor>(this: M, columns: any | readonly any[]): Builder<InstanceType<M>> {
    return (this as any).query().wherePast(columns);
  }

  static whereNowOrPast<M extends ModelConstructor>(this: M, columns: any | readonly any[]): Builder<InstanceType<M>> {
    return (this as any).query().whereNowOrPast(columns);
  }

  static whereFuture<M extends ModelConstructor>(this: M, columns: any | readonly any[]): Builder<InstanceType<M>> {
    return (this as any).query().whereFuture(columns);
  }

  static whereNowOrFuture<M extends ModelConstructor>(this: M, columns: any | readonly any[]): Builder<InstanceType<M>> {
    return (this as any).query().whereNowOrFuture(columns);
  }

  static whereToday<M extends ModelConstructor>(this: M, columns: any | readonly any[]): Builder<InstanceType<M>> {
    return (this as any).query().whereToday(columns);
  }

  static whereBeforeToday<M extends ModelConstructor>(this: M, columns: any | readonly any[]): Builder<InstanceType<M>> {
    return (this as any).query().whereBeforeToday(columns);
  }

  static whereAfterToday<M extends ModelConstructor>(this: M, columns: any | readonly any[]): Builder<InstanceType<M>> {
    return (this as any).query().whereAfterToday(columns);
  }

  static whereTodayOrBefore<M extends ModelConstructor>(this: M, columns: any | readonly any[]): Builder<InstanceType<M>> {
    return (this as any).query().whereTodayOrBefore(columns);
  }

  static whereTodayOrAfter<M extends ModelConstructor>(this: M, columns: any | readonly any[]): Builder<InstanceType<M>> {
    return (this as any).query().whereTodayOrAfter(columns);
  }

  static whereJsonContains<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, value: any): Builder<InstanceType<M>> {
    return (this as any).query().whereJsonContains(column, value);
  }

  static whereJsonDoesntContain<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, value: any): Builder<InstanceType<M>> {
    return (this as any).query().whereJsonDoesntContain(column, value);
  }

  static orWhereJsonContains<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, value: any): Builder<InstanceType<M>> {
    return (this as any).query().orWhereJsonContains(column, value);
  }

  static orWhereJsonDoesntContain<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, value: any): Builder<InstanceType<M>> {
    return (this as any).query().orWhereJsonDoesntContain(column, value);
  }

  static whereJsonLength<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, value: number): Builder<InstanceType<M>>;
  static whereJsonLength<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, operator: string, value: number): Builder<InstanceType<M>>;
  static whereJsonLength<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, operatorOrValue: string | number, value?: number): Builder<InstanceType<M>> {
    return value === undefined
      ? (this as any).query().whereJsonLength(column, operatorOrValue)
      : (this as any).query().whereJsonLength(column, operatorOrValue, value);
  }

  static orWhereJsonLength<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, value: number): Builder<InstanceType<M>>;
  static orWhereJsonLength<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, operator: string, value: number): Builder<InstanceType<M>>;
  static orWhereJsonLength<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, operatorOrValue: string | number, value?: number): Builder<InstanceType<M>> {
    return value === undefined
      ? (this as any).query().orWhereJsonLength(column, operatorOrValue)
      : (this as any).query().orWhereJsonLength(column, operatorOrValue, value);
  }

  static whereLike<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, value: string, options?: LikeOptions): Builder<InstanceType<M>> {
    return (this as any).query().whereLike(column, value, options);
  }

  static whereNotLike<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, value: string, options?: LikeOptions): Builder<InstanceType<M>> {
    return (this as any).query().whereNotLike(column, value, options);
  }

  static orWhereLike<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, value: string, options?: LikeOptions): Builder<InstanceType<M>> {
    return (this as any).query().orWhereLike(column, value, options);
  }

  static orWhereNotLike<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, value: string, options?: LikeOptions): Builder<InstanceType<M>> {
    return (this as any).query().orWhereNotLike(column, value, options);
  }

  static whereRegexp<M extends ModelConstructor>(this: M, column: ModelColumn<InstanceType<M>>, value: string): Builder<InstanceType<M>> {
    return (this as any).query().whereRegexp(column, value);
  }

  static whereFullText<M extends ModelConstructor>(this: M, columns: ModelColumn<InstanceType<M>> | readonly ModelColumn<InstanceType<M>>[], value: string): Builder<InstanceType<M>> {
    return (this as any).query().whereFullText(columns, value);
  }

  static orWhereFullText<M extends ModelConstructor>(this: M, columns: ModelColumn<InstanceType<M>> | readonly ModelColumn<InstanceType<M>>[], value: string): Builder<InstanceType<M>> {
    return (this as any).query().orWhereFullText(columns, value);
  }

  static whereAll<M extends ModelConstructor>(this: M, columns: any[], operator: string, value: any): Builder<InstanceType<M>> {
    return (this as any).query().whereAll(columns, operator, value);
  }

  static whereAny<M extends ModelConstructor>(this: M, columns: any[], operator: string, value: any): Builder<InstanceType<M>> {
    return (this as any).query().whereAny(columns, operator, value);
  }

  static whereNone<M extends ModelConstructor>(this: M, columns: any[], operator: string, value: any): Builder<InstanceType<M>> {
    return (this as any).query().whereNone(columns, operator, value);
  }

  static orWhereAny<M extends ModelConstructor>(this: M, columns: any[], operator: string, value: any): Builder<InstanceType<M>> {
    return (this as any).query().orWhereAny(columns, operator, value);
  }

  static orWhereAll<M extends ModelConstructor>(this: M, columns: any[], operator: string, value: any): Builder<InstanceType<M>> {
    return (this as any).query().orWhereAll(columns, operator, value);
  }

  static orWhereNone<M extends ModelConstructor>(this: M, columns: any[], operator: string, value: any): Builder<InstanceType<M>> {
    return (this as any).query().orWhereNone(columns, operator, value);
  }

  static latest<M extends ModelConstructor>(this: M, column?: any): Builder<InstanceType<M>> {
    return (this as any).query().latest(column);
  }

  static oldest<M extends ModelConstructor>(this: M, column?: any): Builder<InstanceType<M>> {
    return (this as any).query().oldest(column);
  }

  static when<M extends ModelConstructor, TValue>(this: M, value: TValue | ((query: Builder<InstanceType<M>>) => TValue), callback: (query: Builder<InstanceType<M>>, value: NonNullable<TValue>) => void | Builder<InstanceType<M>>, defaultCallback?: (query: Builder<InstanceType<M>>, value: TValue) => void | Builder<InstanceType<M>>): Builder<InstanceType<M>> {
    return (this as any).query().when(value, callback, defaultCallback);
  }

  static unless<M extends ModelConstructor, TValue>(this: M, value: TValue | ((query: Builder<InstanceType<M>>) => TValue), callback: (query: Builder<InstanceType<M>>, value: TValue) => void | Builder<InstanceType<M>>, defaultCallback?: (query: Builder<InstanceType<M>>, value: NonNullable<TValue>) => void | Builder<InstanceType<M>>): Builder<InstanceType<M>> {
    return (this as any).query().unless(value, callback, defaultCallback);
  }

  static tap<M extends ModelConstructor>(this: M, callback: (query: Builder<InstanceType<M>>) => void | Builder<InstanceType<M>>): Builder<InstanceType<M>> {
    return (this as any).query().tap(callback);
  }

  static pipe<M extends ModelConstructor, R>(this: M, callback: (query: Builder<InstanceType<M>>) => R): R {
    return (this as any).query().pipe(callback);
  }

  static dump<M extends ModelConstructor>(this: M): Builder<InstanceType<M>> {
    return (this as any).query().dump();
  }

  static dd<M extends ModelConstructor>(this: M): never {
    return (this as any).query().dd() as never;
  }

  static explain<M extends ModelConstructor>(this: M): Promise<any[]> {
    return (this as any).query().explain();
  }

  static toSql<M extends ModelConstructor>(this: M): string {
    return (this as any).query().toSql();
  }

  static toRawSql<M extends ModelConstructor>(this: M): string {
    return (this as any).query().toRawSql();
  }

  static take<M extends ModelConstructor>(this: M, count: number): Builder<InstanceType<M>> {
    return (this as any).query().take(count);
  }

  static skip<M extends ModelConstructor>(this: M, count: number): Builder<InstanceType<M>> {
    return (this as any).query().skip(count);
  }

  static limit<M extends ModelConstructor>(this: M, count: number): Builder<InstanceType<M>> {
    return (this as any).query().limit(count);
  }

  static offset<M extends ModelConstructor>(this: M, count: number): Builder<InstanceType<M>> {
    return (this as any).query().offset(count);
  }

  static inRandomOrder<M extends ModelConstructor>(this: M): Builder<InstanceType<M>> {
    return (this as any).query().inRandomOrder();
  }

  static lockForUpdate<M extends ModelConstructor>(this: M): Builder<InstanceType<M>> {
    return (this as any).query().lockForUpdate();
  }

  static sharedLock<M extends ModelConstructor>(this: M): Builder<InstanceType<M>> {
    return (this as any).query().sharedLock();
  }

  static with<M extends ModelConstructor>(this: M, ...relations: any[]): any {
    return (this as any).query().with(...relations) as any;
  }

  static withTrashed<M extends ModelConstructor>(this: M): Builder<InstanceType<M>> {
    return (this as any).query().withTrashed();
  }

  static withoutTrashed<M extends ModelConstructor>(this: M): Builder<InstanceType<M>> {
    return (this as any).query().withoutTrashed();
  }

  static onlyTrashed<M extends ModelConstructor>(this: M): Builder<InstanceType<M>> {
    return (this as any).query().onlyTrashed();
  }

  static withoutGlobalScope<M extends ModelConstructor>(this: M, scope: string): Builder<InstanceType<M>> {
    return (this as any).query().withoutGlobalScope(scope);
  }

  static withoutGlobalScopes<M extends ModelConstructor>(this: M): Builder<InstanceType<M>> {
    return (this as any).query().withoutGlobalScopes();
  }

  static scope<M extends ModelConstructor>(this: M, name: string, ...args: any[]): Builder<InstanceType<M>> {
    return (this as any).query().scope(name, ...args);
  }

  static has<M extends ModelConstructor>(this: M, relationName: string, operator?: string, count?: number): Builder<InstanceType<M>> {
    return (this as any).query().has(relationName as any, operator as any, count as any);
  }

  static orHas<M extends ModelConstructor>(this: M, relationName: string, operator?: string, count?: number): Builder<InstanceType<M>> {
    return (this as any).query().orHas(relationName as any, operator as any, count as any);
  }

  static whereHas<M extends ModelConstructor>(this: M, relationName: string, callback?: (query: Builder<any>) => void | Builder<any>, operator?: string, count?: number): Builder<InstanceType<M>> {
    return (this as any).query().whereHas(relationName as any, callback as any, operator as any, count as any);
  }

  static orWhereHas<M extends ModelConstructor>(this: M, relationName: string, callback?: (query: Builder<any>) => void | Builder<any>, operator?: string, count?: number): Builder<InstanceType<M>> {
    return (this as any).query().orWhereHas(relationName as any, callback as any, operator as any, count as any);
  }

  static doesntHave<M extends ModelConstructor>(this: M, relationName: string): Builder<InstanceType<M>> {
    return (this as any).query().doesntHave(relationName as any);
  }

  static orDoesntHave<M extends ModelConstructor>(this: M, relationName: string): Builder<InstanceType<M>> {
    return (this as any).query().orDoesntHave(relationName as any);
  }

  static whereDoesntHave<M extends ModelConstructor>(this: M, relationName: string, callback?: (query: Builder<any>) => void | Builder<any>): Builder<InstanceType<M>> {
    return (this as any).query().whereDoesntHave(relationName as any, callback as any);
  }

  static orWhereDoesntHave<M extends ModelConstructor>(this: M, relationName: string, callback?: (query: Builder<any>) => void | Builder<any>): Builder<InstanceType<M>> {
    return (this as any).query().orWhereDoesntHave(relationName as any, callback as any);
  }

  static whereHasMorph<M extends ModelConstructor>(this: M, relationName: string, types: string | string[] | ModelConstructor | ModelConstructor[], callback?: EagerLoadConstraint, operator?: string, count?: number): Builder<InstanceType<M>> {
    return (this as any).query().whereHasMorph(relationName as any, types as any, callback as any, operator as any, count as any);
  }

  static whereDoesntHaveMorph<M extends ModelConstructor>(this: M, relationName: string, types: string | string[] | ModelConstructor | ModelConstructor[], callback?: EagerLoadConstraint): Builder<InstanceType<M>> {
    return (this as any).query().whereDoesntHaveMorph(relationName as any, types as any, callback as any);
  }

  static whereMorphRelation<M extends ModelConstructor>(this: M, relationName: string, types: string | string[] | ModelConstructor | ModelConstructor[], column: string, operator: any, value?: any): Builder<InstanceType<M>> {
    return (this as any).query().whereMorphRelation(relationName as any, types as any, column, operator, value);
  }

  static whereMorphedTo<M extends ModelConstructor>(this: M, relationName: string, model: any): Builder<InstanceType<M>> {
    return (this as any).query().whereMorphedTo(relationName as any, model as any);
  }

  static orWhereMorphedTo<M extends ModelConstructor>(this: M, relationName: string, model: any): Builder<InstanceType<M>> {
    return (this as any).query().orWhereMorphedTo(relationName as any, model as any);
  }

  static whereNotMorphedTo<M extends ModelConstructor>(this: M, relationName: string, model: any): Builder<InstanceType<M>> {
    return (this as any).query().whereNotMorphedTo(relationName as any, model as any);
  }

  static orWhereNotMorphedTo<M extends ModelConstructor>(this: M, relationName: string, model: any): Builder<InstanceType<M>> {
    return (this as any).query().orWhereNotMorphedTo(relationName as any, model as any);
  }

  static whereRelation<M extends ModelConstructor>(this: M, relationName: string, column: any, operator: any, value?: any): Builder<InstanceType<M>> {
    return (this as any).query().whereRelation(relationName, column, operator, value);
  }

  static whereBelongsTo<M extends ModelConstructor>(this: M, relationName: string, model: any): Builder<InstanceType<M>> {
    return (this as any).query().whereBelongsTo(relationName as any, model as any);
  }

  static orWhereBelongsTo<M extends ModelConstructor>(this: M, relationName: string, model: any): Builder<InstanceType<M>> {
    return (this as any).query().orWhereBelongsTo(relationName as any, model as any);
  }

  static whereAttachedTo<M extends ModelConstructor>(this: M, relationName: string, model: any): Builder<InstanceType<M>> {
    return (this as any).query().whereAttachedTo(relationName as any, model as any);
  }

  static orWhereAttachedTo<M extends ModelConstructor>(this: M, relationName: string, model: any): Builder<InstanceType<M>> {
    return (this as any).query().orWhereAttachedTo(relationName as any, model as any);
  }

  static orWhereRelation<M extends ModelConstructor>(this: M, relationName: string, column: any, operator: any, value?: any): Builder<InstanceType<M>> {
    return (this as any).query().orWhereRelation(relationName, column, operator, value);
  }

  static whereDoesntHaveRelation<M extends ModelConstructor>(this: M, relationName: string, column: any, operator: any, value?: any): Builder<InstanceType<M>> {
    return (this as any).query().whereDoesntHaveRelation(relationName, column, operator, value);
  }

  static orWhereDoesntHaveRelation<M extends ModelConstructor>(this: M, relationName: string, column: any, operator: any, value?: any): Builder<InstanceType<M>> {
    return (this as any).query().orWhereDoesntHaveRelation(relationName, column, operator, value);
  }

  static withWhereRelation<M extends ModelConstructor>(this: M, relationName: string, column: any, operator: any, value?: any): Builder<InstanceType<M>> {
    return (this as any).query().withWhereRelation(relationName, column, operator, value);
  }

  static withWhereHas<M extends ModelConstructor>(this: M, relation: any, callback?: (query: Builder<any>) => void | Builder<any>): Builder<InstanceType<M>> {
    return (this as any).query().withWhereHas(relation, callback) as any;
  }
}
