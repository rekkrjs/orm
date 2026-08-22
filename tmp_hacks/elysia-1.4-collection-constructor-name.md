# `Collection` reports `Array` as its constructor name

- Status: active
- Last reviewed: 2026-08-21
- Verified with: `elysia@1.4.29` (observed in `prueba`), `bun@1.4.0`

Upstream: [elysiajs/elysia#1842](https://github.com/elysiajs/elysia/issues/1842)

Counterpart record: `prueba/tmp_hacks/elysia-1.4-array-subclass-response-headers.md`,
which documents the same upstream bug worked around on the consuming side.

## Observed behavior

`Collection` extends `Array`. Every identity check the language offers agrees
with that — `Array.isArray()`, `instanceof Array` and
`Object.prototype.toString.call()` all report an array. The single exception was
`constructor.name`, which read `"Collection"`.

Consumers that dispatch on `constructor.name` take that disagreement at face
value. Elysia 1.4's Bun and web-standard adapters check
`constructor.name === "Array"` to pick the fast serialization path; anything else
falls through to an `Array.isArray(response)` branch that calls
`Response.json(response)` **without passing `set`**. The accumulated response
headers, status and cookies are discarded there. A controller returning a
Collection answered 200 with no security headers and no `Set-Cookie`, and
nothing was logged.

This is a workaround for an upstream bug, but the change stands on its own
terms: a `Collection` genuinely is an array, and `constructor.name` was the only
place the library claimed otherwise.

## Workaround

`src/support/Collection.ts`, immediately after the class body:

```ts
Object.defineProperty(Collection, "name", { value: "Array" });
```

A class's `name` is `{ writable: false, enumerable: false, configurable: true }`,
so `defineProperty` with only `value` succeeds and leaves the rest of the
descriptor intact.

What this does **not** change, all verified:

- `instanceof Collection` and `instanceof Array` still hold.
- `Symbol.species` is untouched, so `map` / `filter` / `slice` keep returning a
  `Collection` rather than a plain `Array`.
- A future `class X extends Collection {}` keeps its own name: `name` is an own
  property of the constructor function, not inherited.

Audited before applying: nothing in this repo dispatches on `Collection`'s
constructor name. The `constructor.name` reads in `src/` are all about models —
`typegen/discoverModelTables.ts:41` (base-class detection),
`model/ModelRelations.ts:247` and `query/Builder.ts:2466` (morph types), plus
three error messages. There are no subclasses of `Collection`; the
`extends Collection` matches in a naive grep are TypeScript conditional types
(`T[K] extends Collection<any>`), not class declarations.

The cost is debuggability: a `Collection` now identifies as `Array` in
`console.log`, inspectors and test failure output.

Pinned by `tests/collection.test.ts` → "reports itself as an Array so consumers
dispatching on constructor.name agree", so the line cannot be tidied away
without a red test.

## Removal check

After an Elysia release closes the upstream issue, delete the `defineProperty`
line and the test that pins it, then confirm in a consuming app that a
controller returning an ORM collection still emits the request ID, every global
security header, the response status and cookies. If it does, remove the
workaround and this record together.

Note the consuming side has its own workaround for the same bug: `prueba`
converts collections with `Array.from(collection, serializeUser)` before
returning them. That conversion is redundant once this change ships and can be
removed first, as an independent way to confirm the fix here works — `prueba`
pins the ORM by git ref (`github:rekkrjs/orm#v0.9.0`), so it needs that ref
bumped to pick this up.

Verify with:

```bash
bun run build
bun test tests/collection.test.ts
bunx tsc --noEmit
bun run test
```
