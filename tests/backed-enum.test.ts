import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  InvalidEnumValueError,
  Model,
  Schema,
  backedEnum,
  type EnumValue,
} from "../src/index.js";
import { PermissiveModel, setupTestDb, teardownTestDb } from "./helpers.js";

const PublicationState = backedEnum({
  Draft: "draft",
  Published: "published",
});

type PublicationState = EnumValue<typeof PublicationState>;

const inferredState: PublicationState = "draft";
// @ts-expect-error EnumValue must reject strings outside the descriptor.
const invalidInferredState: PublicationState = "archived";
void inferredState;
void invalidInferredState;

interface EnumRecordAttributes {
  id: number;
  state: PublicationState | null;
  title: string;
  visits: number;
}

class EnumRecord extends PermissiveModel<EnumRecordAttributes> {
  static override table = "backed_enum_records";
  static override timestamps = false;
  static override fillable = ["state", "title", "visits"];
  static override casts = { state: PublicationState };
  static override accessors = {
    state_label: {
      get: (_value: unknown, attributes: Record<string, unknown>) =>
        attributes.state === PublicationState.Published ? "Published" : "Draft",
    },
  };
}

class DynamicEnumRecord extends PermissiveModel {
  static override timestamps = false;
}

class GuardedEnumRecord extends Model {
  static override timestamps = false;
  static override guarded = ["state"];
  static override casts = { state: PublicationState };
}

class MutatedEnumRecord extends PermissiveModel {
  static override timestamps = false;
  static override casts = { state: PublicationState };
  static override accessors = {
    state: {
      set: () => "archived",
    },
  };
}

class ValidMutatedEnumRecord extends PermissiveModel<EnumRecordAttributes> {
  static override table = "backed_enum_records";
  static override timestamps = false;
  static override fillable = ["state", "title", "visits"];
  static override casts = { state: PublicationState };
  static override accessors = {
    state: {
      set: (value: unknown) => value,
    },
  };
}

class AccessorEnumRecord extends PermissiveModel {
  static override timestamps = false;
  static override accessors = {
    state: {
      get: () => "masked",
    },
  };
}

describe("backedEnum", () => {
  test("exposes only frozen string cases as enumerable properties", () => {
    expect(Object.keys(PublicationState)).toEqual(["Draft", "Published"]);
    expect(Object.values(PublicationState)).toEqual(["draft", "published"]);
    expect(JSON.stringify(PublicationState)).toBe('{"Draft":"draft","Published":"published"}');
    expect(Object.isFrozen(PublicationState)).toBe(true);

    const symbols = Object.getOwnPropertySymbols(PublicationState);
    expect(symbols).toHaveLength(1);
    const property = Object.getOwnPropertyDescriptor(PublicationState, symbols[0]!);
    expect(property).toMatchObject({ enumerable: false, writable: false, configurable: false });
    expect(Object.isFrozen(property!.value)).toBe(true);
    expect(Object.isFrozen(property!.value.values)).toBe(true);
  });

  test("copies its input and validates runtime definitions", () => {
    const source: Record<string, string> = { Open: "open", Closed: "closed" };
    const definition = backedEnum(source);
    source.Open = "changed";
    source.Added = "added";

    expect(Object.values(definition)).toEqual(["open", "closed"]);
    expect(() => (backedEnum as any)({})).toThrow("requires at least one case");
    expect(() => (backedEnum as any)([])).toThrow("expects an object");
    expect(() => (backedEnum as any)({ Active: 1 })).toThrow("must have a string value");
    expect(() => backedEnum({ Empty: "" })).toThrow("must not have an empty value");
    expect(() => backedEnum({ First: "same", Second: "same" })).toThrow("is duplicated");
  });
});

