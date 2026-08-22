import type { DotPaths, DeepPick } from "../model/ModelBase.js";
import type { NumericAggregate } from "../query/Builder.js";
import type {
  AggregateAlias,
  AggregateColumn,
  AggregateConstraint,
  AggregateLoaded,
  AggregateValueForRelation,
  LoadMorphRelationName,
  Model,
  MorphEagerLoadMap,
  ModelRelationName,
  NestedRelationPath,
} from "../model/Model.js";

type CollectionKey = string | number | symbol;

type CollectionPredicate<T> = (item: T, index: number) => boolean;
export type CollectionJson<T> = T extends { toJSON(): infer R } ? R[] : T[];
type ItemJson<T> = T extends { toJSON(): infer R } ? R : T;

function deepPickCollection(obj: Record<string, any>, paths: string[]): Record<string, any> {
  const groups = new Map<string, string[]>();
  for (const path of paths) {
    const dot = path.indexOf(".");
    if (dot === -1) {
      if (!groups.has(path)) groups.set(path, []);
    } else {
      const root = path.slice(0, dot);
      const tail = path.slice(dot + 1);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(tail);
    }
  }
  const result: Record<string, any> = {};
  for (const [root, tails] of groups) {
    const val = obj[root];
    if (tails.length === 0) {
      result[root] = val;
    } else if (val === null || val === undefined) {
      result[root] = val;
    } else if (Array.isArray(val)) {
      result[root] = val.map(item => deepPickCollection(item, tails));
    } else if (typeof val === "object") {
      result[root] = deepPickCollection(val, tails);
    } else {
      result[root] = val;
    }
  }
  return result;
}

function valueFor(item: any, key: CollectionKey): any {
  if (typeof key === "symbol") return item?.[key];
  const path = String(key);
  if (!path.includes(".")) {
    if (item && typeof item.getAttribute === "function") {
      const value = item.getAttribute(path);
      if (value !== undefined) return value;
    }
    return item?.[path];
  }
  return path.split(".").reduce((value, part) => {
    if (value && typeof value.getAttribute === "function") {
      const attribute = value.getAttribute(part);
      if (attribute !== undefined) return attribute;
    }
    return value?.[part];
  }, item);
}

function compareValues(a: any, b: any): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  return a > b ? 1 : -1;
}

export class Collection<T = any> extends Array<T> {
  declare protected readonly __collection: void;

  constructor(items?: Iterable<T> | ArrayLike<T> | number) {
    if (typeof items === "number") {
      super(items);
      return;
    }
    super();
    if (items) {
      this.push(...Array.from(items as Iterable<T> | ArrayLike<T>));
    }
  }

  static make<T>(items?: Iterable<T> | ArrayLike<T> | null): Collection<T> {
    return new Collection<T>(items || []);
  }

  all(): T[] {
    return Array.from(this);
  }

  toArray(): T[] {
    return this.all();
  }

  toJSON(): CollectionJson<T> {
    return this.map((item: any) => typeof item?.toJSON === "function" ? item.toJSON() : item) as CollectionJson<T>;
  }

  json(): CollectionJson<T>;
  json<P extends DotPaths<ItemJson<T>>>(...paths: P[]): DeepPick<ItemJson<T>, P>[];
  json<P extends DotPaths<ItemJson<T>>>(...paths: P[]): any {
    if (paths.length === 0) return this.toJSON();
    return this.map((item: any) => {
      const full = typeof item?.toJSON === "function" ? item.toJSON() : item;
      return deepPickCollection(full, paths as string[]);
    });
  }

  isEmpty(): boolean {
    return this.length === 0;
  }

  isNotEmpty(): boolean {
    return this.length > 0;
  }

  first(predicate?: CollectionPredicate<T>, defaultValue: T | null = null): T | null {
    if (!predicate) return this[0] ?? defaultValue;
    for (let index = 0; index < this.length; index++) {
      const item = this[index];
      if (predicate(item, index)) return item;
    }
    return defaultValue;
  }

