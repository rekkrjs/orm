# CPU Profile

| Duration | Samples | Interval | Functions |
|----------|---------|----------|----------|
| 1.09s | 808 | 1.0ms | 177 |

**Top 10:** `all` 23.0%, `assertSupportedStringCast` 11.2%, `stringify` 7.7%, `Date` 6.5%, `serialize` 5.4%, `toISOString` 3.7%, `hydrateModelRow` 3.0%, `assertSupportedStringCast` 2.4%, `cloneObject` 2.4%, `hydrateModelRow` 2.3%

## Hot Functions (Self Time)

| Self% | Self | Total% | Total | Function | Location |
|------:|-----:|-------:|------:|----------|----------|
| 23.0% | 251.6ms | 23.0% | 251.6ms | `all` | `[native code]` |
| 11.2% | 122.5ms | 11.2% | 122.5ms | `assertSupportedStringCast` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:209` |
| 7.7% | 84.3ms | 13.4% | 147.0ms | `stringify` | `[native code]` |
| 6.5% | 71.3ms | 6.5% | 71.3ms | `Date` | `[native code]` |
| 5.4% | 59.2ms | 5.7% | 63.2ms | `serialize` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelSerialization.ts:154` |
| 3.7% | 40.9ms | 3.7% | 40.9ms | `toISOString` | `[native code]` |
| 3.0% | 33.4ms | 3.0% | 33.4ms | `hydrateModelRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelPersistence.ts:57` |
| 2.4% | 27.2ms | 2.4% | 27.2ms | `assertSupportedStringCast` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:210` |
| 2.4% | 27.2ms | 2.4% | 27.2ms | `cloneObject` | `[native code]` |
| 2.3% | 25.5ms | 3.8% | 41.5ms | `hydrateModelRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelPersistence.ts:56` |
| 2.1% | 23.8ms | 2.1% | 23.8ms | `parse` | `[native code]` |
| 1.7% | 19.6ms | 1.7% | 19.6ms | `asyncWrap` | `node:fs/promises:249` |
| 1.5% | 17.1ms | 1.5% | 17.1ms | `(anonymous)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:1` |
| 1.4% | 15.8ms | 1.4% | 15.8ms | `copyDataProperties` | `[native code]` |
| 1.3% | 14.5ms | 1.3% | 14.5ms | `normalizeHydratedCastValue` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:181` |
| 1.2% | 14.1ms | 5.7% | 62.6ms | `toJSON` | `[native code]` |
| 1.2% | 14.0ms | 24.9% | 272.2ms | `serialize` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelSerialization.ts:166` |
| 1.2% | 13.9ms | 1.2% | 13.9ms | `(module)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/query/grammars/SQLiteGrammar.ts:4` |
| 1.0% | 11.7ms | 5.2% | 57.5ms | `serializeRawJsonRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:309` |
| 1.0% | 11.4ms | 3.3% | 36.7ms | `anonymous` | `[native code]` |
| 0.9% | 10.1ms | 6.8% | 74.7ms | `ModelAggregates` | `[native code]` |
| 0.8% | 9.2ms | 0.8% | 9.2ms | `getModelTarget` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelBase.ts:579` |
| 0.8% | 8.8ms | 14.4% | 157.4ms | `getAttributeFromTarget` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:503` |
| 0.7% | 8.0ms | 0.7% | 8.0ms | `ModelCore` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts` |
| 0.7% | 7.8ms | 5.9% | 64.6ms | `ModelQuerying` | `[native code]` |
| 0.7% | 7.7ms | 7.5% | 82.5ms | `Model` | `[native code]` |
| 0.6% | 7.6ms | 0.6% | 7.6ms | `[Symbol.toPrimitive]` | `[native code]` |
| 0.6% | 7.4ms | 0.6% | 7.4ms | `compileCast` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:218` |
| 0.6% | 7.0ms | 0.6% | 7.0ms | `run` | `[native code]` |
| 0.5% | 6.5ms | 0.5% | 6.5ms | `prepare` | `[native code]` |
| 0.5% | 6.0ms | 7.0% | 77.4ms | `castCompiledAttribute` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:278` |
| 0.5% | 6.0ms | 1.5% | 17.4ms | `compileCast` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:220` |
| 0.5% | 5.7ms | 3.1% | 34.3ms | `castAttributeFromTarget` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:552` |
| 0.4% | 5.1ms | 0.4% | 5.1ms | `hydrateModelRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelPersistence.ts:48` |
| 0.4% | 5.1ms | 8.0% | 87.6ms | `PipelinePost` | `[native code]` |
| 0.3% | 4.0ms | 0.3% | 4.0ms | `push` | `[native code]` |
| 0.3% | 4.0ms | 0.3% | 4.0ms | `Set` | `[native code]` |
| 0.3% | 4.0ms | 0.3% | 4.0ms | `Array` | `[native code]` |
| 0.3% | 3.5ms | 0.7% | 8.1ms | `hydrateModelRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelPersistence.ts:70` |
| 0.2% | 2.9ms | 0.2% | 2.9ms | `parseOptions` | `internal:sql/shared` |
| 0.2% | 2.7ms | 0.2% | 2.7ms | `hydrateModelRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelPersistence.ts:72` |
| 0.2% | 2.6ms | 0.2% | 2.6ms | `Proxy` | `[native code]` |
| 0.2% | 2.5ms | 31.3% | 342.2ms | `toJSON` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/support/Collection.ts:210` |
| 0.2% | 2.5ms | 2.2% | 24.9ms | `ModelCore` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:206` |
| 0.2% | 2.5ms | 0.2% | 2.5ms | `getCastDefinition` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:615` |
| 0.2% | 2.4ms | 0.2% | 2.4ms | `compileCast` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:227` |
| 0.2% | 2.4ms | 1.0% | 11.3ms | `Array` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/support/Collection.ts:190` |
| 0.2% | 2.4ms | 0.2% | 2.4ms | `(anonymous)` | `internal:sql/shared:1` |
| 0.2% | 2.4ms | 0.2% | 2.4ms | `getAttributeFromTarget` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:497` |
| 0.2% | 2.4ms | 0.2% | 2.4ms | `arrayIteratorNextHelper` | `[native code]` |
| 0.2% | 2.2ms | 6.3% | 69.3ms | `from` | `[native code]` |
| 0.1% | 1.5ms | 0.1% | 1.5ms | `Query` | `internal:sql/query:43` |
| 0.1% | 1.5ms | 0.1% | 1.5ms | `serialize` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelSerialization.ts:178` |
| 0.1% | 1.4ms | 0.1% | 1.4ms | `open` | `[native code]` |
| 0.1% | 1.4ms | 1.6% | 18.5ms | `ModelCore` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:199` |
| 0.1% | 1.4ms | 0.1% | 1.4ms | `normalizeHydratedCastValue` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts` |
| 0.1% | 1.4ms | 0.1% | 1.4ms | `hideFromStack` | `internal:shared` |
| 0.1% | 1.4ms | 0.1% | 1.4ms | `Boolean` | `[native code]` |
| 0.1% | 1.3ms | 0.1% | 1.3ms | `async get` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/query/Builder.ts:2165` |
| 0.1% | 1.3ms | 0.1% | 1.3ms | `SQLiteQueryHandle` | `internal:sql/sqlite` |
| 0.1% | 1.3ms | 0.1% | 1.3ms | `ModelCore` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:208` |
| 0.1% | 1.3ms | 5.2% | 56.8ms | `ModelPersistence` | `[native code]` |
| 0.1% | 1.3ms | 0.1% | 1.3ms | `compileCast` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:216` |
| 0.1% | 1.2ms | 0.1% | 1.2ms | `keys` | `[native code]` |
| 0.1% | 1.2ms | 0.1% | 1.2ms | `compileCast` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts` |
| 0.1% | 1.2ms | 0.4% | 4.8ms | `serializeRawJsonRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:303` |
| 0.1% | 1.2ms | 0.1% | 1.2ms | `clone` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/query/Builder.ts:1809` |
| 0.1% | 1.2ms | 0.1% | 1.2ms | `isSafeIdentifier` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts` |
| 0.1% | 1.2ms | 0.1% | 1.2ms | `castCompiledAttribute` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:232` |
| 0.1% | 1.2ms | 0.1% | 1.2ms | `arrayFromFastWithoutMapFn` | `[native code]` |
| 0.1% | 1.2ms | 0.1% | 1.2ms | `getAttributeFromTarget` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:505` |
| 0.1% | 1.1ms | 0.2% | 2.7ms | `async use` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:195` |
| 0.1% | 1.1ms | 0.1% | 1.1ms | `async get` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/query/Builder.ts:2163` |
| 0.1% | 1.1ms | 0.1% | 1.1ms | `serializeRawJsonRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:311` |
| 0.1% | 1.1ms | 0.2% | 2.6ms | `Database` | `bun:sqlite:262` |
| 0.1% | 1.1ms | 0.1% | 1.1ms | `get` | `[native code]` |
| 0.1% | 1.1ms | 0.1% | 1.1ms | `(anonymous)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:68` |
| 0.0% | 1.0ms | 0.0% | 1.0ms | `assign` | `[native code]` |
| 0.0% | 1.0ms | 0.0% | 1.0ms | `toJSON` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/support/Collection.ts:208` |
| 0.0% | 1.0ms | 0.0% | 1.0ms | `getAttributeFromTarget` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:491` |
| 0.0% | 1.0ms | 0.0% | 1.0ms | `hydrateModelRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelPersistence.ts:50` |

## Call Tree (Total Time)

| Total% | Total | Self% | Self | Function | Location |
|-------:|------:|------:|-----:|----------|----------|
| 31.3% | 342.2ms | 0.2% | 2.5ms | `toJSON` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/support/Collection.ts:210` |
| 24.9% | 272.2ms | 1.2% | 14.0ms | `serialize` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelSerialization.ts:166` |
| 24.6% | 269.1ms | 0.0% | 0us | `onQueryConnected` | `bun:sql:37` |
| 24.6% | 269.1ms | 0.0% | 0us | `queryFromPoolHandler` | `bun:sql:49` |
| 24.6% | 269.1ms | 0.0% | 0us | `connect` | `internal:sql/sqlite:290` |
| 24.6% | 269.1ms | 0.0% | 0us | `async #runAsync` | `internal:sql/query:80` |
| 24.6% | 269.1ms | 0.0% | 0us | `bound onQueryConnected` | `[native code]` |
| 23.0% | 251.6ms | 23.0% | 251.6ms | `all` | `[native code]` |
| 23.0% | 251.6ms | 0.0% | 0us | `run` | `internal:sql/sqlite:165` |
| 17.7% | 194.0ms | 0.0% | 0us | `map` | `[native code]` |
| 17.6% | 192.8ms | 0.0% | 0us | `async get` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/query/Builder.ts:2198` |
| 17.4% | 190.2ms | 0.0% | 0us | `(anonymous)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/query/Builder.ts:2216` |
| 15.9% | 173.8ms | 0.0% | 0us | `async measure` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:37` |
| 14.4% | 157.4ms | 0.8% | 8.8ms | `getAttributeFromTarget` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:503` |
| 13.7% | 149.8ms | 0.0% | 0us | `getCastDefinition` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:616` |
| 13.4% | 147.0ms | 7.7% | 84.3ms | `stringify` | `[native code]` |
| 11.2% | 122.5ms | 11.2% | 122.5ms | `assertSupportedStringCast` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:209` |
| 8.7% | 96.1ms | 0.0% | 0us | `getAttributeFromTarget` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:490` |
| 8.0% | 87.6ms | 0.4% | 5.1ms | `PipelinePost` | `[native code]` |
| 8.0% | 87.6ms | 0.0% | 0us | `hydrateModelRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelPersistence.ts:44` |
| 7.5% | 82.5ms | 0.7% | 7.7ms | `Model` | `[native code]` |
| 7.0% | 77.4ms | 0.5% | 6.0ms | `castCompiledAttribute` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:278` |
| 6.8% | 74.7ms | 0.9% | 10.1ms | `ModelAggregates` | `[native code]` |
| 6.5% | 71.3ms | 6.5% | 71.3ms | `Date` | `[native code]` |
| 6.3% | 69.3ms | 0.2% | 2.2ms | `from` | `[native code]` |
| 6.1% | 67.6ms | 0.0% | 0us | `async measure` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:32` |
| 5.9% | 64.6ms | 0.7% | 7.8ms | `ModelQuerying` | `[native code]` |
| 5.7% | 63.2ms | 5.4% | 59.2ms | `serialize` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelSerialization.ts:154` |
| 5.7% | 62.6ms | 1.2% | 14.1ms | `toJSON` | `[native code]` |
| 5.2% | 57.5ms | 1.0% | 11.7ms | `serializeRawJsonRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:309` |
| 5.2% | 56.8ms | 0.0% | 0us | `ModelSerialization` | `[native code]` |
| 5.2% | 56.8ms | 0.1% | 1.3ms | `ModelPersistence` | `[native code]` |
| 5.2% | 56.8ms | 0.0% | 0us | `ModelRelations` | `[native code]` |
| 5.1% | 56.1ms | 0.0% | 0us | `castAttributeFromTarget` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:540` |
| 3.8% | 41.5ms | 2.3% | 25.5ms | `hydrateModelRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelPersistence.ts:56` |
| 3.7% | 40.9ms | 3.7% | 40.9ms | `toISOString` | `[native code]` |
| 3.3% | 36.7ms | 1.0% | 11.4ms | `anonymous` | `[native code]` |
| 3.1% | 34.3ms | 0.5% | 5.7ms | `castAttributeFromTarget` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:552` |
| 3.0% | 33.4ms | 3.0% | 33.4ms | `hydrateModelRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelPersistence.ts:57` |
| 2.7% | 29.9ms | 0.0% | 0us | `castBuiltInAttribute` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:295` |
| 2.5% | 27.7ms | 0.0% | 0us | `async measure` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:29` |
| 2.4% | 27.2ms | 2.4% | 27.2ms | `assertSupportedStringCast` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:210` |
| 2.4% | 27.2ms | 2.4% | 27.2ms | `cloneObject` | `[native code]` |
| 2.2% | 24.9ms | 0.2% | 2.5ms | `ModelCore` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:206` |
| 2.1% | 23.8ms | 2.1% | 23.8ms | `parse` | `[native code]` |
| 2.0% | 22.6ms | 0.0% | 0us | `async countTraps` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:60` |
| 2.0% | 22.6ms | 0.0% | 0us | `async (anonymous)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:154` |
| 2.0% | 22.6ms | 0.0% | 0us | `async countTraps` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:45` |
| 1.7% | 19.6ms | 0.0% | 0us | `node:fs/promises` | `node:fs/promises:137` |
| 1.7% | 19.6ms | 1.7% | 19.6ms | `asyncWrap` | `node:fs/promises:249` |
| 1.6% | 18.5ms | 0.1% | 1.4ms | `ModelCore` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:199` |
| 1.5% | 17.4ms | 0.5% | 6.0ms | `compileCast` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:220` |
| 1.5% | 17.1ms | 1.5% | 17.1ms | `(anonymous)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:1` |
| 1.4% | 15.8ms | 1.4% | 15.8ms | `copyDataProperties` | `[native code]` |
| 1.3% | 15.2ms | 0.0% | 0us | `async (anonymous)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:135` |
| 1.3% | 14.5ms | 1.3% | 14.5ms | `normalizeHydratedCastValue` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:181` |
| 1.2% | 13.9ms | 1.2% | 13.9ms | `(module)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/query/grammars/SQLiteGrammar.ts:4` |
| 1.1% | 12.5ms | 0.0% | 0us | `async (anonymous)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:138` |
| 1.0% | 11.3ms | 0.2% | 2.4ms | `Array` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/support/Collection.ts:190` |
| 0.8% | 9.2ms | 0.8% | 9.2ms | `getModelTarget` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelBase.ts:579` |
| 0.8% | 9.2ms | 0.0% | 0us | `hydrateModelRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelPersistence.ts:45` |
| 0.7% | 8.1ms | 0.3% | 3.5ms | `hydrateModelRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelPersistence.ts:70` |
| 0.7% | 8.0ms | 0.7% | 8.0ms | `ModelCore` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts` |
| 0.6% | 7.6ms | 0.6% | 7.6ms | `[Symbol.toPrimitive]` | `[native code]` |
| 0.6% | 7.4ms | 0.6% | 7.4ms | `compileCast` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:218` |
| 0.6% | 7.0ms | 0.0% | 0us | `run` | `internal:sql/sqlite:172` |
| 0.6% | 7.0ms | 0.0% | 0us | `run` | `bun:sqlite:323` |
| 0.6% | 7.0ms | 0.6% | 7.0ms | `run` | `[native code]` |
| 0.6% | 6.8ms | 0.0% | 0us | `Connection` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:144` |
| 0.6% | 6.8ms | 0.0% | 0us | `(anonymous)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:120` |
| 0.6% | 6.8ms | 0.0% | 0us | `SQL2` | `bun:sql:20` |
| 0.6% | 6.8ms | 0.0% | 0us | `(module)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:73` |
| 0.6% | 6.8ms | 0.0% | 0us | `(anonymous)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:74` |
| 0.5% | 6.5ms | 0.0% | 0us | `prepare` | `bun:sqlite:327` |
| 0.5% | 6.5ms | 0.0% | 0us | `run` | `internal:sql/sqlite:158` |
| 0.5% | 6.5ms | 0.5% | 6.5ms | `prepare` | `[native code]` |
| 0.5% | 6.2ms | 0.0% | 0us | `async get` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/query/Builder.ts:2242` |
| 0.5% | 5.8ms | 0.0% | 0us | `node:assert/strict` | `node:assert/strict:3` |
| 0.5% | 5.7ms | 0.0% | 0us | `internal:streams/duplex` | `internal:streams/duplex:2` |
| 0.5% | 5.7ms | 0.0% | 0us | `internal:streams/lazy_transform` | `internal:streams/lazy_transform:2` |
| 0.5% | 5.7ms | 0.0% | 0us | `internal:streams/transform` | `internal:streams/transform:2` |
| 0.5% | 5.7ms | 0.0% | 0us | `node:crypto` | `node:crypto:2` |
| 0.4% | 5.1ms | 0.4% | 5.1ms | `hydrateModelRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelPersistence.ts:48` |
| 0.4% | 5.0ms | 0.0% | 0us | `async get` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/query/Builder.ts:2239` |
| 0.4% | 4.8ms | 0.1% | 1.2ms | `serializeRawJsonRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:303` |
| 0.3% | 4.0ms | 0.3% | 4.0ms | `push` | `[native code]` |
| 0.3% | 4.0ms | 0.3% | 4.0ms | `Set` | `[native code]` |
| 0.3% | 4.0ms | 0.3% | 4.0ms | `Array` | `[native code]` |
| 0.3% | 3.8ms | 0.0% | 0us | `SQLResultArray` | `internal:sql/shared:29` |
| 0.3% | 3.8ms | 0.0% | 0us | `run` | `internal:sql/sqlite:169` |
| 0.3% | 3.7ms | 0.0% | 0us | `async (anonymous)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:127` |
| 0.2% | 2.9ms | 0.2% | 2.9ms | `parseOptions` | `internal:sql/shared` |
| 0.2% | 2.8ms | 0.0% | 0us | `(module)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:158` |
| 0.2% | 2.7ms | 0.1% | 1.1ms | `async use` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:195` |
| 0.2% | 2.7ms | 0.0% | 0us | `async (anonymous)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:136` |
| 0.2% | 2.7ms | 0.2% | 2.7ms | `hydrateModelRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelPersistence.ts:72` |
| 0.2% | 2.6ms | 0.1% | 1.1ms | `Database` | `bun:sqlite:262` |
| 0.2% | 2.6ms | 0.0% | 0us | `adapterFromOptions` | `bun:sql:14` |
| 0.2% | 2.6ms | 0.0% | 0us | `SQLiteAdapter` | `internal:sql/sqlite:207` |
| 0.2% | 2.6ms | 0.0% | 0us | `ModelCore` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:214` |
| 0.2% | 2.6ms | 0.2% | 2.6ms | `Proxy` | `[native code]` |
| 0.2% | 2.5ms | 0.0% | 0us | `async get` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/query/Builder.ts:2162` |
| 0.2% | 2.5ms | 0.2% | 2.5ms | `getCastDefinition` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:615` |
| 0.2% | 2.4ms | 0.2% | 2.4ms | `compileCast` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:227` |
| 0.2% | 2.4ms | 0.2% | 2.4ms | `(anonymous)` | `internal:sql/shared:1` |
| 0.2% | 2.4ms | 0.2% | 2.4ms | `getAttributeFromTarget` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:497` |
| 0.2% | 2.4ms | 0.2% | 2.4ms | `arrayIteratorNextHelper` | `[native code]` |
| 0.2% | 2.4ms | 0.0% | 0us | `next` | `[native code]` |
| 0.1% | 1.5ms | 0.0% | 0us | `async use` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:199` |
| 0.1% | 1.5ms | 0.1% | 1.5ms | `Query` | `internal:sql/query:43` |
| 0.1% | 1.5ms | 0.0% | 0us | `async execute` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:544` |
| 0.1% | 1.5ms | 0.0% | 0us | `run` | `node:async_hooks:150` |
| 0.1% | 1.5ms | 0.0% | 0us | `async applySqliteDefaults` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:612` |
| 0.1% | 1.5ms | 0.0% | 0us | `async (anonymous)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:82` |
| 0.1% | 1.5ms | 0.0% | 0us | `unsafeQuery` | `bun:sql:63` |
| 0.1% | 1.5ms | 0.0% | 0us | `async run` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:503` |
| 0.1% | 1.5ms | 0.0% | 0us | `async ensureSqliteDefaults` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:607` |
| 0.1% | 1.5ms | 0.0% | 0us | `async ensureSqliteDefaults` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:604` |
| 0.1% | 1.5ms | 0.0% | 0us | `async run` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:501` |
| 0.1% | 1.5ms | 0.0% | 0us | `async execute` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:540` |
| 0.1% | 1.5ms | 0.0% | 0us | `async (anonymous)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:84` |
| 0.1% | 1.5ms | 0.0% | 0us | `async applySqliteDefaults` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:630` |
| 0.1% | 1.5ms | 0.1% | 1.5ms | `serialize` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelSerialization.ts:178` |
| 0.1% | 1.4ms | 0.1% | 1.4ms | `open` | `[native code]` |
| 0.1% | 1.4ms | 0.1% | 1.4ms | `normalizeHydratedCastValue` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts` |
| 0.1% | 1.4ms | 0.0% | 0us | `internal:validators` | `internal:validators:67` |
| 0.1% | 1.4ms | 0.0% | 0us | `node:assert` | `node:assert:2` |
| 0.1% | 1.4ms | 0.1% | 1.4ms | `hideFromStack` | `internal:shared` |
| 0.1% | 1.4ms | 0.1% | 1.4ms | `Boolean` | `[native code]` |
| 0.1% | 1.4ms | 0.0% | 0us | `serialize` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelSerialization.ts:165` |
| 0.1% | 1.3ms | 0.1% | 1.3ms | `async get` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/query/Builder.ts:2165` |
| 0.1% | 1.3ms | 0.0% | 0us | `then` | `internal:sql/query:155` |
| 0.1% | 1.3ms | 0.0% | 0us | `async #runAsync` | `internal:sql/query:66` |
| 0.1% | 1.3ms | 0.0% | 0us | `#runAsyncAndCatch` | `internal:sql/query:150` |
| 0.1% | 1.3ms | 0.1% | 1.3ms | `SQLiteQueryHandle` | `internal:sql/sqlite` |
| 0.1% | 1.3ms | 0.0% | 0us | `async #runAsync` | `internal:sql/query:75` |
| 0.1% | 1.3ms | 0.0% | 0us | `#getQueryHandle` | `internal:sql/query:31` |
| 0.1% | 1.3ms | 0.0% | 0us | `createQueryHandle` | `internal:sql/sqlite:228` |
| 0.1% | 1.3ms | 0.1% | 1.3ms | `ModelCore` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:208` |
| 0.1% | 1.3ms | 0.0% | 0us | `(module)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:1` |
| 0.1% | 1.3ms | 0.0% | 0us | `bun:sql` | `bun:sql:2` |
| 0.1% | 1.3ms | 0.0% | 0us | `internal:sql/postgres` | `internal:sql/postgres:10` |
| 0.1% | 1.3ms | 0.0% | 0us | `internal:errors` | `internal:errors:2` |
| 0.1% | 1.3ms | 0.0% | 0us | `internal:streams/destroy` | `internal:streams/destroy:2` |
| 0.1% | 1.3ms | 0.0% | 0us | `internal:streams/readable` | `internal:streams/readable:2` |
| 0.1% | 1.3ms | 0.1% | 1.3ms | `compileCast` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:216` |
| 0.1% | 1.2ms | 0.1% | 1.2ms | `keys` | `[native code]` |
| 0.1% | 1.2ms | 0.0% | 0us | `hydrateModelRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelPersistence.ts:68` |
| 0.1% | 1.2ms | 0.1% | 1.2ms | `compileCast` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts` |
| 0.1% | 1.2ms | 0.0% | 0us | `async rawJson` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/query/Builder.ts:2441` |
| 0.1% | 1.2ms | 0.1% | 1.2ms | `clone` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/query/Builder.ts:1809` |
| 0.1% | 1.2ms | 0.0% | 0us | `async rawJson` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/query/Builder.ts:2431` |
| 0.1% | 1.2ms | 0.0% | 0us | `query` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:380` |
| 0.1% | 1.2ms | 0.0% | 0us | `async (anonymous)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:126` |
| 0.1% | 1.2ms | 0.0% | 0us | `assertSafeIdentifier` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:268` |
| 0.1% | 1.2ms | 0.0% | 0us | `qualifyTable` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:348` |
| 0.1% | 1.2ms | 0.1% | 1.2ms | `isSafeIdentifier` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts` |
| 0.1% | 1.2ms | 0.0% | 0us | `modelQuery` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:76` |
| 0.1% | 1.2ms | 0.0% | 0us | `parseSQLiteOptions` | `internal:sql/shared:837` |
| 0.1% | 1.2ms | 0.1% | 1.2ms | `castCompiledAttribute` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:232` |
| 0.1% | 1.2ms | 0.1% | 1.2ms | `arrayFromFastWithoutMapFn` | `[native code]` |
| 0.1% | 1.2ms | 0.1% | 1.2ms | `getAttributeFromTarget` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:505` |
| 0.1% | 1.1ms | 0.0% | 0us | `async query` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:496` |
| 0.1% | 1.1ms | 0.0% | 0us | `async query` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:498` |
| 0.1% | 1.1ms | 0.0% | 0us | `async get` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/query/Builder.ts:2178` |
| 0.1% | 1.1ms | 0.1% | 1.1ms | `async get` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/query/Builder.ts:2163` |
| 0.1% | 1.1ms | 0.1% | 1.1ms | `serializeRawJsonRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:311` |
| 0.1% | 1.1ms | 0.0% | 0us | `performProxyObjectGet` | `[native code]` |
| 0.1% | 1.1ms | 0.1% | 1.1ms | `get` | `[native code]` |
| 0.1% | 1.1ms | 0.0% | 0us | `get` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelBase.ts:593` |
| 0.1% | 1.1ms | 0.1% | 1.1ms | `(anonymous)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:68` |
| 0.1% | 1.1ms | 0.0% | 0us | `async countTraps` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:68` |
| 0.0% | 1.0ms | 0.0% | 0us | `node:crypto` | `node:crypto:130` |
| 0.0% | 1.0ms | 0.0% | 1.0ms | `assign` | `[native code]` |
| 0.0% | 1.0ms | 0.0% | 1.0ms | `toJSON` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/support/Collection.ts:208` |
| 0.0% | 1.0ms | 0.0% | 1.0ms | `getAttributeFromTarget` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:491` |
| 0.0% | 1.0ms | 0.0% | 1.0ms | `hydrateModelRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelPersistence.ts:50` |

## Function Details

### `all`
`[native code]` | Self: 23.0% (251.6ms) | Total: 23.0% (251.6ms) | Samples: 186

**Called by:**
- `run` (186)

### `assertSupportedStringCast`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:209` | Self: 11.2% (122.5ms) | Total: 11.2% (122.5ms) | Samples: 94

