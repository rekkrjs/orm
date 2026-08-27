import { ModelPersistence } from "./ModelPersistence.js";
import type { ModelJson, DotPaths, DeepPick } from "./ModelBase.js";

/**
 * Whether a stored value already equals what `ModelCore.castAttribute` would
 * return, letting serialization read `$attributes` directly instead of paying
 * for the full cast path.
 *
 * This mirrors `ModelCore.castAttribute` and must stay in sync with it: change
 * what a cast returns there and the matching arm here has to change too, or
 * serialization will hand back the untransformed value. Only bare cast names
 * are listed, so parameterised casts ("decimal:2", "datetime:…") fall through
 * to the default. Returning `false` is always safe — it just costs a call.
 *
 * Date-producing casts are deliberately absent: `castAttribute` builds a
 * fresh Date, and short-circuiting to the stored instance would leak a mutable
 * reference to `$attributes` (which `$original` shares), so an in-place edit
 * would silently corrupt the snapshot.
 */
function castValueIsReady(cast: unknown, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof cast !== "string") return false;

  switch (cast) {
    case "string":
      return typeof value === "string";
    case "number":
    case "integer":
    case "int":
    case "float":
    case "double":
      return typeof value === "number";
    case "boolean":
    case "bool":
      return typeof value === "boolean";
    default:
      return false;
  }
}

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
    this.$appends = [...new Set([...this.$appends, ...flat])];
    return this as this & Record<K, any>;
  }

  setAppends<K extends string>(keys: readonly K[]): this & Record<K, any> {
    this.$appends = [...keys];
    return this as this & Record<K, any>;
  }

  getAppends(): string[] {
    const constructor = this.getModelConstructor();
    return [...new Set([...(constructor.appends || []), ...this.$appends])];
  }

  private serialize(includeRelations: boolean = true): Record<string, any> {
    const constructor = this.getModelConstructor();
    const staticVisible = constructor.visible || [];
    const staticHidden = constructor.hidden || [];
    const visible = staticVisible.length > 0
      ? new Set([...staticVisible, ...this.$visible])
      : undefined;
    const hidden = new Set([...staticHidden, ...this.$hidden]);
    for (const key of this.$visible) hidden.delete(key);
    const attributes = this.$attributes as Record<string, any>;
    const accessors = constructor.accessors || {};
    const casts = this.$mergedCasts;
    const result: Record<string, any> = {};

    for (const key of Object.keys(attributes)) {
      if ((visible && !visible.has(key)) || hidden.has(key)) continue;
      const value = attributes[key];
      const cast = casts[key];
      const needsCastPath = Boolean(accessors[key]?.get) || (cast !== undefined && !castValueIsReady(cast, value));
      result[key] = needsCastPath ? this.getAttribute(key) : value;
    }
    if ((constructor.appends?.length || 0) > 0 || this.$appends.length > 0) {
      for (const key of this.getAppends()) {
        if ((visible && !visible.has(key)) || hidden.has(key)) continue;
        const nativeGetter = accessors[key]?.get ? undefined : findNativeGetter(this, key);
        result[key] = nativeGetter ? nativeGetter.call(this) : this.getAttribute(key as any);
      }
    }
    if (includeRelations) {
      for (const key of Object.keys(this.$relations)) {
        if ((visible && !visible.has(key)) || hidden.has(key)) continue;
        const value = this.$relations[key];
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
    return this.serialize(true) as ModelJson<this>;
  }

  json(): ModelJson<this>;
  json(options: { relations?: boolean }): ModelJson<this>;
  json<P extends DotPaths<ModelJson<this>>>(...paths: P[]): DeepPick<ModelJson<this>, P>;
  json<P extends DotPaths<ModelJson<this>>>(first?: { relations?: boolean } | P, ...rest: P[]): any {
    if (first !== undefined && typeof first === "object" && !Array.isArray(first)) {
      return this.serialize((first as { relations?: boolean }).relations !== false);
    }
    const paths = (first !== undefined ? [first as P, ...rest] : []) as string[];
    const full = this.serialize(true) as Record<string, any>;
    if (paths.length === 0) return full;
    return deepPick(full, paths);
  }

  toString(): string {
    return JSON.stringify(this.toJSON());
  }
}
