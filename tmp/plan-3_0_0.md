# Plan v3.0.0

**Estado:** implementado y verificado localmente; pendiente de revisión y publicación autorizada.
**Evidencia de salida:** [verificación v3](../benchmarks/v3-verification.md),
[guía de migración](../docs/upgrade-3.0.md) e [histórico](../benchmarks/README.md).
**Revisión:** 2026-09-04. **Base funcional:** `v2.5.0` (`683373b`).
**Herramientas y revisión inicial:** commit `9eff217`, verificadas con Bun 1.4.1.

Este documento sustituye las propuestas y addenda anteriores. Los IDs I1–I14 y
N1–N4 mantienen la trazabilidad con la [auditoría local](./auditoria.md); N5 es la
fuga de caché reproducida durante la revisión. El plan ya está versionado en Git,
aunque el resto de `tmp/` siga ignorado. Los resultados viven en
[`benchmarks/`](../benchmarks/README.md).

## 1. Objetivo y límites

**Mejorar el rendimiento del ORM conservando sus capacidades y hacer que tenants,
transacciones y efectos externos respeten un mismo contrato de ejecución.**

La versión mayor permite corregir comportamientos inseguros y cambiar las firmas
que lo necesiten. Cada refactor debe eliminar trabajo medido o cerrar un defecto
concreto, con una regresión que lo demuestre. Las mejoras de rendimiento pueden
avanzar sin esperar a terminar los arreglos de aislamiento.

Se conservan Model/Builder/Connection/Grammar, los tres motores, las transacciones
manuales, relaciones, observers, Proxy, dirty tracking y overrides de modelos.
Se mantienen las APIs válidas salvo las rupturas enumeradas en §7. No se añaden
dependencias de runtime ni se divide el paquete.

**Entra:** aislamiento, ciclo de vida, reservas de jobs, errores confirmados de
la auditoría y optimizaciones pequeñas verificadas contra el histórico.
**Se aplaza:** outbox durable, 2PC, serialización generada, sustitución del Proxy,
hidratación perezosa, `orm doctor:3` y nuevas APIs ajenas a estos objetivos.

## 2. Evidencia y estado de partida (histórico previo a la implementación)

| Evidencia | Qué permite afirmar |
|---|---|
| Auditoría y revisión de DB, ModelCore, Schema, Connection | Hay decisiones de conexión duplicadas; instancias y builders vinculados también deben entrar en el arreglo |
| [Matriz tenant × transacción](../tests/tenant-transaction-matrix.test.ts) | Está escrita parcialmente y sigue sin seguimiento Git; PostgreSQL necesita `POSTGRES_TEST_URL`. El caso qualify ya exige enrutamiento correcto, no rechazo |
| Repro de N5 con dos bases SQLite y MemoryCacheStore | `acme` y `globex` usando `remember("widgets")` reciben ambos las filas de `acme` |
| [Tests de casts](../tests/casts.test.ts) y [JSON](../tests/query-json-fast-path.test.ts) | Exigen mutaciones de casts estáticos, aislamiento de mapas por instancia, hooks y semántica de valores mutables |
| 61 tests seleccionados y typecheck en la revisión | Esas rutas y el registro de benchmarks pasan; no equivale a una ejecución completa de integraciones |
| Tres registros de benchmarks guardados | Existe una referencia reproducible de SQLite/JSON; todavía no se ha optimizado src/ |

N3 (fallo al restaurar search_path) sigue siendo un hallazgo por lectura:
necesita inyección de fallo. Los porcentajes de cobertura y los perfiles cortos
de la auditoría son evidencia histórica, no criterios actuales de aceptación.

## 3. Trabajo de la versión

### 3.1 R1 + R2 + N5 — Conexión efectiva, tablas y caché

**Corrige:** I1, N1, N2 y N5. **Dependencia de entrega:** R3 para mantener dispatch.
**Puntos de entrada:** [DB](../src/query/DB.ts), [ModelCore](../src/model/ModelCore.ts),
[Builder](../src/query/Builder.ts), [Schema](../src/schema/Schema.ts) y
[Connection](../src/connection/Connection.ts).

Centralizar la resolución y validación del contexto efectivo. Reutilizar los dos
AsyncLocalStorage actuales inicialmente; no hace falta sustituirlos para tener
una única política. Resolver por operación o scope, nunca por atributo/fila.

