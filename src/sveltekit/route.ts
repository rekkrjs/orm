import type { ModelConstructor } from "../model/Model.js";
import type { Cookies, RequestEvent, ServerLoadEvent } from "@sveltejs/kit";
import type { ExtractStringPaths, StrictTypedEagerLoad, WithLoadedRelations } from "../model/Model.js";
import { Validator } from "../validation/Validator.js";
import { attachPolicyMethods, inspect as inspectPolicy } from "../policies/index.js";
import type { ValidationObjectSchema } from "../validation/Validator.js";
import type { InferOutput, ValidationSchema } from "../validation/Rule.js";

type RequestEventLike = {
  params: Record<string, string | undefined>;
  request: Request;
};

type UnwrapModel<M extends ModelConstructor<any>> = InstanceType<M>;
type DefaultAliasFor<M extends ModelConstructor<any>> = Uncapitalize<M["name"]>;
type BindWithArg<M extends ModelConstructor<any>> =
  StrictTypedEagerLoad<InstanceType<M>> | readonly StrictTypedEagerLoad<InstanceType<M>>[];
type BindWithPaths<W> = W extends readonly any[] ? ExtractStringPaths<W[number]> : ExtractStringPaths<W>;
type BoundModel<M extends ModelConstructor<any>, W> =
  [W] extends [undefined]
    ? InstanceType<M>
    : WithLoadedRelations<InstanceType<M>, BindWithPaths<W>>;

type BindingsMap = Record<string, unknown>;

type SchemaOutput<S> =
  S extends ValidationObjectSchema<infer Entries extends ValidationSchema> ? InferOutput<Entries> :
  S extends ValidationSchema ? InferOutput<S> :
  unknown;

type FlashType = "success" | "error" | "info" | "warning";
type FlashMessageObject = {
  type: FlashType;
  message: string;
  [key: string]: unknown;
};
type FlashInput = string | ({ message: string; type?: FlashType } & Record<string, unknown>);
type FlashValue = string | FlashMessageObject;
type FlashLoadValue = FlashValue | readonly FlashValue[] | null;

type ActionExtras = { flash: (value: FlashInput) => void };
type LoadExtras = { flash: FlashLoadValue };

type HandlerContext<TBindings extends BindingsMap, TData, TExtras extends Record<string, unknown> = {}> =
  TBindings & { data: TData } & TExtras;
type RouteHandler<TEvent, TBindings extends BindingsMap, TData, TExtras extends Record<string, unknown>, TResult> =
  (event: TEvent, context: HandlerContext<TBindings, TData, TExtras>) => TResult | Promise<TResult>;

type ModelBindSpec = {
  alias: string;
  param: string;
  model: ModelConstructor<any>;
  with?: unknown;
};
type BindResolver<TRecord = unknown> =
  (event: RequestEventLike) => TRecord | null | undefined | Promise<TRecord | null | undefined>;
type ResolverBindSpec = {
  alias: string;
  resolver: BindResolver<any>;
};
type BindSpec = ModelBindSpec | ResolverBindSpec;
type BindOptions<M extends ModelConstructor<any>> = { with?: BindWithArg<M> };
type PolicyCheck = { ability: string; alias?: string };
type RequestValidationErrorPayload = {
  issues: Record<string, string[]>;
  values?: Record<string, unknown>;
};
type RequestValidationErrorMode = "default" | "problem+json";
type RequestOptions = {
  includeValues?: boolean;
  validationError?: RequestValidationErrorMode | ((payload: RequestValidationErrorPayload) => Response);
};
type KitErrorFn = (status: number, body: { message: string }) => never;
type KitFailFn = (status: number, body: Record<string, unknown>) => unknown;
type RouteKitHelpers = {
  error?: KitErrorFn;
  fail?: KitFailFn;
};
type BindFailureReason = "missing_param" | "invalid_uuid" | "not_found";
let configuredHelpers: RouteKitHelpers | null = null;
const FLASH_COOKIE = "rekkr_flash";
type CookieLike = Pick<Cookies, "get" | "set" | "delete">;

