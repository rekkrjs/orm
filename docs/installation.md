# Installation

ORM runs on **Bun** and on **Node.js**, with the same API, the same CLI, and the
same results from the database. On Bun it talks to Bun's native `bun:sql` and
Redis clients and needs no dependencies at all. On Node.js it uses the built-in
`node:sqlite`, plus one driver package for each server database you use.

## Requirements

| Runtime | Version | Declared in |
|---|---|---|
| [Bun](https://bun.com) | `1.4.1` or newer | `engines.bun` |
| [Node.js](https://nodejs.org) | `24.15.0` or newer | `engines.node` |

Node.js 24.15 is the first release whose `node:sqlite` no longer prints an
experimental warning; earlier 24.x releases work but write that warning to
stderr, which breaks the CLI's `--json` output.

## Drivers

| Database | Bun | Node.js |
|---|---|---|
| SQLite | built in (`bun:sql`) | built in (`node:sqlite`) |
| PostgreSQL | built in (`bun:sql`) | [`pg`](https://www.npmjs.com/package/pg) |
| MySQL | built in (`bun:sql`) | [`mysql2`](https://www.npmjs.com/package/mysql2) |
| Redis (cache, queue) | built in (`RedisClient`) | [`ioredis`](https://www.npmjs.com/package/ioredis) |

The Node.js drivers are optional peer dependencies: install the ones your
configuration uses, next to `@rekkr/orm`. The runtime is detected on its own —
there is nothing to configure. A connection that needs a driver you have not
installed says so:

```text
PostgreSQL on Node.js needs the "pg" package. Install it next to @rekkr/orm: npm install pg
```

## Add the package

Rekkr ORM is distributed from its public GitHub repository. The package name and
every application import remain `@rekkr/orm`; the Git URL only tells the package
manager where to install it from. Do not install `@rekkr/orm` from the npm
registry yet: the registry package is not a release from this repository.

### Bun

```bash
bun add github:rekkrjs/orm#v4.1.0
```

Bun runs the package's TypeScript source through the `bun` export condition, so
nothing needs building. Bun reports a blocked `prepare` script for the package;
leave it blocked, it builds the Node.js output only.

A branch, tag, or commit works the same way:

```bash
bun add github:rekkrjs/orm                # default branch
bun add github:rekkrjs/orm#<tag>          # e.g. v4.1.0
bun add github:rekkrjs/orm#<commit-sha>   # exact commit
```

### Node.js

Node.js support starts with `v5.0.0`.

```bash
npm install --allow-git=all github:rekkrjs/orm#v5.0.0
npm install pg        # PostgreSQL
npm install mysql2    # MySQL
npm install ioredis   # Redis cache or queue
```

Node.js runs the compiled `dist/` output, which a Git checkout does not carry: the
package's `prepare` script builds it while the package manager installs it.
npm 12 fetches Git dependencies only with `--allow-git`; earlier versions ignore
the flag. pnpm refuses to run a dependency's build until you allow it: add the
`allowBuilds` entry it prints to `pnpm-workspace.yaml` and install again.

```bash
pnpm add github:rekkrjs/orm#v5.0.0
```

## TypeScript

The package ships its declarations; no `@types/*` package is needed for the ORM
itself.

- **Bun** — keep `bun-types` in `compilerOptions.types`, as any `bun init`
  scaffold does. A Git install has no `dist/`, so the types resolve to the
  TypeScript source, which matches the code Bun runs.
- **Node.js** — `@types/node` is enough; the ORM's declarations never reference
  Bun. They are the published `.d.ts` files, so your compiler flags
  (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, …) apply to your code
  and not to the ORM's implementation.

```jsonc
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "types": ["bun-types"]        // or ["node"] on Node.js
  }
}
```

### Models and migrations on Node.js

Node.js runs `.ts` files by stripping the types, without transpiling them. The
migrations, seeders, models, commands and jobs the CLI loads must therefore stay
within what stripping supports: no `enum`, no `namespace`, no constructor
parameter properties, no decorators. The ORM needs none of them — `backedEnum()`
is a value, not a TypeScript `enum`, and observers are registered without
decorators. When a file cannot be stripped, the CLI names the file and the
reason instead of a bare syntax error.

## The CLI

Installing the package exposes the `orm` command:

```bash
bunx orm migrate    # Bun
npx orm migrate     # Node.js
```

`orm` runs on the runtime that launched it: Node.js under `npx`, `npm run`,
`pnpm` and `yarn`; Bun under `bunx` and `bun run`. Invoked directly, it prefers
Bun when Bun is installed. To choose explicitly, run the entry point with either
runtime:

```bash
node node_modules/@rekkr/orm/bin/orm.mjs migrate
bun  node_modules/@rekkr/orm/bin/orm.mjs migrate
```

Bun loads `.env` files by itself. On Node.js the CLI loads them the same way —
`.env.local`, then `.env.<NODE_ENV>`, then `.env` (no `.env.local` when
`NODE_ENV=test`), with `$NAME` and `${NAME}` expanded — and a variable already set
in the environment always wins. Your own application on Node.js loads its
environment itself, for instance with `node --env-file=.env`, which does not
expand references.

A script alias shortens the invocation:

```jsonc
{
  "scripts": {
    "orm": "orm"
  }
}
```

## What differs between runtimes

The test suite runs on both runtimes against the same SQLite, PostgreSQL, MySQL
and Redis servers, and holds them to the same values: the same JavaScript type
for every column type, dates stored as UTC whatever the process time zone, the
same write counts and error codes. What remains different:

- **SQLite on Node.js is synchronous.** `node:sqlite` runs each statement on the
  calling thread, so a long query blocks the event loop while it runs. That is
  the usual trade-off for SQLite in Node.js and fine for development, tests and
  small applications.
- **SQLite integers past 2^53.** Bun rounds them to the nearest JavaScript
  number. Node.js returns them exact: as a string, or as a `bigint` with
  `bigint: true`, the convention MySQL's `BIGINT` already follows.
- **`prepare` has no effect on Node.js.** `pg` sends unnamed statements, and
  `mysql2` prepares every statement that carries bindings.
- **TLS in URLs.** `sslmode` on a PostgreSQL URL keeps libpq's meaning on both
  runtimes: `require` encrypts without verifying the certificate, `verify-full`
  verifies it. On a MySQL URL, `ssl-mode=REQUIRED` (or `require`) encrypts
  without verifying, and `VERIFY_CA` or `VERIFY_IDENTITY` verifies. Node.js has
  no fallback for `PREFERRED`: it connects without TLS.
- **The REPL.** `orm repl` on Node.js runs `node:repl` in the CLI's own process;
  on Bun it runs `bun repl`.

The two workarounds in `.tmp_hacks/` for `bun:sql` (the MySQL event loop and the
write count split) concern Bun only.

## Server only

ORM is server-only. Import it from server modules exclusively — in SvelteKit
that means `+page.server.ts`, `+server.ts`, `hooks.server.ts`, or a
`$lib/server/` module. Importing it from client code fails the build, by design.

On Bun, a Git install has no `dist/` build, so if Vite resolves the package
(SvelteKit included) rather than Bun itself, point its **server** graph at the
`bun` condition:

```js
// vite.config.js
import { defaultServerConditions } from "vite";

export default {
  ssr: {
    resolve: {
      conditions: ["bun", ...defaultServerConditions],
      externalConditions: ["bun", "node", "module-sync"],
    },
  },
};
```

Keep Vite's defaults in both lists: setting either option replaces its defaults,
and other server dependencies still need their normal Node/module conditions.
Scope it to `ssr` and nothing else: `resolve.conditions` at the top level is
[shared by the client build and dev](https://vite.dev/config/shared-options.html#resolve-conditions),
which would pull the ORM's source into a browser bundle. On Node.js none of this
is needed; Vite resolves the built `dist/`.

## Next steps

- [Configuration](./configuration.md) — create `orm.config.ts` and wire up the connection.
- [Quickstart](./quickstart.md) — define your first model and run a query.

## Troubleshooting

**`… on Node.js needs the "pg" package`** (or `mysql2`, `ioredis`) — install the
driver named in the message next to `@rekkr/orm`.

**`… could not be loaded. Node.js runs TypeScript by stripping the types`** —
the named file uses an `enum`, a `namespace`, a parameter property or a
decorator. Rewrite that construct, or run the CLI with Bun.

**`Fetching packages of type "git" have been disabled`** — npm 12 needs
`--allow-git=all` to install from GitHub.

**`Cannot find module …/dist/src/index.js`** on Node.js — the package was
installed without running its build. Allow the build (see
[Node.js](#nodejs) above) and install again.

**The package manager cannot resolve the package** — verify that the public
GitHub repository and tag are reachable:

```bash
git ls-remote https://github.com/rekkrjs/orm.git refs/tags/v4.1.0
```