**Called by:**
- `getCastDefinition` (94)

### `stringify`
`[native code]` | Self: 7.7% (84.3ms) | Total: 13.4% (147.0ms) | Samples: 61

**Called by:**
- `async measure` (81)
- `async measure` (30)

**Calls:**
- `toJSON` (50)

### `Date`
`[native code]` | Self: 6.5% (71.3ms) | Total: 6.5% (71.3ms) | Samples: 56

**Called by:**
- `castCompiledAttribute` (56)

### `serialize`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelSerialization.ts:154` | Self: 5.4% (59.2ms) | Total: 5.7% (63.2ms) | Samples: 46

**Called by:**
- `toJSON` (49)

**Calls:**
- `Set` (3)

### `toISOString`
`[native code]` | Self: 3.7% (40.9ms) | Total: 3.7% (40.9ms) | Samples: 32

**Called by:**
- `toJSON` (32)

### `hydrateModelRow`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelPersistence.ts:57` | Self: 3.0% (33.4ms) | Total: 3.0% (33.4ms) | Samples: 26

**Called by:**
- `(anonymous)` (26)

### `assertSupportedStringCast`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:210` | Self: 2.4% (27.2ms) | Total: 2.4% (27.2ms) | Samples: 21

**Called by:**
- `getCastDefinition` (21)

