import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Connection, Model, MorphMap, Schema } from "../src/index.js";
import { PermissiveModel, setupTestDb, teardownTestDb } from "./helpers.js";

// The pivot object is assigned as a property on the related model rather than
// through setRelation(); it reaches toJSON() because the model proxy routes the
// write into $attributes. These tests pin that down: the indirection is easy to
// break from the proxy side, and the failure mode is silent data loss in APIs.

class PsRole extends PermissiveModel.define<{ id: number; title: string }>("ps_roles") {
  declare pivot: Record<string, any>;
  static override timestamps = false;
}

class PsTag extends PermissiveModel.define<{ id: number; label: string }>("ps_tags") {
  static override timestamps = false;
}

class PsUser extends PermissiveModel.define<{ id: number; name: string }>("ps_users") {
  static override timestamps = false;

  roles() {
    return this.belongsToMany(PsRole, "ps_role_user", "user_id", "role_id").withPivot("scope").withTimestamps();
  }

  memberships() {
    return this.belongsToMany(PsRole, "ps_role_user", "user_id", "role_id").withPivot("scope").as("membership");
  }

  tags() {
    return this.morphToMany(PsTag, "taggable", "ps_taggables", "taggable_id", "tag_id").withPivot("weight");
  }
}

let connection: Connection;

beforeAll(async () => {
  connection = setupTestDb();
  MorphMap.register("PsUser", PsUser);

  await Schema.create("ps_users", (table) => { table.increments("id"); table.string("name"); });
  await Schema.create("ps_roles", (table) => { table.increments("id"); table.string("title"); });
  await Schema.create("ps_tags", (table) => { table.increments("id"); table.string("label"); });
  await Schema.create("ps_role_user", (table) => {
    table.integer("user_id");
    table.integer("role_id");
    table.string("scope");
    table.timestamps();
  });
  await Schema.create("ps_taggables", (table) => {
    table.integer("tag_id");
    table.integer("taggable_id");
    table.string("taggable_type");
    table.string("weight");
  });

  await PsUser.create({ name: "Ada" });
  await PsRole.create({ title: "admin" });
  await PsTag.create({ label: "urgent" });
  await connection.query(
    "INSERT INTO ps_role_user (user_id, role_id, scope, created_at, updated_at) VALUES (1, 1, 'global', '2020-01-01', '2020-01-02')",
    [],
  );
  await connection.query(
    "INSERT INTO ps_taggables (tag_id, taggable_id, taggable_type, weight) VALUES (1, 1, 'PsUser', 'heavy')",
    [],
  );
});

afterAll(async () => {
  await teardownTestDb(connection);
});

describe("pivot data in toJSON()", () => {
  test("withPivot and withTimestamps survive serialization", async () => {
    const user = await PsUser.query().first();
    const [role] = await user!.roles().get();

    expect(role!.toJSON()).toEqual({
      id: 1,
      title: "admin",
      pivot: { scope: "global", created_at: "2020-01-01", updated_at: "2020-01-02" },
    });
  });

  test("survives the eager-loading path too", async () => {
    const user = await PsUser.with("roles").first();
    const json = user!.toJSON() as any;
    expect(json.roles[0].pivot).toEqual({ scope: "global", created_at: "2020-01-01", updated_at: "2020-01-02" });
  });

  test("a custom accessor set with as() is used as the JSON key", async () => {
    const user = await PsUser.query().first();
    const [role] = await user!.memberships().get();
    expect((role!.toJSON() as any).membership).toEqual({ scope: "global" });
  });

  test("morphToMany pivots serialize as well", async () => {
    const user = await PsUser.query().first();
    const [tag] = await user!.tags().get();
    expect((tag!.toJSON() as any).pivot).toEqual({ weight: "heavy" });
  });

  test("makeHidden('pivot') removes it", async () => {
    const user = await PsUser.query().first();
    const [role] = await user!.roles().get();
    expect((role!.makeHidden("pivot").toJSON() as any).pivot).toBeUndefined();
  });
});
