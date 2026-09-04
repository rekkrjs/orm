export type PolicyDecision =
  | boolean
  | string
  | { allow: boolean; message?: string };

export type PolicyMethod = (user: unknown, model: unknown) => PolicyDecision | Promise<PolicyDecision>;
export type PolicyLike = object;
export type PolicyClass = new () => object;
export type PolicyUserMethods = {
  can(ability: string, model: unknown): Promise<boolean>;
  authorize(ability: string, model: unknown): Promise<void>;
};

export class PolicyAuthorizationError extends Error {
  status = 403 as const;
  constructor(message = "Forbidden.") {
    super(message);
    this.name = "PolicyAuthorizationError";
  }
}

const policiesByCtor = new Map<Function, object>();
const policiesByModelName = new Map<string, object>();

function toPolicyInstance(policy: PolicyLike | PolicyClass): object {
  if (typeof policy === "function") {
    return new (policy as PolicyClass)();
  }
  return policy;
}

export function clearPolicies(): void {
  policiesByCtor.clear();
  policiesByModelName.clear();
}

/**
 * Stable lookup key for a model class. `class.name` does not survive a
 * minifying bundler, so a model can pin its key with `static policyName`.
 */
function policyKeyFor(model: Function): string | undefined {
  return (model as { policyName?: string }).policyName ?? (model.name || undefined);
}

export function registerPolicy(model: Function | string, policy: PolicyLike | PolicyClass): void {
  const instance = toPolicyInstance(policy);
  if (typeof model === "string") {
    policiesByModelName.set(model, instance);
    return;
  }
  policiesByCtor.set(model, instance);
  const key = policyKeyFor(model);
  if (key) policiesByModelName.set(key, instance);
  // Keep the raw class name registered too, so a `registerPolicies({ Post: ... })`
  // written against the unminified name still resolves.
  if (model.name && model.name !== key) policiesByModelName.set(model.name, instance);
}

export function registerPolicies(entries: Record<string, PolicyLike | PolicyClass>): void {
  for (const [modelName, policy] of Object.entries(entries)) {
    registerPolicy(modelName, policy);
  }
}

function resolvePolicy(model: unknown): object | undefined {
  if (!model || typeof model !== "object") return undefined;
  const ctor = (model as { constructor?: Function }).constructor;
  if (ctor && policiesByCtor.has(ctor)) {
    return policiesByCtor.get(ctor);
  }
  const key = ctor ? policyKeyFor(ctor) : undefined;
  if (key && policiesByModelName.has(key)) {
    return policiesByModelName.get(key);
  }
  const modelName = ctor?.name;
  if (modelName && policiesByModelName.has(modelName)) {
    return policiesByModelName.get(modelName);
  }
  return undefined;
}

export async function inspect(
  user: unknown,
  ability: string,
  model: unknown,
): Promise<{ allowed: boolean; message?: string }> {
  const policy = resolvePolicy(model);
  if (!policy) {
    return { allowed: false, message: `No policy registered for "${(model as any)?.constructor?.name ?? "model"}".` };
  }
  const method = (policy as Record<string, unknown>)[ability];
  if (typeof method !== "function") {
    return { allowed: false, message: `Policy does not define "${ability}" ability.` };
  }
  const decision = await method.call(policy, user, model);
  if (typeof decision === "boolean") {
    return decision ? { allowed: true } : { allowed: false, message: "Forbidden." };
  }
  if (typeof decision === "string") {
    return { allowed: false, message: decision };
  }
  return decision.allow
    ? { allowed: true }
    : { allowed: false, message: decision.message ?? "Forbidden." };
}

export async function can(user: unknown, ability: string, model: unknown): Promise<boolean> {
  const result = await inspect(user, ability, model);
  return result.allowed;
}

export async function authorize(user: unknown, ability: string, model: unknown): Promise<void> {
  const result = await inspect(user, ability, model);
  if (!result.allowed) {
    throw new PolicyAuthorizationError(result.message ?? "Forbidden.");
  }
}

export function attachPolicyMethods<T extends object>(user: T): T & PolicyUserMethods {
  const base = user as T & Partial<PolicyUserMethods>;
  if (typeof base.can === "function" && typeof base.authorize === "function") {
    return base as T & PolicyUserMethods;
  }

  const extended = Object.create(user) as T & PolicyUserMethods;
  Object.defineProperty(extended, "can", {
    enumerable: false,
    configurable: true,
    writable: true,
    value: async function (ability: string, model: unknown): Promise<boolean> {
      return await can(user, ability, model);
    },
  });
  Object.defineProperty(extended, "authorize", {
    enumerable: false,
    configurable: true,
    writable: true,
    value: async function (ability: string, model: unknown): Promise<void> {
      await authorize(user, ability, model);
    },
  });
  return extended;
}