### `cloneObject`
`[native code]` | Self: 2.4% (27.2ms) | Total: 2.4% (27.2ms) | Samples: 22

**Called by:**
- `compileCast` (9)
- `ModelCore` (5)
- `hydrateModelRow` (4)
- `serializeRawJsonRow` (3)
- `parseSQLiteOptions` (1)

### `hydrateModelRow`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelPersistence.ts:56` | Self: 2.3% (25.5ms) | Total: 3.8% (41.5ms) | Samples: 20

**Called by:**
- `(anonymous)` (32)

**Calls:**
- `normalizeHydratedCastValue` (11)
- `normalizeHydratedCastValue` (1)

### `parse`
`[native code]` | Self: 2.1% (23.8ms) | Total: 2.1% (23.8ms) | Samples: 19

**Called by:**
- `serializeRawJsonRow` (13)
- `getAttributeFromTarget` (6)

### `asyncWrap`
`node:fs/promises:249` | Self: 1.7% (19.6ms) | Total: 1.7% (19.6ms) | Samples: 1

**Called by:**
- `node:fs/promises` (1)

### `(anonymous)`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:1` | Self: 1.5% (17.1ms) | Total: 1.5% (17.1ms) | Samples: 13

**Called by:**
- `ModelCore` (13)

### `copyDataProperties`
`[native code]` | Self: 1.4% (15.8ms) | Total: 1.4% (15.8ms) | Samples: 13

