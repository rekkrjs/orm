import { expect, test, describe, beforeAll } from "./harness.js";
import { Model, Schema, Observer, ObserverRegistry } from "../src/index.js";
import { PermissiveModel, setupTestDb } from "./helpers.js";

function expectType<T>(_value: T): void {}

class ObservedUser extends PermissiveModel {
  static table = "observed_users";
}

class CleanSaveUser extends PermissiveModel {
  declare id: number;
  declare name: string;
  declare updated_at: string;
  static table = "clean_save_users";
}

class UnsavedDeleteUser extends PermissiveModel {
  static table = "unsaved_delete_users";
}

class Admission extends PermissiveModel {
  static table = "admissions";
}

class Order extends PermissiveModel {
  static table = "orders";
}

describe("Observers", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("observed_users", (table) => {
      table.increments("id");
      table.string("name");
      table.timestamps();
    });
    await Schema.create("clean_save_users", (table) => {
      table.increments("id");
      table.string("name");
      table.timestamps();
    });
    await Schema.create("admissions", (table) => {
      table.increments("id");
      table.string("name");
      table.timestamps();
    });
    await Schema.create("orders", (table) => {
      table.increments("id");
      table.string("number");
      table.timestamps();
    });
  });

  test("fires creating and created events", async () => {
    const events: string[] = [];
    ObserverRegistry.register(ObservedUser, {
      creating() {
        events.push("creating");
      },
      created() {
        events.push("created");
      },
    });

    await ObservedUser.create({ name: "Alice" });
    expect(events).toContain("creating");
    expect(events).toContain("created");
  });

  test("can suppress events during create", async () => {
    const events: string[] = [];
    ObserverRegistry.register(ObservedUser, {
      creating() {
        events.push("creating");
      },
      created() {
        events.push("created");
      },
    });

    await ObservedUser.create({ name: "Silent Alice" }, { events: false });
    expect(events).toEqual([]);
  });

  test("fires updating and updated events", async () => {
    const events: string[] = [];
    ObserverRegistry.register(ObservedUser, {
      updating() {
        events.push("updating");
      },
      updated() {
        events.push("updated");
      },
    });

    const user = await ObservedUser.create({ name: "Bob" });
    user.setAttribute("name", "Bob 2");
    await user.save();
    expect(events).toContain("updating");
    expect(events).toContain("updated");
  });

  test("fires saving and saved events on create and update", async () => {
    const events: string[] = [];
    ObserverRegistry.register(ObservedUser, {
      saving() {
        events.push("saving");
      },
      saved() {
        events.push("saved");
      },
    });

    const user = await ObservedUser.create({ name: "Carl" });
    expect(events.filter((e) => e === "saving")).toHaveLength(1);
    expect(events.filter((e) => e === "saved")).toHaveLength(1);

    user.setAttribute("name", "Carl 2");
    await user.save();
    expect(events.filter((e) => e === "saving")).toHaveLength(2);
    expect(events.filter((e) => e === "saved")).toHaveLength(2);
  });

  test("fires deleting and deleted events", async () => {
    const events: string[] = [];
    ObserverRegistry.register(ObservedUser, {
      deleting() {
        events.push("deleting");
      },
      deleted() {
        events.push("deleted");
      },
    });

    const user = await ObservedUser.create({ name: "Dan" });
    await user.delete();
    expect(events).toContain("deleting");
    expect(events).toContain("deleted");
  });

  test("does not fire updating events or touch timestamp when clean model is saved", async () => {
    const events: string[] = [];
    ObserverRegistry.register(CleanSaveUser, {
      saving() {
        events.push("saving");
      },
      updating() {
        events.push("updating");
      },
      updated() {
        events.push("updated");
      },
      saved() {
        events.push("saved");
      },
    });

    const user = await CleanSaveUser.create({ name: "Erin" });
    const originalUpdatedAt = user.updated_at;
    await new Promise((resolve) => setTimeout(resolve, 10));
    await user.save();

    expect(user.updated_at).toBe(originalUpdatedAt);
    expect(events).toEqual(["saving", "saved", "saving", "saved"]);
  });

  test("does not fire delete events for unsaved models", async () => {
    const events: string[] = [];
    ObserverRegistry.register(UnsavedDeleteUser, {
      deleting() {
        events.push("deleting");
      },
      deleted() {
        events.push("deleted");
      },
    });

    const user = new UnsavedDeleteUser({ name: "No row" });
    expect(await user.delete()).toBe(false);
    expect(events).toEqual([]);
  });

  test("observer subclasses can self-register with observe()", async () => {
    const events: string[] = [];

    class AdmissionObserver extends Observer<Admission> {
      created(admission: Admission) {
        events.push(admission.getAttribute("name"));
      }
    }

    AdmissionObserver.observe(Admission);

    await Admission.create({ name: "Self Registered" });
    expect(events).toEqual(["Self Registered"]);

    ObserverRegistry.unregister(Admission);
  });

  test("observer hook methods accept the model type from the generic", async () => {
    class TypedAdmissionObserver extends Observer<Admission> {
      async created(admission: Admission) {
        expectType<Admission>(admission);
        events.push(admission.getAttribute("name"));
      }
    }

    const events: string[] = [];
    TypedAdmissionObserver.observe(Admission);
    await Admission.create({ name: "Typed" });
    expect(events).toEqual(["Typed"]);
    ObserverRegistry.unregister(Admission);
  });

  test("observer.observe accepts multiple model classes", async () => {
    const events: string[] = [];

    class AuditObserver extends Observer<Model> {
      created(model: Model) {
        if (model.isInstanceOf(ObservedUser)) {
          events.push(`user:${model.getAttribute("name")}`);
        }
        if (model.isInstanceOf(Order)) {
          events.push(`order:${model.getAttribute("number")}`);
        }
      }
    }

    AuditObserver.observe([ObservedUser, Order]);

    await ObservedUser.create({ name: "Multi User" });
    await Order.create({ number: "ORD-1" });

    expect(events).toEqual(["user:Multi User", "order:ORD-1"]);

    ObserverRegistry.unregister(ObservedUser);
    ObserverRegistry.unregister(Order);
  });

  test("observer.observe accepts multiple model classes for union observers", async () => {
    const events: string[] = [];

    type AuditModel = Admission | Order;

    class UnionAuditObserver extends Observer<AuditModel> {
      created(model: AuditModel) {
        if (model.isInstanceOf(Admission)) {
          events.push(`admission:${model.getAttribute("name")}`);
        }
        if (model.isInstanceOf(Order)) {
          events.push(`order:${model.getAttribute("number")}`);
        }
      }
    }

    UnionAuditObserver.observe([Admission, Order]);

    await Admission.create({ name: "Union Admission" });
    await Order.create({ number: "ORD-U" });

    expect(events).toEqual(["admission:Union Admission", "order:ORD-U"]);

    UnionAuditObserver.unobserve([Admission, Order]);
  });

  test("observer.unobserve removes only the registrations owned by that observer", async () => {
    const events: string[] = [];

    class AuditObserver extends Observer<Model> {
      created(model: Model) {
        if (model.isInstanceOf(ObservedUser)) {
          events.push(`user:${model.getAttribute("name")}`);
        }
        if (model.isInstanceOf(Order)) {
          events.push(`order:${model.getAttribute("number")}`);
        }
      }
    }

    AuditObserver.observe([ObservedUser, Order]);

    await ObservedUser.create({ name: "Before Unobserve" });
    await Order.create({ number: "ORD-2" });
    expect(events).toEqual(["user:Before Unobserve", "order:ORD-2"]);

    AuditObserver.unobserve([ObservedUser, Order]);
    events.length = 0;

    await ObservedUser.create({ name: "After Unobserve" });
    await Order.create({ number: "ORD-3" });

    expect(events).toEqual([]);
  });
});
