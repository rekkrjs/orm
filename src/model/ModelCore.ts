import { Connection } from "../connection/Connection.js";
import { Builder } from "../query/Builder.js";
import { Schema } from "../schema/Schema.js";
import { ConnectionManager } from "../connection/ConnectionManager.js";
import { TenantContext } from "../connection/TenantContext.js";
import { TransactionContext } from "../connection/TransactionContext.js";
import { IdentityMap } from "./IdentityMap.js";
import { ModelSchemaBuilder } from "./ModelSchemaBuilder.js";
import {
  getModelTarget,
  modelProxyHandler,
  getGlobalScopes,
  globalScopes,
  globalScopesCache,
} from "./ModelBase.js";
import type {
  ModelConstructor,
  GlobalScope,
  CastDefinition,
  CastsAttributes,
  AccessorMap,
  ModelAttributeInput,
  ModelMassAssignmentInput,
  BulkModelOptions,
} from "./ModelBase.js";
import { formatDecimal, snakeCase } from "../utils.js";
import { MassAssignmentError } from "./MassAssignmentError.js";
import {
  assertBackedEnumValue as assertEnumValue,
  isBackedEnumDefinition,
  type BackedEnumDefinition,
} from "./BackedEnum.js";
import { assertSupportedStringCast, castBuiltInAttribute, implicitDateCasts } from "./ModelJsonRow.js";

function dateCastKeys(casts: Record<string, any>): string[] {
  const keys: string[] = [];
  for (const [key, cast] of Object.entries(casts ?? {})) {
    const type = typeof cast === "string" ? cast.split(":")[0] : undefined;
    if (type === "date" || type === "datetime" || type === "timestamp") keys.push(key);
  }
  return keys;
}

function booleanCastKeys(casts: Record<string, any>): string[] {
  const keys: string[] = [];
  for (const [key, cast] of Object.entries(casts ?? {})) {
    const type = typeof cast === "string" ? cast.split(":")[0] : undefined;
    if (type === "boolean" || type === "bool") keys.push(key);
  }
  return keys;
}

/** Cast keys whose decoded value is an object the caller can mutate in place. */
interface MutableCastKeys {
  json: Set<string>;
  date: Set<string>;
}

const noMutableCastKeys: MutableCastKeys = { json: new Set(), date: new Set() };
const mutableCastKeysCache = new WeakMap<Record<string, any>, MutableCastKeys>();

/**
 * Splits a cast map into the casts that decode to a mutable object, so the cast
 * cache — not `$attributes` — holds the current state and `getDirty` has to
 * consult it to notice an in-place change.
 *
 * Keyed on the cast map object itself, which every model copies fresh, so an
 * entry can never outlive the casts it describes — the trade is that the cache
 * amortizes repeated calls on one model rather than across a whole class.
 * `getDirty` runs on every `save` and `isDirty`, which is why this is one pass
 * rather than a scan per category.
 */
function mutableCastKeys(casts: Record<string, any>): MutableCastKeys {
  if (!casts) return noMutableCastKeys;
  const cached = mutableCastKeysCache.get(casts);
  if (cached) return cached;

  // Built lazily: most models cast nothing mutable, and those should reach the
  // shared empty pair without allocating a Set they would never fill.
  let json: Set<string> | null = null;
  let date: Set<string> | null = null;
  for (const [key, cast] of Object.entries(casts)) {
    if (typeof cast !== "string") continue;
    const separator = cast.indexOf(":");
    const type = separator === -1 ? cast : cast.slice(0, separator);
    if (type === "json" || type === "array" || type === "object") (json ??= new Set()).add(key);
    else if (type === "date" || type === "datetime" || type === "timestamp") (date ??= new Set()).add(key);
  }

  const entry: MutableCastKeys = json || date
    ? { json: json ?? noMutableCastKeys.json, date: date ?? noMutableCastKeys.date }
    : noMutableCastKeys;
  mutableCastKeysCache.set(casts, entry);
  return entry;
}

/** Dates compare by instant: two Date objects for the same moment are equal. */
function sameAttributeValue(before: unknown, after: unknown): boolean {
  if (before instanceof Date || after instanceof Date) {
    const a = before instanceof Date ? before.getTime() : new Date(before as any).getTime();
    const b = after instanceof Date ? after.getTime() : new Date(after as any).getTime();
    if (!Number.isNaN(a) && !Number.isNaN(b)) return a === b;
  }
  return before === after;
}