La política alcanza DB, Schema, Model estático y de instancia, Builder,
relaciones y motores de búsqueda. Debe distinguir el recurso lógico, la sesión
reservada, el tenant y la transacción; compartir un pool no demuestra compartir
una transacción. Los objetos creados antes del scope no pueden esquivarla.

| Operación | Contrato propuesto |
|---|---|
| Entrar en tenant sin transacción | Conservar las cuatro estrategias actuales |
| Abrir transacción dentro de tenant | Usar la conexión efectiva del tenant; todas las operaciones participantes revierten juntas |
| Reentrar en el mismo tenant y recurso durante su transacción | Reutilizar el scope; no abrir otra sesión/transacción |
| Cambiar tenant dentro de transacción | Rechazar antes de ejecutar SQL, salvo la excepción qualify siguiente |
| Cambiar esquema con schema + qualify | Admitir sólo sobre la misma sesión y transacción, sin cambiar estado RLS/search_path; probar COMMIT y ROLLBACK |
| Salir de tenant a landlord con transacción activa | Rechazar; los efectos externos usan R3 |
| Usar un modelo/builder previamente vinculado | Participar en la transacción compatible o lanzar por conflicto; nunca escribir fuera silenciosamente |
| Usar conexión explícita incompatible | Nombrar ambos contextos en el error; no sustituirla ni prometer atomicidad entre bases |

**Cualificación:** aplicar el esquema efectivo a tablas físicas de FROM, JOIN y
escrituras. Preservar tablas ya cualificadas, alias, subconsultas y nombres de CTE.
`qualifyTable("widgets as w")` hoy no es válido: una llamada indiscriminada en el
constructor del Builder no cubre el problema. Revisar también joins compilados
al añadirlos y vistas de `withSchema()` que omiten la sesión reservada.

Si una tabla requiere esquema de tenant y éste no es resoluble, lanzar. No
reescribir SQL arbitrario: las rutas raw usan la conexión efectiva, pero bajo
qualify sus tablas se cualifican explícitamente por el consumidor. Documentar
este límite para no prometer aislamiento automático del texto SQL.

**Caché de consultas:** derivar claves y tags del mismo contexto efectivo,
incluyendo tenant y recurso/esquema lógico. El namespace debe ser estable entre
procesos; una identidad de objeto o sesión no sirve para Redis compartido.
Aplicar la misma derivación en lectura, escritura e invalidación, cubriendo filas,
gráficos eager y `rawJson()`. Definir el acceso explícito al namespace global sin
cambiar silenciosamente toda la API de caché genérica. Mantener la exclusión de
caché dentro de transacciones y comprobar el aislamiento de IdentityMap.

**Aceptación:** filas y lecturas en el destino correcto; rollback comprobado
desde fuera; misma clave/tag sin cruces entre tenants; modelos/builders anteriores
al scope; alias, JOIN, CTE, relaciones y conexiones explícitas.

### 3.2 R3 — Efectos externos después del commit

**Corrige:** I3 y la dependencia de `asLandlord()` en `Job.dispatch()`/`Queue.push()`.

Implementar `afterCommit(cb)` sobre el estado transaccional real, también para
`beginTransaction()/commit()/rollback()`. Sin transacción, ejecutar inmediatamente.
Con transacción, ejecutar después del COMMIT raíz confirmado y fuera de su
contexto activo. No basta con salir del callback de `driver.begin()`.

- Liberar un savepoint incorpora sus callbacks al padre; revertirlo los descarta.
  Un rollback raíz o un fallo de COMMIT descarta todos los efectos pendientes.
- Capturar payload, destino y tenant al registrar el efecto. No conservar un
  modelo mutable esperando que siga representando el mismo evento al ejecutarlo.
- Mantener dentro de la escritura los hooks de validación/transformación. Desviar
  explícitamente los efectos de search/queue; no retrasar todos los observers.
- Un fallo posterior a COMMIT debe distinguirse de un fallo de transacción: no
  intentar rollback ni inducir al consumidor a repetir una escritura confirmada.
  No perder silenciosamente los demás callbacks; definir y probar su orden y errores.

