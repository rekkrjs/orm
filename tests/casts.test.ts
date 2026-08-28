import { expect, test, describe, beforeAll } from "bun:test";
import { Model, Schema, type CastsAttributes } from "../src/index.js";
import { getModelTarget } from "../src/model/ModelBase.js";
import { PermissiveModel, setupTestDb } from "./helpers.js";

class UppercaseCast implements CastsAttributes {
  get(_model: Model, _key: string, value: any): any {
    return String(value).toLowerCase();
  }

  set(_model: Model, _key: string, value: any): any {
    return String(value).toUpperCase();
  }
}

class CountingCast implements CastsAttributes {
  static gets = 0;

  get(_model: Model, _key: string, value: any): any {
    CountingCast.gets++;
    return String(value).toLowerCase();
  }

  set(_model: Model, _key: string, value: any): any {
    return String(value).toUpperCase();
  }
}

class CastedModel extends PermissiveModel {
  static table = "casted";
  static casts = {
    is_active: "boolean",
    count: "number",
    metadata: "json",
    score: "number",
    tags: "json",
    price: "decimal:2",
    secret: "base64",
    code: UppercaseCast,
    happened_at: "datetime",
    stamped_at: "timestamp",
  };
}

class CachedCastModel extends PermissiveModel {
  static table = "cached_casted";
  static casts = {
    code: CountingCast,
  };
}

class ConstructorCacheModel extends PermissiveModel {
  static casts = { metadata: "json" };
  static attributes = { metadata: { source: "default" } };

  constructor() {
    super();
    this.getAttribute("metadata");
  }
}

