# CPU Profile

| Duration | Samples | Interval | Functions |
|----------|---------|----------|----------|
| 845.2ms | 548 | 1.0ms | 131 |

**Top 10:** `all` 27.7%, `stringify` 9.7%, `Date` 8.1%, `toISOString` 5.7%, `serialize` 5.3%, `hydrateModelRow` 3.2%, `copyDataProperties` 2.7%, `hydrateModelRow` 2.7%, `parse` 2.5%, `normalizeHydratedCastValue` 1.8%

## Hot Functions (Self Time)

| Self% | Self | Total% | Total | Function | Location |
|------:|-----:|-------:|------:|----------|----------|
| 27.7% | 234.5ms | 27.7% | 234.5ms | `all` | `[native code]` |
| 9.7% | 82.1ms | 17.5% | 148.4ms | `stringify` | `[native code]` |
| 8.1% | 68.5ms | 8.1% | 68.5ms | `Date` | `[native code]` |
| 5.7% | 48.9ms | 5.7% | 48.9ms | `toISOString` | `[native code]` |
| 5.3% | 44.9ms | 5.4% | 46.4ms | `serialize` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelSerialization.ts:154` |
| 3.2% | 27.8ms | 3.2% | 27.8ms | `hydrateModelRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelPersistence.ts:57` |
| 2.7% | 23.2ms | 2.7% | 23.2ms | `copyDataProperties` | `[native code]` |
| 2.7% | 22.8ms | 4.5% | 38.5ms | `hydrateModelRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelPersistence.ts:56` |
| 2.5% | 21.1ms | 2.5% | 21.1ms | `parse` | `[native code]` |
| 1.8% | 15.7ms | 1.8% | 15.7ms | `normalizeHydratedCastValue` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelJsonRow.ts:181` |
| 1.7% | 14.7ms | 1.7% | 14.7ms | `(anonymous)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:1` |
| 1.7% | 14.7ms | 3.3% | 28.7ms | `anonymous` | `[native code]` |
| 1.6% | 14.1ms | 8.9% | 75.7ms | `getAttributeFromTarget` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:503` |
| 1.5% | 13.0ms | 7.8% | 66.2ms | `toJSON` | `[native code]` |
| 1.5% | 12.8ms | 10.4% | 88.4ms | `ModelAggregates` | `[native code]` |
| 1.4% | 12.3ms | 1.4% | 12.3ms | `castMetadata` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelJsonRow.ts:222` |
| 1.2% | 10.3ms | 11.8% | 100.1ms | `serialize` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelSerialization.ts:166` |
| 1.2% | 10.2ms | 1.2% | 10.2ms | `cloneObject` | `[native code]` |
| 1.0% | 8.8ms | 9.1% | 77.4ms | `castCompiledAttribute` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelJsonRow.ts:292` |
| 0.9% | 8.2ms | 0.9% | 8.2ms | `run` | `[native code]` |
| 0.8% | 7.1ms | 8.9% | 75.5ms | `ModelQuerying` | `[native code]` |
| 0.7% | 6.4ms | 0.7% | 6.4ms | `castCompiledAttribute` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelJsonRow.ts:245` |
| 0.7% | 6.1ms | 11.1% | 94.5ms | `Model` | `[native code]` |
| 0.6% | 5.6ms | 11.8% | 100.1ms | `PipelinePost` | `[native code]` |
| 0.6% | 5.5ms | 0.6% | 5.5ms | `push` | `[native code]` |
| 0.6% | 5.3ms | 0.6% | 5.3ms | `ModelCore` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts` |
| 0.6% | 5.1ms | 0.6% | 5.1ms | `getCastDefinition` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:615` |
| 0.5% | 4.9ms | 3.6% | 30.8ms | `ModelCore` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:206` |
| 0.5% | 4.8ms | 22.4% | 189.3ms | `(anonymous)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/Builder.ts:2216` |
| 0.5% | 4.7ms | 2.3% | 19.5ms | `ModelCore` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:199` |
| 0.5% | 4.7ms | 0.7% | 6.3ms | `getModelTarget` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelBase.ts:579` |
| 0.5% | 4.5ms | 7.9% | 67.0ms | `ModelPersistence` | `[native code]` |
| 0.5% | 4.5ms | 0.5% | 4.5ms | `serializeRawJsonRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelJsonRow.ts:325` |
| 0.5% | 4.4ms | 18.3% | 155.4ms | `toJSON` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/support/Collection.ts:210` |
| 0.5% | 4.2ms | 0.5% | 4.2ms | `[Symbol.toPrimitive]` | `[native code]` |
| 0.4% | 3.5ms | 0.4% | 3.5ms | `(anonymous)` | `internal:sql/shared:1` |
| 0.4% | 3.4ms | 0.4% | 3.4ms | `Proxy` | `[native code]` |
| 0.3% | 3.2ms | 0.7% | 6.7ms | `ModelCore` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:214` |
| 0.3% | 2.8ms | 6.3% | 53.6ms | `serializeRawJsonRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelJsonRow.ts:323` |
| 0.2% | 2.2ms | 0.2% | 2.2ms | `hydrateModelRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelPersistence.ts:72` |
| 0.2% | 1.7ms | 0.2% | 1.7ms | `toJSON` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/support/Collection.ts:208` |
| 0.2% | 1.7ms | 0.2% | 1.7ms | `makeBitMapDescriptor` | `internal:streams/writable` |
| 0.2% | 1.7ms | 0.2% | 1.7ms | `getAttributeFromTarget` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:501` |
| 0.1% | 1.6ms | 0.9% | 8.0ms | `hydrateModelRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelPersistence.ts:70` |
| 0.1% | 1.6ms | 0.1% | 1.6ms | `performProxyObjectGetByVal` | `[native code]` |
| 0.1% | 1.6ms | 0.1% | 1.6ms | `split` | `[native code]` |
| 0.1% | 1.6ms | 0.1% | 1.6ms | `unwrapIdentifier` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/grammars/Grammar.ts:12` |
| 0.1% | 1.6ms | 0.1% | 1.6ms | `async executeStatement` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/connection/Connection.ts:483` |
| 0.1% | 1.6ms | 0.1% | 1.6ms | `(anonymous)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:55` |
| 0.1% | 1.6ms | 0.3% | 2.8ms | `serializeRawJsonRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelJsonRow.ts:317` |
| 0.1% | 1.5ms | 22.5% | 190.9ms | `map` | `[native code]` |
| 0.1% | 1.5ms | 0.1% | 1.5ms | `some` | `[native code]` |
| 0.1% | 1.5ms | 0.1% | 1.5ms | `performIteration` | `[native code]` |
| 0.1% | 1.5ms | 0.1% | 1.5ms | `async measure` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:30` |
| 0.1% | 1.4ms | 0.1% | 1.4ms | `async get` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/Builder.ts:2167` |
| 0.1% | 1.4ms | 0.1% | 1.4ms | `Set` | `[native code]` |
| 0.1% | 1.4ms | 0.1% | 1.4ms | `Array` | `[native code]` |
| 0.1% | 1.4ms | 0.9% | 8.2ms | `Array` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/support/Collection.ts:190` |
| 0.1% | 1.4ms | 0.1% | 1.4ms | `serialize` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelSerialization.ts:155` |
| 0.1% | 1.3ms | 29.4% | 249.1ms | `bound onQueryConnected` | `[native code]` |
| 0.1% | 1.3ms | 8.0% | 68.3ms | `ModelRelations` | `[native code]` |
| 0.1% | 1.2ms | 0.1% | 1.2ms | `has` | `[native code]` |
| 0.1% | 1.2ms | 0.1% | 1.2ms | `set` | `[native code]` |
| 0.1% | 1.2ms | 0.1% | 1.2ms | `hydrateModelRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelPersistence.ts:49` |
| 0.1% | 1.2ms | 0.1% | 1.2ms | `arrayIteratorNextHelper` | `[native code]` |
| 0.1% | 1.2ms | 0.1% | 1.2ms | `open` | `[native code]` |
| 0.1% | 1.2ms | 0.1% | 1.2ms | `getAttributeFromTarget` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:497` |
| 0.1% | 962us | 0.5% | 4.3ms | `castAttributeFromTarget` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:540` |

