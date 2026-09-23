#!/bin/sh
':' //; case "$npm_config_user_agent" in npm/*|pnpm/*|yarn/*) exec node "$0" "$@";; esac; command -v bun >/dev/null 2>&1 && exec bun "$0" "$@"; exec node "$0" "$@"

// One `orm` command for both runtimes. The line above is shell and JavaScript
// at once: as a shell script it picks the runtime — Node.js when npm, pnpm or
// yarn launched it, otherwise Bun if it is installed — and runs this file again
// there, where the line is a no-op. `node` or `bun` on this file picks directly.
await import(typeof Bun !== "undefined" ? "./orm.ts" : "../dist/bin/orm.js");
