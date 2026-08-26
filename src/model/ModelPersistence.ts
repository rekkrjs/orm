import { Builder } from "../query/Builder.js";
import { ObserverRegistry } from "./Observer.js";
import { IdentityMap } from "./IdentityMap.js";
import { ModelNotFoundError } from "./ModelNotFoundError.js";
import { Collection } from "../support/Collection.js";
import { findRelationMethod } from "./ModelBase.js";
import type {
  ModelConstructor,
  BulkModelOptions,
  SaveOptions,
  ModelAttributeInput,
  ModelMassAssignmentInput,
} from "./ModelBase.js";
import { ModelCore } from "./ModelCore.js";
import { isNumericColumnType, shouldGeneratePrimaryKeyForColumn } from "../utils.js";
import type { Connection } from "../connection/Connection.js";
import { insertAndResolveKey, type PrimaryKeyColumn } from "./PrimaryKeyResolution.js";
import { isBackedEnumDefinition } from "./BackedEnum.js";
import { normalizeHydratedCastValue } from "./ModelJsonRow.js";

type TimestampColumns = { createdAt: string; updatedAt: string };

interface BulkInsertModelRecordsOptions {
  trusted: boolean;
  events: boolean;
  chunkSize?: number;
}

export function validateBulkInsertChunkSize(chunkSize?: number): number {
  if (chunkSize !== undefined && (!Number.isInteger(chunkSize) || chunkSize <= 0)) {
    throw new RangeError("Bulk insert chunkSize must be a positive integer.");
  }
  return chunkSize ?? 100;
}

/** Internal bulk writer shared by public Model.insert() and trusted factories. */
export async function bulkInsertModelRecords<M extends ModelConstructor>(
  model: M,
  records: ModelAttributeInput<InstanceType<M>>[],
  options: BulkInsertModelRecordsOptions,
): Promise<any> {
  const chunkSize = validateBulkInsertChunkSize(options.chunkSize);
  if (records.length === 0) return;

  if (options.events && ObserverRegistry.hasAny(model)) {
    const models = records.map((attributes) => {
      const instance = new model() as InstanceType<M>;
      options.trusted ? instance.forceFill(attributes as any) : instance.fill(attributes as any);
      return instance;
    });
    await (model as any).saveMany(models, { chunkSize });
    return models;
  }

  const prepared = await (model as any).prepareBulkRecords(records, undefined, options.trusted);
  const connection = (model as any).getConnection();
  const builder = new Builder(connection, (model as any).getQualifiedTable(connection)).setModel(model);
  let result: any;
  for (let i = 0; i < prepared.length; i += chunkSize) {
    result = await builder.insert(prepared.slice(i, i + chunkSize));
  }
  return result;
}

export class ModelPersistence<T extends Record<string, any> = any> extends ModelCore<T> {
  /**
   * How this model's primary key gets its value: whether we generate it, plus
   * the column itself, which is what decides how the key is read back after an
   * insert. Fetched once so a save costs a single introspection.
   */
  static async primaryKeyStrategy(connection?: Connection): Promise<{ generate: boolean; column: PrimaryKeyColumn | null }> {
    if ((this as any).usesUuids || this.keyType === "uuid") return { generate: true, column: null };
    const { Schema } = await import("../schema/Schema.js");
    const activeConnection = connection ?? (this as any).getConnection();
    const column = await Schema.getColumn(
      (this as any).getQualifiedTable(activeConnection),
      this.primaryKey,
      activeConnection,
    );
    return { generate: shouldGeneratePrimaryKeyForColumn(column), column };
  }

  static async shouldAutoGeneratePrimaryKey(): Promise<boolean> {
    return (await this.primaryKeyStrategy()).generate;
  }

