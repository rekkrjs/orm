# Redis queues: investigación de throughput

Fecha: 2026-09-04. Código comparado: v2.5.0 (`683373b`) frente a v3 (`654e508`).

**Hay una regresión real, pero el 27,7% del informe anterior exagera la pérdida
sostenida observada en estas nuevas pruebas.** Tres comparaciones largas dan
**−8,1%, −5,7% y −7,7%**. V3 es más lenta en las 18 parejas A/B.

La causa es el trabajo añadido por el protocolo de reserva: almacenar/verificar
el token, transportar más argumentos y recuperar ese nuevo campo al confirmar.
Generar el UUID apenas explica el cambio. El diseño conserva cinco comandos
remotos dependientes por job y transmite el texto completo de cuatro scripts Lua;
esos costes ya existían en v2, pero amplifican el trabajo adicional de v3.

Una prueba de `complete()` resuelto íntegramente en Lua, **conservando la comprobación
del token**, mejora el throughput de v3 entre **16% y 19%** y supera la referencia
v2 del mismo experimento. Los prototipos iniciales se ejecutaron en copias
temporales. **La confirmación atómica ya se ha integrado por petición posterior
del usuario; su validación y alcance están en la sección 8.**

## 1. Qué decía el registro anterior

En el [informe v3](v3-verification.md), los registros
[v2](runtime/2026-09-04T20-14-42.853Z-v2.5.0.json) y
[v3](runtime/2026-09-04T20-14-19.989Z-worktree.json) muestran:

| Mediana entre tres repeticiones | v2 | v3 | Cambio |
|---|---:|---:|---:|
| Reserva + confirmación, jobs/s | 37.423,69 | 27.051,70 | −27,7% |
| Latencia p50, ms | 0,2123 | 0,2416 | +13,8% |
| Latencia p95, ms | 0,2492 | 0,5361 | +115,1% |
| Latencia p99, ms | 0,2598 | 0,6225 | +139,6% |

La caída de throughput era considerable y merecía investigarse: mi explicación
anterior, atribuyéndola al coste de los tokens sin aislarlo, era insuficiente.