Esto no garantiza entrega tras caída del proceso. **Outbox queda fuera de 3.0.0**:
cuando se implemente necesitará escritura atómica en la misma base/transacción,
reintentos e idempotencia. `afterCommit` no debe anunciar esas garantías.

**Aceptación:** search y queue no ven efectos revertidos; payload conserva tenant;
savepoints y API manual se comportan igual; un error tras commit deja explícito
que los datos ya están confirmados. R1/R2/R3 se pueden desarrollar en cambios
pequeños, pero su integración no puede romper el dispatch existente.

### 3.3 R5 + R6 — Ciclo de vida y TTL de pools

**Corrige:** I4 e I6. Reutilizar el single-flight y la generación de cierre de
[ConnectionManager](../src/connection/ConnectionManager.ts) y coordinarlo con
[OrmConfig](../src/config/OrmConfig.ts).

`configureOrm()` configura una vez; `reconfigureOrm()` es asíncrono y explícito.
Al reconfigurar: validar la nueva configuración, impedir nuevas entradas al
estado retirado, esperar trabajo activo, cerrar recursos propios y limpiar
subsistemas omitidos antes de instalar el nuevo estado. Un fallo deja un estado
explícito y recuperable, nunca una mezcla de configuraciones. No cerrar recursos
prestados al ORM sin un contrato de ownership que lo autorice.

`setTenantResolver()` debe participar en este ciclo: invalidar resoluciones en
vuelo y retirar pools anteriores de forma esperable. Si requiere esperar cierres,
su API debe devolver una promesa y documentarse como ruptura.

El TTL cuenta inactividad: renovar `lastUsedAt` con el uso y proteger scopes,
queries y transacciones activas con leases/refcount. No cerrar durante trabajo
activo; al terminar, iniciar el periodo de inactividad. Un modelo guardado en
memoria no debe mantener un pool vivo indefinidamente.

Auditar juntos `resolveTenant`, `getResolvedTenant`, `purgeExpiredTenants`,
`closeTenant`, `closeAll` y cambio de resolver. No borrar entradas expiradas
perdiendo la referencia necesaria para cerrar, ni cerrar el pool de otro contexto
por una coincidencia de nombre. Preservar pools compartidos y cierres únicos.

**Aceptación:** accesos que renuevan TTL, operación más larga que el TTL, sweep
concurrente, resolución que termina tras reconfigurar, recursos compartidos,
reconfiguración fallida y ausencia de pools huérfanos o cierres duplicados.

### 3.4 R4 — Reservas de jobs con token y heartbeat

**Corrige:** I5. Cambiar QueueDriver y ambos drivers a una reserva identificada
por un token nuevo en cada adquisición. `complete`, `release`, `fail` y
`heartbeat` deben condicionar atómicamente la mutación a esa reserva vigente.

El token anterior no puede modificar la reserva nueva ni crear un registro falso
de fallo. `heartbeat` extiende el lease sólo si sigue siendo propio; el worker
debe detener su renovación al terminar o perderlo. Mantener validación de payload,
reintentos, jobs desconocidos y manejo de errores del worker.

Migrar la tabla de jobs y el formato Redis conservando trabajos pendientes.
Documentar un cambio coordinado de workers: un worker viejo que muta por id
no puede convivir de forma segura con el protocolo nuevo. El token protege el
estado de la cola; no hace idempotentes los efectos externos de `handle()`.

**Aceptación:** dos workers compiten por el mismo job cruzando expiración;
las cuatro operaciones del dueño viejo no alteran al nuevo; heartbeat correcto,
migración con jobs pendientes y ejecución en database/Redis.

### 3.5 R7 — Fragmentos SQL etiquetados

**Corrige:** I10. `compileRaw()` está en Builder; cambiar sólo `DB.raw()` no lo arregla.

Añadir fragmentos que conserven separados texto y valores hasta la compilación,
usables en `whereRaw`, `selectRaw`, `orderByRaw`, `groupByRaw`, `havingRaw` y
condiciones EXISTS. Componer subconsultas y numerar bindings con la gramática.
Las interpolaciones de valores no se convierten en identificadores ni SQL ejecutable.

Conservar las firmas de string/bindings y documentar su ambigüedad con `?`.
La forma nueva es aditiva; no exigir migrar llamadas que ya funcionan.

