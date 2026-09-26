import { beforeAll, describe, expect, test } from "./harness.js";
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

    // Eloquent's updateTimestamps() only stamps a column the caller left clean,
    // and ORM's bulk inserts already keep a value they are given.
    const handCreated = new Date("2024-02-29T23:59:58.123Z");
    const handUpdated = new Date("2024-03-01T00:00:01.456Z");
    const iso = (record: InstanceType<typeof SnakeTimestampModel>, column: string) =>
      (record.getAttribute(column) as Date).toISOString();
    const expectStampedBetween = (record: InstanceType<typeof SnakeTimestampModel>, column: string, before: number) => {
      const stamped = (record.getAttribute(column) as Date).getTime();
      expect(stamped).toBeGreaterThanOrEqual(before);
      expect(stamped).toBeLessThanOrEqual(Date.now());
    };

    test("create() and a new-model save keep timestamps set by hand", async () => {
      await model.create({
        slug: `${label}-hand-create`, name: "hand", count: 0,
        [createdAt]: handCreated, [updatedAt]: handUpdated,
      });
      const created = await find(`${label}-hand-create`);
      expect(iso(created, createdAt)).toBe(handCreated.toISOString());
      expect(iso(created, updatedAt)).toBe(handUpdated.toISOString());

      const before = Date.now();
      const saved = new model({ slug: `${label}-hand-save`, name: "hand", count: 0 });
      saved.setAttribute(createdAt, handCreated);
      await saved.save();
      const reread = await find(`${label}-hand-save`);
      expect(iso(reread, createdAt)).toBe(handCreated.toISOString());
      expectStampedBetween(reread, updatedAt, before);
    });

    test("an update keeps an updated-at set by hand and stamps one left alone", async () => {
      const record = await model.create({ slug: `${label}-hand-update`, name: "before", count: 4 });
      const originalCreatedAt = iso(record, createdAt);

      record.setAttribute("name", "by hand");
      record.setAttribute(updatedAt, handUpdated);
      await record.save();
      let reread = await find(`${label}-hand-update`);
      expect(reread.getAttribute("name")).toBe("by hand");
      expect(iso(reread, updatedAt)).toBe(handUpdated.toISOString());
      expect(iso(reread, createdAt)).toBe(originalCreatedAt);

      const before = Date.now();
      record.setAttribute("name", "stamped");
      await record.save();
      reread = await find(`${label}-hand-update`);
      expectStampedBetween(reread, updatedAt, before);
      expect(iso(reread, createdAt)).toBe(originalCreatedAt);
    });

    test("saveMany() without events and increment() keep an updated-at set by hand", async () => {
      const record = await model.create({ slug: `${label}-hand-bulk`, name: "before", count: 4 });

      record.setAttribute("name", "by hand");
      record.setAttribute(updatedAt, handUpdated);
      await model.saveMany([record], { events: false });
      expect(iso(await find(`${label}-hand-bulk`), updatedAt)).toBe(handUpdated.toISOString());

      const later = new Date("2024-03-02T12:00:00.789Z");
      await record.increment("count", 1, { [updatedAt]: later });
      const reread = await find(`${label}-hand-bulk`);
      expect(reread.getAttribute("count")).toBe(5);
      expect(iso(reread, updatedAt)).toBe(later.toISOString());

      const before = Date.now();
      await record.increment("count");
      expectStampedBetween(await find(`${label}-hand-bulk`), updatedAt, before);
    });

    test("updateTimestamps() leaves a column set by hand alone", () => {
      const fresh = new model({ slug: `${label}-stamp`, name: "stamp", count: 0 });
      fresh.setAttribute(createdAt, handCreated);
      const before = Date.now();
      fresh.updateTimestamps();
      expect(iso(fresh, createdAt)).toBe(handCreated.toISOString());
      expectStampedBetween(fresh, updatedAt, before);
    });

    // Eloquent's updateTimestamps() sets the columns like any attribute, so the
    // next save() writes them.
    test("updateTimestamps() followed by save() writes the new updated-at", async () => {
      const slug = `${label}-stamp-save`;
      const record = await model.create({
        slug, name: "stamp", count: 0, [createdAt]: handCreated, [updatedAt]: handUpdated,
      });

      const before = Date.now();
      record.updateTimestamps();
      expect(record.getDirty()).toEqual({ [updatedAt]: expect.anything() });

      const statements: string[] = [];
      const stop = DB.listen((event) => { statements.push(event.sql); });
      try {
        await record.save();
      } finally {
        stop();
      }
      expect(statements).toHaveLength(1);
      expect(statements[0]).toMatch(/^update /i);
      expect(record.isDirty()).toBe(false);

      const reread = await find(slug);
      expectStampedBetween(reread, updatedAt, before);
      expect(iso(reread, updatedAt)).toBe(iso(record, updatedAt));
      expect(iso(reread, createdAt)).toBe(handCreated.toISOString());
      expect(reread.getAttribute("name")).toBe("stamp");
    });

    test("a query update() and increment() set updated-at unless given one or inside withoutTimestamps()", async () => {
      const target = await model.create({ slug: `${label}-bulk-target`, name: "t", count: 0, [createdAt]: handCreated, [updatedAt]: handUpdated });
      await model.create({ slug: `${label}-bulk-sibling`, name: "s", count: 0, [createdAt]: handCreated, [updatedAt]: handUpdated });
      const onTarget = () => model.where("slug", `${label}-bulk-target`);

      let before = Date.now();
      await onTarget().update({ name: "bulk" });
      expectStampedBetween(await find(`${label}-bulk-target`), updatedAt, before);

      await onTarget().update({ [updatedAt]: handUpdated });
      expect(iso(await find(`${label}-bulk-target`), updatedAt)).toBe(handUpdated.toISOString());
      before = Date.now();
      await onTarget().increment("count", 2);
      expectStampedBetween(await find(`${label}-bulk-target`), updatedAt, before);

      await onTarget().update({ [updatedAt]: handUpdated });
      await model.withoutTimestamps(async () => {
        await onTarget().update({ name: "quiet" });
        await onTarget().decrement("count");
      });
      const reread = await find(`${label}-bulk-target`);
      expect(iso(reread, updatedAt)).toBe(handUpdated.toISOString());
      expect([reread.getAttribute("name"), reread.getAttribute("count")]).toEqual(["quiet", 1]);
      expect(iso(reread, createdAt)).toBe(handCreated.toISOString());
      expect(target.getAttribute("id")).toBe(reread.getAttribute("id"));

      const sibling = await find(`${label}-bulk-sibling`);
      expect(iso(sibling, updatedAt)).toBe(handUpdated.toISOString());
      expect(sibling.getAttribute("name")).toBe("s");
    });

    // Eloquent's upsert() stamps both columns on insert and adds updated-at to
    // the columns it updates, whether called on the model or on a query.
    test("upsert() on the model or a query moves updated-at, also with explicit update columns", async () => {
      const seed = (slug: string) => model.query().insert({ slug, name: "old", count: 0, [createdAt]: handCreated, [updatedAt]: handUpdated });
      const writes: [string, (slug: string) => Promise<unknown>][] = [
        ["model-cols", (slug) => model.upsert({ slug, name: "new", count: 0 }, "slug", ["name"])],
        ["query-cols", (slug) => model.query().upsert({ slug, name: "new", count: 0 }, "slug", ["name"])],
        ["query-all", (slug) => model.query().upsert({ slug, name: "new", count: 0 }, "slug")],
      ];
      for (const [name, write] of writes) {
        const slug = `${label}-upsert-${name}`;
        await seed(slug);
        const before = Date.now();
        await write(slug);
        const reread = await find(slug);
        expect(reread.getAttribute("name")).toBe("new");
        expectStampedBetween(reread, updatedAt, before);
        expect(iso(reread, createdAt)).toBe(handCreated.toISOString());
      }

      const before = Date.now();
      await model.query().upsert({ slug: `${label}-upsert-query-new`, name: "new", count: 0 }, "slug", ["name"]);
      const inserted = await find(`${label}-upsert-query-new`);
      expectStampedBetween(inserted, createdAt, before);
      expectStampedBetween(inserted, updatedAt, before);

      const kept = `${label}-upsert-kept`;
      await seed(kept);
      const later = new Date("2024-03-02T12:00:00.789Z");
      await model.query().upsert({ slug: kept, name: "new", count: 0, [updatedAt]: later }, "slug", ["name"]);
      expect(iso(await find(kept), updatedAt)).toBe(later.toISOString());

      const quiet = `${label}-upsert-quiet`;
      await seed(quiet);
      await model.withoutTimestamps(() => model.upsert({ slug: quiet, name: "new", count: 0 }, "slug", ["name"]));
      const unstamped = await find(quiet);
      expect(unstamped.getAttribute("name")).toBe("new");
      expect(iso(unstamped, updatedAt)).toBe(handUpdated.toISOString());
    });

    // Like Model.insert(), and like every model insert in Lucid; the query
    // builder's insert*() stays the raw path, as in Eloquent.
    test("Model.insertGetId() and insertOrIgnore() set timestamps; a query insert*() does not", async () => {
      const before = Date.now();
      const id = await model.insertGetId({ slug: `${label}-get-id`, name: "n", count: 0 });
      const byId = await find(`${label}-get-id`);
      expect(Number(byId.getAttribute("id"))).toBe(Number(id));
      expectStampedBetween(byId, createdAt, before);
      expectStampedBetween(byId, updatedAt, before);

      await model.insertOrIgnore([
        { slug: `${label}-ignore-a`, name: "n", count: 0 },
        { slug: `${label}-ignore-b`, name: "n", count: 0, [createdAt]: handCreated, [updatedAt]: handUpdated },
      ]);
      const a = await find(`${label}-ignore-a`);
      expectStampedBetween(a, createdAt, before);
      expectStampedBetween(a, updatedAt, before);
      const b = await find(`${label}-ignore-b`);
      expect(iso(b, createdAt)).toBe(handCreated.toISOString());
      expect(iso(b, updatedAt)).toBe(handUpdated.toISOString());

      await model.insertOrIgnore({ slug: `${label}-ignore-a`, name: "ignored", count: 9 });
      const unchanged = await find(`${label}-ignore-a`);
      expect([unchanged.getAttribute("name"), unchanged.getAttribute("count")]).toEqual(["n", 0]);
      expect(iso(unchanged, updatedAt)).toBe(iso(a, updatedAt));

      await model.query().insert({ slug: `${label}-raw-insert`, name: "n", count: 0 });
      await model.query().insertGetId({ slug: `${label}-raw-get-id`, name: "n", count: 0 });
      await model.query().insertOrIgnore({ slug: `${label}-raw-ignore`, name: "n", count: 0 });
      await model.withoutTimestamps(() => model.insertGetId({ slug: `${label}-quiet-get-id`, name: "n", count: 0 }));
      for (const slug of ["raw-insert", "raw-get-id", "raw-ignore", "quiet-get-id"]) {
        const raw = await find(`${label}-${slug}`);
        expect([raw.getAttribute(createdAt), raw.getAttribute(updatedAt)]).toEqual([null, null]);
      }
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
