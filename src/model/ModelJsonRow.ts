import { formatDecimal } from "../utils.js";
import {
  assertBackedEnumValue,
  assertDeclaredEnumCast,
  isBackedEnumDefinition,
} from "./BackedEnum.js";
import type { CastDefinition, ModelConstructor } from "./ModelTypes.js";

export interface FastJsonPlan {
  readonly modelName: string;
  readonly casts: Readonly<Record<string, CastDefinition>>;
  readonly visible?: ReadonlySet<string>;
  readonly hidden?: ReadonlySet<string>;
}

interface CastContext {
  readonly modelName: string;
  readonly attribute: string;
}

const instanceSerializationMethods = [
  "toJSON",
  "json",
  "serialize",
  "getAttribute",
  "castAttribute",
  "getAppends",
  "getModelConstructor",
  "getCastDefinition",
  "validateBackedEnumAttribute",
  "assertBackedEnumValue",
  "setConnection",
] as const;

function hasAccessorConfiguration(value: unknown): boolean {
  if (!value) return false;
  if (typeof value !== "object" && typeof value !== "function") return true;
  if (Reflect.ownKeys(value).length > 0) return true;
  const prototype = Object.getPrototypeOf(value);
  return prototype !== Object.prototype && prototype !== null;
}

export function createFastJsonPlan(
  model: ModelConstructor,
  baseModel: ModelConstructor,
): FastJsonPlan | null {
  if (model.fastJson !== true) return null;
  if ((model.appends ?? []).length > 0) return null;
  if (hasAccessorConfiguration(model.accessors)) return null;
  if (Object.keys(model.attributes ?? {}).length > 0) return null;
  if (model.hydrate !== baseModel.hydrate) return null;

  for (const method of instanceSerializationMethods) {
    if (model.prototype[method] !== baseModel.prototype[method]) return null;
  }

  const casts = { ...(model.casts ?? {}) } as Record<string, CastDefinition>;
  for (const cast of Object.values(casts)) {
    if (typeof cast !== "string" && !isBackedEnumDefinition(cast)) return null;
  }

  const visibleValues = model.visible ?? [];
  const hiddenValues = model.hidden ?? [];
  if (!Array.isArray(visibleValues) || !Array.isArray(hiddenValues)) return null;

  return {
    modelName: model.name,
    casts,
    visible: visibleValues.length > 0 ? new Set(visibleValues) : undefined,
    hidden: hiddenValues.length > 0 ? new Set(hiddenValues) : undefined,
  };
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

export function removedEncryptedCastError(modelName: string, attribute: string): Error {
  return new Error(
    `The "encrypted" cast was removed (${modelName}.${attribute}): it only Base64-encoded values, it never encrypted them. ` +
      `Use the "base64" cast for encoding, or a custom CastsAttributes class backed by a real cipher for secrets.`,
  );
}

export function castBuiltInAttribute(
  cast: CastDefinition,
  value: unknown,
  context: CastContext,
): unknown {
  assertDeclaredEnumCast(cast);
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
    case "date":
    case "datetime":
      return new Date(value as string | number | Date);
    case "json":
    case "array":
    case "object":
      return typeof value === "string" ? JSON.parse(value) : value;
    case "base64":
      return typeof value === "string" ? Buffer.from(value, "base64").toString("utf8") : value;
    case "encrypted":
      throw removedEncryptedCastError(context.modelName, context.attribute);
    default:
      return value;
  }
}

export function serializeJsonRow(
  row: Record<string, unknown>,
  plan: FastJsonPlan,
): Record<string, unknown> {
  let normalizedValues: Map<string, unknown> | undefined;
  for (const [key, cast] of Object.entries(plan.casts)) {
    if (!Object.hasOwn(row, key)) continue;
    if (isBackedEnumDefinition(cast)) {
      castBuiltInAttribute(cast, row[key], { modelName: plan.modelName, attribute: key });
      continue;
    }
    const normalized = normalizeHydratedCastValue(cast, row[key]);
    if (normalized !== row[key]) {
      (normalizedValues ??= new Map()).set(key, normalized);
    }
  }

  const output: Record<string, unknown> = {};
  for (const key of Object.keys(row)) {
    const cast = plan.casts[key];
    if ((plan.visible && !plan.visible.has(key)) || plan.hidden?.has(key)) continue;

    output[key] = cast === undefined || isBackedEnumDefinition(cast)
      ? row[key]
      : castBuiltInAttribute(
          cast,
          normalizedValues?.has(key) ? normalizedValues.get(key) : row[key],
          { modelName: plan.modelName, attribute: key },
        );
  }
  return output;
}
