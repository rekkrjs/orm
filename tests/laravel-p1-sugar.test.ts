import { describe, expect, test } from "bun:test";
import {
  Blueprint,
  Collection,
  ItemNotFoundError,
  Model,
  MultipleItemsFoundError,
  MySqlGrammar,
  PostgresGrammar,
  SQLiteGrammar,
  collect,
} from "../src/index.js";

type Person = {
  id: number;
  name: string;
  team: string;
  score: number;
  email?: string | null;
  meta?: { rank: number };
};

const people = () => collect<Person>([
  { id: 1, name: "Ada", team: "red", score: 10, email: "ada@example.test", meta: { rank: 3 } },
  { id: 2, name: "Bob", team: "red", score: 20, email: null, meta: { rank: 1 } },
  { id: 3, name: "Cyd", team: "blue", score: 30, meta: { rank: 2 } },
  { id: 4, name: "Dee", team: "blue", score: 40, email: "dee@example.test", meta: { rank: 4 } },
]);

type InstanceAttributes = {
  id: number;
  name: string;
  score: number;
  secret: string;
};

class P1InstanceModel extends Model.define<InstanceAttributes>("p1_instance_models") {
  static override timestamps = false;
  static override guarded: string[] = [];
  static override casts = { score: "integer" };
  static override appends = ["label"];

  get label(): string {
    return `${this.name}:${this.score}`;
  }

  get initials(): string {
    return this.name.slice(0, 1);
  }
}

function expectType<T>(_value: T): void {}

describe("Laravel P1 Collection aliases", () => {
  test("average and doesntContain proxy every supported source form", () => {
    const items = people();

    expect(items.average("score")).toBe(25);
    expect(items.average((person) => person.score / 10)).toBe(2.5);
    expect(new Collection<number>([2, 4, 6]).average()).toBe(4);
    expect(new Collection<number>().average()).toBe(new Collection<number>().avg());

    expect(items.doesntContain((person) => person.name === "Eve")).toBe(true);
    expect(items.doesntContain("name", "Ada")).toBe(false);
    expect(items.doesntContain("score", ">", 100)).toBe(true);
    expect(new Collection([1, 2]).doesntContain(3)).toBe(true);
  });

  test("pipe transforms while tap observes and remains chainable", () => {
    const items = people();
    let seen: Collection<Person> | undefined;

    expect(items.pipe((collection) => collection.sum("score"))).toBe(100);
    expect(items.tap((collection) => { seen = collection; })).toBe(items);
    expect(seen).toBe(items);
    expect(items.tap((collection) => collection.push({ id: 5, name: "Eve", team: "green", score: 50 })))
      .toBe(items);
    expect(items.last()?.name).toBe("Eve");
    expect(() => items.pipe(() => { throw new Error("pipe failed"); })).toThrow("pipe failed");
  });

  test("empty condition aliases cover callbacks, fallbacks, and null returns", () => {
    const empty = new Collection<number>();
    const filled = new Collection([1, 2]);
    const calls: string[] = [];

    expect(empty.whenEmpty(() => "empty", () => "filled")).toBe("empty");
    expect(filled.whenEmpty(() => "empty", () => "filled")).toBe("filled");
    expect(filled.whenNotEmpty(() => "filled", () => "empty")).toBe("filled");
    expect(empty.whenNotEmpty(() => "filled", () => "empty")).toBe("empty");
    expect(filled.unlessEmpty(() => "many")).toBe("many");
    expect(empty.unlessNotEmpty(() => "none")).toBe("none");
    expect(empty.whenEmpty((collection) => { calls.push("empty"); collection.push(1); })).toBe(empty);
    expect(calls).toEqual(["empty"]);
  });

  test("strict aliases preserve strict nested and iterable matching", () => {
    const items = people();

    expect(items.whereStrict("id", 1).pluck("name").all()).toEqual(["Ada"]);
    expect(items.whereStrict("id", "1")).toHaveLength(0);
    expect(items.whereStrict("meta.rank", 2).pluck("name").all()).toEqual(["Cyd"]);
    expect(items.whereInStrict("id", new Set([1, 4])).pluck("name").all()).toEqual(["Ada", "Dee"]);
    expect(items.whereInStrict("id", ["1", "4"])).toHaveLength(0);
  });
});