type MassAssignmentPolicy = {
  kind: "fillable" | "guarded";
  attributes: readonly string[];
};

const DEFAULT_MASS_ASSIGNMENT_POLICY: MassAssignmentPolicy = {
  kind: "guarded",
  attributes: ["*"],
};

function resolveMassAssignmentPolicy(constructor: typeof ModelCore): MassAssignmentPolicy {
  let current: any = constructor;
  while (current && current !== ModelCore && current !== Function.prototype) {
    const hasFillable = Object.prototype.hasOwnProperty.call(current, "fillable");
    const hasGuarded = Object.prototype.hasOwnProperty.call(current, "guarded");
    if (hasFillable && hasGuarded) {
      throw new Error(
        `${current.name} cannot declare both fillable and guarded mass assignment policies.`
      );
    }
    if (hasFillable) return { kind: "fillable", attributes: current.fillable ?? [] };
    if (hasGuarded) return { kind: "guarded", attributes: current.guarded ?? [] };
    current = Object.getPrototypeOf(current);
  }
  return DEFAULT_MASS_ASSIGNMENT_POLICY;
}

const validatedMassAssignmentPolicies = new WeakSet<typeof ModelCore>();

function validateMassAssignmentPolicy(constructor: typeof ModelCore): void {
  if (validatedMassAssignmentPolicies.has(constructor)) return;
  resolveMassAssignmentPolicy(constructor);
  validatedMassAssignmentPolicies.add(constructor);
}

function isDangerousMassAssignmentKey(key: string): boolean {
  return key.startsWith("$") || key === "__proto__" || key === "prototype" || key === "constructor";
}

function policyAllows(policy: MassAssignmentPolicy, key: string): boolean {
  if (policy.kind === "fillable") return policy.attributes.includes(key);
  return !policy.attributes.includes("*") && !policy.attributes.includes(key);
}

function isTotallyGuarded(policy: MassAssignmentPolicy): boolean {
  return policy.kind === "fillable"
    ? policy.attributes.length === 0
    : policy.attributes.includes("*");
}

export class ModelCore<T extends Record<string, any> = any> {
  static table: string;
  static modelSchema?: string;
  static primaryKey = "id";
  static timestamps = true;
  static createdAtColumn = "created_at";
  static updatedAtColumn = "updated_at";
  static connection?: Connection;
  static dateFormat = "YYYY-MM-DD HH:mm:ss";
  static keyType: "int" | "string" | "uuid" = "int";
  static incrementing = true;
  static usesUuids = false;
  static morphName?: string;
  static casts: Record<string, CastDefinition> = {};
  static fillable: readonly string[] = [];
  static guarded: readonly string[] = ["*"];
  static attributes: Record<string, any> = {};
  static softDeletes = false;
  static deletedAtColumn = "deleted_at";
  static preventLazyLoading = false;
  static preventSilentlyDiscardingAttributes = false;
  static hidden: readonly string[] = [];
  static visible: readonly string[] = [];
  static appends: readonly string[] = [];
  static accessors: AccessorMap<any, any> = {};
  static touches: readonly string[] = [];
  $attributes = {} as T;
  $original = {} as Partial<T>;
  $changes = {} as Partial<T>;
  $exists = false;
  $relations: Record<string, any> = {};
  $casts: Record<string, CastDefinition> = {};
  $castCache: Record<string, any> = {};
  $mergedCasts: Record<string, CastDefinition> = {};
  $dirtyKeys?: Set<string>;
  $connection?: Connection;
  $hidden: string[] = [];
  $visible: string[] = [];
  $appends: string[] = [];
  $wasRecentlyCreated = false;

  constructor(attributes?: Partial<T>) {
    const ctor = this.constructor as typeof ModelCore;
    validateMassAssignmentPolicy(ctor);
    const staticCasts = ctor.casts || {};
    // A copy, never the static object itself: `casts` is public, and code that
    // adds a cast in place would otherwise keep the identity that mutableCastKeys
    // caches against, so the new cast would stay invisible to getDirty.
    this.$mergedCasts = { ...implicitDateCasts(ctor), ...staticCasts };
    const defaults = ctor.attributes || {};
    if (Object.keys(defaults).length > 0) {
      this.forceFill({ ...defaults } as any);
    }
    if (attributes) {
      this.fill(attributes as any);
    }
    return new Proxy(this, modelProxyHandler);
  }

