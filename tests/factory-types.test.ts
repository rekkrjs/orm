/**
 * Compile-time intellisense / type assertions for the factory API.
 *
 * The real checks are performed by `tsc` via `tsconfig.test.json`
 * (`bunx tsc -p tsconfig.test.json`). If any guarantee below regresses,
 * type-checking fails. The runtime body is intentionally trivial.
 */
import { test, expect } from "bun:test";
import { Model, Factory, type Connection, type FactoryAttributes } from "../src/index.js";

function expectType<T>(_v: T): void {}

class TUser extends Model.define<{ id: number; name: string; email: string }>("t_users") {
  posts() {
    return this.hasMany(TPost);
  }
  roles() {
    return this.belongsToMany(TRole);
  }
}
class TPost extends Model.define<{ id: number; t_user_id: number; title: string }>("t_posts") {
  user() {
    return this.belongsTo(TUser);
  }
}
class TRole extends Model.define<{ id: number; name: string }>("t_roles") {}

class TUserFactory extends Factory<TUser> {
  definition(seq: number) {
    return { name: `User ${seq}`, email: `u${seq}@x.com` };
  }
  admin() {
    return this.state({ name: "Admin" });
  }
}
class TPostFactory extends Factory<TPost> {
  definition(seq: number) {
    return { title: `Post ${seq}` };
  }
}
class TRoleFactory extends Factory<TRole> {
  definition(seq: number) {
    return { name: `Role ${seq}` };
  }
}
Factory.register(TUser, TUserFactory);
Factory.register(TPost, TPostFactory);
Factory.register(TRole, TRoleFactory);

// All assertions are compile-time. The block is type-checked but never
// executed (factory make()/create() hit the DB), so it sits behind `if (false)`.
function _typeAssertions(): void {
  if (false as boolean) {
    // Default overload: Model.factory() is a Factory typed to the model.
    const f = TUser.factory();
    expectType<Factory<TUser>>(f);

    // Explicit overload exposes the concrete subclass — custom state methods
    // like admin() are visible (full intellisense, NOT `any`).
    const sub = TUser.factory<TUserFactory>();
    expectType<TUserFactory>(sub);
    const chained = sub.admin().count(2).state({ email: "a@x.com" });
    // Chaining preserves the concrete subclass (admin() still available).
    expectType<TUserFactory>(chained);
    expectType<TUserFactory>(chained.admin());

    // make() / create() are typed to the model.
    const made = TUser.factory().make();
    const oneMade: TUser | TUser[] = made;
    expectType<TUser | TUser[]>(oneMade);
    const created = TUser.factory().create();
    expectType<Promise<TUser | TUser[]>>(created);
    expectType<TUser>(TUser.factory().count(3).makeOne());
    expectType<Promise<TUser>>(TUser.factory().count(3).createOne());
    expectType<Promise<TUser[]>>(TUser.factory().count(3).createMany());
    expectType<FactoryAttributes<TUser>>(TUser.factory().count(3).rawOne());
    expectType<Promise<TUser | TUser[]>>(TUser.factory().createQuietly());
    expectType<Promise<void>>(TUser.factory().insert({}, { chunkSize: 100 }));
    expectType<Factory<TUser>>(TUser.factory().connection(null as unknown as Connection));
    expectType<Factory<TUser>>(TUser.factory().hasAttached(TRole.factory(), { active: true }, "roles"));
    expectType<Factory<TUser>>(TUser.factory().has(TPost.factory(), "posts"));
    expectType<Factory<TPost>>(TPost.factory().for(TUser.factory(), "user"));

    // @ts-expect-error hasAttached only accepts many-to-many relation names.
    TUser.factory().hasAttached(TPost.factory(), "posts");

    // @ts-expect-error has() only accepts child relation names.
    TUser.factory().has(TRole.factory(), "roles");

    // @ts-expect-error for() only accepts belongsTo relation names.
    TPost.factory().for(TUser.factory(), "missing");

    // Built-in chain stays a Factory<TUser>.
    const c = TUser.factory().count(3).state({ name: "x" }).has(TPost.factory(), "posts");
    expectType<Factory<TUser>>(c);

    // @ts-expect-error make() yields the model, not a number (model typing flows)
    const bad: number = TUser.factory().make();
    void bad;
  }
}

test("factory type assertions compile", () => {
  void _typeAssertions; // referenced so TS keeps checking it
  expect(true).toBe(true);
});
