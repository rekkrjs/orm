# Plan 3.0.0

**Estado:** propuesta. **Base:** `v2.5.0` (`683373b`). **Fecha:** 2026-09-02.
**Entrada:** [`tmp/auditoria.md`](./auditoria.md), incluida su sección 12 (addendum de verificación).

**Revisión contra código: 2026-09-04**, mismo HEAD `683373b`, con cambios locales
preexistentes y Bun **1.4.1**. Correcciones de diseño incorporadas abajo; el
**Addendum B** recoge los contratos que faltaban y el orden recomendado.
Histórico reproducible: [`benchmarks/README.md`](../benchmarks/README.md).
Este plan está en `tmp/`, ignorado por Git; trasladarlo a `docs/` cuando se adopte.

---

## 1. Decisión

**¿Justifica el trabajo pendiente una 3.0.0?** Sí, con una tesis clara: aislamiento correcto
por construcción. Los arreglos de la auditoría *requieren* romper comportamiento, y eso es
exactamente lo que legitima un major.

El núcleo Model/Builder/Connection/Grammar se conserva. Lo que se revisa es qué parte de la
capa de conexión puede delegarse a `bun:sql` (§2), no con qué sustituirla.

---

## 2. Auditoría de delegación a Bun

Punto de partida: *¿hemos implementado algo que `bun:sql` ya ofrece, que podamos delegar y
borrar?* Superficie de `bun:sql` verificada en runtime con Bun 1.4.0, no sólo en los
tipos de [`node_modules/bun-types/sql.d.ts`](../node_modules/bun-types/sql.d.ts).

### 2.1 Ya está delegado — no hay nada que quitar

| Capacidad | Cómo la usamos hoy |
|---|---|
| Pooling | `new SQL({ max, prepare, bigint })`. `defaultPostgresPoolMax = 10` es sólo un default nuestro |
| Prepared statements | opción `prepare` pasada tal cual al driver |
| Reserva de sesión | `driver.reserve()` / `release()` en `withSearchPath()`, `execute()` y `reserveRootTransaction()` |
| Transacciones con callback | `driver.begin(fn)` en la rama de driver propio de `transaction()` |
| Errores tipados | `SQL.SQLiteError`, `SQL.PostgresError`, `SQL.MySQLError` en `isUniqueConstraintViolation()` |
| Cierre | `driver.close()` |

La capa de conexión **no es una reimplementación de Bun**. Ya se apoya en él en todos
estos puntos.

### 2.2 Duplicado de verdad — un solo caso

**Savepoints.** [`Connection.ts`](../src/connection/Connection.ts) los construye a mano
(`SAVEPOINT orm_trans_N`, `RELEASE SAVEPOINT`, `ROLLBACK TO SAVEPOINT`) con un contador
`savepointId`, en `beginTransaction()`, `commit()`, `rollback()` y en la rama anidada de
`transaction()`.

Bun ya lo ofrece: `TransactionSQL.savepoint(fn)`. **Verificado en Bun 1.4.0** — el commit
del savepoint conservó la fila y el rollback la descartó, exactamente la semántica que
replicamos.

**Matiz del código actual:** la rama `!ownsDriver` también recibe conexiones de
`withSchema()` y `withSearchPath()`, cuyo root se abre con `unsafe("BEGIN")`.
Sólo los descendientes de `driver.begin()` disponen necesariamente de un
`TransactionSQL`. No basta con que el callback esté anidado para usar `.savepoint()`.

**Alcance real del borrado:** delegar la rama anidada sólo cuando el driver efectivo sea
un `TransactionSQL`; mantener el fallback de SQL manual para las otras entradas.
Las ~25 líneas no son un borrado garantizado. El API manual
`beginTransaction()/commit()/rollback()` **no** se puede delegar, porque Bun sólo ofrece
transacciones con callback y no existe primitiva de "abre ahora, commitea después".

### 2.3 Disponible y sin usar

`beginDistributed()`, `commitDistributed()`, `rollbackDistributed()` — dos fases, presentes
en runtime. Corrige una afirmación demasiado fuerte que hice antes: una transacción de
tenant que cruza bases **sí** es expresable. No la convierte en buena idea por defecto
(PostgreSQL ships `max_prepared_transactions = 0`, y una prepared transaction huérfana
retiene locks indefinidamente), pero pasa de "imposible" a "opt-in a considerar" y amplía
el espacio de diseño de **R1**.

### 2.4 Nuestro por necesidad, no por duplicación

Nada de esto se puede delegar porque Bun no lo ofrece, o porque existe precisamente para
compensar a Bun:

- **`keepEventLoopAlive()`** — Bun 1.4.0 deja de sostener el event loop con una query MySQL
  en vuelo y el proceso sale con código 0 mientras la promesa nunca resuelve. Documentado
  con repro y criterio de retirada en [`.tmp_hacks/bun-mysql-event-loop.md`](../.tmp_hacks/bun-mysql-event-loop.md).
- **`assertMysqlUtc()` + reserva para fijar sesión** — Bun no normaliza el time zone de
  sesión, y el pool puede separar el `SET` de la query que depende de él.
- **`runAndGetMysqlInsertId()`** — la metadata de MySQL redondea ids AUTO_INCREMENT grandes.
- **Split de write-count** — MySQL diverge de SQLite/PostgreSQL en `affectedRows`.
  Documentado en [`.tmp_hacks/bun-sql-write-count.md`](../.tmp_hacks/bun-sql-write-count.md),
  con issue upstream abierto. Todavía sin escribir.
- **Errores portables** — mapear los tres errores tipados de Bun a un
  `UniqueConstraintViolationError` común es feature anunciada en el README, no duplicación.
- **API manual de transacción** — ver 2.2. Sostiene el patrón de aislamiento por test
  (`beginTransaction` en `beforeEach`, `rollback` en `afterEach`) documentado en
  [`docs/testing.md`](../docs/testing.md), que la forma con callback no cubre bien.
- Gramáticas, cualificación por esquema, seguridad de identificadores, modo `pretend`,
  logging, tenencia: semántica de ORM sobre la que Bun no tiene opinión.

### 2.5 Conclusión

**Eliminar la capa no está disponible.** El candidato identificado es la rama
anidada de ~25 líneas, con los límites de §2.2; no se asume su borrado completo.
El resto se reparte entre lo que ya delega, lo que compensa defectos de Bun
—tres documentos en `.tmp_hacks/`, dos con issue upstream— y semántica que Bun no cubre.

Hay además una simetría incómoda que conviene nombrar: varios defectos de la auditoría
nacen justo donde peleamos con el pool de Bun. N3 (sesión envenenada devuelta al pool) e I1
en modo `search_path` (sesión reservada y luego ignorada) son ambos consecuencias de
gestionar reservas a mano. La dirección correcta no es *menos* capa sino **una sola**
frontera de resolución de conexión — que es exactamente R1.

**Acciones concretas que salen de esta auditoría:**