  static _defineBase<A extends Record<string, any>>(
    tableName: string,
    modelNameOrColumns?: string | Partial<Record<keyof A, string>>,
    columnsArg?: Partial<Record<keyof A, string>>
  ): any {
    const modelName = typeof modelNameOrColumns === "string" ? modelNameOrColumns : undefined;
    const columnHints = (typeof modelNameOrColumns === "object" ? modelNameOrColumns : columnsArg) as Record<string, string> | undefined;
    const name = modelName || tableName
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join("")
      .replace(/s$/, "");
    const Base = class extends (this as unknown as typeof ModelCore)<A> {
      static override table = tableName;
      static override casts: Record<string, CastDefinition> = columnHints ?? {};
    };
    if (columnHints) {
      Object.defineProperty(Base, "fillable", {
        configurable: true,
        value: Object.keys(columnHints),
        writable: true,
      });
    }
    Object.defineProperty(Base, "name", { value: name, writable: false, configurable: true });
    return Base;
  }

  static getTable(): string {
    validateMassAssignmentPolicy(this);
    return this.table || snakeCase(this.name) + "s";
  }

  static getCreatedAtColumn(): string {
    const column = this.createdAtColumn;
    if (typeof column !== "string" || column.length === 0) {
      throw new Error(`${this.name}.createdAtColumn must be a non-empty string.`);
    }
    return column;
  }

  static getUpdatedAtColumn(): string {
    const column = this.updatedAtColumn;
    if (typeof column !== "string" || column.length === 0) {
      throw new Error(`${this.name}.updatedAtColumn must be a non-empty string.`);
    }
    return column;
  }

  protected static getTimestampColumns(): { createdAt: string; updatedAt: string } {
    const createdAt = this.getCreatedAtColumn();
    const updatedAt = this.getUpdatedAtColumn();
    if (createdAt === updatedAt) {
      throw new Error(`${this.name} must use different created-at and updated-at columns.`);
    }
    return { createdAt, updatedAt };
  }

  static resolveSchema(connection?: Connection): string | undefined {
    const configured = Object.prototype.hasOwnProperty.call(this, "modelSchema") ? this.modelSchema : undefined;
    if (configured) {
      Connection.assertSafeIdentifier(configured, "model schema");
      return configured;
    }

    const activeConnection = connection ?? this.getConnection();
    const fromConnection = activeConnection.getSchema();
    if (fromConnection) return fromConnection;

    // Keep PostgreSQL landlord reads explicit even when no tenant context is active.
    if (activeConnection.getDriverName() === "postgres") return "public";
    return undefined;
  }

  static getQualifiedTable(connection?: Connection): string {
    const activeConnection = connection ?? this.getConnection();
    const table = this.getTable();
    if (table.includes(".")) {
      Connection.assertSafeQualifiedIdentifier(table, "qualified table name");
      return table;
    }
    const schema = this.resolveSchema(activeConnection);
    if (!schema || activeConnection.getDriverName() === "sqlite") {
      return activeConnection.qualifyTable(table);
    }
    return activeConnection.withSchema(schema).qualifyTable(table);
  }

  /**
   * Columns this model stores dates in. The query builder asks for these so a
   * date reaches the driver in the shape it accepts, no matter which write path
   * produced it.
   */
  static dateColumns(): string[] {
    const keys = dateCastKeys(this.casts);
    if (this.timestamps) {
      const { createdAt, updatedAt } = this.getTimestampColumns();
      keys.push(createdAt, updatedAt);
    }
    if (this.softDeletes) keys.push(this.deletedAtColumn);
    return [...new Set(keys)];
  }

  /** Columns whose effective read cast decodes them to a Date. */
  static dateCastColumns(): string[] {
    const casts = { ...implicitDateCasts(this), ...(this.casts || {}) };
    return [...mutableCastKeys(casts).date];
  }

  /** Columns whose portable in-memory 1/0 cast must become native booleans on PostgreSQL. */
  static booleanColumns(): string[] {
    return booleanCastKeys(this.casts);
  }