describe("Laravel P1 Collection helpers", () => {
  test("firstOrFail supports plain, callback, value, and operator criteria", () => {
    const items = people();

    expect(items.firstOrFail().name).toBe("Ada");
    expect(items.firstOrFail((person, index) => index === 2 && person.team === "blue").name).toBe("Cyd");
    expect(items.firstOrFail("name", "Bob").id).toBe(2);
    expect(items.firstOrFail("score", ">=", 30).name).toBe("Cyd");
    expect(() => items.firstOrFail("name", "missing")).toThrow(ItemNotFoundError);
    expect(() => new Collection().firstOrFail()).toThrow("No items found");
  });

  test("sole, hasSole, and hasMany enforce cardinality with filters", () => {
    const items = people();

    expect(new Collection(["only"]).sole()).toBe("only");
    expect(items.sole("name", "Ada").id).toBe(1);
    expect(items.sole((person) => person.score > 30).name).toBe("Dee");
    expect(() => items.sole("score", ">", 100)).toThrow(ItemNotFoundError);

    try {
      items.sole("team", "red");
      throw new Error("sole should have failed");
    } catch (error) {
      expect(error).toBeInstanceOf(MultipleItemsFoundError);
      expect((error as MultipleItemsFoundError).count).toBe(2);
      expect((error as Error).message).toBe("2 items were found.");
    }

    expect(items.hasSole("name", "Ada")).toBe(true);
    expect(items.hasSole("team", "red")).toBe(false);
    expect(items.hasMany()).toBe(true);
    expect(items.hasMany("team", "red")).toBe(true);
    expect(items.hasMany("score", ">", 30)).toBe(false);
  });

  test("hasMany short-circuits once cardinality is known", () => {
    let calls = 0;
    expect(new Collection([1, 2, 3, 4]).hasMany(() => { calls++; return true; })).toBe(true);
    expect(calls).toBe(2);
  });

  test("forPage and percentage cover boundaries without changing the source", () => {
    const items = people();

    expect(items.forPage(1, 2).pluck("id").all()).toEqual([1, 2]);
    expect(items.forPage(2, 2).pluck("id").all()).toEqual([3, 4]);
    expect(items.forPage(0, 2).pluck("id").all()).toEqual([1, 2]);
    expect(items.forPage(9, 2)).toHaveLength(0);
    expect(items).toHaveLength(4);

    expect(items.percentage((person) => person.team === "red")).toBe(50);
    expect(new Collection([1, 2, 3]).percentage((value) => value === 1, 1)).toBe(33.3);
    expect(new Collection([1, 2, 3]).percentage((value) => value < 3, 0)).toBe(67);
    expect(new Collection<number>().percentage(() => true)).toBeNull();
  });

  test("chunk and nth return collections and handle edge sizes and offsets", () => {
    const items = new Collection([1, 2, 3, 4, 5]);
    const chunks = items.chunk(2);

    expect(chunks).toBeInstanceOf(Collection);
    expect(chunks.every((chunk) => chunk instanceof Collection)).toBe(true);
    expect(chunks.map((chunk) => chunk.all())).toEqual([[1, 2], [3, 4], [5]]);
    expect(items.chunk(10)[0].all()).toEqual([1, 2, 3, 4, 5]);
    expect(items.chunk(0)).toHaveLength(0);
    expect(items.chunk(-1)).toHaveLength(0);

    expect(items.nth(2).all()).toEqual([1, 3, 5]);
    expect(items.nth(2, 1).all()).toEqual([2, 4]);
    expect(items.nth(2, -2).all()).toEqual([4]);
    expect(() => items.nth(0)).toThrow("Step value must be at least 1");
    expect(() => items.nth(1.5)).toThrow(RangeError);
  });

  test("partition supports callbacks, values, operators, and stable ordering", () => {
    const items = people();
    const callback = items.partition((person, index) => person.score >= 20 && index < 3);
    const equality = items.partition("team", "red");
    const operator = items.partition("score", ">", 20);

    expect(callback.map((part) => part.pluck("name").all())).toEqual([["Bob", "Cyd"], ["Ada", "Dee"]]);
    expect(equality.map((part) => part.pluck("name").all())).toEqual([["Ada", "Bob"], ["Cyd", "Dee"]]);
    expect(operator.map((part) => part.pluck("name").all())).toEqual([["Cyd", "Dee"], ["Ada", "Bob"]]);
    expect(() => (items.partition as any)("score", "~~", 20)).toThrow("Unsupported collection operator");
  });

  test("null, membership, and range filters cover missing and nested values", () => {
    const items = people();

    expect(items.whereNull("email").pluck("name").all()).toEqual(["Bob", "Cyd"]);
    expect(items.whereNotNull("email").pluck("name").all()).toEqual(["Ada", "Dee"]);
    expect(new Collection([null, undefined, 0, false]).whereNull().all()).toEqual([null, undefined]);
    expect(new Collection([null, undefined, 0, false]).whereNotNull().all()).toEqual([0, false]);
    expect(items.whereNotIn("id", new Set([2, 4])).pluck("id").all()).toEqual([1, 3]);
    expect(items.whereNotIn("meta.rank", [])).toHaveLength(4);
    expect(items.whereBetween("score", [20, 30]).pluck("id").all()).toEqual([2, 3]);
    expect(items.whereNotBetween("score", [20, 30]).pluck("id").all()).toEqual([1, 4]);
  });

  test("implode handles scalars, keys, nested keys, callbacks, nulls, and empties", () => {
    const items = people();

    expect(new Collection([1, 2, 3]).implode("-")).toBe("1-2-3");
    expect(items.implode("name", " / ")).toBe("Ada / Bob / Cyd / Dee");
    expect(items.implode("meta.rank", ",")).toBe("3,1,2,4");
    expect(items.implode((person) => person.name.toUpperCase(), "|" )).toBe("ADA|BOB|CYD|DEE");
    expect(items.implode("email", ",")).toBe("ada@example.test,,,dee@example.test");
    expect(new Collection().implode("name", ",")).toBe("");
  });
});

