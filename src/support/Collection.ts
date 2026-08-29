import type { DotPaths, DeepPick } from "../model/ModelBase.js";
import type { NumericAggregate } from "../query/Builder.js";
import type {
  AggregateAlias,
  AggregateColumn,
  AggregateConstraint,
  AggregateLoaded,
  AggregateValueForRelation,
  EagerLoadInput,
  LoadMorphRelationName,
  Model,
  MorphEagerLoadMap,
  ModelRelationName,
  NestedRelationPath,
} from "../model/Model.js";
import { ModelNotFoundError } from "../model/ModelNotFoundError.js";

type CollectionKey = string | number | symbol;

type CollectionPredicate<T> = (item: T, index: number) => boolean;
type CollectionCallback<T, R> = (item: T, index: number) => R;
export type CollectionJson<T> = T extends { toJSON(): infer R } ? R[] : T[];
type ItemJson<T> = T extends { toJSON(): infer R } ? R : T;

export class ItemNotFoundError extends Error {
  constructor() {
    super("No items found.");
    this.name = "ItemNotFoundError";
  }
}

export class MultipleItemsFoundError extends Error {
  constructor(public readonly count: number) {
    super(`${count} items were found.`);
    this.name = "MultipleItemsFoundError";
  }
}

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

function compareForWhere(left: any, operator: string, right: any): boolean {
  switch (operator.toLowerCase()) {
    case "=":
    case "==":
    case "===":
      return left === right;
    case "!=":
    case "<>":
    case "!==":
      return left !== right;
    case "<":
      return left < right;
    case "<=":
      return left <= right;
    case ">":
      return left > right;
    case ">=":
      return left >= right;
    default:
      throw new Error(`Unsupported collection operator: ${operator}`);
  }
}

function predicateFor<T>(args: readonly any[]): CollectionPredicate<T> | undefined {
  if (args.length === 0 || args[0] === null || args[0] === undefined) return undefined;
  if (typeof args[0] === "function") return args[0];
  if (args.length === 1) return (item) => Boolean(valueFor(item, args[0]));
  const operator = args.length === 2 ? "=" : String(args[1]);
  const expected = args.length === 2 ? args[1] : args[2];
  return (item) => compareForWhere(valueFor(item, args[0]), operator, expected);
}

function compareValues(a: any, b: any): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  return a > b ? 1 : -1;
}

type ModelLike = {
  getAttribute(key: string): any;
  getConnection(): any;
  getModelConstructor(): { primaryKey?: string; name?: string };
  is(other: ModelLike): boolean;
};

function isModelLike(value: unknown): value is ModelLike {
  return value !== null && typeof value === "object" &&
    typeof (value as any).getAttribute === "function" &&
    typeof (value as any).getConnection === "function" &&
    typeof (value as any).getModelConstructor === "function" &&
    typeof (value as any).is === "function";
}

function groupModelsByConnection<T extends ModelLike>(models: Iterable<T>): Array<[any, T[]]> {
  const grouped = new Map<any, Map<any, T[]>>();
  for (const model of models) {
    const constructor = model.getModelConstructor();
    const byConnection = grouped.get(constructor) ?? new Map<any, T[]>();
    const connection = model.getConnection();
    const group = byConnection.get(connection);
    group ? group.push(model) : byConnection.set(connection, [model]);
    grouped.set(constructor, byConnection);
  }
  return Array.from(grouped, ([constructor, byConnection]) =>
    Array.from(byConnection.values(), (group) => [constructor, group] as [any, T[]])
  ).flat();
}

function modelKey(value: unknown): any {
  if (!isModelLike(value)) return undefined;
  return value.getAttribute(value.getModelConstructor().primaryKey || "id");
}

function sameModel(left: unknown, right: unknown): boolean {
  if (!isModelLike(left) || !isModelLike(right)) return left === right;
  const leftKey = modelKey(left);
  const rightKey = modelKey(right);
  return left.getModelConstructor() === right.getModelConstructor() &&
    leftKey !== null && leftKey !== undefined &&
    rightKey !== null && rightKey !== undefined &&
    left.is(right);
}