  static schema(): ModelSchemaBuilder {
    const timestampColumns = this.timestamps ? this.getTimestampColumns() : undefined;
    return new ModelSchemaBuilder(this.getTable(), this.getConnection(), {
      casts: this.casts,
      fillable: this.fillable ?? [],
      attributes: this.attributes,
      primaryKey: this.primaryKey,
      keyType: this.keyType,
      incrementing: this.incrementing,
      timestamps: this.timestamps,
      createdAtColumn: timestampColumns?.createdAt ?? this.createdAtColumn,
      updatedAtColumn: timestampColumns?.updatedAt ?? this.updatedAtColumn,
      softDeletes: this.softDeletes,
      deletedAtColumn: this.deletedAtColumn,
      schemaDefinition: (this as any).schemaDefinition,
    });
  }

  static getConnection(): Connection {
    const transactionConnection = TransactionContext.current();
    if (transactionConnection) return transactionConnection;
    const tenantConnection = TenantContext.current()?.connection;
    const ownConnection = Object.prototype.hasOwnProperty.call(this, "connection") ? this.connection : undefined;
    const connection = tenantConnection || ownConnection || this.connection || ConnectionManager.getDefault();
    if (!connection) {
      throw new Error(`No connection set on model ${this.name}`);
    }
    return connection;
  }

  static setConnection(connection: Connection): void {
    this.connection = connection;
    ConnectionManager.setDefault(connection);
  }

  static useIdentityMap<T>(callback: () => T | Promise<T>): Promise<T> {
    return IdentityMap.run(callback);
  }

  static on<M extends ModelConstructor>(this: M, connection: string | Connection): Builder<InstanceType<M>> {
    const resolved = typeof connection === "string" ? ConnectionManager.require(connection) : connection;
    const builder = new Builder<InstanceType<M>>(resolved, (this as any).getQualifiedTable(resolved));
    builder.setModel(this);
    (this as any).applyGlobalScopes(builder);
    return builder;
  }

  static forTenant<M extends ModelConstructor>(this: M, tenantId: string): Builder<InstanceType<M>> {
    const context = ConnectionManager.getResolvedTenant(tenantId);
    if (!context) {
      throw new Error(`Tenant "${tenantId}" has not been resolved. Use TenantContext.run() or await ConnectionManager.resolveTenant() first.`);
    }
    return (this as any).on(context.connection);
  }

  static query<M extends ModelConstructor>(this: M): Builder<InstanceType<M>> {
    validateMassAssignmentPolicy(this as any);
    const connection = (this as any).getConnection();
    const builder = new Builder<InstanceType<M>>(connection, (this as any).getQualifiedTable(connection));
    builder.setModel(this);
    (this as any).applyGlobalScopes(builder);
    return builder;
  }

  static addGlobalScope(name: string, scope: GlobalScope): void {
    const scopes = globalScopes.get(this) || new Map<string, GlobalScope>();
    scopes.set(name, scope);
    globalScopes.set(this, scopes);
    globalScopesCache.delete(this);
  }

  static removeGlobalScope(name: string): void {
    globalScopes.get(this)?.delete(name);
    globalScopesCache.delete(this);
  }

  static applyGlobalScopes(builder: Builder<any>): void {
    if (this.softDeletes) {
      builder.whereNull((this as any).getQualifiedDeletedAtColumn(), "and", "softDeletes");
    }
    for (const [name, scope] of getGlobalScopes(this)) {
      scope(builder, this);
      for (const where of builder.wheres) {
        if (!where.scope) where.scope = name;
      }
    }
  }

  static getQualifiedDeletedAtColumn(): string {
    return `${(this as any).getQualifiedTable()}.${this.deletedAtColumn}`;
  }

  // Instance methods
  trashed(): boolean {
    const ctor = Object.getPrototypeOf(this).constructor as typeof ModelCore;
    if (!ctor.softDeletes) return false;
    const v = (this as any).getAttribute(ctor.deletedAtColumn);
    return v != null;
  }