  static async prepareBulkRecords<M extends ModelConstructor>(
    this: M,
    records: ModelAttributeInput<InstanceType<M>>[],
    resolvedTimestampColumns?: TimestampColumns | null,
    trusted = false,
  ): Promise<Record<string, any>[]> {
    const generatePk = await (this as any).shouldAutoGeneratePrimaryKey();
    const timestampColumns = resolvedTimestampColumns === undefined
      ? (this.timestamps ? (this as any).getTimestampColumns() as TimestampColumns : null)
      : resolvedTimestampColumns;
    const now = timestampColumns ? new Date().toISOString() : null;
    const prepared: Record<string, any>[] = [];
    const trustedValidator = trusted ? new this() as InstanceType<M> : null;

    for (const record of records) {
      let attributes: Record<string, any>;
      if (trusted) {
        attributes = { ...record };
        trustedValidator!.validateBackedEnumAttributes(attributes);
      } else {
        const instance = new this() as InstanceType<M>;
        instance.fill(record as any);
        attributes = { ...(instance.$attributes as Record<string, any>) };
      }

      if (now && timestampColumns) {
        if (attributes[timestampColumns.createdAt] === undefined) attributes[timestampColumns.createdAt] = now;
        if (attributes[timestampColumns.updatedAt] === undefined) attributes[timestampColumns.updatedAt] = now;
      }

      if (generatePk) {
        const pk = this.primaryKey;
        const pkValue = attributes[pk];
        if (pkValue === null || pkValue === undefined || pkValue === "") {
          attributes[pk] = crypto.randomUUID();
        }
      }

      prepared.push(attributes);
    }
    return prepared;
  }

  static async prepareBulkRecord<M extends ModelConstructor>(
    this: M,
    record: ModelMassAssignmentInput<InstanceType<M>>,
    options: { touchCreatedAt?: boolean; touchUpdatedAt?: boolean; generatePrimaryKey?: boolean; trusted?: boolean } = {},
    resolvedTimestampColumns?: TimestampColumns | null,
  ): Promise<Record<string, any>> {
    const instance = new this() as InstanceType<M>;
    let attributes: Record<string, any>;
    if (options.trusted) {
      attributes = { ...record };
      instance.validateBackedEnumAttributes(attributes);
    } else {
      instance.fill(record as any);
      attributes = { ...(instance.$attributes as Record<string, any>) };
    }

    const timestampColumns = resolvedTimestampColumns === undefined
      ? (this.timestamps ? (this as any).getTimestampColumns() as TimestampColumns : null)
      : resolvedTimestampColumns;
    if (timestampColumns) {
      const now = instance.freshTimestamp();
      if (options.touchCreatedAt !== false && attributes[timestampColumns.createdAt] === undefined) {
        attributes[timestampColumns.createdAt] = now;
      }
      if (options.touchUpdatedAt !== false && attributes[timestampColumns.updatedAt] === undefined) {
        attributes[timestampColumns.updatedAt] = now;
      }
    }

    if (options.generatePrimaryKey !== false) {
      const primaryKey = this.primaryKey;
      const primaryKeyValue = attributes[primaryKey];
      if ((primaryKeyValue === null || primaryKeyValue === undefined || primaryKeyValue === "") && await (this as any).shouldAutoGeneratePrimaryKey()) {
        attributes[primaryKey] = crypto.randomUUID();
      }
    }

    return attributes;
  }

  static async withoutTimestamps<M extends ModelConstructor, R>(this: M, callback: () => Promise<R>): Promise<R> {
    const original = this.timestamps;
    (this as any).timestamps = false;
    try {
      return await callback();
    } finally {
      (this as any).timestamps = original;
    }
  }

