import { snakeCase } from "../utils.js";
import { MorphTo, MorphOne, MorphMany, MorphToMany } from "./MorphRelations.js";
import { BelongsToMany } from "./BelongsToMany.js";
import {
  HasMany,
  BelongsTo,
  HasOne,
  HasManyThrough,
  HasOneThrough,
  loadAggregateResults,
  findRelationMethod,
} from "./ModelBase.js";
import type {
  ModelConstructor,
  EagerLoadConstraint,
  EagerLoadDefinition,
  EagerLoadInput,
  MorphEagerLoadMap,
} from "./ModelBase.js";
import { ModelSerialization } from "./ModelSerialization.js";

export class ModelRelations<T extends Record<string, any> = any> extends ModelSerialization<T> {
  // Static eager loading
  static normalizeEagerLoads(relations: (EagerLoadInput | EagerLoadInput[])[]): EagerLoadDefinition[] {
    const normalized: EagerLoadDefinition[] = [];
    for (const relation of relations.flat()) {
      if (typeof relation === "string") {
        normalized.push({ name: relation });
      } else if ("name" in relation && typeof (relation as EagerLoadDefinition).name === "string") {
        normalized.push(relation as EagerLoadDefinition);
      } else {
        for (const [name, constraint] of Object.entries(relation) as [string, EagerLoadConstraint | undefined][]) {
          normalized.push({ name, constraint });
        }
      }
    }
    return normalized;
  }

  static async eagerLoadRelations(models: ModelRelations[], relations: (string | EagerLoadDefinition)[]): Promise<void> {
    const normalized = (this as any).normalizeEagerLoads(relations as EagerLoadInput[]);
    const groups = new Map<string, EagerLoadDefinition[]>();

    for (const definition of normalized) {
      const [first] = definition.name.split(".");
      const group = groups.get(first) || [];
      group.push(definition);
      groups.set(first, group);
    }

    for (const [relationName, definitions] of groups) {
      const direct = definitions.find((definition) => definition.name === relationName);
      await (this as any).eagerLoadRelation(models, relationName, direct?.constraint);

      const nestedDefinitions = definitions
        .filter((definition) => definition.name.includes("."))
        .map((definition) => ({
          name: definition.name.split(".").slice(1).join("."),
          constraint: definition.constraint,
        }));

      if (nestedDefinitions.length === 0) continue;

      const nestedModels: ModelRelations[] = [];
      for (const model of models) {
        const related = model.getRelation(relationName);
        if (Array.isArray(related)) nestedModels.push(...related);
        else if (related) nestedModels.push(related);
      }
      if (nestedModels.length > 0) {
        await (this as any).eagerLoadRelations(nestedModels, nestedDefinitions);
      }
    }
  }

  static async loadMorph(models: ModelRelations[], relationName: string, relations: MorphEagerLoadMap): Promise<void> {
    if (models.length === 0) return;

    const grouped: Record<string, ModelRelations[]> = {};
    for (const model of models) {
      const related = model.getRelation(relationName);
      if (!related) continue;
      const type = model.getAttribute(`${relationName}_type`) as string;
      if (!type) continue;
      if (!grouped[type]) grouped[type] = [];
      grouped[type].push(related);
    }

    for (const [type, relatedModels] of Object.entries(grouped)) {
      const nested = relations[type];
      if (!nested) continue;
      const normalized = (this as any).normalizeEagerLoads((Array.isArray(nested) ? nested : [nested]) as any);
      await (this as any).eagerLoadRelations(relatedModels, normalized as any);
    }
  }

  static async loadCount(models: ModelRelations[], relationName: string, alias?: string): Promise<void> {
    await loadAggregateResults(
      models as any,
      (query) => query.withCount(relationName, alias),
      [alias || `${relationName}_count`]
    );
  }

  static async loadSum(models: ModelRelations[], relationName: string, column: string, aliasOrCallback?: string | EagerLoadConstraint, callback?: EagerLoadConstraint): Promise<void> {
    const alias = typeof aliasOrCallback === "string" ? aliasOrCallback : undefined;
    await loadAggregateResults(
      models as any,
      (query) => query.withSum(relationName, column, aliasOrCallback as any, callback as any),
      [alias || `${relationName}_sum_${column.replace(/\W+/g, "_")}`]
    );
  }

  static async loadAvg(models: ModelRelations[], relationName: string, column: string, aliasOrCallback?: string | EagerLoadConstraint, callback?: EagerLoadConstraint): Promise<void> {
    const alias = typeof aliasOrCallback === "string" ? aliasOrCallback : undefined;
    await loadAggregateResults(
      models as any,
      (query) => query.withAvg(relationName, column, aliasOrCallback as any, callback as any),
      [alias || `${relationName}_avg_${column.replace(/\W+/g, "_")}`]
    );
  }

  static async loadMin(models: ModelRelations[], relationName: string, column: string, aliasOrCallback?: string | EagerLoadConstraint, callback?: EagerLoadConstraint): Promise<void> {
    const alias = typeof aliasOrCallback === "string" ? aliasOrCallback : undefined;
    await loadAggregateResults(
      models as any,
      (query) => query.withMin(relationName, column, aliasOrCallback as any, callback as any),
      [alias || `${relationName}_min_${column.replace(/\W+/g, "_")}`]
    );
  }

  static async loadMax(models: ModelRelations[], relationName: string, column: string, aliasOrCallback?: string | EagerLoadConstraint, callback?: EagerLoadConstraint): Promise<void> {
    const alias = typeof aliasOrCallback === "string" ? aliasOrCallback : undefined;
    await loadAggregateResults(
      models as any,
      (query) => query.withMax(relationName, column, aliasOrCallback as any, callback as any),
      [alias || `${relationName}_max_${column.replace(/\W+/g, "_")}`]
    );
  }