## Call Tree (Total Time)

| Total% | Total | Self% | Self | Function | Location |
|-------:|------:|------:|-----:|----------|----------|
| 29.4% | 249.1ms | 0.0% | 0us | `async #runAsync` | `internal:sql/query:80` |
| 29.4% | 249.1ms | 0.1% | 1.3ms | `bound onQueryConnected` | `[native code]` |
| 29.4% | 249.1ms | 0.0% | 0us | `connect` | `internal:sql/sqlite:290` |
| 29.4% | 249.1ms | 0.0% | 0us | `queryFromPoolHandler` | `bun:sql:49` |
| 29.3% | 247.8ms | 0.0% | 0us | `onQueryConnected` | `bun:sql:37` |
| 27.7% | 234.5ms | 27.7% | 234.5ms | `all` | `[native code]` |
| 27.7% | 234.5ms | 0.0% | 0us | `run` | `internal:sql/sqlite:165` |
| 22.5% | 190.9ms | 0.0% | 0us | `async get` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/Builder.ts:2198` |
| 22.5% | 190.9ms | 0.1% | 1.5ms | `map` | `[native code]` |
| 22.4% | 189.3ms | 0.5% | 4.8ms | `(anonymous)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/Builder.ts:2216` |
| 18.3% | 155.4ms | 0.5% | 4.4ms | `toJSON` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/support/Collection.ts:210` |
| 18.1% | 153.6ms | 0.0% | 0us | `async measure` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:37` |
| 17.5% | 148.4ms | 9.7% | 82.1ms | `stringify` | `[native code]` |
| 11.8% | 100.1ms | 1.2% | 10.3ms | `serialize` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelSerialization.ts:166` |
| 11.8% | 100.1ms | 0.6% | 5.6ms | `PipelinePost` | `[native code]` |
| 11.8% | 100.1ms | 0.0% | 0us | `hydrateModelRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelPersistence.ts:44` |
| 11.1% | 94.5ms | 0.7% | 6.1ms | `Model` | `[native code]` |
| 10.4% | 88.4ms | 1.5% | 12.8ms | `ModelAggregates` | `[native code]` |
| 9.1% | 77.4ms | 1.0% | 8.8ms | `castCompiledAttribute` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelJsonRow.ts:292` |
| 8.9% | 75.7ms | 1.6% | 14.1ms | `getAttributeFromTarget` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:503` |
| 8.9% | 75.5ms | 0.8% | 7.1ms | `ModelQuerying` | `[native code]` |
| 8.1% | 68.5ms | 8.1% | 68.5ms | `Date` | `[native code]` |
| 8.0% | 68.3ms | 0.1% | 1.3ms | `ModelRelations` | `[native code]` |
| 7.9% | 67.0ms | 0.0% | 0us | `ModelSerialization` | `[native code]` |
| 7.9% | 67.0ms | 0.5% | 4.5ms | `ModelPersistence` | `[native code]` |
| 7.8% | 66.2ms | 1.5% | 13.0ms | `toJSON` | `[native code]` |
| 7.3% | 62.2ms | 0.0% | 0us | `from` | `[native code]` |
| 6.3% | 53.6ms | 0.3% | 2.8ms | `serializeRawJsonRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelJsonRow.ts:323` |
| 5.7% | 48.9ms | 5.7% | 48.9ms | `toISOString` | `[native code]` |
| 5.6% | 48.1ms | 0.0% | 0us | `async measure` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:32` |
| 5.4% | 46.4ms | 5.3% | 44.9ms | `serialize` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelSerialization.ts:154` |
| 4.5% | 38.5ms | 2.7% | 22.8ms | `hydrateModelRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelPersistence.ts:56` |
| 3.6% | 30.8ms | 0.5% | 4.9ms | `ModelCore` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:206` |
| 3.3% | 28.7ms | 1.7% | 14.7ms | `anonymous` | `[native code]` |
| 3.2% | 27.8ms | 3.2% | 27.8ms | `hydrateModelRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelPersistence.ts:57` |
| 2.7% | 23.2ms | 2.7% | 23.2ms | `copyDataProperties` | `[native code]` |
| 2.5% | 21.1ms | 2.5% | 21.1ms | `parse` | `[native code]` |
| 2.3% | 19.7ms | 0.0% | 0us | `async measure` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:29` |
| 2.3% | 19.5ms | 0.5% | 4.7ms | `ModelCore` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:199` |
| 1.8% | 15.7ms | 1.8% | 15.7ms | `normalizeHydratedCastValue` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelJsonRow.ts:181` |
| 1.7% | 14.7ms | 1.7% | 14.7ms | `(anonymous)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:1` |
| 1.4% | 12.3ms | 0.0% | 0us | `async (anonymous)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:138` |
| 1.4% | 12.3ms | 1.4% | 12.3ms | `castMetadata` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelJsonRow.ts:222` |
| 1.3% | 11.1ms | 0.0% | 0us | `getAttributeFromTarget` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:490` |
| 1.2% | 10.2ms | 1.2% | 10.2ms | `cloneObject` | `[native code]` |
| 1.1% | 9.3ms | 0.0% | 0us | `assertSupportedStringCast` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelJsonRow.ts:209` |
| 1.1% | 9.3ms | 0.0% | 0us | `getCastDefinition` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:616` |
| 1.0% | 8.7ms | 0.0% | 0us | `internal:streams/lazy_transform` | `internal:streams/lazy_transform:2` |
| 1.0% | 8.7ms | 0.0% | 0us | `node:crypto` | `node:crypto:2` |
| 0.9% | 8.2ms | 0.1% | 1.4ms | `Array` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/support/Collection.ts:190` |
| 0.9% | 8.2ms | 0.0% | 0us | `run` | `bun:sqlite:323` |
| 0.9% | 8.2ms | 0.0% | 0us | `run` | `internal:sql/sqlite:172` |
| 0.9% | 8.2ms | 0.9% | 8.2ms | `run` | `[native code]` |
| 0.9% | 8.2ms | 0.0% | 0us | `async (anonymous)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:154` |
| 0.9% | 8.2ms | 0.0% | 0us | `async countTraps` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:45` |
| 0.9% | 8.2ms | 0.0% | 0us | `async countTraps` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:60` |
| 0.9% | 8.0ms | 0.1% | 1.6ms | `hydrateModelRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelPersistence.ts:70` |
| 0.8% | 7.4ms | 0.0% | 0us | `async (anonymous)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:135` |
| 0.7% | 6.7ms | 0.3% | 3.2ms | `ModelCore` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:214` |
| 0.7% | 6.4ms | 0.7% | 6.4ms | `castCompiledAttribute` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelJsonRow.ts:245` |
| 0.7% | 6.3ms | 0.0% | 0us | `hydrateModelRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelPersistence.ts:45` |
| 0.7% | 6.3ms | 0.5% | 4.7ms | `getModelTarget` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelBase.ts:579` |
| 0.7% | 6.3ms | 0.0% | 0us | `async get` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/Builder.ts:2162` |
| 0.7% | 6.1ms | 0.0% | 0us | `bun:sql` | `bun:sql:2` |
| 0.7% | 6.1ms | 0.0% | 0us | `(module)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/connection/Connection.ts:1` |
| 0.6% | 5.5ms | 0.6% | 5.5ms | `push` | `[native code]` |
| 0.6% | 5.3ms | 0.6% | 5.3ms | `ModelCore` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts` |
| 0.6% | 5.1ms | 0.6% | 5.1ms | `getCastDefinition` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:615` |
| 0.5% | 4.9ms | 0.0% | 0us | `run` | `internal:sql/sqlite:169` |
| 0.5% | 4.9ms | 0.0% | 0us | `SQLResultArray` | `internal:sql/shared:29` |
| 0.5% | 4.8ms | 0.0% | 0us | `compileSelectSql` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/Builder.ts:2086` |
| 0.5% | 4.8ms | 0.0% | 0us | `toSql` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/Builder.ts:2118` |
| 0.5% | 4.8ms | 0.0% | 0us | `async get` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/Builder.ts:2166` |
| 0.5% | 4.5ms | 0.5% | 4.5ms | `serializeRawJsonRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelJsonRow.ts:325` |
| 0.5% | 4.3ms | 0.1% | 962us | `castAttributeFromTarget` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:540` |
| 0.5% | 4.3ms | 0.0% | 0us | `async get` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/Builder.ts:2239` |
| 0.5% | 4.2ms | 0.5% | 4.2ms | `[Symbol.toPrimitive]` | `[native code]` |
| 0.4% | 3.9ms | 0.0% | 0us | `async get` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/Builder.ts:2242` |
| 0.4% | 3.5ms | 0.4% | 3.5ms | `(anonymous)` | `internal:sql/shared:1` |
| 0.4% | 3.4ms | 0.4% | 3.4ms | `Proxy` | `[native code]` |
| 0.3% | 3.1ms | 0.0% | 0us | `async rawJson` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/Builder.ts:2444` |
| 0.3% | 3.1ms | 0.0% | 0us | `async rawJson` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/Builder.ts:2431` |
| 0.3% | 2.9ms | 0.0% | 0us | `async (anonymous)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:136` |
| 0.3% | 2.9ms | 0.0% | 0us | `castBuiltInAttribute` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelJsonRow.ts:309` |
| 0.3% | 2.9ms | 0.0% | 0us | `castAttributeFromTarget` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:552` |
| 0.3% | 2.8ms | 0.1% | 1.6ms | `serializeRawJsonRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelJsonRow.ts:317` |
| 0.2% | 2.2ms | 0.2% | 2.2ms | `hydrateModelRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelPersistence.ts:72` |
| 0.2% | 1.7ms | 0.0% | 0us | `async (anonymous)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:127` |
| 0.2% | 1.7ms | 0.2% | 1.7ms | `toJSON` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/support/Collection.ts:208` |
| 0.2% | 1.7ms | 0.2% | 1.7ms | `makeBitMapDescriptor` | `internal:streams/writable` |
| 0.2% | 1.7ms | 0.0% | 0us | `internal:streams/transform` | `internal:streams/transform:2` |
| 0.2% | 1.7ms | 0.0% | 0us | `internal:streams/writable` | `internal:streams/writable:35` |
| 0.2% | 1.7ms | 0.0% | 0us | `internal:streams/duplex` | `internal:streams/duplex:2` |
| 0.2% | 1.7ms | 0.2% | 1.7ms | `getAttributeFromTarget` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:501` |
| 0.1% | 1.6ms | 0.1% | 1.6ms | `performProxyObjectGetByVal` | `[native code]` |
| 0.1% | 1.6ms | 0.0% | 0us | `wrapTable` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/Builder.ts:1895` |
| 0.1% | 1.6ms | 0.1% | 1.6ms | `split` | `[native code]` |
| 0.1% | 1.6ms | 0.0% | 0us | `wrap` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/grammars/SQLiteGrammar.ts:13` |
| 0.1% | 1.6ms | 0.1% | 1.6ms | `unwrapIdentifier` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/grammars/Grammar.ts:12` |
| 0.1% | 1.6ms | 0.0% | 0us | `async execute` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/connection/Connection.ts:553` |
| 0.1% | 1.6ms | 0.1% | 1.6ms | `async executeStatement` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/connection/Connection.ts:483` |
| 0.1% | 1.6ms | 0.1% | 1.6ms | `(anonymous)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:55` |
| 0.1% | 1.6ms | 0.0% | 0us | `performProxyObjectGet` | `[native code]` |
| 0.1% | 1.5ms | 0.0% | 0us | `node:assert/strict` | `node:assert/strict:3` |
| 0.1% | 1.5ms | 0.0% | 0us | `wrapTable` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/Builder.ts:1897` |
| 0.1% | 1.5ms | 0.1% | 1.5ms | `some` | `[native code]` |
| 0.1% | 1.5ms | 0.0% | 0us | `async countTraps` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:65` |
| 0.1% | 1.5ms | 0.1% | 1.5ms | `performIteration` | `[native code]` |
| 0.1% | 1.5ms | 0.1% | 1.5ms | `async measure` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:30` |
| 0.1% | 1.4ms | 0.1% | 1.4ms | `async get` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/Builder.ts:2167` |
| 0.1% | 1.4ms | 0.1% | 1.4ms | `Set` | `[native code]` |
| 0.1% | 1.4ms | 0.1% | 1.4ms | `Array` | `[native code]` |
| 0.1% | 1.4ms | 0.1% | 1.4ms | `serialize` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelSerialization.ts:155` |
| 0.1% | 1.2ms | 0.0% | 0us | `serialize` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelSerialization.ts:162` |
| 0.1% | 1.2ms | 0.1% | 1.2ms | `has` | `[native code]` |
| 0.1% | 1.2ms | 0.1% | 1.2ms | `set` | `[native code]` |
| 0.1% | 1.2ms | 0.0% | 0us | `registerJob` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/queue/Job.ts:76` |
| 0.1% | 1.2ms | 0.0% | 0us | `(module)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/search/jobs/MakeSearchableJob.ts:18` |
| 0.1% | 1.2ms | 0.1% | 1.2ms | `hydrateModelRow` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelPersistence.ts:49` |
| 0.1% | 1.2ms | 0.0% | 0us | `next` | `[native code]` |
| 0.1% | 1.2ms | 0.1% | 1.2ms | `arrayIteratorNextHelper` | `[native code]` |
| 0.1% | 1.2ms | 0.0% | 0us | `adapterFromOptions` | `bun:sql:14` |
| 0.1% | 1.2ms | 0.0% | 0us | `SQL2` | `bun:sql:20` |
| 0.1% | 1.2ms | 0.0% | 0us | `(anonymous)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/connection/Connection.ts:120` |
| 0.1% | 1.2ms | 0.0% | 0us | `SQLiteAdapter` | `internal:sql/sqlite:207` |
| 0.1% | 1.2ms | 0.0% | 0us | `Connection` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/connection/Connection.ts:144` |
| 0.1% | 1.2ms | 0.1% | 1.2ms | `open` | `[native code]` |
| 0.1% | 1.2ms | 0.0% | 0us | `Database` | `bun:sqlite:262` |
| 0.1% | 1.2ms | 0.0% | 0us | `(module)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:73` |
| 0.1% | 1.2ms | 0.0% | 0us | `(anonymous)` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:74` |
| 0.1% | 1.2ms | 0.1% | 1.2ms | `getAttributeFromTarget` | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:497` |

## Function Details

### `all`
`[native code]` | Self: 27.7% (234.5ms) | Total: 27.7% (234.5ms) | Samples: 153

**Called by:**
- `run` (153)

### `stringify`
`[native code]` | Self: 9.7% (82.1ms) | Total: 17.5% (148.4ms) | Samples: 56

**Called by:**
- `async measure` (76)
- `async measure` (20)

**Calls:**
- `toJSON` (40)

### `Date`
`[native code]` | Self: 8.1% (68.5ms) | Total: 8.1% (68.5ms) | Samples: 44

**Called by:**
- `castCompiledAttribute` (44)

### `toISOString`
`[native code]` | Self: 5.7% (48.9ms) | Total: 5.7% (48.9ms) | Samples: 28

**Called by:**
- `toJSON` (28)

### `serialize`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelSerialization.ts:154` | Self: 5.3% (44.9ms) | Total: 5.4% (46.4ms) | Samples: 31