function resolveHelpers(helpers: RouteKitHelpers = {}): Required<RouteKitHelpers> {
  const merged: RouteKitHelpers = { ...(configuredHelpers ?? {}), ...helpers };
  const errorFn = merged.error;
  const failFn = merged.fail;
  if (!errorFn || !failFn) {
    throw new Error(
      'SvelteKit helpers not configured. Call configureSvelteKit({ error, fail }) once in hooks.server.ts, or pass route({ error, fail }).',
    );
  }
  return { error: errorFn, fail: failFn };
}

export function configureSvelteKit(helpers: RouteKitHelpers): void {
  configuredHelpers = { ...helpers };
}

async function requestValues(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const json = await request.clone().json();
      if (json && typeof json === "object" && !Array.isArray(json)) {
        return json as Record<string, unknown>;
      }
    } catch {
      // no-op; fall through to empty object
    }
    return {};
  }

  try {
    const formData = await request.clone().formData();
    const values: Record<string, unknown> = {};
    for (const [key, value] of formData.entries()) {
      if (Object.prototype.hasOwnProperty.call(values, key)) {
        const existing = values[key];
        values[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
      } else {
        values[key] = value;
      }
    }
    return values;
  } catch {
    return {};
  }
}

function bindError(
  errorFn: KitErrorFn,
  model: ModelConstructor<any>,
  alias: string,
  param: string,
  value: string,
  reason: BindFailureReason,
): never {
  const message = reason === "missing_param"
    ? "No record found."
    : reason === "invalid_uuid"
      ? "No record found."
      : "No record found.";
  return errorFn(404, { message });
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isInvalidUuidInputError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as Record<string, unknown>;
  if (e.code === "22P02") return true;
  const message = typeof e.message === "string" ? e.message : "";
  return message.toLowerCase().includes("invalid input syntax for type uuid");
}

function defaultAliasForModel(model: ModelConstructor<any>): string {
  const name = model.name || "model";
  return name.length === 0 ? "model" : name[0].toLowerCase() + name.slice(1);
}

function normalizeFlash(value: FlashInput): FlashValue {
  if (typeof value === "string") {
    return value;
  }
  return {
    ...value,
    type: value.type ?? "info",
  } as FlashMessageObject;
}

function writeFlashCookie(cookies: CookieLike, value: FlashInput): void {
  const next = normalizeFlash(value);
  const currentRaw = cookies.get(FLASH_COOKIE);
  let queue: FlashValue[] = [];
  if (currentRaw) {
    try {
      const parsed = JSON.parse(currentRaw) as unknown;
      if (Array.isArray(parsed)) {
        queue = parsed
          .map((entry) => normalizeFlash(entry as FlashInput))
          .filter((entry) => typeof entry === "string" || (entry && typeof entry.message === "string"));
      } else {
        queue = [normalizeFlash(parsed as FlashInput)];
      }
    } catch {
      queue = [];
    }
  }
  queue.push(next);
  cookies.set(FLASH_COOKIE, JSON.stringify(queue), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
  });
}

function consumeFlashCookie(cookies: CookieLike): FlashLoadValue {
  const raw = cookies.get(FLASH_COOKIE);
  if (!raw) return null;
  cookies.delete(FLASH_COOKIE, { path: "/" });
  try {
    const parsed = JSON.parse(raw) as unknown;
    const normalizeCandidate = (value: unknown): FlashValue | null => {
      if (typeof value === "string") return value;
      if (!value || typeof value !== "object") return null;
      const maybe = value as Record<string, unknown>;
      if (typeof maybe.message !== "string") return null;
      return normalizeFlash(maybe as FlashInput);
    };

    if (Array.isArray(parsed)) {
      const list = parsed
        .map((item) => normalizeCandidate(item))
        .filter((item): item is FlashValue => item !== null);
      if (list.length === 0) return null;
      if (list.length === 1) return list[0];
      return list;
    }

    const single = normalizeCandidate(parsed);
    return single;
  } catch {
    return null;
  }
}

function hasCookies(value: unknown): value is { cookies: CookieLike } {
  return !!value
    && typeof value === "object"
    && "cookies" in value
    && !!(value as { cookies?: unknown }).cookies
    && typeof (value as { cookies: CookieLike }).cookies.get === "function";
}

