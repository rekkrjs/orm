import { formatDecimal } from "../utils.js";
import {
  assertBackedEnumValue,
  isBackedEnumDefinition,
} from "./BackedEnum.js";
import type { CastDefinition, ModelConstructor } from "./ModelTypes.js";

export interface RawJsonPlan {
  readonly modelName: string;
  readonly casts: Readonly<Record<string, CastDefinition>>;
  readonly defaults: Readonly<Record<string, unknown>>;
  readonly accessors: Record<string, any>;
  readonly visible?: ReadonlySet<string>;
  readonly hidden?: ReadonlySet<string>;
}

interface CastContext {
  readonly modelName: string;
  readonly attribute: string;
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

/** The implicit datetime casts shared by hydrated and direct row serialization. */
export function implicitDateCasts(model: ModelConstructor): Record<string, CastDefinition> | undefined {
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

  const casts = {
    ...implicitDateCasts(model),
    ...(model.casts ?? {}),
  } as Record<string, CastDefinition>;

  const visibleValues = model.visible ?? [];
  const hiddenValues = model.hidden ?? [];
  if (!Array.isArray(visibleValues) || !Array.isArray(hiddenValues)) {
    throw new Error(`${model.name}.rawJson() requires static hidden and visible arrays.`);
  }

  return {
    modelName: model.name,
    casts,
    defaults: { ...(model.attributes ?? {}) },
    accessors: model.accessors ?? {},
    visible: visibleValues.length > 0 ? new Set(visibleValues) : undefined,
    hidden: hiddenValues.length > 0 ? new Set(hiddenValues) : undefined,
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
  if (typeof cast !== "string" || value === null || value === undefined || typeof value === "string") {
    return value;
  }
  const separator = cast.indexOf(":");
  const type = separator === -1 ? cast : cast.slice(0, separator);
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
  const type = cast.split(":", 1)[0];
  if (!builtInCasts.has(type)) {
    throw new Error(`Unsupported cast "${type}" (${modelName}.${attribute}).`);
  }
}

export function castBuiltInAttribute(
  cast: CastDefinition,
  value: unknown,
  context: CastContext,
): unknown {
  assertSupportedStringCast(cast, context.modelName, context.attribute);
  if (value === null) return value;
  if (isBackedEnumDefinition(cast)) {
    assertBackedEnumValue(cast, value, context.modelName, context.attribute);
    return value;
  }
  if (value === undefined) return value;

  const [type, argument] = String(cast).split(":");
  switch (type) {
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
      return formatDecimal(value as string | number | bigint, Number(argument || 2));
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
      throw new Error(`Unsupported cast "${type}" (${context.modelName}.${context.attribute}).`);
  }
}

export function serializeRawJsonRow(
  row: Record<string, unknown>,
  plan: RawJsonPlan,
): Record<string, unknown> {
  const attributes = Object.keys(plan.defaults).length > 0
    ? { ...plan.defaults, ...row }
    : row;
  let normalizedValues: Map<string, unknown> | undefined;
  for (const [key, cast] of Object.entries(plan.casts)) {
    if (!Object.hasOwn(attributes, key)) continue;
    if (isBackedEnumDefinition(cast)) {
      castBuiltInAttribute(cast, attributes[key], { modelName: plan.modelName, attribute: key });
      continue;
    }
    const normalized = normalizeHydratedCastValue(cast, attributes[key]);
    if (normalized !== attributes[key]) {
      (normalizedValues ??= new Map()).set(key, normalized);
    }
  }

  const output: Record<string, unknown> = {};
  for (const key of Object.keys(attributes)) {
    if ((plan.visible && !plan.visible.has(key)) || plan.hidden?.has(key)) continue;
    if (plan.accessors[key]?.get) {
      throw new Error(`${plan.modelName}.rawJson() does not support accessor ${key} because it appears in the output.`);
    }

    const cast = plan.casts[key];
    if (cast !== undefined && typeof cast !== "string" && !isBackedEnumDefinition(cast)) {
      throw new Error(`${plan.modelName}.rawJson() does not support the custom cast on ${key} because it appears in the output.`);
    }

    output[key] = cast === undefined || isBackedEnumDefinition(cast)
      ? attributes[key]
      : castBuiltInAttribute(
          cast,
          normalizedValues?.has(key) ? normalizedValues.get(key) : attributes[key],
          { modelName: plan.modelName, attribute: key },
        );
  }
  return output;
}
