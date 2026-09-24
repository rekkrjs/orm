import { ModelPersistence } from "./ModelPersistence.js";
import { getModelTarget, type ModelJson, type DotPaths, type DeepPick } from "./ModelBase.js";
import { castValueIsReady, serializeDate, serializeDateValue } from "./ModelJsonRow.js";

function deepPick(obj: Record<string, any>, paths: string[]): Record<string, any> {
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
      result[root] = val.map(item => deepPick(item, tails));
    } else if (typeof val === "object") {
      result[root] = deepPick(val, tails);
    } else {
      result[root] = val;
    }
  }
  return result;
}

/** Resolve the guard of `makeHiddenIf` / `makeVisibleIf`, which takes a flag or a predicate. */
function conditionHolds<M>(condition: boolean | ((model: M) => boolean), model: M): boolean {
  return typeof condition === "function" ? Boolean(condition(model)) : Boolean(condition);
}

function findNativeGetter(model: object, key: string): (() => unknown) | undefined {
  let prototype = Object.getPrototypeOf(model);
  while (prototype) {
    const getter = Object.getOwnPropertyDescriptor(prototype, key)?.get;
    if (getter) return getter;
    prototype = Object.getPrototypeOf(prototype);
  }
  return undefined;
}

export class ModelSerialization<T extends Record<string, any> = any> extends ModelPersistence<T> {
  makeHidden(...keys: (string | readonly string[])[]): this {
    const flat = keys.flat();
    this.$hidden = [...new Set([...this.$hidden, ...flat])];
    this.$visible = this.$visible.filter((k) => !flat.includes(k));
    return this;
  }

  makeVisible(...keys: (string | readonly string[])[]): this {
    const flat = keys.flat();
    this.$visible = [...new Set([...this.$visible, ...flat])];
    this.$hidden = this.$hidden.filter((k) => !flat.includes(k));
    return this;
  }

  makeHiddenIf(condition: boolean | ((model: this) => boolean), ...keys: (string | readonly string[])[]): this {
    return conditionHolds(condition, this) ? this.makeHidden(...keys) : this;
  }

  makeVisibleIf(condition: boolean | ((model: this) => boolean), ...keys: (string | readonly string[])[]): this {
    return conditionHolds(condition, this) ? this.makeVisible(...keys) : this;
  }

  append<K extends string>(...keys: (K | readonly K[])[]): this & Record<K, any> {
    const flat = keys.flat();
    if (this.$appendsOverride !== undefined) {
      this.$appendsOverride = [...new Set([...this.$appendsOverride, ...flat])];
    } else {
      this.$appends = [...new Set([...this.$appends, ...flat])];
    }
    return this as this & Record<K, any>;
  }

  setAppends<K extends string>(keys: readonly K[]): this & Record<K, any> {
    this.$appendsOverride = [...keys];
    return this as this & Record<K, any>;
  }

  mergeAppends<K extends string>(keys: readonly K[]): this & Record<K, any> {
    return this.setAppends([...new Set([...this.getAppends(), ...keys])]);
  }

  hasAppended(key: string): boolean {
    return this.getAppends().includes(key);
  }

  withoutAppends(): this {
    return this.setAppends([]);
  }

  getAppends(): string[] {
    const target = getModelTarget(this);
    if (target.$appendsOverride !== undefined) return [...target.$appendsOverride];
    // The raw hot path deliberately bypasses getModelConstructor() overrides.
    const constructor = target.constructor as typeof ModelPersistence;
    return [...new Set([...(constructor.appends || []), ...target.$appends])];
  }

  private serialize(includeRelations: boolean = true, receiver: this = this): Record<string, any> {
    const target = getModelTarget(this);
    // The raw hot path deliberately bypasses getModelConstructor() overrides.
    const constructor = target.constructor as typeof ModelPersistence;
    const staticVisible = constructor.visible || [];
    const staticHidden = constructor.hidden || [];
    const visible = staticVisible.length > 0
      ? new Set([...staticVisible, ...target.$visible])
      : undefined;
    let hidden: Set<string> | undefined;
    if (staticHidden.length > 0 || target.$hidden.length > 0) {
      hidden = new Set([...staticHidden, ...target.$hidden]);
      for (const key of target.$visible) hidden.delete(key);
    }
    const attributes = target.$attributes as Record<string, any>;
    const accessors = constructor.accessors || {};
    const casts = target.$mergedCasts;
    const result: Record<string, any> = {};

    for (const key of Object.keys(attributes)) {
      if ((visible && !visible.has(key)) || hidden?.has(key)) continue;
      const value = attributes[key];
      const cast = casts[key];
      const accessor = accessors[key]?.get;
      const needsCastPath = Boolean(accessor) || (cast !== undefined && !castValueIsReady(cast, value));
      const output = needsCastPath ? target.getAttributeFromTarget(receiver, key) : value;
      // An accessor replaces the cast on read, so its Date keeps the full instant.
      result[key] = output instanceof Date ? serializeDateValue(output, accessor ? undefined : cast) : output;
    }
    if (target.$appendsOverride !== undefined || (constructor.appends?.length || 0) > 0 || target.$appends.length > 0) {
      // Bind the Proxy intentionally so getAppends() overrides keep public
      // attribute lookup semantics.
      for (const key of target.getAppends.call(this)) {
        if ((visible && !visible.has(key)) || hidden?.has(key)) continue;
        const nativeGetter = accessors[key]?.get ? undefined : findNativeGetter(receiver, key);
        result[key] = serializeDate(nativeGetter ? nativeGetter.call(receiver) : target.getAttributeFromTarget(receiver, key as any));
      }
    }
    if (includeRelations) {
      for (const key of Object.keys(target.$relations)) {
        if ((visible && !visible.has(key)) || hidden?.has(key)) continue;
        const value = target.$relations[key];
        if (value === null || value === undefined) {
          result[key] = value;
        } else if (typeof value.toJSON === "function") {
          result[key] = value.toJSON();
        } else if (Array.isArray(value)) {
          result[key] = value.map((item: any) => typeof item?.toJSON === "function" ? item.toJSON() : item);
        } else {
          result[key] = value;
        }
      }
    }
    return result;
  }

  toJSON(): ModelJson<this> {
    const target = getModelTarget(this);
    return target.serialize(true, this) as ModelJson<this>;
  }

  json(): ModelJson<this>;
  json(options: { relations?: boolean }): ModelJson<this>;
  json<P extends DotPaths<ModelJson<this>>>(...paths: P[]): DeepPick<ModelJson<this>, P>;
  json<P extends DotPaths<ModelJson<this>>>(first?: { relations?: boolean } | P, ...rest: P[]): any {
    const target = getModelTarget(this);
    if (first !== undefined && typeof first === "object" && !Array.isArray(first)) {
      return target.serialize((first as { relations?: boolean }).relations !== false, this);
    }
    const paths = (first !== undefined ? [first as P, ...rest] : []) as string[];
    const full = target.serialize(true, this) as Record<string, any>;
    if (paths.length === 0) return full;
    return deepPick(full, paths);
  }

  toString(): string {
    return JSON.stringify(this.toJSON());
  }
}