  last(predicate?: CollectionPredicate<T>, defaultValue: T | null = null): T | null {
    if (!predicate) return this.length > 0 ? this[this.length - 1] : defaultValue;
    for (let index = this.length - 1; index >= 0; index--) {
      const item = this[index];
      if (predicate(item, index)) return item;
    }
    return defaultValue;
  }

  get(index: number, defaultValue: T | null = null): T | null {
    return index in this ? this[index] : defaultValue;
  }

  each(callback: (item: T, index: number) => void): this {
    this.forEach(callback);
    return this;
  }

  reject(predicate: CollectionPredicate<T>): Collection<T> {
    return new Collection(this.filter((item, index) => !predicate(item, index)));
  }

  pluck<K extends CollectionKey>(key: K): Collection<any> {
    return new Collection(this.map((item) => valueFor(item, key)));
  }

  keyBy<K extends CollectionKey>(key: K | ((item: T, index: number) => CollectionKey)): Record<string, T> {
    return this.reduce<Record<string, T>>((result, item, index) => {
      const value = typeof key === "function" ? key(item, index) : valueFor(item, key);
      result[String(value)] = item;
      return result;
    }, {});
  }

  groupBy<K extends CollectionKey>(key: K | ((item: T, index: number) => CollectionKey)): Record<string, Collection<T>> {
    return this.reduce<Record<string, Collection<T>>>((result, item, index) => {
      const value = typeof key === "function" ? key(item, index) : valueFor(item, key);
      const groupKey = String(value);
      if (!result[groupKey]) result[groupKey] = new Collection<T>();
      result[groupKey].push(item);
      return result;
    }, {});
  }

  sortBy<K extends CollectionKey>(key: K | ((item: T) => any)): Collection<T> {
    return new Collection(this.all().sort((a, b) => {
      const aValue = typeof key === "function" ? key(a) : valueFor(a, key);
      const bValue = typeof key === "function" ? key(b) : valueFor(b, key);
      return compareValues(aValue, bValue);
    }));
  }

  sortByDesc<K extends CollectionKey>(key: K | ((item: T) => any)): Collection<T> {
    return new Collection(this.sortBy(key).reverse());
  }

  take(count: number): Collection<T> {
    return count >= 0 ? new Collection(this.slice(0, count)) : new Collection(this.slice(count));
  }

  skip(count: number): Collection<T> {
    return new Collection(this.slice(count));
  }

  where<K extends CollectionKey>(key: K, value: any): Collection<T> {
    return new Collection(this.filter((item) => valueFor(item, key) === value));
  }

  whereIn<K extends CollectionKey>(key: K, values: any[]): Collection<T> {
    const set = new Set(values);
    return new Collection(this.filter((item) => set.has(valueFor(item, key))));
  }

  contains(value: T): boolean;
  contains(predicate: CollectionPredicate<T>): boolean;
  contains<K extends CollectionKey>(key: K, value: any): boolean;
  contains(keyOrValue: any, value?: any): boolean {
    if (typeof keyOrValue === "function") {
      return this.some(keyOrValue);
    }
    if (arguments.length === 2) {
      return this.some((item) => valueFor(item, keyOrValue) === value);
    }
    return this.includes(keyOrValue);
  }

  firstWhere<K extends CollectionKey>(key: K, value: any): T | null {
    return this.first((item) => valueFor(item, key) === value);
  }

  count(): number {
    return this.length;
  }

  sum<K extends CollectionKey>(key?: K | ((item: T) => any)): number {
    return this.reduce((total, item) => {
      const value = key === undefined ? item : typeof key === "function" ? key(item) : valueFor(item, key);
      return total + Number(value || 0);
    }, 0);
  }

  avg<K extends CollectionKey>(key?: K | ((item: T) => any)): number {
    return this.length === 0 ? 0 : this.sum(key as any) / this.length;
  }

