import { timestampsEnabled } from "./TimestampScope.js";
import { MONTH_DAYS, formatDecimal, formatIso, formatIsoDate, parseUtcDate } from "../utils.js";
import {
  assertBackedEnumValue,
  isBackedEnumDefinition,
} from "./BackedEnum.js";
import type { CastDefinition, ModelConstructor } from "./ModelTypes.js";

export interface RawJsonPlan {
  readonly modelName: string;
  readonly casts: Readonly<Record<string, CompiledCast>>;
  readonly enumCasts: readonly CompiledCast[];
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
    cached.timestamps === timestampsEnabled(model) &&
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

  if (timestampsEnabled(model)) {
    try {
      add(model.getCreatedAtColumn());
      add(model.getUpdatedAtColumn());
    } catch { /* misconfigured columns report themselves on the write paths */ }
  }
  if (model.softDeletes) add(model.deletedAtColumn);

  implicitDateCastsCache.set(model, {
    timestamps: timestampsEnabled(model),
    createdAtColumn: model.createdAtColumn,
    updatedAtColumn: model.updatedAtColumn,
    softDeletes: model.softDeletes,
    deletedAtColumn: model.deletedAtColumn,
    value: casts,
  });
  return casts;
}

/** The number the two digits at `index` spell; the scan above proved they are digits. */
function twoDigits(value: string, index: number): number {
  return (value.charCodeAt(index) - 48) * 10 + (value.charCodeAt(index + 1) - 48);
}

/**
 * True when the string is already exactly what `toISOString()` would return:
 * `YYYY-MM-DDTHH:MM:SS.sssZ` over a real calendar date and a real time of day.
 *
 * The calendar check is not optional. JavaScript rolls impossible dates over,
 * so a format-only test would pass `2023-02-30` through unchanged while the
 * cast path turns it into `2023-03-02` — the same output today, a silent data
 * change tomorrow. Measured over 20,000 generated instants plus every day
 * 29–32 of every month from 1996 to 2025, format alone diverges on 562 of
 * them and format plus calendar on none.
 *
 * It allocates nothing on purpose: the point is to not build a Date, and a
 * Date built to count the days in a month hands that saving straight back.
 */
export function isCanonicalIso(value: string): boolean {
  if (value.length !== 24) return false;
  for (let index = 0; index < 24; index++) {
    const code = value.charCodeAt(index);
    switch (index) {
      case 4: case 7: if (code !== 45) return false; break;   // -
      case 10: if (code !== 84) return false; break;          // T
      case 13: case 16: if (code !== 58) return false; break; // :
      case 19: if (code !== 46) return false; break;          // .
      case 23: if (code !== 90) return false; break;          // Z
      default: if (code < 48 || code > 57) return false;
    }
  }

  const month = twoDigits(value, 5);
  if (month < 1 || month > 12) return false;
  const year = twoDigits(value, 0) * 100 + twoDigits(value, 2);
  const day = twoDigits(value, 8);
  const leapDay = month === 2 && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  if (day < 1 || day > (leapDay ? 29 : MONTH_DAYS[month - 1]!)) return false;
  return twoDigits(value, 11) <= 23 && twoDigits(value, 14) <= 59 && twoDigits(value, 17) <= 59;
}

/**
 * Skip a cast when its stored value already serializes to the same output.
 * Keep in sync with castCompiledAttribute below; a parameterized cast such as
 * `decimal:2` finds no case here and takes the full path.
 *
 * Reusing a datetime/timestamp value is safe because serializeDate emits
 * strings or null: a Date is formatted where it lies instead of being rebuilt
 * from itself first, and a canonical ISO string is already the text that
 * formatting it would produce. The `date` cast must still run — it truncates
 * to the UTC calendar day.
 */
export function castValueIsReady(cast: unknown, value: unknown): boolean {
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
    case "datetime":
    case "timestamp":
      return value instanceof Date || (typeof value === "string" && isCanonicalIso(value));
    default:
      return false;
  }
}

/**
 * Match JSON.stringify: invalid dates become null instead of throwing. A value
 * under a `date` cast is a calendar day, so it serializes as `YYYY-MM-DD`: its
 * UTC midnight instant reads as the previous day anywhere west of UTC.
 */
export function serializeDate(value: unknown, cast?: unknown): unknown {
  return value instanceof Date ? serializeDateValue(value, cast) : value;
}

export function serializeDateValue(value: Date, cast: unknown): string | null {
  if (Number.isNaN(value.getTime())) return null;
  // Every Date passes here, so `datetime` and `timestamp` must fail on the
  // cheapest test: their fifth character is not the ":" of `date:<format>`.
  return cast === "date" || (typeof cast === "string" && cast.charCodeAt(4) === 58 && cast.startsWith("date"))
    ? formatIsoDate(value)
    : formatIso(value);
}

/** Preserve the driver row; copy only when a Date needs serialization. */
export function serializeRowDates(row: Record<string, unknown>): Record<string, unknown> {
  let output = row;
  for (const key of Object.keys(row)) {
    const value = row[key];
    if (!(value instanceof Date)) continue;
    if (output === row) output = { ...row };
    output[key] = Number.isNaN(value.getTime()) ? null : formatIso(value);
  }
  return output;
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

  const visibleValues = model.visible ?? [];
  const hiddenValues = model.hidden ?? [];
  if (!Array.isArray(visibleValues) || !Array.isArray(hiddenValues)) {
    throw new Error(`${model.name}.rawJson() requires static hidden and visible arrays.`);
  }

  const defaults = { ...(model.attributes ?? {}) };
  const accessors = model.accessors ?? {};
  const visible = visibleValues.length > 0 ? new Set(visibleValues) : undefined;
  const hidden = hiddenValues.length > 0 ? new Set(hiddenValues) : undefined;
  const enumCasts = Object.values(casts).filter((cast) => cast.backedEnum);

  return {
    modelName: model.name,
    casts,
    enumCasts,
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

/** Hydration stores json casts as text: `$attributes` holds what the row holds. */
export function normalizeHydratedCastValue(cast: unknown, value: unknown): unknown {
  if (typeof cast !== "string" || value === null || value === undefined || typeof value === "string") return value;
  const separator = cast.indexOf(":");
  const type = separator === -1 ? cast : cast.slice(0, separator);
  return type === "json" || type === "array" || type === "object" ? JSON.stringify(value) : value;
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
      return parseUtcDate(value as string | number | Date);
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

    // No normalization on the way in: a driver that returns an object for a
    // json column can keep it. The row is this call's own — fresh from the
    // driver, or freshly parsed by the cache store — so nothing is shared.
    const value = attributes[key];
    const ready = cast === undefined
      || cast.backedEnum
      // An unsupported cast has to reach castCompiledAttribute to report itself.
      || (cast.supported && castValueIsReady(cast.definition, value));
    output[key] = serializeDate(ready ? value : castCompiledAttribute(cast!, value), cast?.definition);
  }
  return output;
}
