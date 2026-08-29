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

- [x] `average`
- [x] `doesntContain`
- [x] `pipe`
- [x] `tap`
- [x] `whenEmpty`
- [x] `whenNotEmpty`
- [x] `unlessEmpty`
- [x] `unlessNotEmpty`
- [x] `whereStrict`
- [x] `whereInStrict`

### Collection: helpers

- [x] `firstOrFail`
- [x] `sole`
- [x] `hasSole`
- [x] `hasMany`
- [x] `forPage`
- [x] `percentage`
- [x] `chunk`
- [x] `nth`
- [x] `partition`
- [x] `whereNull`
- [x] `whereNotNull`
- [x] `whereNotIn`
- [x] `whereBetween`
- [x] `whereNotBetween`
- [x] `implode`

### Modelo de instancia

- [x] `relationLoaded`
- [x] `setRelations`
- [x] `unsetRelation`
- [x] `unsetRelations`
- [x] `only`
- [x] `except`
- [x] `qualifyColumn`
- [x] `qualifyColumns`
- [x] `mergeAppends`
- [x] `hasAppended`
- [x] `withoutAppends`

### Schema

- [x] `nullableTimestamps`
- [x] `integerIncrements`
- [x] `smallIncrements`
- [x] `tinyIncrements`
- [x] `ulid`
- [x] `foreignUlid`
- [x] `ulidMorphs`
- [x] `nullableUlidMorphs`

## P2

### Forwarding estático

- [x] `join`
- [x] `leftJoin`
- [x] `rightJoin`
- [x] `crossJoin`
- [x] `union`
- [x] `unionAll`
- [x] `insertGetId`
- [x] `insertOrIgnore`

## Fuera de alcance

No incluir por ahora:

- Consultas JSON overlap/key.
- Lateral joins y subquery joins.
- Consultas vectoriales.
- Tipos timezone o spatial.
- `incrementOrCreate`.
- Duplicados de métodos nativos de `Array`.
- `containsOneItem` y `containsManyItems`, obsoletos en Laravel.

Estos casos necesitan gramática SQL, semántica adicional o introducirían conflictos con JavaScript; no son syntax sugar puro.

## Referencias

- [Laravel Query Builder](https://api.laravel.com/docs/13.x/Illuminate/Database/Query/Builder.html)
- [Laravel Eloquent Builder](https://api.laravel.com/docs/13.x/Illuminate/Database/Eloquent/Builder.html)
- [Laravel Collection](https://api.laravel.com/docs/13.x/Illuminate/Support/Collection.html)
- [Laravel Schema Blueprint](https://api.laravel.com/docs/13.x/Illuminate/Database/Schema/Blueprint.html)
