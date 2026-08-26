/**
 * Compile-time intellisense / type assertions for the factory API.
 *
 * The real checks are performed by `tsc` via `tsconfig.test.json`
 * (`bunx tsc -p tsconfig.test.json`). If any guarantee below regresses,
 * type-checking fails. The runtime body is intentionally trivial.
 */
import { test, expect } from "bun:test";
import { Model, Factory } from "../src/index.js";

function expectType<T>(_v: T): void {}

class TUser extends Model.define<{ id: number; name: string; email: string }>("t_users") {
  posts() {
    return this.hasMany(TPost);
  }
}
class TPost extends Model.define<{ id: number; t_user_id: number; title: string }>("t_posts") {
  user() {
    return this.belongsTo(TUser);
  }
}

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
Factory.register(TUser, TUserFactory);
Factory.register(TPost, TPostFactory);

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
    expectType<Promise<void>>(TUser.factory().insert({}, { chunkSize: 100 }));

    // Built-in chain stays a Factory<TUser>.
    const c = TUser.factory().count(3).state({ name: "x" }).for(TPost.factory(), "user");
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
