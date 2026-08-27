import type { Connection } from "../connection/Connection.js";
import { ConnectionManager } from "../connection/ConnectionManager.js";
import { TenantContext } from "../connection/TenantContext.js";
import {
  RuleBuilder,
  type InferOutput,
  type StandardSchemaIssue,
  type StandardSchemaV1,
  type ValidationSchema,
} from "./Rule.js";
import { ValidationError } from "./ValidationError.js";
import { resolveMessage, type MessageOverrides } from "./messages.js";
import type { ErrorBag, ValidationContext, RuleContract } from "./types.js";
import { ConditionalRule } from "./rules.js";

function resolveConnection(explicit?: Connection): Connection {
  if (explicit) return explicit;
  const tenant = TenantContext.current()?.connection;
  if (tenant) return tenant;
  const def = ConnectionManager.getDefault();
  if (!def) {
    throw new Error(
      "No connection available for validation. Pass one to Validator.make(data, schema, connection) or set a default.",
    );
  }
  return def;
}

function pathParts(path: string): string[] {
  return path.split(".").filter(Boolean);
}

function getPath(data: Record<string, any>, path: string): unknown {
  if (Object.prototype.hasOwnProperty.call(data, path)) return data[path];
  let current: any = data;
  for (const part of pathParts(path)) {
    if (current == null || !Object.prototype.hasOwnProperty.call(Object(current), part)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function hasPath(data: Record<string, any>, path: string): boolean {
  if (Object.prototype.hasOwnProperty.call(data, path)) return true;
  let current: any = data;
  for (const part of pathParts(path)) {
    if (current == null || !Object.prototype.hasOwnProperty.call(Object(current), part)) {
      return false;
    }
    current = current[part];
  }
  return true;
}

function setPath(data: Record<string, any>, path: string, value: unknown): void {
  if (!path.includes(".")) {
    data[path] = value;
    return;
  }
  let current: any = data;
  const parts = pathParts(path);
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const next = parts[i + 1];
    current[part] ??= /^\d+$/.test(next) ? [] : {};
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * Expands a wildcard pattern into the concrete paths present in the data.
 *
 * `includeMissing` also yields paths whose literal segments are absent, which is
 * what makes presence rules work under a wildcard: without it `items.*.isbn`
 * expands to nothing for `{ items: [{}] }` and a `required()` there can never
 * fire. A `*` still only expands over what exists — a missing collection has no
 * rows to require anything of.
 */
function wildcardValues(data: Record<string, any>, pattern: string, includeMissing = false): string[] {
  if (!pattern.includes("*")) return [pattern];
  const found: string[] = [];
  const parts = pathParts(pattern);
  const visit = (value: unknown, index: number, path: string[]) => {
    if (index === parts.length) {
      found.push(path.join("."));
      return;
    }
    const part = parts[index];
    if (part === "*") {
      if (Array.isArray(value)) {
        value.forEach((item, i) => visit(item, index + 1, [...path, String(i)]));
      } else if (value && typeof value === "object") {
        for (const key of Object.keys(value)) {
          visit((value as Record<string, unknown>)[key], index + 1, [...path, key]);
        }
      }
      return;
    }
    if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, part)) {
      visit((value as Record<string, unknown>)[part], index + 1, [...path, part]);
      return;
    }
    if (includeMissing && index > 0) {
      visit(undefined, index + 1, [...path, part]);
    }
  };
  visit(data, 0, []);
  return found;
}

/**
 * Resolves a cross-field reference written inside a wildcard rule.
 *
 * `same("*.end")` under the pattern `ranges.*.start` has to become
 * `ranges.0.end` for the row being validated. Substituting the wildcards alone
 * yields `0.end` — a path that never exists — so the literal prefix the pattern
 * carries before its first wildcard is prepended, unless the reference already
 * spells it out (`ranges.*.end`).
 */
function resolveRelativePath(pattern: string, attribute: string, other: string): string {
  if (!other.includes("*")) return other;

  const patternParts = pathParts(pattern);
  const attrParts = pathParts(attribute);
  const otherParts = pathParts(other);

  let wildcardIndex = 0;
  const wildcardValuesInAttr = patternParts.flatMap((part, i) => part === "*" ? [attrParts[i]] : []);
  const resolved = otherParts.map((part) => part === "*" ? wildcardValuesInAttr[wildcardIndex++] ?? part : part);

  const prefixDepth = patternParts.indexOf("*");
  const prefix = prefixDepth > 0 ? attrParts.slice(0, prefixDepth) : [];
  const alreadyQualified = prefix.length > 0 && prefix.every((part, i) => otherParts[i] === part);

  return [...(alreadyQualified ? [] : prefix), ...resolved].join(".");
}

function makeContext(
  attribute: string,
  pattern: string,
  data: Record<string, any>,
  explicitConnection?: Connection,
): ValidationContext {
  const context = {
    attribute,
    pattern,
    data,
    get: (path: string) => getPath(data, resolveRelativePath(pattern, attribute, path)),
    has: (path: string) => hasPath(data, resolveRelativePath(pattern, attribute, path)),
  } as ValidationContext;
  Object.defineProperty(context, "connection", {
    enumerable: true,
    get: () => resolveConnection(explicitConnection),
  });
  return context;
}

function isRuleBuilder(value: unknown): value is RuleBuilder<any, any> {
  return value instanceof RuleBuilder;
}

function isValidationObjectSchema<S extends ValidationSchema>(
  value: unknown,
): value is ValidationObjectSchema<S> {
  return !!value
    && typeof value === "object"
    && "entries" in value
    && "~standard" in value
    && typeof (value as ValidationObjectSchema<S>).parse === "function"
    && typeof (value as ValidationObjectSchema<S>).safeParse === "function";
}

function toIssuePath(field: string): readonly { key: PropertyKey }[] | undefined {
  const parts = field.split(".").filter(Boolean);
  if (parts.length === 0) return undefined;
  return parts.map((part) => ({ key: /^\d+$/.test(part) ? Number(part) : part }));
}

function bagToIssues(bag: ErrorBag): readonly StandardSchemaIssue[] {
  const issues: StandardSchemaIssue[] = [];
  for (const [field, messages] of Object.entries(bag)) {
    const path = toIssuePath(field);
    for (const message of messages) {
      issues.push(path ? { message, path } : { message });
    }
  }
  return issues;
}

function isPlainObjectInput(value: unknown): value is Record<string, any> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function objectInputError(): ValidationError {
  return new ValidationError({ "": ["The value must be an object."] });
}

function normalizeEmptyStringValues(value: unknown): unknown {
  if (value === "") return undefined;
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const normalized = normalizeEmptyStringValues(item);
      if (normalized !== item) changed = true;
      return normalized;
    });
    return changed ? next : value;
  }
  if (isPlainObjectInput(value)) {
    let changed = false;
    const output: Record<string, any> = {};
    for (const [key, item] of Object.entries(value)) {
      const normalized = normalizeEmptyStringValues(item);
      output[key] = normalized;
      if (normalized !== item) changed = true;
    }
    return changed ? output : value;
  }
  return value;
}