describe("Laravel P1 instance model helpers", () => {
  const makeModel = () => P1InstanceModel.hydrate({
    id: 7,
    name: "Ada",
    score: "42",
    secret: "hidden",
  });

  test("relation state helpers distinguish absent, undefined, and null values", () => {
    const model = makeModel();
    expect(model.relationLoaded("profile")).toBe(false);
    expect(model.setRelation("profile", undefined)).toBe(model);
    expect(model.relationLoaded("profile")).toBe(true);
    expect(model.getRelation("profile")).toBeUndefined();

    const relations = { posts: new Collection([1, 2]), owner: null };
    expect(model.setRelations(relations)).toBe(model);
    expect(model.$relations).toBe(relations);
    expect(model.relationLoaded("profile")).toBe(false);
    expect(model.relationLoaded("owner")).toBe(true);
    expect(model.unsetRelation("owner")).toBe(model);
    expect(model.relationLoaded("owner")).toBe(false);
    expect(model.unsetRelations()).toBe(model);
    expect(model.$relations).toEqual({});
  });

  test("only and except support arrays, variadics, casts, and missing attributes", () => {
    const model = makeModel();
    const only = model.only(["id", "score"] as const);
    const variadic = model.only("name", "secret");
    const except = model.except(["secret", "name"] as const);

    expect(only).toEqual({ id: 7, score: 42 });
    expect(variadic).toEqual({ name: "Ada", secret: "hidden" });
    expect(except).toEqual({ id: 7, score: 42 });
    expect((model as any).only("missing")).toEqual({ missing: undefined });
    expect(model.$attributes.score).toBe("42" as any);

    expectType<Pick<InstanceAttributes, "id" | "score">>(only);
    expectType<Omit<InstanceAttributes, "secret" | "name">>(except);
  });

  test("qualifyColumn and qualifyColumns preserve pre-qualified names and input", () => {
    const model = makeModel();
    const columns = ["id", "external.name"];

    expect(model.qualifyColumn("id")).toBe("p1_instance_models.id");
    expect(model.qualifyColumn("external.name")).toBe("external.name");
    expect(model.qualifyColumns(columns)).toEqual(["p1_instance_models.id", "external.name"]);
    expect(columns).toEqual(["id", "external.name"]);
  });

  test("append helpers merge, replace, inspect, and suppress static appends", () => {
    const model = makeModel();
    expect(model.getAppends()).toEqual(["label"]);
    expect(model.hasAppended("label")).toBe(true);

    expect(model.mergeAppends(["initials", "label"]) === model).toBe(true);
    expect(model.getAppends()).toEqual(["label", "initials"]);
    expect(model.toJSON()).toMatchObject({ label: "Ada:42", initials: "A" });

    expect(model.withoutAppends()).toBe(model);
    expect(model.getAppends()).toEqual([]);
    expect(model.hasAppended("label")).toBe(false);
    expect(model.toJSON()).not.toHaveProperty("label");

    model.append("initials");
    expect(model.getAppends()).toEqual(["initials"]);
    expect(model.toJSON()).toMatchObject({ initials: "A" });
    expect(model.toJSON()).not.toHaveProperty("label");
  });

  test("regression: setAppends replaces class appends instead of silently retaining them", () => {
    const model = makeModel().setAppends(["initials"]);

    expect(model.getAppends()).toEqual(["initials"]);
    expect(model.toJSON()).toMatchObject({ initials: "A" });
    expect(model.toJSON()).not.toHaveProperty("label");
  });

  test("regression: setRelation remains chainable like every relation state setter", () => {
    const model = makeModel();
    expect(model.setRelation("owner", null).unsetRelation("owner").relationLoaded("owner")).toBe(false);
  });
});

