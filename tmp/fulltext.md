# Full-text nativo estilo Laravel 13

Documento de diseño para completar la API full-text de Rekkr ORM. Está basado
en Laravel 13, pero adapta la semántica a los tres drivers que soporta Rekkr:
MySQL/MariaDB, PostgreSQL y SQLite.

> **Estado: completado y verificado el 29 de agosto de 2026.** Implementación,
> documentación pública, tests unitarios/de tipos/integración y benchmarks
> terminados.

## Resumen

Rekkr ya tiene la mitad de la funcionalidad:

| Capacidad | Estado actual |
|---|---|
| `Builder.whereFullText()` | ✅ Implementado para una o varias columnas y opciones |
| `Builder.orWhereFullText()` | ✅ Implementado con opciones |
| Forwarding estático desde el modelo | ✅ Implementado y tipado |
| Bindings del término de búsqueda | ✅ Implementado y verificado |
| MySQL/MariaDB `MATCH ... AGAINST` | ✅ Natural, booleano y query expansion |
| PostgreSQL `tsvector @@ tsquery` | ✅ Plain, phrase, websearch, raw, language y vector |
| SQLite | ✅ Fallback literal agrupado; índices nativos rechazados |
| Opciones de Laravel 13 | ✅ Implementadas con validación estricta |
| `table.fullText()` | ✅ Implementado |
| `table.dropFullText()` | ✅ Implementado por nombre o columnas |
| Índice GIN de PostgreSQL | ✅ Implementado e introspectable |
| Índice FULLTEXT de MySQL/MariaDB | ✅ Implementado e introspectable |
| Ordenación/selección explícita de relevancia | Fuera de alcance, según este documento |

La implementación recomendada debe completar Schema, añadir las opciones de
Laravel 13 y garantizar que la expresión consultada por PostgreSQL sea
exactamente la misma que la expresión indexada.

### Estado previo verificado en el código

Detalles del código anterior que condicionaron el diseño y conviene no redescubrir
a mitad de la implementación:

- `Builder` ya envuelve las columnas antes de llamar a la gramática
  (`src/query/Builder.ts:1869`). Por tanto `compileFullText()` recibe
  identificadores **ya escapados**; `SQLiteGrammar` los vuelve a envolver y hoy
  solo es inofensivo porque `unwrapIdentifier()` quita las comillas primero.
- `MySqlGrammar.compileFullText()` emite `MATCH (...) AGAINST (?)` sin cláusula
  de modo. Es equivalente a lenguaje natural, pero no hay ningún punto de
  extensión para `mode` ni `expanded`.
- `PostgresGrammar.compileFullText()` usa `concat_ws(' ', ...)` para varias
  columnas y `english` literal en ambos lados de `@@`.
- `whereFullText()` no pasa el argumento `boolean` por `validBoolean()`, al
  contrario que sus métodos hermanos (`whereAll()`, `whereAny()`).
- `IndexDefinition` es `{ name, columns, unique }`: no hay forma de expresar
  hoy un índice que no sea una lista de columnas.
- `Schema.table()` ya compila todas las sentencias antes de ejecutar la
  primera (`src/schema/Schema.ts:215-267`). Es el patrón a copiar en
  `create()`, no un problema a resolver de cero.

## Objetivo

Permitir este flujo completo y reversible:

```ts
await Schema.create("articles", (table) => {
  table.id();
  table.string("title");
  table.text("body");
  table.boolean("published").default(false);

  table.fullText(["title", "body"]);
});

const articles = await Article
  .where("published", true)
  .whereFullText(["title", "body"], "web developer")
  .get();
```

Y que la migración se pueda revertir sin escribir SQL manual:

```ts
await Schema.table("articles", (table) => {
  table.dropFullText(["title", "body"]);
});
```

## Referencia de Laravel 13

Laravel 13 expone:

```php
$table->fullText('body');
$table->fullText(['title', 'body']);
$table->fullText('body')->language('english'); // PostgreSQL
$table->dropFullText(['title', 'body']);

Article::whereFullText('body', 'web developer')->get();
Article::whereFullText(['title', 'body'], 'web developer')->get();
Article::orWhereFullText('body', 'web developer')->get();
```

Las firmas internas de Laravel 13 también reciben opciones:

```php
whereFullText(string|array $columns, string $value, array $options = [], string $boolean = 'and')
orWhereFullText(string|array $columns, string $value, array $options = [])
```

Opciones relevantes:

- MySQL/MariaDB: `mode: "boolean"` y `expanded: true`.
- PostgreSQL: `language`, `mode: "phrase" | "websearch" | "raw"` y
  `vector: true` cuando la columna ya contiene un `tsvector`.
- Sin `mode`, MySQL usa lenguaje natural y PostgreSQL usa
  `plainto_tsquery`.

Laravel soporta esta API nativa únicamente para MariaDB, MySQL y PostgreSQL.
SQLite no tiene un índice full-text que se pueda añadir a una tabla ordinaria;
FTS5 usa tablas virtuales y sincronización propia.

Conviene tener presentes tres detalles de la implementación real de Laravel 13,
porque esta propuesta se aparta de los tres de forma deliberada:

- Un `language` que no esté en `validFullTextLanguages()` **no da error**:
  Laravel lo sustituye silenciosamente por `english`.
- `expanded` combinado con `mode: "boolean"` **no da error**: Laravel
  simplemente no emite `WITH QUERY EXPANSION`.
- La gramática de Schema de PostgreSQL acepta `online`, que emite
  `CREATE INDEX CONCURRENTLY`. Aquí queda fuera de alcance a propósito.

El DDL de Laravel para MySQL es `ALTER TABLE ... ADD FULLTEXT <nombre>(...)` y
el borrado es `ALTER TABLE ... DROP INDEX <nombre>`, no sentencias
`CREATE`/`DROP INDEX` sueltas.

## API pública propuesta para Rekkr

### Query Builder y modelo estático

Mantener las llamadas actuales y añadir el tercer argumento de opciones:

```ts
export interface FullTextOptions {
  mode?: "boolean" | "phrase" | "websearch" | "raw";
  expanded?: boolean;
  language?: PostgresFullTextLanguage;
  vector?: boolean;
}

whereFullText(
  columns: ModelColumn<T> | readonly ModelColumn<T>[],
  value: string,
  options?: FullTextOptions,
): this;

orWhereFullText(
  columns: ModelColumn<T> | readonly ModelColumn<T>[],
  value: string,
  options?: FullTextOptions,
): this;
```

El forwarding estático debe conservar los tipos de columna del modelo:

```ts
Article.whereFullText("body", term);
Article.whereFullText(["title", "body"] as const, term);
Article.orWhereFullText("body", term, { mode: "boolean" });
```

`PostgresFullTextLanguage` debe ser una unión de las configuraciones integradas
que Laravel 13 acepta, es decir la lista literal de su `validFullTextLanguages()`:

```ts
export type PostgresFullTextLanguage =
  | "simple" | "arabic" | "danish" | "dutch" | "english" | "finnish"
  | "french" | "german" | "hungarian" | "indonesian" | "irish" | "italian"
  | "lithuanian" | "nepali" | "norwegian" | "portuguese" | "romanian"
  | "russian" | "spanish" | "swedish" | "tamil" | "turkish";
```

Esa misma lista debe existir también en runtime, porque el tipo desaparece al
compilar y el idioma sí se interpola en SQL: es la única defensa contra un
valor que llegue de JavaScript sin tipar o de una entrada externa. No se debe
interpolar un idioma arbitrario en SQL. Si en el futuro se quieren aceptar
configuraciones creadas por el usuario, eso debe ser otra opción explícita y
validada como identificador.

Nótese que la lista es la de Laravel, no la de PostgreSQL: una instalación
puede tener configuraciones adicionales (`catalan`, `greek`, diccionarios
propios) que este allowlist rechaza. Es una limitación consciente heredada.

El Builder actual expone accidentalmente `boolean` y `not` como tercer y cuarto
argumento de `whereFullText()`. La API documentada nunca los ha usado. Para no
romper consumidores existentes durante una versión minor, se puede conservar
esa sobrecarga como obsoleta y hacer que ambas formas deleguen a un único helper
privado. En la siguiente major se debería dejar solo el objeto de opciones.

### Schema Blueprint

```ts
table.fullText("body");
table.fullText(["title", "body"]);
table.fullText(["title", "body"], "articles_search_fulltext");
table.fullText("body").language("spanish");

table.dropFullText("articles_search_fulltext");
table.dropFullText(["title", "body"]);
```

Firmas propuestas:

```ts
fullText(
  columns: string | readonly string[],
  name?: string,
): FullTextIndexBuilder;

dropFullText(indexOrColumns: string | readonly string[]): void;
```