| Acción | Dónde |
|---|---|
| Delegar la rama anidada de `transaction()` a `TransactionSQL.savepoint()` | nuevo, entra en R1 |
| Mantener 2PC fuera de 3.0 hasta tener un consumidor y recuperación de transacciones huérfanas | evita ampliar R1 |
| Escribir el split de write-count ya documentado | §5 |
| Revisar los tres hacks contra la Bun del momento antes del tag | fase 7 |

---

## 3. Tesis de la 3.0.0

> **Que el aislamiento entre tenants y entre transacciones sea correcto por construcción,
> y que la hidratación deje de ser el cuello de botella.**

Un major se justifica cuando arreglar bien un defecto obliga a cambiar comportamiento
observable. Aquí ocurre seis veces. No se justifica por reescribir capas que funcionan.

**Criterio de corte:** entra en 3.0.0 lo que (a) corrige una ruptura de aislamiento, o
(b) no puede arreglarse sin romper API. Todo lo demás va a 2.x o a 3.1.

---

## 4. Cambios rompedores

### R1 — Contexto de ejecución unificado y fallo cerrado

**Corrige:** I1, N2 (`asLandlord`). **Tamaño:** L. **Bloquea:** todo lo demás.

Hoy `TenantContext` y `TransactionContext` son dos `AsyncLocalStorage` independientes y la
precedencia `transacción > tenant > global` está duplicada en
[`DB.ts`](../src/query/DB.ts), [`ModelCore.ts`](../src/model/ModelCore.ts) y
[`Schema.ts`](../src/schema/Schema.ts).

- Un único contexto efectivo `{connection, tenantId, strategy}` resuelto en un solo sitio.
- Entrar en un scope de tenant, cambiar de tenant o llamar a `asLandlord()` con una
  transacción abierta **lanza**, con un mensaje que nombra las dos partes en conflicto.
- Excepción: `schema`+`qualify` sobre la misma conexión y misma transacción sí puede
  enrutar, porque ahí la atomicidad es real. Es la única excepción defendible.
- Resolver una sola política no obliga a reemplazar los dos `AsyncLocalStorage`.
  Empezar por centralizar la decisión y la validación; medir antes de cambiar el almacenamiento.
- Incluir conexiones explícitas y modelos/builders creados antes del scope. Una instancia
  hidratada conserva `$connection`; centralizar sólo las tres fachadas deja ese camino fuera.
- Resolver junto a R3 mínimo: `Job.dispatch()` y `Queue.push()` usan `asLandlord()`.
  Endurecerlo aislado rompe el dispatch dentro de una transacción de tenant (incluido RLS).

**Ruptura:** código que hoy anida tenant dentro de transacción deja de compilar su
intención en silencio y pasa a fallar. Es el objetivo, no un efecto colateral.

**Aceptación:** el grupo A de
[`tests/tenant-transaction-matrix.test.ts`](../tests/tenant-transaction-matrix.test.ts)
en verde, con el grupo B intacto.

### R2 — Cualificación de esquema en la frontera de conexión

**Corrige:** N1. **Tamaño:** M.

Hoy sólo [`ModelCore.getQualifiedTable()`](../src/model/ModelCore.ts) aplica el esquema del
tenant; `Builder` nunca llama a `Connection.qualifyTable()`. Medido en PostgreSQL, sin
transacción alguna: en el mismo `DB.tenant("acme")`, `Widget.create()` escribió en el
esquema del tenant y `DB.table("widgets").insert()` escribió en `public`.

- La cualificación baja a `Builder`, resuelta desde la conexión efectiva.
- Aplicarla a tablas físicas de `FROM`, `JOIN` y escrituras; preservar alias,
  subconsultas y nombres de CTE. `qualifyTable("widgets as w")` hoy lanza:
  ponerlo sin más en el constructor no sirve. Los joins hoy se compilan al añadirlos.
- Con `TenantContext` activo en modo `qualify`, una tabla sin cualificar y sin esquema
  resoluble es un error, no un fallback silencioso a `public`.

**Ruptura:** consultas `DB.table()` que hoy leen del landlord bajo tenencia `schema`
cambian de destino. Quien dependiera de ese comportamiento dependía de un defecto.

**Aceptación:** test dedicado que pruebe que `DB.table()` y `Model` aterrizan en el mismo
esquema bajo `qualify`, con y sin transacción. **Todavía no escrito.**

### R3 — Frontera *after commit* y outbox

**Corrige:** I3. **Tamaño:** L.

Los observers salen tras la sentencia, no tras el commit
([`ModelPersistence.ts`](../src/model/ModelPersistence.ts)), así que search y queue observan
estados que luego se revierten.

- `afterCommit(cb)` en el contexto de transacción, con ejecución garantizada tras COMMIT.
- Tabla outbox opcional para los efectos que deben ser durables; el `SearchObserver` y el
  dispatch de jobs pasan por ahí cuando está habilitada.
- Sin transacción activa, `afterCommit` ejecuta inmediatamente.
- Los callbacks de un savepoint se descartan si éste revierte; al liberarlo pasan
  al padre y sólo corren tras el COMMIT raíz. Cubrir también la API manual.
- Un error del callback posterior al COMMIT no debe intentar ROLLBACK ni presentarse
  como fallo de escritura: los datos ya están confirmados. Liberar el contexto de
  transacción antes del dispatch y conservar explícitamente el tenant del payload.
- Mantener síncronos los hooks que validan o transforman la escritura. Separar
  esos hooks de efectos externos; no retrasar todos los observers indiscriminadamente.
- **Entrega mínima:** after-commit correcto. Outbox es una segunda entrega opt-in:
  requiere inserción en la misma transacción/base, reintentos e idempotencia del
  consumidor; no promete ejecución durable sólo por tener `afterCommit`.

**Ruptura:** el momento de indexación y de dispatch cambia. Cualquier test que asuma
indexación síncrona dentro de una transacción se rompe, correctamente.

### R4 — Reserva de jobs con fencing token

**Corrige:** I5. **Tamaño:** M.

[`QueueDriver`](../src/queue/QueueDriver.ts) muta por `id`, así que un worker viejo puede
borrar la reserva de uno nuevo tras expirar el visibility timeout.

- `reserve()` devuelve un token por reserva; `complete`, `release` y `fail` lo exigen y
  aplican la mutación condicionada a él.
- `heartbeat()` para extender el lease de jobs largos.

**Ruptura:** la interfaz `QueueDriver` cambia de firma. Los drivers externos deben adaptarse.
Requiere migración de la tabla de jobs (columna de token).

### R5 — Ciclo de vida explícito de `configureOrm()`

**Corrige:** I6, con el alcance ya corregido en el addendum 12.2. **Tamaño:** M.

- `configureOrm()` pasa a ser one-shot: la segunda llamada lanza.
- `reconfigureOrm()` asíncrono y explícito, que cierra pools por tenant, resolver, cache,
  queue y search **antes** de instalar el estado nuevo, en vez de fusionarlo.
- `setTenantResolver()` cierra los pools que invalida en vez de sólo vaciar el cache.
- Compartir con R6 el control de trabajo en vuelo y generación de resoluciones.
  No cerrar pools bajo callbacks activos ni reinstalar una resolución antigua
  después de cambiar el resolver. Definir el rechazo de nuevas entradas durante cierre.

