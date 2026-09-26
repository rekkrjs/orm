import { afterAll, beforeAll, describe, expect, test } from "./harness.js";
import { Connection, DB, Model, Observer, Schema, type CastsAttributes } from "../src/index.js";
import { getModelTarget, modelProxyHandler } from "../src/model/ModelBase.js";
import { PermissiveModel } from "./helpers.js";

// create() fills and saves a plain model through the object behind its Proxy,
// which skips the Proxy trap on every internal field read. Whatever user code
// runs during the create must still receive the Proxy: these tests read an
// attribute as a property there, which only the Proxy answers.

const seen: unknown[] = [];

class CreatedPlain extends Model {
  static override table = "created_plain";
  static override timestamps = false;
  static override fillable = ["name", "email", "settings"];
  static override casts = { settings: "json" };
}

class CreatedObserved extends CreatedPlain {}
class NameObserver extends Observer<CreatedObserved> {
  override creating(model: CreatedObserved) {
    seen.push((model as any).name);
  }
}

class CreatedWithAccessor extends CreatedPlain {
  static override accessors = {
    email: { set: (value: unknown, _attributes: Record<string, unknown>, model: any) => (seen.push(model.name), value) },
  };
}

class NameReadingCast implements CastsAttributes {
  get(_model: unknown, _key: string, value: unknown) {
    return value;
  }
  set(model: any, _key: string, value: unknown) {
    seen.push(model.name);
    return value;
  }
}

class CreatedWithCustomCast extends CreatedPlain {
  static override casts = { settings: "json", email: NameReadingCast };
}

class CreatedWithOverride extends CreatedPlain {
  override setAttribute(key: string, value: any): void {
    if (key === "email") seen.push((this as any).name);
    super.setAttribute(key, value);
  }
}

class CreatedWithInstanceMethod extends CreatedPlain {
  override getDirty = function (this: any) {
    seen.push(this.name);
    return CreatedPlain.prototype.getDirty.call(this);
  };
}

class CreatedTeam extends PermissiveModel {
  static override table = "created_teams";
}

class CreatedTouching extends CreatedPlain {
  static override touches = ["team"];
  static override fillable = ["name", "email", "settings", "team_id"];
  team() {
    seen.push((this as any).name);
    return this.belongsTo(CreatedTeam, "team_id");
  }
}

describe("create() through the model behind its Proxy", () => {
  const connection = new Connection({ url: "sqlite://:memory:" });

  beforeAll(async () => {
    Model.setConnection(connection);
    Schema.setConnection(connection);
    await Schema.create("created_plain", (t) => {
      t.increments("id");
      t.string("name");
      t.string("email");
      t.json("settings").nullable();
      t.integer("team_id").nullable();
    });
    await Schema.create("created_teams", (t) => {
      t.increments("id");
      t.string("name");
      t.timestamps();
    });
    await DB.table("created_teams").insert({ name: "Team", created_at: "2026-01-01 00:00:00", updated_at: "2026-01-01 00:00:00" });
  });

  afterAll(async () => {
    await connection.close();
  });

  test("creates a plain model without entering the Proxy trap per field", async () => {
    const get = modelProxyHandler.get!;
    let traps = 0;
    modelProxyHandler.get = function (...args) {
      traps++;
      return get.apply(this, args);
    };
    let created: CreatedPlain;
    try {
      created = await CreatedPlain.create({ name: "Núñez", email: "n@example.test", settings: { a: [1] } } as any);
    } finally {
      modelProxyHandler.get = get;
    }
    // One read to reach the target, and the `then` probe each async return
    // (Builder.create, Model.create) makes on the model it resolves with. The
    // fill and the save through the Proxy took 96 in all.
    expect(traps).toBe(3);

    expect(getModelTarget(created) === (created as any)).toBe(false);
    expect((created as any).name).toBe("Núñez");
    expect((created as any).settings).toEqual({ a: [1] });
    expect(created.$exists).toBe(true);
    expect(created.$wasRecentlyCreated).toBe(true);
    expect(created.getDirty()).toEqual({});
    expect(await DB.table("created_plain").where("id", (created as any).id).first())
      .toEqual({ id: (created as any).id, name: "Núñez", email: "n@example.test", settings: '{"a":[1]}', team_id: null });
    // Mass assignment still applies: team_id is not fillable and is left out.
    const guarded = await CreatedPlain.create({ name: "x", email: "x@example.test", team_id: 1 } as any);
    expect((await DB.table("created_plain").where("id", (guarded as any).id).first())!.team_id).toBeNull();
  });

  test("keeps the Proxy for observers, accessors, custom casts and overridden methods", async () => {
    NameObserver.observe(CreatedObserved);
    try {
      for (const model of [CreatedObserved, CreatedWithAccessor, CreatedWithCustomCast, CreatedWithOverride, CreatedWithInstanceMethod]) {
        seen.length = 0;
        const created = await (model as any).create({ name: "Ada", email: "a@example.test" });
        expect([model.name, seen[0]]).toEqual([model.name, "Ada"]);
        expect(created.name).toBe("Ada");
      }
    } finally {
      NameObserver.unobserve(CreatedObserved);
    }
  });

  test("keeps the Proxy for touches and in the Identity Map", async () => {
    seen.length = 0;
    await CreatedTouching.create({ name: "Grace", email: "g@example.test", team_id: 1 } as any);
    expect(seen).toEqual(["Grace"]);

    await CreatedPlain.useIdentityMap(async () => {
      const created = await CreatedPlain.create({ name: "Linus", email: "l@example.test" } as any);
      expect(await CreatedPlain.find((created as any).id)).toBe(created);
    });
  });
});