  min<K extends CollectionKey>(key?: K | ((item: T) => any)): any {
    if (this.length === 0) return null;
    return this.reduce<any>((minValue, item) => {
      const value = key === undefined ? item : typeof key === "function" ? key(item) : valueFor(item, key);
      return compareValues(value, minValue) < 0 ? value : minValue;
    }, key === undefined ? this[0] : typeof key === "function" ? key(this[0]) : valueFor(this[0], key));
  }

  max<K extends CollectionKey>(key?: K | ((item: T) => any)): any {
    if (this.length === 0) return null;
    return this.reduce<any>((maxValue, item) => {
      const value = key === undefined ? item : typeof key === "function" ? key(item) : valueFor(item, key);
      return compareValues(value, maxValue) > 0 ? value : maxValue;
    }, key === undefined ? this[0] : typeof key === "function" ? key(this[0]) : valueFor(this[0], key));
  }

  async loadMissing<R extends string & NestedRelationPath<T>>(relation: R, ...relations: R[]): Promise<this>;
  async loadMissing<Rs extends ReadonlyArray<string & NestedRelationPath<T>>>(relations: Rs): Promise<this>;
  async loadMissing<Rs extends ReadonlyArray<string & NestedRelationPath<T>>>(...relations: Rs): Promise<this>;
  async loadMissing(...relations: (string | string[])[]): Promise<this> {
    const models = this.filter((item): item is any => item !== null && item !== undefined && typeof (item as any).$relations !== "undefined");
    if (models.length === 0) return this;

    for (const relation of relations.flat()) {
      const [direct, ...nested] = relation.split(".");
      const missing = models.filter((m: any) => m.getRelation(direct) === undefined);
      const groups = new Map<any, any[]>();
      for (const model of missing) {
        const constructor = Object.getPrototypeOf(model).constructor;
        const group = groups.get(constructor);
        group ? group.push(model) : groups.set(constructor, [model]);
      }
      for (const [constructor, group] of groups) {
        if (typeof constructor.eagerLoadRelations === "function") {
          await constructor.eagerLoadRelations(group, [direct]);
        }
      }

      if (nested.length > 0) {
        const related: any[] = [];
        for (const model of models) {
          const value = model.getRelation(direct);
          if (Array.isArray(value)) related.push(...value);
          else if (value) related.push(value);
        }
        await Collection.make(related).loadMissing(nested.join("."));
      }
    }
    return this;
  }

  async loadMorph<R extends LoadMorphRelationName<T>>(relationName: R, relations: MorphEagerLoadMap): Promise<this> {
    const models = this.filter((item): item is any => item !== null && item !== undefined && typeof (item as any).getRelation === "function");
    if (models.length === 0) return this;
    const constructor = Object.getPrototypeOf(models[0]).constructor;
    if (typeof constructor.loadMorph === "function") {
      await constructor.loadMorph(models, relationName, relations);
    }
    return this;
  }

  async loadCount<R extends string & ModelRelationName<T>, A extends string | undefined = undefined>(
    relationName: R,
    alias?: A
  ): Promise<Collection<AggregateLoaded<T, AggregateAlias<R, A, "count">, number>>> {
    const models = this.filter((item) => item !== null && item !== undefined && typeof (item as any).getRelation === "function") as unknown as Model[];
    if (models.length === 0) return this as any;

    const groups = new Map<any, Model[]>();
    for (const model of models) {
      const constructor = Object.getPrototypeOf(model).constructor;
      const list = groups.get(constructor) || [];
      list.push(model);
      groups.set(constructor, list);
    }

    for (const [constructor, group] of groups) {
      if (typeof constructor.loadCount === "function") {
        await constructor.loadCount(group, relationName, alias as any);
      }
    }

    return this as any;
  }

