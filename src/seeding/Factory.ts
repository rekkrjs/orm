import type { ModelAttributeInput, ModelConstructor } from "../model/Model.js";
import { Model, __registerModelFactory } from "../model/Model.js";
import { bulkInsertModelRecords, validateBulkInsertChunkSize } from "../model/ModelPersistence.js";
import { snakeCase } from "../utils.js";

export type FactoryAttributes<T = any> = ModelAttributeInput<T>;
export type FactoryStateValue<T = any> =
  | FactoryAttributes<T>
  | ((attributes: FactoryAttributes<T>, sequence: number) => FactoryAttributes<T>);
export type FactoryState<T = any> = FactoryStateValue<T> | Sequence;
export type AfterHook<T = any> = (model: T, sequence: number) => void | Promise<void>;
export interface FactoryInsertOptions {
  chunkSize?: number;
}

/**
 * Cycles attribute patches across generated records by sequence (Laravel's
 * `Sequence`): `.state(new Sequence({role:"a"},{role:"b"}))` applies `{a}` to
 * record 1, `{b}` to 2, `{a}` to 3, ...
 */
export class Sequence {
  readonly items: Record<string, any>[];
  constructor(...items: Record<string, any>[]) {
    this.items = items;
  }
  at(sequence: number): Record<string, any> {
    if (this.items.length === 0) return {};
    return this.items[(sequence - 1) % this.items.length];
  }
}

type BelongsToParent = { factoryOrModel: Factory<any> | Model; relation?: string };
type HasChildren = { factory: Factory<any>; relation: string };

/**
 * Class-based model factory (Laravel-style). Subclass it, point `model` at
 * the model, implement `definition()`, add state methods, then register:
 *
 *   class UserFactory extends Factory<User> {
 *     model = User;
 *     definition(seq: number) {
 *       return { name: `User ${seq}`, email: `user${seq}@x.com`, role: "member" };
 *     }
 *     admin() { return this.state({ role: "admin" }); }
 *   }
 *   Factory.register(User, UserFactory);
 *
 *   User.factory().admin().count(3).create();
 */
export class Factory<T = any> {
  /**
   * Injected on the prototype by `Factory.register(Model, FactoryClass)`.
   * `declare` so no own class field is emitted (an own `model = undefined`
   * would shadow the prototype value under useDefineForClassFields).
   */
  declare protected model: ModelConstructor<T>;

  private amount = 1;
  private states: FactoryState<T>[] = [];
  private afterMakingHooks: AfterHook<T>[] = [];
  private afterCreatingHooks: AfterHook<T>[] = [];
  private belongsToParents: BelongsToParent[] = [];
  private hasChildren: HasChildren[] = [];
  private trustedAttributes: Record<string, any> = {};

  /** Subclass overrides this to return the base attributes for a record. */
  definition(_sequence: number): FactoryAttributes<T> {
    return {} as FactoryAttributes<T>;
  }

  /**
   * Register a factory class for a model so `Model.factory()` resolves it.
   * The model is written onto the factory class prototype (no instantiation
   * here — instances stay lazy), so subclasses don't need a `model =` field.
   * Subclasses inherit a parent model's registration via the prototype chain.
   */
  static register<M = any>(
    model: ModelConstructor<M>,
    factoryClass: new () => Factory<M>
  ): void {
    (factoryClass.prototype as any).model = model;
    __registerModelFactory(model as unknown as Function, () => new factoryClass());
  }

  count(amount: number): this {
    const next = this.clone();
    next.amount = Math.max(0, amount);
    return next;
  }

  state(state: FactoryState<T>): this {
    const next = this.clone();
    next.states = [...next.states, state];
    return next;
  }

  /** belongsTo parent — a model instance or another Factory (created lazily). */
  for(parent: Factory<any> | Model, relation?: string): this {
    const next = this.clone();
    next.belongsToParents = [...next.belongsToParents, { factoryOrModel: parent, relation }];
    return next;
  }

  /** Create related children through a hasMany/hasOne relation after persist. */
  has(childFactory: Factory<any>, relation: string): this {
    const next = this.clone();
    next.hasChildren = [...next.hasChildren, { factory: childFactory, relation }];
    return next;
  }

  afterMaking(hook: AfterHook<T>): this {
    const next = this.clone();
    next.afterMakingHooks = [...next.afterMakingHooks, hook];
    return next;
  }

  afterCreating(hook: AfterHook<T>): this {
    const next = this.clone();
    next.afterCreatingHooks = [...next.afterCreatingHooks, hook];
    return next;
  }

  make(overrides: FactoryAttributes<T> = {}): T | T[] {
    const models: T[] = [];
    for (let index = 0; index < this.amount; index++) {
      const attributes = this.attributesFor(index + 1, overrides);
      models.push(this.newModel(attributes));
    }
    for (let i = 0; i < models.length; i++) {
      for (const hook of this.afterMakingHooks) void hook(models[i], i + 1);
    }
    return this.amount === 1 ? models[0] : models;
  }