**Aceptación:** operadores PostgreSQL `?`, `?|`, `?&`, literales/comentarios con
`?`, fragmentos anidados, orden de bindings, `pretend`/`toSql` y tres gramáticas.

### 3.6 Correcciones relacionadas, con alcance acotado

| Hallazgo | Entregable y verificación |
|---|---|
| I2 — search nativo | Resolver contexto efectivo por operación y respetar destino explícito compatible; dos tenants no comparten resultados |
| N3 — search_path | Si RESET falla o queda transacción abierta, no devolver una sesión contaminada al pool. Verificar la primitiva real de descarte de Bun antes de elegir implementación; prueba de fallo seguida de otro checkout |
| I7 + N4 — batching search | Intercambiar buffers por generación, preservar actualizaciones concurrentes más nuevas, reinsertar fallos y manejar rechazos en todos los flush lanzados sin await |
| I9 — tags Redis | Hacer atómicas asociación/invalidez con Lua y limpiar referencias residuales; carreras set/forgetTag, reemplazo y expiración |
| I11 — policies/SvelteKit | Conservar this con `method.call(policy, ...)`, reasignar el resultado de `attachPolicyMethods()` y hacer opt-in los valores en errores; probar conducta observable |
| I12 — Redis Cluster | Para 3.0 retirar la afirmación de compatibilidad no verificada. Soporte real se abre con un consumidor y tests de Cluster; no basta cambiar un prefijo |
| I13 — stack de desarrollo | Comprobar dependencias/lock actuales y resolver hallazgos vigentes; registrar la verificación, sin dar por actuales los de la auditoría antigua |
| I8 — migraciones MySQL | Documentar límites de atomicidad/rollback de lotes y su recuperación; no simular garantías que el motor no ofrece |
| I14 — caché y CI | Distinguir valor null cacheado de miss manteniendo API pública; establecer la CI de §5 |
| Write-count de Bun | Centralizar lectura de metadata por driver y probarla; distinguir filas cambiadas/coincidentes, sin prometer equivalencia para UPDATE sin cambios |

Si se tipa el resultado de escrituras, preferir una vía aditiva que conserve los
resultados existentes; si se sustituye el retorno público, declarar la ruptura y
su migración antes de implementar. No reemplazarlo silenciosamente por un número.

### 3.7 P1–P3 — Casts, serialización y asignaciones

**Objetivo:** reducir trabajo repetido preservando todos los contratos de modelos.
Este trabajo puede empezar después de establecer la referencia de §4; no depende
de reemplazar el contexto de ejecución.

**P1, primero:** reutilizar `compileCast`, `CompiledCast` y la conversión de
[ModelJsonRow.ts](../src/model/ModelJsonRow.ts). Separar metadata de definición
reutilizable de validación/conversión de valores, que sigue ocurriendo por fila.
Eliminar parseo repetido en `getCastDefinition`/`castBuiltInAttribute` con el menor
cambio medible; no duplicar la lógica con otro sistema de casts.

**P2, condicionado a P1:** compartir metadata interna sólo cuando invalide bien.
Conservar la copia pública de `$mergedCasts`: los tests permiten mutación directa
y exigen aislamiento por instancia. Cachear por identidad de `Model.casts` no
detecta `Model.casts.x = ...`; conservar cambios para instancias nuevas y el
snapshot de las existentes. No introducir un cache global sin límite para
definiciones dinámicas ni retener modelos que ya no se usan.

**P3, sólo si el perfil posterior lo justifica:** reducir el trabajo de construir
visible/hidden y resolver accessors/appends. Cubrir reemplazos, mutaciones de
arrays/objetos, herencia, `makeHidden/Visible`, `append`, `setAppends`,
`mergeAppends` y `withoutAppends`. Evitar comprobaciones de invalidación más caras
que el trabajo ahorrado. RawJsonPlan ya compila por llamada; reutilizar lo
compartible sin aplicar sus restricciones a los modelos completos.

Contratos de aceptación de P1–P3:

- `needsCast` depende del valor de cada fila; no es una lista constante por clase.
- Mantener hooks personalizados y su receiver, custom casts, enums, nulls,
  precisión decimal, fechas, JSON mutable, defaults y selecciones parciales.