  fill(attributes: ModelMassAssignmentInput<this>): this {
    const constructor = this.getModelConstructor();
    const policy = resolveMassAssignmentPolicy(constructor);
    const entries = Object.entries(attributes);
    const discarded = entries
      .filter(([key]) => !isDangerousMassAssignmentKey(key) && !policyAllows(policy, key))
      .map(([key]) => key);

    if (
      discarded.length > 0 &&
      (isTotallyGuarded(policy) || constructor.preventSilentlyDiscardingAttributes)
    ) {
      throw new MassAssignmentError(constructor.name, discarded);
    }

    for (const [key, value] of entries) {
      if (!isDangerousMassAssignmentKey(key) && policyAllows(policy, key)) {
        this.setAttribute(key as any, value as any);
      }
    }
    return this;
  }

  forceFill(attributes: Partial<T> | ModelAttributeInput<this>): this {
    for (const [key, value] of Object.entries(attributes)) {
      this.setAttribute(key as any, value as any);
    }
    return this;
  }

  setConnection(connection: Connection): this {
    this.$connection = connection;
    return this;
  }

  getConnection(): Connection {
    return this.$connection || (this.getModelConstructor() as typeof ModelCore).getConnection();
  }

  getModelConstructor(): typeof ModelCore {
    return Object.getPrototypeOf(this).constructor as typeof ModelCore;
  }

  isFillable(key: string): boolean {
    if (isDangerousMassAssignmentKey(key)) return false;
    const policy = resolveMassAssignmentPolicy(this.getModelConstructor());
    return policyAllows(policy, key);
  }

  getAttribute<K extends keyof T>(key: K): T[K];
  getAttribute(key: string): any;
  getAttribute(key: string | keyof T): any {
    const target: this = getModelTarget(this);
    return target.getAttributeFromTarget(this, key);
  }

  protected getAttributeFromTarget(receiver: this, key: string | keyof T): any {
    const cast = this.getCastDefinition(key as string);
    const value = (this.$attributes as any)[key];
    const backedEnum = isBackedEnumDefinition(cast);
    if (backedEnum && Object.hasOwn(this.$attributes, key) && value !== null) {
      this.assertBackedEnumValue(key as string, value, cast);
    }
    const accessors = (this.constructor as any).accessors || {};
    if (key in accessors && accessors[key as string].get) {
      return accessors[key as string].get!(value, this.$attributes as any, receiver);
    }
    if (!backedEnum && Object.prototype.hasOwnProperty.call(this.$castCache, key as string)) {
      return this.$castCache[key as string];
    }
    const casted = backedEnum ? value : this.castAttributeFromTarget(receiver, key as string, value);
    if (cast && !backedEnum && value !== null && value !== undefined) {
      this.$castCache[key as string] = casted;
    }
    return casted;
  }

  setAttribute<K extends keyof T>(key: K, value: T[K]): void;
  setAttribute(key: string, value: any): void;
  setAttribute(key: string | keyof T, value: any): void {
    this.validateBackedEnumAttribute(key as string, value);
    const accessors = (Object.getPrototypeOf(this).constructor as any).accessors || {};
    let serialized: any;
    if (key in accessors && accessors[key as string].set) {
      serialized = accessors[key as string].set!(value, this.$attributes as any, this);
      this.validateBackedEnumAttribute(key as string, serialized);
    } else {
      serialized = this.serializeCastAttribute(key as string, value);
    }
    const original = (this.$original as any)[key];
    if (original !== serialized) {
      (this.$dirtyKeys ??= new Set()).add(key as string);
    } else {
      this.$dirtyKeys?.delete(key as string);
    }
    (this.$attributes as any)[key] = serialized;
    delete this.$castCache[key as string];
  }

  castAttribute(key: string, value: any): any {
    const target: this = getModelTarget(this);
    return target.castAttributeFromTarget(this, key, value);
  }

  protected castAttributeFromTarget(receiver: this, key: string, value: any): any {
    const cast = this.getCastDefinition(key);
    if (!cast) return value;
    if (value === null) return value;
    const backedEnum = isBackedEnumDefinition(cast);
    if (backedEnum) {
      if (value === undefined && !Object.hasOwn(this.$attributes, key)) return value;
      this.assertBackedEnumValue(key, value, cast);
      return value;
    }
    if (value === undefined) return value;
    const custom = this.resolveCustomCast(cast);
    if (custom) return custom.get(receiver, key, value, this.$attributes);
    return castBuiltInAttribute(cast, value, {
      modelName: this.constructor.name,
      attribute: key,
    });
  }