  async create(overrides: FactoryAttributes<T> = {}): Promise<T | T[]> {
    const models: T[] = [];
    for (let index = 0; index < this.amount; index++) {
      const sequence = index + 1;
      const attributes = this.attributesFor(sequence, overrides);
      const model = this.newModel(attributes);
      await this.applyBelongsTo(model);
      (model as any).forceFill(this.trustedAttributes);
      for (const hook of this.afterMakingHooks) await hook(model, sequence);
      await (model as any).save();
      await this.createHasChildren(model);
      for (const hook of this.afterCreatingHooks) await hook(model, sequence);
      models.push(model);
    }
    return this.amount === 1 ? models[0] : models;
  }

  async insert(
    overrides: FactoryAttributes<T> = {},
    options: FactoryInsertOptions = {},
  ): Promise<void> {
    validateBulkInsertChunkSize(options.chunkSize);
    if (this.hasChildren.length > 0) {
      throw new Error("Factory.insert() cannot create child relationships. Use Factory.create() when using has().");
    }

    const records: FactoryAttributes<T>[] = [];
    for (let index = 0; index < this.amount; index++) {
      const sequence = index + 1;
      const model = this.newModel(this.attributesFor(sequence, overrides));
      await this.applyBelongsTo(model);
      (model as any).forceFill(this.trustedAttributes);
      for (const hook of this.afterMakingHooks) await hook(model, sequence);
      const rawModel = model as any;
      Object.assign(rawModel.$attributes, rawModel.getDirty());
      records.push({ ...rawModel.$attributes });
    }

    await bulkInsertModelRecords(this.model, records as any, {
      trusted: true,
      events: false,
      chunkSize: options.chunkSize,
    });
  }

  raw(overrides: FactoryAttributes<T> = {}): FactoryAttributes<T> | FactoryAttributes<T>[] {
    const records = Array.from({ length: this.amount }, (_, i) => this.attributesFor(i + 1, overrides));
    return this.amount === 1 ? records[0] : records;
  }

  private attributesFor(sequence: number, overrides: FactoryAttributes<T>): FactoryAttributes<T> {
    let attributes: FactoryAttributes<T> = { ...this.definition(sequence) };
    for (const state of this.states) {
      let patch: Record<string, any>;
      if (state instanceof Sequence) {
        patch = state.at(sequence);
      } else if (typeof state === "function") {
        patch = state(attributes, sequence);
      } else {
        patch = state as Record<string, any>;
      }
      attributes = { ...attributes, ...patch };
    }
    return { ...attributes, ...overrides };
  }

  private newModel(attributes: FactoryAttributes<T>): T {
    return (new this.model() as any).forceFill(attributes) as T;
  }

  private async applyBelongsTo(model: T): Promise<void> {
    for (const { factoryOrModel, relation } of this.belongsToParents) {
      const parent =
        factoryOrModel instanceof Factory ? ((await factoryOrModel.create()) as Model) : factoryOrModel;
      const { foreignKey, ownerKey } = this.resolveBelongsToKeys(parent, relation);
      (model as any).setAttribute(foreignKey, (parent as any).getAttribute(ownerKey));
    }
  }

  private resolveBelongsToKeys(parent: Model, relation?: string): { foreignKey: string; ownerKey: string } {
    if (relation) {
      const probe = new this.model() as any;
      const rel = probe[relation]();
      return {
        foreignKey: rel.getForeignKeyName ? rel.getForeignKeyName() : rel.foreignKey,
        ownerKey: rel.getOwnerKeyName ? rel.getOwnerKeyName() : rel.localKey,
      };
    }
    const parentCtor = (parent as any).constructor;
    return { foreignKey: `${snakeCase(parentCtor.name)}_id`, ownerKey: parentCtor.primaryKey };
  }

  private async createHasChildren(parent: T): Promise<void> {
    for (const { factory, relation } of this.hasChildren) {
      const rel = (parent as any)[relation]();
      const attributes = typeof rel.getDefaultAttributes === "function" ? rel.getDefaultAttributes() : {};
      if (rel.foreignKey) {
        attributes[rel.foreignKey] = (parent as any).getAttribute(
          rel.localKey ?? (parent as any).constructor.primaryKey
        );
      } else if (rel.idColumn) {
        attributes[rel.idColumn] = (parent as any).getAttribute(
          rel.localKey ?? (parent as any).constructor.primaryKey
        );
        attributes[rel.typeColumn] = rel.getMorphType();
      }
      await factory.withTrustedAttributes(attributes).create();
    }
  }

  private withTrustedAttributes(attributes: Record<string, any>): this {
    const next = this.clone();
    next.trustedAttributes = { ...next.trustedAttributes, ...attributes };
    return next;
  }

  private clone(): this {
    // Preserve the concrete subclass (its prototype, overridden definition()
    // and state methods) without re-running its field initializers.
    const next = Object.create(Object.getPrototypeOf(this)) as this;
    Object.assign(next, this);
    next.states = [...this.states];
    next.afterMakingHooks = [...this.afterMakingHooks];
    next.afterCreatingHooks = [...this.afterCreatingHooks];
    next.belongsToParents = [...this.belongsToParents];
    next.hasChildren = [...this.hasChildren];
    next.trustedAttributes = { ...this.trustedAttributes };
    return next;
  }
}
