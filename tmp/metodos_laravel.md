# Métodos Laravel pendientes

Comparación con la API pública de Laravel 13. Solo incluye aliases, forwarding y helpers pequeños que reutilizan comportamiento ya existente.

## P0

### Builder

- [x] `dumpRawSql`
- [x] `ddRawSql`
- [x] `implode`
- [x] `soleValue`
- [x] `existsOr`
- [x] `doesntExistOr`
- [x] `findSole`
- [x] `findOrNew`
- [x] `orWhereKey`
- [x] `orWhereKeyNot`

### Modelo estático

- [x] `get`
- [x] `forPage`
- [x] `orHas`
- [x] `dump`
- [x] `dd`
- [x] `explain`
- [x] `toSql`
- [x] `toRawSql`

### Relaciones

- [x] `whereDoesntHaveRelation`
- [x] `orWhereDoesntHaveRelation`
- [x] `withWhereRelation`
- [x] `orWhereNotMorphedTo`
- [x] `orWhereBelongsTo`
- [x] `orWhereAttachedTo`

### Pivot

- [x] `orWherePivotNotIn`
- [x] `orWherePivotNotNull`
- [x] `orWherePivotBetween`
- [x] `wherePivotNotBetween`
- [x] `orWherePivotNotBetween`
- [x] `orderByPivot`
- [x] `orderByPivotDesc`

## P1

### Collection: aliases

- `average`
- `doesntContain`
- `pipe`
- `tap`
- `whenEmpty`
- `whenNotEmpty`
- `unlessEmpty`
- `unlessNotEmpty`
- `whereStrict`
- `whereInStrict`

### Collection: helpers

- `firstOrFail`
- `sole`
- `hasSole`
- `hasMany`
- `forPage`
- `percentage`
- `chunk`
- `nth`
- `partition`
- `whereNull`
- `whereNotNull`
- `whereNotIn`
- `whereBetween`
- `whereNotBetween`
- `implode`

### Modelo de instancia

- `relationLoaded`
- `setRelations`
- `unsetRelation`
- `unsetRelations`
- `only`
- `except`
- `qualifyColumn`
- `qualifyColumns`
- `mergeAppends`
- `hasAppended`
- `withoutAppends`

### Schema

- `nullableTimestamps`
- `integerIncrements`
- `smallIncrements`
- `tinyIncrements`
- `ulid`
- `foreignUlid`
- `ulidMorphs`
- `nullableUlidMorphs`

## P2

### Forwarding estático

- `join`
- `leftJoin`
- `rightJoin`
- `crossJoin`
- `union`
- `unionAll`
- `insertGetId`
- `insertOrIgnore`

## Fuera de alcance

No incluir por ahora:

- Consultas JSON overlap/key.
- Lateral joins y subquery joins.
- Consultas vectoriales.
- Tipos timezone o spatial.
- `createOrFirst` e `incrementOrCreate`.
- Duplicados de métodos nativos de `Array`.
- `containsOneItem` y `containsManyItems`, obsoletos en Laravel.

Estos casos necesitan gramática SQL, semántica adicional o introducirían conflictos con JavaScript; no son syntax sugar puro.

## Referencias

- [Laravel Query Builder](https://api.laravel.com/docs/13.x/Illuminate/Database/Query/Builder.html)
- [Laravel Eloquent Builder](https://api.laravel.com/docs/13.x/Illuminate/Database/Eloquent/Builder.html)
- [Laravel Collection](https://api.laravel.com/docs/13.x/Illuminate/Support/Collection.html)
- [Laravel Schema Blueprint](https://api.laravel.com/docs/13.x/Illuminate/Database/Schema/Blueprint.html)
