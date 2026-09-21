import { beforeEach, describe, expect, test } from "bun:test";
import { Collection, Connection, Model, Schema } from "../src/index.js";

/**
 * `hasManyThrough` y `hasOneThrough` eran las dos únicas relaciones sin rama
 * propia en los mapeos de tipo de `ModelBase`: caían en el `Relation<infer R>`
 * genérico y salían como `Collection<T> | T`, sin `| null`. Y `HasOneThrough`
 * heredaba de `HasManyThrough` un `get(): Promise<Collection<T>>` que mentía:
 * en runtime devuelve un modelo o `null`.
 */

interface CountryAttributes {
  id: number;
  name: string;
}

interface TeamAttributes {
  id: number;
  country_id: number;
  name: string;
}

interface MemberAttributes {
  id: number;
  team_id: number;
  name: string;
}

class Member extends Model.define<MemberAttributes>("through_members") {
  static timestamps = false;
  static guarded: string[] = [];
}

class Team extends Model.define<TeamAttributes>("through_teams") {
  static timestamps = false;
  static guarded: string[] = [];

  members() {
    return this.hasMany(Member, "team_id");
  }
}

class Country extends Model.define<CountryAttributes>("through_countries") {
  static timestamps = false;
  static guarded: string[] = [];

  /** Claves explícitas. */
  members() {
    return this.hasManyThrough(Member, Team, "country_id", "team_id");
  }

  /** Los mismos saltos, pero de uno. */
  firstMember() {
    return this.hasOneThrough(Member, Team, "country_id", "team_id");
  }

  /** Claves por defecto: `country_id` en teams, `team_id` en members. */
  defaultMembers() {
    return this.hasManyThrough(Member, Team);
  }

  /** Relación hermana directa, para comprobar que no se contamina. */
  teams() {
    return this.hasMany(Team, "country_id");
  }
}

/**
 * Comprobaciones de tipo puras: nunca se ejecutan, las verifica `tsc`. Contra
 * el estado anterior, cada línea de aquí o no compilaba o dejaba su
 * `@ts-expect-error` sin usar.
 */
function soloTipos(): void {
  const pais = null as unknown as Country;

  // `hasManyThrough().get()` es una colección: tiene `length`.
  const muchos: Promise<number> = pais.members().get().then((m) => m.length);
  void muchos;

  // `hasOneThrough().get()` es un modelo o null, no una colección.
  // Antes se heredaba `Promise<Collection<T>>` y esto era un `Collection`.
  const uno: Promise<string | undefined> = pais.firstMember().get().then((m) => m?.name);
  void uno;

  async function cargadas() {
    const conMuchos = await Country.with("members").findOrFail(1);
    // Antes salía `Collection<Member> | Member` y `length` no compilaba.
    const n: number = conMuchos.members.length;
    void n;

    const conUno = await Country.with("firstMember").findOrFail(1);
    // Antes salía `Collection<Member> | Member`: ni `?.name` compilaba ni
    // había `| null` que obligara a comprobarlo.
    const nombre: string | undefined = conUno.firstMember?.name;
    void nombre;

    // @ts-expect-error una hasOneThrough cargada puede ser null
    conUno.firstMember.name;
    // @ts-expect-error `get()` de hasOneThrough ya no devuelve una colección
    (await pais.firstMember().get()).length;
  }
  void cargadas;
}
void soloTipos;

