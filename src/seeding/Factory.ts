import type {
  AttachedToRelationName,
  BelongsToRelationName,
  ChildRelationName,
  ModelAttributeInput,
  ModelConstructor,
} from "../model/Model.js";
import { Model, __registerModelFactory } from "../model/Model.js";
import type { Connection } from "../connection/Connection.js";
import { ConnectionManager } from "../connection/ConnectionManager.js";
import { bulkInsertModelRecords, validateBulkInsertChunkSize } from "../model/ModelPersistence.js";
import { ObserverRegistry } from "../model/Observer.js";
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
type AttachedModels = Factory<any> | Model | readonly Model[];
type HasAttached = { factoryOrModels: AttachedModels; pivot: Record<string, any>; relation: string };

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
  private attachedChildren: HasAttached[] = [];
  private trustedAttributes: Record<string, any> = {};
  private recycledModels = new Map<ModelConstructor, Model[]>();
  private factoryConnection?: Connection;

  /** Subclass overrides this to return the base attributes for a record. */
  definition(_sequence: number): FactoryAttributes<T> {
    return {} as FactoryAttributes<T>;
  }

  /** Subclasses may override this to register their default hooks. */
  configure(): this {
    return this;
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
    __registerModelFactory(model as unknown as Function, () => new factoryClass().configure());
  }

  count(amount: number): this {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new RangeError("Factory count must be a non-negative integer.");
    }
    const next = this.clone();
    next.amount = amount;
    return next;
  }

  connection(connection: string | Connection): this {
    const next = this.clone();
    next.factoryConnection = typeof connection === "string"
      ? ConnectionManager.require(connection)
      : connection;
    return next;
  }

  state(state: FactoryState<T>): this {
    const next = this.clone();
    next.states = [...next.states, state];
    return next;
  }

  trashed(): this {
    const model = this.model as unknown as typeof Model;
    if (!model.softDeletes) {
      throw new Error(`Factory.trashed() requires ${model.name} to enable soft deletes.`);
    }
    return this.state(() => ({ [model.deletedAtColumn]: new Date() } as FactoryAttributes<T>));
  }

  recycle(models: Model | readonly Model[]): this {
    const next = this.clone();
    for (const model of Array.isArray(models) ? models : [models]) {
      if (!(model instanceof Model) || !model.$exists) {
        throw new Error("Factory.recycle() requires persisted model instances.");
      }
      const modelClass = model.getModelConstructor() as ModelConstructor;
      const recycled = next.recycledModels.get(modelClass) ?? [];
      if (!recycled.includes(model)) next.recycledModels.set(modelClass, [...recycled, model]);
    }
    return next;
  }

  /** belongsTo parent — a model instance or another Factory (created lazily). */
  for<R extends string & BelongsToRelationName<T>>(parent: Factory<any> | Model, relation?: R): this {
    const next = this.clone();
    next.belongsToParents = [...next.belongsToParents, { factoryOrModel: parent, relation }];
    return next;
  }

  /** Create related children through a hasMany/hasOne relation after persist. */
  has<R extends string & ChildRelationName<T>>(childFactory: Factory<any>, relation: R): this {
    const next = this.clone();
    next.hasChildren = [...next.hasChildren, { factory: childFactory, relation }];
    return next;
  }

  hasAttached<R extends string & AttachedToRelationName<T>>(
    factoryOrModels: AttachedModels,
    relation: R,
  ): this;
  hasAttached<R extends string & AttachedToRelationName<T>>(
    factoryOrModels: AttachedModels,
    pivot: Record<string, any>,
    relation: R,
  ): this;
  hasAttached(
    factoryOrModels: AttachedModels,
    pivotOrRelation: Record<string, any> | string,
    relation?: string,
  ): this {
    const pivot = typeof pivotOrRelation === "string" ? {} : pivotOrRelation;
    const relationName = typeof pivotOrRelation === "string" ? pivotOrRelation : relation;
    if (!relationName) throw new Error("Factory.hasAttached() requires a relationship name.");
    const next = this.clone();
    next.attachedChildren = [
      ...next.attachedChildren,
      { factoryOrModels, pivot: { ...pivot }, relation: relationName },
    ];
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
    if (this.belongsToParents.some(({ factoryOrModel }) => factoryOrModel instanceof Factory)) {
      throw new Error("Factory.make() cannot resolve a parent Factory because make() is synchronous. Pass a persisted model to for(), or use create().");
    }
    const models: T[] = [];
    for (let index = 0; index < this.amount; index++) {
      const attributes = this.attributesFor(index + 1, overrides);
      const model = this.newModel(attributes);
      this.applyBelongsToModels(model);
      (model as any).forceFill(this.trustedAttributes);
      this.runAfterMakingSync(model, index + 1);
      models.push(model);
    }
    return this.amount === 1 ? models[0] : models;
  }

  makeOne(overrides: FactoryAttributes<T> = {}): T {
    return this.count(1).make(overrides) as T;
  }

  async create(overrides: FactoryAttributes<T> = {}): Promise<T | T[]> {
    const models: T[] = [];
    const resolvedParents = new Map<BelongsToParent, Model>();
    for (let index = 0; index < this.amount; index++) {
      const sequence = index + 1;
      const attributes = this.attributesFor(sequence, overrides);
      const model = this.newModel(attributes);
      await this.applyBelongsTo(model, resolvedParents);
      (model as any).forceFill(this.trustedAttributes);
      for (const hook of this.afterMakingHooks) await hook(model, sequence);
      await (model as any).save();
      await this.createHasChildren(model);
      await this.createAttachedChildren(model);
      for (const hook of this.afterCreatingHooks) await hook(model, sequence);
      models.push(model);
    }
    return this.amount === 1 ? models[0] : models;
  }

  async createOne(overrides: FactoryAttributes<T> = {}): Promise<T> {
    return await this.count(1).create(overrides) as T;
  }

  async createMany(overrides: FactoryAttributes<T> = {}): Promise<T[]> {
    const created = await this.create(overrides);
    return Array.isArray(created) ? created : [created];
  }

  createQuietly(overrides: FactoryAttributes<T> = {}): Promise<T | T[]> {
    return ObserverRegistry.withoutEvents(() => this.create(overrides));
  }

  async insert(
    overrides: FactoryAttributes<T> = {},
    options: FactoryInsertOptions = {},
  ): Promise<void> {
    validateBulkInsertChunkSize(options.chunkSize);
    if (this.hasChildren.length > 0 || this.attachedChildren.length > 0) {
      throw new Error("Factory.insert() cannot create child relationships. Use Factory.create() when using has() or hasAttached().");
    }

    const records: FactoryAttributes<T>[] = [];
    const resolvedParents = new Map<BelongsToParent, Model>();
    for (let index = 0; index < this.amount; index++) {
      const sequence = index + 1;
      const model = this.newModel(this.attributesFor(sequence, overrides));
      await this.applyBelongsTo(model, resolvedParents);
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
      connection: this.factoryConnection,
    });
  }

  raw(overrides: FactoryAttributes<T> = {}): FactoryAttributes<T> | FactoryAttributes<T>[] {
    const records = Array.from({ length: this.amount }, (_, i) => this.attributesFor(i + 1, overrides));
    return this.amount === 1 ? records[0] : records;
  }

  rawOne(overrides: FactoryAttributes<T> = {}): FactoryAttributes<T> {
    return this.attributesFor(1, overrides);
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
    const model = new this.model() as any;
    if (this.factoryConnection) model.setConnection(this.factoryConnection);
    return model.forceFill(attributes) as T;
  }

  private async applyBelongsTo(model: T, resolvedParents: Map<BelongsToParent, Model>): Promise<void> {
    for (const parentDefinition of this.belongsToParents) {
      const { factoryOrModel, relation } = parentDefinition;
      let parent = factoryOrModel as Model;
      if (factoryOrModel instanceof Factory) {
        parent = resolvedParents.get(parentDefinition) as Model;
        if (!parent) {
          parent = this.recycledModelFor(factoryOrModel) ?? await factoryOrModel
            .withRecycledModels(this.recycledModels)
            .connection((model as any).getConnection())
            .createOne() as Model;
          resolvedParents.set(parentDefinition, parent);
        }
      }
      const { foreignKey, ownerKey } = this.resolveBelongsToKeys(parent, relation);
      (model as any).setAttribute(foreignKey, (parent as any).getAttribute(ownerKey));
    }
  }

  private applyBelongsToModels(model: T): void {
    for (const { factoryOrModel, relation } of this.belongsToParents) {
      if (factoryOrModel instanceof Factory) continue;
      if (!factoryOrModel.$exists) {
        throw new Error("Factory.make() requires models passed to for() to be persisted.");
      }
      const { foreignKey, ownerKey } = this.resolveBelongsToKeys(factoryOrModel, relation);
      (model as any).setAttribute(foreignKey, factoryOrModel.getAttribute(ownerKey));
    }
  }

  private runAfterMakingSync(model: T, sequence: number): void {
    for (const hook of this.afterMakingHooks) {
      if (hook.constructor.name === "AsyncFunction") {
        throw new Error("Factory.make() cannot run asynchronous afterMaking hooks. Use create() or insert().");
      }
      const result = hook(model, sequence);
      if (result && typeof result.then === "function") {
        void Promise.resolve(result).catch(() => {});
        throw new Error("Factory.make() cannot run asynchronous afterMaking hooks. Use create() or insert().");
      }
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
      await factory
        .withRecycledModels(this.recycledModels)
        .connection((parent as any).getConnection())
        .withTrustedAttributes(attributes)
        .create();
    }
  }

  private async createAttachedChildren(parent: T): Promise<void> {
    for (const { factoryOrModels, pivot, relation } of this.attachedChildren) {
      const relationMethod = (parent as any)[relation];
      if (typeof relationMethod !== "function") {
        throw new Error(`Factory.hasAttached() could not find relationship "${relation}".`);
      }
      const attachment = relationMethod.call(parent);
      if (!attachment || typeof attachment.attach !== "function") {
        throw new Error(`Factory.hasAttached() requires "${relation}" to be a many-to-many relationship.`);
      }

      const created = factoryOrModels instanceof Factory
        ? this.recycledModelsFor(factoryOrModels) ?? await factoryOrModels
          .withRecycledModels(this.recycledModels)
          .connection((parent as any).getConnection())
          .create()
        : factoryOrModels;
      const models = Array.isArray(created) ? created : [created];
      const ids = models.map((model) => {
        const constructor = Object.getPrototypeOf(model).constructor as typeof Model;
        const id = model.getAttribute(constructor.primaryKey);
        if (id === null || id === undefined || id === "") {
          throw new Error("Factory.hasAttached() cannot attach an unsaved model.");
        }
        return id;
      });
      if (ids.length > 0) await attachment.attach(ids, pivot);
    }
  }

  private withTrustedAttributes(attributes: Record<string, any>): this {
    const next = this.clone();
    next.trustedAttributes = { ...next.trustedAttributes, ...attributes };
    return next;
  }

  private withRecycledModels(models: Map<ModelConstructor, Model[]>): this {
    const next = this.clone();
    for (const [model, recycled] of models) {
      const current = next.recycledModels.get(model) ?? [];
      next.recycledModels.set(model, [...current, ...recycled.filter((item) => !current.includes(item))]);
    }
    return next;
  }

  private recycledModelFor(factory: Factory<any>): Model | undefined {
    const recycled = this.recycledModels.get(factory.model);
    return recycled?.[Math.floor(Math.random() * recycled.length)];
  }

  private recycledModelsFor(factory: Factory<any>): Model[] | undefined {
    const recycled = this.recycledModels.get(factory.model);
    if (!recycled) return undefined;
    const shuffled = [...recycled];
    for (let index = shuffled.length - 1; index > 0; index--) {
      const swap = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
    }
    return shuffled.slice(0, factory.amount);
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
    next.attachedChildren = this.attachedChildren.map((attached) => ({
      ...attached,
      pivot: { ...attached.pivot },
    }));
    next.trustedAttributes = { ...this.trustedAttributes };
    next.recycledModels = new Map(
      [...this.recycledModels].map(([model, recycled]) => [model, [...recycled]])
    );
    return next;
  }
}
