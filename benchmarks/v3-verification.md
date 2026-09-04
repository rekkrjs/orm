# Verificación v3.0.0 — 2026-09-04

Implementación local sobre `9eff217`, sin commit, push, tag ni publicación. La referencia funcional es v2.5.0 (`683373b`). Los hashes de cada registro identifican el estado medido, incluidas las modificaciones locales.

## Validación funcional

- `bun run build`: correcto (TypeScript 7.0.2).
- `bun run test`: **1.694 pass, 0 fail, 5.590 assertions, 133 archivos**, 5,83 s. Sin skips de servicios obligatorios.
- `bun scripts/verify-services.ts`: PostgreSQL, MySQL y Redis disponibles.
- Typecheck estricto adicional de benchmark-runtime, elysia-consumer-probe, verify-services y v3-acceptance: correcto.
- `bun install --frozen-lockfile`: sin cambios. `bun audit`: **0 vulnerabilidades**, 105 paquetes revisados.
- Workflow `.github/workflows/test.yml`: YAML validado; Bun 1.4.1 + PostgreSQL 16/MySQL 8.4/Redis 7, servicios obligatorios antes de build/test/audit. Su ejecución en GitHub queda pendiente del push autorizado.

Las regresiones cubren conexiones/modelos/builders anteriores al scope, conexiones estáticas explícitas, tenants y transacciones concurrentes, JOIN/alias/CTE con rollback en dos esquemas, RLS real, sesiones search_path descartadas, caché por tenant/recurso, afterCommit manual/savepoints/fallo real de COMMIT, TTL/drenaje/fallo de cierre, tokens y heartbeat con dueño antiguo, search/Redis con fallos, SQL etiquetado, policies y valores de validación. Los contratos de casts/Proxy/relaciones/dirty tracking permanecen en la suite completa.

## Serialización e hidratación

Referencia: [2026-09-04T18-49-28.185Z-683373b-4eb6ba5d.json](results/2026-09-04T18-49-28.185Z-683373b-4eb6ba5d.json). Resultado final: [2026-09-04T20-15-40.109Z-9eff217-1a32534d.json](results/2026-09-04T20-15-40.109Z-9eff217-1a32534d.json). Mismo harness, Bun 1.4.1 (`4661e494f`) y Apple M4/macOS arm64; 20.000 filas SQLite en memoria. Tres procesos por suite, con warmup y rondas internas.

| Ruta | v2.5.0 mediana ms | v3 mediana ms | Cambio | Rango v3 ms |
|---|---:|---:|---:|---:|
| Driver + stringify | 9.5146 | 9.8684 | +3.7% | 9.7372–10.1141 |
| Model get + toJSON + stringify | 38.0315 | 31.9949 | -15.9% | 31.6405–32.9540 |
| rawJson + stringify | 20.7302 | 20.9894 | +1.3% | 20.9666–21.3028 |

El driver nativo no realiza casts; no es equivalente funcionalmente al modelo. La equivalencia entre JSON del modelo y rawJson se comprueba fuera del cronómetro. Los registros también incluyen 1/25/200 filas: no se extrapolan los porcentajes de 20.000 filas a todas las consultas.

P1 conserva un máximo de 64 definiciones de casts de string, reutiliza la conversión existente y evita parsear valores que no necesitan normalización. Se mantienen las copias públicas de casts y los hooks. P2/P3 quedan desactivados por su condición de evidencia: no se introduce invalidación de mapas mutables ni caché de visibilidad.

Los [perfiles antes](profiles/2026-09-04-casts-before.md) y [después](profiles/2026-09-04-casts-after.md) muestran que el parseo repetido desaparece de los puntos más costosos. Son perfiles cortos, evidencia direccional, no un techo teórico.

La fase get aislada osciló en el recorder (incluidas ejecuciones de 8,24–10,78 ms), por lo que se investigó separadamente. [Seis procesos alternados con P1 desactivado/activado](profiles/2026-09-04-get-isolation.json), manteniendo el resto del runtime, 20 warmups y 41 rondas, dieron estas parejas de medianas ms: **9,2664→9,2397; 8,8155→8,5713; 11,8361→11,4958**. P1 no empeoró ninguna pareja; la dispersión entre procesos supera la mejora. No se afirma una aceleración significativa de get por sí solo.

## Rutas con servicios y contención