  serializeCastAttribute(key: string, value: any): any {
    const cast = this.getCastDefinition(key);
    if (!cast) return value;
    if (value === null) return value;
    if (isBackedEnumDefinition(cast)) {
      this.assertBackedEnumValue(key, value, cast);
      return value;
    }
    if (value === undefined) return value;
    const custom = this.resolveCustomCast(cast);
    if (custom) return custom.set(this, key, value, this.$attributes);
    const [type, argument] = String(cast).split(":");

    switch (type) {
      case "boolean":
      case "bool":
        return value ? 1 : 0;
      case "number":
      case "integer":
      case "int":
      case "float":
      case "double":
        return Number(value);
      case "decimal":
        return formatDecimal(value, Number(argument || 2));
      case "string":
        return String(value);
      case "date": {
        const date = castBuiltInAttribute(cast, value, {
          modelName: this.constructor.name,
          attribute: key,
        }) as Date;
        return Number.isNaN(date.getTime()) ? value : date.toISOString().slice(0, 10);
      }
      case "datetime":
      case "timestamp":
        return value instanceof Date ? value.toISOString() : value;
      case "json":
      case "array":
      case "object":
        return typeof value === "string" ? value : JSON.stringify(value);
      case "base64":
        return Buffer.from(String(value), "utf8").toString("base64");
      default:
        throw new Error(`Unsupported cast "${type}" (${this.constructor.name}.${key}).`);
    }
  }

  mergeCasts(casts: Record<string, CastDefinition>): this {
    this.$casts = { ...this.$casts, ...casts };
    const ctor = this.getModelConstructor();
    this.$mergedCasts = { ...implicitDateCasts(ctor), ...(ctor.casts || {}), ...this.$casts };
    this.$castCache = {};
    return this;
  }

  protected getCastDefinition(key: string): CastDefinition | undefined {
    const cast = this.$mergedCasts[key];
    assertSupportedStringCast(cast, this.constructor.name, key);
    return cast;
  }

  protected resolveCustomCast(cast: CastDefinition): CastsAttributes | null {
    if (typeof cast === "string") return null;
    if (isBackedEnumDefinition(cast)) return null;
    if (typeof cast === "function") return new cast();
    if (typeof cast.get === "function" && typeof cast.set === "function") return cast;
    return null;
  }

  protected validateBackedEnumAttribute(key: string, value: unknown): void {
    const cast = this.getCastDefinition(key);
    if (isBackedEnumDefinition(cast) && value !== null) {
      this.assertBackedEnumValue(key, value, cast);
    }
  }

  protected validateBackedEnumAttributes(
    attributes: Record<string, unknown> = this.$attributes,
  ): void {
    for (const [key, cast] of Object.entries(this.$mergedCasts)) {
      if (!Object.hasOwn(attributes, key)) continue;
      assertSupportedStringCast(cast, this.constructor.name, key);
      const value = attributes[key];
      if (isBackedEnumDefinition(cast) && value !== null) {
        this.assertBackedEnumValue(key, value, cast);
      }
    }
  }

  protected assertBackedEnumValue(
    key: string,
    value: unknown,
    definition: BackedEnumDefinition,
  ): asserts value is string {
    assertEnumValue(definition, value, this.getModelConstructor().name, key);
  }

  /**
   * Attributes in the shape the driver accepts.
   *
   * In memory a temporal cast stays a portable string — full ISO for instants,
   * `YYYY-MM-DD` for calendar dates — so a model can be built with no connection.
   * MySQL rejects ISO-8601 in DATETIME and TIMESTAMP columns, so those values
   * become Date objects here and Connection sends them in the supported form.
   * Calendar-date literals need no time-zone round trip. PostgreSQL, unlike
   * SQLite and MySQL, requires native booleans rather than the cast's portable
   * 1/0 representation. Only explicitly cast columns are touched.
   */
  attributesForDriver(
    connection: Connection,
    attributes: Record<string, any> = this.$attributes as Record<string, any>
  ): Record<string, any> {
    const driver = connection.getDriverName();
    let copy: Record<string, any> | undefined;

    if (driver === "mysql") {
      for (const key of this.dateAttributeKeys()) {
        const value = attributes[key];
        if (value === null || value === undefined) continue;
        if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) continue;
        const date = value instanceof Date ? value : new Date(value);
        if (Number.isNaN(date.getTime())) continue;
        copy = copy ?? { ...attributes };
        copy[key] = date;
      }
    }

