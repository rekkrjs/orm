import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  Builder,
  Collection,
  Connection,
  InvalidEnumValueError,
  Model,
  Schema,
  backedEnum,
  type CastsAttributes,
} from "../src/index.js";
import { Cache, MemoryCacheStore } from "../src/cache/index.js";
import { PermissiveModel } from "./helpers.js";

const JsonState = backedEnum({ Active: "active", Disabled: "disabled" });

let eligibleConstructions = 0;

class FastJsonUser extends PermissiveModel {
  static override table = "fast_json_users";
  static override timestamps = false;
  static override fastJson = true;
  static override hidden = ["secret"];
  static override casts = {
    active: "boolean",
    score: "number",
    amount: "decimal:2",
    occurred_at: "datetime",
    metadata: "json",
    tags: "array",
    profile: "object",
    encoded: "base64",
    state: JsonState,
    nullable_number: "integer",
  };

  constructor(attributes?: Record<string, any>) {
    super(attributes);
    eligibleConstructions++;
  }

  posts() {
    return this.hasMany(FastJsonPost, "user_id");
  }
}

class FastJsonPost extends PermissiveModel {
  static override table = "fast_json_posts";
  static override timestamps = false;
}

class VisibleFastJsonUser extends PermissiveModel {
  static override table = "fast_json_users";
  static override timestamps = false;
  static override fastJson = true;
  static override visible = ["id", "name", "secret"];
  static override hidden = ["secret"];
}

class HiddenEnumFastJsonUser extends PermissiveModel {
  static override table = "fast_json_users";
  static override timestamps = false;
  static override fastJson = true;
  static override casts = { state: JsonState };
  static override hidden = ["state"];
}

class InvisibleEnumFastJsonUser extends PermissiveModel {
  static override table = "fast_json_users";
  static override timestamps = false;
  static override fastJson = true;
  static override casts = { state: JsonState };
  static override visible = ["id"];
}

class CountingJsonModel extends PermissiveModel {
  static override table = "fast_json_fallbacks";
  static override timestamps = false;
  static constructions = 0;

  constructor(attributes?: Record<string, any>) {
    super(attributes);
    const constructor = new.target as typeof CountingJsonModel;
    constructor.constructions++;
  }
}

class NoOptInJsonModel extends CountingJsonModel {}

class DisabledJsonModel extends CountingJsonModel {
  static override fastJson = false;
}

class AppendedJsonModel extends CountingJsonModel {
  static override fastJson = true;
  static override appends = ["upperName"];

  get upperName(): string {
    return String(this.getAttribute("name")).toUpperCase();
  }
}

class AccessorJsonModel extends CountingJsonModel {
  static override fastJson = true;
  static override accessors = {
    name: { get: (value: unknown) => String(value).toUpperCase() },
  };
}

class PrefixCast implements CastsAttributes {
  get(_model: unknown, _key: string, value: unknown): string {
    return `class:${String(value)}`;
  }

  set(_model: unknown, _key: string, value: unknown): unknown {
    return value;
  }
}

class CustomClassCastJsonModel extends CountingJsonModel {
  static override fastJson = true;
  static override casts = { name: PrefixCast };
}

class CustomObjectCastJsonModel extends CountingJsonModel {
  static override fastJson = true;
  static override casts = {
    name: {
      get: (_model: unknown, _key: string, value: unknown) => `object:${String(value)}`,
      set: (_model: unknown, _key: string, value: unknown) => value,
    },
  };
}

class DefaultAttributeJsonModel extends CountingJsonModel {
  static override fastJson = true;
  static override attributes = { fallback: "default" };
}

class OverrideHydrateJsonModel extends CountingJsonModel {
  static override fastJson = true;

  static override hydrate(row: Record<string, any>, connection?: Connection): any {
    return super.hydrate({ ...row, hydrated: true }, connection);
  }
}

class OverrideToJsonModel extends CountingJsonModel {
  static override fastJson = true;

  override toJSON(): any {
    return { ...super.toJSON(), to_json: true };
  }
}

class OverrideJsonModel extends CountingJsonModel {
  static override fastJson = true;

  override json(): any {
    return super.json();
  }
}

class OverrideGetAttributeModel extends CountingJsonModel {
  static override fastJson = true;
  static override casts = { name: "string:forced" };

  override getAttribute(key: string): any {
    const value = super.getAttribute(key);
    return key === "name" ? String(value).toUpperCase() : value;
  }
}

class OverrideCastAttributeModel extends CountingJsonModel {
  static override fastJson = true;
  static override casts = { name: "string:forced" };