  async loadSum<R extends string & ModelRelationName<T>, C extends AggregateColumn<T, R>>(relationName: R, column: C, callback: AggregateConstraint<T, R>): Promise<Collection<AggregateLoaded<T, AggregateAlias<R, undefined, `sum_${string & C}`>, NumericAggregate | null>>>;
  async loadSum<R extends string & ModelRelationName<T>, C extends AggregateColumn<T, R>, A extends string | undefined = undefined>(relationName: R, column: C, alias?: A): Promise<Collection<AggregateLoaded<T, AggregateAlias<R, A, `sum_${string & C}`>, NumericAggregate | null>>>;
  async loadSum<R extends string & ModelRelationName<T>, C extends AggregateColumn<T, R>, A extends string>(relationName: R, column: C, alias: A, callback: AggregateConstraint<T, R>): Promise<Collection<AggregateLoaded<T, AggregateAlias<R, A, `sum_${string & C}`>, NumericAggregate | null>>>;
  async loadSum(relationName: string, column: string, aliasOrCallback?: string | AggregateConstraint<T, any>, callback?: AggregateConstraint<T, any>): Promise<any> {
    const models = this.filter((item) => item !== null && item !== undefined && typeof (item as any).getRelation === "function") as unknown as Model[];
    if (models.length === 0) return this as any;

    const groups = new Map<any, Model[]>();
    for (const model of models) {
      const constructor = Object.getPrototypeOf(model).constructor;
      const list = groups.get(constructor) || [];
      list.push(model);
      groups.set(constructor, list);
    }

    for (const [constructor, group] of groups) {
      if (typeof constructor.loadSum === "function") {
        await constructor.loadSum(group, relationName, column as any, aliasOrCallback as any, callback as any);
      }
    }

    return this as any;
  }

  async loadAvg<R extends string & ModelRelationName<T>, C extends AggregateColumn<T, R>>(relationName: R, column: C, callback: AggregateConstraint<T, R>): Promise<Collection<AggregateLoaded<T, AggregateAlias<R, undefined, `avg_${string & C}`>, NumericAggregate | null>>>;
  async loadAvg<R extends string & ModelRelationName<T>, C extends AggregateColumn<T, R>, A extends string | undefined = undefined>(relationName: R, column: C, alias?: A): Promise<Collection<AggregateLoaded<T, AggregateAlias<R, A, `avg_${string & C}`>, NumericAggregate | null>>>;
  async loadAvg<R extends string & ModelRelationName<T>, C extends AggregateColumn<T, R>, A extends string>(relationName: R, column: C, alias: A, callback: AggregateConstraint<T, R>): Promise<Collection<AggregateLoaded<T, AggregateAlias<R, A, `avg_${string & C}`>, NumericAggregate | null>>>;
  async loadAvg(relationName: string, column: string, aliasOrCallback?: string | AggregateConstraint<T, any>, callback?: AggregateConstraint<T, any>): Promise<any> {
    const models = this.filter((item) => item !== null && item !== undefined && typeof (item as any).getRelation === "function") as unknown as Model[];
    if (models.length === 0) return this as any;

    const groups = new Map<any, Model[]>();
    for (const model of models) {
      const constructor = Object.getPrototypeOf(model).constructor;
      const list = groups.get(constructor) || [];
      list.push(model);
      groups.set(constructor, list);
    }

    for (const [constructor, group] of groups) {
      if (typeof constructor.loadAvg === "function") {
        await constructor.loadAvg(group, relationName, column as any, aliasOrCallback as any, callback as any);
      }
    }

    return this as any;
  }