**Called by:**
- `ModelCore` (13)

### `normalizeHydratedCastValue`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:181` | Self: 1.3% (14.5ms) | Total: 1.3% (14.5ms) | Samples: 11

**Called by:**
- `hydrateModelRow` (11)

### `toJSON`
`[native code]` | Self: 1.2% (14.1ms) | Total: 5.7% (62.6ms) | Samples: 12

**Called by:**
- `stringify` (50)

**Calls:**
- `toISOString` (32)
- `[Symbol.toPrimitive]` (6)

### `serialize`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelSerialization.ts:166` | Self: 1.2% (14.0ms) | Total: 24.9% (272.2ms) | Samples: 11

**Called by:**
- `toJSON` (209)

**Calls:**
- `getAttributeFromTarget` (121)
- `getAttributeFromTarget` (73)
- `getAttributeFromTarget` (2)
- `getAttributeFromTarget` (1)
- `getAttributeFromTarget` (1)

### `(module)`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/query/grammars/SQLiteGrammar.ts:4` | Self: 1.2% (13.9ms) | Total: 1.2% (13.9ms) | Samples: 1

### `serializeRawJsonRow`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:309` | Self: 1.0% (11.7ms) | Total: 5.2% (57.5ms) | Samples: 9

**Called by:**
- `from` (46)

**Calls:**
- `castCompiledAttribute` (24)
- `parse` (13)

### `anonymous`
`[native code]` | Self: 1.0% (11.4ms) | Total: 3.3% (36.7ms) | Samples: 5

**Called by:**
- `node:crypto` (3)
- `internal:streams/duplex` (3)
- `internal:streams/transform` (3)
- `internal:streams/lazy_transform` (3)
- `node:assert/strict` (2)
- `bun:sql` (1)
- `node:assert` (1)
- `internal:streams/destroy` (1)
- `internal:streams/readable` (1)
- `internal:sql/postgres` (1)
- `internal:errors` (1)

**Calls:**
- `internal:streams/duplex` (3)
- `internal:streams/transform` (3)
- `internal:streams/lazy_transform` (3)
- `node:assert` (1)
- `internal:streams/destroy` (1)
- `internal:streams/readable` (1)
- `internal:sql/postgres` (1)
- `internal:validators` (1)
- `internal:errors` (1)

### `ModelAggregates`
`[native code]` | Self: 0.9% (10.1ms) | Total: 6.8% (74.7ms) | Samples: 8

**Called by:**
- `Model` (58)

**Calls:**
- `ModelQuerying` (50)

### `getModelTarget`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelBase.ts:579` | Self: 0.8% (9.2ms) | Total: 0.8% (9.2ms) | Samples: 7

**Called by:**
- `hydrateModelRow` (7)

### `getAttributeFromTarget`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:503` | Self: 0.8% (8.8ms) | Total: 14.4% (157.4ms) | Samples: 6

**Called by:**
- `serialize` (121)

**Calls:**
- `castAttributeFromTarget` (44)
- `castCompiledAttribute` (37)
- `castAttributeFromTarget` (26)
- `parse` (6)
- `castBuiltInAttribute` (1)
- `castCompiledAttribute` (1)

### `ModelCore`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts` | Self: 0.7% (8.0ms) | Total: 0.7% (8.0ms) | Samples: 6

**Called by:**
- `ModelPersistence` (6)

### `ModelQuerying`
`[native code]` | Self: 0.7% (7.8ms) | Total: 5.9% (64.6ms) | Samples: 6

**Called by:**
- `ModelAggregates` (50)

**Calls:**
- `ModelRelations` (44)

### `Model`
`[native code]` | Self: 0.7% (7.7ms) | Total: 7.5% (82.5ms) | Samples: 6

