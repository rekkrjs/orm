# Installation

ORM is a **Bun-only package**. It links directly against `bun:sql`, so it cannot run under Node.js, npm, yarn, or pnpm.

## Requirements

- [Bun](https://bun.com) `1.4.0` or newer (declared in `engines.bun`).
- A supported database driver — SQLite (bundled with Bun), PostgreSQL, or MySQL.

Verify your Bun version:

```bash
bun --version
```

## Add the package

```bash
bun add @rekkr/orm
```

That is the entire install step. The package ships with **zero runtime dependencies** — no `pg`, no `mysql2`, no driver layer to wire up. Connections go through `bun:sql`, which Bun provides natively.

### From git

A branch, tag, or commit works the same way — no build step, no `trustedDependencies` entry:

```bash
bun add github:rekkrjs/orm                # default branch
bun add github:rekkrjs/orm#<tag>          # a published tag, e.g. v0.4.0
bun add github:rekkrjs/orm#<commit-sha>   # a specific commit
```

The package resolves through the `bun` export condition straight to its TypeScript
source, which Bun transpiles on import. Nothing depends on `dist/` being built, so
forks are installable directly from their repository.

One caveat: bundlers don't know the `bun` condition, so if Vite resolves the
package (SvelteKit included) rather than Bun itself, point its **server** graph
at the same condition — otherwise it looks for the `dist/` build a git install
doesn't carry:

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

Scope it to `ssr` and nothing else. `resolve.conditions` at the top level is
[shared by the client build and dev](https://vite.dev/config/shared-options.html#resolve-conditions),
which would pull the ORM's source into a browser bundle, where its `import "bun"`
cannot resolve.

That is a boundary worth stating plainly: **ORM is server-only.** It links
against `bun:sql`, so it must be imported from server modules exclusively — in
SvelteKit that means `+page.server.ts`, `+server.ts`, `hooks.server.ts`, or a
`$lib/server/` module. Importing it from client code fails the build, by design.

Installs from npm ship `dist/`, so they need none of this.

## TypeScript

If your project uses TypeScript, no extra `@types/*` packages are needed — types resolve from the ORM's own source, so they match the code you are running whether you installed from npm or from git. Make sure your `tsconfig.json` includes the standard library settings Bun expects:

```jsonc
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "types": ["bun-types"]
  }
}
```

`bun-types` is included in any `bun init` scaffold.

## The CLI

Installing the package also exposes the `orm` CLI for migrations, seeders, and the REPL:

```bash
bunx orm --help
bunx orm migrate
bunx orm repl
```

If you want a shorter invocation, add a script alias to `package.json`:

```jsonc
{
  "scripts": {
    "orm": "orm"
  }
}
```

Then `bun run orm migrate` instead of `bunx orm migrate`.

## Next steps

- [Configuration](./configuration.md) — create `orm.config.ts` and wire up the connection.
- [Quickstart](./quickstart.md) — define your first model and run a query.

## Troubleshooting

**`Cannot find module 'bun:sql'`** — you are running under Node.js. Switch to `bun run …` instead of `node …` or `npm run …`.

**`bun add` cannot resolve the package** — make sure your registry is set correctly. The package is published on the public npm registry; no private auth is required.

**TypeScript complains about `Bun.SQL`** — install or upgrade `bun-types` (`bun add -d bun-types`) and ensure it is listed in `compilerOptions.types`.