function appendInputValue(target: Record<string, any>, key: string, value: unknown): void {
  if (value === "") return;
  if (Object.prototype.hasOwnProperty.call(target, key)) {
    const existing = target[key];
    target[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
    return;
  }
  target[key] = value;
}

function inputNameParts(name: string): string[] {
  const parts: string[] = [];
  let current = "";

  for (let i = 0; i < name.length; i++) {
    const char = name[i];
    if (char === ".") {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    if (char === "[") {
      if (current) {
        parts.push(current);
        current = "";
      }
      const close = name.indexOf("]", i);
      if (close === -1) {
        current += char;
        continue;
      }
      const segment = name.slice(i + 1, close);
      if (segment) parts.push(segment);
      i = close;
      continue;
    }
    current += char;
  }

  if (current) parts.push(current);
  return parts;
}

function coerceFormValue(prefix: string | undefined, value: unknown): unknown {
  if (prefix === "b" && typeof value === "string") {
    return value === "true" || value === "on" || value === "1";
  }
  if (prefix === "n" && typeof value === "string") {
    const numeric = Number(value);
    return Number.isNaN(numeric) ? value : numeric;
  }
  return value;
}

function appendNestedInputValue(target: Record<string, any>, name: string, value: unknown): void {
  const prefixMatch = name.match(/^([bn]):(.+)$/);
  const key = prefixMatch?.[2] ?? name;
  const coerced = coerceFormValue(prefixMatch?.[1], value);
  if (coerced === "") return;

  const parts = inputNameParts(key);
  if (parts.length <= 1) {
    appendInputValue(target, key, coerced);
    return;
  }

  let current: any = target;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const next = parts[i + 1];
    current[part] ??= /^\d+$/.test(next) ? [] : {};
    current = current[part];
  }

  appendInputValue(current, parts[parts.length - 1], coerced);
}

function formDataToObject(formData: { entries(): IterableIterator<[string, unknown]> }): Record<string, any> {
  const output: Record<string, any> = {};
  for (const [key, value] of formData.entries()) {
    appendNestedInputValue(output, key, value);
  }
  return output;
}

async function requestToObject(request: Request): Promise<Record<string, any>> {
  const contentType = request.headers.get("content-type") ?? "";
  const cloned = request.clone();

  if (contentType.includes("application/json") || contentType.includes("+json")) {
    const json = await cloned.json();
    if (!isPlainObjectInput(json)) {
      throw objectInputError();
    }
    return normalizeEmptyStringValues(json) as Record<string, any>;
  }

  if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
    return formDataToObject(await cloned.formData());
  }

  try {
    return formDataToObject(await cloned.formData());
  } catch {
      const text = await cloned.text();
      try {
        const json = JSON.parse(text);
        if (isPlainObjectInput(json)) {
          return normalizeEmptyStringValues(json) as Record<string, any>;
        }
    } catch {
      // fall through
    }
  }

  throw objectInputError();
}