**Called by:**
- `toJSON` (32)

**Calls:**
- `Set` (1)

### `hydrateModelRow`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelPersistence.ts:57` | Self: 3.2% (27.8ms) | Total: 3.2% (27.8ms) | Samples: 18

**Called by:**
- `(anonymous)` (18)

### `copyDataProperties`
`[native code]` | Self: 2.7% (23.2ms) | Total: 2.7% (23.2ms) | Samples: 16

**Called by:**
- `ModelCore` (16)

### `hydrateModelRow`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelPersistence.ts:56` | Self: 2.7% (22.8ms) | Total: 4.5% (38.5ms) | Samples: 15

**Called by:**
- `(anonymous)` (26)

**Calls:**
- `normalizeHydratedCastValue` (11)

### `parse`
`[native code]` | Self: 2.5% (21.1ms) | Total: 2.5% (21.1ms) | Samples: 14

**Called by:**
- `serializeRawJsonRow` (9)
- `getAttributeFromTarget` (5)

### `normalizeHydratedCastValue`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelJsonRow.ts:181` | Self: 1.8% (15.7ms) | Total: 1.8% (15.7ms) | Samples: 11

**Called by:**
- `hydrateModelRow` (11)

### `(anonymous)`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:1` | Self: 1.7% (14.7ms) | Total: 1.7% (14.7ms) | Samples: 10

