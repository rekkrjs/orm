import { beforeAll, describe, expect, test } from "bun:test";
import { DB, Model, Schema } from "../src/index.js";
import { PermissiveModel, setupTestDb, teardownTestDb } from "./helpers.js";

class SnakeTimestampModel extends PermissiveModel {
  static override table = "snake_timestamp_models";
}

class CamelTimestampModel extends PermissiveModel {
  static override table = "camel_timestamp_models";
  static override createdAtColumn = "createdAt";
  static override updatedAtColumn = "updatedAt";
}

beforeAll(async () => {
  setupTestDb();
  await Schema.create(SnakeTimestampModel.table, (table) => {
    table.increments("id");
    table.string("slug").unique();
    table.string("name");
    table.integer("count").default(0);
    table.timestamps();
  });
  await Schema.create(CamelTimestampModel.table, (table) => {
    table.increments("id");
    table.string("slug").unique();
    table.string("name");
    table.integer("count").default(0);
    table.timestamps("createdAt", "updatedAt");
  });
});

function timestampMatrix(
  label: string,
  model: typeof SnakeTimestampModel,
  createdAt: string,
  updatedAt: string,
): void {
  const expectInitialized = (record: InstanceType<typeof SnakeTimestampModel>) => {
    expect(record.getAttribute(createdAt)).toBeDefined();
    expect(record.getAttribute(updatedAt)).toBeDefined();
  };

  const find = async (slug: string) => {
    const record = await model.where("slug", slug).first();
    expect(record).not.toBeNull();
    return record!;
  };

  describe(`${label} timestamp matrix`, () => {
    test("create() and a new-model save initialize both columns", async () => {
      const created = await model.create({ slug: `${label}-create`, name: "create", count: 0 });
      expectInitialized(created);

      const saved = new model({ slug: `${label}-save`, name: "save", count: 0 });
      await saved.save();
      expectInitialized(saved);
    });

    test("insert(), createMany(), and saveMany() initialize both columns", async () => {
      await model.insert({ slug: `${label}-insert`, name: "insert", count: 0 });
      expectInitialized(await find(`${label}-insert`));

      const [createdMany] = await model.createMany([
        { slug: `${label}-create-many`, name: "create-many", count: 0 },
      ]);
      expectInitialized(createdMany);

      const withEvents = new model({ slug: `${label}-save-many-events`, name: "events", count: 0 });
      await model.saveMany([withEvents]);
      expectInitialized(withEvents);

      const withoutEvents = new model({ slug: `${label}-save-many-plain`, name: "plain", count: 0 });
      await model.saveMany([withoutEvents], { events: false });
      expectInitialized(withoutEvents);

      const originalCreatedAt = withoutEvents.getAttribute(createdAt);
      withoutEvents.setAttribute("name", "plain-updated");
      await model.saveMany([withoutEvents], { events: false });
      expect(withoutEvents.getAttribute(createdAt)).toBe(originalCreatedAt);
      expect(withoutEvents.getAttribute(updatedAt)).toBeDefined();
    });

    test("existing save(), touch(), increment(), and decrement() preserve created-at", async () => {
      const record = await model.create({ slug: `${label}-mutations`, name: "before", count: 4 });
      const originalCreatedAt = record.getAttribute(createdAt);

      record.setAttribute("name", "after");
      await record.save();
      expect(record.getAttribute(createdAt)).toBe(originalCreatedAt);
      expect(record.getAttribute(updatedAt)).toBeDefined();

      await record.touch();
      expect(record.getAttribute(createdAt)).toBe(originalCreatedAt);

      await record.increment("count", 3);
      expect(record.getAttribute(createdAt)).toBe(originalCreatedAt);
      expect(record.getAttribute("count")).toBe(7);

      await record.decrement("count", 2);
      expect(record.getAttribute(createdAt)).toBe(originalCreatedAt);
      expect(record.getAttribute("count")).toBe(5);
    });

    test("upsert() initializes on insert and preserves created-at on update", async () => {
      const slug = `${label}-upsert`;
      await model.upsert({ slug, name: "inserted", count: 1 }, "slug");
      const inserted = await find(slug);
      expectInitialized(inserted);
      const originalCreatedAt = inserted.getAttribute(createdAt);

      await model.upsert({ slug, name: "updated", count: 2 }, "slug");
      const updated = await find(slug);
      expect(updated.getAttribute(createdAt)).toEqual(originalCreatedAt);
      expect(updated.getAttribute(updatedAt)).toBeDefined();
      expect(updated.getAttribute("name")).toBe("updated");
    });

    test("updateOrInsert() initializes on insert and preserves created-at on update", async () => {
      const slug = `${label}-update-or-insert`;
      await model.updateOrInsert({ slug }, { name: "inserted", count: 1 });
      const inserted = await find(slug);
      expectInitialized(inserted);
      const originalCreatedAt = inserted.getAttribute(createdAt);

      await model.updateOrInsert({ slug }, { name: "updated", count: 2 });
      const updated = await find(slug);
      expect(updated.getAttribute(createdAt)).toEqual(originalCreatedAt);
      expect(updated.getAttribute(updatedAt)).toBeDefined();
      expect(updated.getAttribute("name")).toBe("updated");
    });

    test("replicate() removes both configured timestamp columns", async () => {
      const record = await model.create({ slug: `${label}-replicate`, name: "source", count: 0 });
      const replica = record.replicate();

      expect(replica.$attributes).not.toHaveProperty(createdAt);
      expect(replica.$attributes).not.toHaveProperty(updatedAt);
      expect(replica.$attributes).not.toHaveProperty("id");
    });
  });
}

