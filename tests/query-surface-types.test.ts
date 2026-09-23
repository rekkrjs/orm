import { beforeEach, describe, expect, test } from "./harness.js";
import { Collection, Connection, Model, Schema, type ModelKey } from "../src/index.js";
import { Events } from "../src/events/index.js";

/**
 * La frontera pública del API de consulta: los estáticos del modelo deben tipar
 * lo mismo que sus equivalentes de `Builder`, las claves deben ser `ModelKey` y
 * los callbacks que el ORM espera con `await` deben aceptar flechas concisas.
 */

interface SurfaceUserAttributes {
  id: number;
  parent_id: number | null;
  name: string;
  created_at: Date;
}

interface SurfacePostAttributes {
  id: number;
  user_id: number;
  title: string;
}

class SurfacePost extends Model.define<SurfacePostAttributes>("surface_posts") {
  static timestamps = false;
  static guarded: string[] = [];
}

class SurfaceUser extends Model.define<SurfaceUserAttributes>("surface_users") {
  static timestamps = false;
  static guarded: string[] = [];

  posts() {
    return this.hasMany(SurfacePost, "user_id");
  }

  /** Relación con restricciones encadenadas: se replican al cargar y al contar. */
  firstPost() {
    return this.hasMany(SurfacePost, "user_id").whereIn("id", [1]).orderBy("id", "desc").limit(1);
  }

  children() {
    return this.hasMany(SurfaceUser, "parent_id");
  }
}

class SurfaceEvent {
  constructor(public readonly id: number) {}
}