async function normalizeObjectInput(value: unknown): Promise<Record<string, any>> {
  if (isPlainObjectInput(value)) return normalizeEmptyStringValues(value) as Record<string, any>;
  if (typeof Request !== "undefined" && value instanceof Request) {
    return await requestToObject(value);
  }
  if (typeof FormData !== "undefined" && value instanceof FormData) {
    return normalizeEmptyStringValues(formDataToObject(value)) as Record<string, any>;
  }
  if (typeof URLSearchParams !== "undefined" && value instanceof URLSearchParams) {
    return normalizeEmptyStringValues(formDataToObject(value)) as Record<string, any>;
  }
  throw objectInputError();
}

type SafeParseResult<T, TInput = unknown> =
  | { success: true; output: T }
  | { success: false; issues: readonly StandardSchemaIssue[]; input: TInput };

type RootValue<B> = B extends RuleBuilder<infer V, any> ? V : never;

type FlatIssueMap = Record<string, string[]>;

export interface ValidationObjectSchema<S extends ValidationSchema> {
  readonly entries: S;
  readonly "~standard": StandardSchemaV1<any, InferOutput<S>>["~standard"];
  messages(overrides: MessageOverrides): this;
  parse<TInput = unknown>(data: TInput): Promise<InferOutput<S>>;
  validate<TInput = unknown>(data: TInput): Promise<SafeParseResult<InferOutput<S>, TInput>>;
  safeParse<TInput = unknown>(data: TInput): Promise<SafeParseResult<InferOutput<S>, TInput>>;
}

const IMPLICIT_RULES = new Set([
  "accepted",
  "accepted_if",
  "default",
  "declined",
  "declined_if",
  "filled",
  "nullable",
  "missing",
  "missing_if",
  "missing_unless",
  "missing_with",
  "missing_with_all",
  "present",
  "present_if",
  "present_unless",
  "present_with",
  "present_with_all",
  "prohibited",
  "prohibited_if",
  "prohibited_unless",
  "prohibits",
  "required",
  "required_if",
  "required_unless",
  "required_with",
  "required_with_all",
  "required_without",
  "required_without_all",
]);

function hasImplicitValidation(specs: readonly { name: string }[]): boolean {
  return specs.some((ruleObj) => {
    if (IMPLICIT_RULES.has(ruleObj.name)) return true;
    if (ruleObj instanceof ConditionalRule) {
      return hasImplicitValidation(ruleObj.branch);
    }
    return false;
  });
}

export class Validator<S extends ValidationSchema, TInput = unknown> {
  private customMessages: MessageOverrides = {};
  private stopOnFirst = false;
  private collectAll = false;
  private ran = false;
  private bag: ErrorBag = {};
  private output: Record<string, any> = {};

  private constructor(
    private rawData: TInput,
    private schema: S,
    private explicitConnection?: Connection,
  ) {}

  static make<S extends ValidationSchema, TInput = unknown>(
    data: TInput,
    schema: S,
    connection?: Connection,
  ): Validator<S, TInput> {
    return new Validator(data as TInput, schema, connection);
  }

  /**
   * Start a new rule chain.
   * Example: `Validator.rule().required().email()`
   */
  static rule(): RuleBuilder {
    return new RuleBuilder();
  }

  /**
   * Start a required rule chain.
   * Example: `Validator.required().string()`
   */
  static required(): RuleBuilder {
    return new RuleBuilder().required();
  }

  static flatten(issues: readonly StandardSchemaIssue[]): FlatIssueMap {
    const bag: FlatIssueMap = {};
    for (const issue of issues) {
      const key = issue.path && issue.path.length > 0
        ? issue.path.map((segment: { key: PropertyKey }) => String(segment.key)).join(".")
        : "";
      (bag[key] ??= []).push(issue.message);
    }
    return bag;
  }