- Conservar el momento/alcance de los errores actuales: un cast no seleccionado
  que `rawJson()` hoy omite no debe empezar a lanzar al construir el plan.
- Conservar dirty tracking, invalidación de `$castCache`, relaciones y visibilidad.
  El reset de caché al hidratar también protege constructores personalizados.
- Mantener los descriptores y acceso dinámico del Proxy. Congelar un objeto o
  array compartido no implementa copy-on-write para sus mutaciones internas.
- Equivalencia con la ruta anterior para cada API. `rawJson()` omite capacidades
  deliberadamente y no sustituye `get()`/`json()` en consumidores existentes.

Después de P1, perfilar otra vez. Optimizar una asignación concreta sólo si sigue
costando y puede eliminarse sin cambiar estos contratos. No prometer que toda la
hidratación dejará de costar, ni convertir un perfil de pocas muestras en un techo.

## 4. Rendimiento: protocolo e histórico

La referencia vigente es
[2026-09-04T18-49-28.185Z](../benchmarks/results/2026-09-04T18-49-28.185Z-683373b-4eb6ba5d.json):
Bun 1.4.1, Apple M4, SQLite en memoria, 20.000 filas para esta tabla.

| Ruta completa | Mediana ms | Rango entre ejecuciones ms |
|---|---:|---:|
| Driver nativo + stringify | 9,5146 | 9,5001–9,6896 |
| rawJson() + stringify | 20,7302 | 20,6771–21,0577 |
| get() + toJSON() + stringify | 38,0315 | 37,0658–40,5463 |

Son medianas de tres ejecuciones, cada una con sus propias rondas; los rangos
no son intervalos de confianza ni percentiles por request. La referencia nativa
hace menos trabajo: no convierte casts. Las dos rutas ORM son equivalentes sólo
para el workload cubierto y esa equivalencia se comprueba fuera del cronómetro.

```sh
bun run bench:record
bun run bench:record benchmarks/results/2026-09-04T18-49-28.185Z-683373b-4eb6ba5d.json
```

El comando guarda archivos nuevos, commit/estado local, hashes de código/harness,
runtime/máquina, logs, métricas por ejecución y resumen. El segundo comando añade
comparación. Exige mismo harness, Bun y configuración de máquina; al cambiar
alguno se abre una referencia nueva. Ver [protocolo completo](../benchmarks/README.md).

Para cada optimización:

1. Ejecutar antes/después con condiciones comparables y sin tareas competidoras.
   Mantener los resultados originales; una referencia nueva no borra regresiones.
2. Comprobar tiempos absolutos, factores y dispersión. En los dos primeros
   registros el factor mejoró aunque el modelo tardó 3,4% más, sin cambios de código.
3. Cubrir 1/25/200/20.000 filas y el trabajo real afectado; no ganar sólo en lotes
   grandes a costa de consultas pequeñas. Repetir si el cambio se confunde con ruido.
4. Confirmar con perfil que se eliminó trabajo y no se desplazó. Los 8 accesos
   a getCastDefinition por fila son diagnóstico, no un objetivo de cero hooks.
5. Aceptar la optimización sólo con equivalencia funcional y mejora repetible en
   su workload, sin regresión material sin explicar en los demás.

No se fija todavía un factor 3× ni un porcentaje universal como gate de release.
Un arreglo de aislamiento puede tener coste: medirlo y justificarlo por separado,
sin presentarlo como una optimización. Los `.baseline.txt` usan otro protocolo y
quedan como evidencia histórica, no como denominadores de mejora.

| Cambio que se va a medir | Workload adicional necesario |
|---|---|
| Resolución de conexión/cualificación | Consultas puntuales con tenant y transacción; PostgreSQL/MySQL, versión de servidor y pool |
| Escrituras o write-count | create/save/update/delete y bulk, con/sin observers |
| Casts/serialización | Casts heterogéneos, overrides, columnas parciales y relaciones eager |
| Asignaciones/retención | Memoria y GC en proceso dedicado; el recorder actual no los mide |
| Pools/cola bajo contención | Throughput y latencia p95/p99; tres medianas no sustituyen esa distribución |

Extender el harness sólo al tocar esa ruta. No construir una plataforma de
benchmarks como requisito previo para corregir los primeros defectos.

## 5. Verificación funcional

