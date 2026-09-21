import { beforeEach, describe, expect, test } from "bun:test";
import { Connection, Model, MorphMap, Schema } from "../src/index.js";

/**
 * `MorphTo` tenía rama en `LoadedRelationValueForPaths` pero no en
 * `LoadedTypeWithNested` ni en `RelModelOf`, que son los que usa la forma de
 * mapa de restricciones de `with()`. Resultado: `with({ rel: cb })` sobre un
 * `morphTo` devolvía `unknown`, mientras que `with("rel")` devolvía bien.
 *
 * El modelo relacionado sí es `Model` a secas y no un modelo concreto: eso no
 * es un fallo, es lo que significa polimórfico — `morphTo()` no es genérico a
 * propósito, porque el destino cambia fila a fila.
 */

interface MtPostAttributes {
  id: number;
  title: string;
}

interface MtCommentAttributes {
  id: number;
  body: string;
  commentable_id: number;
  commentable_type: string;
  author_id: number;
}

class MtPost extends Model.define<MtPostAttributes>("mt_posts") {
  static timestamps = false;
  static guarded: string[] = [];
}

class MtAuthor extends Model.define<{ id: number; name: string }>("mt_authors") {
  static timestamps = false;
  static guarded: string[] = [];
}

class MtComment extends Model.define<MtCommentAttributes>("mt_comments") {
  static timestamps = false;
  static guarded: string[] = [];

  commentable() {
    return this.morphTo("commentable");
  }

  /** Hermana no polimórfica, como referencia de lo que ya funcionaba. */
  author() {
    return this.belongsTo(MtAuthor, "author_id");
  }
}

/**
 * Comprobaciones de tipo puras: nunca se ejecutan, las verifica `tsc`. Contra
 * `12f1dff`, `c.commentable` salía `unknown` y ninguna de estas líneas
 * compilaba.
 */
function soloTipos(): void {
  async function conMapaDeRestricciones() {
    const c = await MtComment.with({ commentable: (query) => query }).findOrFail(1);

    // Antes: `unknown`. Ahora: `Model | null`, como la forma de string.
    const padre: Model | null = c.commentable;
    void padre;

    // Y al estrechar, es un modelo de verdad: `unknown` no tiene `getAttribute`.
    if (c.commentable) {
      const titulo: unknown = c.commentable.getAttribute("title");
      void titulo;
    }

    // @ts-expect-error un morphTo cargado puede no tener destino
    c.commentable.getAttribute("title");

    // La hermana belongsTo sigue dando el modelo concreto, no `Model`.
    const b = await MtComment.with({ author: (query) => query }).findOrFail(1);
    const nombre: string | undefined = b.author?.name;
    void nombre;
  }
  void conMapaDeRestricciones;
}
void soloTipos;

describe("morphTo en la forma de mapa de restricciones", () => {
  let connection: Connection;

  beforeEach(async () => {
    connection = new Connection({ url: "sqlite://:memory:" });
    Model.setConnection(connection);
    Schema.setConnection(connection);
    MorphMap.register("MtPost", MtPost);
    await Schema.create("mt_posts", (table) => {
      table.increments("id");
      table.string("title");
    });
    await Schema.create("mt_authors", (table) => {
      table.increments("id");
      table.string("name");
    });
    await Schema.create("mt_comments", (table) => {
      table.increments("id");
      table.string("body");
      table.integer("commentable_id");
      table.string("commentable_type");
      table.integer("author_id");
    });
    await MtPost.insert([{ title: "Primero" }, { title: "Segundo" }]);
    await MtAuthor.insert([{ name: "Ada" }]);
    await MtComment.insert([
      { body: "a", commentable_id: 1, commentable_type: "MtPost", author_id: 1 },
      { body: "b", commentable_id: 2, commentable_type: "MtPost", author_id: 1 },
      // Apunta a una fila que no existe: el destino tiene que salir null.
      { body: "huérfano", commentable_id: 99, commentable_type: "MtPost", author_id: 1 },
    ]);
  });

  test("carga el destino polimórfico y deja null el que no lo tiene", async () => {
    const comentarios = await MtComment.with({ commentable: (query) => query }).get();
    expect(comentarios.map((c) => c.commentable?.getAttribute("title") ?? null)).toEqual([
      "Primero",
      "Segundo",
      null,
    ]);
    expect(comentarios[2]!.commentable).toBeNull();
  });

  test("el callback del mapa se ejecuta sobre la relación, no se ignora", async () => {
    // El callback de un morphTo recibe la propia relación (`morphWith`,
    // `morphWithCount`), no un Builder: la consulta se parte por tipo.
    let invocaciones = 0;
    const comentarios = await MtComment.with({
      commentable: (relation) => {
        invocaciones++;
        return relation;
      },
    }).get();
    expect(invocaciones).toBe(1);
    expect(comentarios[0]!.commentable?.getAttribute("title")).toBe("Primero");
  });

  test("no pisa a la relación hermana cargada en la misma llamada", async () => {
    const comentario = await MtComment.with({
      commentable: (query) => query,
      author: (query) => query,
    }).findOrFail(1);
    expect(comentario.commentable?.getAttribute("title")).toBe("Primero");
    expect(comentario.author?.name).toBe("Ada");

    // Y cargar sólo la hermana no deja el morphTo a medio resolver.
    const soloAutor = await MtComment.with({ author: (query) => query }).findOrFail(1);
    expect(soloAutor.relationLoaded("author")).toBe(true);
    expect(soloAutor.relationLoaded("commentable")).toBe(false);
  });

  test("la forma de string y la de mapa cargan lo mismo", async () => {
    const porString = await MtComment.with("commentable").findOrFail(1);
    const porMapa = await MtComment.with({ commentable: (query) => query }).findOrFail(1);
    expect(porMapa.commentable?.getAttribute("title")).toBe(porString.commentable?.getAttribute("title"));
  });
});