  override castAttribute(key: string, value: any): any {
    const casted = super.castAttribute(key, value);
    return key === "name" ? `cast:${String(casted)}` : casted;
  }
}

class OverrideGetAppendsModel extends CountingJsonModel {
  static override fastJson = true;

  override getAppends(): string[] {
    return super.getAppends();
  }
}

class OverrideSetConnectionModel extends CountingJsonModel {
  static override fastJson = true;

  override setConnection(connection: Connection): this {
    super.setConnection(connection);
    (this.$attributes as Record<string, any>).from_connection = "yes";
    return this;
  }
}

class OverrideSerializeModel extends CountingJsonModel {
  static override fastJson = true;
}

const inheritedSerialize = (OverrideSerializeModel.prototype as any).serialize;
(OverrideSerializeModel.prototype as any).serialize = function(includeRelations = true) {
  return {
    ...inheritedSerialize.call(this, includeRelations),
    from_serialize: true,
  };
};

const nonEnumerableAccessors = {} as Record<string, any>;
Object.defineProperty(nonEnumerableAccessors, "name", {
  value: { get: (value: unknown) => String(value).toUpperCase() },
  enumerable: false,
});

class NonEnumerableAccessorModel extends CountingJsonModel {
  static override fastJson = true;
  static override accessors = nonEnumerableAccessors;
}

class InheritedAccessorModel extends CountingJsonModel {
  static override fastJson = true;
  static override accessors = Object.create({
    name: { get: (value: unknown) => String(value).toUpperCase() },
  });
}

class RelaxedEnumValidationModel extends PermissiveModel {
  static override casts = { state: JsonState };

  protected override assertBackedEnumValue(
    _key: string,
    value: unknown,
    _definition: any,
  ): asserts value is string {}
}

class EagerJsonParent extends CountingJsonModel {
  static override fastJson = true;

  children() {
    return this.hasMany(EagerJsonChild, "parent_id");
  }
}

class EagerJsonChild extends PermissiveModel {
  static override table = "fast_json_children";
  static override timestamps = false;
}

async function expectHydration(model: typeof CountingJsonModel): Promise<any> {
  model.constructions = 0;
  const result = await model.query().orderBy("id").json();
  expect(model.constructions).toBeGreaterThan(0);
  return result;
}

