import { expect, test } from "bun:test";
import {
  Factory,
  Model,
  type ModelMassAssignable,
  type ModelMassAssignmentAttributes,
} from "../src/index.js";

interface ProtectedUserAttributes {
  id: number;
  name: string;
  email: string;
  admin: boolean;
}

class ProtectedUser extends Model.define<ProtectedUserAttributes>("protected_users") {
  posts() {
    return this.hasMany(ProtectedPost, "user_id");
  }

  defaultPosts() {
    return this.hasMany(ProtectedPost);
  }

  fixedPosts() {
    return this.belongsToMany(ProtectedPost).where("title", "generated");
  }
}

interface ProtectedUser extends ModelMassAssignable<Pick<ProtectedUserAttributes, "name" | "email">> {}

interface ProtectedPostAttributes {
  id: number;
  user_id: number;
  title: string;
  admin: boolean;
}

class ProtectedPost extends Model.define<ProtectedPostAttributes>("protected_posts") {}
interface ProtectedPost extends ModelMassAssignable<Pick<ProtectedPostAttributes, "title" | "user_id">> {}

class EmptyPolicyModel extends Model.define<{ id: number; name: string }>("empty_policy_models") {}
interface EmptyPolicyModel extends ModelMassAssignable<{}> {}

class ProtectedUserFactory extends Factory<ProtectedUser> {
  definition(sequence: number) {
    return { name: `User ${sequence}`, email: `user${sequence}@example.com` };
  }
}

function typeAssertions(): void {
  if (false as boolean) {
    const assignable: ModelMassAssignmentAttributes<ProtectedUser> = {
      name: "Ada",
      email: "ada@example.com",
    };
    // @ts-expect-error admin is readable but is not mass-assignable.
    assignable.admin = true;

    ProtectedUser.create({ name: "Ada", email: "ada@example.com" });
    // @ts-expect-error create only accepts the generated writable subset.
    ProtectedUser.create({ admin: true });
    // @ts-expect-error model-level insert is protected.
    ProtectedUser.insert({ admin: true });
    // @ts-expect-error model-level upsert is protected.
    ProtectedUser.upsert({ admin: true }, "id");
    // @ts-expect-error createMany is protected.
    ProtectedUser.createMany([{ admin: true }]);

    const user = new ProtectedUser();
    user.fill({ name: "Grace" });
    // @ts-expect-error fill only accepts the writable subset.
    user.fill({ admin: true });
    // @ts-expect-error update only accepts the writable subset.
    user.update({ admin: true });

    ProtectedUser.where({ admin: true });
    user.setAttribute("admin", true);
    user.forceFill({ admin: true });
    ProtectedUser.forceCreate({ admin: true });
    ProtectedUser.query().forceCreate({ admin: true });
    // @ts-expect-error builder create still accepts only the writable subset.
    ProtectedUser.query().create({ admin: true });
    ProtectedUser.query().insert({ admin: true });

    ProtectedUser.firstOrNew({ admin: true }, { name: "Search criteria remain broad" });
    ProtectedUser.firstOrCreate({ admin: true }, { name: "Search criteria remain broad" });
    ProtectedUser.updateOrCreate({ admin: true }, { name: "Search criteria remain broad" });
    ProtectedUser.updateOrInsert({ admin: true }, { name: "Search criteria remain broad" });
    // @ts-expect-error firstOrNew values are protected.
    ProtectedUser.firstOrNew({ id: 1 }, { admin: true });
    // @ts-expect-error firstOrCreate values are protected.
    ProtectedUser.firstOrCreate({ id: 1 }, { admin: true });
    // @ts-expect-error updateOrCreate values are protected.
    ProtectedUser.updateOrCreate({ id: 1 }, { admin: true });
    // @ts-expect-error updateOrInsert values are protected.
    ProtectedUser.updateOrInsert({ id: 1 }, { admin: true });

    user.posts().create({ title: "Allowed" });
    ProtectedPost.create({ user_id: 123 });
    // @ts-expect-error the hasMany foreign key is controlled by the relation.
    user.posts().create({ user_id: 123 });
    user.defaultPosts().create({ title: "Allowed" });
    // @ts-expect-error conventional hasMany foreign keys are relation-controlled too.
    user.defaultPosts().create({ user_id: 123 });
    // @ts-expect-error relation creation uses the related model's writable subset.
    user.posts().create({ admin: true });
    user.fixedPosts().create({});
    // @ts-expect-error relation-fixed defaults are removed from creation input.
    user.fixedPosts().create({ title: "caller controlled" });

    const factory = new ProtectedUserFactory();
    factory.state({ name: "Factory state" });
    factory.make({ email: "factory@example.com" });
    factory.create({ name: "Factory create" });
    factory.state({ admin: true });
    factory.create({ admin: true });
    factory.insert({ id: 99, admin: true }, { chunkSize: 100 });

    EmptyPolicyModel.create({});
    // @ts-expect-error an empty generated subset rejects every property.
    EmptyPolicyModel.create({ name: "blocked" });
  }
}

test("mass-assignment type contracts compile", () => {
  void typeAssertions;
  expect(true).toBe(true);
});