  static schema<S extends ValidationSchema>(schema: S): ValidationObjectSchema<S> {
    let customMessages: MessageOverrides = {};

    const validate = async <TInput = unknown>(data: TInput): Promise<InferOutput<S>> => {
      return await Validator.make(data, schema).messages(customMessages).validate();
    };

    const safeParse = async <TInput = unknown>(data: TInput): Promise<SafeParseResult<InferOutput<S>, TInput>> => {
      try {
        return { success: true, output: await validate(data) };
      } catch (error) {
        if (error instanceof ValidationError) {
          return { success: false, issues: bagToIssues(error.errors), input: data };
        }
        throw error;
      }
    };

    return {
      entries: schema,
      messages(overrides: MessageOverrides) {
        customMessages = { ...customMessages, ...overrides };
        return this;
      },
      async parse(data: unknown) {
        return await validate(data);
      },
      async validate<TInput = unknown>(data: TInput) {
        return await safeParse(data);
      },
      async safeParse<TInput = unknown>(data: TInput) {
        return await safeParse(data);
      },
      get "~standard"() {
        return {
          version: 1,
          vendor: "rekkr",
          validate: async (value: unknown) => {
            const result = await safeParse(value);
            if (result.success) {
              return { value: result.output };
            }
            return { issues: result.issues };
          },
        } as StandardSchemaV1<any, InferOutput<S>>["~standard"];
      },
    };
  }

  static async parse<S extends ValidationSchema>(
    schema: S,
    data: Record<string, any>,
    connection?: Connection,
  ): Promise<InferOutput<S>>;
  static async parse<B extends RuleBuilder<any, any>>(
    schema: B,
    data: unknown,
    connection?: Connection,
  ): Promise<RootValue<B>>;
  static async parse<S extends ValidationSchema>(
    schema: ValidationObjectSchema<S>,
    data: unknown,
    connection?: Connection,
  ): Promise<InferOutput<S>>;
  static async parse(
    schema: ValidationSchema | RuleBuilder<any, any> | ValidationObjectSchema<any>,
    data: unknown,
    connection?: Connection,
  ): Promise<unknown> {
    if (isRuleBuilder(schema)) {
      return await Validator.make({ value: data }, { value: schema }, connection).validate().then((result) => result.value);
    }
    if (isValidationObjectSchema(schema)) {
      return await schema.parse(data);
    }
    return await Validator.make(data, schema as ValidationSchema, connection).validate();
  }

  static async safeParse<S extends ValidationSchema>(
    schema: S,
    data: Record<string, any>,
    connection?: Connection,
  ): Promise<SafeParseResult<InferOutput<S>, Record<string, any>>>;
  static async safeParse<B extends RuleBuilder<any, any>>(
    schema: B,
    data: unknown,
    connection?: Connection,
  ): Promise<SafeParseResult<RootValue<B>, unknown>>;
  static async safeParse<S extends ValidationSchema>(
    schema: ValidationObjectSchema<S>,
    data: unknown,
    connection?: Connection,
  ): Promise<SafeParseResult<InferOutput<S>, unknown>>;
  static async safeParse(
    schema: ValidationSchema | RuleBuilder<any, any> | ValidationObjectSchema<any>,
    data: unknown,
    connection?: Connection,
  ): Promise<SafeParseResult<unknown, unknown>> {
    if (isValidationObjectSchema(schema)) {
      return await schema.safeParse(data);
    }
    try {
      const output = await Validator.parse(schema as any, data as any, connection);
      return { success: true, output };
    } catch (error) {
      if (error instanceof ValidationError) {
        return { success: false, issues: bagToIssues(error.errors), input: data };
      }
      throw error;
    }
  }

  static async validate<S extends ValidationSchema>(
    schema: S,
    data: Record<string, any>,
    connection?: Connection,
  ): Promise<SafeParseResult<InferOutput<S>, Record<string, any>>>;
  static async validate<B extends RuleBuilder<any, any>>(
    schema: B,
    data: unknown,
    connection?: Connection,
  ): Promise<SafeParseResult<RootValue<B>, unknown>>;
  static async validate<S extends ValidationSchema>(
    schema: ValidationObjectSchema<S>,
    data: unknown,
    connection?: Connection,
  ): Promise<SafeParseResult<InferOutput<S>, unknown>>;
  static async validate(
    schema: ValidationSchema | RuleBuilder<any, any> | ValidationObjectSchema<any>,
    data: unknown,
    connection?: Connection,
  ): Promise<SafeParseResult<unknown, unknown>> {
    return await Validator.safeParse(schema as any, data as any, connection);
  }

