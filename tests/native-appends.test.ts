import { beforeAll, describe, expect, test } from "./harness.js";
import { Model, Schema } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

type AppendedUserAttributes = {
  id: number;
  firstName: string;
  lastName: string;
  score: number;
};

class AppendedUser extends Model.define<AppendedUserAttributes>("appended_users") {
  static override timestamps = false;
  static override guarded: string[] = [];
  static override appends = ["fullName", "scoreLabel"];
  static override casts = { score: "integer" };
  static getterCalls = 0;

  get fullName(): string {
    AppendedUser.getterCalls++;
    return `${this.firstName} ${this.lastName}`.trim();
  }

  get initials(): string {
    return `${this.firstName[0] ?? ""}${this.lastName[0] ?? ""}`.toUpperCase();
  }

  get scoreLabel(): string {
    return `${this.score}:${typeof this.score}`;
  }
}

beforeAll(async () => {
  setupTestDb();
  await Schema.create(AppendedUser.table, (table) => {
    table.increments("id");
    table.string("firstName");
    table.string("lastName");
    table.integer("score");
  });
});

describe("Native getters in appends", () => {
  test("direct access and every JSON API include native getter values", () => {
    const user = AppendedUser.hydrate({ id: 1, firstName: "Ada", lastName: "Lovelace", score: "7" });

    AppendedUser.getterCalls = 0;
    expect(user.fullName).toBe("Ada Lovelace");
    expect(AppendedUser.getterCalls).toBe(1);

    AppendedUser.getterCalls = 0;
    expect(user.toJSON()).toMatchObject({ fullName: "Ada Lovelace", scoreLabel: "7:number" });
    expect(AppendedUser.getterCalls).toBe(1);

    AppendedUser.getterCalls = 0;
    expect(user.json()).toMatchObject({ fullName: "Ada Lovelace", scoreLabel: "7:number" });
    expect(AppendedUser.getterCalls).toBe(1);

    AppendedUser.getterCalls = 0;
    expect(JSON.parse(JSON.stringify(user))).toMatchObject({ fullName: "Ada Lovelace", scoreLabel: "7:number" });
    expect(AppendedUser.getterCalls).toBe(1);
  });

  test("append() and setAppends() resolve native getters", () => {
    const appended = AppendedUser.hydrate({ id: 2, firstName: "Grace", lastName: "Hopper", score: 8 })
      .append("initials");
    expect(appended.json().initials).toBe("GH");

    const replaced = AppendedUser.hydrate({ id: 3, firstName: "Katherine", lastName: "Johnson", score: 9 })
      .setAppends(["initials"]);
    expect(replaced.json().initials).toBe("KJ");
  });

  test("visibility is applied before a getter is evaluated", () => {
    const hidden = AppendedUser.hydrate({ id: 4, firstName: "Hidden", lastName: "Getter", score: 1 });
    hidden.makeHidden("fullName");
    AppendedUser.getterCalls = 0;
    expect(hidden.toJSON()).not.toHaveProperty("fullName");
    expect(AppendedUser.getterCalls).toBe(0);

    const visible = AppendedUser.hydrate({ id: 5, firstName: "Visible", lastName: "Getter", score: 2 });
    visible.makeVisible("fullName");
    AppendedUser.getterCalls = 0;
    expect(visible.toJSON() as Record<string, unknown>).toEqual({
      id: 5,
      firstName: "Visible",
      lastName: "Getter",
      score: 2,
      fullName: "Visible Getter",
      scoreLabel: "2:number",
    });
    expect(AppendedUser.getterCalls).toBe(1);
  });

  test("static accessors keep precedence over a native getter with the same name", () => {
    class PrecedenceUser extends Model {
      static override timestamps = false;
      static override guarded: string[] = [];
      static override appends = ["label"];
      static override accessors = {
        label: { get: () => "static-accessor" },
      };

      get label(): string {
        return "native-getter";
      }
    }

    const user = new PrecedenceUser();
    expect(user.label).toBe("static-accessor");
    expect(user.toJSON().label).toBe("static-accessor");
  });

  test("getter failures propagate", () => {
    class FailingUser extends Model {
      static override timestamps = false;
      static override appends = ["failure"];

      get failure(): never {
        throw new Error("getter failed");
      }
    }

    expect(() => new FailingUser().toJSON()).toThrow("getter failed");
  });

  test("computed output never becomes an attribute, dirty value, or SQL payload", async () => {
    const user = await AppendedUser.create({ firstName: "Margaret", lastName: "Hamilton", score: 10 });
    expect(user.toJSON().fullName).toBe("Margaret Hamilton");
    expect(user.$attributes).not.toHaveProperty("fullName");
    expect(user.getDirty()).not.toHaveProperty("fullName");
    expect(user.attributesForDriver(user.getConnection())).not.toHaveProperty("fullName");

    user.firstName = "Maggie";
    await user.save();
    expect((await AppendedUser.findOrFail(user.id)).firstName).toBe("Maggie");
  });
});