**Called by:**
- `ModelCore` (10)

### `anonymous`
`[native code]` | Self: 1.7% (14.7ms) | Total: 3.3% (28.7ms) | Samples: 3

**Called by:**
- `node:crypto` (2)
- `internal:streams/lazy_transform` (2)
- `bun:sql` (1)
- `internal:streams/duplex` (1)
- `internal:streams/transform` (1)
- `node:assert/strict` (1)

**Calls:**
- `internal:streams/lazy_transform` (2)
- `internal:streams/writable` (1)
- `internal:streams/duplex` (1)
- `internal:streams/transform` (1)

### `getAttributeFromTarget`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:503` | Self: 1.6% (14.1ms) | Total: 8.9% (75.7ms) | Samples: 9

**Called by:**
- `serialize` (49)

**Calls:**
- `castCompiledAttribute` (27)
- `parse` (5)
- `castCompiledAttribute` (3)
- `castAttributeFromTarget` (3)
- `castAttributeFromTarget` (2)

### `toJSON`
`[native code]` | Self: 1.5% (13.0ms) | Total: 7.8% (66.2ms) | Samples: 9

**Called by:**
- `stringify` (40)

**Calls:**
- `toISOString` (28)
- `[Symbol.toPrimitive]` (3)

### `ModelAggregates`
`[native code]` | Self: 1.5% (12.8ms) | Total: 10.4% (88.4ms) | Samples: 8

**Called by:**
- `Model` (59)

**Calls:**
- `ModelQuerying` (51)

### `castMetadata`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelJsonRow.ts:222` | Self: 1.4% (12.3ms) | Total: 1.4% (12.3ms) | Samples: 8

**Called by:**
- `assertSupportedStringCast` (6)
- `castBuiltInAttribute` (2)

### `serialize`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelSerialization.ts:166` | Self: 1.2% (10.3ms) | Total: 11.8% (100.1ms) | Samples: 6

**Called by:**
- `toJSON` (64)