**Called by:**
- `PipelinePost` (64)

**Calls:**
- `ModelAggregates` (58)

### `[Symbol.toPrimitive]`
`[native code]` | Self: 0.6% (7.6ms) | Total: 0.6% (7.6ms) | Samples: 6

**Called by:**
- `toJSON` (6)

### `compileCast`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:218` | Self: 0.6% (7.4ms) | Total: 0.6% (7.4ms) | Samples: 6

**Called by:**
- `castBuiltInAttribute` (6)

### `run`
`[native code]` | Self: 0.6% (7.0ms) | Total: 0.6% (7.0ms) | Samples: 6

**Called by:**
- `run` (6)

### `prepare`
`[native code]` | Self: 0.5% (6.5ms) | Total: 0.5% (6.5ms) | Samples: 5

**Called by:**
- `prepare` (5)

### `castCompiledAttribute`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:278` | Self: 0.5% (6.0ms) | Total: 7.0% (77.4ms) | Samples: 5

**Called by:**
- `getAttributeFromTarget` (37)
- `serializeRawJsonRow` (24)

**Calls:**
- `Date` (56)

### `compileCast`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:220` | Self: 0.5% (6.0ms) | Total: 1.5% (17.4ms) | Samples: 5

**Called by:**
- `castBuiltInAttribute` (14)

**Calls:**
- `cloneObject` (9)

### `castAttributeFromTarget`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:552` | Self: 0.5% (5.7ms) | Total: 3.1% (34.3ms) | Samples: 4

**Called by:**
- `getAttributeFromTarget` (26)

**Calls:**
- `castBuiltInAttribute` (22)

### `hydrateModelRow`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelPersistence.ts:48` | Self: 0.4% (5.1ms) | Total: 0.4% (5.1ms) | Samples: 4

**Called by:**
- `(anonymous)` (4)

### `PipelinePost`
`[native code]` | Self: 0.4% (5.1ms) | Total: 8.0% (87.6ms) | Samples: 4

**Called by:**
- `hydrateModelRow` (68)

**Calls:**
- `Model` (64)

### `push`
`[native code]` | Self: 0.3% (4.0ms) | Total: 0.3% (4.0ms) | Samples: 3

**Called by:**
- `Array` (3)

### `Set`
`[native code]` | Self: 0.3% (4.0ms) | Total: 0.3% (4.0ms) | Samples: 3

**Called by:**
- `serialize` (3)

### `Array`
`[native code]` | Self: 0.3% (4.0ms) | Total: 0.3% (4.0ms) | Samples: 3

**Called by:**
- `map` (2)
- `SQLResultArray` (1)

### `hydrateModelRow`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelPersistence.ts:70` | Self: 0.3% (3.5ms) | Total: 0.7% (8.1ms) | Samples: 3

**Called by:**
- `(anonymous)` (7)

**Calls:**
- `cloneObject` (4)

### `parseOptions`
`internal:sql/shared` | Self: 0.2% (2.9ms) | Total: 0.2% (2.9ms) | Samples: 2

**Called by:**
- `SQL2` (2)

### `hydrateModelRow`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelPersistence.ts:72` | Self: 0.2% (2.7ms) | Total: 0.2% (2.7ms) | Samples: 2

**Called by:**
- `(anonymous)` (2)

### `Proxy`
`[native code]` | Self: 0.2% (2.6ms) | Total: 0.2% (2.6ms) | Samples: 2

**Called by:**
- `ModelCore` (2)

### `toJSON`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/support/Collection.ts:210` | Self: 0.2% (2.5ms) | Total: 31.3% (342.2ms) | Samples: 2

**Called by:**
- `async measure` (46)
- `async measure` (23)
- `async countTraps` (17)
- `async (anonymous)` (2)

**Calls:**
- `serialize` (209)
- `serialize` (49)
- `serialize` (1)
- `serialize` (1)
- `performProxyObjectGet` (1)

### `ModelCore`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:206` | Self: 0.2% (2.5ms) | Total: 2.2% (24.9ms) | Samples: 2

**Called by:**
- `ModelPersistence` (20)

**Calls:**
- `copyDataProperties` (13)
- `cloneObject` (5)

### `getCastDefinition`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:615` | Self: 0.2% (2.5ms) | Total: 0.2% (2.5ms) | Samples: 2

**Called by:**
- `getAttributeFromTarget` (2)

### `compileCast`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:227` | Self: 0.2% (2.4ms) | Total: 0.2% (2.4ms) | Samples: 1

**Called by:**
- `castBuiltInAttribute` (1)

### `Array`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/support/Collection.ts:190` | Self: 0.2% (2.4ms) | Total: 1.0% (11.3ms) | Samples: 2

**Called by:**
- `async get` (5)
- `async get` (4)

**Calls:**
- `from` (4)
- `push` (3)

### `(anonymous)`
`internal:sql/shared:1` | Self: 0.2% (2.4ms) | Total: 0.2% (2.4ms) | Samples: 2

**Called by:**
- `SQLResultArray` (2)

### `getAttributeFromTarget`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:497` | Self: 0.2% (2.4ms) | Total: 0.2% (2.4ms) | Samples: 2

**Called by:**
- `serialize` (2)

### `arrayIteratorNextHelper`
`[native code]` | Self: 0.2% (2.4ms) | Total: 0.2% (2.4ms) | Samples: 2

**Called by:**
- `next` (2)

### `from`
`[native code]` | Self: 0.2% (2.2ms) | Total: 6.3% (69.3ms) | Samples: 2

**Called by:**
- `Array` (4)

**Calls:**
- `serializeRawJsonRow` (46)
- `serializeRawJsonRow` (4)
- `next` (2)
- `arrayFromFastWithoutMapFn` (1)
- `serializeRawJsonRow` (1)

### `Query`
`internal:sql/query:43` | Self: 0.1% (1.5ms) | Total: 0.1% (1.5ms) | Samples: 1

**Called by:**
- `unsafeQuery` (1)

### `serialize`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelSerialization.ts:178` | Self: 0.1% (1.5ms) | Total: 0.1% (1.5ms) | Samples: 1

**Called by:**
- `toJSON` (1)

### `open`
`[native code]` | Self: 0.1% (1.4ms) | Total: 0.1% (1.4ms) | Samples: 1

**Called by:**
- `Database` (1)

### `ModelCore`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:199` | Self: 0.1% (1.4ms) | Total: 1.6% (18.5ms) | Samples: 1

**Called by:**
- `ModelPersistence` (14)

**Calls:**
- `(anonymous)` (13)

### `normalizeHydratedCastValue`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts` | Self: 0.1% (1.4ms) | Total: 0.1% (1.4ms) | Samples: 1

**Called by:**
- `hydrateModelRow` (1)

### `hideFromStack`
`internal:shared` | Self: 0.1% (1.4ms) | Total: 0.1% (1.4ms) | Samples: 1

**Called by:**
- `internal:validators` (1)

### `Boolean`
`[native code]` | Self: 0.1% (1.4ms) | Total: 0.1% (1.4ms) | Samples: 1

**Called by:**
- `serialize` (1)

### `async get`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/query/Builder.ts:2165` | Self: 0.1% (1.3ms) | Total: 0.1% (1.3ms) | Samples: 1

**Called by:**
- `async get` (1)

### `SQLiteQueryHandle`
`internal:sql/sqlite` | Self: 0.1% (1.3ms) | Total: 0.1% (1.3ms) | Samples: 1

**Called by:**
- `createQueryHandle` (1)

### `ModelCore`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:208` | Self: 0.1% (1.3ms) | Total: 0.1% (1.3ms) | Samples: 1

**Called by:**
- `ModelPersistence` (1)

### `ModelPersistence`
`[native code]` | Self: 0.1% (1.3ms) | Total: 5.2% (56.8ms) | Samples: 1

**Called by:**
- `ModelSerialization` (44)

**Calls:**
- `ModelCore` (20)
- `ModelCore` (14)
- `ModelCore` (6)
- `ModelCore` (2)
- `ModelCore` (1)

### `compileCast`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:216` | Self: 0.1% (1.3ms) | Total: 0.1% (1.3ms) | Samples: 1

**Called by:**
- `castBuiltInAttribute` (1)

### `keys`
`[native code]` | Self: 0.1% (1.2ms) | Total: 0.1% (1.2ms) | Samples: 1

**Called by:**
- `hydrateModelRow` (1)

### `compileCast`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts` | Self: 0.1% (1.2ms) | Total: 0.1% (1.2ms) | Samples: 1

**Called by:**
- `castBuiltInAttribute` (1)

### `serializeRawJsonRow`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:303` | Self: 0.1% (1.2ms) | Total: 0.4% (4.8ms) | Samples: 1

**Called by:**
- `from` (4)

**Calls:**
- `cloneObject` (3)