El nombre por defecto debe seguir a Laravel:

```text
<tabla>_<columna_1>_<columna_2>_fulltext
```

Ejemplo:

```text
articles_title_body_fulltext
```

`FullTextIndexBuilder` solo necesita almacenar la definición y exponer:

```ts
language(language: PostgresFullTextLanguage): this;
```

No hace falta generalizar todos los índices con un nuevo sistema fluent. Un
builder pequeño y específico evita cambiar `index()` y `uniqueIndex()` sin una
necesidad real.

## Semántica por driver

### MySQL y MariaDB

Consulta por defecto:

```sql
MATCH (`title`, `body`)
AGAINST (? IN NATURAL LANGUAGE MODE)
```

Modo booleano:

```ts
Article.whereFullText(["title", "body"], "+web -legacy", {
  mode: "boolean",
});
```

```sql
MATCH (`title`, `body`) AGAINST (? IN BOOLEAN MODE)
```

Expansión de consulta:

```ts
Article.whereFullText("body", "database", { expanded: true });
```

```sql
MATCH (`body`)
AGAINST (? IN NATURAL LANGUAGE MODE WITH QUERY EXPANSION)
```

Como Laravel, `expanded` no debe aplicarse junto a `mode: "boolean"`.

DDL:

```sql
ALTER TABLE `articles`
ADD FULLTEXT INDEX `articles_title_body_fulltext` (`title`, `body`)
```

Consideraciones:

- Las columnas de `MATCH(...)` deben coincidir con un índice FULLTEXT válido.
  Una lista distinta puede producir `Can't find FULLTEXT index matching the
  column list` o impedir el uso del índice.
- El síntoma depende del modo: sin índice, el lenguaje natural falla con ese
  error, mientras que `IN BOOLEAN MODE` sí se ejecuta, escaneando la tabla
  entera. Un `mode: "boolean"` puede pasar los tests y ser lentísimo en
  producción, así que la cobertura del índice se debe comprobar con `EXPLAIN`,
  no con la ausencia de errores.
- El identificador de índice de MySQL está limitado a 64 caracteres y el de
  PostgreSQL a 63 bytes. PostgreSQL además **trunca en silencio**: un nombre
  automático largo se crea con otro nombre y `dropFullText()` no lo encontrará.
  Por eso cualquier política de truncado debe aplicarse en Rekkr, antes de
  enviar el DDL, y compartirse entre creación y borrado.
- Stopwords, longitud mínima de palabra, collation y configuración del servidor
  cambian qué términos coinciden.
- El orden por relevancia implícito de MySQL no debe considerarse estable para
  paginación. Si el orden importa, el consumidor debe añadir un orden explícito
  y un desempate determinista.
- Rekkr no distingue un driver `mariadb`; MariaDB usa la gramática MySQL.
- En InnoDB, el primer índice FULLTEXT de una tabla añade una columna oculta
  `FTS_DOC_ID` y reconstruye la tabla completa. En una tabla ya grande no es
  una operación barata ni instantánea.

### PostgreSQL

La consulta y el índice deben usar la misma expresión. La implementación actual
usa `concat_ws`, que no debe convertirse sin más en un índice de expresión:
PostgreSQL exige funciones inmutables en esos índices y, además, una expresión
distinta impediría al planificador reutilizar el GIN.

Merece la pena entender por qué la expresión propuesta sí es indexable, porque
es exactamente lo que se rompe al "simplificarla":

- `to_tsvector(regconfig, text)` con el idioma como literal es IMMUTABLE. La
  forma de un solo argumento, `to_tsvector(text)`, depende de
  `default_text_search_config` y solo es STABLE: no sirve para un índice.
  Por eso el idioma nunca se puede omitir en el SQL generado, aunque sea el
  valor por defecto de la API.
- `coalesce` es inmutable, así que no estropea la indexabilidad.
- `concat_ws` es STABLE, no inmutable: `CREATE INDEX` sobre ella falla con
  `functions in index expression must be marked IMMUTABLE`.

Expresión recomendada para dos columnas:

```sql
to_tsvector('english', coalesce("title", '')) ||
to_tsvector('english', coalesce("body", ''))
```

Consulta:

```sql
(
  to_tsvector('english', coalesce("title", '')) ||
  to_tsvector('english', coalesce("body", ''))
) @@ plainto_tsquery('english', $1)
```

Índice:

```sql
CREATE INDEX "articles_title_body_fulltext"
ON "articles"
USING GIN ((
  to_tsvector('english', coalesce("title", '')) ||
  to_tsvector('english', coalesce("body", ''))
))
```

El `coalesce` evita que una columna nula convierta todo el vector compuesto en
`NULL`. Este detalle debe estar presente tanto en la consulta como en el índice.

Aquí hay una divergencia deliberada respecto a Laravel, que conviene registrar
porque tiene consecuencias operativas: Laravel emite
`to_tsvector('english', "title") || to_tsvector('english', "body")` **sin**
`coalesce`, tanto en la consulta como en el índice. La expresión de Rekkr es
más correcta, pero no es intercambiable: un índice creado por una migración de
Laravel, o a mano sin `coalesce`, no será utilizable por la consulta de Rekkr y
viceversa. Si esa compatibilidad importase más que el tratamiento de `NULL`,
la decisión debe tomarse ahora, no después de que haya índices en producción.

`coalesce` aplica solo al camino normal. Con `vector: true` la columna ya es un
`tsvector` y Laravel emite únicamente el identificador envuelto: no se debe
añadir `coalesce` ahí, porque el literal `''` es `text` y obligaría a un
`''::tsvector` explícito. La regla es: `vector: true` no envuelve la columna
con nada.

Modos:

| Opción | Función PostgreSQL |
|---|---|
| sin `mode` | `plainto_tsquery` |
| `mode: "phrase"` | `phraseto_tsquery` |
| `mode: "websearch"` | `websearch_to_tsquery` |
| `mode: "raw"` | `to_tsquery` |

`websearch_to_tsquery` requiere PostgreSQL 11 o superior. Si Rekkr admite
versiones anteriores, `mode: "websearch"` debe documentarse con ese mínimo.

Idioma:

```ts
table.fullText(["title", "body"]).language("spanish");

Article.whereFullText(["title", "body"], term, {
  language: "spanish",
});
```

El idioma de la consulta debe coincidir con el del índice. Si no coincide, los
resultados pueden cambiar y PostgreSQL normalmente no podrá usar el índice.

`vector: true` significa que cada columna indicada ya es de tipo `tsvector` y
no debe envolverse de nuevo con `to_tsvector`. Rekkr todavía no tiene un tipo
`tsvector` en Blueprint; la opción puede servir para esquemas creados con SQL
externo, pero añadir una columna `tsvector` a Schema queda fuera del mínimo.

PostgreSQL filtra por coincidencia, pero no ordena automáticamente por
relevancia. Esta propuesta no añade una API de ranking; se puede usar SQL raw o
el módulo Search cuando sea necesario.

### SQLite

Mantener el comportamiento actual de consulta por compatibilidad:

```sql
("title" LIKE ? OR "body" LIKE ?)
```

con bindings equivalentes a `%term%`.

Esto no es full-text real:

- no usa stemming, tokenización ni ranking;
- no usa un índice B-tree con un patrón que empieza por `%`;
- hace un escaneo de tabla en consultas grandes;
- `%` y `_` introducidos por el usuario deben escaparse para que se traten como
  texto y no como comodines de `LIKE`. SQLite no tiene carácter de escape por
  defecto, así que escapar obliga a emitir la cláusula: el SQL pasa a ser
  `"title" LIKE ? ESCAPE '\'` y el propio carácter de escape debe duplicarse
  en el término. Hoy no existe ningún precedente de `ESCAPE` en las gramáticas
  —`compileLike()` pasa el patrón tal cual, a propósito, porque ahí los
  comodines son parte de la API— así que `whereFullText()` sería el primer
  sitio que escapa, y esa asimetría con `whereLike()` debe quedar documentada;
- su sensibilidad a mayúsculas depende de SQLite y de
  `PRAGMA case_sensitive_like`.

`table.fullText()` debe fallar claramente en SQLite antes de ejecutar ninguna
sentencia:

```text
fullText indexes are not supported by SQLite. Use the SqliteFTS5Engine.
```

No se debe intentar convertir `table.fullText()` en una tabla FTS5. Una tabla
virtual, sus triggers y su sincronización tienen un ciclo de vida distinto y ya
pertenecen al módulo `@rekkr/orm/search`.

## Validación

La API debe validar antes de generar o ejecutar SQL:

- al menos una columna;
- columnas sin cadenas vacías;
- nombre de índice seguro;
- idioma PostgreSQL dentro del allowlist;
- `mode` conocido;
- opciones compatibles con el driver;
- `expanded` incompatible con modo booleano;
- `vector` solo en PostgreSQL;
- `language` solo en PostgreSQL.

Las tres últimas necesitan una decisión explícita, porque Laravel no lanza
error en ninguna: ignora el `language` desconocido, descarta `expanded` en modo
booleano y no valida el driver. La recomendación es lanzar error en Rekkr, por
tres motivos: el idioma se interpola en SQL, una opción descartada en silencio
produce una consulta que no es la que el consumidor pidió, y en TypeScript el
error se puede dar en compilación en vez de en producción. Pero es una
divergencia de comportamiento respecto a Laravel y debe aparecer en la
documentación pública y en el changelog, no solo en los tests.

`mode` merece un matiz: su único valor de MySQL es `"boolean"`, y `"phrase"`,
`"websearch"` y `"raw"` son de PostgreSQL. Un `mode` válido para el driver
equivocado debe fallar igual que uno desconocido; si no, `mode: "boolean"`
sobre PostgreSQL caería en `plainto_tsquery` y devolvería resultados plausibles
pero equivocados.

El término de búsqueda siempre debe ser un binding. Nunca debe interpolarse en
SQL. Las columnas y nombres de índice deben pasar por el wrapper de
identificadores del driver.

Decisión recomendada para términos vacíos: rechazarlos si, después de `trim()`,
no contienen texto. Hoy el fallback SQLite convertiría una cadena vacía en
`LIKE '%%'` y devolvería todas las filas, mientras los motores nativos tienen
otra semántica. Una validación común evita esa diferencia peligrosa. Si se
prioriza compatibilidad absoluta con el comportamiento actual, debe documentarse
la divergencia y dejar la validación para una major.

## Qué hay que implementar

### 1. Tipos

En `src/types/index.ts`:

- añadir las opciones full-text al `WhereClause`;
- ampliar `IndexDefinition` con un tipo de índice (`index`, `unique` o
  `fulltext`) y el idioma opcional;
- evitar mutar el objeto de opciones recibido: guardar una copia.

En la API pública:

- exportar `FullTextOptions` y `PostgresFullTextLanguage`;
- mantener `readonly` en las listas de columnas.

### 2. Builder

En `src/query/Builder.ts`:

- cambiar las firmas públicas para recibir `FullTextOptions`;
- conservar temporalmente la sobrecarga anterior si se exige compatibilidad
  minor;
- mover `boolean` y `not` a un helper privado;
- pasar `boolean` por `validBoolean()`, como hacen `whereAll()` y `whereAny()`;
  hoy `whereFullText()` es el único `where` que no lo hace;
- almacenar las opciones en la cláusula;
- pasar las opciones a `compileFullText()`;
- mantener invalidación de caché SQL y bindings parametrizados;
- escapar los comodines del fallback SQLite.

En `src/model/ModelQuerying.ts`:

- añadir el tercer argumento a `whereFullText()` y `orWhereFullText()`;
- preservar IntelliSense de columnas del modelo y arrays `as const`.

### 3. Gramáticas de consulta

Cambiar la firma común:

```ts
compileFullText(
  columns: string[],
  value: string,
  options: FullTextOptions,
  binding?: (value: unknown) => string,
): string;
```

- MySQL: lenguaje natural, booleano y query expansion.
- PostgreSQL: idioma, `plain`, `phrase`, `websearch`, `raw` y `vector`.
- PostgreSQL: usar una expresión indexable, nula-segura e idéntica a Schema.
- SQLite: fallback agrupado; rechazar opciones que no puede representar.

`columns` llega **ya envuelto** desde `Builder` (`src/query/Builder.ts:1869`);
conviene decirlo en el JSDoc de la firma abstracta, porque es justo el punto en
el que la gramática de consulta y la de Schema difieren: Schema construye la
misma expresión a partir de nombres **sin envolver**. El helper compartido debe
recibir por tanto identificadores ya envueltos y dejar el envoltorio en manos
de cada llamante, o el índice y la consulta divergirán por comillas duplicadas.
De paso, `SQLiteGrammar.compileFullText()` debería dejar de re-envolver: hoy
funciona solo por la idempotencia de `unwrapIdentifier()`.

La expresión PostgreSQL debería salir de un helper compartido pequeño entre la
gramática de consulta y la de Schema. Aquí la reutilización sí evita un bug
real: una diferencia mínima entre ambas expresiones desactiva el índice.