**Calls:**
- `getAttributeFromTarget` (49)
- `getAttributeFromTarget` (7)
- `getAttributeFromTarget` (1)
- `getAttributeFromTarget` (1)

### `cloneObject`
`[native code]` | Self: 1.2% (10.2ms) | Total: 1.2% (10.2ms) | Samples: 7

**Called by:**
- `hydrateModelRow` (4)
- `ModelCore` (2)
- `serializeRawJsonRow` (1)

### `castCompiledAttribute`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelJsonRow.ts:292` | Self: 1.0% (8.8ms) | Total: 9.1% (77.4ms) | Samples: 6

**Called by:**
- `getAttributeFromTarget` (27)
- `serializeRawJsonRow` (23)

**Calls:**
- `Date` (44)

### `run`
`[native code]` | Self: 0.9% (8.2ms) | Total: 0.9% (8.2ms) | Samples: 6

**Called by:**
- `run` (6)

### `ModelQuerying`
`[native code]` | Self: 0.8% (7.1ms) | Total: 8.9% (75.5ms) | Samples: 5

**Called by:**
- `ModelAggregates` (51)

**Calls:**
- `ModelRelations` (46)

### `castCompiledAttribute`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelJsonRow.ts:245` | Self: 0.7% (6.4ms) | Total: 0.7% (6.4ms) | Samples: 4

**Called by:**
- `getAttributeFromTarget` (3)
- `serializeRawJsonRow` (1)

### `Model`
`[native code]` | Self: 0.7% (6.1ms) | Total: 11.1% (94.5ms) | Samples: 4

**Called by:**
- `PipelinePost` (63)

**Calls:**
- `ModelAggregates` (59)

### `PipelinePost`
`[native code]` | Self: 0.6% (5.6ms) | Total: 11.8% (100.1ms) | Samples: 4

**Called by:**
- `hydrateModelRow` (67)

**Calls:**
- `Model` (63)

### `push`
`[native code]` | Self: 0.6% (5.5ms) | Total: 0.6% (5.5ms) | Samples: 4

**Called by:**
- `Array` (4)

### `ModelCore`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts` | Self: 0.6% (5.3ms) | Total: 0.6% (5.3ms) | Samples: 4

**Called by:**
- `ModelPersistence` (4)

### `getCastDefinition`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:615` | Self: 0.6% (5.1ms) | Total: 0.6% (5.1ms) | Samples: 3

**Called by:**
- `getAttributeFromTarget` (3)

### `ModelCore`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:206` | Self: 0.5% (4.9ms) | Total: 3.6% (30.8ms) | Samples: 3

**Called by:**
- `ModelPersistence` (21)

**Calls:**
- `copyDataProperties` (16)
- `cloneObject` (2)

### `(anonymous)`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/Builder.ts:2216` | Self: 0.5% (4.8ms) | Total: 22.4% (189.3ms) | Samples: 3

**Called by:**
- `map` (126)

**Calls:**
- `hydrateModelRow` (67)
- `hydrateModelRow` (26)
- `hydrateModelRow` (18)
- `hydrateModelRow` (5)
- `hydrateModelRow` (4)
- `hydrateModelRow` (2)
- `hydrateModelRow` (1)

### `ModelCore`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:199` | Self: 0.5% (4.7ms) | Total: 2.3% (19.5ms) | Samples: 3

**Called by:**
- `ModelPersistence` (13)

**Calls:**
- `(anonymous)` (10)

### `getModelTarget`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelBase.ts:579` | Self: 0.5% (4.7ms) | Total: 0.7% (6.3ms) | Samples: 3

**Called by:**
- `hydrateModelRow` (4)

**Calls:**
- `performProxyObjectGetByVal` (1)

### `ModelPersistence`
`[native code]` | Self: 0.5% (4.5ms) | Total: 7.9% (67.0ms) | Samples: 3

**Called by:**
- `ModelSerialization` (45)

**Calls:**
- `ModelCore` (21)
- `ModelCore` (13)
- `ModelCore` (4)
- `ModelCore` (4)

### `serializeRawJsonRow`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelJsonRow.ts:325` | Self: 0.5% (4.5ms) | Total: 0.5% (4.5ms) | Samples: 3

**Called by:**
- `from` (3)

### `toJSON`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/support/Collection.ts:210` | Self: 0.5% (4.4ms) | Total: 18.3% (155.4ms) | Samples: 3

**Called by:**
- `async measure` (20)
- `async measure` (10)
- `async countTraps` (5)
- `async (anonymous)` (1)

**Calls:**
- `serialize` (64)
- `serialize` (32)
- `serialize` (1)
- `performProxyObjectGet` (1)
- `serialize` (1)

### `[Symbol.toPrimitive]`
`[native code]` | Self: 0.5% (4.2ms) | Total: 0.5% (4.2ms) | Samples: 3

**Called by:**
- `toJSON` (3)

### `(anonymous)`
`internal:sql/shared:1` | Self: 0.4% (3.5ms) | Total: 0.4% (3.5ms) | Samples: 2

**Called by:**
- `SQLResultArray` (2)

### `Proxy`
`[native code]` | Self: 0.4% (3.4ms) | Total: 0.4% (3.4ms) | Samples: 2

**Called by:**
- `ModelCore` (2)

### `ModelCore`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:214` | Self: 0.3% (3.2ms) | Total: 0.7% (6.7ms) | Samples: 2

**Called by:**
- `ModelPersistence` (4)

**Calls:**
- `Proxy` (2)

### `serializeRawJsonRow`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelJsonRow.ts:323` | Self: 0.3% (2.8ms) | Total: 6.3% (53.6ms) | Samples: 2

**Called by:**
- `from` (35)

**Calls:**
- `castCompiledAttribute` (23)
- `parse` (9)
- `castCompiledAttribute` (1)

### `hydrateModelRow`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelPersistence.ts:72` | Self: 0.2% (2.2ms) | Total: 0.2% (2.2ms) | Samples: 2

**Called by:**
- `(anonymous)` (2)

### `toJSON`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/support/Collection.ts:208` | Self: 0.2% (1.7ms) | Total: 0.2% (1.7ms) | Samples: 1

**Called by:**
- `async measure` (1)

### `makeBitMapDescriptor`
`internal:streams/writable` | Self: 0.2% (1.7ms) | Total: 0.2% (1.7ms) | Samples: 1

**Called by:**
- `internal:streams/writable` (1)

### `getAttributeFromTarget`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:501` | Self: 0.2% (1.7ms) | Total: 0.2% (1.7ms) | Samples: 1

**Called by:**
- `serialize` (1)

### `hydrateModelRow`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelPersistence.ts:70` | Self: 0.1% (1.6ms) | Total: 0.9% (8.0ms) | Samples: 1

**Called by:**
- `(anonymous)` (5)

**Calls:**
- `cloneObject` (4)