export function flash(target: CookieLike | { cookies: CookieLike }): FlashLoadValue;
export function flash(target: CookieLike | { cookies: CookieLike }, value: FlashInput): void;
export function flash(
  target: CookieLike | { cookies: CookieLike },
  value?: FlashInput,
): FlashLoadValue | void {
  const cookies = hasCookies(target) ? target.cookies : target;
  if (value === undefined) {
    return consumeFlashCookie(cookies);
  }
  return writeFlashCookie(cookies, value);
}

export function extendLocalsUser<T extends { locals?: { user?: unknown } }>(event: T): T {
  const rawUser = (event as any)?.locals?.user;
  if (rawUser && typeof rawUser === "object") {
    (event as any).locals.user = attachPolicyMethods(rawUser as Record<string, unknown>);
  }
  return event;
}

class RouteBuilder<
  TBindings extends BindingsMap = {},
  TSchema = undefined,
> {
  private readonly bindings: BindSpec[];
  private readonly schemaDef?: ValidationSchema | ValidationObjectSchema<any>;
  private readonly policyChecks: PolicyCheck[];
  private readonly errorFn: KitErrorFn;
  private readonly failFn: KitFailFn;

  constructor(
    bindings: BindSpec[] = [],
    schemaDef?: ValidationSchema | ValidationObjectSchema<any>,
    policyChecks: PolicyCheck[] = [],
    helpers: RouteKitHelpers = {},
  ) {
    const resolved = resolveHelpers(helpers);
    this.bindings = bindings;
    this.schemaDef = schemaDef;
    this.policyChecks = policyChecks;
    this.errorFn = resolved.error;
    this.failFn = resolved.fail;
  }

  bind<TModel extends ModelConstructor<any>>(
    model: TModel,
  ): RouteBuilder<TBindings & Record<DefaultAliasFor<TModel>, UnwrapModel<TModel>>, TSchema>;
  bind<TRecord, TAlias extends string>(
    resolver: BindResolver<TRecord>,
    alias: TAlias,
  ): RouteBuilder<TBindings & Record<TAlias, TRecord>, TSchema>;
  bind<TModel extends ModelConstructor<any>, TWith extends BindWithArg<TModel>>(
    model: TModel,
    options: { with: TWith },
  ): RouteBuilder<TBindings & Record<DefaultAliasFor<TModel>, BoundModel<TModel, TWith>>, TSchema>;
  bind<TModel extends ModelConstructor<any>, TParam extends string>(
    model: TModel,
    param: TParam,
  ): RouteBuilder<TBindings & Record<DefaultAliasFor<TModel>, UnwrapModel<TModel>>, TSchema>;
  bind<TModel extends ModelConstructor<any>, TParam extends string, TWith extends BindWithArg<TModel>>(
    model: TModel,
    param: TParam,
    options: { with: TWith },
  ): RouteBuilder<TBindings & Record<DefaultAliasFor<TModel>, BoundModel<TModel, TWith>>, TSchema>;
  bind<TModel extends ModelConstructor<any>, TParam extends string, TAlias extends string>(
    model: TModel,
    param: TParam,
    alias: TAlias,
  ): RouteBuilder<TBindings & Record<TAlias, UnwrapModel<TModel>>, TSchema>;
  bind<TModel extends ModelConstructor<any>, TParam extends string, TAlias extends string, TWith extends BindWithArg<TModel>>(
    model: TModel,
    param: TParam,
    alias: TAlias,
    options: { with: TWith },
  ): RouteBuilder<TBindings & Record<TAlias, BoundModel<TModel, TWith>>, TSchema>;
  bind<
    TModel extends ModelConstructor<any>,
    TParam extends string = "id",
    TAlias extends string = DefaultAliasFor<TModel>,
    TWith extends BindWithArg<TModel> | undefined = undefined,
  >(
    modelOrResolver: TModel | BindResolver<any>,
    paramOrOptionsOrAlias?: TParam | { with?: TWith } | TAlias,
    aliasOrOptions?: TAlias | { with?: TWith },
    maybeOptions?: { with?: TWith },
  ): RouteBuilder<TBindings & Record<TAlias, BoundModel<TModel, TWith>>, TSchema> {
    if (typeof modelOrResolver === "function" && !(modelOrResolver as any).find) {
      const alias = String(paramOrOptionsOrAlias ?? "");
      if (!alias) {
        throw new Error('Resolver binding requires an alias: .bind((event) => ..., "alias")');
      }
      return new RouteBuilder(
        [...this.bindings, { alias, resolver: modelOrResolver as BindResolver<any> }],
        this.schemaDef,
        this.policyChecks,
        { error: this.errorFn, fail: this.failFn },
      ) as any;
    }

    const model = modelOrResolver as TModel;
    let resolvedParam = "id";
    let resolvedAlias = defaultAliasForModel(model);
    let options: { with?: TWith } | undefined;

    if (typeof paramOrOptionsOrAlias === "string") {
      resolvedParam = paramOrOptionsOrAlias;
      if (typeof aliasOrOptions === "string") {
        resolvedAlias = aliasOrOptions;
        options = maybeOptions;
      } else {
        options = aliasOrOptions;
      }
    } else {
      options = paramOrOptionsOrAlias;
    }

    return new RouteBuilder(
      [...this.bindings, { model, param: resolvedParam, alias: resolvedAlias, with: options?.with }],
      this.schemaDef,
      this.policyChecks,
      { error: this.errorFn, fail: this.failFn },
    ) as any;
  }

  can(ability: string, alias?: keyof TBindings & string): RouteBuilder<TBindings, TSchema> {
    return new RouteBuilder(
      this.bindings,
      this.schemaDef,
      [...this.policyChecks, { ability, alias }],
      { error: this.errorFn, fail: this.failFn },
    ) as any;
  }

  schema<S extends ValidationSchema | ValidationObjectSchema<any>>(
    schema: S,
  ): RouteBuilder<TBindings, S> {
    return new RouteBuilder(this.bindings, schema, this.policyChecks, {
      error: this.errorFn,
      fail: this.failFn,
    }) as any;
  }

  private async enforcePolicies(event: RequestEvent | ServerLoadEvent, bound: TBindings): Promise<void> {
    if (this.policyChecks.length === 0) return;
    const user = this.attachLocalsUserPolicyMethods(event);
    if (!user) {
      return this.errorFn(403, { message: "Unauthenticated." });
    }

    const fallbackAlias = Object.keys(bound)[0];
    for (const check of this.policyChecks) {
      const alias = check.alias ?? fallbackAlias;
      if (!alias) {
        throw new Error(`.can("${check.ability}") requires at least one bound record.`);
      }
      const model = (bound as Record<string, unknown>)[alias];
      if (!model) {
        return this.errorFn(404, { message: "No record found." });
      }
      const decision = await inspectPolicy(user, check.ability, model);
      if (!decision.allowed) {
        return this.errorFn(403, { message: decision.message ?? "Forbidden." });
      }
    }
  }

  private attachLocalsUserPolicyMethods(event: RequestEvent | ServerLoadEvent): unknown {
    const rawUser = (event as any)?.locals?.user;
    if (!rawUser || typeof rawUser !== "object") return rawUser;
    return ((event as any).locals.user = attachPolicyMethods(rawUser as Record<string, unknown>));
  }

  private async resolveBindings(event: RequestEventLike): Promise<TBindings> {
    const context: Record<string, unknown> = {};
    for (const binding of this.bindings) {
      if ("resolver" in binding) {
        const record = await binding.resolver(event);
        if (!record) {
          return this.errorFn(404, { message: "No record found." });
        }
        context[binding.alias] = record;
        continue;
      }
      const raw = event.params?.[binding.param];
      if (!raw) {
        return bindError(this.errorFn, binding.model, binding.alias, binding.param, "", "missing_param");
      }
      const paramValue = raw as string;
      const keyType = (binding.model as any).keyType as string | undefined;
      const usesUuids = Boolean((binding.model as any).usesUuids);
      if ((usesUuids || keyType === "uuid") && !isUuidLike(paramValue)) {
        return bindError(this.errorFn, binding.model, binding.alias, binding.param, paramValue, "invalid_uuid");
      }
      let record: unknown;
      try {
        record = await (binding.model as any).find(paramValue);
      } catch (err) {
        if (isInvalidUuidInputError(err)) {
          return bindError(this.errorFn, binding.model, binding.alias, binding.param, paramValue, "invalid_uuid");
        }
        throw err;
      }
      if (!record) {
        return bindError(this.errorFn, binding.model, binding.alias, binding.param, paramValue, "not_found");
      }
      if (binding.with) {
        await (record as any).load(binding.with as any);
      }
      context[binding.alias] = record;
    }
    return context as TBindings;
  }

  action<TResult>(
    handler: RouteHandler<RequestEvent, TBindings, TSchema extends undefined ? undefined : SchemaOutput<TSchema>, ActionExtras, TResult>,
    options: { includeValues?: boolean } = {},
  ): (event: RequestEvent) => Promise<TResult> {
    return async (event: RequestEvent): Promise<TResult> => {
      this.attachLocalsUserPolicyMethods(event);
      const bound = await this.resolveBindings(event);
      await this.enforcePolicies(event, bound);
      let data: unknown = undefined;
      if (this.schemaDef) {
        const parsed = await Validator.safeParse(this.schemaDef as any, event.request);
        if (!parsed.success) {
          return this.failFn(422, {
            issues: Validator.flatten(parsed.issues),
            ...(options.includeValues ? { values: await requestValues(event.request) } : {}),
          }) as TResult;
        } else {
          data = parsed.output;
        }
      }

      return await handler(event, {
        ...bound,
        data: data as any,
        flash: (value: FlashInput) => flash(event, value),
      });
    };
  }

  request(
    handler: RouteHandler<RequestEvent, TBindings, TSchema extends undefined ? undefined : SchemaOutput<TSchema>, ActionExtras, Response>,
    options: RequestOptions = {},
  ): (event: RequestEvent) => Promise<Response> {
    return async (event: RequestEvent): Promise<Response> => {
      const bound = await this.resolveBindings(event);
      await this.enforcePolicies(event, bound);
      let data: unknown = undefined;
      if (this.schemaDef) {
        const parsed = await Validator.safeParse(this.schemaDef as any, event.request);
        if (!parsed.success) {
          const payload = {
            issues: Validator.flatten(parsed.issues),
            ...(options.includeValues ? { values: await requestValues(event.request) } : {}),
          };
          if (typeof options.validationError === "function") {
            return options.validationError(payload);
          }
          if (options.validationError === "problem+json") {
            return new Response(JSON.stringify({
              type: "https://rekkr.dev/problems/validation-error",
              title: "Validation failed",
              status: 422,
              detail: "One or more fields are invalid.",
              errors: payload.issues,
              ...(options.includeValues ? { values: payload.values } : {}),
            }), {
              status: 422,
              headers: { "content-type": "application/problem+json" },
            });
          }
          return new Response(JSON.stringify(payload), {
            status: 422,
            headers: { "content-type": "application/json" },
          });
        } else {
          data = parsed.output;
        }
      }

      return await handler(event, {
        ...bound,
        data: data as any,
        flash: (value: FlashInput) => flash(event, value),
      });
    };
  }

  load<TResult extends Record<string, any> | void>(
    handler: RouteHandler<ServerLoadEvent, TBindings, undefined, LoadExtras, TResult>,
  ): (event: ServerLoadEvent) => Promise<TResult> {
    return async (event: ServerLoadEvent): Promise<TResult> => {
      this.attachLocalsUserPolicyMethods(event);
      const bound = await this.resolveBindings(event);
      await this.enforcePolicies(event, bound);
      const flashValue = flash(event);
      return await handler(event, {
        ...bound,
        data: undefined as undefined,
        flash: flashValue,
      });
    };
  }

  handle<TResult>(
    handler: RouteHandler<RequestEvent, TBindings, TSchema extends undefined ? undefined : SchemaOutput<TSchema>, ActionExtras, TResult>,
    options: { includeValues?: boolean } = {},
  ): (event: RequestEvent) => Promise<TResult> {
    return this.action(handler);
  }
}

export function route(helpers: RouteKitHelpers = {}): RouteBuilder<{}, undefined> {
  return new RouteBuilder<{}, undefined>([], undefined, [], helpers);
}

export type { RequestEventLike, HandlerContext, FlashInput, FlashMessageObject, FlashValue, FlashLoadValue };