describe("Laravel P1 Schema helpers", () => {
  test("nullableTimestamps aliases timestamps with default and explicit precision", () => {
    const defaults = new Blueprint("defaults");
    const precise = new Blueprint("precise");
    defaults.nullableTimestamps();
    precise.nullableTimestamps(3);

    expect(defaults.columns).toEqual([
      expect.objectContaining({ name: "created_at", type: "timestamp", nullable: true }),
      expect.objectContaining({ name: "updated_at", type: "timestamp", nullable: true }),
    ]);
    expect(precise.columns.map((column) => column.precision)).toEqual([3, 3]);
    expect(() => new Blueprint("invalid").nullableTimestamps(7)).toThrow(RangeError);
  });

  test("integer increment aliases set the correct size and key flags", () => {
    const table = new Blueprint("increments");
    table.integerIncrements("regular_id");
    table.smallIncrements("small_id");
    table.tinyIncrements("tiny_id");

    expect(table.columns.map(({ name, type, unsigned, autoIncrement, primary }) => ({
      name, type, unsigned, autoIncrement, primary,
    }))).toEqual([
      { name: "regular_id", type: "integer", unsigned: true, autoIncrement: true, primary: true },
      { name: "small_id", type: "smallInteger", unsigned: true, autoIncrement: true, primary: true },
      { name: "tiny_id", type: "tinyInteger", unsigned: true, autoIncrement: true, primary: true },
    ]);

    const mysql = new MySqlGrammar().compileCreate(table, "increments");
    const postgres = new PostgresGrammar().compileCreate(table, "increments");
    const sqlite = new SQLiteGrammar().compileCreate(table, "increments");
    expect(mysql).toContain("`small_id` SMALLINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY");
    expect(mysql).toContain("`tiny_id` TINYINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY");
    expect(postgres).toContain('"small_id" SMALLINT NOT NULL GENERATED ALWAYS AS IDENTITY PRIMARY KEY');
    expect(sqlite).toContain('"tiny_id" INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL');
  });

  test("ulid and foreignUlid use portable fixed-width columns and constraints", () => {
    const table = new Blueprint("ulid_children");
    table.ulid();
    table.ulid("custom_ulid", 30).nullable();
    table.foreignUlid("owner_id").constrained("owners", "ulid").cascadeOnDelete();

    expect(table.columns).toEqual([
      expect.objectContaining({ name: "ulid", type: "char", length: 26, nullable: false }),
      expect.objectContaining({ name: "custom_ulid", type: "char", length: 30, nullable: true }),
      expect.objectContaining({ name: "owner_id", type: "char", length: 26, nullable: false }),
    ]);
    expect(table.foreignKeys[0]).toMatchObject({
      columns: ["owner_id"], references: ["ulid"], onTable: "owners", onDelete: "cascade",
    });
    expect(new MySqlGrammar().compileCreate(table, "ulid_children")).toContain("`ulid` CHAR(26) NOT NULL");
    expect(new PostgresGrammar().compileCreate(table, "ulid_children")).toContain('"owner_id" CHAR(26) NOT NULL');
    expect(new SQLiteGrammar().compileCreate(table, "ulid_children")).toContain('"custom_ulid" TEXT');
  });

  test("ULID morph helpers create indexed required and nullable pairs", () => {
    const table = new Blueprint("activities");
    table.string("anchor");
    table.ulidMorphs("subject", "subject_lookup", "anchor");
    table.nullableUlidMorphs("target");

    expect(table.columns).toEqual([
      expect.objectContaining({ name: "anchor" }),
      expect.objectContaining({ name: "subject_type", type: "string", nullable: false, after: "anchor" }),
      expect.objectContaining({ name: "subject_id", type: "char", length: 26, nullable: false, after: "subject_type" }),
      expect.objectContaining({ name: "target_type", type: "string", nullable: true }),
      expect.objectContaining({ name: "target_id", type: "char", length: 26, nullable: true }),
    ]);
    expect(table.indexes).toEqual([
      { name: "subject_lookup", columns: ["subject_type", "subject_id"], unique: false },
      { name: "activities_target_type_target_id_index", columns: ["target_type", "target_id"], unique: false },
    ]);

    const mysql = new MySqlGrammar().compileCreate(table, "activities");
    expect(mysql).toContain("`subject_id` CHAR(26) NOT NULL");
    expect(mysql).toContain("`target_id` CHAR(26)");
  });
});