### `clone`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/query/Builder.ts:1809` | Self: 0.1% (1.2ms) | Total: 0.1% (1.2ms) | Samples: 1

**Called by:**
- `async rawJson` (1)

### `isSafeIdentifier`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts` | Self: 0.1% (1.2ms) | Total: 0.1% (1.2ms) | Samples: 1

**Called by:**
- `assertSafeIdentifier` (1)

### `castCompiledAttribute`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:232` | Self: 0.1% (1.2ms) | Total: 0.1% (1.2ms) | Samples: 1

**Called by:**
- `getAttributeFromTarget` (1)

### `arrayFromFastWithoutMapFn`
`[native code]` | Self: 0.1% (1.2ms) | Total: 0.1% (1.2ms) | Samples: 1

**Called by:**
- `from` (1)

### `getAttributeFromTarget`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:505` | Self: 0.1% (1.2ms) | Total: 0.1% (1.2ms) | Samples: 1

**Called by:**
- `serialize` (1)

### `async use`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:195` | Self: 0.1% (1.1ms) | Total: 0.2% (2.7ms) | Samples: 1

**Called by:**
- `async query` (1)
- `async run` (1)

**Calls:**
- `async use` (1)

### `async get`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/query/Builder.ts:2163` | Self: 0.1% (1.1ms) | Total: 0.1% (1.1ms) | Samples: 1

### `serializeRawJsonRow`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:311` | Self: 0.1% (1.1ms) | Total: 0.1% (1.1ms) | Samples: 1

**Called by:**
- `from` (1)

### `Database`
`bun:sqlite:262` | Self: 0.1% (1.1ms) | Total: 0.2% (2.6ms) | Samples: 1

**Called by:**
- `SQLiteAdapter` (2)

**Calls:**
- `open` (1)

### `get`
`[native code]` | Self: 0.1% (1.1ms) | Total: 0.1% (1.1ms) | Samples: 1

**Called by:**
- `get` (1)

### `(anonymous)`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:68` | Self: 0.1% (1.1ms) | Total: 0.1% (1.1ms) | Samples: 1

**Called by:**
- `map` (1)

### `assign`
`[native code]` | Self: 0.0% (1.0ms) | Total: 0.0% (1.0ms) | Samples: 1

**Called by:**
- `node:crypto` (1)

### `toJSON`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/support/Collection.ts:208` | Self: 0.0% (1.0ms) | Total: 0.0% (1.0ms) | Samples: 1

**Called by:**
- `async countTraps` (1)

### `getAttributeFromTarget`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:491` | Self: 0.0% (1.0ms) | Total: 0.0% (1.0ms) | Samples: 1

**Called by:**
- `serialize` (1)

### `hydrateModelRow`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelPersistence.ts:50` | Self: 0.0% (1.0ms) | Total: 0.0% (1.0ms) | Samples: 1

**Called by:**
- `(anonymous)` (1)

### `qualifyTable`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:348` | Self: 0.0% (0us) | Total: 0.1% (1.2ms) | Samples: 0

**Called by:**
- `query` (1)

**Calls:**
- `assertSafeIdentifier` (1)

### `SQLResultArray`
`internal:sql/shared:29` | Self: 0.0% (0us) | Total: 0.3% (3.8ms) | Samples: 0

**Called by:**
- `run` (3)

**Calls:**
- `(anonymous)` (2)
- `Array` (1)

### `SQL2`
`bun:sql:20` | Self: 0.0% (0us) | Total: 0.6% (6.8ms) | Samples: 0

**Called by:**
- `(anonymous)` (5)

**Calls:**
- `parseOptions` (2)
- `adapterFromOptions` (2)
- `parseSQLiteOptions` (1)

### `castBuiltInAttribute`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts:295` | Self: 0.0% (0us) | Total: 2.7% (29.9ms) | Samples: 0

**Called by:**
- `castAttributeFromTarget` (22)
- `getAttributeFromTarget` (1)

**Calls:**
- `compileCast` (14)
- `compileCast` (6)
- `compileCast` (1)
- `compileCast` (1)
- `compileCast` (1)

### `run`
`node:async_hooks:150` | Self: 0.0% (0us) | Total: 0.1% (1.5ms) | Samples: 0

**Called by:**
- `async use` (1)

**Calls:**
- `async execute` (1)

### `async get`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/query/Builder.ts:2198` | Self: 0.0% (0us) | Total: 17.6% (192.8ms) | Samples: 0

**Calls:**
- `map` (150)

### `getCastDefinition`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:616` | Self: 0.0% (0us) | Total: 13.7% (149.8ms) | Samples: 0

**Called by:**
- `getAttributeFromTarget` (71)
- `castAttributeFromTarget` (44)

**Calls:**
- `assertSupportedStringCast` (94)
- `assertSupportedStringCast` (21)

### `async rawJson`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/query/Builder.ts:2431` | Self: 0.0% (0us) | Total: 0.1% (1.2ms) | Samples: 0

**Called by:**
- `async measure` (1)

**Calls:**
- `async rawJson` (1)

### `internal:sql/postgres`
`internal:sql/postgres:10` | Self: 0.0% (0us) | Total: 0.1% (1.3ms) | Samples: 0

**Called by:**
- `anonymous` (1)

**Calls:**
- `anonymous` (1)

### `async countTraps`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:45` | Self: 0.0% (0us) | Total: 2.0% (22.6ms) | Samples: 0

**Called by:**
- `async (anonymous)` (18)

**Calls:**
- `async countTraps` (18)

### `internal:streams/destroy`
`internal:streams/destroy:2` | Self: 0.0% (0us) | Total: 0.1% (1.3ms) | Samples: 0

**Called by:**
- `anonymous` (1)

**Calls:**
- `anonymous` (1)

### `async use`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:199` | Self: 0.0% (0us) | Total: 0.1% (1.5ms) | Samples: 0

**Called by:**
- `async use` (1)

**Calls:**
- `run` (1)

### `async get`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/query/Builder.ts:2162` | Self: 0.0% (0us) | Total: 0.2% (2.5ms) | Samples: 0

**Called by:**
- `async measure` (1)
- `async (anonymous)` (1)

**Calls:**
- `async get` (1)
- `async get` (1)

### `async (anonymous)`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:126` | Self: 0.0% (0us) | Total: 0.1% (1.2ms) | Samples: 0

**Called by:**
- `(module)` (1)

**Calls:**
- `async (anonymous)` (1)

### `async query`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:498` | Self: 0.0% (0us) | Total: 0.1% (1.1ms) | Samples: 0

**Called by:**
- `async query` (1)

**Calls:**
- `async use` (1)

### `serialize`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelSerialization.ts:165` | Self: 0.0% (0us) | Total: 0.1% (1.4ms) | Samples: 0

**Called by:**
- `toJSON` (1)

**Calls:**
- `Boolean` (1)

### `unsafeQuery`
`bun:sql:63` | Self: 0.0% (0us) | Total: 0.1% (1.5ms) | Samples: 0

**Called by:**
- `async applySqliteDefaults` (1)

**Calls:**
- `Query` (1)

### `ModelCore`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:214` | Self: 0.0% (0us) | Total: 0.2% (2.6ms) | Samples: 0

**Called by:**
- `ModelPersistence` (2)

**Calls:**
- `Proxy` (2)

### `castAttributeFromTarget`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:540` | Self: 0.0% (0us) | Total: 5.1% (56.1ms) | Samples: 0

**Called by:**
- `getAttributeFromTarget` (44)

**Calls:**
- `getCastDefinition` (44)

### `(module)`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:158` | Self: 0.0% (0us) | Total: 0.2% (2.8ms) | Samples: 0

**Calls:**
- `async (anonymous)` (1)
- `async (anonymous)` (1)

### `async measure`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:29` | Self: 0.0% (0us) | Total: 2.5% (27.7ms) | Samples: 0

**Called by:**
- `async (anonymous)` (12)
- `async (anonymous)` (10)

**Calls:**
- `async measure` (22)

### `async get`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/query/Builder.ts:2178` | Self: 0.0% (0us) | Total: 0.1% (1.1ms) | Samples: 0

**Called by:**
- `async get` (1)

**Calls:**
- `async query` (1)

### `internal:errors`
`internal:errors:2` | Self: 0.0% (0us) | Total: 0.1% (1.3ms) | Samples: 0

**Called by:**
- `anonymous` (1)

**Calls:**
- `anonymous` (1)

### `internal:streams/lazy_transform`
`internal:streams/lazy_transform:2` | Self: 0.0% (0us) | Total: 0.5% (5.7ms) | Samples: 0

**Called by:**
- `anonymous` (3)

**Calls:**
- `anonymous` (3)

### `node:fs/promises`
`node:fs/promises:137` | Self: 0.0% (0us) | Total: 1.7% (19.6ms) | Samples: 0