El [harness general](../scripts/benchmark-runtime.ts#L12) utiliza **200 jobs,
concurrencia 8 y tres repeticiones**. El camino Redis no tiene un calentamiento
explícito de `reserve/complete`; haber despachado jobs sólo calienta `dispatch`.
Además, se ejecuta después de las cargas SQL, casts y relaciones del mismo proceso.

Los tiempos completos de esas tres repeticiones fueron:

- v2: **7,720 / 5,314 / 5,344 ms**.
- v3: **11,512 / 7,393 / 6,910 ms**.

La comparación central depende de unos **2 ms** de diferencia por lote. Con
200 muestras, el p99 depende de muy pocas observaciones. El throughput usa el
tiempo total, por lo que las colas de latencia pesan más que en el p50; ambos
porcentajes no tienen por qué coincidir.

El registro no recogía GC, calentamiento del camino Redis ni actividad de otros
clientes. No permite atribuir retrospectivamente esos 2 ms a una pausa concreta.
**El dato histórico es válido para esa ráfaga medida; no demuestra una pérdida
sostenida del 27,7%.** Se conserva íntegro, sin sustituirlo por resultados mejores.

## 2. Método de comprobación

Se añadió [benchmark-redis-queue.ts](../scripts/benchmark-redis-queue.ts), que:

- Extrae el driver v2 directamente de `git show 683373b:...`. La referencia v3
  inicial se copió del checkout y ahora está fijada a `654e508` para conservar
  la comparación; `worktree` toma el código actual. No modifica el runtime.
- Arranca Redis temporal dedicado en loopback, sin AOF ni snapshots, y lo detiene
  al terminar. También permite contrastar el servidor configurado en el entorno.
- Ejecuta cada variante en un proceso Bun nuevo, con **2.000 jobs de warmup y
  20.000 medidos**, seis repeticiones y orden invertido en repeticiones alternas.
- Mantiene **un RedisClient y ocho consumidores concurrentes**, como el escenario
  original. Cada consumidor espera reserva y confirmación antes de pedir otro job.
- Precarga jobs sintéticos fuera del cronómetro. No incluye dispatch, ejecución de
  `handle()`, heartbeat ni espera de polling. No es una medida de jobs de negocio.
- Comprueba ids únicos, ausencia de jobs perdidos, confirmaciones correctas y
  listas/conjuntos de reservas vacíos. Las variantes seguras prueban además las
  cuatro operaciones de un dueño antiguo y la adquisición de un nuevo token.
- Guarda versiones, hashes, fuentes exactas de las variantes, tiempos y deltas
  de comandos, CPU y bytes de Redis. No guarda URLs ni credenciales.

Entorno: **Bun 1.4.1 (`4661e494f`), Redis 8.10.1 standalone, Apple M4,
Darwin 24.6.0 arm64**. La instancia dedicada aísla la actividad Redis; el sistema
operativo sigue siendo una máquina de desarrollo, sin un entorno de tiempo real.

Bun agrupa automáticamente comandos concurrentes. Por ello, cinco comandos por
job no implican cinco paquetes de red exclusivos: siguen siendo cinco etapas
que esperan sus respuestas dentro de cada consumidor. [Documentación de Bun](https://bun.com/docs/runtime/redis#command-execution-and-pipelining).

## 3. Resultado sostenido

Medianas entre seis ejecuciones; cada celda de p99 es la mediana de los p99
individuales, no un percentil calculado mezclando todas las muestras.

| Comparación | v2 jobs/s | v3 jobs/s | Throughput v3 | v2 p99 ms | v3 p99 ms |
|---|---:|---:|---:|---:|---:|
| [Redis dedicado, tanda 1](redis/2026-09-04T20-34-45.969Z.json) | 35.197,53 | 32.361,03 | −8,1% | 0,421 | 0,484 |
| [Redis dedicado, tanda 2](redis/2026-09-04T20-38-27.592Z.json) | 35.097,37 | 33.112,52 | −5,7% | 0,503 | 0,486 |
| [Servidor habitual](redis/2026-09-04T20-39-36.506Z.json) | 37.796,51 | 34.897,80 | −7,7% | 0,316 | 0,496 |

Las tres tandas coinciden en la dirección de la regresión; su magnitud varía.
El p99 es más variable que el throughput: no afirmo una regresión universal de
p99 ni que se haya duplicado de forma sostenida. En el servidor habitual no se
registró ningún snapshot durante las ventanas medidas; AOF estaba desactivado.

Como control, se repitieron [ráfagas de 200 jobs sin warmup](redis/2026-09-04T20-38-53.486Z.json)
en 12 parejas y procesos nuevos: v2 **24.905 jobs/s**, v3 **24.334 jobs/s**;
los cambios por pareja van de **−7,2% a +7,9%**. No reproduce exactamente el
harness original —no comparte su historial SQL/GC—, pero muestra por qué esas
ráfagas no deben usarse como estimador de throughput sostenido.

## 4. Causa en el código

El recorrido real es el mismo en las dos versiones:

| Etapa por job | Comando remoto | Función |
|---|---|---|
| 1 | EVAL | Mover jobs retrasados disponibles |
| 2 | EVAL | Recuperar reservas caducadas |
| 3 | EVAL | Reservar el siguiente job |
| 4 | HGETALL | Leer el job otra vez para conocer su cola |
| 5 | EVAL | Confirmar y eliminar reserva/job |

En esta carga no hay retrasados ni reservas caducadas. Las dos primeras llamadas
se ejecutan igualmente. No se han añadido nuevos viajes en v3, y el heartbeat
no se llama en este benchmark. Tampoco participan ConnectionManager, los scopes
SQL ni afterCommit: se utiliza RedisQueueDriver directamente.

Los cambios relevantes son:

1. [RESERVE_LUA](../src/queue/RedisQueueDriver.ts#L108) añade un `HSET` de
   `reservationToken`. El UUID se genera en [reserve](../src/queue/RedisQueueDriver.ts#L218).
2. [COMPLETE_LUA](../src/queue/RedisQueueDriver.ts#L151) añade un `HGET` y la
   comprobación de propiedad antes de borrar.
3. El [HGETALL previo a complete](../src/queue/RedisQueueDriver.ts#L235) recupera
   todo el hash, incluido el nuevo token, aunque sólo necesita `queue`.
4. El [helper eval](../src/queue/RedisQueueDriver.ts#L190) vuelve a enviar el texto
   completo de los scripts. V3 aumenta su tamaño y añade argumentos.

Los contadores de Redis de la segunda tanda confirman lo siguiente por job:

| Medida | v2 | v3 |
|---|---:|---:|
| EVAL remotos | 4 | 4 |
| HGETALL totales, incluido el interno de Lua | 2 | 2 |
| HSET internos en la ventana medida | 0 | 1 |
| HGET internos en la ventana medida | 0 | 1 |
| Tiempo acumulado de EVAL por job, µs | 11,63 | 13,08 |
| Bytes recibidos por Redis por job, aprox. | 2.016 | 2.423 |
| Bytes enviados por Redis por job, aprox. | 414 | 480 |

Los bytes incluyen la pequeña amortización de INFO y las comprobaciones al final
del lote. Se midieron por diferencia de contadores, sin resetear estadísticas.
`INFO commandstats` aporta llamadas y tiempo de CPU por comando; no se suman los
tiempos de comandos internos a los de EVAL, porque se solapan. [Documentación de INFO](https://redis.io/docs/latest/commands/info/).

El aumento de entrada, **407 bytes/job (+20,2%)**, se explica exactamente por el
código y su representación RESP en este prefijo de prueba:

- +60 bytes en cada una de las dos invocaciones de MIGRATE_LUA.
- +60 bytes en RESERVE_LUA y +80 en COMPLETE_LUA.
- +86 bytes por enviar dos veces el UUID de 36 caracteres con su encuadre RESP.
- +60 bytes por el prefijo de jobs añadido a la recuperación de caducados.
- +1 byte por el cambio de longitud del script en la cabecera RESP.

La respuesta añade **66 bytes/job (+16,0%)** por el token devuelto en HGETALL.
No significa que EVAL recompile Lua cada vez: Redis conserva scripts compilados,
pero el cliente sigue transmitiendo su fuente con EVAL. [Scripts y EVALSHA](https://redis.io/docs/latest/develop/programmability/eval-intro/).

## 5. Experimentos para separar los costes

Se cambió una pieza cada vez en copias temporales, manteniendo seis repeticiones,
20.000 jobs y warmup. Resultados de la [tanda de atribución](redis/2026-09-04T20-36-29.492Z.json):

| Variante | Jobs/s | Cambio frente a v3 de esa tanda | Interpretación |
|---|---:|---:|---|
| v3 original | 33.705 | — | Control |
| Token constante | 33.989 | +0,8% | Quitar generación de UUID apenas cambia el resultado |
| Sin copiar `fields` con spread | 33.695 | −0,03% | No aparece una ganancia relevante |
| Sin HSET/comprobación Lua del token | 34.672 | +2,9% | El protocolo añade coste real; este cambio destruye su garantía |
| HGET queue en vez de HGETALL | 33.800 | +0,3% | Con payload pequeño, reducir sólo la respuesta no basta |
| Confirmación completa en un EVAL | 39.079 | +15,9% | Eliminar una etapa remota sí tiene impacto |
| EVALSHA con fallback NOSCRIPT | 36.021 | +6,9% | Reducir la fuente transmitida ayuda sin retirar tokens |

**Token constante y eliminación del control Lua son exclusivamente diagnósticos,
no alternativas válidas para producción.** Además, retirar esas líneas Lua reduce
sus bytes y cambia el contenido del hash: el +2,9% no debe interpretarse como el
coste aislado exacto de dos instrucciones Redis. Los efectos tampoco se suman
linealmente. No se ha medido una combinación de optimizaciones.

La conclusión respaldada es que el UUID y el spread no son el problema principal;
el coste está repartido entre el protocolo Redis del token, sus datos y el camino
de comunicación. No hay evidencia para atribuir todo el 27,7% histórico a una
única línea.

## 6. Mejora propuesta y comprobación

**Primero: hacer `complete()` en una única llamada Lua.** El script puede validar
el token, leer la cola y eliminar la reserva y el job de forma atómica:

```lua
if redis.call('HGET', KEYS[1], 'reservationToken') ~= ARGV[2] then return 0 end
local queue = redis.call('HGET', KEYS[1], 'queue') or 'default'
redis.call('ZREM', ARGV[3] .. queue, ARGV[1])
return redis.call('DEL', KEYS[1])
```

El cliente pasa jobKey, id, token y el prefijo de reservas; desaparece el HGETALL
previo. No requiere cambiar QueueDriver ni cachear id→queue en memoria. Conserva
la limitación de Redis standalone: el script construye la clave de reservas a
partir de la cola almacenada, igual que otras claves dinámicas del driver actual.

La [tanda con verificaciones de leases](redis/2026-09-04T20-38-27.592Z.json) dio:

| Variante | Jobs/s | Frente a v3 | Frente a v2 | p99 mediano ms |
|---|---:|---:|---:|---:|
| v2 | 35.097 | — | — | 0,503 |
| v3 | 33.113 | — | −5,7% | 0,486 |
| v3, complete atómico | 39.293 | +18,7% | +12,0% | 0,381 |
| v3, EVALSHA | 36.072 | +8,9% | +2,8% | 0,388 |

En ambas propuestas, el propietario anterior no puede completar, liberar, fallar
ni renovar la nueva reserva; el dueño actual sí puede renovar, liberar, obtener
un token distinto y confirmar. No se crean fallos falsos. Los seis procesos de
cada variante segura pasan esas comprobaciones fuera del cronómetro.

**Segundo, si se continúa optimizando: EVALSHA con recuperación de NOSCRIPT.**
Mantiene cinco comandos remotos por job, pero en la prueba reduce la entrada de
2.423 a aproximadamente 1.197 bytes/job. También se comprobó el
[arranque con caché de scripts vacía](redis/2026-09-04T20-41-13.194Z.json), en una
instancia nueva donde sólo se ejecutaba esa variante. El fallback pasó la carga
y las comprobaciones de leases. La caché de scripts puede perderse; conservar ese
manejo de error es necesario. [Semántica de la caché de scripts](https://redis.io/docs/latest/develop/programmability/eval-intro/#cache-volatility).

En esta fase eran prototipos medidos, no cambios integrados ni una validación
exhaustiva de despliegue. Antes de integrar una propuesta se deben ejecutar las regresiones
Redis/worker y verificar el comportamiento de errores de conexión y caché de
scripts. No recomiendo quitar tokens, heartbeat ni comprobaciones de propiedad.

## 7. Reproducción y límites

```sh
# Redis dedicado temporal, 6 parejas v2/v3, 20.000 jobs + 2.000 de warmup
bun scripts/benchmark-redis-queue.ts

# Diagnóstico de costes y propuestas, siempre en copias temporales
REDIS_BENCH_VARIANTS=v3,v3-constant-token,v3-no-spread,v3-no-token-lua,v3-hget-queue,v3-atomic-complete,v3-evalsha \
  bun scripts/benchmark-redis-queue.ts

# Verificar propuestas y leases frente a v2/v3
REDIS_BENCH_VARIANTS=v2,v3,v3-atomic-complete,v3-evalsha \
  bun scripts/benchmark-redis-queue.ts
```

`REDIS_BENCH_URL` permite usar un servidor de pruebas existente. Las claves usan
un prefijo aleatorio por proceso y se eliminan al terminar; no se cambia la
configuración del servidor existente, ni se ejecuta FLUSHDB/FLUSHALL/SCRIPT FLUSH.
El script admite también COUNT, WARMUP, CONCURRENCY y REPETITIONS con el prefijo
`REDIS_BENCH_`. Requiere `redis-server` local cuando no se pasa una URL.

Los JSON conservan datos individuales y las fuentes completas de las variantes.
El harness se amplió entre tandas con variantes y aserciones; sus hashes reflejan
esas diferencias. Cada porcentaje de la tabla compara controles dentro de su
propia tanda. El camino temporizado y los parámetros de las tres comparaciones
largas v2/v3 son iguales.

Al cerrar la investigación inicial, el typecheck estricto del script pasaba y
`git diff -- src` estaba vacío. No se hicieron commits ni cambios de configuración
Redis compartida. Los resultados
acotan este workload: loopback, payload `{"args":[]}`, ocho consumidores y jobs
listos para reservar. No cuantifican TLS, red remota, payloads grandes, miles de
reservas caducadas ni el throughput de `handle()` con trabajo de aplicación.

## 8. Integración de complete atómico

Se aplicó únicamente la confirmación atómica en `RedisQueueDriver`: un EVAL
valida el token, obtiene la cola y elimina la reserva y el hash. Desaparece el
HGETALL remoto previo. La API y el resto de las operaciones del driver conservan
su comportamiento; no se ha integrado EVALSHA.

**Alcance respecto al resto del ORM:** el diff de producción sólo afecta a
`src/queue/RedisQueueDriver.ts`, al script COMPLETE_LUA y al cuerpo de `complete()`.
No introduce imports, inicialización, cachés, temporizadores ni trabajo adicional
en consultas SQL, modelos, casts, conexiones, transacciones o caché. Esos caminos
no ejecutan el código modificado. No se pretende deducir un rendimiento SQL
idéntico a partir de los tests: la separación se comprueba en el código.

Validación: `bun run test` pasa **1.695 tests, 0 fallos, 5.596 assertions, 133
archivos**, incluidos Redis real, workers, reservas caducadas y los drivers SQL.
Se añadió una regresión de confirmación concurrente desde dos drivers: sólo una
confirmación tiene éxito, se limpia la cola con nombre y se conserva la reserva
de otra cola. El typecheck estricto del benchmark también pasa.

La [medición del código integrado](redis/2026-09-04T20-51-41.307Z.json) conserva
seis repeticiones, 20.000 jobs medidos, 2.000 de calentamiento y concurrencia ocho
con Redis dedicado. Medianas:

| Variante | Jobs/s | p99 mediano ms |
|---|---:|---:|
| v2 (`683373b`) | 36.038,98 | 0,312 |
| v3 anterior (`654e508`) | 33.454,53 | 0,318 |
| Código integrado (`worktree`) | 39.077,30 | 0,282 |

Resultado: **+16,8% frente a v3 anterior y +8,4% frente a v2**. Los contadores
confirman cuatro EVAL por job y un único HGETALL interno, frente a los dos
HGETALL anteriores; se pasa de cinco a cuatro comandos remotos. Las seis
ejecuciones del código integrado pasan la comprobación de propietario antiguo.
El JSON incluye la fuente exacta integrada y su hash: se midió antes del commit
de publicación de v3.1.0.

```sh
REDIS_BENCH_VARIANTS=v2,v3,worktree bun scripts/benchmark-redis-queue.ts
```