describe("relaciones Through", () => {
  let connection: Connection;

  beforeEach(async () => {
    connection = new Connection({ url: "sqlite://:memory:" });
    Model.setConnection(connection);
    Schema.setConnection(connection);
    await Schema.create("through_countries", (table) => {
      table.increments("id");
      table.string("name");
    });
    await Schema.create("through_teams", (table) => {
      table.increments("id");
      table.integer("country_id");
      table.string("name");
    });
    await Schema.create("through_members", (table) => {
      table.increments("id");
      table.integer("team_id");
      table.string("name");
    });
    await Country.insert([{ name: "ES" }, { name: "PT" }, { name: "IT" }]);
    await Team.insert([
      { country_id: 1, name: "ES-A" },
      { country_id: 1, name: "ES-B" },
      { country_id: 2, name: "PT-A" },
      // IT (id 3) se queda sin equipos a propósito.
    ]);
    await Member.insert([
      { team_id: 1, name: "Ada" },
      { team_id: 1, name: "Grace" },
      { team_id: 2, name: "Linus" },
      { team_id: 3, name: "Alan" },
    ]);
  });

  test("hasManyThrough devuelve una Collection con los modelos lejanos", async () => {
    const es = await Country.findOrFail(1);
    const miembros = await es.members().get();
    expect(miembros).toBeInstanceOf(Collection);
    expect(miembros.map((m) => m.name)).toEqual(["Ada", "Grace", "Linus"]);

    // Y no arrastra a los del vecino: Alan es de PT, no de ES.
    expect(miembros.map((m) => m.name)).not.toContain("Alan");
  });

  test("hasOneThrough devuelve un modelo, no una colección", async () => {
    const es = await Country.findOrFail(1);
    const primero = await es.firstMember().get();
    expect(primero).toBeInstanceOf(Member);
    expect(primero).not.toBeInstanceOf(Collection);
    expect(primero?.name).toBe("Ada");
    // La mentira concreta que se arregló: `get()` prometía `Collection`.
    expect((primero as unknown as { length?: number }).length).toBeUndefined();
  });

  test("hasOneThrough devuelve null cuando no hay nada al final del salto", async () => {
    const it = await Country.findOrFail(3);
    expect(await it.firstMember().get()).toBeNull();
    expect(await it.firstMember().getResults()).toBeNull();
    // Y la variante de muchos, vacía pero Collection.
    const vacia = await it.members().get();
    expect(vacia).toBeInstanceOf(Collection);
    expect(vacia).toHaveLength(0);
  });

  test("las claves por defecto saltan igual que las explícitas", async () => {
    const es = await Country.findOrFail(1);
    const explicitas = (await es.members().get()).modelKeys();
    const porDefecto = (await es.defaultMembers().get()).modelKeys();
    expect(porDefecto).toEqual(explicitas);
    expect(porDefecto).toEqual([1, 2, 3]);
  });

  test("la carga ansiosa reparte por país y no mezcla vecinos", async () => {
    const paises = await Country.with("members", "firstMember").get();
    expect(paises.map((p) => p.members.map((m) => m.name))).toEqual([
      ["Ada", "Grace", "Linus"],
      ["Alan"],
      [],
    ]);
    expect(paises.map((p) => p.firstMember?.name ?? null)).toEqual(["Ada", "Alan", null]);
    // El país sin equipos recibe una colección vacía y un null, no `undefined`.
    expect(paises[2]!.members).toBeInstanceOf(Collection);
    expect(paises[2]!.firstMember).toBeNull();
  });

  test("una relación Through no pisa a sus hermanas del mismo modelo", async () => {
    const es = await Country.with("members", "teams").findOrFail(1);
    expect(es.members.map((m) => m.name)).toEqual(["Ada", "Grace", "Linus"]);
    expect(es.teams.map((t) => t.name)).toEqual(["ES-A", "ES-B"]);

    // Y cargar sólo la hermana directa no deja la Through a medias.
    const soloTeams = await Country.with("teams").findOrFail(1);
    expect(soloTeams.relationLoaded("teams")).toBe(true);
    expect(soloTeams.relationLoaded("members")).toBe(false);
  });

  test("withCount y whereHas atraviesan el salto", async () => {
    const contados = await Country.withCount("members").get();
    expect(contados.map((p) => p.getAttribute("members_count"))).toEqual([3, 1, 0]);

    const conMiembros = await Country.whereHas("members").get();
    expect(conMiembros.map((p) => p.name)).toEqual(["ES", "PT"]);

    const sinMiembros = await Country.whereDoesntHave("members").get();
    expect(sinMiembros.map((p) => p.name)).toEqual(["IT"]);

    // La restricción del callback llega al modelo lejano, no al intermedio.
    // El callback recibe un Builder crudo sobre la subconsulta con JOIN, así que
    // una columna que exista en las dos tablas hay que cualificarla a mano —
    // igual que en Eloquent. Las de `Relation` (where/whereIn/orderBy) sí se
    // cualifican solas.
    const conAda = await Country.whereHas("members", (query) => {
      query.where("through_members.name", "Ada");
    }).get();
    expect(conAda.map((p) => p.name)).toEqual(["ES"]);

    // Y sin cualificar, la ambigüedad es un error del motor, no un silencio.
    await expect(
      Country.whereHas("members", (query) => { query.where("name", "Ada"); }).get()
    ).rejects.toThrow(/ambiguous/i);
  });

  test("las restricciones encadenadas filtran la consulta directa de una Through", async () => {
    const es = await Country.findOrFail(1);
    expect((await es.members().whereIn("id", [1, 3]).get()).modelKeys()).toEqual([1, 3]);
    expect((await es.members().limit(1).get()).modelKeys()).toEqual([1]);
    expect((await es.members().orderBy("id", "desc").get()).modelKeys()).toEqual([3, 2, 1]);

    // Y sin restricción siguen estando las tres: lo anterior no fue destructivo.
    expect((await es.members().get()).modelKeys()).toEqual([1, 2, 3]);
  });
});