### `performProxyObjectGetByVal`
`[native code]` | Self: 0.1% (1.6ms) | Total: 0.1% (1.6ms) | Samples: 1

**Called by:**
- `getModelTarget` (1)

### `split`
`[native code]` | Self: 0.1% (1.6ms) | Total: 0.1% (1.6ms) | Samples: 1

**Called by:**
- `wrapTable` (1)

### `unwrapIdentifier`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/grammars/Grammar.ts:12` | Self: 0.1% (1.6ms) | Total: 0.1% (1.6ms) | Samples: 1

**Called by:**
- `wrap` (1)

### `async executeStatement`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/connection/Connection.ts:483` | Self: 0.1% (1.6ms) | Total: 0.1% (1.6ms) | Samples: 1

**Called by:**
- `async execute` (1)

### `(anonymous)`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:55` | Self: 0.1% (1.6ms) | Total: 0.1% (1.6ms) | Samples: 1

**Called by:**
- `performProxyObjectGet` (1)

### `serializeRawJsonRow`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelJsonRow.ts:317` | Self: 0.1% (1.6ms) | Total: 0.3% (2.8ms) | Samples: 1

**Called by:**
- `from` (2)

**Calls:**
- `cloneObject` (1)

### `map`
`[native code]` | Self: 0.1% (1.5ms) | Total: 22.5% (190.9ms) | Samples: 1

**Called by:**
- `async get` (127)

**Calls:**
- `(anonymous)` (126)

### `some`
`[native code]` | Self: 0.1% (1.5ms) | Total: 0.1% (1.5ms) | Samples: 1

**Called by:**
- `wrapTable` (1)

### `performIteration`
`[native code]` | Self: 0.1% (1.5ms) | Total: 0.1% (1.5ms) | Samples: 1

**Called by:**
- `async countTraps` (1)

### `async measure`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:30` | Self: 0.1% (1.5ms) | Total: 0.1% (1.5ms) | Samples: 1

### `async get`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/Builder.ts:2167` | Self: 0.1% (1.4ms) | Total: 0.1% (1.4ms) | Samples: 1

**Called by:**
- `async get` (1)

### `Set`
`[native code]` | Self: 0.1% (1.4ms) | Total: 0.1% (1.4ms) | Samples: 1

**Called by:**
- `serialize` (1)

### `Array`
`[native code]` | Self: 0.1% (1.4ms) | Total: 0.1% (1.4ms) | Samples: 1

**Called by:**
- `SQLResultArray` (1)

### `Array`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/support/Collection.ts:190` | Self: 0.1% (1.4ms) | Total: 0.9% (8.2ms) | Samples: 1

**Called by:**
- `async get` (3)
- `async get` (3)

**Calls:**
- `push` (4)
- `from` (1)

### `serialize`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelSerialization.ts:155` | Self: 0.1% (1.4ms) | Total: 0.1% (1.4ms) | Samples: 1

**Called by:**
- `toJSON` (1)

### `bound onQueryConnected`
`[native code]` | Self: 0.1% (1.3ms) | Total: 29.4% (249.1ms) | Samples: 1

**Called by:**
- `connect` (163)

**Calls:**
- `onQueryConnected` (162)

### `ModelRelations`
`[native code]` | Self: 0.1% (1.3ms) | Total: 8.0% (68.3ms) | Samples: 1

**Called by:**
- `ModelQuerying` (46)

**Calls:**
- `ModelSerialization` (45)

### `has`
`[native code]` | Self: 0.1% (1.2ms) | Total: 0.1% (1.2ms) | Samples: 1

**Called by:**
- `serialize` (1)

### `set`
`[native code]` | Self: 0.1% (1.2ms) | Total: 0.1% (1.2ms) | Samples: 1

**Called by:**
- `registerJob` (1)

### `hydrateModelRow`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelPersistence.ts:49` | Self: 0.1% (1.2ms) | Total: 0.1% (1.2ms) | Samples: 1

**Called by:**
- `(anonymous)` (1)

### `arrayIteratorNextHelper`
`[native code]` | Self: 0.1% (1.2ms) | Total: 0.1% (1.2ms) | Samples: 1

**Called by:**
- `next` (1)

### `open`
`[native code]` | Self: 0.1% (1.2ms) | Total: 0.1% (1.2ms) | Samples: 1

**Called by:**
- `Database` (1)

### `getAttributeFromTarget`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:497` | Self: 0.1% (1.2ms) | Total: 0.1% (1.2ms) | Samples: 1

**Called by:**
- `serialize` (1)

### `castAttributeFromTarget`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:540` | Self: 0.1% (962us) | Total: 0.5% (4.3ms) | Samples: 1

**Called by:**
- `getAttributeFromTarget` (3)

**Calls:**
- `getCastDefinition` (2)

### `castAttributeFromTarget`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:552` | Self: 0.0% (0us) | Total: 0.3% (2.9ms) | Samples: 0

**Called by:**
- `getAttributeFromTarget` (2)

**Calls:**
- `castBuiltInAttribute` (2)

### `wrapTable`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/Builder.ts:1897` | Self: 0.0% (0us) | Total: 0.1% (1.5ms) | Samples: 0

**Called by:**
- `compileSelectSql` (1)

**Calls:**
- `some` (1)

### `async (anonymous)`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:136` | Self: 0.0% (0us) | Total: 0.3% (2.9ms) | Samples: 0

**Called by:**
- `async measure` (1)
- `async (anonymous)` (1)

**Calls:**
- `async (anonymous)` (1)
- `async get` (1)

### `toSql`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/Builder.ts:2118` | Self: 0.0% (0us) | Total: 0.5% (4.8ms) | Samples: 0

**Called by:**
- `async get` (3)

**Calls:**
- `compileSelectSql` (3)

### `async (anonymous)`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:138` | Self: 0.0% (0us) | Total: 1.4% (12.3ms) | Samples: 0

**Calls:**
- `async measure` (7)

### `internal:streams/lazy_transform`
`internal:streams/lazy_transform:2` | Self: 0.0% (0us) | Total: 1.0% (8.7ms) | Samples: 0

**Called by:**
- `anonymous` (2)

**Calls:**
- `anonymous` (2)

### `run`
`internal:sql/sqlite:169` | Self: 0.0% (0us) | Total: 0.5% (4.9ms) | Samples: 0

**Called by:**
- `onQueryConnected` (3)

**Calls:**
- `SQLResultArray` (3)

### `(module)`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/search/jobs/MakeSearchableJob.ts:18` | Self: 0.0% (0us) | Total: 0.1% (1.2ms) | Samples: 0

**Calls:**
- `registerJob` (1)

### `async measure`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:29` | Self: 0.0% (0us) | Total: 2.3% (19.7ms) | Samples: 0