/**
 * Comprobaciones de tipo puras: nunca se ejecutan, las verifica `tsc`. Cada
 * `@ts-expect-error` compilaba limpio cuando el parámetro era `any`; si alguien
 * lo relaja, la directiva sobra y el typecheck de la suite lo dice.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function soloTipos(): void {
  // @ts-expect-error un objeto no es una clave
  SurfaceUser.whereKey({ id: 1 });
  // @ts-expect-error un booleano no es una clave
  SurfaceUser.whereKeyNot(true);
  // @ts-expect-error una fecha no es una clave
  SurfaceUser.query().orWhereKey(new Date());
  // @ts-expect-error los ids son claves
  SurfaceUser.query().findMany([{ id: 1 }]);

  // @ts-expect-error se esperaba una columna, no un valor
  SurfaceUser.wherePast(42);
  // @ts-expect-error se esperaba una columna, no una fecha
  SurfaceUser.whereFuture(new Date());

  // @ts-expect-error `id` es numérica
  SurfaceUser.orWhereIn("id", ["1"]);
  // @ts-expect-error `id` es numérica
  SurfaceUser.orWhereNotIn("id", [true]);

  // @ts-expect-error un objeto no es una clave
  SurfaceUser.descendants({ id: 1 });
  // @ts-expect-error un objeto no es una clave
  SurfaceUser.ancestors({ id: 1 });
  // @ts-expect-error un objeto no es una clave
  SurfaceUser.recursive("parent_id", { id: 1 });

  // @ts-expect-error un objeto no es una clave
  SurfaceUser.query().find({ id: 1 });
  // @ts-expect-error un objeto no es una clave
  SurfaceUser.query().findOrNew({ id: 1 });
  // @ts-expect-error un objeto no es una clave
  new SurfaceUser().posts().find({ id: 1 });
  // @ts-expect-error `id` de SurfacePost es numérica
  new SurfaceUser().posts().whereIn("id", ["1"]);
  // @ts-expect-error se esperaba una columna, no un número
  new SurfaceUser().posts().where(42, "x");

  SurfaceUser.orWhereHas("posts", (query) => {
    // @ts-expect-error `id` de SurfacePost es numérica: el callback ya no es Builder<any>
    query.whereIn("id", ["1"]);
  });

  const users = null as unknown as Collection<SurfaceUser>;
  // @ts-expect-error un objeto no es una clave
  users.find({ id: 1 });
  // @ts-expect-error un objeto no es una clave
  users.findOrFail({ id: 1 });
  // @ts-expect-error las claves ya no son `any[]`
  const upper: string[] = users.modelKeys();
  void upper;
}
void soloTipos;

describe("frontera pública del API de consulta", () => {
  let connection: Connection;

  beforeEach(async () => {
    connection = new Connection({ url: "sqlite://:memory:" });
    Model.setConnection(connection);
    Schema.setConnection(connection);
    await Schema.create("surface_users", (table) => {
      table.increments("id");
      table.integer("parent_id").nullable();
      table.string("name");
      table.timestamp("created_at").nullable();
    });
    await Schema.create("surface_posts", (table) => {
      table.increments("id");
      table.integer("user_id");
      table.string("title");
    });
    await SurfaceUser.insert([
      { name: "Ada", parent_id: null },
      { name: "Linus", parent_id: 1 },
      { name: "Grace", parent_id: 2 },
    ]);
    await SurfacePost.insert([
      { user_id: 1, title: "primero" },
      { user_id: 1, title: "segundo" },
    ]);
  });

  test("whereKey y familia siguen consultando por la clave primaria", async () => {
    expect(await SurfaceUser.whereKey(1).value("name")).toBe("Ada");
    expect((await SurfaceUser.whereKey([1, 3]).get()).length).toBe(2);
    expect((await SurfaceUser.whereKeyNot(1).get()).length).toBe(2);
    expect((await SurfaceUser.query().orWhereKey(2n).get()).length).toBe(1);
    expect((await SurfaceUser.query().findMany([1, 2])).length).toBe(2);
  });

  test("las columnas temporales llegan a la consulta", () => {
    expect(SurfaceUser.wherePast("created_at").toSql()).toContain("created_at");
    expect(SurfaceUser.whereTodayOrAfter(["created_at"]).toSql()).toContain("created_at");
  });

  test("orWhereIn tipa los valores por columna y sigue devolviendo la unión", async () => {
    const users = await SurfaceUser.whereKey(1).orWhereIn("id", [2, 3]).get();
    expect(users.modelKeys()).toEqual([1, 2, 3]);
    expect((await SurfaceUser.whereKey(1).orWhereNotIn("id", [1, 2]).get()).length).toBe(2);
  });

  test("los puntos de partida del árbol son claves", async () => {
    expect((await SurfaceUser.descendants(1).get()).modelKeys()).toEqual([1, 2, 3]);
    expect((await SurfaceUser.ancestors(3).get()).modelKeys()).toEqual([3, 2, 1]);
    expect((await SurfaceUser.recursive("parent_id", [2]).get()).modelKeys()).toEqual([2, 3]);
  });

  test("las consultas de relación tipan clave y columna", async () => {
    const ada = await SurfaceUser.findOrFail(1);
    expect((await ada.posts().find(2))?.title).toBe("segundo");
    expect((await ada.posts().whereIn("id", [1]).get()).length).toBe(1);
    expect((await ada.posts().where("title", "primero").get()).modelKeys()).toEqual([1]);
    expect((await SurfaceUser.query().findSole(["u-inexistente", 3])).name).toBe("Grace");
  });

  test("whereIn, orderBy y limit de una relación filtran también la consulta directa", async () => {
    const ada = await SurfaceUser.findOrFail(1);
    expect((await ada.posts().get()).modelKeys()).toEqual([1, 2]);
    expect((await ada.posts().whereIn("id", [2]).get()).modelKeys()).toEqual([2]);
    expect((await ada.posts().orderBy("id", "desc").get()).modelKeys()).toEqual([2, 1]);
    expect((await ada.posts().limit(1).get()).modelKeys()).toEqual([1]);

    // Y la réplica sobre un builder nuevo sigue aplicándose una sola vez: si se
    // duplicara, el conteo y la carga ansiosa no cuadrarían con la consulta directa.
    expect((await ada.firstPost().get()).modelKeys()).toEqual([1]);
    const counted = await SurfaceUser.withCount("firstPost").findOrFail(1);
    expect(counted.getAttribute("firstPost_count")).toBe(1);
    const loaded = await SurfaceUser.with("firstPost").findOrFail(1);
    expect(loaded.getRelation("firstPost").modelKeys()).toEqual([1]);

    // Y no tocan al vecino: Linus no tiene posts y sigue sin tenerlos.
    const linus = await SurfaceUser.findOrFail(2);
    expect((await linus.posts().whereIn("id", [1, 2]).get()).length).toBe(0);
  });

  test("orWhereHas tipa el callback con el modelo relacionado", async () => {
    const users = await SurfaceUser.whereKey(3).orWhereHas("posts", (query) => {
      query.whereIn("id", [1, 2]);
    }).get();
    expect(users.modelKeys()).toEqual([1, 3]);
  });

  test("Collection.find recibe claves y modelKeys devuelve claves", async () => {
    const users = await SurfaceUser.all();
    const keys: ModelKey[] = users.modelKeys();
    expect(keys).toEqual([1, 2, 3]);
    expect(users.find(2)?.name).toBe("Linus");
    expect(users.find([1, 2]).length).toBe(2);
    expect(users.find((user) => user.name === "Grace")?.id).toBe(3);
    expect(users.findOrFail(3).name).toBe("Grace");
  });

  test("los callbacks que se esperan con await aceptan flechas concisas", async () => {
    const seen: number[] = [];

    // Sin el retorno `void` a secas, `push` (que devuelve number) no compila.
    await SurfaceUser.each(2, (user) => seen.push(user.id));
    expect(seen).toEqual([1, 2, 3]);

    seen.length = 0;
    await SurfaceUser.query().chunk(2, (chunk) => seen.push(chunk.length));
    expect(seen).toEqual([2, 1]);

    // Y la forma asíncrona sigue esperándose: el orden lo demuestra.
    seen.length = 0;
    await SurfaceUser.eachById(2, async (user) => {
      await Promise.resolve();
      seen.push(user.id);
    });
    expect(seen).toEqual([1, 2, 3]);
  });

  test("los listeners de eventos aceptan flechas concisas y siguen esperándose", async () => {
    const seen: number[] = [];
    Events.clear(SurfaceEvent);

    const off = Events.listen(SurfaceEvent, (event) => seen.push(event.id));
    await Events.dispatch(new SurfaceEvent(7));
    expect(seen).toEqual([7]);

    off();
    await Events.dispatch(new SurfaceEvent(8));
    expect(seen).toEqual([7]);

    const order: string[] = [];
    Events.listen(SurfaceEvent, async () => {
      await Promise.resolve();
      order.push("listener");
    });
    await Events.dispatch(new SurfaceEvent(9));
    order.push("after-dispatch");
    expect(order).toEqual(["listener", "after-dispatch"]);

    Events.clear(SurfaceEvent);
  });
});