**Ruptura:** HMR, tests y bootstrap de workers que hoy reconfiguran en caliente deben
migrar a `reconfigureOrm()` y esperar la promesa.

### R6 — TTL por inactividad de verdad

**Corrige:** I4. **Tamaño:** M.

`expiresAt` se fija una vez como `resolvedAt + ttl` y los accesos cacheados no lo renuevan
([`ConnectionManager.ts`](../src/connection/ConnectionManager.ts)), pese a que la
documentación promete inactividad. Un callback de tenant de 60 ms con TTL de 20 ms fue
interrumpido con `Connection closed`.

- `lastUsedAt` renovado en cada resolución cacheada; el TTL cuenta desde ahí.
- Leases con refcount: el sweep nunca cierra un contexto con trabajo en vuelo.

**Ruptura:** los pools por tenant viven más que antes bajo carga sostenida. Es lo que la
documentación ya prometía.

### R7 — Fragmentos SQL con plantilla etiquetada

**Corrige:** I10. **Tamaño:** S.

[`compileRaw()`](../src/query/Builder.ts) reemplaza `?` con una regex y se rompe con los
operadores JSON de PostgreSQL `?`, `?|`, `?&`. Con plantillas `sql` etiquetadas el defecto no
existe por diseño, porque los bindings nunca pasan por el texto del SQL.

**Alcance corregido:** `DB.raw()` llama a `Connection.query()` y no pasa por
`compileRaw()`. El defecto vive en `whereRaw`, `selectRaw`, `orderByRaw`,
`groupByRaw`, `havingRaw` y condiciones `EXISTS` crudas del Builder. La plantilla
debe componer fragmentos y bindings con esos métodos, incluidas subconsultas y
numeración de placeholders. Cambiar sólo `DB.raw()` no corrige I10.

Mantener las firmas existentes mientras se incorpora el fragmento etiquetado;
documentar su ambigüedad en los casos con `?`. La nueva forma puede ser aditiva:
no necesita una ruptura por sí misma.

---

## 5. No rompedores que entran igual

Van en la misma release por cercanía al código tocado, pero no condicionan el major:

- **I7 + N4** — intercambio de buffers por generación en
  [`SearchManager.flushPending()`](../src/search/SearchManager.ts), reinsertando sólo lo que
  falló, **y** `.catch` en los dos `void flushPending()` (líneas 260 y 275). Hoy un error del
  engine ahí es una promesa rechazada sin manejar, que en Bun mata el worker.
- **N3** — si `RESET search_path` falla en
  [`withSearchPath()`](../src/connection/Connection.ts), destruir la sesión en vez de
  devolverla al pool con el `search_path` del tenant puesto.
- **I2** — los engines de búsqueda nativos resuelven contexto efectivo en cada operación en
  vez de capturar `ConnectionManager.getDefault()`.
- **I9** — Lua para asociación e invalidación atómica de tags en Redis.
- **I11** — `method.call(policy, ...)` en `inspect()`; `extendLocalsUser()` reasigna
  `event.locals.user` con el objeto que devuelve `attachPolicyMethods()`; `values` en
  errores de validación pasa a opt-in.
- **I12** — hash tag común en el namespace de la cola, o retirar la afirmación de
  compatibilidad con Redis Cluster. Decidir cuál antes de empezar.
- **I13** — actualizar el stack de desarrollo y regenerar el lock.
- **I8** — documentar la no atomicidad del lote de migraciones en MySQL y dejar de prometer
  rollback completo.
- **I14** — `Cache.remember` representando hit y miss por separado; CI mínimo.

---

## 6. Rendimiento: el trabajo que sí paga

### 6.0 Corrección de una meta anterior

La primera versión de esta sección fijaba como objetivo *"reducir `perRow` de 62 a un dígito
y acercar `getJson_ms` a `rawJson_ms`"*, apoyada en el contador de accesos a propiedad del
benchmark. **Al medirlo, esa meta no se sostiene** y las tres acciones que proponía valen
mucho menos de lo que sugería:

| Componente que memoizar eliminaría | Coste real |
|---|---|
| Spread de `$mergedCasts` por instancia | 35,4 ns/fila — **6,1%** de hidratar |
| Preámbulo de `serialize()` (2 `Set` + `Object.keys`) | 75,8 ns/fila — **8,5%** de `toJSON` |

El contador de accesos no era una medida de tiempo. La sección se reescribe sobre un perfil
de CPU real.

### 6.1 Mediciones históricas: pendientes de nueva línea base

**Corrección respecto a la primera medición.** La tabla anterior de esta sección afirmaba que
`rawJson()` "ya está en el techo" (8,09 ms contra 8,54 ms). Era una comparación inválida:
medía `rawJson()` **sin** serializar contra un techo que **sí** incluía `JSON.stringify`.
`rawJson()` devuelve objetos, no una cadena. Los números archivados fueron:

| Ruta | ms | Factor sobre el techo |
|---|---|---|
| `Connection.query` + `JSON.stringify` (suma de medianas separadas) | 10,07 | 1,00× |
| `rawJson()` + `stringify` | 20,99 | **2,08×** |
| `.get()` + `toJSON()` + `stringify` (**actual**) | 39,79 | **3,95×** |

**Corrección de esta revisión:** sumar medianas de fases separadas no mide la ruta
completa; tampoco `Connection.query()` es el driver crudo. Además, las filas crudas
conservan JSON como texto y booleanos como enteros: producen otra salida. Los
factores también varían con runtime, GC y carga, y tres corridas no acotan el ruido.
El harness ahora mide `driver.unsafe()` + stringify juntos y comprueba equivalencia
entre las dos rutas ORM. Los `.baseline.txt` quedan como historia, no como base de
porcentajes de mejora bajo el protocolo nuevo `sqlite-json-v2`.

Dos observaciones históricas, sin convertirlas en límites teóricos:

- **`rawJson()` es otra implementación medible.** Transforma los datos y no debe
  compararse como si hiciera el mismo trabajo que serializar filas sin casts.
- **La distancia real entre la ruta con modelos y `rawJson()` es 1,9×, no 5×.** El margen
  existe, pero es la mitad de lo que decía la sección.

### 6.2 Dónde se va el tiempo, según el perfil

`bun --cpu-prof` sobre 12 rondas de `.get()` + `toJSON()` (262 muestras). Self time:

| % | Función | Ubicación |
|---|---|---|
| **17,9** | `assertSupportedStringCast` | [`ModelJsonRow.ts:207`](../src/model/ModelJsonRow.ts) |
| 16,0 | `run` | nativo (driver) |
| 12,2 | `all` | nativo (driver) |
| 7,6 | `serialize` | [`ModelSerialization.ts:145`](../src/model/ModelSerialization.ts) |
| **5,3** | `compileCast` | [`ModelJsonRow.ts:215`](../src/model/ModelJsonRow.ts) |
| **4,2** | `normalizeHydratedCastValue` | [`ModelJsonRow.ts:180`](../src/model/ModelJsonRow.ts) |
| 3,1 | constructor de `ModelCore` | [`ModelCore.ts:199`](../src/model/ModelCore.ts) |
| 1,9 | `hydrateModelRow` | [`ModelPersistence.ts:38`](../src/model/ModelPersistence.ts) |