**Calls:**
- `asyncWrap` (1)

### `ModelRelations`
`[native code]` | Self: 0.0% (0us) | Total: 5.2% (56.8ms) | Samples: 0

**Called by:**
- `ModelQuerying` (44)

**Calls:**
- `ModelSerialization` (44)

### `run`
`internal:sql/sqlite:169` | Self: 0.0% (0us) | Total: 0.3% (3.8ms) | Samples: 0

**Called by:**
- `onQueryConnected` (3)

**Calls:**
- `SQLResultArray` (3)

### `query`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:380` | Self: 0.0% (0us) | Total: 0.1% (1.2ms) | Samples: 0

**Called by:**
- `modelQuery` (1)

**Calls:**
- `qualifyTable` (1)

### `async applySqliteDefaults`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:630` | Self: 0.0% (0us) | Total: 0.1% (1.5ms) | Samples: 0

**Called by:**
- `async applySqliteDefaults` (1)

**Calls:**
- `unsafeQuery` (1)

### `bound onQueryConnected`
`[native code]` | Self: 0.0% (0us) | Total: 24.6% (269.1ms) | Samples: 0

**Called by:**
- `connect` (200)

**Calls:**
- `onQueryConnected` (200)

### `async #runAsync`
`internal:sql/query:75` | Self: 0.0% (0us) | Total: 0.1% (1.3ms) | Samples: 0

**Called by:**
- `async #runAsync` (1)

**Calls:**
- `#getQueryHandle` (1)

### `async countTraps`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:68` | Self: 0.0% (0us) | Total: 0.1% (1.1ms) | Samples: 0

**Calls:**
- `map` (1)

### `map`
`[native code]` | Self: 0.0% (0us) | Total: 17.7% (194.0ms) | Samples: 0

**Called by:**
- `async get` (150)
- `async countTraps` (1)

**Calls:**
- `(anonymous)` (148)
- `Array` (2)
- `(anonymous)` (1)

### `internal:streams/readable`
`internal:streams/readable:2` | Self: 0.0% (0us) | Total: 0.1% (1.3ms) | Samples: 0

**Called by:**
- `anonymous` (1)

**Calls:**
- `anonymous` (1)

### `async execute`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:544` | Self: 0.0% (0us) | Total: 0.1% (1.5ms) | Samples: 0

**Called by:**
- `async execute` (1)

**Calls:**
- `async ensureSqliteDefaults` (1)

### `(anonymous)`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:74` | Self: 0.0% (0us) | Total: 0.6% (6.8ms) | Samples: 0

**Called by:**
- `(module)` (5)

**Calls:**
- `Connection` (5)

### `next`
`[native code]` | Self: 0.0% (0us) | Total: 0.2% (2.4ms) | Samples: 0

**Called by:**
- `from` (2)

**Calls:**
- `arrayIteratorNextHelper` (2)

### `#getQueryHandle`
`internal:sql/query:31` | Self: 0.0% (0us) | Total: 0.1% (1.3ms) | Samples: 0

**Called by:**
- `async #runAsync` (1)

**Calls:**
- `createQueryHandle` (1)

### `run`
`bun:sqlite:323` | Self: 0.0% (0us) | Total: 0.6% (7.0ms) | Samples: 0

**Called by:**
- `run` (6)

**Calls:**
- `run` (6)

### `get`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelBase.ts:593` | Self: 0.0% (0us) | Total: 0.1% (1.1ms) | Samples: 0

**Called by:**
- `performProxyObjectGet` (1)

**Calls:**
- `get` (1)

### `onQueryConnected`
`bun:sql:37` | Self: 0.0% (0us) | Total: 24.6% (269.1ms) | Samples: 0

**Called by:**
- `bound onQueryConnected` (200)

**Calls:**
- `run` (186)
- `run` (6)
- `run` (5)
- `run` (3)

### `adapterFromOptions`
`bun:sql:14` | Self: 0.0% (0us) | Total: 0.2% (2.6ms) | Samples: 0

**Called by:**
- `SQL2` (2)

**Calls:**
- `SQLiteAdapter` (2)

### `modelQuery`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:76` | Self: 0.0% (0us) | Total: 0.1% (1.2ms) | Samples: 0

**Called by:**
- `async (anonymous)` (1)

**Calls:**
- `query` (1)

### `internal:validators`
`internal:validators:67` | Self: 0.0% (0us) | Total: 0.1% (1.4ms) | Samples: 0

**Called by:**
- `anonymous` (1)

**Calls:**
- `hideFromStack` (1)

### `parseSQLiteOptions`
`internal:sql/shared:837` | Self: 0.0% (0us) | Total: 0.1% (1.2ms) | Samples: 0

**Called by:**
- `SQL2` (1)

**Calls:**
- `cloneObject` (1)

### `internal:streams/duplex`
`internal:streams/duplex:2` | Self: 0.0% (0us) | Total: 0.5% (5.7ms) | Samples: 0

**Called by:**
- `anonymous` (3)

**Calls:**
- `anonymous` (3)

### `async (anonymous)`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:136` | Self: 0.0% (0us) | Total: 0.2% (2.7ms) | Samples: 0

**Called by:**
- `async measure` (1)
- `async (anonymous)` (1)

**Calls:**
- `async get` (1)
- `async (anonymous)` (1)

### `async query`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:496` | Self: 0.0% (0us) | Total: 0.1% (1.1ms) | Samples: 0

**Called by:**
- `async get` (1)

**Calls:**
- `async query` (1)

### `hydrateModelRow`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelPersistence.ts:44` | Self: 0.0% (0us) | Total: 8.0% (87.6ms) | Samples: 0

**Called by:**
- `(anonymous)` (68)

**Calls:**
- `PipelinePost` (68)

### `node:assert`
`node:assert:2` | Self: 0.0% (0us) | Total: 0.1% (1.4ms) | Samples: 0

**Called by:**
- `anonymous` (1)

**Calls:**
- `anonymous` (1)

### `hydrateModelRow`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelPersistence.ts:68` | Self: 0.0% (0us) | Total: 0.1% (1.2ms) | Samples: 0

**Called by:**
- `(anonymous)` (1)

**Calls:**
- `keys` (1)

### `getAttributeFromTarget`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts:490` | Self: 0.0% (0us) | Total: 8.7% (96.1ms) | Samples: 0

**Called by:**
- `serialize` (73)

**Calls:**
- `getCastDefinition` (71)
- `getCastDefinition` (2)

### `Connection`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:144` | Self: 0.0% (0us) | Total: 0.6% (6.8ms) | Samples: 0

**Called by:**
- `(anonymous)` (5)

**Calls:**
- `(anonymous)` (5)

### `run`
`internal:sql/sqlite:158` | Self: 0.0% (0us) | Total: 0.5% (6.5ms) | Samples: 0

**Called by:**
- `onQueryConnected` (5)

**Calls:**
- `prepare` (5)

### `async (anonymous)`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:84` | Self: 0.0% (0us) | Total: 0.1% (1.5ms) | Samples: 0

**Called by:**
- `async (anonymous)` (1)

**Calls:**
- `async run` (1)

### `async (anonymous)`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:138` | Self: 0.0% (0us) | Total: 1.1% (12.5ms) | Samples: 0

**Calls:**
- `async measure` (10)

### `async countTraps`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:60` | Self: 0.0% (0us) | Total: 2.0% (22.6ms) | Samples: 0

**Called by:**
- `async countTraps` (18)

**Calls:**
- `toJSON` (17)
- `toJSON` (1)

### `assertSafeIdentifier`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:268` | Self: 0.0% (0us) | Total: 0.1% (1.2ms) | Samples: 0

**Called by:**
- `qualifyTable` (1)

**Calls:**
- `isSafeIdentifier` (1)

### `async (anonymous)`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:127` | Self: 0.0% (0us) | Total: 0.3% (3.7ms) | Samples: 0

**Called by:**
- `async (anonymous)` (1)

**Calls:**
- `toJSON` (2)
- `modelQuery` (1)

### `run`
`internal:sql/sqlite:172` | Self: 0.0% (0us) | Total: 0.6% (7.0ms) | Samples: 0

**Called by:**
- `onQueryConnected` (6)

**Calls:**
- `run` (6)

### `run`
`internal:sql/sqlite:165` | Self: 0.0% (0us) | Total: 23.0% (251.6ms) | Samples: 0

**Called by:**
- `onQueryConnected` (186)

**Calls:**
- `all` (186)

### `(module)`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:1` | Self: 0.0% (0us) | Total: 0.1% (1.3ms) | Samples: 0

**Calls:**
- `bun:sql` (1)

### `async ensureSqliteDefaults`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:604` | Self: 0.0% (0us) | Total: 0.1% (1.5ms) | Samples: 0

**Called by:**
- `async execute` (1)

