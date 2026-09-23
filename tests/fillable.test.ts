import { expect, test, describe, beforeAll } from "./harness.js";
import { Factory, MassAssignmentError, Model, Schema } from "../src/index.js";
import { setupTestDb } from "./helpers.js";

class GuardedModel extends Model {
  static table = "guarded";
  static guarded = ["id", "role"];
}

class FillableModel extends Model {
  static table = "fillable";
  static fillable = ["name", "email"];
}

class NoPolicyModel extends Model {
  static table = "default_protected";
}

class EmptyFillableModel extends Model {
  static fillable: string[] = [];
}

class EmptyGuardedModel extends Model {
  static guarded: string[] = [];
}

class FullyGuardedModel extends Model {
  static guarded = ["*"];
}

class StrictGuardedModel extends Model {
  static guarded = ["role"];
  static preventSilentlyDiscardingAttributes = true;
}

class DefaultedGuardedModel extends Model {
  static guarded = ["role"];
  static attributes = { role: "user" };
}

class FullyGuardedDefaultModel extends Model {
  static guarded = ["*"];
  static attributes = { role: "system" };
}

class TrustedCriteriaModel extends Model {
  static table = "fillable";
  static guarded = ["id", "email", "secret"];
}

class BothPoliciesModel extends Model {
  static fillable = ["name"];
  static guarded = ["role"];
}

class ParentPolicyModel extends Model {
  static fillable = ["name"];
}

class InheritedPolicyModel extends ParentPolicyModel {}

class ReplacedPolicyModel extends ParentPolicyModel {
  static guarded = ["role"];
}

class RelationParent extends Model {
  static table = "policy_parents";
  static fillable = ["name"];

  children() {
    return this.hasMany(RelationChild, "parent_id");
  }

  publishedChildren() {
    return this.hasMany(RelationChild, "parent_id").where("status", "published");
  }

  defaultChild() {
    return this.hasOne(RelationChild, "parent_id").withDefault({ parent_id: 999, name: "Default" });
  }

  image() {
    return this.morphOne(RelationImage, "imageable").where("kind", "avatar");
  }

  images() {
    return this.morphMany(RelationImage, "imageable").where("kind", "gallery");
  }

  tags() {
    return this.belongsToMany(RelationTag, "policy_parent_tags", "parent_id", "tag_id")
      .where("kind", "generated");
  }
}

class RelationChild extends Model {
  static table = "policy_children";
  static guarded = ["parent_id", "status"];

  parent() {
    return this.belongsTo(RelationParent, "parent_id");
  }
}

class RelationImage extends Model {
  static table = "policy_images";
  static guarded = ["imageable_id", "imageable_type", "kind"];
}

class RelationTag extends Model {
  static table = "policy_tags";
  static guarded = ["kind"];
}

class DefinedWithColumnsModel extends Model.define<{
  name: string;
  secret: string;
}>("defined_with_columns", { name: "string" }) {}

class DefinedWithoutColumnsModel extends Model.define<{
  name: string;
}>("defined_without_columns") {}

class RelationParentFactory extends Factory<RelationParent> {
  definition() {
    return { name: "Factory parent" };
  }
}

class RelationChildFactory extends Factory<RelationChild> {
  definition() {
    return { name: "Factory child" };
  }
}

Factory.register(RelationParent, RelationParentFactory);
Factory.register(RelationChild, RelationChildFactory);