Reparto grueso: **~42% ORM, ~32% driver** (irreducible), resto misceláneo y GC.

**El candidato es `assertSupportedStringCast`: el mayor coste ORM en ese perfil.**
262 muestras sirven para priorizar una hipótesis, no para prometer un porcentaje
de mejora; repetir el perfil con la Bun actual y carga más larga.

```ts
export function assertSupportedStringCast(cast, modelName, attribute) {
  if (typeof cast !== "string") return;
  const type = cast.split(":", 1)[0];        // ← array + substring, en cada llamada
  if (!builtInCasts.has(type)) throw new Error(...);
}
```

Se invoca desde [`ModelCore.ts:624`](../src/model/ModelCore.ts) (`getCastDefinition()`, o sea
**por atributo y por fila**) y desde un bucle en `ModelCore.ts:648`. Comprueba si una
definición de cast está soportada — normalmente repetida entre filas, pero los
estáticos son mutables y `mergeCasts()` admite overrides. Podemos evitar repetir
el parseo de una misma definición sin asumir que toda la clase es inmutable.

`compileCast` tiene la misma forma: reconstruye un objeto `CompiledCast` por valor en
[`ModelJsonRow.ts:295`](../src/model/ModelJsonRow.ts), volviendo a partir la cadena.

### 6.3 Diseño: plan de casts compilado por clase

**P1 — Plan compilado, construido una vez por clase, congelado.**

En el primer uso de una clase de modelo se construye:

```
CastPlan = {
  merged:    Record<string, CastDefinition>   // el merge de implicitDateCasts + ctor.casts
  compiled:  Record<string, CompiledCast>     // compileCast() ya resuelto
  keys:      string[]                         // Object.keys(merged), materializado
  // La necesidad de conversión se comprueba con el valor de cada fila.
}
```

Reutilizar `CompiledCast`, `compileCast()` y `castCompiledAttribute()` que ya están
en `ModelJsonRow.ts`; separar sólo la metadata compartible de las restricciones de
`RawJsonPlan`. Este último se construye por llamada a `rawJson()`, no se cachea por clase.

La validación de **definiciones** (`assertSupportedStringCast`) ocurre **al construir el plan**, no al usarlo.
Un cast no soportado sigue lanzando, con el mismo mensaje, pero en el primer uso de la clase
en vez de en cada fila. Es un cambio de *momento* del error, no de su existencia — y hay que
listarlo en la guía de migración porque un test que espere el throw en el acceso lo verá antes.
También cambia las consultas parciales que omiten casts inválidos, hoy admitidas
por `rawJson()`: conservar esa validación diferida o aprobar explícitamente la ruptura.
La validación de **valores** (enums, JSON, fechas, decimales) sigue siendo por fila.

**P2 — Compartir metadata compilada; diferir `$mergedCasts` compartido.**

Hoy el constructor asigna un objeto nuevo por instancia
([`ModelCore.ts:206`](../src/model/ModelCore.ts)) pese a que `implicitDateCasts()` ya está
memoizado por clase en [`ModelJsonRow.ts:80`](../src/model/ModelJsonRow.ts). La instancia
podría compartir metadata interna, pero **no** referenciar directamente `plan.merged`
sin cambiar contratos: `tests/casts.test.ts` exige que `$mergedCasts` sea distinto por
instancia y permite mutarlo directamente. Un objeto congelado no implementa
copy-on-write al ejecutar `model.$mergedCasts.x = ...`. Conservar esa copia pequeña
en P1; reconsiderarla sólo con una API de mutación explícita y migración aprobada.

**P3 — Plan de serialización por clase.**

`visible`/`hidden` como `Set` precomputados y el mapa de accessors, resueltos por clase.
La instancia usa el plan salvo que tenga overrides.

**Superficie de invalidación** — los métodos conocidos incluyen:

| Método | Invalida |
|---|---|
| `mergeCasts()` | `$casts` → copia de `merged` y `compiled` |
| `makeHidden()` / `makeVisible()` / `...If()` | `$hidden` / `$visible` |
| `append()` / `setAppends()` / `mergeAppends()` / `withoutAppends()` | lista de appends |
| `Model.casts.x = ...`, reemplazo/borrado de casts y herencia | metadata para instancias nuevas |
| Cambios en `accessors`, `attributes`, `hidden`, `visible`, `appends` | plan de serialización |

La comprobación de identidad no detecta mutaciones dentro de objetos/arrays.
`implicitDateCastsCache` compara cinco escalares y no resuelve este problema.
El contrato actual de `casts` cambia las instancias nuevas sin reescribir las ya
creadas. Primer paso mínimo: memoizar el parseo de definiciones primitivas y
conservar las copias/semántica actuales; sólo añadir un plan por clase cuando su
invalidación cubra los tests existentes y su coste mejore las mediciones.

### 6.4 Ganancia esperada y cómo se verifica

El harness registra estos tres hooks durante get/toJSON para este modelo:

```
CASTPLAN phase=get     getCastDefinition=0.00/row  getAttributeFromTarget=0.00/row
CASTPLAN phase=toJSON  getCastDefinition=8.00/row  getAttributeFromTarget=4.00/row
```

**8 llamadas a `getCastDefinition` por fila** de este workload. No significa que no
haya trabajo de casts al hidratar: `hydrateModelRow()` llama directamente a
`normalizeHydratedCastValue()`, fuera de los tres hooks instrumentados; los enums
tienen otra ruta. Ni esos contadores ni el porcentaje de un perfil prueban una
ganancia temporal por sí solos.

**Hipótesis de mejora**, a recalibrar con el protocolo nuevo; no son gates numéricos todavía:

| Métrica | Hoy | Objetivo 3.0.0 |
|---|---|---|
| Parseo/validación repetida de definiciones en ruta estándar | por atributo/fila | fuera del bucle; conservar hooks personalizados |
| `model_factor` sobre el techo | 3,95× | **≤ 3,0×** |
| `rawJson_factor` (control, no debe empeorar) | 2,08× | ≤ 2,2× |

El 3,0× es una aspiración, no una cota demostrada. Aceptar cada optimización por
equivalencia funcional y mejora repetible de latencia, incluyendo lotes pequeños.
No condicionar un arreglo de aislamiento a alcanzar ese número.

**Protocolo de medición.** El harness está presente localmente (sin seguimiento Git al revisar) en
[`tests/benchmark-hydration-plan.test.ts`](../tests/benchmark-hydration-plan.test.ts), con
línea base en
[`tests/benchmark-hydration-plan.baseline.txt`](../tests/benchmark-hydration-plan.baseline.txt).
El histórico nuevo corre con `bun run bench:record` y se describe en
[`benchmarks/README.md`](../benchmarks/README.md).