### 4. Blueprint y Schema

En `src/schema/Blueprint.ts`:

- implementar `fullText()`;
- implementar `dropFullText()`;
- añadir el builder mínimo para `.language()`;
- generar nombres compatibles con Laravel.

En las gramáticas de Schema:

- MySQL: compilar `FULLTEXT INDEX`;
- PostgreSQL: compilar un índice de expresión `USING GIN`;
- SQLite: lanzar un error explícito.

`Grammar.compileIndex()` no vale como punto de extensión: envuelve cada columna
con `wrapArray()` y produce siempre `CREATE [UNIQUE] INDEX ... (cols)`, forma
que no puede expresar ni una expresión GIN ni el `ALTER TABLE ... ADD FULLTEXT`
de MySQL. Hace falta una rama por tipo de índice en `compileIndexes()`, y que
`IndexDefinition` lleve el discriminante para elegirla.

En `src/schema/Schema.ts`:

- compilar CREATE, índices y foreign keys por completo antes de ejecutar la
  primera sentencia. Actualmente `Schema.create()` crea la tabla antes de
  compilar los índices; un full-text no soportado podría dejar una tabla a
  medio migrar. `Schema.createIfNotExists()` tiene exactamente el mismo
  problema y se suele olvidar. `Schema.table()` ya lo hace bien
  (`src/schema/Schema.ts:215-267`): basta con copiar ese patrón de acumular en
  `statements` y ejecutar al final.
- tratar `dropFullText()` como un drop de índice, conservando la derivación del
  nombre cuando se reciben columnas;
- corregir la cualificación de schema al borrar índices PostgreSQL. La rama
  actual emite `DROP INDEX IF EXISTS` sobre
  `connection.qualifyTable(indexName)`, que antepone el schema **por defecto de
  la conexión**, no el de la tabla afectada: en
  `Schema.table("analytics.articles", ...)` intentaría borrar
  `public.articles_title_body_fulltext`. Con `IF EXISTS` no da error, solo no
  borra nada, que es el modo más incómodo de fallar. El schema debe salir del
  nombre cualificado de la tabla.

La introspección PostgreSQL también necesita atención, y el fallo es más grave
de lo que parece. En `Schema.getIndexes()`, cada posición de expresión aparece
en `ix.indkey` con `attnum = 0`, que no corresponde a ninguna fila de
`pg_attribute`; como el `JOIN` es interno, esas filas se descartan y el índice
GIN desaparece por completo del resultado. `Schema.hasIndex()` se apoya en
`getIndexes()`, así que devolvería `false` para un índice que sí existe, y una
migración que use eso para decidir si crear el índice lo intentaría dos veces.

La corrección es un `LEFT JOIN` sobre `pg_attribute` y resolver el texto de las
posiciones de expresión con
`pg_get_indexdef(ix.indexrelid, k.ordinality::int, true)`. Conviene además
añadir un discriminante a `SchemaIndex` para que quien consuma la lista
distinga un full-text de un índice ordinario.

MySQL no necesita nada: `information_schema.statistics` ya devuelve los índices
FULLTEXT con sus columnas y `non_unique = 1`, así que `getIndexes()` los ve hoy.
La asimetría es solo de PostgreSQL.

`Schema.hasIndex(columns)` seguirá sin poder identificar un índice de expresión
por su lista de columnas ni siquiera después de la corrección: la comprobación
por nombre es la única forma fiable, y así debe documentarse.

### 5. Documentación pública

Actualizar:

- `docs/query-builder.md` con opciones y diferencias por driver;
- `docs/schema-builder.md` con creación y borrado del índice;
- `docs/search.md` para explicar cuándo usar `whereFullText` y cuándo usar el
  motor Search/FTS5;
- changelog de la versión correspondiente.

## Casos de uso

### Búsqueda de contenido publicado

```ts
await Article
  .where("published", true)
  .whereFullText(["title", "body"], term)
  .latest()
  .get();
```

### Búsqueda alternativa

```ts
await Article.where((query) => {
  query
    .whereFullText("title", term)
    .orWhereFullText("body", term);
}).get();
```

Agrupar el OR es importante cuando hay scopes globales o filtros de seguridad.

### Sintaxis avanzada MySQL

```ts
await Article.whereFullText(["title", "body"], "+bun -legacy", {
  mode: "boolean",
}).get();
```

### Búsqueda web PostgreSQL