**Called by:**
- `async (anonymous)` (7)
- `async (anonymous)` (5)

**Calls:**
- `async measure` (12)

### `from`
`[native code]` | Self: 0.0% (0us) | Total: 7.3% (62.2ms) | Samples: 0

**Called by:**
- `Array` (1)

**Calls:**
- `serializeRawJsonRow` (35)
- `serializeRawJsonRow` (3)
- `serializeRawJsonRow` (2)
- `next` (1)

### `async get`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/Builder.ts:2242` | Self: 0.0% (0us) | Total: 0.4% (3.9ms) | Samples: 0

**Calls:**
- `Array` (3)

### `compileSelectSql`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/Builder.ts:2086` | Self: 0.0% (0us) | Total: 0.5% (4.8ms) | Samples: 0

**Called by:**
- `toSql` (3)

**Calls:**
- `wrap` (1)
- `wrapTable` (1)
- `wrapTable` (1)

### `(anonymous)`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/connection/Connection.ts:120` | Self: 0.0% (0us) | Total: 0.1% (1.2ms) | Samples: 0

**Called by:**
- `Connection` (1)

**Calls:**
- `SQL2` (1)

### `async rawJson`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/Builder.ts:2444` | Self: 0.0% (0us) | Total: 0.3% (3.1ms) | Samples: 0

**Called by:**
- `async rawJson` (2)

**Calls:**
- `async get` (2)

### `Connection`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/connection/Connection.ts:144` | Self: 0.0% (0us) | Total: 0.1% (1.2ms) | Samples: 0

**Called by:**
- `(anonymous)` (1)

**Calls:**
- `(anonymous)` (1)

### `async get`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/Builder.ts:2198` | Self: 0.0% (0us) | Total: 22.5% (190.9ms) | Samples: 0

**Calls:**
- `map` (127)

### `getAttributeFromTarget`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:490` | Self: 0.0% (0us) | Total: 1.3% (11.1ms) | Samples: 0

**Called by:**
- `serialize` (7)

**Calls:**
- `getCastDefinition` (4)
- `getCastDefinition` (3)

### `assertSupportedStringCast`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelJsonRow.ts:209` | Self: 0.0% (0us) | Total: 1.1% (9.3ms) | Samples: 0

**Called by:**
- `getCastDefinition` (6)

**Calls:**
- `castMetadata` (6)

### `async get`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/Builder.ts:2239` | Self: 0.0% (0us) | Total: 0.5% (4.3ms) | Samples: 0

**Calls:**
- `Array` (3)

### `next`
`[native code]` | Self: 0.0% (0us) | Total: 0.1% (1.2ms) | Samples: 0

**Called by:**
- `from` (1)

**Calls:**
- `arrayIteratorNextHelper` (1)

### `async measure`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:37` | Self: 0.0% (0us) | Total: 18.1% (153.6ms) | Samples: 0

**Calls:**
- `stringify` (76)
- `toJSON` (20)
- `async rawJson` (2)
- `async (anonymous)` (1)
- `toJSON` (1)
- `async get` (1)

### `run`
`bun:sqlite:323` | Self: 0.0% (0us) | Total: 0.9% (8.2ms) | Samples: 0

**Called by:**
- `run` (6)

**Calls:**
- `run` (6)

### `serialize`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelSerialization.ts:162` | Self: 0.0% (0us) | Total: 0.1% (1.2ms) | Samples: 0

**Called by:**
- `toJSON` (1)

**Calls:**
- `has` (1)

### `hydrateModelRow`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelPersistence.ts:45` | Self: 0.0% (0us) | Total: 0.7% (6.3ms) | Samples: 0

**Called by:**
- `(anonymous)` (4)

**Calls:**
- `getModelTarget` (4)

### `hydrateModelRow`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelPersistence.ts:44` | Self: 0.0% (0us) | Total: 11.8% (100.1ms) | Samples: 0

**Called by:**
- `(anonymous)` (67)

**Calls:**
- `PipelinePost` (67)

### `onQueryConnected`
`bun:sql:37` | Self: 0.0% (0us) | Total: 29.3% (247.8ms) | Samples: 0

**Called by:**
- `bound onQueryConnected` (162)

**Calls:**
- `run` (153)
- `run` (6)
- `run` (3)

### `adapterFromOptions`
`bun:sql:14` | Self: 0.0% (0us) | Total: 0.1% (1.2ms) | Samples: 0

**Called by:**
- `SQL2` (1)

**Calls:**
- `SQLiteAdapter` (1)

### `async get`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/Builder.ts:2162` | Self: 0.0% (0us) | Total: 0.7% (6.3ms) | Samples: 0

**Called by:**
- `async rawJson` (2)
- `async measure` (1)
- `async (anonymous)` (1)

**Calls:**
- `async get` (3)
- `async get` (1)

### `async countTraps`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:65` | Self: 0.0% (0us) | Total: 0.1% (1.5ms) | Samples: 0

**Calls:**
- `performIteration` (1)

### `internal:streams/duplex`
`internal:streams/duplex:2` | Self: 0.0% (0us) | Total: 0.2% (1.7ms) | Samples: 0

**Called by:**
- `anonymous` (1)

**Calls:**
- `anonymous` (1)

### `internal:streams/writable`
`internal:streams/writable:35` | Self: 0.0% (0us) | Total: 0.2% (1.7ms) | Samples: 0

**Called by:**
- `anonymous` (1)

**Calls:**
- `makeBitMapDescriptor` (1)

### `(module)`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:73` | Self: 0.0% (0us) | Total: 0.1% (1.2ms) | Samples: 0

**Calls:**
- `(anonymous)` (1)

### `async (anonymous)`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:135` | Self: 0.0% (0us) | Total: 0.8% (7.4ms) | Samples: 0

**Calls:**
- `async measure` (5)

### `async execute`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/connection/Connection.ts:553` | Self: 0.0% (0us) | Total: 0.1% (1.6ms) | Samples: 0

**Calls:**
- `async executeStatement` (1)

### `async measure`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:32` | Self: 0.0% (0us) | Total: 5.6% (48.1ms) | Samples: 0

**Called by:**
- `async measure` (12)

**Calls:**
- `stringify` (20)
- `toJSON` (10)

### `run`
`internal:sql/sqlite:165` | Self: 0.0% (0us) | Total: 27.7% (234.5ms) | Samples: 0

**Called by:**
- `onQueryConnected` (153)

**Calls:**
- `all` (153)

### `run`
`internal:sql/sqlite:172` | Self: 0.0% (0us) | Total: 0.9% (8.2ms) | Samples: 0

**Called by:**
- `onQueryConnected` (6)

**Calls:**
- `run` (6)

### `internal:streams/transform`
`internal:streams/transform:2` | Self: 0.0% (0us) | Total: 0.2% (1.7ms) | Samples: 0

