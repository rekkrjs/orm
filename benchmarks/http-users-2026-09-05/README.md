# HTTP users: v3.1.1 frente a v2.5.0

**Registro histórico de un consumidor externo.** La aplicación Hono y su base de
datos originales no se publicaron con v3.1.1; los JSON y perfiles documentan la
medición, pero no permiten reproducirla por sí solos. Para una comparación
autocontenida, usa el [benchmark público del repositorio](../http/README.md), con
fixtures deterministas y protocolo distinto. No se deben mezclar sus resultados.

Medición del 5 de septiembre de 2026 sobre los tres endpoints solicitados de `orm_bench/src/index.ts`. La mejora de `/rekkr-json` se reproduce: **+5,73 %**. Las otras dos rutas apenas cambian.

| Endpoint | v2.5.0 req/s | v3.1.1 req/s | Cambio | p95 v2.5.0 ms | p95 v3.1.1 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/rekkr` | 1733.29 | 1727.64 | -0.33% | 593.40 | 588.16 |
| `/rekkr-rawJson` | 1699.45 | 1696.94 | -0.15% | 601.81 | 598.98 |
| `/rekkr-json` | 1262.34 | 1334.71 | +5.73% | 808.89 | 783.28 |

Todas las peticiones medidas devolvieron HTTP 200; ningún error. Las comprobaciones de respuesta realizadas antes de cada prueba verificaron igualdad byte a byte entre los tres endpoints y entre versiones: **500 filas, 97.677 bytes por respuesta**.

## Protocolo y límites

- Apple M4, macOS 15.7.9; Bun 1.4.2, oha 1.16.0. Servidor y generador de carga en la misma máquina, base de datos configurada por el consumidor; protocolo MySQL mediante Bun SQL.
- Un proceso nuevo por endpoint y versión. Calentamiento de 5 segundos y medición de 60 segundos con 1.000 conexiones HTTP. Las pruebas se ejecutaron secuencialmente, sin perfilador; muestreo ligero de CPU/RSS del servidor cada 2 segundos.
- Orden: `/rekkr` v2→v3, `/rekkr-rawJson` v3→v2, `/rekkr-json` v2→v3. Una medición por combinación: no hay intervalos de confianza. Las diferencias pequeñas no prueban una regresión; el +5,73 % de JSON coincide aproximadamente con el +5,40 % de la medición previa del usuario.
- `-w` espera las peticiones pendientes al acabar los 60 segundos. Se usa el req/s que informa oha, cuyo tiempo total incluye ese drenaje.
- Se conserva `--latency-correction`, pero la ayuda de oha 1.16.0 indica que **se ignora sin `-q`**. Estas latencias no tienen corrección de omisión coordinada.
- Los hashes de los fuentes del consumidor están en `results.json`; no se cambiaron sus endpoints, dependencias ni configuración. Las copias usan el mismo `.env` mediante una ruta explícita, sin guardar credenciales.

Comandos medidos (se añadieron únicamente `--output-format json -o <archivo>` para guardar resultados):

```sh
oha -z 60s -c 1000 --no-tui -w --latency-correction http://localhost:3000/rekkr
oha -z 60s -c 1000 --no-tui -w --latency-correction http://localhost:3000/rekkr-rawJson
oha -z 60s -c 1000 --no-tui -w --latency-correction http://localhost:3000/rekkr-json
```

## Verificación de versiones

- v2.5.0: `683373b032fe1cee76492a0b1f88b81c38910eda`.
- v3.1.1: `c144b8c4ca3bc8554675318781b7c3fa229549f9`.
- Fuentes extraídos de cada tag con `git archive`, aplicación copiada y dependencias del consumidor enlazadas, con un ámbito de paquete independiente para la aplicación. Un assert al arrancar compara la resolución real de `@rekkr/orm` con el snapshot esperado.
- Se verificaron contra Git los 138 archivos fuente de v2.5.0 y los 142 de v3.1.1: [manifiesto](source-verification.json). Los perfiles también muestran las rutas de los snapshots correctos.
- Una primera tanda se descartó íntegramente: las copias no tenían ámbito de paquete propio y Bun resolvía la autorreferencia al ORM del repositorio principal. Ningún resultado de esa tanda figura en esta comparación.

## Por qué la mejora no es mayor

La ruta `/rekkr` consulta filas y convierte `active` manualmente: no hidrata modelos. `rawJson()` también evita la construcción de modelos. La ruta `.json()` sí crea 500 modelos y llama a su serialización antes de que Hono convierta el resultado a texto JSON.

El modelo `User` sólo declara el cast `active: boolean`. Además, la consulta devuelve `createdAt` y `updatedAt` con alias; los casts de timestamps implícitos usan los nombres `created_at` y `updated_at`. Por tanto, este caso no ejercita la misma cantidad de casts que el [benchmark previo de 20.000 filas SQLite](../v3-verification.md). El test `src/index.test.ts` del consumidor cubre otros endpoints, `/benchmark-records/*`, con 1.000 filas y más casts; no los tres endpoints medidos aquí.

Los perfiles se capturaron en procesos separados, con 5 segundos de calentamiento y 15 segundos de carga. Incluyen arranque, calentamiento y drenaje; sus porcentajes son orientativos, no una descomposición exacta de la latencia HTTP.

| Tiempo atribuido por el perfilador | v2.5.0 | v3.1.1 |
| --- | ---: | ---: |
| `JSON.stringify`, incluidas llamadas descendientes | 60,1 % | 65,6 % |
| `Date.toISOString`, tiempo propio | 30,0 % | 32,3 % |

**Estas filas se solapan: no se suman.** Las fechas forman parte del trabajo de `JSON.stringify`. Que aumente su porcentaje relativo no demuestra una regresión de esa función: al reducir trabajo en otros lugares, representa una fracción mayor.

En v2.5.0, `assertSupportedStringCast` y `compileCast` aparecen entre los puntos costosos. En v3.1.1 dejan de destacar, coherente con la caché de metadatos de casts. Sin embargo, la conversión final a JSON y de fechas a ISO permanece como trabajo dominante. Mejorar una fracción del procesamiento no acelera en la misma proporción toda la respuesta HTTP.

Perfiles: [v2.5.0](v2.5.0-rekkr-json.md), [v3.1.1](v3.1.1-rekkr-json.md). Los archivos `.cpuprofile` permiten inspeccionar los árboles de llamadas. [Datos completos de las seis mediciones](results.json).

## Diagnóstico de concurrencia

Pruebas auxiliares de `/rekkr-json`: 2 segundos de calentamiento y 10 segundos medidos por nivel, en el orden v3.1.1→v2.5.0. No sustituyen a las mediciones principales de 60 segundos.

| Conexiones | v2.5.0 req/s | v3.1.1 req/s | Media v2.5.0 ms | Media v3.1.1 ms |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 568.36 | 584.49 | 1.758 | 1.710 |
| 10 | 1278.57 | 1365.28 | 7.817 | 7.320 |
| 100 | 1270.40 | 1326.24 | 78.410 | 75.121 |
| 1000 (60 s) | 1262.34 | 1334.71 | 787.081 | 744.568 |

El throughput ya está cerca de su techo con 10 conexiones. Con 100 y 1.000 crece sobre todo la espera. Esto es compatible con saturación del procesamiento compartido; no identifica por sí solo el reparto de espera entre pool SQL, servidor y sockets. Los porcentajes de CPU del proceso medidos con `ps` tampoco equivalen a uso total de toda la máquina.

## Fases sin HTTP

Sonda secuencial sobre la misma consulta de 500 usuarios, sin carga HTTP: tres procesos por versión, 20 iteraciones de calentamiento y 101 muestras por proceso. Se muestra la mediana de las tres medianas, en milisegundos. Estas cifras no se suman a las latencias bajo carga ni aíslan el efecto causal de cada cambio entre versiones.

| Fase | v2.5.0 ms | v3.1.1 ms |
| --- | ---: | ---: |
| Consulta al driver, incluida espera | 0.9287 | 0.9309 |
| Hidratación mediante helper interno | 0.0858 | 0.1067 |
| Collection.toJSON() | 0.1235 | 0.1041 |
| JSON.stringify() | 0.3659 | 0.3598 |
| Consulta completa con .json(), sin stringify | 1.1564 | 1.1402 |
| Consulta completa con .rawJson(), sin stringify | 0.9565 | 0.9501 |

La serialización del modelo mejora en esta sonda, mientras que la hidratación aislada resulta más lenta; no todas las fases mejoran. Los métodos completos se cronometran por separado y no son la suma de las medianas de los helpers. El coste común de espera SQL pesa más en esta ejecución secuencial que en el perfil de CPU bajo concurrencia.

Se comprobó que `emailVerifiedAt`, `createdAt` y `updatedAt` llegan como objetos `Date` del driver, y que el JSON de las tres rutas de la sonda coincide en cada iteración. [Muestras completas](diagnostics.json), [sonda reproducible](phases.ts):

```sh
BENCH_SOURCE=/ruta/al/checkout/de/la/version bun --no-env-file \
  --env-file=/ruta/al/orm_bench/.env benchmarks/http-users-2026-09-05/phases.ts
```

La siguiente optimización a investigar debería partir de la conversión de fechas y del JSON final, conservando exactamente su formato. Estos datos no justifican aumentar conexiones ni extrapolar el porcentaje del benchmark SQLite al endpoint HTTP. No se modificó código del ORM ni del consumidor.