  static async eagerLoadRelation(models: ModelRelations[], relationName: string, constraint?: EagerLoadConstraint): Promise<void> {
    if (models.length === 0) return;
    const firstModel = models[0];
    const relationMethod = findRelationMethod(firstModel, relationName);
    if (!relationMethod) {
      throw new Error(`Relation ${relationName} is not defined on ${firstModel.constructor.name}.`);
    }
    const relation = relationMethod.call(firstModel) as any;
    if (relation instanceof MorphTo) {
      relation.addEagerConstraints(models as any);
      if (constraint) {
        (constraint as any)(relation);
      }
      const results = await relation.getEager();
      relation.match(models as any, results, relationName);
      return;
    }
    relation.addEagerConstraints(models as any);
    if (constraint) {
      constraint(relation.getQuery());
    }
    const results = await relation.getEager();
    relation.match(models as any, results, relationName);
  }

  // Instance relation factories
  hasMany<R extends ModelRelations, ForeignKey extends string = `${string}_id`>(
    related: ModelConstructor<R>,
    foreignKey?: ForeignKey,
    localKey?: string
  ): HasMany<R, ForeignKey> {
    return new HasMany<R, ForeignKey>(this as any, related as any, foreignKey, localKey);
  }

  belongsTo<R extends ModelRelations>(related: ModelConstructor<R>, foreignKey?: string, ownerKey?: string): BelongsTo<R> {
    return new BelongsTo<R>(this as any, related as any, foreignKey, ownerKey);
  }

  hasOne<R extends ModelRelations>(related: ModelConstructor<R>, foreignKey?: string, localKey?: string): HasOne<R> {
    return new HasOne<R>(this as any, related as any, foreignKey, localKey);
  }

  hasManyThrough<R extends ModelRelations>(
    related: ModelConstructor<R>,
    through: ModelConstructor,
    firstKey?: string,
    secondKey?: string,
    localKey?: string,
    secondLocalKey?: string
  ): HasManyThrough<R> {
    return new HasManyThrough<R>(this as any, related as any, through as any, firstKey, secondKey, localKey, secondLocalKey);
  }

  hasOneThrough<R extends ModelRelations>(
    related: ModelConstructor<R>,
    through: ModelConstructor,
    firstKey?: string,
    secondKey?: string,
    localKey?: string,
    secondLocalKey?: string
  ): HasOneThrough<R> {
    return new HasOneThrough<R>(this as any, related as any, through as any, firstKey, secondKey, localKey, secondLocalKey);
  }

  belongsToMany<R extends ModelRelations>(
    related: ModelConstructor<R>,
    tableOrPivot?: string | ModelConstructor,
    foreignPivotKey?: string,
    relatedPivotKey?: string,
    parentKey?: string,
    relatedKey?: string
  ): BelongsToMany<R> {
    return new BelongsToMany<any>(this as any, related as any, tableOrPivot as any, foreignPivotKey, relatedPivotKey, parentKey, relatedKey) as unknown as BelongsToMany<R>;
  }

  morphTo(name: string, typeMap?: Record<string, ModelConstructor>): MorphTo {
    return new MorphTo(this as any, name, typeMap);
  }

  morphOne<R extends ModelRelations, N extends string>(
    related: ModelConstructor<R>,
    name: N,
    typeColumn?: string,
    idColumn?: string,
    localKey?: string
  ): MorphOne<R, N> {
    return new MorphOne<any>(this as any, related as any, name, typeColumn, idColumn, localKey) as unknown as MorphOne<R, N>;
  }

  morphMany<R extends ModelRelations, N extends string>(
    related: ModelConstructor<R>,
    name: N,
    typeColumn?: string,
    idColumn?: string,
    localKey?: string
  ): MorphMany<R, N> {
    return new MorphMany<any>(this as any, related as any, name, typeColumn, idColumn, localKey) as unknown as MorphMany<R, N>;
  }

  morphToMany<R extends ModelRelations, N extends string>(
    related: ModelConstructor<R>,
    name: N,
    table?: string,
    foreignPivotKey?: string,
    relatedPivotKey?: string,
    parentKey?: string,
    relatedKey?: string
  ): MorphToMany<R, N> {
    const constructor = this.getModelConstructor() as typeof ModelRelations;
    const type = constructor.morphName || constructor.name;
    return new MorphToMany<any>(
      this as any,
      related as any,
      name,
      table,
      foreignPivotKey || `${snakeCase(name)}_id`,
      relatedPivotKey || `${snakeCase(related.name)}_id`,
      parentKey,
      relatedKey,
      type
    ) as unknown as MorphToMany<R, N>;
  }

  morphedByMany<R extends ModelRelations, N extends string>(
    related: ModelConstructor<R>,
    name: N,
    table?: string,
    foreignPivotKey?: string,
    relatedPivotKey?: string,
    parentKey?: string,
    relatedKey?: string
  ): MorphToMany<R, N> {
    const type = (related as any).morphName || related.name;
    const constructor = this.getModelConstructor() as typeof ModelRelations;
    return new MorphToMany<any>(
      this as any,
      related as any,
      name,
      table,
      foreignPivotKey || `${snakeCase(constructor.name)}_id`,
      relatedPivotKey || `${snakeCase(name)}_id`,
      parentKey,
      relatedKey,
      type
    ) as unknown as MorphToMany<R, N>;
  }
}