  static hydrate<M extends ModelConstructor>(
    this: M,
    row: Record<string, any>,
    connection?: import("../connection/Connection.js").Connection
  ): InstanceType<M> {
    const instance = new this() as InstanceType<M>;
    const hydrated = { ...row };
    for (const [key, cast] of Object.entries(instance.$mergedCasts)) {
      if (isBackedEnumDefinition(cast)) {
        if (Object.hasOwn(hydrated, key)) {
          instance.validateBackedEnumAttribute(key, hydrated[key]);
        }
        continue;
      }
      const normalized = normalizeHydratedCastValue(cast, hydrated[key]);
      if (normalized !== hydrated[key]) hydrated[key] = normalized;
    }
    instance.$dirtyKeys?.clear();
    const defaults = instance.$attributes as Record<string, any>;
    // Read off the instance, not the prototype: an override can be an instance
    // field (`setConnection = (conn) => …`), which never reaches the prototype.
    const usesDefaultSetConnection = instance.setConnection === ModelCore.prototype.setConnection;

    // Every key below is already an own data property on the instance: the
    // class fields in ModelCore are emitted as definitions (target ESNext, so
    // useDefineForClassFields is on), including the ones with no initialiser
    // like `$connection`. That matters, because `defineProperties` only keeps
    // writable/enumerable/configurable when the property already exists — on a
    // fresh key it would default them to false and freeze `$connection`, so a
    // later `setConnection` would throw. Defining them together also avoids
    // sending every internal assignment through the model's public Proxy.
    Object.defineProperties(instance, {
      $attributes: { value: Object.keys(defaults).length > 0 ? { ...defaults, ...hydrated } : hydrated },
      $original: { value: { ...hydrated } },
      $castCache: { value: {} },
      $exists: { value: true },
      ...(connection && usesDefaultSetConnection ? { $connection: { value: connection } } : {}),
    });
    if (connection && !usesDefaultSetConnection) instance.setConnection(connection);
    return instance;
  }

  static async create<M extends ModelConstructor>(
    this: M,
    attributes: ModelMassAssignmentInput<InstanceType<M>>,
    options: SaveOptions = {}
  ): Promise<InstanceType<M>> {
    return (this as any).query().create(attributes, options);
  }

  static async forceCreate<M extends ModelConstructor>(
    this: M,
    attributes: ModelAttributeInput<InstanceType<M>>,
    options: SaveOptions = {}
  ): Promise<InstanceType<M>> {
    const instance = new this() as InstanceType<M>;
    for (const [key, value] of Object.entries(attributes)) {
      instance.setAttribute(key as any, value as any);
    }
    await instance.save(options);
    return instance;
  }

  static async truncate<M extends ModelConstructor>(this: M): Promise<void> {
    const connection = (this as any).getConnection();
    await connection.run(`DELETE FROM ${(this as any).getQualifiedTable(connection)}`);
  }

  static async insert<M extends ModelConstructor>(
    this: M,
    records: ModelMassAssignmentInput<InstanceType<M>> | ModelMassAssignmentInput<InstanceType<M>>[],
    options: BulkModelOptions = {}
  ): Promise<any> {
    const list = Array.isArray(records) ? records : [records];
    return await bulkInsertModelRecords(this, list as any, {
      trusted: false,
      events: options.events !== false,
      chunkSize: options.chunkSize,
    });
  }

  static async upsert<M extends ModelConstructor>(
    this: M,
    records: ModelMassAssignmentInput<InstanceType<M>> | ModelMassAssignmentInput<InstanceType<M>>[],
    uniqueBy: any | any[],
    updateColumns?: any[],
    options: Omit<BulkModelOptions, "events"> = {}
  ): Promise<any> {
    const timestampColumns = this.timestamps
      ? (this as any).getTimestampColumns() as TimestampColumns
      : null;
    const prepared = await (this as any).prepareBulkRecords(
      Array.isArray(records) ? records : [records],
      timestampColumns,
    );
    const chunkSize = options.chunkSize || prepared.length || 1;
    let columns = updateColumns;
    if (!columns && timestampColumns) {
      const uniqueColumns = new Set(Array.isArray(uniqueBy) ? uniqueBy : [uniqueBy]);
      columns = Object.keys(prepared[0] || {}).filter(
        (column) => column !== timestampColumns.createdAt && !uniqueColumns.has(column as any)
      ) as any;
    }
    let result: any;
    for (let i = 0; i < prepared.length; i += chunkSize) {
      result = await (this as any).query().upsert(prepared.slice(i, i + chunkSize) as any, uniqueBy as any, columns as any);
    }
    return result;
  }

