import { formatDecimal } from "../utils.js";
import {
  assertBackedEnumValue,
  isBackedEnumDefinition,
} from "./BackedEnum.js";
import type { CastDefinition, ModelConstructor } from "./ModelTypes.js";

export interface RawJsonPlan {
  readonly modelName: string;
  readonly casts: Readonly<Record<string, CompiledCast>>;
  readonly enumCasts: readonly CompiledCast[];
  readonly fastCasts?: readonly CompiledCast[];
  readonly defaults: Readonly<Record<string, unknown>>;
  readonly accessors: Record<string, any>;
  readonly visible?: ReadonlySet<string>;
  readonly hidden?: ReadonlySet<string>;
}

interface CastContext {
  readonly modelName: string;
  readonly attribute: string;
}

interface CompiledCast extends CastContext {
  readonly definition: CastDefinition;
  readonly type: string;
  readonly decimalScale?: number;
  readonly backedEnum: boolean;
  readonly custom: boolean;
  readonly supported: boolean;
}

function utcCalendarDate(year: number, month: number, day: number): Date {
  // Date.UTC treats years 0–99 as 1900–1999. Seed from leap year 2000, then
  // restore the requested year so four-digit database dates keep their value.
  const date = new Date(Date.UTC(year < 100 ? 2000 : year, month - 1, day));
  if (year < 100) date.setUTCFullYear(year);
  return date;
}

const unsupportedInstanceOverrides = [
  "toJSON",
  "json",
  "serialize",
  "setConnection",
] as const;

function hasAccessorConfiguration(value: unknown): boolean {
  if (!value) return false;
  if (typeof value !== "object" && typeof value !== "function") return true;
  if (Reflect.ownKeys(value).length > 0) return true;
  const prototype = Object.getPrototypeOf(value);
  return prototype !== Object.prototype && prototype !== null;
}

/**
 * A cached result together with the five statics it was derived from. Those
 * inputs are public and mutable, so an entry is only reusable while every one
 * of them still holds the value it had when the entry was built. Comparing
 * values rather than caching per constructor is also what makes inheritance
 * work: a subclass reads an inherited flag exactly like an own one, so a parent
 * toggling `timestamps` invalidates every subclass entry without extra
 * bookkeeping.
 *
 * Overrides of the timestamp getters are assumed to derive from these statics;
 * dynamic inputs outside them cannot invalidate this cache.
 */
interface ImplicitDateCastsEntry {
  timestamps: boolean;
  createdAtColumn: string;
  updatedAtColumn: string;
  softDeletes: boolean;
  deletedAtColumn: string;
  value: Record<string, CastDefinition> | undefined;
}

const implicitDateCastsCache = new WeakMap<ModelConstructor, ImplicitDateCastsEntry>();

/** The implicit datetime casts shared by hydrated and direct row serialization. */
export function implicitDateCasts(model: ModelConstructor): Record<string, CastDefinition> | undefined {
  const cached = implicitDateCastsCache.get(model);
  if (
    cached !== undefined &&
    cached.timestamps === model.timestamps &&
    cached.createdAtColumn === model.createdAtColumn &&
    cached.updatedAtColumn === model.updatedAtColumn &&
    cached.softDeletes === model.softDeletes &&
    cached.deletedAtColumn === model.deletedAtColumn
  ) {
    return cached.value;
  }

  let casts: Record<string, CastDefinition> | undefined;
  const add = (column: unknown) => {
    if (typeof column === "string" && column.length > 0) (casts ??= {})[column] = "datetime";
  };

  if (model.timestamps) {
    try {
      add(model.getCreatedAtColumn());
      add(model.getUpdatedAtColumn());
    } catch { /* misconfigured columns report themselves on the write paths */ }
  }
  if (model.softDeletes) add(model.deletedAtColumn);

  implicitDateCastsCache.set(model, {
    timestamps: model.timestamps,
    createdAtColumn: model.createdAtColumn,
    updatedAtColumn: model.updatedAtColumn,
    softDeletes: model.softDeletes,
    deletedAtColumn: model.deletedAtColumn,
    value: casts,
  });
  return casts;
}