timestampMatrix("snake", SnakeTimestampModel, "created_at", "updated_at");
timestampMatrix("camel", CamelTimestampModel, "createdAt", "updatedAt");

describe("Timestamp column metadata", () => {
  test("defaults, inheritance, and partial overrides use the public getters", () => {
    class CamelModel extends Model {
      static override createdAtColumn = "createdAt";
      static override updatedAtColumn = "updatedAt";
    }
    class InheritedRecord extends CamelModel {}
    class PartialRecord extends CamelModel {
      static override createdAtColumn = "createdOn";
    }
    class GetterRecord extends CamelModel {
      static override getUpdatedAtColumn(): string {
        return "updatedOn";
      }
    }

    expect(Model.getCreatedAtColumn()).toBe("created_at");
    expect(Model.getUpdatedAtColumn()).toBe("updated_at");
    expect(InheritedRecord.getCreatedAtColumn()).toBe("createdAt");
    expect(InheritedRecord.getUpdatedAtColumn()).toBe("updatedAt");
    expect(PartialRecord.getCreatedAtColumn()).toBe("createdOn");
    expect(PartialRecord.getUpdatedAtColumn()).toBe("updatedAt");
    expect(GetterRecord.dateColumns()).toEqual(["createdAt", "updatedOn"]);
  });

  test("invalid or identical active timestamp names fail clearly", () => {
    class MissingCreated extends Model {
      static override createdAtColumn = "";
    }
    class MissingUpdated extends Model {
      static override updatedAtColumn = 1 as any;
    }
    class Identical extends Model {
      static override createdAtColumn = "changedAt";
      static override updatedAtColumn = "changedAt";
    }

    expect(() => MissingCreated.getCreatedAtColumn()).toThrow(
      "MissingCreated.createdAtColumn must be a non-empty string.",
    );
    expect(() => MissingUpdated.getUpdatedAtColumn()).toThrow(
      "MissingUpdated.updatedAtColumn must be a non-empty string.",
    );
    expect(() => Identical.dateColumns()).toThrow(
      "Identical must use different created-at and updated-at columns.",
    );
  });

  test("disabled timestamps leave invalid inactive settings alone", () => {
    class UntimestampedRecord extends PermissiveModel {
      static override table = "untimestamped_records";
      static override timestamps = false;
      static override createdAtColumn = "";
    }

    const record = new UntimestampedRecord({ name: "plain" });
    expect(record.toJSON()).toEqual({ name: "plain" });
    expect(UntimestampedRecord.hydrate({ id: 1, name: "hydrated" }).getAttribute("name")).toBe("hydrated");
    expect(UntimestampedRecord.dateColumns()).toEqual([]);
    expect(UntimestampedRecord.query().toSql()).toContain("untimestamped_records");
    expect(UntimestampedRecord.schema().blueprint.columns.map((column) => column.name)).toEqual(["id"]);

    expect(() => UntimestampedRecord.getCreatedAtColumn()).toThrow();
    expect(() => UntimestampedRecord.latest()).toThrow();
    expect(() => record.replicate()).toThrow();
  });

  test("dateColumns(), schema(), latest(), and oldest() use configured names", () => {
    class SchemaCamel extends PermissiveModel {
      static override table = "schema_camel";
      static override createdAtColumn = "createdAt";
      static override updatedAtColumn = "updatedAt";
      static override fillable = ["createdAt", "updatedAt"];
      static override casts = { createdAt: "datetime", updatedAt: "datetime" };
    }

    expect(CamelTimestampModel.dateColumns()).toEqual(["createdAt", "updatedAt"]);
    expect(SchemaCamel.schema().blueprint.columns.map((column) => column.name)).toEqual([
      "id",
      "createdAt",
      "updatedAt",
    ]);
    expect(CamelTimestampModel.latest().toSql()).toContain('ORDER BY "createdAt" DESC');
    expect(CamelTimestampModel.oldest().toSql()).toContain('ORDER BY "createdAt" ASC');
    expect(DB.table("generic_records").latest().toSql()).toContain('ORDER BY "created_at" DESC');
  });

  test("disabled timestamps neither reserve nor create configured columns", () => {
    class UnmanagedDates extends PermissiveModel {
      static override table = "unmanaged_dates";
      static override timestamps = false;
      static override createdAtColumn = "createdAt";
      static override updatedAtColumn = "updatedAt";
      static override fillable = ["createdAt", "updatedAt"];
      static override casts = { createdAt: "datetime", updatedAt: "datetime" };
    }

    const columns = UnmanagedDates.schema().blueprint.columns;
    expect(columns.map((column) => column.name)).toEqual(["id", "createdAt", "updatedAt"]);
    expect(columns.slice(1).every((column) => column.type === "dateTime")).toBe(true);
  });

  test("withoutTimestamps() disables scoped writes without changing the inherited flag", async () => {
    expect(CamelTimestampModel.timestamps).toBe(true);
    const record = await CamelTimestampModel.withoutTimestamps(async () => {
      expect(CamelTimestampModel.timestamps).toBe(true);
      return CamelTimestampModel.create({ slug: "without-timestamps", name: "none", count: 0 });
    });

    expect(record.$attributes).not.toHaveProperty("createdAt");
    expect(record.$attributes).not.toHaveProperty("updatedAt");
    expect(CamelTimestampModel.timestamps).toBe(true);

    await expect(CamelTimestampModel.withoutTimestamps(async () => {
      throw new Error("stop");
    })).rejects.toThrow("stop");
    expect(CamelTimestampModel.timestamps).toBe(true);
  });
});

