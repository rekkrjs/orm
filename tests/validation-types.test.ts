/**
 * Compile-time intellisense / type assertions for the validation API,
 * focused on `object` / `record` / `unknown`. Real checks happen in `tsc`
 * via `tsconfig.test.json`. Runtime body is trivial.
 */
import { test, expect } from "./harness.js";
import { rule, Validator } from "../src/validation/index.js";

function expectType<T>(_v: T): void {}

function _typeAssertions(): void {
  if (false as boolean) {
    // --- unknown() ---
    const s1 = Validator.schema({ x: rule().unknown() });
    s1.parse(undefined).then((o) => expectType<{ x: unknown }>(o));

    // --- object() with typed-per-key shape ---
    const s2 = Validator.schema({
      meta: rule().object({
        name: rule().string(),
        age: rule().integer(),
      }),
    });
    s2.parse(undefined).then((o) =>
      expectType<{ meta: { name: string; age: number } }>(o)
    );

    // --- record() — no args, default Record<string, unknown> ---
    const s3 = Validator.schema({ blob: rule().record() });
    s3.parse(undefined).then((o) => expectType<{ blob: Record<string, unknown> }>(o));

    // --- record(value) — one-arg, zod-style ---
    const s4 = Validator.schema({ counts: rule().record(rule().integer()) });
    s4.parse(undefined).then((o) => expectType<{ counts: Record<string, number> }>(o));

    // --- record(key, value) — two-arg, valibot-style, with `as const` enum keys ---
    const Theme = { Light: "light", Dark: "dark" } as const;
    const s5 = Validator.schema({
      themes: rule().record(rule().enum(Theme), rule().string()),
    });
    s5.parse(undefined).then((o) =>
      expectType<{ themes: Record<"light" | "dark", string> }>(o)
    );

    // --- nested object inside object — typed all the way down ---
    const s6 = Validator.schema({
      order: rule().object({
        id: rule().integer(),
        customer: rule().object({
          name: rule().string(),
          email: rule().string(),
        }),
      }),
    });
    s6.parse(undefined).then((o) =>
      expectType<{
        order: { id: number; customer: { name: string; email: string } };
      }>(o)
    );

    // --- record of objects ---
    const s7 = Validator.schema({
      shippers: rule().record(
        rule().object({ name: rule().string(), eta: rule().integer() }),
      ),
    });
    s7.parse(undefined).then((o) =>
      expectType<{ shippers: Record<string, { name: string; eta: number }> }>(o)
    );

    // --- reliable negatives: typed output rejects wrong shapes ---

    s2.parse(undefined).then((o) => {
      // @ts-expect-error meta.name is string, not number
      const bad: number = o.meta.name;
      void bad;
    });

    s4.parse(undefined).then((o) => {
      // @ts-expect-error counts values are number, not string
      const bad: string = o.counts["a"];
      void bad;
    });

    s5.parse(undefined).then((o) => {
      // @ts-expect-error theme keys constrained to "light" | "dark"
      const bad: string = o.themes["neon"];
      void bad;
    });

    // ── Primitive type rules narrow correctly ─────────────────
    const sPrim = Validator.schema({
      name: rule().required().string(),
      age: rule().required().integer(),
      score: rule().required().number(),
      active: rule().required().boolean(),
      tags: rule().required().array(),
      due: rule().required().date(),
    });
    sPrim.parse(undefined).then((o) =>
      expectType<{
        name: string;
        age: number;
        score: number;
        active: boolean;
        tags: unknown[];
        due: Date;
      }>(o),
    );

    // ── Presence: required → required key; sometimes → optional ──
    const sPres = Validator.schema({
      must: rule().required().string(),
      maybe: rule().sometimes().string(),
    });
    sPres.parse(undefined).then((o) => {
      // required: not optional
      expectType<string>(o.must);
      // sometimes: optional
      expectType<string | undefined>(o.maybe);
    });

    // ── nullable() unions null into value type ────────────────
    const sNull = Validator.schema({
      bio: rule().nullable().string(),
    });
    sNull.parse(undefined).then((o) => expectType<string | null>(o.bio));

    // ── default() removes optionality ─────────────────────────
    const sDef = Validator.schema({
      role: rule().sometimes().string().default("member"),
    });
    sDef.parse(undefined).then((o) => expectType<string>(o.role));

    // ── in([...] as const) narrows to literal union ───────────
    const sIn = Validator.schema({
      role: rule().required().in(["admin", "member", "guest"] as const),
    });
    sIn.parse(undefined).then((o) =>
      expectType<"admin" | "member" | "guest">(o.role),
    );

    // ── Validator.make(...).validate() returns the same shape ─
    const v = Validator.make(
      {},
      {
        email: rule().required().string().email(),
        age: rule().required().integer().min(18),
      },
    );
    v.validate().then((o) =>
      expectType<{ email: string; age: number }>(o),
    );

    // ── Negatives ────────────────────────────────────────────
    sIn.parse(undefined).then((o) => {
      // @ts-expect-error role narrowed to literal union; "owner" not in it
      const bad: "owner" = o.role;
      void bad;
    });

    sPres.parse(undefined).then((o) => {
      // @ts-expect-error must is string, not number
      const bad: number = o.must;
      void bad;
    });

    sDef.parse(undefined).then((o) => {
      // @ts-expect-error default() removed undefined — assigning undefined fails
      const bad: undefined = o.role;
      void bad;
    });

    v.validate().then((o) => {
      // @ts-expect-error schema has no "name" key
      void o.name;
    });
  }
}

test("validation type assertions compile", () => {
  void _typeAssertions;
  expect(true).toBe(true);
});