  async loadMin<R extends string & ModelRelationName<T>, C extends AggregateColumn<T, R>>(relationName: R, column: C, callback: AggregateConstraint<T, R>): Promise<Collection<AggregateLoaded<T, AggregateAlias<R, undefined, `min_${string & C}`>, AggregateValueForRelation<T, R, C>>>>;
  async loadMin<R extends string & ModelRelationName<T>, C extends AggregateColumn<T, R>, A extends string | undefined = undefined>(relationName: R, column: C, alias?: A): Promise<Collection<AggregateLoaded<T, AggregateAlias<R, A, `min_${string & C}`>, AggregateValueForRelation<T, R, C>>>>;
  async loadMin<R extends string & ModelRelationName<T>, C extends AggregateColumn<T, R>, A extends string>(relationName: R, column: C, alias: A, callback: AggregateConstraint<T, R>): Promise<Collection<AggregateLoaded<T, AggregateAlias<R, A, `min_${string & C}`>, AggregateValueForRelation<T, R, C>>>>;
  async loadMin(relationName: string, column: string, aliasOrCallback?: string | AggregateConstraint<T, any>, callback?: AggregateConstraint<T, any>): Promise<any> {
    const models = this.filter((item) => item !== null && item !== undefined && typeof (item as any).getRelation === "function") as unknown as Model[];
    if (models.length === 0) return this as any;

    const groups = new Map<any, Model[]>();
    for (const model of models) {
      const constructor = Object.getPrototypeOf(model).constructor;
      const list = groups.get(constructor) || [];
      list.push(model);
      groups.set(constructor, list);
    }

    for (const [constructor, group] of groups) {
      if (typeof constructor.loadMin === "function") {
        await constructor.loadMin(group, relationName, column as any, aliasOrCallback as any, callback as any);
      }
    }

    return this as any;
  }

  async loadMax<R extends string & ModelRelationName<T>, C extends AggregateColumn<T, R>>(relationName: R, column: C, callback: AggregateConstraint<T, R>): Promise<Collection<AggregateLoaded<T, AggregateAlias<R, undefined, `max_${string & C}`>, AggregateValueForRelation<T, R, C>>>>;
  async loadMax<R extends string & ModelRelationName<T>, C extends AggregateColumn<T, R>, A extends string | undefined = undefined>(relationName: R, column: C, alias?: A): Promise<Collection<AggregateLoaded<T, AggregateAlias<R, A, `max_${string & C}`>, AggregateValueForRelation<T, R, C>>>>;
  async loadMax<R extends string & ModelRelationName<T>, C extends AggregateColumn<T, R>, A extends string>(relationName: R, column: C, alias: A, callback: AggregateConstraint<T, R>): Promise<Collection<AggregateLoaded<T, AggregateAlias<R, A, `max_${string & C}`>, AggregateValueForRelation<T, R, C>>>>;
  async loadMax(relationName: string, column: string, aliasOrCallback?: string | AggregateConstraint<T, any>, callback?: AggregateConstraint<T, any>): Promise<any> {
    const models = this.filter((item) => item !== null && item !== undefined && typeof (item as any).getRelation === "function") as unknown as Model[];
    if (models.length === 0) return this as any;

    const groups = new Map<any, Model[]>();
    for (const model of models) {
      const constructor = Object.getPrototypeOf(model).constructor;
      const list = groups.get(constructor) || [];
      list.push(model);
      groups.set(constructor, list);
    }

    for (const [constructor, group] of groups) {
      if (typeof constructor.loadMax === "function") {
        await constructor.loadMax(group, relationName, column as any, aliasOrCallback as any, callback as any);
      }
    }

    return this as any;
  }
}

// A Collection *is* an Array by every check the language offers: `Array.isArray`,
// `instanceof Array` and `Object.prototype.toString` all agree. `constructor.name`
// was the only one that disagreed, and consumers that dispatch on it take that
// disagreement at face value: Elysia's response mapper routes any array whose
// constructor is not literally named "Array" through a fallback that drops the
// accumulated response headers, status and cookies.
// See https://github.com/elysiajs/elysia/issues/1842.
Object.defineProperty(Collection, "name", { value: "Array" });

export function collect<T>(items?: Iterable<T> | ArrayLike<T> | null): Collection<T> {
  return Collection.make(items);
}
