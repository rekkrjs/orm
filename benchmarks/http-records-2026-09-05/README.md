# HTTP benchmark-records: v3.1.1 frente a v2.5.0

**Registro histórico de un consumidor externo.** La aplicación Hono y su base de
datos originales no se publicaron con v3.1.1; los JSON y perfiles documentan la
medición, pero no permiten reproducirla por sí solos. Para una comparación
autocontenida, usa el [benchmark público del repositorio](../http/README.md), con
fixtures deterministas y protocolo distinto. No se deben mezclar sus resultados.

Medición del 5 de septiembre de 2026 sobre los tres endpoints solicitados de `orm_bench/src/index.ts`. **La ruta `.json()` mejora un 28,95 % en req/s**, frente al +5,73 % del [benchmark de usuarios](../http-users-2026-09-05/README.md). Las otras dos rutas quedan cerca de la paridad.

| Endpoint bajo `/benchmark-records` | v2.5.0 req/s | v3.1.1 req/s | Cambio | p95 v2.5.0 ms | p95 v3.1.1 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/rekkr` | 776.25 | 769.97 | -0.81% | 1305.54 | 1320.78 |
| `/rekkr-rawJson` | 609.16 | 612.84 | +0.60% | 1662.73 | 1649.13 |
| `/rekkr-json` | 350.58 | 452.08 | +28.95% | 2870.45 | 2245.52 |

Todas las peticiones medidas devolvieron HTTP 200, sin errores. Antes de cada medición se comprobó que las tres rutas devolvían JSON idéntico entre sí y entre versiones: **1.000 filas y 287.707 bytes por respuesta** (280,96 KiB). Se conservaron hashes y tamaños, sin guardar los datos de las filas ni credenciales.

## Condiciones

- Apple M4, macOS 15.7.9, Bun 1.4.2 y oha 1.16.0. Aplicación y generador de carga en la misma máquina; misma base de datos y configuración del consumidor, mediante Bun SQL/MySQL.
- Se conservaron los parámetros solicitados: 60 segundos, 1.000 conexiones HTTP, `--no-tui -w --latency-correction`. Se añadieron 5 segundos de calentamiento y salida JSON a archivo.
- Proceso nuevo por endpoint y versión; ejecuciones secuenciales y sin perfilador. Muestreo de CPU/RSS del servidor con `ps` cada 2 segundos.
- Orden: `/rekkr` v2→v3; `/rekkr-rawJson` v3→v2; `/rekkr-json` v2→v3. Una medición por combinación, sin intervalos de confianza. Las diferencias inferiores al 1 % no prueban una regresión o mejora estable.
- `-w` incluye el drenaje de peticiones pendientes en el tiempo total informado por oha. Se usa su valor de req/s directamente.
- Según la ayuda de oha 1.16.0, `--latency-correction` se ignora sin `-q`; las latencias aquí no tienen corrección de omisión coordinada. Las 1.000 conexiones miden carga con cola, no latencia de una petición aislada.

```sh
oha -z 60s -c 1000 --no-tui -w --latency-correction http://localhost:3000/benchmark-records/rekkr
oha -z 60s -c 1000 --no-tui -w --latency-correction http://localhost:3000/benchmark-records/rekkr-rawJson
oha -z 60s -c 1000 --no-tui -w --latency-correction http://localhost:3000/benchmark-records/rekkr-json
```

A cada comando se añadió `--output-format json -o <archivo>`. Los seis JSON individuales y el [registro conjunto](results.json) contienen los resultados originales.

## Versiones verificadas

- v2.5.0: `683373b032fe1cee76492a0b1f88b81c38910eda`.
- v3.1.1: `c144b8c4ca3bc8554675318781b7c3fa229549f9`.

Los fuentes se extrajeron de cada tag con `git archive` y se verificaron contra los objetos Git: 138 archivos en v2.5.0 y 142 en v3.1.1. La aplicación se copió con ámbito de paquete independiente y enlaces a las dependencias existentes del consumidor. Un assert al arrancar verifica que `@rekkr/orm` se resuelve al snapshot correcto. Los perfiles confirman esas rutas. [Manifiesto de fuentes](source-verification.json).

No se cambiaron el código ni la configuración del consumidor ni el código del ORM. `results.json` incluye hashes de los archivos TypeScript principales del consumidor, comprobados de nuevo al finalizar. Las copias temporales se eliminaron tras las pruebas.

## Interpretación y perfiles

Este modelo declara cinco casts: `id: number`, `score: number`, `amount: decimal:2`, `active: boolean` y `metadata: json`. Las columnas `created_at` y `updated_at` también coinciden con los casts implícitos de timestamps. La consulta devuelve el doble de filas y casi tres veces los bytes del caso de usuarios; también ejercita más conversiones por fila.

`/rekkr` usa filas y conversiones manuales; `rawJson()` evita construir modelos; `.json()` hidrata los 1.000 modelos y recorre su serialización. Por eso el mayor beneficio de la reutilización de metadatos de casts aparece en `.json()`.

Se hicieron dos perfiles separados del throughput principal, cada uno con 5 segundos de calentamiento y 15 segundos de carga sobre `/benchmark-records/rekkr-json`. El perfil incluye arranque, calentamiento y drenaje; sus porcentajes son evidencia orientativa, no una descomposición exacta de la latencia HTTP.

- En v2.5.0, las dos ubicaciones principales de `assertSupportedStringCast` suman aproximadamente **20,2 % de tiempo propio** (15,9 % + 4,3 %). `compileCast` también figura entre las funciones costosas.
- En v3.1.1, esas funciones dejan de destacar. Es coherente con reutilizar metadatos y evitar analizar repetidamente las mismas definiciones de casts. No implica haber eliminado las comprobaciones de validez.
- `JSON.stringify`, incluidas llamadas descendientes, pasa a representar un **47,4 %** del tiempo atribuido en v3.1.1, frente al 29,5 % en v2.5.0. Sus porcentajes relativos no comparan coste por petición: el perfil nuevo procesa más peticiones y dedica una fracción menor a otros trabajos.

Estos perfiles respaldan la explicación del aumento de throughput, aunque la comparación entre tags incluye otros cambios y no aísla causalmente una sola optimización. No se extrapola el +28,95 % a otros modelos, tamaños de respuesta o bases de datos.

Perfiles completos: [v2.5.0](v2.5.0-rekkr-json.md), [v3.1.1](v3.1.1-rekkr-json.md). Los archivos `.cpuprofile` adjuntos permiten inspeccionar los árboles de llamadas.