1. Comparar tiempos absolutos **y** factores en el mismo runtime/máquina/harness.
   Un driver más lento puede mejorar el factor aunque el ORM empeore.
2. `CASTPLAN` es diagnóstico. Cero llamadas no demuestra ni equivalencia ni que
   desapareciera el parseo: éste puede haberse movido. Los overrides de hooks
   están probados en `tests/casts.test.ts` y deben seguir funcionando.
3. Perfil `--cpu-prof` antes y después adjunto al PR, para confirmar que
   `assertSupportedStringCast` desaparece del top y que el coste no se movió a otro sitio.
4. Ambas líneas base se regeneran y se comparan, no se sobrescriben a ciegas.

### 6.5 Lo que no entra

- **Reescribir `serialize()` a un serializador generado con `new Function`.** El perfil no lo
  justifica: `serialize` es 7,6% y ya tiene ruta rápida (`castValueIsReady`). Generar código
  añadiría una superficie de depuración desagradable por menos de lo que dan P1-P3.
- **Tocar la ruta del driver.** Es 32% y es de Bun.
- **Eliminar el Proxy del modelo.** El handler cuesta 3,0× un acceso directo (26,5 vs 8,7 ns),
  pero `serialize()` ya lo esquiva vía `getModelTarget()`. Quitarlo sería un cambio semántico
  grande por una ganancia que el perfil no respalda.

## 7. Estrategia de pruebas (antes de implementar nada)

### 7.1 La cobertura no es el problema

La suite cubre el **90,72% de líneas** y el 75,91% de funciones. Y aun así:

| Defecto | Archivo donde vive | % líneas cubiertas |
|---|---|---|
| I1, N2 | `connection/TenantContext.ts` | **100,00** |
| I4, I6 | `connection/ConnectionManager.ts` | **100,00** |
| N3 | `connection/Connection.ts` | 99,27 |
| I11 | `policies/index.ts` | 97,96 |
| I5 | `queue/DatabaseQueueDriver.ts` | 97,89 |
| I10, N1 | `query/Builder.ts` | 97,88 |
| I7, N4 | `search/SearchManager.ts` | 96,52 |

**Todos los defectos fatales y altos viven en archivos con más del 96% de líneas cubiertas,
y dos de ellos al 100%.** Las líneas se ejecutaban. Lo que faltaba no era cobertura, eran
aserciones sobre la consecuencia. Perseguir un número de cobertura más alto no habría
encontrado ni uno.

### 7.2 Los cuatro huecos, medidos sobre 127 archivos de test

| Hueco | Medida | Qué explica |
|---|---|---|
| **Composición** | 0 archivos cruzan tenant × transacción a propósito (los 5 que mencionan ambos son coincidencia de vocabulario) | I1, N2 |
| **Tiempo** | **0** archivos manipulan el reloj: ni `setSystemTime`, ni reloj inyectable. Sólo `sleep()` real | I4, I5 — los dos son defectos de expiración |
| **Fallos** | **3 de 127** inyectan un fallo | I7, N3, N4 |
| **Etiqueta en vez de resultado** | 14 aserciones sobre `TenantContext.current()`, 67 sobre `$`-internos del modelo | I1, N1, I4 |

El cuarto hueco es el más caro y el que hay que nombrar bien. Los tests de tenencia
afirmaban `expect(TenantContext.current()?.tenantId).toBe("acme")` — **la etiqueta del
contexto** — y nunca *dónde acabó la fila*. Los de TTL afirmaban
`expect(ctx.expiresAt).toBeGreaterThanOrEqual(before + 5_000)` — **la aritmética del cálculo**
— y nunca que un acceso cacheado renovara la expiración, que es lo que la documentación
promete y el código no hace.

Un test que afirma sobre el estado interno que el código acaba de escribir es una tautología
cara: sólo puede fallar si el código se contradice a sí mismo dentro de la misma línea.

### 7.3 Las cinco disciplinas

Cada una nombrada por el defecto que habría cazado, para que no sea doctrina genérica:

**D1 — Matriz de composición.** Cada par de subsistemas que comparte contexto ambiente se
prueba cruzado, no por separado: tenant × transacción × estrategia (hecho, en
[`tests/tenant-transaction-matrix.test.ts`](../tests/tenant-transaction-matrix.test.ts)),
search × transacción, queue × transacción, tenant × queue, tenant × search.
→ *Habría cazado I1, N2, I3.*