```ts
await Article.whereFullText(["title", "body"], 'bun orm -legacy', {
  mode: "websearch",
  language: "english",
}).get();
```

### Cuándo no usar esta API

Usar `@rekkr/orm/search` en lugar de `whereFullText()` cuando se necesite:

- tolerancia a errores tipográficos;
- resaltado y snippets;
- facets;
- puntuación uniforme entre drivers;
- búsqueda geográfica;
- SQLite FTS5 indexado;
- sincronización con Meilisearch;
- búsqueda en varios índices.

## Posibles fallos y regresiones

### Funcionales

- Crear el índice sobre unas columnas y consultar otra combinación en MySQL.
- Usar distinto idioma en el índice y la consulta PostgreSQL.
- No tratar `NULL` en una expresión PostgreSQL multicolumna.
- Desagrupar las columnas SQLite y cambiar la precedencia de `AND`/`OR`.
- Mutar el objeto `options` después de construir la consulta y alterar SQL ya
  cacheado.
- Perder el modelo o sus tipos al usar el forwarding estático.
- No detectar índices de expresión mediante `Schema.hasIndex()`.
- Dejar una tabla creada después de que falle la compilación del índice.
- Borrar un índice del schema equivocado en PostgreSQL.
- Tratar `%` o `_` del usuario como comodines en SQLite.
- Construir un nombre automático que supere los límites del driver. Se debe
  permitir siempre un nombre explícito; cualquier política automática de
  truncado debe ser determinista y compartida con `dropFullText()`.

### Semántica de búsqueda

- Full-text busca tokens, no substrings arbitrarios.
- Stemming, stopwords y longitud mínima producen resultados distintos por
  driver.
- `mode: "raw"` de PostgreSQL puede lanzar errores por sintaxis `tsquery`
  inválida; el error de base de datos debe conservar contexto.
- MySQL boolean mode usa operadores propios (`+`, `-`, `*`, comillas).
- Un término vacío no tiene semántica portable.
- La ordenación implícita de relevancia no es portable ni suficiente para una
  paginación determinista.

### Rendimiento

- MySQL y PostgreSQL acelerarán lecturas cuando el índice coincida, pero cada
  INSERT/UPDATE deberá mantenerlo y consumirá más disco.
- Crear el índice en una tabla grande puede bloquear o degradar escrituras.
  `online()`/`CONCURRENTLY` no forma parte del mínimo y debería tratarse en una
  mejora separada porque cambia las reglas transaccionales de las migraciones.
- El fallback SQLite seguirá siendo O(n) y no debe presentarse como solución
  para tablas grandes.
- Calcular `to_tsvector` no debería repetirse fuera de la expresión indexable.
  Un `EXPLAIN` debe confirmar que el GIN se puede usar.
- Añadir opciones al compilador es coste despreciable; la regresión real puede
  venir del mantenimiento del índice o de que consulta e índice no coincidan.

## Plan de tests

### Tipos

- columnas válidas autocompletan en Builder y modelo estático;
- una columna desconocida falla en TypeScript;
- arrays `as const` son aceptados;
- todas las opciones válidas compilan;
- modos e idiomas inválidos fallan en TypeScript cuando sea posible.

### Gramáticas unitarias

MySQL/MariaDB:

- una y varias columnas;
- modo natural por defecto;
- modo booleano;
- query expansion;
- booleano más expansion no genera SQL inválido;
- bindings y `toRawSql()`;
- nombres cualificados y escapado.

PostgreSQL:

- inglés/plainto por defecto;
- idioma alternativo;
- phrase, websearch y raw;
- `vector: true`;
- una columna nula no anula el vector compuesto;
- la expresión de la consulta coincide con la del índice GIN;
- término parametrizado.

SQLite:

- una columna;
- varias columnas dentro de un único grupo;
- interacción con `where()` y `orWhereFullText()`;
- `%`, `_` y el carácter de escape se buscan literalmente;
- el SQL incluye la cláusula `ESCAPE` cuando se escapa el término;
- opciones nativas no soportadas producen un error claro;
- `table.fullText()` falla antes de crear o modificar tablas.

### Schema

- nombre automático y nombre explícito;
- índice compuesto;
- `.language()` PostgreSQL;
- SQL MySQL `FULLTEXT INDEX`;
- SQL PostgreSQL `USING GIN`;
- `dropFullText()` por nombre y por columnas;
- create, alter y rollback;
- schema PostgreSQL cualificado;
- `Schema.getIndexes()` y `Schema.hasIndex()` detectan el índice;
- `getIndexes()` sigue devolviendo el resto de índices de la tabla cuando
  existe uno de expresión: es la regresión que oculta el `JOIN` interno actual
  y no se ve si el test solo busca el índice full-text;
