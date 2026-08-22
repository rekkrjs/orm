export class InvalidEnumValueError extends Error {
  readonly model: string;
  readonly attribute: string;
  readonly value: unknown;
  readonly expected: readonly string[];

  constructor(
    model: string,
    attribute: string,
    value: unknown,
    expected: readonly string[],
  ) {
    const received = typeof value === "string"
      ? JSON.stringify(value)
      : `a ${value === null ? "null" : typeof value} value`;
    super(
      `Invalid enum value ${received} for ${model}.${attribute}. ` +
        `Expected one of: ${expected.map((item) => JSON.stringify(item)).join(", ")}.`,
    );
    this.name = "InvalidEnumValueError";
    this.model = model;
    this.attribute = attribute;
    this.value = value;
    this.expected = Object.freeze([...expected]);
  }
}
