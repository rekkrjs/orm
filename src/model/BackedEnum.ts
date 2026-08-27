import { InvalidEnumValueError } from "./InvalidEnumValueError.js";

const backedEnumMetadata: unique symbol = Symbol("@rekkr/orm/backed-enum");

interface BackedEnumMetadata {
  readonly values: readonly string[];
}

type BackedEnumCases = Readonly<Record<string, string>>;

export type BackedEnumDefinition<
  Cases extends BackedEnumCases = BackedEnumCases,
> = Readonly<Cases> & {
  readonly [backedEnumMetadata]: BackedEnumMetadata;
};

export type EnumValue<T extends BackedEnumDefinition> =
  T extends BackedEnumDefinition<infer Cases> ? Cases[keyof Cases] : never;

const memberships = new WeakMap<object, ReadonlySet<string>>();

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

  const frozenValues = Object.freeze(values);
  const metadata = Object.freeze({ values: frozenValues });
  const descriptor = Object.fromEntries(entries);
  Object.defineProperty(descriptor, backedEnumMetadata, {
    value: metadata,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  Object.freeze(descriptor);
  memberships.set(descriptor, membership);
  return descriptor as BackedEnumDefinition<Cases>;
}

export function isBackedEnumDefinition(value: unknown): value is BackedEnumDefinition {
  return typeof value === "object" && value !== null && memberships.has(value);
}

export function getBackedEnumValues(definition: BackedEnumDefinition): readonly string[] {
  return definition[backedEnumMetadata].values;
}

export function backedEnumContains(
  definition: BackedEnumDefinition,
  value: unknown,
): value is string {
  return typeof value === "string" && memberships.get(definition)?.has(value) === true;
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