export function createRawJsonPlan(
  model: ModelConstructor,
  baseModel: ModelConstructor,
): RawJsonPlan {
  if (model.hydrate !== baseModel.hydrate) {
    throw new Error(`${model.name}.rawJson() does not support an overridden hydrate().`);
  }

  for (const method of unsupportedInstanceOverrides) {
    if (model.prototype[method] !== baseModel.prototype[method]) {
      throw new Error(`${model.name}.rawJson() does not support an overridden ${method}().`);
    }
  }

  const definitions = {
    ...implicitDateCasts(model),
    ...(model.casts ?? {}),
  } as Record<string, CastDefinition>;
  const casts = Object.fromEntries(Object.entries(definitions).map(([attribute, definition]) => [
    attribute,
    compileCast(definition, { modelName: model.name, attribute }),
  ]));
  const compiledCasts = Object.values(casts);

  const visibleValues = model.visible ?? [];
  const hiddenValues = model.hidden ?? [];
  if (!Array.isArray(visibleValues) || !Array.isArray(hiddenValues)) {
    throw new Error(`${model.name}.rawJson() requires static hidden and visible arrays.`);
  }

  const defaults = { ...(model.attributes ?? {}) };
  const accessors = model.accessors ?? {};
  const visible = visibleValues.length > 0 ? new Set(visibleValues) : undefined;
  const hidden = hiddenValues.length > 0 ? new Set(hiddenValues) : undefined;
  const enumCasts = compiledCasts.filter((cast) => cast.backedEnum);
  const fastCasts = Object.keys(defaults).length === 0
      && !hasAccessorConfiguration(accessors)
      && !visible
      && !hidden
      && !compiledCasts.some((cast) => cast.custom)
    ? compiledCasts.filter((cast) => !cast.backedEnum)
    : undefined;

  return {
    modelName: model.name,
    casts,
    enumCasts,
    fastCasts,
    defaults,
    accessors,
    visible,
    hidden,
  };
}

export function canReturnRawJsonRows(plan: RawJsonPlan): boolean {
  return Object.keys(plan.casts).length === 0
    && Object.keys(plan.defaults).length === 0
    && !hasAccessorConfiguration(plan.accessors)
    && !plan.visible
    && !plan.hidden;
}

export function normalizeHydratedCastValue(cast: unknown, value: unknown): unknown {
  if (typeof cast !== "string" || value === null || value === undefined || typeof value === "string") return value;
  const separator = typeof cast === "string" ? cast.indexOf(":") : -1;
  const type = typeof cast === "string"
    ? separator === -1 ? cast : cast.slice(0, separator)
    : undefined;
  return normalizeHydratedCastValueForType(cast, value, type);
}

function normalizeHydratedCastValueForType(
  cast: unknown,
  value: unknown,
  type: string | undefined,
): unknown {
  if (typeof cast !== "string" || value === null || value === undefined || typeof value === "string") {
    return value;
  }
  return type === "json" || type === "array" || type === "object"
    ? JSON.stringify(value)
    : value;
}

const builtInCasts = new Set([
  "boolean", "bool", "number", "integer", "int", "float", "double",
  "decimal", "string", "date", "datetime", "timestamp", "json", "array",
  "object", "base64",
]);

export function assertSupportedStringCast(cast: unknown, modelName: string, attribute: string): void {
  if (typeof cast !== "string") return;
  const { type, supported } = castMetadata(cast);
  if (!supported) {
    throw new Error(`Unsupported cast "${type}" (${modelName}.${attribute}).`);
  }
}

type CastMetadata = Omit<CompiledCast, keyof CastContext>;
// ponytail: bounded FIFO covers built-ins and common decimal scales; profile
// definition churn before adding a more elaborate eviction policy.
const stringCastMetadata = new Map<string, CastMetadata>();

export function castMetadata(definition: CastDefinition): CastMetadata {
  if (typeof definition === "string") {
    const cached = stringCastMetadata.get(definition);
    if (cached) return cached;
  }
  const backedEnum = isBackedEnumDefinition(definition);
  const [type, argument] = typeof definition === "string" ? definition.split(":") : ["", undefined];
  const metadata: CastMetadata = {
    definition, type,
    decimalScale: type === "decimal" ? Number(argument || 2) : undefined,
    backedEnum,
    custom: typeof definition !== "string" && !backedEnum,
    supported: typeof definition !== "string" || builtInCasts.has(type),
  };
  if (typeof definition === "string") {
    if (stringCastMetadata.size >= 64) stringCastMetadata.delete(stringCastMetadata.keys().next().value!);
    stringCastMetadata.set(definition, metadata);
  }
  return metadata;
}

