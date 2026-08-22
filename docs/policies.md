# Policies

Policies provide model/resource authorization checks similar to Laravel Gate/Policy style.

## Registering Policies

Register once at server startup:

```ts
import { registerPolicy } from "@rekkr/orm/policies";
import User from "$models/user";

class UserPolicy {
  create(user: User, model: typeof User) {
    return true;
  }

  update(user: User, model: User) {
    return user.id === model.id;
  }

  delete(user: User, model: User) {
    return false;
  }

  view(user: User, model: User) {
    return true;
  }

  viewAny(user: User, model: typeof User) {
    return true;
  }
}

registerPolicy(User, UserPolicy);
```

Batch registration:

```ts
import { registerPolicies } from "@rekkr/orm/policies";

registerPolicies({
  User: UserPolicy,
  Announcement: AnnouncementPolicy,
});
```

## Decisions

Policy methods may return:

- `true` or `false`
- a deny message string
- `{ allow: boolean, message?: string }`

## Using Policies Directly

```ts
import { can, authorize } from "@rekkr/orm/policies";

const allowed = await can(user, "update", announcement);
await authorize(user, "update", announcement); // throws on deny
```

`authorize(...)` throws `PolicyAuthorizationError` with status `403`.

## Route-level Actor Extension

`route().can(...)` uses a locally-extended actor internally for policy checks and does not mutate `event.locals.user`.

## RouteBuilder Integration

Use `.can(...)` after binding:

```ts
import type { PageServerLoad } from "./$types";
import { route } from "@rekkr/orm/sveltekit";
import Announcement from "$models/announcement";

export const load: PageServerLoad = route()
  .bind(Announcement)
  .can("update") // checks policy.update(event.locals.user, announcement)
  .load(async (_event, { announcement }) => ({ announcement }));
```

Target a specific alias:

```ts
route()
  .bind(Announcement, "id", "announcement")
  .can("update", "announcement");
```

## Non-model / Module Access

You can authorize module-style resources (navigation, feature gates) with simple resource classes:

```ts
class BillingModule {}

class ModulePolicy {
  access(user: User, _module: BillingModule) {
    return user.permissions.includes("billing.access");
  }
}

registerPolicy(BillingModule, ModulePolicy);

await event.locals.user.authorize("access", new BillingModule());
```

## CLI Generator

Create policy files:

```sh
orm make:policy UserPolicy
orm make:policy UserPolicy --model=User
orm make:policy UserPolicy --dir=./app/policies
```

Default output directory:

1. `--dir`
2. `policyPath` from `orm.config.ts`
3. `./app/policies`