  static async updateOrInsert<M extends ModelConstructor>(
    this: M,
    attributes: ModelAttributeInput<InstanceType<M>>,
    values: ModelMassAssignmentInput<InstanceType<M>> = {}
  ): Promise<boolean> {
    const exists = await (this as any).where(attributes).exists();
    if (exists) {
      const update = await (this as any).prepareBulkRecord(values, { touchUpdatedAt: true, touchCreatedAt: false, generatePrimaryKey: false });
      await (this as any).where(attributes).update(update as any);
      return true;
    }
    const instance = new this() as InstanceType<M>;
    instance.fill(values as any);
    instance.forceFill(attributes as any);
    await instance.save();
    return true;
  }

  static async createMany<M extends ModelConstructor>(
    this: M,
    records: ModelMassAssignmentInput<InstanceType<M>>[],
    options: BulkModelOptions = {}
  ): Promise<InstanceType<M>[]> {
    const models = records.map((attributes) => new this(attributes) as InstanceType<M>);
    await (this as any).saveMany(models, options);
    return models;
  }

  static async saveMany<M extends ModelConstructor>(
    this: M,
    models: InstanceType<M>[],
    options: BulkModelOptions = {}
  ): Promise<InstanceType<M>[]> {
    const chunkSize = options.chunkSize || models.length || 1;
    const events = options.events !== false;
    if (events) {
      for (const model of models) {
        await model.save();
      }
      return models;
    }

    for (const model of models) {
      model.validateBackedEnumAttributes();
    }

    const timestampColumns = this.timestamps
      ? (this as any).getTimestampColumns() as TimestampColumns
      : null;

    for (let i = 0; i < models.length; i += chunkSize) {
      const chunk = models.slice(i, i + chunkSize);
      const newModels = chunk.filter((model) => !model.$exists);
      const existingModels = chunk.filter((model) => model.$exists);

      if (newModels.length > 0) {
        const keyStrategy = await (this as any).primaryKeyStrategy();
        const shouldGeneratePrimaryKey = keyStrategy.generate;
        const bulkModels: InstanceType<M>[] = [];
        for (const model of newModels) {
          Object.assign(model.$attributes, model.getDirty());
          const pk = model.getAttribute(this.primaryKey);
          if (!shouldGeneratePrimaryKey && (pk === null || pk === undefined || pk === "")) {
            const record = await (this as any).prepareBulkRecord(
              model.$attributes as any,
              { trusted: true },
              timestampColumns,
            );
            const connection = (this as any).getConnection();
            const id = await insertAndResolveKey(
              connection,
              (this as any).getQualifiedTable(connection),
              model.attributesForDriver(connection, record),
              this.primaryKey,
              keyStrategy.column
            );
            if (id !== null && id !== undefined && id !== "") record[this.primaryKey] = id;
            model.$attributes = record as any;
            model.markAttributesPersisted();
            model.$exists = true;
          } else {
            bulkModels.push(model);
          }
        }

        if (bulkModels.length > 0) {
          const records = await (this as any).prepareBulkRecords(
            bulkModels.map((model) => model.$attributes as any),
            timestampColumns,
            true,
          );
          await (this as any).query().insert(records as any);
          for (let index = 0; index < bulkModels.length; index++) {
            bulkModels[index].$attributes = records[index] as any;
            bulkModels[index].markAttributesPersisted();
            bulkModels[index].$exists = true;
          }
        }
      }

      for (const model of existingModels) {
        let dirty = model.getDirty();
        Object.assign(model.$attributes, dirty);
        if (Object.keys(dirty).length > 0 && timestampColumns) {
          const now = model.freshTimestamp();
          (model.$attributes as any)[timestampColumns.updatedAt] = now;
          delete model.$castCache[timestampColumns.updatedAt];
          (dirty as any)[timestampColumns.updatedAt] = now;
        }
        if (Object.keys(dirty).length === 0) continue;
        await (this as any).query().where(this.primaryKey, model.getAttribute(this.primaryKey)).update(dirty as any);
        model.markAttributesPersisted();
      }
    }

    if (IdentityMap.current()) {
      const connection = (this as any).getConnection();
      const table = (this as any).getQualifiedTable(connection);
      for (const model of models) {
        const pk = model.getAttribute(this.primaryKey);
        if (model.$exists && pk !== null && pk !== undefined && pk !== "") {
          IdentityMap.set(table, pk, model as any, connection);
        }
      }
    }
    return models;
  }