function compileCast(definition: CastDefinition, context: CastContext): CompiledCast {
  return { ...castMetadata(definition), ...context };
}

function castCompiledAttribute(cast: CastMetadata, value: unknown, context: CastContext = cast as CompiledCast): unknown {
  if (!cast.supported) {
    throw new Error(`Unsupported cast "${cast.type}" (${context.modelName}.${context.attribute}).`);
  }
  if (value === null) return value;
  if (cast.backedEnum) {
    assertBackedEnumValue(cast.definition as any, value, context.modelName, context.attribute);
    return value;
  }
  if (value === undefined) return value;

  switch (cast.type) {
    case "boolean":
    case "bool":
      return !!value;
    case "number":
    case "integer":
    case "int":
    case "float":
    case "double":
      return Number(value);
    case "decimal":
      return formatDecimal(value as string | number | bigint, cast.decimalScale!);
    case "string":
      return String(value);
    case "date": {
      let date: Date;
      if (typeof value === "string") {
        const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
        if (!match) return new Date(NaN);
        const year = Number(match[1]);
        const month = Number(match[2]);
        const day = Number(match[3]);
        date = utcCalendarDate(year, month, day);
        if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
          return new Date(NaN);
        }
        return date;
      }
      if (value instanceof Date) date = value;
      else if (typeof value === "number") date = new Date(value);
      else return new Date(NaN);
      if (Number.isNaN(date.getTime())) return new Date(NaN);
      return utcCalendarDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
    }
    case "datetime":
    case "timestamp":
      return new Date(value as string | number | Date);
    case "json":
    case "array":
    case "object":
      return typeof value === "string" ? JSON.parse(value) : value;
    case "base64":
      return typeof value === "string" ? Buffer.from(value, "base64").toString("utf8") : value;
    default:
      throw new Error(`Unsupported cast "${cast.type}" (${context.modelName}.${context.attribute}).`);
  }
}

export function castBuiltInAttribute(
  cast: CastDefinition,
  value: unknown,
  context: CastContext,
): unknown {
  return castCompiledAttribute(castMetadata(cast), value, context);
}

export function serializeRawJsonRow(
  row: Record<string, unknown>,
  plan: RawJsonPlan,
): Record<string, unknown> {
  if (plan.fastCasts) {
    const output = { ...row };
    for (const cast of plan.enumCasts) {
      if (Object.hasOwn(row, cast.attribute)) castCompiledAttribute(cast, row[cast.attribute]);
    }
    for (const cast of plan.fastCasts) {
      if (!Object.hasOwn(output, cast.attribute)) continue;
      output[cast.attribute] = castCompiledAttribute(
        cast,
        normalizeHydratedCastValueForType(cast.definition, output[cast.attribute], cast.type),
      );
    }
    return output;
  }

  const attributes = Object.keys(plan.defaults).length > 0
    ? { ...plan.defaults, ...row }
    : row;
  for (const cast of plan.enumCasts) {
    if (Object.hasOwn(attributes, cast.attribute)) {
      castCompiledAttribute(cast, attributes[cast.attribute]);
    }
  }

  const output: Record<string, unknown> = {};
  for (const key of Object.keys(attributes)) {
    if ((plan.visible && !plan.visible.has(key)) || plan.hidden?.has(key)) continue;
    if (plan.accessors[key]?.get) {
      throw new Error(`${plan.modelName}.rawJson() does not support accessor ${key} because it appears in the output.`);
    }

    const cast = plan.casts[key];
    if (cast?.custom) {
      throw new Error(`${plan.modelName}.rawJson() does not support the custom cast on ${key} because it appears in the output.`);
    }

    output[key] = cast === undefined || cast.backedEnum
      ? attributes[key]
      : castCompiledAttribute(
          cast,
          normalizeHydratedCastValueForType(cast.definition, attributes[key], cast.type),
        );
  }
  return output;
}