function matchesModelKey(model: unknown, key: unknown): boolean {
  if (!isModelLike(model)) return false;
  if (isModelLike(key)) return sameModel(model, key);
  const current = modelKey(model);
  return current !== null && current !== undefined && String(current) === String(key);
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
    const result = new Array(this.length);
    for (let index = 0; index < this.length; index++) {
      const item: any = this[index];
      result[index] = typeof item?.toJSON === "function" ? item.toJSON() : item;
    }
    return result as CollectionJson<T>;
  }

  json(): CollectionJson<T>;
  json<P extends DotPaths<ItemJson<T>>>(...paths: P[]): DeepPick<ItemJson<T>, P>[];
  json<P extends DotPaths<ItemJson<T>>>(...paths: P[]): any {
    if (paths.length === 0) return this.toJSON();
    const result = new Array(this.length);
    for (let index = 0; index < this.length; index++) {
      const item: any = this[index];
      const full = typeof item?.toJSON === "function" ? item.toJSON() : item;
      result[index] = deepPickCollection(full, paths as string[]);
    }
    return result;
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

  pipe<R>(callback: (collection: this) => R): R {
    return callback(this);
  }

  tap(callback: (collection: this) => unknown): this {
    callback(this);
    return this;
  }

  whenEmpty<R>(callback: (collection: this) => R, defaultCallback?: (collection: this) => R): this | NonNullable<R> {
    const result = (this.isEmpty() ? callback : defaultCallback)?.(this);
    return (result ?? this) as this | NonNullable<R>;
  }

  whenNotEmpty<R>(callback: (collection: this) => R, defaultCallback?: (collection: this) => R): this | NonNullable<R> {
    const result = (this.isNotEmpty() ? callback : defaultCallback)?.(this);
    return (result ?? this) as this | NonNullable<R>;
  }

  unlessEmpty<R>(callback: (collection: this) => R, defaultCallback?: (collection: this) => R): this | NonNullable<R> {
    return this.whenNotEmpty(callback, defaultCallback);
  }

  unlessNotEmpty<R>(callback: (collection: this) => R, defaultCallback?: (collection: this) => R): this | NonNullable<R> {
    return this.whenEmpty(callback, defaultCallback);
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

  whereStrict<K extends CollectionKey>(key: K, value: any): Collection<T> {
    return this.where(key, value);
  }

  whereIn<K extends CollectionKey>(key: K, values: Iterable<any>): Collection<T> {
    const set = new Set(values);
    return new Collection(this.filter((item) => set.has(valueFor(item, key))));
  }

  whereInStrict<K extends CollectionKey>(key: K, values: Iterable<any>): Collection<T> {
    return this.whereIn(key, values);
  }

  whereNotIn<K extends CollectionKey>(key: K, values: Iterable<any>): Collection<T> {
    const set = new Set(values);
    return new Collection(this.filter((item) => !set.has(valueFor(item, key))));
  }

  whereNull<K extends CollectionKey>(key?: K): Collection<T> {
    return new Collection(this.filter((item) => {
      const value = key === undefined ? item : valueFor(item, key);
      return value === null || value === undefined;
    }));
  }

  whereNotNull<K extends CollectionKey>(key?: K): Collection<T> {
    return new Collection(this.filter((item) => {
      const value = key === undefined ? item : valueFor(item, key);
      return value !== null && value !== undefined;
    }));
  }

  whereBetween<K extends CollectionKey>(key: K, values: readonly [any, any]): Collection<T> {
    const [minimum, maximum] = values;
    return new Collection(this.filter((item) => {
      const value = valueFor(item, key);
      return value >= minimum && value <= maximum;
    }));
  }

  whereNotBetween<K extends CollectionKey>(key: K, values: readonly [any, any]): Collection<T> {
    const [minimum, maximum] = values;
    return new Collection(this.filter((item) => {
      const value = valueFor(item, key);
      return value < minimum || value > maximum;
    }));
  }

  contains(value: T): boolean;
  contains(key: string | number): boolean;
  contains(predicate: CollectionPredicate<T>): boolean;
  contains<K extends CollectionKey>(key: K, value: any): boolean;
  contains<K extends CollectionKey>(key: K, operator: string, value: any): boolean;
  contains(keyOrValue: any, value?: any): boolean {
    if (typeof keyOrValue === "function") {
      return this.some(keyOrValue);
    }
    if (arguments.length >= 2) {
      const expected = arguments.length === 2 ? value : arguments[2];
      const operator = arguments.length === 2 ? "=" : String(value);
      return this.some((item) => compareForWhere(valueFor(item, keyOrValue), operator, expected));
    }
    if (isModelLike(keyOrValue)) return this.some((item) => sameModel(item, keyOrValue));
    if (this.some(isModelLike)) {
      return this.some((item) => isModelLike(item)
        ? matchesModelKey(item, keyOrValue)
        : item === keyOrValue);
    }
    return this.includes(keyOrValue);
  }

  doesntContain(value: T): boolean;
  doesntContain(key: string | number): boolean;
  doesntContain(predicate: CollectionPredicate<T>): boolean;
  doesntContain<K extends CollectionKey>(key: K, value: any): boolean;
  doesntContain<K extends CollectionKey>(key: K, operator: string, value: any): boolean;
  doesntContain(...args: any[]): boolean {
    return !(this.contains as (...values: any[]) => boolean)(...args);
  }

  modelKeys(): any[] {
    return this.filter(isModelLike).map(modelKey);
  }

  find<S extends T>(predicate: (value: T, index: number, obj: T[]) => value is S, thisArg?: any): S | undefined;
  find(predicate: (value: T, index: number, obj: T[]) => unknown, thisArg?: any): T | undefined;
  find(key: readonly any[]): Collection<T>;
  find(key: any, defaultValue?: T | null): T | null;
  find(keyOrPredicate: any, defaultValue?: any): any {
    if (typeof keyOrPredicate === "function") {
      return Array.prototype.find.call(this, keyOrPredicate, defaultValue);
    }
    if (Array.isArray(keyOrPredicate)) {
      return new Collection(this.filter((item) => keyOrPredicate.some((key) => matchesModelKey(item, key))));
    }
    return this.first((item) => matchesModelKey(item, keyOrPredicate), defaultValue ?? null);
  }

  findOrFail(key: readonly any[]): Collection<T>;
  findOrFail(key: any): T;
  findOrFail(key: any): T | Collection<T> {
    const found = this.find(key as any);
    const missing = found === null || found === undefined ||
      (Array.isArray(key) && found instanceof Collection &&
        key.some((requested) => !found.some((item) => matchesModelKey(item, requested))));
    if (missing) {
      const firstModel = this.first((item) => isModelLike(item));
      const name = isModelLike(firstModel)
        ? firstModel.getModelConstructor().name || "Model"
        : "Model";
      throw new ModelNotFoundError(name, key);
    }
    return found as T | Collection<T>;
  }

  firstOrFail(): T;
  firstOrFail(predicate: CollectionPredicate<T>): T;
  firstOrFail<K extends CollectionKey>(key: K, value: any): T;
  firstOrFail<K extends CollectionKey>(key: K, operator: string, value: any): T;
  firstOrFail(...args: any[]): T {
    const predicate = predicateFor<T>(args);
    if (!predicate) {
      if (this.length > 0) return this[0];
    } else {
      for (let index = 0; index < this.length; index++) {
        if (predicate(this[index], index)) return this[index];
      }
    }
    throw new ItemNotFoundError();
  }

  sole(): T;
  sole(predicate: CollectionPredicate<T>): T;
  sole<K extends CollectionKey>(key: K, value: any): T;
  sole<K extends CollectionKey>(key: K, operator: string, value: any): T;
  sole(...args: any[]): T {
    const predicate = predicateFor<T>(args);
    let found: T | undefined;
    let count = 0;
    for (let index = 0; index < this.length; index++) {
      if (!predicate || predicate(this[index], index)) {
        found = this[index];
        count++;
      }
    }
    if (count === 0) throw new ItemNotFoundError();
    if (count > 1) throw new MultipleItemsFoundError(count);
    return found as T;
  }

  hasSole(): boolean;
  hasSole(predicate: CollectionPredicate<T>): boolean;
  hasSole<K extends CollectionKey>(key: K, value: any): boolean;
  hasSole<K extends CollectionKey>(key: K, operator: string, value: any): boolean;
  hasSole(...args: any[]): boolean {
    const predicate = predicateFor<T>(args);
    let count = 0;
    for (let index = 0; index < this.length && count < 2; index++) {
      if (!predicate || predicate(this[index], index)) count++;
    }
    return count === 1;
  }

  hasMany(): boolean;
  hasMany(predicate: CollectionPredicate<T>): boolean;
  hasMany<K extends CollectionKey>(key: K, value: any): boolean;
  hasMany<K extends CollectionKey>(key: K, operator: string, value: any): boolean;
  hasMany(...args: any[]): boolean {
    const predicate = predicateFor<T>(args);
    let count = 0;
    for (let index = 0; index < this.length && count < 2; index++) {
      if (!predicate || predicate(this[index], index)) count++;
    }
    return count === 2;
  }

  diff(items: Iterable<T>): Collection<T> {
    const others = Array.from(items);
    return new Collection(this.filter((item) => !others.some((other) => sameModel(item, other))));
  }

  intersect(items: Iterable<T>): Collection<T> {
    const others = Array.from(items);
    return new Collection(this.filter((item) => others.some((other) => sameModel(item, other))));
  }

  only(keys: readonly any[]): Collection<T> {
    return new Collection(this.filter((item) => keys.some((key) => matchesModelKey(item, key))));
  }

  except(keys: readonly any[]): Collection<T> {
    return new Collection(this.filter((item) => !keys.some((key) => matchesModelKey(item, key))));
  }

  unique(): Collection<T> {
    const result = new Collection<T>();
    for (const item of this) {
      if (!result.some((existing) => sameModel(existing, item))) result.push(item);
    }
    return result;
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

  average<K extends CollectionKey>(key?: K | ((item: T) => any)): number {
    return this.avg(key as any);
  }

  forPage(page: number, perPage: number): Collection<T> {
    const offset = Math.max(0, (page - 1) * perPage);
    return new Collection(this.slice(offset, offset + perPage));
  }

  percentage(callback: CollectionPredicate<T>, precision: number = 2): number | null {
    if (this.isEmpty()) return null;
    const factor = 10 ** precision;
    return Math.round((this.filter(callback).length / this.length * 100) * factor) / factor;
  }

  chunk(size: number): Collection<Collection<T>> {
    size = Math.floor(size);
    if (!Number.isFinite(size) || size <= 0) return new Collection();
    const chunks = new Collection<Collection<T>>();
    for (let index = 0; index < this.length; index += size) {
      chunks.push(new Collection(this.slice(index, index + size)));
    }
    return chunks;
  }

  nth(step: number, offset: number = 0): Collection<T> {
    if (!Number.isInteger(step) || step < 1) throw new RangeError("Step value must be at least 1.");
    const result = new Collection<T>();
    const items = this.slice(offset);
    for (let index = 0; index < items.length; index += step) result.push(items[index]);
    return result;
  }

  partition(predicate: CollectionPredicate<T>): Collection<Collection<T>>;
  partition<K extends CollectionKey>(key: K, value: any): Collection<Collection<T>>;
  partition<K extends CollectionKey>(key: K, operator: string, value: any): Collection<Collection<T>>;
  partition(...args: any[]): Collection<Collection<T>> {
    const predicate = predicateFor<T>(args)!;
    const passed = new Collection<T>();
    const failed = new Collection<T>();
    this.forEach((item, index) => (predicate(item, index) ? passed : failed).push(item));
    return new Collection([passed, failed]);
  }

  implode(glue?: string): string;
  implode<K extends CollectionKey>(key: K, glue?: string): string;
  implode(callback: CollectionCallback<T, unknown>, glue?: string): string;
  implode(valueOrGlue: CollectionKey | CollectionCallback<T, unknown> = "", glue?: string): string {
    if (typeof valueOrGlue === "function") return this.map(valueOrGlue).join(glue ?? "");
    const first = this[0];
    if (first !== null && typeof first === "object") return this.pluck(valueOrGlue).join(glue ?? "");
    return this.join(String(valueOrGlue ?? ""));
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

  makeHidden(...keys: (string | readonly string[])[]): this {
    return this.each((item) => { (item as any)?.makeHidden?.(...keys); });
  }

  makeVisible(...keys: (string | readonly string[])[]): this {
    return this.each((item) => { (item as any)?.makeVisible?.(...keys); });
  }

  append<K extends string>(...keys: (K | readonly K[])[]): Collection<T & Record<K, any>> {
    this.each((item) => { (item as any)?.append?.(...keys); });
    return this as unknown as Collection<T & Record<K, any>>;
  }

  setAppends<K extends string>(keys: readonly K[]): Collection<T & Record<K, any>> {
    this.each((item) => { (item as any)?.setAppends?.(keys); });
    return this as unknown as Collection<T & Record<K, any>>;
  }

  async load(...relations: (EagerLoadInput | EagerLoadInput[])[]): Promise<this> {
    const models = this.filter((item) => isModelLike(item)) as unknown as ModelLike[];
    for (const [constructor, group] of groupModelsByConnection(models)) {
      if (typeof (constructor as any).eagerLoadRelations === "function") {
        await (constructor as any).eagerLoadRelations(group, relations as any);
      }
    }
    return this;
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
      for (const [constructor, group] of groupModelsByConnection(missing)) {
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
    for (const [constructor, group] of groupModelsByConnection(models)) {
      if (typeof constructor.loadMorph === "function") {
        await constructor.loadMorph(group, relationName, relations);
      }
    }
    return this;
  }

  async loadCount<R extends string & ModelRelationName<T>, A extends string | undefined = undefined>(
    relationName: R,
    alias?: A
  ): Promise<Collection<AggregateLoaded<T, AggregateAlias<R, A, "count">, number>>> {
    const models = this.filter((item) => item !== null && item !== undefined && typeof (item as any).getRelation === "function") as unknown as Model[];
    if (models.length === 0) return this as any;

    for (const [constructor, group] of groupModelsByConnection(models as any)) {
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

    for (const [constructor, group] of groupModelsByConnection(models as any)) {
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

    for (const [constructor, group] of groupModelsByConnection(models as any)) {
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

    for (const [constructor, group] of groupModelsByConnection(models as any)) {
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

    for (const [constructor, group] of groupModelsByConnection(models as any)) {
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