describe("Builder.json fast path", () => {
  const connection = new Connection({ url: "sqlite://:memory:" });

  beforeAll(async () => {
    Model.setConnection(connection);
    Schema.setConnection(connection);

    await Schema.create("fast_json_users", (table) => {
      table.increments("id");
      table.string("name");
      table.boolean("active");
      table.string("score");
      table.string("amount");
      table.timestamp("occurred_at");
      table.json("metadata");
      table.text("tags");
      table.text("profile");
      table.text("encoded");
      table.string("state");
      table.integer("nullable_number").nullable();
      table.string("passthrough");
      table.string("secret");
    });
    await new Builder(connection, "fast_json_users").insert([
      {
        name: "Ada",
        active: 1,
        score: "7.5",
        amount: "12.345",
        occurred_at: "2026-08-20T10:11:12.000Z",
        metadata: JSON.stringify({ nested: { value: 1 } }),
        tags: JSON.stringify(["bun", "orm"]),
        profile: JSON.stringify({ city: "Madrid" }),
        encoded: Buffer.from("hello", "utf8").toString("base64"),
        state: JsonState.Active,
        nullable_number: null,
        passthrough: "unchanged",
        secret: "hidden-a",
      },
      {
        name: "Grace",
        active: 0,
        score: "9",
        amount: "5",
        occurred_at: "2026-08-21T10:11:12.000Z",
        metadata: JSON.stringify({ nested: { value: 2 } }),
        tags: JSON.stringify(["sql"]),
        profile: JSON.stringify({ city: "London" }),
        encoded: Buffer.from("world", "utf8").toString("base64"),
        state: JsonState.Disabled,
        nullable_number: null,
        passthrough: "as-is",
        secret: "hidden-b",
      },
      {
        name: "Invalid",
        active: 1,
        score: "1",
        amount: "1",
        occurred_at: "2026-08-22T10:11:12.000Z",
        metadata: "{}",
        tags: "[]",
        profile: "{}",
        encoded: "",
        state: "archived",
        nullable_number: null,
        passthrough: "invalid",
        secret: "hidden-c",
      },
      {
        name: "Invalid JSON and enum",
        active: 1,
        score: "1",
        amount: "1",
        occurred_at: "2026-08-23T10:11:12.000Z",
        metadata: "{",
        tags: "[]",
        profile: "{}",
        encoded: "",
        state: "archived",
        nullable_number: null,
        passthrough: "invalid",
        secret: "hidden-d",
      },
    ]);

    await Schema.create("fast_json_posts", (table) => {
      table.increments("id");
      table.integer("user_id");
      table.string("title");
    });
    await new Builder(connection, "fast_json_posts").insert([
      { user_id: 1, title: "One" },
      { user_id: 1, title: "Two" },
      { user_id: 2, title: "Three" },
    ]);

    await Schema.create("fast_json_fallbacks", (table) => {
      table.increments("id");
      table.string("name");
    });
    await new Builder(connection, "fast_json_fallbacks").insert({ name: "fallback" });

    await Schema.create("fast_json_children", (table) => {
      table.increments("id");
      table.integer("parent_id");
      table.string("name");
    });
    await new Builder(connection, "fast_json_children").insert({ parent_id: 1, name: "child" });
  });

  afterAll(async () => {
    await connection.close();
  });

  test("matches hydrated JSON for built-in casts without constructing models", async () => {
    eligibleConstructions = 0;
    const direct = await FastJsonUser.whereIn("id", [1, 2]).orderBy("id").json();
    expect(eligibleConstructions).toBe(0);

    const models = await FastJsonUser.whereIn("id", [1, 2]).orderBy("id").get();
    const hydrated = models.toJSON();
    expect(eligibleConstructions).toBe(2);
    expect(direct).toEqual(hydrated);
    expect(direct).toBeInstanceOf(Collection);
    expect(Object.keys(direct[0]!)).toEqual([
      "id", "name", "active", "score", "amount", "occurred_at", "metadata",
      "tags", "profile", "encoded", "state", "nullable_number", "passthrough",
    ]);
    expect(direct[0]).toMatchObject({
      active: true,
      score: 7.5,
      amount: "12.35",
      metadata: { nested: { value: 1 } },
      tags: ["bun", "orm"],
      profile: { city: "Madrid" },
      encoded: "hello",
      state: "active",
      nullable_number: null,
      passthrough: "unchanged",
    });
    expect((direct[0] as any).occurred_at).toBeInstanceOf(Date);
  });

  test("does not materialize unselected cast attributes", async () => {
    const direct = await FastJsonUser.select("id", "name").where("id", 1).json();
    const hydrated = (
      await FastJsonUser.select("id", "name").where("id", 1).get()
    ).toJSON();

    expect(direct).toEqual(hydrated);
    expect(Object.keys(direct[0]!)).toEqual(["id", "name"]);
  });

  test("preserves selections, aliases, order, visibility, and hidden precedence", async () => {
    const selected = await FastJsonUser
      .select("id", "name as label")
      .whereIn("id", [1, 2])
      .orderBy("id", "desc")
      .json();
    expect(selected).toEqual([
      { id: 2, label: "Grace" },
      { id: 1, label: "Ada" },
    ]);

    const visible = await VisibleFastJsonUser.where("id", 1).json();
    expect(visible).toEqual([{ id: 1, name: "Ada" }]);
  });

  test("preserves aggregate aliases and query result coercions", async () => {
    const direct = await FastJsonUser
      .select("id", "name")
      .withCount("posts", "post_total")
      .withExists("posts", "has_posts")
      .whereIn("id", [1, 2])
      .orderBy("id")
      .json();
    const hydrated = (await FastJsonUser
      .select("id", "name")
      .withCount("posts", "post_total")
      .withExists("posts", "has_posts")
      .whereIn("id", [1, 2])
      .orderBy("id")
      .get()).toJSON();

    expect(direct).toEqual(hydrated);
    expect(direct).toEqual([
      { id: 1, name: "Ada", post_total: 2, has_posts: true },
      { id: 2, name: "Grace", post_total: 1, has_posts: true },
    ]);
  });

  test("validates backed enums in hydrated and fast JSON paths", async () => {
    await expect(FastJsonUser.where("id", 3).json()).rejects.toBeInstanceOf(InvalidEnumValueError);
    await expect(FastJsonUser.where("id", 3).get()).rejects.toBeInstanceOf(InvalidEnumValueError);
  });

  test("validates backed enums even when visibility omits the column", async () => {
    await expect(HiddenEnumFastJsonUser.where("id", 3).json())
      .rejects.toBeInstanceOf(InvalidEnumValueError);
    await expect(InvisibleEnumFastJsonUser.where("id", 3).json())
      .rejects.toBeInstanceOf(InvalidEnumValueError);
  });

  test("keeps eager enum validation ahead of read-cast errors", async () => {
    await expect(FastJsonUser.where("id", 4).json())
      .rejects.toBeInstanceOf(InvalidEnumValueError);
    await expect(FastJsonUser.where("id", 4).get())
      .rejects.toBeInstanceOf(InvalidEnumValueError);
  });

  test("does not mutate the original builder", async () => {
    const query = FastJsonUser.where("id", 1);
    await query.json();
    const models = await query.get();
    expect(models[0]).toBeInstanceOf(FastJsonUser);
  });

  test("leaves plain DB builders on their existing row path", async () => {
    const rows = await new Builder(connection, "fast_json_users")
      .select("id", "name")
      .where("id", 1)
      .json();
    expect(rows).toEqual([{ id: 1, name: "Ada" }]);
    expect(rows).toBeInstanceOf(Collection);
  });

  test("reuses cached raw rows without mutating them", async () => {
    Cache.configure({ store: new MemoryCacheStore() });
    let reads = 0;
    const query = connection.query.bind(connection);
    connection.query = ((sql: string, bindings?: any[]) => {
      if (sql.includes("fast_json_users")) reads++;
      return query(sql, bindings);
    }) as any;

    try {
      const build = () => FastJsonUser
        .select("id", "active", "metadata")
        .where("id", 1)
        .remember("fast-json-rows", 60);
      const first = await build().json();
      (first[0] as any).metadata.nested.value = 99;
      const second = await build().json();
      const hydrated = await build().get();

      expect(reads).toBe(1);
      expect(second).toEqual([{ id: 1, active: true, metadata: { nested: { value: 1 } } }]);
      expect((hydrated[0] as any).$attributes.active).toBe(1);
      expect((hydrated[0] as any).$attributes.metadata).toBe('{"nested":{"value":1}}');
    } finally {
      connection.query = query as any;
    }
  });

  test("falls back while the Identity Map is active", async () => {
    await FastJsonUser.useIdentityMap(async () => {
      const user = await FastJsonUser.find(1);
      user!.setAttribute("name", "Local change");
      const json = await FastJsonUser.where("id", 1).json();
      expect(json[0]!.name).toBe("Local change");
    });
  });

  test("falls back without opt-in and when explicitly disabled", async () => {
    await expectHydration(NoOptInJsonModel);
    await expectHydration(DisabledJsonModel);
  });

  test("falls back for eager loads", async () => {
    EagerJsonParent.constructions = 0;
    const result = await EagerJsonParent.with("children").orderBy("id").json();
    expect(EagerJsonParent.constructions).toBeGreaterThan(0);
    expect(result[0].children[0].name).toBe("child");
  });

  test("falls back for appends and accessors", async () => {
    expect((await expectHydration(AppendedJsonModel))[0].upperName).toBe("FALLBACK");
    expect((await expectHydration(AccessorJsonModel))[0].name).toBe("FALLBACK");
  });

  test("falls back for non-enumerable and inherited accessor maps", async () => {
    expect((await expectHydration(NonEnumerableAccessorModel))[0].name).toBe("FALLBACK");
    expect((await expectHydration(InheritedAccessorModel))[0].name).toBe("FALLBACK");
  });

  test("falls back for custom cast classes and objects", async () => {
    expect((await expectHydration(CustomClassCastJsonModel))[0].name).toBe("class:fallback");
    expect((await expectHydration(CustomObjectCastJsonModel))[0].name).toBe("object:fallback");
  });

  test("falls back for default attributes", async () => {
    expect((await expectHydration(DefaultAttributeJsonModel))[0].fallback).toBe("default");
  });

  test("falls back for each relevant serialization override", async () => {
    expect((await expectHydration(OverrideHydrateJsonModel))[0].hydrated).toBe(true);
    expect((await expectHydration(OverrideToJsonModel))[0].to_json).toBe(true);
    await expectHydration(OverrideJsonModel);
    expect((await expectHydration(OverrideGetAttributeModel))[0].name).toBe("FALLBACK");
    expect((await expectHydration(OverrideCastAttributeModel))[0].name).toBe("cast:fallback");
    await expectHydration(OverrideGetAppendsModel);
    expect((await expectHydration(OverrideSerializeModel))[0].from_serialize).toBe(true);
  });

  test("falls back when setConnection changes hydrated output", async () => {
    expect((await expectHydration(OverrideSetConnectionModel))[0].from_connection).toBe("yes");
  });

  test("castAttribute preserves backed-enum validator overrides", () => {
    const model = new RelaxedEnumValidationModel();
    model.$attributes = { state: "invalid" } as any;

    expect(model.getAttribute("state")).toBe("invalid");
    expect(model.castAttribute("state", "invalid")).toBe("invalid");
  });
});