Referencia v2: [2026-09-04T20-14-42.853Z-v2.5.0.json](runtime/2026-09-04T20-14-42.853Z-v2.5.0.json). V3: [2026-09-04T20-14-19.989Z-worktree.json](runtime/2026-09-04T20-14-19.989Z-worktree.json). Ambos usan `orm-runtime-v2`, mismo hash de harness y máquina. Pool SQL max=4, tres repeticiones, 200 operaciones por escenario; bulk usa 30 lotes de 25 filas.

| Servicio | Versión local |
|---|---|
| sqlite | 3.43.2 |
| postgres | PostgreSQL 18.6 (Postgres.app) on aarch64-apple-darwin23.6.0, compiled by Apple clang version 15.0.0 (clang-1500.3.9.4), 64-bit |
| mysql | 26.7.0 |
| redis | 8.10.1 |

Medianas de las tres repeticiones, en milisegundos por operación. Los observadores sólo incrementan un contador.

| Motor / operación | v2 ms | v3 ms | Cambio |
|---|---:|---:|---:|
| sqlite / point | 0.0044 | 0.0048 | +8.6% |
| sqlite / tenant-point | 0.0048 | 0.0055 | +15.7% |
| sqlite / tenant-transaction-point | 0.0104 | 0.0115 | +10.0% |
| sqlite / create-save-delete | 0.0306 | 0.0358 | +16.9% |
| sqlite / create-save-delete-observers | 0.0278 | 0.0317 | +13.9% |
| sqlite / bulk-insert-update-delete-25 | 0.0348 | 0.0324 | -6.9% |
| sqlite / heterogeneous-casts-25 | 0.0491 | 0.0416 | -15.2% |
| sqlite / cast-override-25 | 0.0498 | 0.0406 | -18.6% |
| sqlite / partial-casts-25 | 0.0254 | 0.0231 | -9.0% |
| sqlite / eager-casts-25 | 0.0978 | 0.0865 | -11.6% |
| postgres / point | 0.0323 | 0.0308 | -4.9% |
| postgres / tenant-point | 0.0302 | 0.0316 | +4.7% |
| postgres / tenant-transaction-point | 0.0838 | 0.0835 | -0.4% |
| postgres / create-save-delete | 1.5365 | 1.5454 | +0.6% |
| postgres / create-save-delete-observers | 1.7891 | 1.8220 | +1.8% |
| postgres / bulk-insert-update-delete-25 | 0.4149 | 0.3535 | -14.8% |
| postgres / heterogeneous-casts-25 | 0.0933 | 0.0837 | -10.3% |
| postgres / cast-override-25 | 0.0925 | 0.0848 | -8.3% |
| postgres / partial-casts-25 | 0.0651 | 0.0627 | -3.6% |
| postgres / eager-casts-25 | 0.1902 | 0.1802 | -5.3% |
| mysql / point | 0.0338 | 0.0352 | +4.3% |
| mysql / tenant-point | 0.0337 | 0.0346 | +2.6% |
| mysql / tenant-transaction-point | 0.0787 | 0.0819 | +4.0% |
| mysql / create-save-delete | 0.5224 | 0.5277 | +1.0% |
| mysql / create-save-delete-observers | 0.5244 | 0.5272 | +0.5% |
| mysql / bulk-insert-update-delete-25 | 0.5962 | 0.6322 | +6.0% |
| mysql / heterogeneous-casts-25 | 0.0931 | 0.0854 | -8.3% |
| mysql / cast-override-25 | 0.0943 | 0.0878 | -6.9% |
| mysql / partial-casts-25 | 0.0663 | 0.0639 | -3.5% |
| mysql / eager-casts-25 | 0.1725 | 0.1645 | -4.6% |

Los leases, la validación de contexto y los tokens son correcciones de aislamiento con coste. En SQLite, create/save/delete pasa de aproximadamente 31 a 36 µs; se acepta ese coste para mantener toda la escritura y sus observers protegidos durante el drenaje. No se presenta como mejora. La ruta MySQL sin observers mostró +22% en el protocolo v1; al repetir con el workload v2 y calentamiento comparable queda alrededor de +1%, sin extrapolar entre protocolos.

Las operaciones anidadas en un recurso ya activo conservan su propio lease y reutilizan su contexto, evitando copiar el Set y reabrir AsyncLocalStorage en cada llamada. No se suprime la protección de tareas hijas.