describe("backed enum model casts", () => {
  const connection = setupTestDb();

  beforeAll(async () => {
    await Schema.create("backed_enum_records", (table) => {
      table.increments("id");
      table.enum("state", Object.values(PublicationState)).nullable();
      table.string("title");
      table.integer("visits").default(0);
    });
  });

  afterAll(async () => {
    await teardownTestDb(connection);
  });

  test("validates hydration eagerly and reports structured errors", () => {
    const record = EnumRecord.hydrate({ id: 1, state: "draft", title: "Valid" });
    expect(record.getAttribute("state")).toBe(PublicationState.Draft);
    expect(EnumRecord.hydrate({ id: 2, state: null, title: "Nullable" }).getAttribute("state")).toBeNull();
    expect(EnumRecord.hydrate({ id: 3, title: "Partial" }).getAttribute("state")).toBeUndefined();
    expect(() => EnumRecord.hydrate({ id: 4, state: undefined, title: "Invalid" }))
      .toThrow(InvalidEnumValueError);

    let error: unknown;
    try {
      EnumRecord.hydrate({ id: 3, state: "archived", title: "Invalid" });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(InvalidEnumValueError);
    expect(error).toMatchObject({
      model: "EnumRecord",
      attribute: "state",
      value: "archived",
      expected: ["draft", "published"],
    });
    expect(Object.isFrozen((error as InvalidEnumValueError).expected)).toBe(true);
  });

  test("rejects unknown strings and non-string values on direct writes", () => {
    const record = new EnumRecord();
    const writes = [
      () => record.setAttribute("state", "archived" as any),
      () => record.fill({ state: "archived" as any }),
      () => record.forceFill({ state: "archived" as any }),
      () => ((record as any).state = "archived"),
      () => record.setAttribute("state", 1 as any),
      () => record.setAttribute("state", new String("draft") as any),
      () => record.setAttribute("state", { value: "draft" } as any),
      () => record.setAttribute("state", undefined as any),
    ];

    for (const write of writes) {
      expect(write).toThrow(InvalidEnumValueError);
    }
    expect(record.$attributes.state).toBeUndefined();

    record.setAttribute("state", null);
    expect(record.$attributes.state).toBeNull();
  });

  test("validates the value returned by an attribute mutator", () => {
    const record = new MutatedEnumRecord();

    expect(() => record.setAttribute("state", PublicationState.Draft))
      .toThrow(InvalidEnumValueError);
    expect(record.$attributes.state).toBeUndefined();
  });

  test("keeps enum values returned by mutators dirty and persists them", async () => {
    const created = await ValidMutatedEnumRecord.create({
      state: PublicationState.Draft,
      title: "Mutated",
      visits: 0,
    });
    const record = await ValidMutatedEnumRecord.find(created.getAttribute("id"));

    record!.setAttribute("state", PublicationState.Published);
    expect(record!.getDirty()).toEqual({ state: PublicationState.Published });
    await record!.save();

    expect((await ValidMutatedEnumRecord.find(created.getAttribute("id")))!.getAttribute("state"))
      .toBe(PublicationState.Published);
  });

  test("validates create, update, forceCreate, and mass assignment paths", async () => {
    await expect(EnumRecord.create({ state: "archived" as any, title: "Invalid" }))
      .rejects.toBeInstanceOf(InvalidEnumValueError);
    await expect(EnumRecord.forceCreate({ state: "archived" as any, title: "Invalid" }))
      .rejects.toBeInstanceOf(InvalidEnumValueError);

    const record = await EnumRecord.create({
      state: PublicationState.Draft,
      title: "Valid",
      ignored: "not fillable",
    } as any);
    expect(record.$attributes.state).toBe("draft");
    expect((record.$attributes as any).ignored).toBeUndefined();
    await expect(record.update({ state: "archived" as any }))
      .rejects.toBeInstanceOf(InvalidEnumValueError);
    expect(record.getAttribute("state")).toBe(PublicationState.Draft);

    const guarded = new GuardedEnumRecord();
    guarded.fill({ state: "archived" } as any);
    expect(guarded.getAttribute("state")).toBeUndefined();
    expect(() => guarded.forceFill({ state: "archived" } as any)).toThrow(InvalidEnumValueError);
  });

  test("guards bulk, raw model state, and increment extra attributes", async () => {
    await expect(EnumRecord.insert(
      { state: "archived" as any, title: "Bulk invalid", visits: 0 },
      { events: false },
    )).rejects.toBeInstanceOf(InvalidEnumValueError);

    const raw = new EnumRecord({
      state: PublicationState.Draft,
      title: "Raw invalid",
      visits: 0,
    });
    raw.$attributes.state = "archived" as any;
    await expect(raw.save()).rejects.toBeInstanceOf(InvalidEnumValueError);
    await expect(EnumRecord.saveMany([raw], { events: false }))
      .rejects.toBeInstanceOf(InvalidEnumValueError);

    const record = await EnumRecord.create({
      state: PublicationState.Draft,
      title: "Counter",
      visits: 0,
    });
    await expect(record.increment("visits", 1, { state: "archived" }))
      .rejects.toBeInstanceOf(InvalidEnumValueError);
    await expect(record.increment("state" as any, 1))
      .rejects.toMatchObject({ value: 1 });
    expect(record.getAttribute("visits")).toBe(0);
    expect(record.getAttribute("state")).toBe(PublicationState.Draft);
  });

  test("validates every model-backed Builder write path", async () => {
    const record = await EnumRecord.create({
      state: PublicationState.Draft,
      title: "Builder target",
      visits: 0,
    });
    const invalid = {
      state: "archived" as any,
      title: "Builder invalid",
      visits: 0,
    };
    const id = record.getAttribute("id");
    const writes = [
      () => EnumRecord.query().insert(invalid),
      () => EnumRecord.query().insertGetId(invalid),
      () => EnumRecord.query().insertOrIgnore(invalid),
      () => EnumRecord.query().upsert({ id, ...invalid }, "id"),
      () => EnumRecord.where("id", id).update({ state: "archived" as any }),
      () => EnumRecord.where("id", id).increment("visits", 1, { state: "archived" as any }),
      () => EnumRecord.where("id", id).increment("state" as any, 1),
    ];

    for (const write of writes) {
      await expect(write()).rejects.toBeInstanceOf(InvalidEnumValueError);
    }

    await record.refresh();
    expect(record.getAttribute("state")).toBe(PublicationState.Draft);
    expect(record.getAttribute("visits")).toBe(0);
  });

  test("keeps primitive serialization, visibility, appends, and dirty tracking", () => {
    const record = EnumRecord.hydrate({ id: 10, state: "draft", title: "Article" });
    expect(record.getOriginal("state")).toBe("draft");
    expect(record.isDirty()).toBe(false);
    expect(record.toJSON().state).toBe("draft");
    expect(record.json().state).toBe("draft");

    record.setAttribute("state", PublicationState.Published);
    expect(record.$attributes.state).toBe("published");
    expect(record.getDirty()).toEqual({ state: "published" });

    record.append("state_label");
    expect((record.toJSON() as any).state_label).toBe("Published");
    record.makeHidden("state");
    expect(record.toJSON()).not.toHaveProperty("state");
    record.makeVisible("state");
    expect((record.toJSON() as any).state).toBe("published");

    record.setAttribute("state", PublicationState.Draft);
    expect(record.isClean()).toBe(true);
  });

  test("mergeCasts applies descriptors without changing scalar behavior", () => {
    const record = DynamicEnumRecord.hydrate({ state: "draft" });
    record.mergeCasts({ state: PublicationState });

    expect(record.getAttribute("state")).toBe("draft");
    record.setAttribute("state", PublicationState.Published);
    expect(record.$attributes.state).toBe("published");
    expect(record.getDirty()).toEqual({ state: "published" });
    expect((record.toJSON() as any).state).toBe("published");

    const invalid = DynamicEnumRecord.hydrate({ state: "archived" });
    invalid.mergeCasts({ state: PublicationState });
    expect(() => invalid.getAttribute("state")).toThrow(InvalidEnumValueError);
  });

  test("validates the current raw value before enum accessors and cast caches", () => {
    const cached = EnumRecord.hydrate({ state: PublicationState.Draft, title: "Cached", visits: 0 });
    expect(cached.getAttribute("state")).toBe(PublicationState.Draft);
    cached.$attributes.state = "archived" as any;
    expect(() => cached.getAttribute("state")).toThrow(InvalidEnumValueError);
    expect(() => cached.toJSON()).toThrow(InvalidEnumValueError);

    const accessor = AccessorEnumRecord.hydrate({ state: "archived" });
    accessor.mergeCasts({ state: PublicationState });
    expect(() => accessor.getAttribute("state")).toThrow(InvalidEnumValueError);
  });

});
