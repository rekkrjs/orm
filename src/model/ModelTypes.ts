import type { Connection } from "../connection/Connection.js";
import type { Builder } from "../query/Builder.js";
import type { BackedEnumDefinition } from "./BackedEnum.js";

export type ModelConstructor<T = any> = (new (...args: any[]) => T) & Omit<any, "prototype">;
export type GlobalScope = (builder: Builder<any>, model: ModelConstructor) => void;
export type LiteralUnion<T extends string> = T | (string & {});
export type EagerLoadConstraint = (query: Builder<any>) => void | Builder<any>;
export interface EagerLoadDefinition {
  name: string;
  constraint?: EagerLoadConstraint;
}
export type EagerLoadInput =
  | string
  | EagerLoadDefinition
  | Record<string, EagerLoadConstraint | undefined>;
export type MorphEagerLoadMap = Record<string, EagerLoadInput | EagerLoadInput[]>;
export type MorphCountLoadMap = Record<string, string | string[]>;

type BaseModelInstanceKey =
  | "$attributes"
  | "$original"
  | "$changes"
  | "$exists"
  | "$relations"
  | "$casts"
  | "$castCache"
  | "$mergedCasts"
  | "$dirtyKeys"
  | "$connection"
  | "$hidden"
  | "$visible"
  | "$appends"
  | "$wasRecentlyCreated"
  | "fill"
  | "forceFill"
  | "setConnection"
  | "getConnection"
  | "isFillable"
  | "getAttribute"
  | "setAttribute"
  | "castAttribute"
  | "serializeCastAttribute"
  | "mergeCasts"
  | "getDirty"
  | "isDirty"
  | "isClean"
  | "wasChanged"
  | "getChanges"
  | "getOriginal"
  | "syncOriginal"
  | "discardChanges"
  | "replicate"
  | "makeHidden"
  | "makeHiddenIf"
  | "makeVisible"
  | "makeVisibleIf"
  | "append"
  | "setAppends"
  | "getAppends"
  | "save"
  | "update"
  | "updateQuietly"
  | "updateTimestamps"
  | "touch"
  | "increment"
  | "decrement"
  | "is"
  | "isNot"
  | "load"
  | "loadMissing"
  | "loadMorph"
  | "loadCount"
  | "loadSum"
  | "loadAvg"
  | "loadMin"
  | "loadMax"
  | "delete"
  | "saveQuietly"
  | "deleteQuietly"
  | "restore"
  | "forceDelete"
  | "fresh"
  | "refresh"
  | "toJSON"
  | "json"
  | "toString"
  | "freshTimestamp"
  | "setRelation"
  | "getRelation"
  | "hasMany"
  | "belongsTo"
  | "hasOne"
  | "hasManyThrough"
  | "hasOneThrough"
  | "belongsToMany"
  | "morphTo"
  | "morphOne"
  | "morphMany"
  | "morphToMany"
  | "morphedByMany";

export type ModelInstanceAttributeKeys<T> = Extract<Exclude<keyof T, BaseModelInstanceKey>, string>;
type ModelInstanceFunctionKeys<T> = {
  [K in ModelInstanceAttributeKeys<T>]-?: T[K] extends (...args: any[]) => any ? K : never;
}[ModelInstanceAttributeKeys<T>];
type ModelInstanceSerializableKeys<T> = Exclude<ModelInstanceAttributeKeys<T>, ModelInstanceFunctionKeys<T>>;
export type ModelAttributes<T> = T extends { $attributes: Record<string, any> }
  ? string extends keyof T["$attributes"]
    ? Pick<T, ModelInstanceSerializableKeys<T>>
    : T["$attributes"]
  : T;
export type ModelColumn<T> = LiteralUnion<Extract<keyof ModelAttributes<T>, string>>;
export type ModelColumnValue<T, K> = K extends keyof ModelAttributes<T> ? ModelAttributes<T>[K] : any;
export type ModelAttributeInput<T> = Partial<ModelAttributes<T>> & Record<string, any>;
export type StripTablePrefix<S extends string> = S extends `${string}.${infer Tail}` ? Tail : S;
export type ModelAttributeInputWithout<T, K extends string> = Partial<Omit<ModelAttributes<T>, K>> & Record<string, any>;

declare const modelMassAssignable: unique symbol;

/** Type-only marker used by generated models to declare their writable subset. */
export type ModelMassAssignable<Attributes extends object> = {
  readonly [modelMassAssignable]: Attributes;
};

type ModelMassAssignmentMarker<T> =
  T extends ModelMassAssignable<infer Attributes> ? Attributes
  : ModelAttributes<T> extends ModelMassAssignable<infer Attributes> ? Attributes
  : never;

type IsAny<T> = 0 extends (1 & T) ? true : false;

type StrictPartial<Attributes> = keyof Attributes extends never
  ? Record<string, never>
  : Partial<Attributes>;

export type ModelMassAssignmentAttributes<T> =
  IsAny<T> extends true ? ModelAttributes<T>
  : [ModelMassAssignmentMarker<T>] extends [never]
    ? ModelAttributes<T>
    : ModelMassAssignmentMarker<T>;

export type ModelMassAssignmentInput<T> =
  IsAny<T> extends true ? ModelAttributeInput<T>
  : [ModelMassAssignmentMarker<T>] extends [never]
    ? ModelAttributeInput<T>
    : StrictPartial<ModelMassAssignmentMarker<T>>;

export type ModelMassAssignmentInputWithout<T, K extends string> =
  IsAny<T> extends true ? ModelAttributeInputWithout<T, K>
  : [ModelMassAssignmentMarker<T>] extends [never]
    ? ModelAttributeInputWithout<T, K>
    : StrictPartial<Omit<ModelMassAssignmentMarker<T>, K>>;

export type MorphRelationInput<T, N extends string, Fixed extends string = never> = ModelMassAssignmentInputWithout<T, Fixed | `${N}_id` | `${N}_type`>;

export interface BulkModelOptions {
  chunkSize?: number;
  events?: boolean;
}
export interface SaveOptions {
  events?: boolean;
}

export type CastDefinition =
  | string
  | BackedEnumDefinition
  | CastsAttributes
  | (new (...args: any[]) => CastsAttributes);

export interface CastsAttributes {
  get(model: any, key: string, value: any, attributes: Record<string, any>): any;
  set(model: any, key: string, value: any, attributes: Record<string, any>): any;
}

type BivariantCallback<TArgs extends any[], TResult> = {
  bivarianceHack(...args: TArgs): TResult;
}["bivarianceHack"];

export interface AttributeDefinition<
  TAttributes extends Record<string, any> = Record<string, any>,
  TModel = any
> {
  get?: BivariantCallback<[value: any, attributes: TAttributes, model: TModel], any>;
  set?: BivariantCallback<[value: any, attributes: TAttributes, model: TModel], any>;
}

export type AccessorMap<
  TAttributes extends Record<string, any> = Record<string, any>,
  TModel = any
> = Record<string, AttributeDefinition<TAttributes, TModel>>;
