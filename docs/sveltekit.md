# SvelteKit Helper

Use the SvelteKit helper to bind route params to ORM models and (for actions) validate incoming form/request data.

> **Server-only.** ORM links against `bun:sql`, so every import of it — this
> helper included — belongs in a server module: `+page.server.ts`, `+server.ts`,
> `hooks.server.ts`, or `$lib/server/`. Importing it from client code fails the
> build. If you install from git, see the Vite note in
> [Installation](./installation.md).

Import:

```ts
import { configureSvelteKit, route } from "@rekkr/orm/sveltekit";
```

## One-time setup (recommended)

When using linked/local packages, configure SvelteKit helpers once so `route()` uses your app's `error`/`fail` functions automatically.

```ts
// src/hooks.server.ts
import { error, fail } from "@sveltejs/kit";
import { configureSvelteKit, extendLocalsUser } from "@rekkr/orm/sveltekit";

configureSvelteKit({ error, fail });
```

After this, you can use plain `route()` everywhere.

If you assign `event.locals.user` in hooks, extend it immediately so policy helpers are always available:

```ts
// src/hooks.server.ts
import type { Handle } from "@sveltejs/kit";
import { extendLocalsUser } from "@rekkr/orm/sveltekit";

export const handle: Handle = async ({ event, resolve }) => {
  // your auth logic:
  // event.locals.user = sessionUser;
  extendLocalsUser(event);
  return resolve(event);
};
```

## `load` example (`+page.server.ts`)

`load` uses model binding from `event.params`. It does not run schema validation.

```ts
import type { PageServerLoad } from "./$types";
import { route } from "@rekkr/orm/sveltekit";
import Branch from "$lib/server/models/Branch";
import Payroll from "$lib/server/models/Payroll";

export const load: PageServerLoad = route()
  .bind(Branch) // binds params.id -> context.branch
  .bind(Payroll, "payroll_id") // binds params.payroll_id -> context.payroll
  .bind(Branch, "source_branch_id", "sourceBranch") // same model, custom alias
  .load(async (event, { branch, payroll, sourceBranch, data }) => {
    // event is ServerLoadEvent
    // data is always undefined in load()
    return {
      branch,
      payroll,
      sourceBranch,
    };
  });
```

## `actions` example (`+page.server.ts`)

`action` uses model binding from `event.params` and schema validation from `event.request`.
When validation fails, it returns:

```ts
fail(422, { issues, values });
```

`issues` is normalized to a flat bag shape:

```ts
{
  title: ["The title field is required."],
  email: ["The email field must be a valid email address."]
}
```

```ts
import type { Actions } from "./$types";
import { route } from "@rekkr/orm/sveltekit";
import { Validator, rule } from "@rekkr/orm/validation";
import Branch from "$lib/server/models/Branch";

const PostSchema = Validator.schema({
  title: rule().required().string(),
});

export const actions: Actions = {
  create: route()
    .bind(Branch)
    .schema(PostSchema)
    .action(async (event, { branch, data, flash }) => {
      // event is RequestEvent
      // data is typed from PostSchema => { title: string }
      await branch.update({ last_post_title: data.title });
      flash("Successfully updated");
      return { ok: true };
    }),
};
```

Inside `.action()` (and `.handle()`), context includes `flash(...)`:

```ts
flash("Successfully updated");
flash({ type: "error", message: "Failed to update" });
```

## `request` example (`+server.ts`)

Use `.request()` for `RequestHandler` routes in `+server.ts`.

```ts
import type { RequestHandler } from "./$types";
import { route } from "@rekkr/orm/sveltekit";
import { Validator, rule } from "@rekkr/orm/validation";
import Branch from "$lib/server/models/Branch";

const BodySchema = Validator.schema({
  title: rule().required().string(),
});

export const POST: RequestHandler = route()
  .bind(Branch)
  .schema(BodySchema)
  .request(async (_event, { branch, data, flash }) => {
    flash("Saved");
    return new Response(JSON.stringify({ id: branch.id, title: data.title }), {
      headers: { "content-type": "application/json" },
    });
  });
```

When validation fails in `.request()`, it returns HTTP `422` JSON:

```ts
{
  issues: { field: ["..."] },
  values: { ...inputValues }
}
```

To use RFC7807/problem details:

```ts
export const POST: RequestHandler = route()
  .schema(BodySchema)
  .request(async () => new Response("ok"), {
    validationError: "problem+json",
  });
```

You can also customize validation error responses:

```ts
export const POST: RequestHandler = route()
  .schema(BodySchema)
  .request(async () => new Response("ok"), {
    validationError: ({ issues, values }) =>
      new Response(JSON.stringify({ ok: false, issues, values }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
  });
```

## Flash in `load`

`route().load(...)` automatically reads flash from cookie, deletes it, and injects it into context as `flash`.

```ts
export const load: PageServerLoad = route().load(async (_event, { flash }) => {
  return { flash };
});
```

`flash` shape:

```ts
type FlashMessage =
  | string
  | {
      type: "success" | "error" | "info" | "warning";
      message: string;
    };

type Flash = FlashMessage | FlashMessage[] | null;
```

## Flash Helper (without `route()`)

You can use the same flash behavior directly:

```ts
import { flash } from "@rekkr/orm/sveltekit";

// set
flash(event, "Successfully saved.");
flash(event, { type: "success", message: "Successfully saved." });

// consume (reads + clears)
const message = flash(event);
```

Expected output when reading:

```ts
flash(event); // null
flash(event); // "Successfully saved."
flash(event); // { type: "success", message: "Successfully saved." }
flash(event); // ["Saved", { type: "error", message: "Failed" }]
```

## Binding API

- `.bind(Model)` => binds from `params.id`, alias defaults to model name (e.g. `AcademicYear` -> `academicYear`)
- `.bind(Model, "param_name")` => binds from a custom route param
- `.bind(Model, "param_name", "alias")` => custom alias (useful when binding the same model twice)
- `.bind(async (event) => recordOrNull, "alias")` => custom resolver bind for full query control

If a param is missing or no record is found, the helper throws a SvelteKit 404 error.

## Policies (`.can(...)`)

Register a model policy once, then enforce abilities in the route builder.

```ts
import { registerPolicy } from "@rekkr/orm/policies";
import Announcement from "$lib/server/models/Announcement";

class AnnouncementPolicy {
  update(user: User, model: Announcement) {
    return user.id === model.user_id;
  }
}

registerPolicy(Announcement, AnnouncementPolicy);
```

Use it in routes:

```ts
export const load: PageServerLoad = route()
  .bind(Announcement)
  .can("update") // checks policy.update(locals.user, announcement)
  .load(async (_event, { announcement }) => ({ announcement }));
```

`route().can(...)` uses an internal extended actor for policy checks and does not mutate `event.locals.user`.

You can target a specific alias when multiple records are bound:

```ts
route().bind(Announcement, "id", "announcement").can("update", "announcement");
```

Resolver bind example:

```ts
export const load: PageServerLoad = route()
  .bind(async (event) => {
    return await Announcement.query()
      .where("id", event.params.id)
      .where("status", "active")
      .with("targets")
      .first();
  }, "announcement")
  .load(async (_event, { announcement }) => {
    return { announcement };
  });
```

If the resolver returns `null`/`undefined`, a 404 is thrown automatically.