Cada cambio comienza reproduciendo su defecto o fijando el contrato que puede
romper. Reutilizar tests y helpers actuales; añadir sólo los que falten. Al
integrar el fix, su prueba pasa a formar parte de la suite normal.

| Contrato | Prueba de salida |
|---|---|
| R1/R2/N5 | Matriz landlord/A/B × database/qualify/search_path/RLS × dentro/fuera de transacción, caché y objetos previamente vinculados |
| R3 | Commit/rollback raíz y savepoints, API manual, tenant en payload, error posterior al commit |
| R5/R6 | Expiración controlada, uso en vuelo, sweep/reconfiguración concurrentes, fallo de cierre/resolución |
| R4 | Dueño viejo frente a reserva nueva y heartbeat, en database/Redis, con migración |
| R7 | Fragmentos y bindings de §3.5 en las tres gramáticas y ejecución PostgreSQL |
| Search/Redis/policies/write-count | Fallos y resultados observables descritos en §3.6 |
| P1–P3 | Tests actuales de casts/JSON/Proxy/dirty tracking más el caso que se optimiza |

Comprobar el destino de las filas y el resultado de efectos, no sólo etiquetas de
AsyncLocalStorage. Usar concurrencia con contención e inyección de fallos.
Para expiración, empezar por [setSystemTime() de Bun](https://bun.com/docs/test/dates-times)
y restaurarlo en cleanup; llamar a sweep/reserve explícitamente. Esto no avanza
timers ni relojes externos. Introducir reloj inyectable sólo si aparece una
necesidad que lo anterior no cubra.

**CI:** typecheck y suite de compatibilidad; integraciones con SQLite,
PostgreSQL, MySQL y Redis en los trabajos correspondientes. Un servicio ausente
en un trabajo que debe probarlo falla la preparación; sus skips no dan luz verde.
RLS se prueba en PostgreSQL real, no mediante su aproximación SQLite.

Durante el desarrollo, aislar y enumerar los fallos de aceptación conocidos con
un mecanismo que también detecte cambios inesperados; no usar continue-on-error
global ni ocultar regresiones en una suite permanentemente roja. La release no
admite fallos conocidos en su alcance. Los perfiles/benchmarks se ejecutan aparte
de las pruebas concurrentes para no medir contención del propio CI.

## 6. Secuencia de ejecución

| Paso | Entrega | Condición para terminar |
|---|---|---|
| 0 | Caracterizar suite, versionar la matriz pendiente, CI mínima y reutilizar el histórico | Saber qué falla hoy y tener la regresión del siguiente cambio; no escribir todas las pruebas futuras antes de empezar |
| 1 | R1/R2/N5 + R3, I2 y N3 | Aislamiento extremo a extremo, incluyendo caché y dispatch, con pruebas reales de las estrategias |
| 2 | R5/R6 | Retirar/reconfigurar pools sin cortar operaciones ni perder ownership |
| 3 | R4, I7/N4, I9 y decisión/documentación I12 | Reservas y buffers correctos bajo expiración, contención y fallos |
| 4 | R7, I8, I11, I13, I14 y write-count | Correcciones acotadas, contratos documentados y regresiones verdes |
| P | P1; después P2/P3 sólo con evidencia | Cambios medidos e independientes; puede empezar tras 0 y no espera a 4 |
| 5 | Migración, integración en consumidor y revisión dirigida final | Cumplir todos los criterios de §8 |

El paso 1 contiene cambios que se necesitan mutuamente, no un único diff gigante.
Preparar primero las piezas internas y probarlas; activar el comportamiento
público cuando el conjunto preserve queue/search. Las demás correcciones pueden
adelantarse si no dependen de esa semántica. No ligar su entrega a un refactor de
rendimiento todavía no demostrado.

## 7. Compatibilidad y migración

| Cambio observable | Acción del consumidor |
|---|---|
| Scopes/conexiones incompatibles pasan a lanzar | Reordenar scopes; revisar objetos vinculados y llamadas landlord dentro de transacciones |
| DB.table/JOIN respetan el esquema efectivo | Hacer explícitas las consultas deliberadas a otro esquema/landlord |
| Namespace de caché de consultas aislado | Renovar/invalidar entradas y tags con la nueva política; documentar cómo retirar claves antiguas |
| Search/queue esperan al commit | Actualizar pruebas de timing y manejo de errores de efectos; no reintentar la transacción ya confirmada |
| configureOrm one-shot y cambio de resolver esperable | Usar y esperar reconfigureOrm/API asíncrona en tests, HMR y workers |
| QueueDriver con token/heartbeat | Adaptar drivers, migrar almacenamiento y coordinar cambio de workers |
| Valores de validación opt-in | Habilitarlos explícitamente donde sean necesarios |
| Write-count si se cambia su retorno | Documentar forma y semántica antes/después; preferir extensión compatible |

El TTL corregido alinea comportamiento y documentación. R7 es aditivo. P1–P3
conservan los contratos existentes y no requieren migrar casts, hooks ni acceso
dinámico. Redis Cluster queda descrito como no soportado en vez de prometerlo sin
verificación. Entregable: `docs/upgrade-3.0.md` con ejemplos concretos, además de
CHANGELOG y docs de configuración/transacciones/caché/cola afectadas.

## 8. Criterios de release

No se prepara una publicación hasta que:

1. Todas las pruebas de salida del alcance están verdes, con integraciones reales
   y sin skips que sustituyan estrategias/motores obligatorios.
2. No quedan rutas conocidas que crucen tenants, escapen del rollback o devuelvan
   sesiones contaminadas al pool; se repite la revisión dirigida tras los cambios.
3. Las migraciones y rupturas de §7 están documentadas y verificadas en un
   consumidor real; el orden de despliegue de workers está probado.
4. Cada optimización aceptada tiene evidencia antes/después conservada; se han
   investigado regresiones materiales y no se promete rendimiento de rutas sin medir.
5. Se revalidan los workarounds con la Bun objetivo usando sus repros:
   [event loop MySQL](../.tmp_hacks/bun-mysql-event-loop.md),
   [write-count](../.tmp_hacks/bun-sql-write-count.md) y
   [constructor Collection/Elysia](../.tmp_hacks/elysia-1.4-collection-constructor-name.md).
   No se eliminan sólo por actualizar Bun. Mantener documentación temporal ahí.

Pooling, prepared statements, reserva de sesión y transacción raíz ya se delegan
a Bun. Delegar savepoints sólo donde el driver efectivo exponga el contrato de
TransactionSQL; `!ownsDriver` también incluye conexiones prestadas con BEGIN
manual y no basta para decidirlo. Mantener la API manual y sus garantías.

Cuando se autorice publicar, usar tag y GitHub Release **v3.0.0**, con notas
manuales sobre cambios, compatibilidad y verificación. Este plan no autoriza
commits, tags, releases ni pushes posteriores por sí mismo.

## 9. Resultado de implementación (2026-09-04)

- [x] R1/R2/N5: resolución compartida, conexión explícita validada, cualificación
  tardía de JOIN/CTE, caché e IdentityMap aislados y matriz de regresiones.
- [x] R3: afterCommit raíz/savepoints/API manual, snapshots queue/search y
  AfterCommitError; fallo real de COMMIT descarta efectos.
- [x] R5/R6: leases, TTL de inactividad, ownership, resolver asíncrono,
  reconfigureOrm y pruebas de drenaje/fallo de cierre.
- [x] R4: tokens, heartbeat, migración y rechazo del propietario antiguo en
  SQLite/PostgreSQL/MySQL/Redis; worker se detiene al perder su reserva.
- [x] R7 y §3.6: SQL etiquetado, batching recuperable, Lua atómico, policies,
  validación opt-in, null cacheado, write-count y dependencias auditadas.
- [x] P1: metadata de casts acotada y normalización sin parseo innecesario.
  P2/P3 no se activan: la mejora medida de P1 conserva los mapas públicos y
  no justifica añadir invalidación o cachés de visibilidad.
- [x] CI definida con servicios obligatorios; suite/build/typecheck local,
  migración del consumidor Elysia y repros de los tres workarounds.
- [x] Registros originales conservados, comparaciones antes/después, perfiles,
  memoria dedicada y percentiles de contención. Los costes de aislamiento y
  reservas se declaran separados de la mejora de serialización.

Los resultados exactos y límites están en el informe enlazado arriba. El workflow
remoto aún necesita ejecutarse en GitHub; no se ha hecho push ni publicación.