describe("Attribute Casting", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("casted", (table) => {
      table.increments("id");
      table.integer("is_active").default(0);
      table.integer("count").default(0);
      table.text("metadata").nullable();
      table.float("score").default(0);
      table.text("tags").nullable();
      table.string("price").nullable();
      table.text("secret").nullable();
      table.string("code").nullable();
      table.dateTime("happened_at").nullable();
      table.timestamp("stamped_at").nullable();
      table.timestamps();
    });
    await Schema.create("cached_casted", (table) => {
      table.increments("id");
      table.string("code");
    });
  });

  test("casts boolean from integer", async () => {
    const record = await CastedModel.create({ is_active: 1, count: 0, score: 0 });
    expect(record.getAttribute("is_active")).toBe(true);
    expect(typeof record.getAttribute("is_active")).toBe("boolean");
  });

  test("casts number from string/integer", async () => {
    const record = await CastedModel.create({ count: "42", is_active: 0, score: 0 });
    expect(record.getAttribute("count")).toBe(42);
    expect(typeof record.getAttribute("count")).toBe("number");
  });

  test("casts json from string", async () => {
    const record = await CastedModel.create({ metadata: JSON.stringify({ foo: "bar" }), is_active: 0, count: 0, score: 0 });
    expect(record.getAttribute("metadata")).toEqual({ foo: "bar" });
  });

  test("toJSON applies casts", async () => {
    const record = await CastedModel.create({ is_active: 1, count: 5, score: 3.14, tags: JSON.stringify(["a", "b"]) });
    const json = record.toJSON();
    expect(json.is_active).toBe(true);
    expect(json.count).toBe(5);
    expect(json.score).toBe(3.14);
    expect(json.tags).toEqual(["a", "b"]);
  });

  test("internal cast hooks run on the raw target", () => {
    class TargetCastModel extends PermissiveModel {
      static timestamps = false;
      static casts = { title: "string" };
      static observedThis: TargetCastModel | undefined;

      protected override getCastDefinition(key: string) {
        TargetCastModel.observedThis = this;
        return super.getCastDefinition(key);
      }
    }

    const record = TargetCastModel.hydrate({ title: 123 });
    expect(record.toJSON()).toEqual({ title: "123" });
    expect(TargetCastModel.observedThis).toBe(getModelTarget(record));
    expect(TargetCastModel.observedThis).not.toBe(record);
    expect((TargetCastModel.observedThis as any).title).toBeUndefined();
  });

  test("find applies casts on retrieval", async () => {
    const created = await CastedModel.create({ is_active: 1, count: 10, score: 0 });
    const found = await CastedModel.find(created.getAttribute("id"));
    expect(found!.getAttribute("is_active")).toBe(true);
    expect(found!.getAttribute("count")).toBe(10);
  });

  test("serializes json casts before storage", async () => {
    const record = await CastedModel.create({ metadata: { foo: "bar" }, is_active: 0, count: 0, score: 0 });
    expect(record.$attributes.metadata).toBe(JSON.stringify({ foo: "bar" }));
    expect(record.metadata).toEqual({ foo: "bar" });
  });

  test("tracks and persists in-place mutations to json casts", async () => {
    const record = await CastedModel.create({
      metadata: { profile: { theme: "light" } },
      is_active: 0,
      count: 0,
      score: 0,
    });

    record.metadata.profile.theme = "dark";
    const rawBeforeCheck = record.$attributes.metadata;
    const dirtyKeysBeforeCheck = [...(record.$dirtyKeys ?? [])];
    expect(record.isDirty()).toBe(true);
    expect(record.getDirty()).toEqual({ metadata: '{"profile":{"theme":"dark"}}' });
    expect(record.$attributes.metadata).toBe(rawBeforeCheck);
    expect([...(record.$dirtyKeys ?? [])]).toEqual(dirtyKeysBeforeCheck);
    await record.save();

    expect(record.$attributes.metadata).toBe('{"profile":{"theme":"dark"}}');
    expect(record.isDirty()).toBe(false);
    const found = await CastedModel.find(record.id);
    expect(found!.metadata).toEqual({ profile: { theme: "dark" } });
  });

  test("tracks and persists in-place mutations to date casts", async () => {
    const record = await CastedModel.create({
      happened_at: new Date("2026-01-02T03:04:05.000Z"),
      is_active: 0,
      count: 0,
      score: 0,
    });

    record.happened_at.setUTCFullYear(2000);
    const rawBeforeCheck = record.$attributes.happened_at;
    const dirtyKeysBeforeCheck = [...(record.$dirtyKeys ?? [])];
    expect(record.isDirty()).toBe(true);
    expect(record.getDirty()).toEqual({ happened_at: "2000-01-02T03:04:05.000Z" });
    // Reading the dirty state must not disturb it.
    expect(record.$attributes.happened_at).toBe(rawBeforeCheck);
    expect([...(record.$dirtyKeys ?? [])]).toEqual(dirtyKeysBeforeCheck);
    await record.save();

    expect(record.isDirty()).toBe(false);
    const found = await CastedModel.find(record.id);
    expect(found!.happened_at.toISOString()).toBe("2000-01-02T03:04:05.000Z");
  });

  test("timestamp is a mutable datetime cast", async () => {
    const record = await CastedModel.create({
      stamped_at: new Date("2026-01-02T03:04:05.000Z"),
      is_active: 0,
      count: 0,
      score: 0,
    });

    expect(record.$attributes.stamped_at).toBe("2026-01-02T03:04:05.000Z");
    expect(record.stamped_at).toBeInstanceOf(Date);
    record.stamped_at.setUTCFullYear(2000);
    expect(record.getDirty()).toMatchObject({ stamped_at: "2000-01-02T03:04:05.000Z" });
    await record.save();

    const found = await CastedModel.find(record.id);
    expect(found!.stamped_at.toISOString()).toBe("2000-01-02T03:04:05.000Z");
  });

  test("mutating a date read from a native row leaves the original snapshot intact", () => {
    // MySQL and PostgreSQL hand back a Date, so $attributes holds one and
    // $original shares it through a shallow spread.
    const stored = new Date("2026-01-02T03:04:05.000Z");
    const record = CastedModel.hydrate({ id: 99, happened_at: stored });
    expect(record.isDirty()).toBe(false);

    record.happened_at.setUTCFullYear(2000);

    expect(record.getOriginal("happened_at")).toBe(stored);
    expect(stored.toISOString()).toBe("2026-01-02T03:04:05.000Z");
    expect(record.$attributes.happened_at).toBe(stored);
    expect(record.getDirty()).toEqual({ happened_at: "2000-01-02T03:04:05.000Z" });
  });

  test("reading a date cast does not by itself mark the model dirty", () => {
    // The stored text rarely matches the ISO form the cast serializes back to:
    // MySQL hands over "2026-01-02 03:04:05" and a date column just "2026-01-02".
    for (const stored of ["2026-01-02 03:04:05", "2026-01-02"]) {
      const record = CastedModel.hydrate({ id: 7, happened_at: stored });
      expect(record.happened_at).toBeInstanceOf(Date);
      expect(record.isDirty()).toBe(false);
      expect(record.getDirty()).toEqual({});
      expect(record.getOriginal("happened_at")).toBe(stored);
    }
  });

  test("picks up casts added to or replaced in the static map after the first model was built", () => {
    class LateCastModel extends PermissiveModel {
      static table = "late_casts";
      static casts: Record<string, string> = { first: "json" };
    }

    // Warm whatever caching hangs off the cast map before mutating it.
    const early = LateCastModel.hydrate({ id: 1, first: { a: 1 } });
    early.first.a = 2;
    expect(early.getDirty()).toEqual({ first: '{"a":2}' });

    LateCastModel.casts.second = "json";

    const late = LateCastModel.hydrate({ id: 2, second: { b: 1 } });
    late.second.b = 2;
    expect(late.getDirty()).toEqual({ second: '{"b":2}' });

    LateCastModel.casts.first = "integer";
    expect(LateCastModel.hydrate({ id: 3, first: "7" }).first).toBe(7);
  });

  test("keeps each instance merged cast map isolated", () => {
    const first = new CastedModel();
    const second = new CastedModel();

    expect(first.$mergedCasts).not.toBe(second.$mergedCasts);
    first.$mergedCasts.local = "json";
    expect(second.$mergedCasts.local).toBeUndefined();
  });

  test("normalizes native json rows without marking an unchanged value dirty", () => {
    const record = CastedModel.hydrate({ id: 99, metadata: { enabled: true } });

    expect(record.metadata).toEqual({ enabled: true });
    expect(record.isDirty()).toBe(false);
    record.metadata.enabled = false;
    expect(record.getDirty()).toMatchObject({ metadata: '{"enabled":false}' });
  });

  test("hydrate clears values cached by a model constructor", () => {
    const record = ConstructorCacheModel.hydrate({ metadata: { source: "row" } });

    expect(record.metadata).toEqual({ source: "row" });
    expect(record.isDirty()).toBe(false);
  });

  test("date casts hand back a copy, not the stored instance", () => {
    const date = new Date("2026-01-02T03:04:05.000Z");
    const record = new CastedModel();
    record.$attributes.happened_at = date;

    const read = record.getAttribute("happened_at");
    expect(read).toEqual(date);
    expect(read).not.toBe(date);

    // Mutating what a caller was handed must not reach back into $attributes,
    // which $original shares: that would corrupt the snapshot silently.
    read.setUTCFullYear(2000);
    expect(record.$attributes.happened_at).toBe(date);
    expect(date.toISOString()).toBe("2026-01-02T03:04:05.000Z");
  });

  test("supports decimal, base64, runtime, and custom casts", async () => {
    const record = new CastedModel({ price: 12.5, secret: "hidden", code: "abc", is_active: 0, count: 0, score: 0 });
    record.mergeCasts({ count: "string" });

    expect(record.$attributes.price).toBe("12.50");
    expect(record.price).toBe("12.50");
    expect(record.$attributes.secret).not.toBe("hidden");
    expect(record.secret).toBe("hidden");
    expect(record.$attributes.code).toBe("ABC");
    expect(record.code).toBe("abc");
    expect(record.count).toBe("0");
  });

  test("rejects unsupported string casts", () => {
    class InvalidCastModel extends PermissiveModel {
      static override table = "invalid_casts";
      static override casts = { secret: "unsupported" };
    }

    const record = new InvalidCastModel();
    expect(() => {
      record.secret = "hidden";
    }).toThrow('Unsupported cast "unsupported" (InvalidCastModel.secret).');

    class MisreportedInvalidCastModel extends InvalidCastModel {
      override getModelConstructor(): typeof Model {
        return Model;
      }
    }

    const misreported = new MisreportedInvalidCastModel();
    misreported.$attributes.secret = "value";
    expect(() => misreported.secret).toThrow("(MisreportedInvalidCastModel.secret)");
  });

  test("caches casted values until the attribute or casts change", () => {
    CountingCast.gets = 0;
    const record = new CachedCastModel({ code: "ABC" });

    expect(record.code).toBe("abc");
    expect(record.code).toBe("abc");
    expect(CountingCast.gets).toBe(1);

    record.code = "XYZ";
    expect(record.code).toBe("xyz");
    expect(CountingCast.gets).toBe(2);

    record.mergeCasts({ code: "string" });
    expect(record.code).toBe("XYZ");
    expect(CountingCast.gets).toBe(2);
  });

  test("preserves decimal precision and rounds without converting through Number", () => {
    const record = new CastedModel({
      price: "12345678901234567890.125",
      is_active: 0,
      count: 0,
      score: 0,
    });

    expect(record.$attributes.price).toBe("12345678901234567890.13");
    expect(record.price).toBe("12345678901234567890.13");
  });

  test("decimal casts support exponents and reject invalid values or scales", () => {
    const tiny = new CastedModel({ price: "1e-3", is_active: 0, count: 0, score: 0 });
    const negative = new CastedModel({ price: "-1.005", is_active: 0, count: 0, score: 0 });
    expect(tiny.price).toBe("0.00");
    expect(negative.price).toBe("-1.01");

    expect(() => new CastedModel({ price: "not-a-decimal" })).toThrow("Invalid decimal value");
    expect(() => new CastedModel({ price: Number.POSITIVE_INFINITY })).toThrow("Invalid decimal value");
    expect(() => new CastedModel().mergeCasts({ price: "decimal:-1" }).setAttribute("price", "1")).toThrow(
      "Invalid decimal scale"
    );
  });
});