**Calls:**
- `async ensureSqliteDefaults` (1)

### `internal:streams/transform`
`internal:streams/transform:2` | Self: 0.0% (0us) | Total: 0.5% (5.7ms) | Samples: 0

**Called by:**
- `anonymous` (3)

**Calls:**
- `anonymous` (3)

### `async execute`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:540` | Self: 0.0% (0us) | Total: 0.1% (1.5ms) | Samples: 0

**Called by:**
- `run` (1)

**Calls:**
- `async execute` (1)

### `hydrateModelRow`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelPersistence.ts:45` | Self: 0.0% (0us) | Total: 0.8% (9.2ms) | Samples: 0

**Called by:**
- `(anonymous)` (7)

**Calls:**
- `getModelTarget` (7)

### `async measure`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:37` | Self: 0.0% (0us) | Total: 15.9% (173.8ms) | Samples: 0

**Calls:**
- `stringify` (81)
- `toJSON` (46)
- `async rawJson` (1)
- `async get` (1)
- `async (anonymous)` (1)

### `SQLiteAdapter`
`internal:sql/sqlite:207` | Self: 0.0% (0us) | Total: 0.2% (2.6ms) | Samples: 0

**Called by:**
- `adapterFromOptions` (2)

**Calls:**
- `Database` (2)

### `(module)`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:73` | Self: 0.0% (0us) | Total: 0.6% (6.8ms) | Samples: 0

**Calls:**
- `(anonymous)` (5)

### `(anonymous)`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:120` | Self: 0.0% (0us) | Total: 0.6% (6.8ms) | Samples: 0

**Called by:**
- `Connection` (5)

**Calls:**
- `SQL2` (5)

### `bun:sql`
`bun:sql:2` | Self: 0.0% (0us) | Total: 0.1% (1.3ms) | Samples: 0

**Called by:**
- `(module)` (1)

**Calls:**
- `anonymous` (1)

### `async run`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:501` | Self: 0.0% (0us) | Total: 0.1% (1.5ms) | Samples: 0

**Called by:**
- `async (anonymous)` (1)

**Calls:**
- `async run` (1)

### `connect`
`internal:sql/sqlite:290` | Self: 0.0% (0us) | Total: 24.6% (269.1ms) | Samples: 0

**Called by:**
- `queryFromPoolHandler` (200)

**Calls:**
- `bound onQueryConnected` (200)

### `async ensureSqliteDefaults`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:607` | Self: 0.0% (0us) | Total: 0.1% (1.5ms) | Samples: 0

**Called by:**
- `async ensureSqliteDefaults` (1)

**Calls:**
- `async applySqliteDefaults` (1)

### `async run`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:503` | Self: 0.0% (0us) | Total: 0.1% (1.5ms) | Samples: 0

**Called by:**
- `async run` (1)

**Calls:**
- `async use` (1)

### `async #runAsync`
`internal:sql/query:66` | Self: 0.0% (0us) | Total: 0.1% (1.3ms) | Samples: 0

**Called by:**
- `#runAsyncAndCatch` (1)

**Calls:**
- `async #runAsync` (1)

### `async get`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/query/Builder.ts:2239` | Self: 0.0% (0us) | Total: 0.4% (5.0ms) | Samples: 0

**Calls:**
- `Array` (4)

### `async rawJson`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/query/Builder.ts:2441` | Self: 0.0% (0us) | Total: 0.1% (1.2ms) | Samples: 0

**Called by:**
- `async rawJson` (1)

**Calls:**
- `clone` (1)

### `performProxyObjectGet`
`[native code]` | Self: 0.0% (0us) | Total: 0.1% (1.1ms) | Samples: 0

**Called by:**
- `toJSON` (1)

**Calls:**
- `get` (1)

### `node:crypto`
`node:crypto:130` | Self: 0.0% (0us) | Total: 0.0% (1.0ms) | Samples: 0

**Calls:**
- `assign` (1)

### `async (anonymous)`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:135` | Self: 0.0% (0us) | Total: 1.3% (15.2ms) | Samples: 0

**Calls:**
- `async measure` (12)

### `(anonymous)`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/query/Builder.ts:2216` | Self: 0.0% (0us) | Total: 17.4% (190.2ms) | Samples: 0

**Called by:**
- `map` (148)

**Calls:**
- `hydrateModelRow` (68)
- `hydrateModelRow` (32)
- `hydrateModelRow` (26)
- `hydrateModelRow` (7)
- `hydrateModelRow` (7)
- `hydrateModelRow` (4)
- `hydrateModelRow` (2)
- `hydrateModelRow` (1)
- `hydrateModelRow` (1)

### `then`
`internal:sql/query:155` | Self: 0.0% (0us) | Total: 0.1% (1.3ms) | Samples: 0

**Calls:**
- `#runAsyncAndCatch` (1)

### `queryFromPoolHandler`
`bun:sql:49` | Self: 0.0% (0us) | Total: 24.6% (269.1ms) | Samples: 0

**Called by:**
- `async #runAsync` (200)

**Calls:**
- `connect` (200)

### `createQueryHandle`
`internal:sql/sqlite:228` | Self: 0.0% (0us) | Total: 0.1% (1.3ms) | Samples: 0

**Called by:**
- `#getQueryHandle` (1)

**Calls:**
- `SQLiteQueryHandle` (1)

### `async #runAsync`
`internal:sql/query:80` | Self: 0.0% (0us) | Total: 24.6% (269.1ms) | Samples: 0

**Calls:**
- `queryFromPoolHandler` (200)

### `async (anonymous)`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:82` | Self: 0.0% (0us) | Total: 0.1% (1.5ms) | Samples: 0

**Called by:**
- `(module)` (1)

**Calls:**
- `async (anonymous)` (1)

### `node:assert/strict`
`node:assert/strict:3` | Self: 0.0% (0us) | Total: 0.5% (5.8ms) | Samples: 0

**Calls:**
- `anonymous` (2)

### `async get`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/query/Builder.ts:2242` | Self: 0.0% (0us) | Total: 0.5% (6.2ms) | Samples: 0

**Calls:**
- `Array` (5)

### `async applySqliteDefaults`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts:612` | Self: 0.0% (0us) | Total: 0.1% (1.5ms) | Samples: 0

**Called by:**
- `async ensureSqliteDefaults` (1)

**Calls:**
- `async applySqliteDefaults` (1)

### `ModelSerialization`
`[native code]` | Self: 0.0% (0us) | Total: 5.2% (56.8ms) | Samples: 0

**Called by:**
- `ModelRelations` (44)

**Calls:**
- `ModelPersistence` (44)

### `prepare`
`bun:sqlite:327` | Self: 0.0% (0us) | Total: 0.5% (6.5ms) | Samples: 0

**Called by:**
- `run` (5)

**Calls:**
- `prepare` (5)

### `#runAsyncAndCatch`
`internal:sql/query:150` | Self: 0.0% (0us) | Total: 0.1% (1.3ms) | Samples: 0

**Called by:**
- `then` (1)

**Calls:**
- `async #runAsync` (1)

### `async measure`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:32` | Self: 0.0% (0us) | Total: 6.1% (67.6ms) | Samples: 0

**Called by:**
- `async measure` (22)

**Calls:**
- `stringify` (30)
- `toJSON` (23)

### `node:crypto`
`node:crypto:2` | Self: 0.0% (0us) | Total: 0.5% (5.7ms) | Samples: 0

**Calls:**
- `anonymous` (3)

### `async (anonymous)`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts:154` | Self: 0.0% (0us) | Total: 2.0% (22.6ms) | Samples: 0

**Calls:**
- `async countTraps` (18)

## Files

| Self% | Self | File |
|------:|-----:|------|
| 56.8% | 621.2ms | `[native code]` |
| 18.8% | 205.8ms | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelJsonRow.ts` |
| 6.8% | 74.7ms | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelSerialization.ts` |
| 6.5% | 71.5ms | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelPersistence.ts` |
| 4.7% | 52.3ms | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelCore.ts` |
| 1.7% | 19.6ms | `node:fs/promises` |
| 1.2% | 13.9ms | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/query/grammars/SQLiteGrammar.ts` |
| 0.8% | 9.2ms | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/model/ModelBase.ts` |
| 0.5% | 6.1ms | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/support/Collection.ts` |
| 0.4% | 5.4ms | `internal:sql/shared` |
| 0.3% | 3.8ms | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/query/Builder.ts` |
| 0.2% | 2.4ms | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/src/connection/Connection.ts` |
| 0.1% | 1.5ms | `internal:sql/query` |
| 0.1% | 1.4ms | `internal:shared` |
| 0.1% | 1.3ms | `internal:sql/sqlite` |
| 0.1% | 1.1ms | `bun:sqlite` |
| 0.1% | 1.1ms | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-before/tests/profile.ts` |