describe("implicit timestamp casts", () => {
  test("refreshes implicit casts after enabling soft deletes", () => {
    class Row extends PermissiveModel {}
    const stored = "2026-01-02 03:04:05";

    expect(Row.hydrate({ deleted_at: stored }).getAttribute("deleted_at")).toBe(stored);
    Row.softDeletes = true;
    expect(Row.hydrate({ deleted_at: stored }).getAttribute("deleted_at")).toBeInstanceOf(Date);
  });

  test("refreshes implicit casts after renaming the created-at column", () => {
    class Row extends PermissiveModel {
      static override createdAtColumn: string = "created_at";
    }
    const stored = "2026-01-02 03:04:05";

    expect(Row.hydrate({ created_at: stored, createdOn: stored }).getAttribute("created_at")).toBeInstanceOf(Date);
    Row.createdAtColumn = "createdOn";
    const renamed = Row.hydrate({ created_at: stored, createdOn: stored });
    expect(renamed.getAttribute("created_at")).toBe(stored);
    expect(renamed.getAttribute("createdOn")).toBeInstanceOf(Date);
  });

  test("a parent withoutTimestamps invalidates cached casts on subclasses", async () => {
    class Parent extends PermissiveModel {}
    class Child extends Parent {}
    const stored = "2026-01-02 03:04:05";

    expect(Child.hydrate({ created_at: stored }).getAttribute("created_at")).toBeInstanceOf(Date);
    await Parent.withoutTimestamps(async () => {
      expect(Child.timestamps).toBe(true);
      expect(Child.hydrate({ created_at: stored }).getAttribute("created_at")).toBe(stored);
    });
    expect(Child.hydrate({ created_at: stored }).getAttribute("created_at")).toBeInstanceOf(Date);
  });

  test("withoutTimestamps invalidates cached implicit casts", async () => {
    class Row extends PermissiveModel {}
    const stored = "2026-01-02 03:04:05";

    expect(Row.hydrate({ created_at: stored }).getAttribute("created_at")).toBeInstanceOf(Date);
    await Row.withoutTimestamps(async () => {
      expect(Row.hydrate({ created_at: stored }).getAttribute("created_at")).toBe(stored);
    });
    expect(Row.hydrate({ created_at: stored }).getAttribute("created_at")).toBeInstanceOf(Date);
  });

  test("an in-place Date mutation on a derived timestamp marks the model dirty", async () => {
    const connection = setupTestDb();
    try {
      await Schema.create("implicit_a", (table) => {
        table.increments("id");
        table.string("name");
        table.timestamps();
      });
      class Row extends PermissiveModel {
        static override table = "implicit_a";
      }

      await Row.create({ name: "x" });
      const row = (await Row.query().first())!;
      // The derived cast puts a Date in the cast cache; mutating it in place
      // never touches $attributes, so getDirty has to consult that cache or the
      // change is lost on save with no error.
      (row.getAttribute("created_at") as Date).setFullYear(1999);

      expect(row.isDirty()).toBe(true);
      await row.save();

      const reread = (await Row.query().first())!;
      expect((reread.getAttribute("created_at") as Date).getFullYear()).toBe(1999);
    } finally {
      await teardownTestDb(connection);
    }
  });

  test("a model overriding the timestamp getters reads those columns as dates", async () => {
    const connection = setupTestDb();
    try {
      await Schema.create("implicit_b", (table) => {
        table.increments("id");
        table.string("name");
        table.timestamp("createdOn").nullable();
        table.timestamp("updatedOn").nullable();
      });
      // Overriding the getter rather than the property is documented as
      // supported, and the write path honours it through dateColumns().
      class Row extends PermissiveModel {
        static override table = "implicit_b";
        static override getCreatedAtColumn() { return "createdOn"; }
        static override getUpdatedAtColumn() { return "updatedOn"; }
      }

      await Row.create({ name: "y" });
      const row = (await Row.query().first())!;
      expect(row.getAttribute("createdOn")).toBeInstanceOf(Date);
      expect(row.getAttribute("updatedOn")).toBeInstanceOf(Date);
    } finally {
      await teardownTestDb(connection);
    }
  });
});
