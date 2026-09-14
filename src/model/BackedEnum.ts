import { InvalidEnumValueError } from "./InvalidEnumValueError.js";

// Type-only brand. Its value is an enum value, not an object, so descriptors
// satisfy `Record<PropertyKey, string | number>` (TypeBox 1.x `Enum`).
declare const backedEnumBrand: unique symbol;

type BackedEnumCases = Readonly<Record<string, string>>;

export type BackedEnumDefinition<
  Cases extends BackedEnumCases = BackedEnumCases,
> = Readonly<Cases> & {
  readonly [backedEnumBrand]: Cases[keyof Cases];
};

export type EnumValue<T extends BackedEnumDefinition> =
  T extends BackedEnumDefinition<infer Cases> ? Cases[keyof Cases] : never;

interface BackedEnumRegistration {
  readonly values: readonly string[];
  readonly membership: ReadonlySet<string>;
}

const registrations = new WeakMap<object, BackedEnumRegistration>();

export function backedEnum<const Cases extends BackedEnumCases>(
  cases: Cases,
): BackedEnumDefinition<Cases> {
  if (cases === null || typeof cases !== "object" || Array.isArray(cases)) {
    throw new TypeError("backedEnum() expects an object of string-backed cases.");
  }

  const entries = Object.entries(cases);
  if (entries.length === 0) {
    throw new TypeError("backedEnum() requires at least one case.");
  }

  const values: string[] = [];
  const membership = new Set<string>();
  for (const [name, value] of entries) {
    if (typeof value !== "string") {
      throw new TypeError(`Backed enum case "${name}" must have a string value.`);
    }
    if (value.length === 0) {
      throw new TypeError(`Backed enum case "${name}" must not have an empty value.`);
    }
    if (membership.has(value)) {
      throw new TypeError(`Backed enum value "${value}" is duplicated.`);
    }
    values.push(value);
    membership.add(value);
  }

  const descriptor = Object.freeze(Object.fromEntries(entries));
  registrations.set(descriptor, { values: Object.freeze(values), membership });
  return descriptor as BackedEnumDefinition<Cases>;
}

export function isBackedEnumDefinition(value: unknown): value is BackedEnumDefinition {
  return typeof value === "object" && value !== null && registrations.has(value);
}

export function getBackedEnumValues(definition: BackedEnumDefinition): readonly string[] {
  return registrations.get(definition)!.values;
}

export function backedEnumContains(
  definition: BackedEnumDefinition,
  value: unknown,
): value is string {
  return typeof value === "string" && registrations.get(definition)?.membership.has(value) === true;
}

export function assertBackedEnumValue(
  definition: BackedEnumDefinition,
  value: unknown,
  model: string,
  attribute: string,
): asserts value is string {
  if (!backedEnumContains(definition, value)) {
    throw new InvalidEnumValueError(
      model,
      attribute,
      value,
      getBackedEnumValues(definition),
    );
  }
}