**D2 — Control del tiempo.** Usar primero `bun:test.setSystemTime()` y restaurarlo
en cleanup: `ConnectionManager` y ambos drivers de cola ya consultan `Date.now()`.
Invocar el sweep/reserve explícitamente tras avanzar el reloj; esto no pretende
avanzar timers ni el reloj de un servidor externo. No hace falta introducir un
reloj de producción para probar el TTL de 300 s.
[Documentación de Bun](https://bun.com/docs/test/dates-times).
→ *Habría cazado I4, I5.*

**D3 — Inyección de fallos.** Para cada efecto externo —engine de búsqueda, Redis, driver,
`RESET search_path`— un test donde la operación falla **después** de aceptar la llamada, y
una aserción sobre en qué estado queda el sistema.
→ *Habría cazado I7, N3, N4.*

**D4 — Equivalencia de rutas.** Cuando dos APIs públicas deben dar el mismo resultado, se
afirma que lo dan. `DB.table("x")` y `Model` bajo el mismo scope de tenant deben aterrizar en
la misma tabla; `get()` y `rawJson()` deben producir el mismo JSON (esto último ya se hace en
`benchmark-pipeline.test.ts`, y es el mejor test de la suite en este eje).
→ *Habría cazado N1.*

**D5 — Concurrencia con contención.** No `Promise.all` sobre trabajo independiente, sino dos
actores peleando por el mismo recurso: dos workers cruzando la expiración del mismo lease,
dos requests durante un sweep, `set()` y `forgetTag()` concurrentes.
→ *Habría cazado I5, I9.*

### 7.4 Infraestructura previa

Preparar sólo lo que cada cambio necesita, reutilizando los tests y helpers actuales:

| Pieza | Para qué | Tamaño |
|---|---|---|
| `setSystemTime()` + cleanup; sweep/reserve explícitos | D2 | S |
| Helpers de fallo: engine que lanza, conexión que muere, `RESET` que falla | D3 | S |
| Helper `whereDidTheRowLand(connections, table)` | D1, D4 | S |
| Helper de dos workers con lease compartido | D5 | S |
| **CI que ejecute todo esto** — hoy no existe `.github/workflows` | todas | S |

El CI es el que convierte lo demás en algo real. Sin él, la matriz roja es un archivo que
alguien recuerda ejecutar.

### 7.5 Criterio de entrada por cambio

Ningún cambio rompedor se empieza antes de que sus pruebas existan **y fallen**:

| Cambio | Pruebas exigidas antes de implementar | Estado |
|---|---|---|
| **R1** contexto unificado | D1 matriz completa, incluyendo objetos previamente vinculados y motores reales | **Grupo A parcial escrito; ampliar** |
| **R2** cualificación en Builder | D4 equivalencia `DB.table` ↔ `Model` bajo `qualify`, con y sin transacción | **Falta** |
| **R1/R2 caché** | Dos tenants con la misma clave de `remember`, gráficos eager e invalidación por tags | **Repro manual confirmado; falta regresión** |
| **R3** after-commit / outbox | D1 search × transacción y queue × transacción, con rollback; D3 fallo tras commit | Falta |
| **R4** fencing token | D5 dos workers cruzando la expiración; D2 salto de reloj | Falta |
| **R5** ciclo de vida | D3 reconfiguración con pools abiertos; aserción de que se cerraron | Falta |
| **R6** TTL por inactividad | D2 acceso cacheado que renueva; sweep con trabajo en vuelo | Falta |
| **R7** fragmentos etiquetados | D4 equivalencia en métodos `*Raw`; `?`, `?|`, `?&` y bindings de subconsultas | Falta |
| **§6** plan de casts | Harness `CASTPLAN` + `CEILING` | **Escrito y con línea base** |

### 7.6 Puerta de salida

La fase 0 establece una base ejecutable; cada cambio añade su regresión antes del fix:

1. Existe CI ejecutando suite, matriz e integraciones contra los tres motores.
2. Existe un registro de benchmarks reproducible y la suite actual está caracterizada.
3. Las pruebas del **siguiente cambio** están escritas y reproducen el problema;
   las demás filas se completan junto a su implementación, sin bloquear todas las fases.
4. La suite distingue *rojo por diseño* de *rojo por regresión*: los tests de aceptación
   viven en archivos marcados y el CI los reporta aparte, para que un fallo nuevo se vea.

El punto 4 importa más de lo que parece. Hoy `bun run test` termina en 1650 pass / 8 fail y
esos 8 son intencionados; sin separarlos, el siguiente fallo real se pierde en el ruido.

---

## 8. Fases

| Fase | Contenido | Por qué en este orden |
|---|---|---|
| 0 | CI/base funcional caracterizada + histórico de benchmarks + regresión del siguiente cambio | Evitar una fase de infraestructura que retrase todos los fixes |
| 1 | **R1 + R2 + R3 mínimo** (after-commit para dispatch), N3 | Política efectiva, tablas y efectos forman un contrato conjunto; no romper queue al endurecer asLandlord |
| 2 | **I2** engines con contexto efectivo | Aplicar la misma política al resto de fronteras |
| 3 | **R5** ciclo de vida, **R6** TTL | Estabilizan el estado global antes de tocar efectos externos |
| 4 | **R4** fencing token, I7+N4; outbox en una entrega separada si se confirma su necesidad | Aislar el coste y las garantías de durabilidad |
| 5 | **R7** fragmentos SQL, I9, I11, I12, I13, I14 | Cambios independientes con sus regresiones |
| 6 | Casts/serialización (§6), medidos por cambios pequeños | Puede adelantarse tras fase 0: no depende de rediseñar el contexto; P2/C1 siguen condicionados a compatibilidad |
| 7 | Guía de migración, CHANGELOG, segunda ronda dirigida de la auditoría (§11 del informe) | |

---

## 9. Migración 2.5 → 3.0

Lo que un consumidor tiene que hacer:

1. **Auditar `DB.tenant()` dentro de `DB.transaction()`.** Pasa a lanzar. Es el cambio con
   más probabilidad de aparecer en producción.
2. **Auditar `DB.table()` bajo tenencia `schema`.** Cambia de destino: pasa a respetar el
   esquema del tenant. Revisar si alguna consulta dependía de leer el landlord.
3. **Reemplazar reconfiguraciones de `configureOrm()`** por `await reconfigureOrm()`.
4. **Adaptar drivers de cola propios** a la firma con token, y correr la migración de la
   tabla de jobs.
5. **Revisar tests que asuman indexación síncrona** dentro de transacciones.
6. **Migrar fragmentos `*Raw()` ambiguos** a la plantilla etiquetada de R7.
7. **Revisar tests que esperen un cast no soportado al acceder al atributo.** Con el plan
   compilado (§6.3, P1) el error se lanza en el primer uso de la clase, no por fila. Mismo
   mensaje, momento distinto.

Entregable: `docs/upgrade-3.0.md` con un ejemplo antes/después por punto.
Dejar `orm doctor:3` fuera salvo demanda concreta: una búsqueda textual no demuestra
el contexto asíncrono de una consulta.

---

## 10. Fuera de alcance, explícitamente

- **Sustituir el núcleo por un query builder de terceros.** El núcleo
  Model/Builder/Connection/Grammar se conserva; §2 sólo audita qué delegar a `bun:sql`.
- **Dividir el paquete** (opción B de la auditoría). Los subpath exports ya reducen el
  acoplamiento; separar ahora añade versionado y coordinación sin resolver ninguno de los
  seis defectos. Reconsiderar cuando search o queue tengan cadencia propia.
- **Añadir dependencias de runtime.** `"dependencies": {}` se mantiene.
- **Nuevas APIs estilo Laravel** hasta que el grupo A esté en verde. Es literalmente la
  conclusión de la sección 9 del informe.
- **Rediseñar la hidratación.** §6.4 se detiene en `model_factor ≤ 3,0×` a propósito. El
  alcance, el techo medido (~16% de la ruta completa en el caso imposible) y las condiciones
  para abrirlo están en el **Addendum A**.

---

## 11. Riesgos y condiciones de "no ship"

| Riesgo | Mitigación |
|---|---|
| R1 rompe consumidores en sitios que no anticipamos | Publicar 3.0.0-rc y correr la matriz contra una app real antes del tag |
| El outbox añade latencia de escritura perceptible | Opt-in; `afterCommit` sin outbox como escalón intermedio |
| La optimización de hidratación introduce regresiones sutiles de casts | Fase 6 va después de que la semántica esté fija, con el benchmark como guardia |
| MySQL (I8) sigue sin lote atómico tras la 3.0.0 | No es arreglable en el ORM. Documentar y dejar de prometerlo es el entregable |

| La suite vuelve a dar falsa confianza | §7. La cobertura ya era del 90,72% cuando se colaron los seis defectos; el gate es 7.5/7.6, no un porcentaje |

**No se publica 3.0.0 si:** queda algún caso del grupo A en rojo, alguna fila de 7.5 sigue
sin su test, no existe CI que lo ejecute, o el CI no separa el rojo intencionado del rojo por
regresión (7.6, punto 4). Todo eso es barato, y es exactamente lo que faltó para que 1.644
tests en verde y un 90,72% de cobertura no detectaran dos rupturas de aislamiento.

---

# Addendum A — Rediseño de la hidratación (fuera de 3.0.0)

**Estado:** exploración, no compromiso. **Fecha:** 2026-09-02.
**Nota de revisión (2026-09-04):** los tiempos y techos de este addendum son
estimaciones históricas, no límites demostrados. C1 no es de riesgo bajo tal como
está descrito: `$relations`, `$castCache` y las listas de visibilidad sí participan
en lecturas/serialización; un `push()` o una mutación de objeto anidado no atraviesa
el `set` del Proxy del modelo. C3 tampoco evita el trap mientras se siga devolviendo
un Proxy. C1-C3 requieren nueva medición y conservar los contratos de mutación.
**Motivo:** §6.4 fija `model_factor ≤ 3,0×` y dice que *"prometer más exigiría rediseñar la
hidratación, y eso no está en esta versión"*. Este addendum documenta qué es ese rediseño,
qué vale y bajo qué condiciones valdría la pena, para que la frase no quede como una excusa
sin respaldo.

## A.1 Por qué queda fuera de 3.0.0

Tres razones, por orden de peso:

1. **El trabajo de §6 cambia el perfil.** Todo el coste de casts está en la serialización
   (`getCastDefinition=8,00/fila` en `toJSON`, `0,00` en `get`). Medir la hidratación para
   rediseñarla antes de quitar ese ruido es medir otra cosa.
2. **La superficie semántica es incomparablemente mayor.** §6 memoiza cómputo constante y no
   cambia qué observa el usuario, salvo el momento de un error. Lo de aquí toca identidad de
   objetos, dirty tracking y acceso dinámico a atributos: el corazón de la API Eloquent.
3. **El techo es modesto.** Ver A.3. No justifica añadir riesgo a una versión que ya rompe
   siete cosas por motivos de aislamiento.

## A.2 Dónde se va la hidratación

Perfil `--cpu-prof` de 25 rondas de `.get()` sobre 20.000 filas, **sin** `toJSON` (200 muestras):

| % | Función |
|---|---|
| 44,0 | `all` — nativo, driver |
| **9,0** | `copyDataProperties` — nativo |
| 9,0 | `normalizeHydratedCastValue` |
| 6,0 | `hydrateModelRow` |
| 6,0 | constructor de `ModelCore` |
| **5,0** | `cloneObject` — nativo |
| 3,0 | `run` — nativo, driver |
| 1,5 | `Proxy` |

Reparto: **~47% driver (irreducible), ~43% ORM.**

Copiar objetos (`copyDataProperties` + `cloneObject`) es **14%**, el mayor coste ORM de la
hidratación — por encima de la normalización de casts.

Desglosado por asignación, midiendo cada copia por separado:

| Asignación por fila | ns | Nota |
|---|---|---|
| Inicializadores de campo de clase (6 objetos: `$casts`, `$relations`, `$castCache`, `$hidden`, `$visible`, `$appends`) | **71,2** | El mayor, y ninguno se usa en una consulta de sólo lectura |
| Copia de `$attributes` | 30,6 | |
| `new Proxy` | 27,9 | |
| Copia de `$original` | 14,0 | Sólo existe para dirty tracking |
| **Total** | **143,7** | **25% de los 577 ns/fila de hidratación** |

El dato que no esperaba: **seis objetos vacíos cuestan más que copiar la fila dos veces.**

## A.3 El techo del rediseño

Honestidad sobre el tamaño del premio, para no repetir el error de la §6 original:

- La hidratación son ~15,2 ms de los 39,8 ms de la ruta con modelos.
- De esos 15,2 ms, ~43% es ORM: **~6,5 ms**.
- Eliminar *toda* la hidratación ORM —imposible, es el límite teórico— recortaría **~16%**
  de la ruta completa.

Un rediseño realista captura la mitad de eso. **No es una vía a `rawJson()`**: `rawJson()`
cuesta 2,08× porque no construye modelos en absoluto, y esa diferencia no se cierra
optimizando la construcción de modelos.

## A.4 Candidatos, por relación valor/riesgo

### C1 — Campos de clase perezosos · 71,2 ns/fila · riesgo bajo

Los seis objetos se asignan en todas las instancias y no se tocan en una consulta de sólo
lectura. Alternativa: constantes vacías congeladas compartidas, materializadas en la
instancia al primer escribir (copy-on-write), igual que el plan de casts de §6.3.

Riesgo: código que mute `model.$hidden.push(...)` directamente en vez de por `makeHidden()`.
Es estado con prefijo `$` y el `set` del proxy ya lo enruta por `Reflect.set`, así que la
frontera es controlable, pero hay que auditar la superficie pública primero.

**Mejor candidato: el más barato de los cuatro y el de menor alcance semántico.**

### C2 — `$original` perezoso · 14,0 ns/fila · riesgo medio

`$original` sólo sirve para dirty tracking. En una consulta de sólo lectura no se lee jamás.
Copiar al primer `setAttribute`, tomando el valor previo de `$attributes`, que sigue ahí.

Riesgo: `getDirty()`, `isDirty()`, `wasChanged()`, `$dirtyKeys` y los observers dependen de
la instantánea. Cualquier ruta que lea `$original` sin pasar por un setter tiene que
materializarlo. Barato de implementar, caro de verificar.

### C3 — Estrechar el Proxy · 27,9 ns/fila + 3,0× por acceso · riesgo alto

Medido: el handler cuesta 26,5 ns por acceso contra 8,7 directo. `serialize()` ya lo esquiva
vía `getModelTarget()`, así que la ganancia está en el código de usuario, no en el benchmark.

La forma no destructiva sería definir accessors reales por clase con `Object.defineProperty`
en la primera hidratación —una "forma compilada"— y reservar el proxy para claves dinámicas.
Conserva la API y da al motor una forma estable para sus inline caches.

Riesgo alto: cambia identidad de propiedades, `Object.keys`, `in`, spread y serialización de
terceros. Necesitaría su propia matriz de pruebas.

### C4 — Hidratación perezosa · riesgo muy alto · **no recomendado**

Devolver envoltorios finos y construir el modelo al primer acceso. Convierte una `Collection`
en algo cuyo coste depende de qué mira el consumidor. Rompe el modelo mental, complica los
observers y hace impredecible el rendimiento. Se documenta para descartarlo explícitamente.

## A.5 Condiciones para dar luz verde

No se abre este trabajo hasta que **las cuatro** se cumplan:

1. §6 está medido y validado funcionalmente con el protocolo vigente.
2. Perfil de hidratación **repetido después de §6**, porque el reparto actual incluye ruido
   que §6 elimina.
3. Existe una demanda real: un consumidor con una carga donde la hidratación domine, no una
   corazonada de benchmark.
4. C1 se hace primero y por separado. Si no rinde lo medido, C2 y C3 no se abren.

## A.6 Lo que este addendum no propone

- Tocar la ruta del driver (47% de la hidratación, es de Bun).
- Eliminar el Proxy sin sustituto: la API Eloquent depende de él.
- Prometer un factor concreto. **A.3 acota el techo en ~16% de la ruta completa en el caso
  imposible**; cualquier objetivo se fija tras el perfil de A.5.2, no antes.

## A.7 Objetivo declarado

> Cerrar la mitad del coste ORM de la hidratación (~6,5 ms de 39,8 ms) sin cambiar identidad
> de objetos, dirty tracking ni acceso dinámico a atributos, empezando por C1 y sin abrir C3
> hasta que C1 y C2 estén medidos.

Si esa frase no se puede sostener con números después de C1, el rediseño no se hace, y §6.4
se queda como el alcance final de la ruta con modelos, sin imponer un factor no demostrado.

---

# Addendum B — Aportaciones de la revisión contra código

**Fecha:** 2026-09-04. **Alcance:** revisión y herramientas de medida; no se ha
implementado aquí la migración del runtime a 3.0.

## B.1 Prioridad nueva: aislar también la caché de consultas

**Reproducido con dos bases SQLite y `MemoryCacheStore`:** tenant `acme` consulta
`DB.table("widgets").remember("widgets").get()`; después `globex` repite la consulta.
La segunda recibe `acme`, aunque su propia base contiene `globex`:

```json
{"acme":["acme"],"globex":["acme"]}
```

`Builder.get()` usa `this.cacheKey` directamente en `Cache.get/set`, y
`Cache.prefixKey()` sólo añade un prefijo global de configuración. No interviene
la identidad del tenant ni de la conexión. Esto no está resuelto por I14 (hit/miss).

Incluir en R1/R2 una clave efectiva de caché de consultas que incorpore el scope
resuelto; aplicar la misma política a tags e invalidaciones. Es una ruptura
observable del namespace cacheado, justificada por aislamiento. Probar también
gráficos eager y `rawJson()`, que pasan por este camino. Las claves globales
deliberadas necesitan un uso explícito fuera de ese scope. No inventar un segundo
resolvedor de tenants sólo para la caché.

## B.2 Contratos que deben cerrar R1–R6

| Contrato | Evidencia en código / prueba necesaria |
|---|---|
| Modelo o Builder creado antes de `DB.transaction()` | `ModelCore.getConnection()` prioriza `$connection`, y Builder conserva `connection`; probar rollback real, no sólo `TransactionContext.current()` |
| Vista de esquema dentro de transacción | `withSchema()` copia `driver` pero no `reservedDriver`/estado transaccional; conservar la sesión efectiva para la excepción qualify |
| Savepoints según origen | `!ownsDriver` incluye root manual y sesión reservada; no equivale a `TransactionSQL` |
| Captura de efectos | `SearchObserver`, `Job.dispatch`, `Queue.push`: guardar payload/tenant antes de salir del scope, descartar callbacks de savepoints revertidos |
| Expiración y reconfiguración | `shutdownGeneration` sólo cambia en `closeAll()`; `setTenantResolver()` limpia caché sin invalidar resoluciones en vuelo |
| TTL y ownership | `getResolvedTenant()` elimina expirados sin cerrar; `closeTenant()` encuentra pools por nombre; auditar todos los caminos y pools compartidos, no sólo el sweep |

La matriz actual no es completa: los casos PostgreSQL dependen de
`POSTGRES_TEST_URL`, el RLS de SQLite es una aproximación y el caso qualify aún
espera rechazo aunque el plan admite una excepción. Alinear primero esa expectativa
y exigir ejecución real del motor en CI; un skip no verifica aislamiento.

## B.3 Refactors que sí priorizaría para rendimiento

1. **Unificar parseo y metadata de casts reutilizando `ModelJsonRow.ts`.** Llevar
   parseo repetido fuera del bucle preservando mapas públicos, hooks y caché de
   valores mutable. Hacer primero el cambio pequeño y medir antes de P2/P3.
2. **Compartir la política de conexión y cualificación**, incluyendo caché y
   objetos ya vinculados. El beneficio principal es corrección; medir luego el
   coste por consulta y las reservas de sesión evitadas.
3. **Eliminar asignaciones sólo donde sean demostrablemente redundantes.** Por
   ejemplo, `hydrateModelRow()` reinicia `$castCache` aunque el constructor ya la
   inicializa, pero existe un test que exige limpiarla si un constructor propio
   la pobló. No borrar ese reset ni compartir objetos vacíos a ciegas.

No extraería clases sólo por número de líneas, no generaría serializadores, ni
quitaría Proxy/dirty tracking. Las copias necesarias para aislar modelos son
funcionalidad. Si tras quitar parseo el perfil señala otro coste, se abre otro
cambio con su evidencia.

## B.4 Histórico entregado y próximos workloads

`bun run bench:record` guarda cada ejecución en `benchmarks/results/` con commit,
estado local, hash del código y del harness, Bun, CPU/OS, logs, tres repeticiones,
mediana y rango. `bun run bench:record <resultado.json>` añade comparación y
rechaza mezclar protocolo/harness/runtime/máquina distintos. Ver
[`benchmarks/README.md`](../benchmarks/README.md).

Dos registros iniciales, **sin cambios en `src/` entre ellos**, Bun 1.4.1:

| Métrica, 20.000 filas | Registro 1 | Registro 2 |
|---|---:|---:|
| Modelo → cadena JSON, mediana ms | 39,4085 | 40,7588 |
| `rawJson()` → cadena JSON, mediana ms | 20,8988 | 21,0828 |
| Driver nativo → cadena JSON, mediana ms | 9,5932 | 10,0097 |
| Factor modelo, mediana | 4,11× | 4,07× |

El modelo tarda **3,4% más** y sin embargo su factor mejora: confirma por qué no
basta el ratio. Son mediciones de ruido/referencia, **no una optimización**.
Los contadores siguen en 8 accesos a `getCastDefinition` por fila al serializar.

Registro 1: [`2026-09-04T18-44-04.600Z`](../benchmarks/results/2026-09-04T18-44-04.600Z-683373b-08b78bde.json).
Registro 2: [`2026-09-04T18-46-16.681Z`](../benchmarks/results/2026-09-04T18-46-16.681Z-683373b-99083cc9.json).

Referencia para futuras comparaciones con el script final:
[`2026-09-04T18-49-28.185Z`](../benchmarks/results/2026-09-04T18-49-28.185Z-683373b-4eb6ba5d.json).
Los dos primeros registros preceden a una corrección de tipos del script; su hash
de harness es distinto, aunque forman una pareja comparable entre sí.

Antes de afirmar rendimiento global, añadir por cada subsistema tocado: escrituras
y bulk, relaciones eager, consultas con tenant/transacción, y PostgreSQL/MySQL con
versión de servidor y configuración de pool. Para optimizaciones de asignación,
medir memoria/GC en un proceso dedicado; para concurrencia, throughput y p95/p99.
No deducir esas propiedades del benchmark SQLite de JSON. Mantener el gate
funcional en CI y posponer umbrales temporales duros hasta caracterizar el ruido.

## B.5 Verificación de esta revisión

- 61 tests pasan: casts, JSON directo, Proxy, appends y parser/resumen del histórico.
- Tres registros completos: tres ejecuciones por suite y por registro, con
  equivalencia de salida comprobada fuera de la región cronometrada.
- Typecheck del proyecto y del script/test nuevos. No se ha vuelto a ejecutar toda la suite ni se han
  revalidado las integraciones PostgreSQL/MySQL/Redis de la auditoría anterior.
- Los cambios previos en `.tmp_hacks/` y la matriz de aceptación se conservaron.
  No se han hecho commits, tags, releases ni pushes.