Colas: ocho consumidores concurrentes, sólo reserva + complete, sin tiempo de dispatch ni handle/heartbeat. p95/p99 son percentiles por operación dentro de cada repetición; la tabla presenta la mediana de esos percentiles.

| Motor | v2 ops/s | v3 ops/s | v2 p95 ms | v3 p95 ms | v2 p99 ms | v3 p99 ms |
|---|---:|---:|---:|---:|---:|---:|
| sqlite | 29298.31 | 27017.29 | 0.32 | 0.42 | 0.53 | 0.63 |
| postgres | 11459.10 | 11631.54 | 0.97 | 1.06 | 1.15 | 1.21 |
| mysql | 7176.53 | 6579.60 | 1.59 | 1.84 | 2.06 | 2.35 |
| redis | 37423.69 | 27051.70 | 0.25 | 0.54 | 0.26 | 0.62 |

Los tokens/condiciones Lua añaden trabajo (Redis mediana de reserva+complete ≈0,212→0,242 ms en esta pareja). No se promete que todas las colas aceleren. El historial conserva todos los registros y su dispersión; no hay un umbral universal de rendimiento.

## Memoria en procesos dedicados

Tres procesos por versión; 2.000 filas con JSON/decimal/bool, cinco warmups, treinta serializaciones. La GC explícita se mide aparte y no representa la distribución de pausas naturales.

| Métrica (mediana) | v2 | v3 |
|---|---:|---:|
| Tiempo de 30 rondas, ms | 88.375 | 66.617 |
| Heap máximo observado, MiB | 21.820 | 19.483 |
| Heap tras GC, MiB | 5.896 | 6.095 |
| RSS máximo del proceso, MiB | 93.172 | 90.281 |
| GC explícita final, ms | 1.531 | 1.510 |

Son cargas finitas, no una prueba de ausencia de fugas. Las comprobaciones funcionales del ciclo de vida sí verifican cierre, ownership, recuperación y ausencia de resurrección de resoluciones anteriores.

## Consumidor, migración y workarounds

`bun scripts/elysia-consumer-probe.ts ../benchmarks/orm_bench_elysia` prueba una copia aislada del consumidor real con Elysia 1.4.29 y datos sintéticos. El consumidor antiguo usa ORM v0.8: la copia enlaza v3 y migra getArray() a get(). `/elysia` devuelve el JSON esperado y reconfigureOrm funciona. El proyecto consumidor original no se modifica. Hash de su entrada: `6661c879c44f86d6c8e7ceb4acf4c0ccb69061b7266807cc957a2b7e991b5be6`.

El protocolo de despliegue de workers se verifica con tablas v2 sin reservation_token que contienen jobs pendientes, migración v3 y nuevas adquisiciones en SQLite/PostgreSQL/MySQL. Redis adquiere/expira/reasigna tokens sin perder trabajos. Las cuatro mutaciones del propietario anterior se rechazan. Se requiere detener/drainar workers viejos antes de arrancar v3; no se ha desplegado en producción.

- MySQL event loop: cuatro triggers × veinte intentos, 0/20 completados en cada trigger sin workaround. Se mantiene.
- Write-count: SQLite/PG count=2; MySQL count=0 y affectedRows=2. No-op UPDATE: 1/1/0. Se mantiene el helper aditivo.
- Collection/Elysia: status 207, request ID, seguridad y cookie preservados; al restaurar temporalmente constructor.name=Collection en el hijo, status 200 y cabeceras/cookie ausentes. Se mantiene.
- Repros y criterios de retirada: [.tmp_hacks](../.tmp_hacks/).

## Dependencias y límites de entrega

SvelteKit 2.70.3 y las actualizaciones del lock eliminan los hallazgos detectados; override cookie ^0.7.2 cubre su dependencia antigua. [Aviso de SvelteKit](https://github.com/advisories/GHSA-29g2-3rmr-qm68), [nanoid](https://github.com/advisories/GHSA-2v37-7h3g-55p8), [PostCSS](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp). La comprobación actual es bun audit, no la auditoría histórica. No se añaden dependencias de runtime.

afterCommit y los buffers son memoria del proceso, sin outbox durable. Redis Cluster queda sin soporte. MySQL DDL no se hace transaccional. La guía [upgrade-3.0](../docs/upgrade-3.0.md) detalla las rupturas y su migración. Quedan pendientes únicamente la revisión del diff, ejecutar CI remoto y cualquier commit/publicación que el usuario autorice.
