# Commands

Artisan-style CLI commands for application tasks — database maintenance, sending notifications, generating reports, or anything you'd otherwise run as a one-off script.

Commands are registered from `commandsPath` and run with `orm run <name>`.

## Configuration

```ts
// orm.config.ts
export default {
  connection: { url: process.env.DATABASE_URL },
  commands: {
    commandsPath: "./app/commands",
  },
};
```

## Defining a Command

Two styles are supported — pick whichever you prefer.

### Class-based

```ts
// app/commands/ReportOverdueCommand.ts
import { Command } from "@rekkr/orm/commands";
import { TenantContext } from "@rekkr/orm";
import Invoice from "../models/Invoice";

export default class ReportOverdueCommand extends Command.define(
  "report:overdue {tenant} {--limit=25}"
) {
  static description = "List overdue invoices for a tenant.";

  async handle(): Promise<void> {
    const tenant = this.argument("tenant");   // ✅ autocompletes "tenant"
    const limit  = Number(this.option("limit")); // ✅ autocompletes "limit"

    await TenantContext.run(tenant, async () => {
      const invoices = await Invoice.where("status", "overdue")
        .orderBy("due_date", "asc")
        .limit(limit)
        .with("customer")
        .get();

      if (invoices.isEmpty()) {
        this.info("No overdue invoices.");
        return;
      }

      this.warn(`${invoices.length} overdue invoice(s) in ${tenant}:`);
      this.line(invoices.json("id", "reference", "due_date", "amount", "customer.name"));
    });
  }
}
```

Run it:

```sh
orm run report:overdue acme
orm run report:overdue acme --limit=10
```

### Function-based

```ts
// app/commands/send-welcome-email.ts
import { defineCommand } from "@rekkr/orm/commands";

export default defineCommand({
  signature: "email:send {user} {--queue=default} {--force}",
  description: "Send a welcome email to a user.",

  async handle({ argument, option, info, warn }) {
    const user = argument("user");     // ✅ autocompletes
    const queue = option("queue");     // ✅ autocompletes
    const force = option("force");

    info(`Sending welcome email to ${user} via queue: ${queue}`);

    if (force) {
      warn("Force flag set — skipping duplicate check.");
    }
  },
});
```

## Signature DSL

```
command:name {arg} {arg?} {arg*} {arg=default} {--flag} {--option=default} {arg : description}
```

| Token | Meaning |
|-------|---------|
| `{arg}` | Required positional argument |
| `{arg?}` | Optional positional argument |
| `{arg*}` | Variadic — captures all remaining positionals as an array |
| `{arg=default}` | Positional with a default value |
| `{--flag}` | Boolean option — `false` when absent, `true` when present |
| `{--option=}` | String option with no default |
| `{--option=default}` | String option with a default value |
| `{token : description}` | Inline description shown in `--help` output |

## Argument & Option Access

### Class-based

| Method | Returns | Notes |
|--------|---------|-------|
| `this.argument("name")` | `string` | Throws if missing |
| `this.argumentOptional("name")` | `string \| undefined` | Safe access |
| `this.argumentArray("name")` | `string[]` | For variadic args |
| `this.option("name")` | `string \| boolean \| undefined` | Type depends on signature |

### Function-based

The `handle` context object exposes the same methods: `argument`, `argumentOptional`, `argumentArray`, `option`.

## Output Helpers

| Method | Color | Stream |
|--------|-------|--------|
| `info(msg)` | Green | stdout |
| `warn(msg)` | Yellow | stderr |
| `error(msg)` | Red | stderr |
| `line(msg?)` | Plain | stdout |

All helpers accept a string or any object. Objects are pretty-printed as formatted JSON:

```ts
this.info("Done.");
this.info({ count: 3, status: "ok" });
// {
//   "count": 3,
//   "status": "ok"
// }

// Pairs well with collection.json()
this.info(admissions.json("id", "first_name", "last_name"));
```

## Global flags

`--config <path>` may appear before any command and loads that module as the
ORM config instead of `./orm.config.ts`:

```bash
orm --config config/database.ts migrate
```

It is stripped from the arguments before the command parses them, so a command
never has to declare it.

## Running Commands

```sh
orm run email:send alice@example.com
orm run email:send alice@example.com --queue=emails --force
orm run email:send --help    # show usage + options
orm run                      # list all registered commands
```

## Built-in Generators

```sh
orm make:model User
orm make:migration create_users_table
orm make:job SendWelcomeEmail
orm make:policy AnnouncementPolicy
orm make:policy AnnouncementPolicy --model=Announcement
```

`make:policy` writes to `--dir` when provided, otherwise to `policyPath` from `orm.config.ts`, falling back to `./app/policies`.

## Registering Commands Manually

Auto-discovery via `commandsPath` is the default. To register manually (e.g. in app code or tests):

```ts
import { registerCommand } from "@rekkr/orm/commands";
import { SendWelcomeEmailCommand } from "./app/commands/SendWelcomeEmailCommand";

registerCommand(SendWelcomeEmailCommand);
```

## Running Commands Programmatically

```ts
import { CommandRunner, resolveCommand } from "@rekkr/orm/commands";

const entry = resolveCommand("email:send");
if (entry) {
  await new CommandRunner().run(entry, ["alice@example.com", "--force"]);
}
```

## Commands vs Queue Jobs

| | Commands | Queue Jobs |
|---|----------|-----------|
| Triggered by | CLI (`orm run`) or app code | `Queue.dispatch()` / `Job.dispatch()` |
| Execution | Synchronous, foreground | Async, background worker |
| Use case | Admin tasks, maintenance | Background work, retries |