  /** Override default messages, keyed by "field" or "field.rule". */
  messages(overrides: MessageOverrides): this {
    this.customMessages = { ...this.customMessages, ...overrides };
    return this;
  }

  stopOnFirstFailure(): this {
    this.stopOnFirst = true;
    return this;
  }

  collectAllErrors(): this {
    this.collectAll = true;
    return this;
  }

  private async run(): Promise<void> {
    if (this.ran) return;
    this.ran = true;
    const data = await normalizeObjectInput(this.rawData);

    for (const pattern of Object.keys(this.schema)) {
      const builder = this.schema[pattern] as RuleBuilder<any, any>;
      // Presence rules have to see keys that are absent, so those patterns get
      // the missing paths enumerated too; everything else keeps the cheaper
      // "only what exists" expansion.
      const expectsMissing = hasImplicitValidation(builder.specs);
      const attributes = wildcardValues(data, pattern, expectsMissing);
      for (const field of attributes) {
        const ctx = makeContext(field, pattern, data, this.explicitConnection);
        ctx.addError = (target: string, message: string) => {
          (this.bag[target] ??= []).push(message);
        };

        let value = getPath(data, field);
        let excluded = false;
        const wasSupplied = hasPath(data, field);
        const shouldValidateMissing = expectsMissing;
        const isNullable = builder.specs.some((ruleObj) => ruleObj.name === "nullable");
        const isMissing = !wasSupplied || value === undefined || value === "" || (value === null && !isNullable);

        if (isMissing && !shouldValidateMissing) {
          continue;
        }

        const runRules = async (specs: readonly RuleContract[]): Promise<"continue" | "stopField" | "stopAll" | "excluded"> => {
          // Defaults are ergonomic when declared last in a chain, e.g.
          // rule().in(["admin", "member"]).default("member").
          for (const ruleObj of specs) {
            if (ruleObj.name === "default" && ruleObj.coerce) {
              value = ruleObj.coerce(value);
            }
          }

          for (const ruleObj of specs) {
            if (ruleObj.name === "default") continue;
            if (ruleObj.coerce) {
              value = ruleObj.coerce(value);
            }

            if (ruleObj instanceof ConditionalRule) {
              if (ruleObj.shouldApply(ctx)) {
                const nested = await runRules(ruleObj.branch);
                if (nested !== "continue") return nested;
              }
              continue;
            }

            const result = await ruleObj.validate(value, ctx);
            const pass = typeof result === "boolean" ? result : result.pass;
            const skip = typeof result === "boolean" ? false : !!result.skip;
            const exclude = typeof result === "boolean" ? false : !!result.exclude;

            if (exclude) {
              excluded = true;
              return "excluded";
            }

            if (!pass) {
              const msg = resolveMessage(this.customMessages, field, ruleObj, ctx);
              (this.bag[field] ??= []).push(msg);
              if (this.stopOnFirst) return "stopAll";
              if (!this.collectAll) return "stopField"; // default: stop running rules for this field after first failure
            }
            if (skip) {
              return "stopField";
            }
          }

          return "continue";
        };

        const status = await runRules(builder.specs);
        if (status === "stopAll") return;

        // Include the (possibly coerced/defaulted) value when the field passed
        // and either was supplied in the input or produced by a default/coerce.
        const hadError = !!this.bag[field];
        if (!excluded && !hadError && (value !== undefined || (isNullable && value === null))) {
          setPath(this.output, field, value);
        }
      }
    }
  }

  async passes(): Promise<boolean> {
    await this.run();
    return Object.keys(this.bag).length === 0;
  }

  async fails(): Promise<boolean> {
    return !(await this.passes());
  }

  async errors(): Promise<ErrorBag> {
    await this.run();
    return this.bag;
  }

  /** Validate and return the typed, coerced data. Throws ValidationError on failure. */
  async validate(): Promise<InferOutput<S>> {
    await this.run();
    if (Object.keys(this.bag).length > 0) {
      throw new ValidationError(this.bag);
    }
    return this.output as InferOutput<S>;
  }

  /** Alias of validate(). */
  validated(): Promise<InferOutput<S>> {
    return this.validate();
  }

  parse(): Promise<InferOutput<S>> {
    return this.validate();
  }

  async safeParse(): Promise<SafeParseResult<InferOutput<S>, TInput>> {
    try {
      return { success: true, output: await this.validate() };
    } catch (error) {
      if (error instanceof ValidationError) {
        return { success: false, issues: bagToIssues(error.errors), input: this.rawData };
      }
      throw error;
    }
  }
}