**Called by:**
- `anonymous` (1)

**Calls:**
- `anonymous` (1)

### `Database`
`bun:sqlite:262` | Self: 0.0% (0us) | Total: 0.1% (1.2ms) | Samples: 0

**Called by:**
- `SQLiteAdapter` (1)

**Calls:**
- `open` (1)

### `async (anonymous)`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:154` | Self: 0.0% (0us) | Total: 0.9% (8.2ms) | Samples: 0

**Calls:**
- `async countTraps` (5)

### `async rawJson`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/Builder.ts:2431` | Self: 0.0% (0us) | Total: 0.3% (3.1ms) | Samples: 0

**Called by:**
- `async measure` (2)

**Calls:**
- `async rawJson` (2)

### `SQLiteAdapter`
`internal:sql/sqlite:207` | Self: 0.0% (0us) | Total: 0.1% (1.2ms) | Samples: 0

**Called by:**
- `adapterFromOptions` (1)

**Calls:**
- `Database` (1)

### `async countTraps`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:45` | Self: 0.0% (0us) | Total: 0.9% (8.2ms) | Samples: 0

**Called by:**
- `async (anonymous)` (5)

**Calls:**
- `async countTraps` (5)

### `castBuiltInAttribute`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelJsonRow.ts:309` | Self: 0.0% (0us) | Total: 0.3% (2.9ms) | Samples: 0

**Called by:**
- `castAttributeFromTarget` (2)

**Calls:**
- `castMetadata` (2)

### `bun:sql`
`bun:sql:2` | Self: 0.0% (0us) | Total: 0.7% (6.1ms) | Samples: 0

**Called by:**
- `(module)` (1)

**Calls:**
- `anonymous` (1)

### `connect`
`internal:sql/sqlite:290` | Self: 0.0% (0us) | Total: 29.4% (249.1ms) | Samples: 0

**Called by:**
- `queryFromPoolHandler` (163)

**Calls:**
- `bound onQueryConnected` (163)

### `async get`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/Builder.ts:2166` | Self: 0.0% (0us) | Total: 0.5% (4.8ms) | Samples: 0

**Called by:**
- `async get` (3)

**Calls:**
- `toSql` (3)

### `wrap`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/grammars/SQLiteGrammar.ts:13` | Self: 0.0% (0us) | Total: 0.1% (1.6ms) | Samples: 0

**Called by:**
- `compileSelectSql` (1)

**Calls:**
- `unwrapIdentifier` (1)

### `wrapTable`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/Builder.ts:1895` | Self: 0.0% (0us) | Total: 0.1% (1.6ms) | Samples: 0

**Called by:**
- `compileSelectSql` (1)

**Calls:**
- `split` (1)

### `(module)`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/connection/Connection.ts:1` | Self: 0.0% (0us) | Total: 0.7% (6.1ms) | Samples: 0

**Calls:**
- `bun:sql` (1)

### `(anonymous)`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:74` | Self: 0.0% (0us) | Total: 0.1% (1.2ms) | Samples: 0

**Called by:**
- `(module)` (1)

**Calls:**
- `Connection` (1)

### `async (anonymous)`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:127` | Self: 0.0% (0us) | Total: 0.2% (1.7ms) | Samples: 0

**Calls:**
- `toJSON` (1)

### `performProxyObjectGet`
`[native code]` | Self: 0.0% (0us) | Total: 0.1% (1.6ms) | Samples: 0

**Called by:**
- `toJSON` (1)

**Calls:**
- `(anonymous)` (1)

### `async countTraps`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts:60` | Self: 0.0% (0us) | Total: 0.9% (8.2ms) | Samples: 0

**Called by:**
- `async countTraps` (5)

**Calls:**
- `toJSON` (5)

### `queryFromPoolHandler`
`bun:sql:49` | Self: 0.0% (0us) | Total: 29.4% (249.1ms) | Samples: 0

**Called by:**
- `async #runAsync` (163)

**Calls:**
- `connect` (163)

### `node:assert/strict`
`node:assert/strict:3` | Self: 0.0% (0us) | Total: 0.1% (1.5ms) | Samples: 0

**Calls:**
- `anonymous` (1)

### `SQLResultArray`
`internal:sql/shared:29` | Self: 0.0% (0us) | Total: 0.5% (4.9ms) | Samples: 0

**Called by:**
- `run` (3)

**Calls:**
- `(anonymous)` (2)
- `Array` (1)

### `async #runAsync`
`internal:sql/query:80` | Self: 0.0% (0us) | Total: 29.4% (249.1ms) | Samples: 0

**Calls:**
- `queryFromPoolHandler` (163)

### `getCastDefinition`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts:616` | Self: 0.0% (0us) | Total: 1.1% (9.3ms) | Samples: 0

**Called by:**
- `getAttributeFromTarget` (4)
- `castAttributeFromTarget` (2)

**Calls:**
- `assertSupportedStringCast` (6)

### `SQL2`
`bun:sql:20` | Self: 0.0% (0us) | Total: 0.1% (1.2ms) | Samples: 0

**Called by:**
- `(anonymous)` (1)

**Calls:**
- `adapterFromOptions` (1)

### `ModelSerialization`
`[native code]` | Self: 0.0% (0us) | Total: 7.9% (67.0ms) | Samples: 0

**Called by:**
- `ModelRelations` (45)

**Calls:**
- `ModelPersistence` (45)

### `node:crypto`
`node:crypto:2` | Self: 0.0% (0us) | Total: 1.0% (8.7ms) | Samples: 0

**Calls:**
- `anonymous` (2)

### `registerJob`
`/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/queue/Job.ts:76` | Self: 0.0% (0us) | Total: 0.1% (1.2ms) | Samples: 0

**Called by:**
- `(module)` (1)

**Calls:**
- `set` (1)

## Files

| Self% | Self | File |
|------:|-----:|------|
| 70.2% | 593.3ms | `[native code]` |
| 6.7% | 56.6ms | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelSerialization.ts` |
| 6.6% | 56.3ms | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelCore.ts` |
| 6.6% | 55.8ms | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelPersistence.ts` |
| 6.2% | 52.4ms | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelJsonRow.ts` |
| 0.9% | 7.7ms | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/support/Collection.ts` |
| 0.7% | 6.3ms | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/Builder.ts` |
| 0.5% | 4.7ms | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/model/ModelBase.ts` |
| 0.4% | 3.5ms | `internal:sql/shared` |
| 0.3% | 3.1ms | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/tests/profile.ts` |
| 0.2% | 1.7ms | `internal:streams/writable` |
| 0.1% | 1.6ms | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/query/grammars/Grammar.ts` |
| 0.1% | 1.6ms | `/Users/gporto/Desktop/rekkr/orm/tmp/profile-casts-after/src/connection/Connection.ts` |