describe("Mass Assignment Protection", () => {
  beforeAll(async () => {
    setupTestDb();
    await Schema.create("guarded", (table) => {
      table.increments("id");
      table.string("name").unique();
      table.string("role").nullable();
      table.timestamps();
    });
    await Schema.create("default_protected", (table) => {
      table.increments("id");
      table.string("name").nullable();
      table.timestamps();
    });
    await Schema.create("policy_parents", (table) => {
      table.increments("id");
      table.string("name").unique();
      table.timestamps();
    });
    await Schema.create("policy_children", (table) => {
      table.increments("id");
      table.integer("parent_id").nullable();
      table.string("name");
      table.string("status").nullable();
      table.timestamps();
    });
    await Schema.create("policy_images", (table) => {
      table.increments("id");
      table.integer("imageable_id");
      table.string("imageable_type");
      table.string("kind");
      table.string("url");
      table.timestamps();
    });
    await Schema.create("policy_tags", (table) => {
      table.increments("id");
      table.string("name");
      table.string("kind");
      table.timestamps();
    });
    await Schema.create("policy_parent_tags", (table) => {
      table.increments("id");
      table.integer("parent_id");
      table.integer("tag_id");
    });
    await Schema.create("fillable", (table) => {
      table.increments("id");
      table.string("name").unique();
      table.string("email").nullable().unique();
      table.string("secret").nullable();
      table.timestamps();
    });
  });

  test("guarded prevents filling protected fields", async () => {
    const record = await GuardedModel.create({ name: "Alice", role: "admin" });
    expect(record.getAttribute("name")).toBe("Alice");
    expect(record.getAttribute("role")).toBeUndefined();
  });

  test("fillable only allows specified fields", async () => {
    const record = await FillableModel.create({ name: "Bob", email: "bob@example.com", secret: "hidden" });
    expect(record.getAttribute("name")).toBe("Bob");
    expect(record.getAttribute("email")).toBe("bob@example.com");
    expect(record.getAttribute("secret")).toBeUndefined();
  });

  test("setAttribute bypasses fillable/guarded", () => {
    const record = new FillableModel();
    record.setAttribute("secret", "set directly");
    expect(record.getAttribute("secret")).toBe("set directly");
  });

  test("throws for mass assignment without an explicit policy", () => {
    expect(() => new NoPolicyModel({ name: "Blocked" })).toThrow(MassAssignmentError);

    const unconfigured = new NoPolicyModel();
    expect(() => unconfigured.fill({ name: "Still blocked" })).toThrow(MassAssignmentError);

    let caught: unknown;
    try {
      unconfigured.fill({ name: "Still blocked", role: "admin" } as any);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(MassAssignmentError);
    expect((caught as MassAssignmentError).model).toBe("NoPolicyModel");
    expect((caught as MassAssignmentError).attributes).toEqual(["name", "role"]);
  });

  test("distinguishes the protected default from explicit empty arrays", () => {
    expect(() => new EmptyFillableModel({ name: "Blocked" })).toThrow(MassAssignmentError);

    const emptyGuarded = new EmptyGuardedModel({ name: "Allowed" });
    expect(emptyGuarded.getAttribute("name")).toBe("Allowed");
  });

  test("direct assignment and save bypass mass assignment protection", async () => {
    const record = new NoPolicyModel();
    (record as any).name = "Direct assignment";
    await record.save();

    expect(record.getAttribute("name")).toBe("Direct assignment");
    expect(
      (await NoPolicyModel.findOrFail(record.getAttribute("id"))).getAttribute("name")
    ).toBe("Direct assignment");
  });

  test("forceFill and forceCreate bypass the protected default", async () => {
    const filled = new NoPolicyModel().forceFill({ name: "Force fill" });
    expect(filled.getAttribute("name")).toBe("Force fill");

    const created = await NoPolicyModel.forceCreate({ name: "Force create" });
    expect(created.getAttribute("name")).toBe("Force create");
  });

  test("create and instance update throw for the protected default", async () => {
    await expect(NoPolicyModel.create({ name: "Blocked create" })).rejects.toBeInstanceOf(MassAssignmentError);

    const existing = await NoPolicyModel.forceCreate({ name: "Before update" });
    await expect(existing.update({ name: "Blocked update" })).rejects.toBeInstanceOf(MassAssignmentError);
    expect(existing.getAttribute("name")).toBe("Before update");
    expect(
      (await NoPolicyModel.findOrFail(existing.getAttribute("id"))).getAttribute("name")
    ).toBe("Before update");
  });

  test("allows empty input on a fully guarded model", async () => {
    expect(() => new NoPolicyModel({})).not.toThrow();
    const created = await NoPolicyModel.create({});
    expect(created.$exists).toBe(true);
  });

  test("Model.define generates fillable from columns and otherwise stays protected", () => {
    const withColumns = new DefinedWithColumnsModel({
      name: "Allowed",
      secret: "Blocked",
    });
    expect(withColumns.getAttribute("name")).toBe("Allowed");
    expect(withColumns.getAttribute("secret")).toBeUndefined();

    expect(() => new DefinedWithoutColumnsModel({ name: "Blocked" })).toThrow(MassAssignmentError);
  });

  test("guarded wildcard throws when it discards attributes", () => {
    expect(() => new FullyGuardedModel({ name: "Blocked", role: "admin" })).toThrow(MassAssignmentError);
  });

  test("partial policies stay silent unless strict mode is enabled", () => {
    const partial = new GuardedModel({ name: "Allowed", role: "blocked" });
    expect(partial.getAttribute("name")).toBe("Allowed");
    expect(partial.getAttribute("role")).toBeUndefined();

    expect(() => new StrictGuardedModel({ name: "Allowed", role: "blocked" })).toThrow(MassAssignmentError);

    Model.preventSilentlyDiscardingAttributes = true;
    try {
      expect(() => new GuardedModel({ name: "Allowed", role: "blocked" })).toThrow(MassAssignmentError);
    } finally {
      Model.preventSilentlyDiscardingAttributes = false;
    }
  });

  test("rejects declaring fillable and guarded on the same class", () => {
    expect(() => new BothPoliciesModel()).toThrow(
      "BothPoliciesModel cannot declare both fillable and guarded mass assignment policies."
    );
    expect(() => BothPoliciesModel.query()).toThrow(
      "BothPoliciesModel cannot declare both fillable and guarded mass assignment policies."
    );
  });

  test("inherits a policy and lets a subclass replace it", () => {
    const inherited = new InheritedPolicyModel({ name: "Allowed", email: "blocked@example.com" });
    expect(inherited.getAttribute("name")).toBe("Allowed");
    expect(inherited.getAttribute("email")).toBeUndefined();

    const replaced = new ReplacedPolicyModel({ name: "Allowed", email: "allowed@example.com", role: "blocked" });
    expect(replaced.getAttribute("name")).toBe("Allowed");
    expect(replaced.getAttribute("email")).toBe("allowed@example.com");
    expect(replaced.getAttribute("role")).toBeUndefined();
  });

  test("never mass assigns internal or prototype-sensitive keys", () => {
    const attributes = Object.fromEntries([
      ["name", "Allowed"],
      ["$attributes", { compromised: true }],
      ["$exists", true],
      ["__proto__", { compromised: true }],
      ["prototype", { compromised: true }],
      ["constructor", { compromised: true }],
    ]);
    const record = new EmptyGuardedModel(attributes);

    expect(record.getAttribute("name")).toBe("Allowed");
    for (const key of ["$attributes", "$exists", "__proto__", "prototype", "constructor"]) {
      expect(Object.hasOwn(record.$attributes, key)).toBe(false);
    }
    expect(record.$exists).toBe(false);

    const protectedRecord = new NoPolicyModel(Object.fromEntries([
      ["$attributes", { compromised: true }],
      ["__proto__", { compromised: true }],
      ["prototype", { compromised: true }],
      ["constructor", { compromised: true }],
    ]));
    expect(protectedRecord.$attributes).toEqual({});
  });

  test("forceFill and forceCreate bypass the declared policy", async () => {
    const filled = new FillableModel().forceFill({ secret: "forced" });
    expect(filled.getAttribute("secret")).toBe("forced");

    const created = await FillableModel.forceCreate({ name: "Force Create", secret: "forced" });
    expect(created.getAttribute("secret")).toBe("forced");
  });

  test("model defaults and replicas use trusted assignment", () => {
    expect(new DefaultedGuardedModel().getAttribute("role")).toBe("user");
    expect(new FullyGuardedDefaultModel().getAttribute("role")).toBe("system");

    const source = new FullyGuardedModel().forceFill({
      id: 42,
      name: "Replica",
      role: "secret",
      created_at: "old",
    });
    const replica = source.replicate();
    expect(replica.getAttribute("id")).toBeUndefined();
    expect(replica.getAttribute("created_at")).toBeUndefined();
    expect(replica.getAttribute("name")).toBe("Replica");
    expect(replica.getAttribute("role")).toBe("secret");
  });

  test("creation criteria stay trusted while values remain protected", async () => {
    const unsaved = await TrustedCriteriaModel.firstOrNew(
      { email: "first-new@example.com" },
      { name: "First new", secret: "blocked" }
    );
    expect(unsaved.getAttribute("email")).toBe("first-new@example.com");
    expect(unsaved.getAttribute("secret")).toBeUndefined();

    const first = await TrustedCriteriaModel.firstOrCreate(
      { email: "first-create@example.com" },
      { name: "First create", secret: "blocked" }
    );
    expect(first.getAttribute("email")).toBe("first-create@example.com");
    const same = await TrustedCriteriaModel.firstOrCreate(
      { email: "first-create@example.com" },
      { name: "Duplicate" }
    );
    expect(same.getAttribute("id")).toBe(first.getAttribute("id"));

    const updated = await TrustedCriteriaModel.updateOrCreate(
      { email: "update-create@example.com" },
      { name: "Update create" }
    );
    expect(updated.getAttribute("email")).toBe("update-create@example.com");

    await TrustedCriteriaModel.updateOrInsert(
      { email: "update-insert@example.com" },
      { name: "Update insert" }
    );
    expect(
      (await TrustedCriteriaModel.where("email", "update-insert@example.com").firstOrFail()).getAttribute("email")
    ).toBe("update-insert@example.com");

    const builderFirst = await TrustedCriteriaModel.query().firstOrCreate(
      { email: "builder-first@example.com" },
      { name: "Builder first" }
    );
    expect(builderFirst.getAttribute("email")).toBe("builder-first@example.com");

    const builderUpdated = await TrustedCriteriaModel.query().updateOrCreate(
      { email: "builder-update@example.com" },
      { name: "Builder update" }
    );
    expect(builderUpdated.getAttribute("email")).toBe("builder-update@example.com");
  });

  test("model bulk writes and update apply the policy", async () => {
    await FillableModel.insert({ name: "Bulk Insert", email: "insert@example.com", secret: "blocked" });
    const inserted = await FillableModel.where("name", "Bulk Insert").firstOrFail();
    expect(inserted.getAttribute("secret")).toBeNull();

    await FillableModel.upsert(
      { name: "Bulk Upsert", email: "before@example.com", secret: "blocked" },
      "name"
    );
    await FillableModel.upsert(
      { name: "Bulk Upsert", email: "after@example.com", secret: "still blocked" },
      "name"
    );
    const upserted = await FillableModel.where("name", "Bulk Upsert").firstOrFail();
    expect(upserted.getAttribute("email")).toBe("after@example.com");
    expect(upserted.getAttribute("secret")).toBeNull();

    const [many] = await FillableModel.createMany([
      { name: "Create Many", email: "many@example.com", secret: "blocked" },
    ]);
    expect(many.getAttribute("secret")).toBeUndefined();

    await many.update({ email: "updated@example.com", secret: "blocked again" });
    expect(many.getAttribute("email")).toBe("updated@example.com");
    expect(many.getAttribute("secret")).toBeUndefined();
  });

  test("relations preserve guarded foreign keys, morph fields, and defaults", async () => {
    const parent = await RelationParent.create({ name: "Relations" });

    const child = await parent.children().create({ name: "Child", parent_id: 999 });
    expect(child.getAttribute("parent_id")).toBe(parent.getAttribute("id"));

    const createdOrUpdated = await parent.children().createOrUpdate(
      { status: "draft" },
      { name: "Created or updated" }
    );
    expect(createdOrUpdated.getAttribute("status")).toBe("draft");
    expect(createdOrUpdated.getAttribute("parent_id")).toBe(parent.getAttribute("id"));

    const image = await parent.image().attach({ url: "avatar.png" });
    expect(image.getAttribute("imageable_id")).toBe(parent.getAttribute("id"));
    expect(image.getAttribute("imageable_type")).toBe("RelationParent");
    expect(image.getAttribute("kind")).toBe("avatar");

    const [gallery] = await parent.images().attachMany([{ url: "gallery.png" }]);
    expect(gallery.getAttribute("imageable_id")).toBe(parent.getAttribute("id"));
    expect(gallery.getAttribute("kind")).toBe("gallery");

    const tag = await parent.tags().create({ name: "Tag" });
    expect(tag.getAttribute("kind")).toBe("generated");

    const emptyParent = new RelationParent().forceFill({ id: 9999 });
    const fallback = await emptyParent.defaultChild().get();
    expect(fallback?.getAttribute("parent_id")).toBe(999);
  });

  test("factory relationship attributes bypass guarded fields", async () => {
    const parent = await RelationParent.create({ name: "Factory relation" });
    const child = await new RelationChildFactory().for(parent, "parent").create() as RelationChild;
    expect(child.getAttribute("parent_id")).toBe(parent.getAttribute("id"));

    const factoryParent = await new RelationParentFactory()
      .has(new RelationChildFactory(), "publishedChildren")
      .create() as RelationParent;
    const generated = await RelationChild.where("parent_id", factoryParent.getAttribute("id")).firstOrFail();
    expect(generated.getAttribute("status")).toBe("published");
  });
});
