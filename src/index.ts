export { Connection } from "./connection/Connection.js";
export { UniqueConstraintViolationError } from "./connection/UniqueConstraintViolationError.js";
export { ConnectionManager } from "./connection/ConnectionManager.js";
export type { TenantCachePolicy, TenantResolution, TenantResolver } from "./connection/ConnectionManager.js";
export { TransactionContext } from "./connection/TransactionContext.js";
export { TenantContext } from "./connection/TenantContext.js";
export type { ActiveTenantContext } from "./connection/TenantContext.js";
export { configureOrm } from "./config/OrmConfig.js";
export type { OrmConfig, ConfiguredOrm } from "./config/OrmConfig.js";
export type { ConnectionConfig } from "./types/index.js";

export { Schema } from "./schema/Schema.js";
export { SchemaRawExpression } from "./schema/RawExpression.js";
export type { SchemaColumn, SchemaIndex, SchemaForeignKey } from "./schema/Schema.js";
export { ModelSchemaBuilder } from "./model/ModelSchemaBuilder.js";
export type { IntrospectedSchema } from "./model/ModelSchemaBuilder.js";
export { Blueprint } from "./schema/Blueprint.js";
export { Grammar } from "./schema/grammars/Grammar.js";
export { SQLiteGrammar } from "./schema/grammars/SQLiteGrammar.js";
export { MySqlGrammar } from "./schema/grammars/MySqlGrammar.js";
export { PostgresGrammar } from "./schema/grammars/PostgresGrammar.js";

export { Builder, CursorPaginator, Paginator, SimplePaginator } from "./query/Builder.js";
export type { LikeOptions } from "./query/Builder.js";
export type { CursorPaginatorJson, NumericAggregate, PaginatorJson, SimplePaginatorJson } from "./query/Builder.js";
export { DB } from "./query/DB.js";
export { Collection, collect } from "./support/Collection.js";
export { Cache, RedisCacheStore, MemoryCacheStore } from "./cache/index.js";
export type { CacheConfig, CacheStore, CacheRememberOptions, RedisCacheStoreOptions } from "./cache/index.js";

export { Model, HasMany, BelongsTo, HasOne, HasManyThrough, HasOneThrough } from "./model/Model.js";
export type {
  ModelAttributeInput,
  ModelMassAssignable,
  ModelMassAssignmentAttributes,
  ModelMassAssignmentInput,
  ModelMassAssignmentInputWithout,
  ModelAttributes,
  BulkModelOptions,
  SaveOptions,
  ModelColumn,
  ModelColumnValue,
  ModelJson,
  DirectJson,
  ModelConstructor,
  ModelRelationName,
  BelongsToRelationName,
  ChildRelationName,
  AttachedToRelationName,
  EagerLoadConstraint,
  EagerLoadDefinition,
  EagerLoadInput,
  TypedEagerLoad,
  GlobalScope,
  CastDefinition,
  CastsAttributes,
  AttributeDefinition,
  AccessorMap,
  RelationConstraintQuery,
  PivotQueryBuilder,
} from "./model/Model.js";
export { ModelNotFoundError } from "./model/ModelNotFoundError.js";
export { MassAssignmentError } from "./model/MassAssignmentError.js";
export { backedEnum } from "./model/BackedEnum.js";
export type { BackedEnumDefinition, EnumValue } from "./model/BackedEnum.js";
export { InvalidEnumValueError } from "./model/InvalidEnumValueError.js";
export { Observer, ObserverRegistry, type ObserverContract } from "./model/Observer.js";
export { MorphMap } from "./model/MorphMap.js";
export { MorphTo, MorphOne, MorphMany, MorphToMany } from "./model/MorphRelations.js";
export { BelongsToMany } from "./model/BelongsToMany.js";
export { IdentityMap } from "./model/IdentityMap.js";
export {
  registerPolicy,
  registerPolicies,
  clearPolicies,
  inspect as inspectPolicy,
  can,
  authorize,
  attachPolicyMethods,
  PolicyAuthorizationError,
} from "./policies/index.js";
export type { PolicyDecision, PolicyMethod, PolicyLike, PolicyClass, PolicyUserMethods } from "./policies/index.js";

export { Migration } from "./migration/Migration.js";
export { Migrator } from "./migration/Migrator.js";
export type { MigrationEvent, MigrationEventListener, MigrationEventPayload, MigrationStatusRow, MigratorOptions } from "./migration/Migrator.js";
export { MigrationCreator } from "./migration/MigrationCreator.js";
export { TypeGenerator } from "./typegen/TypeGenerator.js";
export { TypeMapper } from "./typegen/TypeMapper.js";
export { discoverModelTables, discoverModelDeclarations } from "./typegen/discoverModelTables.js";
export type { ModelDeclarationInfo } from "./typegen/discoverModelTables.js";

export { Seeder, SeederRunner } from "./seeding/Seeder.js";
export { Factory, Sequence } from "./seeding/Factory.js";
export type {
  FactoryAttributes,
  FactoryInsertOptions,
  FactoryState,
  FactoryStateValue,
  AfterHook,
} from "./seeding/Factory.js";

// Validation lives at the `@rekkr/orm/validation` subpath import only —
// keeping it out of the main entry trims the surface and makes the dependency
// boundary explicit.