- borrar el índice de una tabla en un schema PostgreSQL no público lo borra de
  verdad, comprobándolo con `getIndexes()` y no solo por ausencia de error;
- `migrate --pretend` muestra el DDL sin ejecutarlo;
- una compilación fallida no deja cambios parciales, tanto en `Schema.create()`
  como en `Schema.createIfNotExists()`.

### Integración real

- MySQL y PostgreSQL encuentran términos presentes en título, body o ambos;
- `whereFullText` y `orWhereFullText` combinan bien con filtros normales;
- índice y query funcionan tras una migración completa y su rollback;
- consultas concurrentes solo leen y no alteran estado;
- términos con comillas, operadores, Unicode y contenido hostil siguen siendo
  bindings;
- usar palabras únicas suficientemente largas para no depender de stopwords ni
  de la longitud mínima configurada en MySQL;
- una fila con una columna indexada a `NULL` sigue siendo encontrada por el
  texto de las demás: es la comprobación real del `coalesce`, y en PostgreSQL
  el SQL sin él pasa igualmente los tests unitarios de cadena.

No conviene afirmar que un plan usa un índice basándose únicamente en tiempos.
Para PostgreSQL se debe inspeccionar `EXPLAIN` en condiciones controladas o la
definición de `pg_indexes`; para MySQL, `EXPLAIN` y
`information_schema.statistics`.

## Criterios de aceptación

- [x] `table.fullText()` crea índices nativos en MySQL/MariaDB y PostgreSQL.
- [x] `table.dropFullText()` permite migraciones reversibles.
- [x] `.language()` controla de forma consistente índice y consulta PostgreSQL.
- [x] `whereFullText()` y `orWhereFullText()` aceptan opciones Laravel 13.
- [x] Los valores continúan siempre parametrizados.
- [x] Consulta e índice PostgreSQL comparten exactamente la expresión.
- [x] SQLite conserva su fallback documentado y rechaza índices nativos.
- [x] Los fallos de compilación de Schema no dejan cambios parciales.
- [x] La introspección reconoce índices full-text y no pierde los demás.
- [x] Las divergencias deliberadas respecto a Laravel (`coalesce`, opciones
      inválidas que lanzan error en vez de ignorarse) están documentadas.
- [x] Tests unitarios, de tipos e integración pasan en los tres drivers.
- [x] Benchmarks no muestran regresión fuera de escrituras que mantienen un
      índice full-text opt-in.

## Fuera de alcance

- API propia de ranking o `orderByRelevance()`.
- highlights, snippets y facets.
- creación automática de tablas virtuales SQLite FTS5.
- columnas PostgreSQL `tsvector` generadas desde Blueprint.
- pesos PostgreSQL A/B/C/D.
- migraciones online o `CREATE INDEX CONCURRENTLY`.
- reemplazar el módulo `@rekkr/orm/search`.

Estas mejoras pueden añadirse después sin bloquear la API mínima de Laravel.

## Fuentes

- [Laravel 13: Full Text Where Clauses](https://laravel.com/framework/docs/13.x/queries#full-text-where-clauses)
- [Laravel 13: índices en migraciones](https://laravel.com/framework/docs/13.x/migrations#creating-indexes)
- [Laravel 13 API: Query Builder](https://api.laravel.com/docs/13.x/Illuminate/Database/Query/Builder.html)
- [Laravel 13 API: Schema Blueprint](https://api.laravel.com/docs/13.x/Illuminate/Database/Schema/Blueprint.html)
- [Laravel 13: Database Search](https://laravel.com/framework/docs/13.x/search#full-text-search)
- [Laravel 13 MySQL query grammar](https://github.com/laravel/framework/blob/13.x/src/Illuminate/Database/Query/Grammars/MySqlGrammar.php)
- [Laravel 13 PostgreSQL query grammar](https://github.com/laravel/framework/blob/13.x/src/Illuminate/Database/Query/Grammars/PostgresGrammar.php)
- [Laravel 13 PostgreSQL schema grammar](https://github.com/laravel/framework/blob/13.x/src/Illuminate/Database/Schema/Grammars/PostgresGrammar.php)