    if (driver === "postgres") {
      for (const key of booleanCastKeys(this.$mergedCasts)) {
        const value = attributes[key];
        if (value === null || value === undefined) continue;
        copy = copy ?? { ...attributes };
        copy[key] = Boolean(value);
      }
    }
    return copy ?? attributes;
  }

  /** Columns this model treats as dates: date casts plus the timestamp columns. */
  protected dateAttributeKeys(): string[] {
    const ctor = this.getModelConstructor();
    return [...new Set([...ctor.dateColumns(), ...dateCastKeys(this.$mergedCasts)])];
  }

  getDirty(): Partial<T> {
    const dirty: Partial<T> = {};
    // JSON and temporal casts decode to objects the caller holds by reference,
    // so a mutation lands in the cast cache and never touches $attributes or
    // the $dirtyKeys set. Re-serializing the cached value is what surfaces it.
    const { json: jsonKeys, date: dateKeys } = mutableCastKeys(this.$mergedCasts);
    const keys = new Set(this.$dirtyKeys);
    for (const key of jsonKeys) {
      if (Object.prototype.hasOwnProperty.call(this.$castCache, key)) keys.add(key);
    }
    for (const key of dateKeys) {
      if (Object.prototype.hasOwnProperty.call(this.$castCache, key)) keys.add(key);
    }

    for (const key of keys) {
      const cached = Object.prototype.hasOwnProperty.call(this.$castCache, key);
      if (cached && dateKeys.has(key)) {
        // Compare the decoded Date, not its serialization: drivers may store a
        // date in a different textual form, while both values name one instant.
        if (!sameAttributeValue((this.$original as any)[key], this.$castCache[key])) {
          (dirty as any)[key] = this.serializeCastAttribute(key, this.$castCache[key]);
        }
        continue;
      }
      const value = cached && jsonKeys.has(key)
        ? this.serializeCastAttribute(key, this.$castCache[key])
        : (this.$attributes as any)[key];
      if (!sameAttributeValue((this.$original as any)[key], value)) {
        (dirty as any)[key] = value;
      }
    }
    return dirty;
  }

  isDirty(attributes?: string | readonly string[]): boolean {
    const dirty = this.getDirty();
    if (attributes === undefined) return Object.keys(dirty).length > 0;
    const keys = typeof attributes === "string" ? [attributes] : attributes;
    return keys.some((key) => Object.hasOwn(dirty, key));
  }

  isClean(attributes?: string | readonly string[]): boolean {
    return !this.isDirty(attributes);
  }

  wasChanged(attributes?: string | readonly string[]): boolean {
    if (attributes === undefined) return Object.keys(this.$changes).length > 0;
    const keys = typeof attributes === "string" ? [attributes] : attributes;
    return keys.some((key) => Object.hasOwn(this.$changes, key));
  }

  getChanges(): Partial<T> {
    return { ...this.$changes };
  }

  getOriginal(): Partial<T>;
  getOriginal<K extends keyof T>(key: K): T[K] | undefined;
  getOriginal(key?: string): any {
    if (key !== undefined) return (this.$original as any)[key];
    return { ...this.$original };
  }

  /**
   * Accept the current attributes as the baseline, so nothing reads as dirty
   * until the next write. Nothing is written to the row — this moves what the
   * model considers original, which is what `discardChanges()` rolls back to.
   *
   * A JSON or temporal cast decodes to an object the caller holds by reference,
   * so an in-place edit lands in `$castCache` and never reaches `$attributes`.
   * Copying `$attributes` alone would leave that edit outside the baseline and
   * the key would keep reading dirty forever, so the cached values are folded
   * back in first — exactly what `save()` does with the dirty set before it
   * writes the row.
   *
   * `getDirty()` is what does the folding, rather than a second pass over the
   * cache, because it already owns the rules: it re-serializes cached values and
   * compares dates by instant, so merely reading a cast does not alter the
   * baseline. Models with no mutable cast skip the call entirely.
   *
   * Clearing `$dirtyKeys` is an optimisation, not a correctness requirement:
   * `getDirty()` compares every tracked key against `$original` anyway, so a
   * stale key would compare equal and drop out. Emptying the set just spares
   * that work on the next call.
   */
  syncOriginal(): this {
    const { json, date } = mutableCastKeys(this.$mergedCasts);
    if (json.size > 0 || date.size > 0) Object.assign(this.$attributes, this.getDirty());
    this.markAttributesPersisted();
    return this;
  }

  /** Accept the supplied persisted snapshot while keeping later edits dirty. */
  protected markAttributesPersisted(attributes: Partial<T> = this.$attributes): void {
    this.$original = { ...attributes };
    this.$dirtyKeys?.clear();
    if (attributes === this.$attributes) return;

    for (const key of Object.keys(this.$attributes)) {
      if (!sameAttributeValue((this.$original as any)[key], (this.$attributes as any)[key])) {
        (this.$dirtyKeys ??= new Set()).add(key);
      }
    }
    for (const key of Object.keys(this.$original)) {
      if (!Object.hasOwn(this.$attributes, key)) (this.$dirtyKeys ??= new Set()).add(key);
    }
  }

  /** Accept only attributes that a partial persistence operation wrote. */
  protected syncPersistedOriginal(keys: readonly string[]): void {
    for (const key of keys) {
      if (Object.hasOwn(this.$attributes, key)) {
        (this.$original as any)[key] = (this.$attributes as any)[key];
      } else {
        delete (this.$original as any)[key];
      }
      this.$dirtyKeys?.delete(key);
    }
  }

  /**
   * Roll the in-memory attributes back to the current baseline, discarding
   * every pending change. The row itself is untouched.
   *
   * The baseline is whatever `$original` holds — the last save, unless
   * `syncOriginal()` moved it since.
   *
   * The cast cache goes with them: it holds decoded values keyed off the
   * attributes being thrown away, and a `json`/`date` cast hands out a mutable
   * object that `getDirty()` re-reads, so keeping it would resurrect the very
   * edits this discards.
   */
  discardChanges(): this {
    this.$attributes = { ...this.$original } as T;
    this.$changes = {} as Partial<T>;
    this.$castCache = {};
    this.$dirtyKeys?.clear();
    return this;
  }

  replicate(except?: string[]): this {
    const constructor = this.getModelConstructor();
    const pk = constructor.primaryKey;
    const { createdAt, updatedAt } = constructor.getTimestampColumns();
    const exclude = new Set([pk, createdAt, updatedAt, ...(except || [])]);
    const attrs: Record<string, any> = {};
    for (const [key, value] of Object.entries(this.$attributes)) {
      if (!exclude.has(key)) attrs[key] = value;
    }
    const instance = new (constructor as any)() as this;
    instance.forceFill(attrs as any);
    return instance;
  }

  freshTimestamp(): string {
    return new Date().toISOString();
  }

  setRelation(name: string, value: any): void {
    this.$relations[name] = value;
  }

  getRelation(name: string): any {
    return this.$relations[name];
  }

  is(other: ModelCore | null | undefined): boolean {
    if (!other) return false;
    const ctor = this.getModelConstructor();
    const otherCtor = Object.getPrototypeOf(other).constructor as typeof ModelCore;
    const key = this.getAttribute(ctor.primaryKey);
    const otherKey = other.getAttribute(otherCtor.primaryKey);
    return key !== null && key !== undefined &&
      otherKey !== null && otherKey !== undefined &&
      ctor.getTable() === otherCtor.getTable() &&
      this.getConnection() === other.getConnection() &&
      String(key) === String(otherKey);
  }

  isInstanceOf<M extends ModelConstructor<any>>(modelClass: M): this is InstanceType<M> {
    return (this.getModelConstructor() as unknown) === modelClass;
  }

  isNot(other: ModelCore | null | undefined): boolean {
    return !this.is(other);
  }

  updateTimestamps(): void {
    const constructor = this.getModelConstructor();
    if (!constructor.timestamps) return;
    const { createdAt, updatedAt } = constructor.getTimestampColumns();
    const now = this.freshTimestamp();
    (this.$attributes as any)[updatedAt] = now;
    delete this.$castCache[updatedAt];
    if (!this.$exists) {
      (this.$attributes as any)[createdAt] = now;
      delete this.$castCache[createdAt];
    }
  }
}
