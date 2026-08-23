import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  Builder,
  Connection,
  InvalidEnumValueError,
  Model,
  ObserverRegistry,
  Schema,
  backedEnum,
} from "../src/index.js";

interface BuilderForceRecordAttributes {
  id: string;
  name: string;
  internal: string | null;
  state: "ready" | "done";
  created_at: string;
  updated_at: string;
}

const BuilderForceState = backedEnum({ Ready: "ready", Done: "done" });

class BuilderForceRecord extends Model.define<BuilderForceRecordAttributes>("builder_force_records") {
  static override fillable = ["name", "state"];
  static override incrementing = false;
  static override keyType = "uuid" as const;
  static override casts = { state: BuilderForceState };
}

describe.serial("Builder.forceCreate", () => {
  const defaultConnection = new Connection({ url: "sqlite://:memory:" });
  const builderConnection = new Connection({ url: "sqlite://:memory:" });

  beforeAll(async () => {
    Model.setConnection(defaultConnection);
    for (const connection of [defaultConnection, builderConnection]) {
      await Schema.create("builder_force_records", (table) => {
        table.uuid("id").primary();
        table.string("name");
        table.string("internal").nullable();
        table.enum("state", ["ready", "done"]);
        table.timestamps();
      }, connection);
    }
  });

  afterAll(async () => {
    ObserverRegistry.unregister(BuilderForceRecord);
    await defaultConnection.close();
    await builderConnection.close();
  });

  test("bypasses mass assignment while preserving save behavior and the builder connection", async () => {
    const events: string[] = [];
    ObserverRegistry.register(BuilderForceRecord, {
      creating: () => events.push("creating"),
      saving: () => events.push("saving"),
      created: () => events.push("created"),
      saved: () => events.push("saved"),
    });

    let writes = 0;
    let reads = 0;
    const originalRun = builderConnection.run.bind(builderConnection);
    const originalQuery = builderConnection.query.bind(builderConnection);
    (builderConnection as any).run = async (sql: string, bindings?: any[]) => {
      if (/^\s*insert\b/i.test(sql)) writes++;
      return await originalRun(sql, bindings);
    };
    (builderConnection as any).query = async (sql: string, bindings?: any[]) => {
      reads++;
      return await originalQuery(sql, bindings);
    };

    try {
      const created = await BuilderForceRecord.on(builderConnection).forceCreate({
        name: "Trusted",
        internal: "allowed",
        state: BuilderForceState.Ready,
      });

      expect(created.$exists).toBe(true);
      expect(created.$wasRecentlyCreated).toBe(true);
      expect(created.getConnection()).toBe(builderConnection);
      expect(created.getAttribute("id")).toMatch(/^[0-9a-f-]{36}$/);
      expect(created.getAttribute("internal")).toBe("allowed");
      expect(created.getAttribute("created_at")).toBeDefined();
      expect(created.getAttribute("updated_at")).toBeDefined();
      expect(events).toEqual(["creating", "saving", "created", "saved"]);
      expect(writes).toBe(1);
      expect(reads).toBe(0);
      expect(await new Builder(defaultConnection, "builder_force_records").count()).toBe(0);
      expect(await new Builder(builderConnection, "builder_force_records").count()).toBe(1);
    } finally {
      (builderConnection as any).run = originalRun;
      (builderConnection as any).query = originalQuery;
      ObserverRegistry.unregister(BuilderForceRecord);
    }
  });

  test("passes save options through and validates backed enums", async () => {
    const events: string[] = [];
    ObserverRegistry.register(BuilderForceRecord, {
      creating: () => events.push("creating"),
    });

    await BuilderForceRecord.on(builderConnection).forceCreate({
      name: "Quiet",
      internal: "trusted",
      state: BuilderForceState.Done,
    }, { events: false });
    expect(events).toEqual([]);

    const before = await new Builder(builderConnection, "builder_force_records").count();
    await expect(BuilderForceRecord.on(builderConnection).forceCreate({
      name: "Invalid",
      state: "unknown" as any,
    })).rejects.toBeInstanceOf(InvalidEnumValueError);
    expect(await new Builder(builderConnection, "builder_force_records").count()).toBe(before);
    ObserverRegistry.unregister(BuilderForceRecord);
  });

  test("rejects raw builders before writing", async () => {
    const before = await new Builder(builderConnection, "builder_force_records").count();
    await expect(new Builder(builderConnection, "builder_force_records").forceCreate({ name: "No model" }))
      .rejects.toThrow("forceCreate requires a model to be set on the builder");
    expect(await new Builder(builderConnection, "builder_force_records").count()).toBe(before);
  });
});