  static async find<M extends ModelConstructor>(this: M, id: any): Promise<InstanceType<M> | null> {
    return (this as any).query().find(id, this.primaryKey);
  }

  static async findOr<M extends ModelConstructor, TFallback>(this: M, id: any, callback: () => TFallback): Promise<InstanceType<M> | Awaited<TFallback>> {
    return (this as any).query().findOr(id, callback, this.primaryKey);
  }

  static async findMany<M extends ModelConstructor>(this: M, ids: any[]): Promise<Collection<InstanceType<M>>> {
    return (this as any).query().findMany(ids, this.primaryKey);
  }

  static async findOrFail<M extends ModelConstructor>(this: M, id: any): Promise<InstanceType<M>> {
    const result = await (this as any).find(id);
    if (!result) {
      throw new ModelNotFoundError(this.name, id);
    }
    return result;
  }

  static async first<M extends ModelConstructor>(this: M): Promise<InstanceType<M> | null> {
    return (this as any).query().first();
  }

  static async firstOr<M extends ModelConstructor, TFallback>(this: M, callback: () => TFallback): Promise<InstanceType<M> | Awaited<TFallback>> {
    return (this as any).query().firstOr(callback);
  }

  static firstWhere<M extends ModelConstructor>(this: M, column: any, operator: any, value?: any): Promise<InstanceType<M> | null> {
    return (this as any).query().firstWhere(column, operator, value);
  }

  static async firstOrFail<M extends ModelConstructor>(this: M): Promise<InstanceType<M>> {
    const result = await (this as any).first();
    if (!result) {
      throw new ModelNotFoundError(this.name);
    }
    return result;
  }

  static async firstOrNew<M extends ModelConstructor>(
    this: M,
    attributes: ModelAttributeInput<InstanceType<M>> = {},
    values: ModelMassAssignmentInput<InstanceType<M>> = {}
  ): Promise<InstanceType<M>> {
    return (this as any).query().firstOrNew(attributes, values);
  }

  static async firstOrCreate<M extends ModelConstructor>(
    this: M,
    attributes: ModelAttributeInput<InstanceType<M>> = {},
    values: ModelMassAssignmentInput<InstanceType<M>> = {}
  ): Promise<InstanceType<M>> {
    return (this as any).query().firstOrCreate(attributes, values);
  }

  static async updateOrCreate<M extends ModelConstructor>(
    this: M,
    attributes: ModelAttributeInput<InstanceType<M>>,
    values: ModelMassAssignmentInput<InstanceType<M>> = {}
  ): Promise<InstanceType<M>> {
    return (this as any).query().updateOrCreate(attributes, values);
  }

  // Instance persistence methods
  async save(options: SaveOptions = {}): Promise<this> {
    const constructor = this.getModelConstructor() as typeof ModelPersistence;
    const events = options.events !== false;

    if (this.$exists) {
      this.$wasRecentlyCreated = false;
      if (events) await ObserverRegistry.dispatch("saving", this as any);
      this.validateBackedEnumAttributes();

      let dirty = this.getDirty();
      if (Object.keys(dirty).length > 0) {
        const pk = this.getAttribute(constructor.primaryKey);
        if (pk === null || pk === undefined || pk === "") {
          throw new Error(
            `Cannot update ${constructor.name}: it carries no "${constructor.primaryKey}" value, so there is no row to target. ` +
              `Load the record with its primary key selected, or set one before saving.`
          );
        }
        if (events) await ObserverRegistry.dispatch("updating", this as any);
        dirty = this.getDirty();
        Object.assign(this.$attributes, dirty);
        if (constructor.timestamps) {
          const { updatedAt } = constructor.getTimestampColumns();
          const now = this.freshTimestamp();
          (this.$attributes as any)[updatedAt] = now;
          delete this.$castCache[updatedAt];
          (dirty as any)[updatedAt] = now;
        }
        if (Object.keys(dirty).length > 0) {
          const persistedAttributes = { ...this.$attributes } as Partial<T>;
          const connection = this.getConnection();
          await new Builder(connection, constructor.getQualifiedTable(connection))
            .where(constructor.primaryKey, pk)
            .update(this.attributesForDriver(connection, dirty as Record<string, any>) as any);
          this.$changes = { ...dirty };
          this.markAttributesPersisted(persistedAttributes);
          if (events) await ObserverRegistry.dispatch("updated", this as any);
        } else {
          this.$changes = {};
          this.markAttributesPersisted();
        }
      } else {
        this.$changes = {};
        this.markAttributesPersisted();
      }

      if (events) await ObserverRegistry.dispatch("saved", this as any);
    } else {
      if (events) await ObserverRegistry.dispatch("creating", this as any);
      if (events) await ObserverRegistry.dispatch("saving", this as any);
      this.validateBackedEnumAttributes();

      if (constructor.timestamps) {
        const { createdAt, updatedAt } = constructor.getTimestampColumns();
        const now = this.freshTimestamp();
        (this.$attributes as any)[createdAt] = now;
        (this.$attributes as any)[updatedAt] = now;
        delete this.$castCache[createdAt];
        delete this.$castCache[updatedAt];
      }

      // Mutable casts live in the cast cache until they are read as dirty. An
      // insert writes every attribute, so materialize those edits first.
      Object.assign(this.$attributes, this.getDirty());

      const primaryKey = constructor.primaryKey;
      const primaryKeyValue = this.getAttribute(primaryKey);
      const connection = this.getConnection();
      const keyStrategy = await constructor.primaryKeyStrategy(connection);
      const shouldGeneratePrimaryKey = keyStrategy.generate;
      if ((primaryKeyValue === null || primaryKeyValue === undefined || primaryKeyValue === "") && shouldGeneratePrimaryKey) {
        const generated = crypto.randomUUID();
        (this.$attributes as any)[primaryKey] = generated;
        delete this.$castCache[primaryKey];
      }

      if (shouldGeneratePrimaryKey || primaryKeyValue !== null && primaryKeyValue !== undefined && primaryKeyValue !== "") {
        await new Builder(connection, constructor.getQualifiedTable(connection)).insert(this.attributesForDriver(connection) as any);
      } else {
        const table = constructor.getQualifiedTable(connection);
        const key = await insertAndResolveKey(
          connection,
          table,
          this.attributesForDriver(connection),
          primaryKey,
          keyStrategy.column
        );
        if (key !== null && key !== undefined && key !== "") {
          (this.$attributes as any)[primaryKey] = key;
          delete this.$castCache[primaryKey];
        }
      }

      this.$exists = true;
      this.$wasRecentlyCreated = true;
      this.$changes = {};
      this.markAttributesPersisted();

      if (events) await ObserverRegistry.dispatch("created", this as any);
      if (events) await ObserverRegistry.dispatch("saved", this as any);
    }

    const identityMap = IdentityMap.current();
    if (identityMap) {
      const pk = this.getAttribute(constructor.primaryKey);
      if (pk !== null && pk !== undefined && pk !== "") {
        const connection = this.getConnection();
        IdentityMap.set(constructor.getQualifiedTable(connection), pk, this as any, connection);
      }
    }

    await this.touchOwners();

    return this;
  }

  async update(attributes: ModelMassAssignmentInput<this>, options: SaveOptions = {}): Promise<this> {
    this.fill(attributes);
    return this.save(options);
  }

  updateQuietly(attributes: ModelMassAssignmentInput<this>): Promise<this> {
    return this.update(attributes, { events: false });
  }

  private async touchOwners(): Promise<void> {
    const constructor = this.getModelConstructor() as typeof ModelPersistence;
    const touches = constructor.touches || [];
    for (const relationName of touches) {
      const method = findRelationMethod(this, relationName);
      if (!method) continue;
      const relation = method.call(this);
      if (relation && typeof relation.getResults === "function") {
        const related = await relation.getResults();
        if (related && typeof (related as any).touch === "function") {
          await (related as any).touch();
        }
      }
    }
  }

  saveQuietly(): Promise<this> {
    return this.save({ events: false });
  }

  async touch(): Promise<boolean> {
    if (!this.$exists) return false;
    const constructor = this.getModelConstructor() as typeof ModelPersistence;
    if (!constructor.timestamps) return false;
    const { updatedAt } = constructor.getTimestampColumns();
    const now = this.freshTimestamp();
    const pk = this.getAttribute(constructor.primaryKey);
    const connection = this.getConnection();
    await new Builder(connection, constructor.getQualifiedTable(connection))
      .where(constructor.primaryKey, pk)
      .update(this.attributesForDriver(connection, { [updatedAt]: now }) as any);
    (this.$attributes as any)[updatedAt] = now;
    delete this.$castCache[updatedAt];
    this.syncPersistedOriginal([updatedAt]);
    return true;
  }

  async increment<K extends string>(column: K, amount: number = 1, extra: Record<string, any> = {}): Promise<this> {
    const constructor = this.getModelConstructor() as typeof ModelPersistence;
    const pk = this.getAttribute(constructor.primaryKey);
    if (!pk) return this;

    const connection = this.getConnection();
    const builder = new Builder(connection, constructor.getQualifiedTable(connection))
      .setModel(constructor as any)
      .where(constructor.primaryKey, pk);

    if (constructor.timestamps) {
      const { updatedAt } = constructor.getTimestampColumns();
      extra = { ...extra, [updatedAt]: this.freshTimestamp() };
    }

    this.validateBackedEnumAttribute(column, amount);
    this.validateBackedEnumAttributes(extra);
    const incrementedValue = ((this.$attributes as any)[column] || 0) + amount;

    await builder.increment(column, amount, extra);
    (this.$attributes as any)[column] = incrementedValue;
    delete this.$castCache[column as string];
    for (const [key, value] of Object.entries(extra)) {
      (this.$attributes as any)[key] = value;
      delete this.$castCache[key];
    }
    this.syncPersistedOriginal([column, ...Object.keys(extra)]);
    if (IdentityMap.current()) {
      IdentityMap.set(constructor.getQualifiedTable(connection), pk, this as any, connection);
    }
    return this;
  }

  async decrement<K extends string>(column: K, amount: number = 1, extra: Record<string, any> = {}): Promise<this> {
    return this.increment(column, -amount, extra);
  }

  async delete(): Promise<boolean> {
    const constructor = this.getModelConstructor() as typeof ModelPersistence;
    const pk = this.getAttribute(constructor.primaryKey);
    if (!pk) return false;
    await ObserverRegistry.dispatch("deleting", this as any);

    if (constructor.softDeletes) {
      const deletedAt = this.freshTimestamp();
      const connection = this.getConnection();
      await new Builder(connection, constructor.getQualifiedTable(connection))
        .where(constructor.primaryKey, pk)
        .update(this.attributesForDriver(connection, { [constructor.deletedAtColumn]: deletedAt }) as any);
      (this.$attributes as any)[constructor.deletedAtColumn] = deletedAt;
      delete this.$castCache[constructor.deletedAtColumn];
      this.syncPersistedOriginal([constructor.deletedAtColumn]);
    } else {
      const connection = this.getConnection();
      await new Builder(connection, constructor.getQualifiedTable(connection))
        .where(constructor.primaryKey, pk)
        .delete();
      this.$exists = false;
      this.$dirtyKeys?.clear();
    }

    const identityMap = IdentityMap.current();
    if (identityMap) {
      IdentityMap.delete(constructor.getQualifiedTable(this.getConnection()), pk, this.getConnection());
    }

    await ObserverRegistry.dispatch("deleted", this as any);
    return true;
  }

  async deleteQuietly(): Promise<boolean> {
    const constructor = this.getModelConstructor() as typeof ModelPersistence;
    const pk = this.getAttribute(constructor.primaryKey);
    if (!pk) return false;

    if (constructor.softDeletes) {
      const deletedAt = this.freshTimestamp();
      const connection = this.getConnection();
      await new Builder(connection, constructor.getQualifiedTable(connection))
        .where(constructor.primaryKey, pk)
        .update(this.attributesForDriver(connection, { [constructor.deletedAtColumn]: deletedAt }) as any);
      (this.$attributes as any)[constructor.deletedAtColumn] = deletedAt;
      delete this.$castCache[constructor.deletedAtColumn];
      this.syncPersistedOriginal([constructor.deletedAtColumn]);
    } else {
      const connection = this.getConnection();
      await new Builder(connection, constructor.getQualifiedTable(connection))
        .where(constructor.primaryKey, pk)
        .delete();
      this.$exists = false;
      this.$dirtyKeys?.clear();
    }

    const identityMap = IdentityMap.current();
    if (identityMap) IdentityMap.delete(constructor.getQualifiedTable(this.getConnection()), pk, this.getConnection());

    return true;
  }

  async restore(): Promise<boolean> {
    const constructor = this.getModelConstructor() as typeof ModelPersistence;
    if (!constructor.softDeletes) return false;
    const pk = this.getAttribute(constructor.primaryKey);
    if (!pk) return false;

    const connection = this.getConnection();
    await new Builder(connection, constructor.getQualifiedTable(connection))
      .where(constructor.primaryKey, pk)
      .update({ [constructor.deletedAtColumn]: null } as any);
    (this.$attributes as any)[constructor.deletedAtColumn] = null;
    delete this.$castCache[constructor.deletedAtColumn];
    this.syncPersistedOriginal([constructor.deletedAtColumn]);
    this.$exists = true;
    if (IdentityMap.current()) {
      IdentityMap.set(constructor.getQualifiedTable(connection), pk, this as any, connection);
    }
    return true;
  }

  async forceDelete(): Promise<boolean> {
    const constructor = this.getModelConstructor() as typeof ModelPersistence;
    const pk = this.getAttribute(constructor.primaryKey);
    if (!pk) return false;
    const connection = this.getConnection();
    await new Builder(connection, constructor.getQualifiedTable(connection))
      .where(constructor.primaryKey, pk)
      .delete();
    this.$exists = false;
    this.$dirtyKeys?.clear();

    const identityMap = IdentityMap.current();
    if (identityMap) {
      IdentityMap.delete(constructor.getQualifiedTable(connection), pk, connection);
    }

    return true;
  }

  async fresh(): Promise<this | null> {
    if (!this.$exists) return null;

    const constructor = this.getModelConstructor() as typeof ModelPersistence;
    const pk = this.getAttribute(constructor.primaryKey);
    const connection = this.getConnection();
    const table = constructor.getQualifiedTable(connection);
    const identityMap = IdentityMap.current();
    IdentityMap.delete(table, pk, connection);

    const fresh = await constructor.on(connection)
      .withoutGlobalScopes()
      .find(pk, constructor.primaryKey) as this | null;
    if (identityMap && fresh) IdentityMap.set(table, pk, this as any, connection);
    return fresh;
  }

  async refresh(): Promise<this> {
    const constructor = this.getModelConstructor() as typeof ModelPersistence;
    const pk = this.getAttribute(constructor.primaryKey);
    if (pk === null || pk === undefined || pk === "") return this;

    const connection = this.getConnection();
    const table = constructor.getQualifiedTable(connection);
    const identityMap = IdentityMap.current();
    IdentityMap.delete(table, pk, connection);

    const result = await constructor.on(connection)
      .withoutGlobalScopes()
      .findOrFail(pk, constructor.primaryKey) as this;
    this.$attributes = { ...result.$attributes } as T;
    this.$castCache = {};
    this.markAttributesPersisted();
    if (identityMap) IdentityMap.set(table, pk, this as any, connection);
    return this;
  }
}
