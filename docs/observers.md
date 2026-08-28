# Observers

Observers let you hook into a model's lifecycle without scattering side-effects through your CRUD code. Use them for things like:

- Sending a "welcome" email on user creation.
- Writing an audit log entry when an order changes state.
- Maintaining derived columns (`updated_at` on a parent, `last_post_at` on an author).
- Invalidating an external cache when a record is deleted.

Instance writes (`user.save()`, `user.delete()`, `User.create(...)`) run the full
observer lifecycle. Model-backed builder `update()` and `delete()` dispatch only
their after-hooks; builder `insert()` and `upsert()` skip observers.

Inside a shared observer, `model.isInstanceOf(User)` is the easiest way to branch on the concrete model class.
For IntelliSense to narrow correctly, type the hook parameter as `Model` or a union of model types, not `any`:

```ts
import { Model, Observer } from "@rekkr/orm";
import User from "./models/User";
import Order from "./models/Order";

class AuditObserver extends Observer<Model> {
  created(model: Model) {
    if (model.isInstanceOf(User)) {
      model.getAttribute("email");
    }

    if (model.isInstanceOf(Order)) {
      model.getAttribute("total");
    }
  }
}
```

To register the same observer for multiple models in one call, pass an array:

```ts
AuditObserver.observe([User, Order]);
```

To remove those registrations later, call:

```ts
AuditObserver.unobserve([User, Order]);
```

## Registering

For larger observers, extend `Observer<Model>` and call `YourObserver.observe(ModelClass)` once at app startup — typically right after `configureOrm()`:

```ts
import { Observer } from "@rekkr/orm";
import Admission from "./models/Admission";
import { AdmissionStatusEnum } from "./enums";

export class AdmissionObserver extends Observer<Admission> {
  async created(model: Admission) {
    if (model.status === AdmissionStatusEnum.SUBMITTED) {
      // send a notification, write an audit log, etc.
    }
  }

  updated(model: Admission) {
    if (model.wasChanged("status")) {
      // react to status changes
    }
  }
}

AdmissionObserver.observe(Admission);
```

The `Observer<Admission>` generic makes the generated hook signatures show `model: Admission` in IntelliSense. TypeScript does not infer unannotated parameters for class method overrides, so write `model: Admission` on method parameters when `strict` mode is enabled.

For small inline observers, `ObserverRegistry.register(ModelClass, observer)` attaches one or more handlers to a model:

```ts
import { ObserverRegistry } from "@rekkr/orm";
import User from "./models/User";
import { sendWelcomeEmail, recordSignup } from "./services/users";

ObserverRegistry.register(User, {
  async created(user) {
    await sendWelcomeEmail(user.email);
    await recordSignup(user.id);
  },
  async deleting(user) {
    if (user.is_admin) {
      throw new Error("Cannot delete admin users");
    }
  },
});
```

Multiple observers can be registered for the same model — they run in registration order.

```ts
ObserverRegistry.register(User, auditObserver);
ObserverRegistry.register(User, cacheObserver);
ObserverRegistry.register(User, notificationObserver);
```

You can mix class observers and registry observers for the same model:

```ts
UserObserver.observe(User);
ObserverRegistry.register(User, auditObserver);
```

Remove all observers for a model with `ObserverRegistry.unregister(User)` — useful in tests.

## Lifecycle events

Every hook is optional. Each receives the model instance.

| Event | Fires |
|---|---|
| `creating` | Before a new row is inserted. Throw to abort the insert. |
| `created` | After a new row is inserted and the primary key is populated. |
| `updating` | Before an existing row is updated. Throw to abort. |
| `updated` | After an existing row is updated. |
| `saving` | Before both create and update — runs in addition to `creating` / `updating`. |
| `saved` | After both create and update. |
| `deleting` | Before a row is deleted (or soft-deleted). Throw to abort. |
| `deleted` | After a row is deleted (or soft-deleted). |
| `restoring` | Before a soft-deleted row is restored. |
| `restored` | After a soft-deleted row is restored. |

Order of firing on `save()` of a new instance: `saving` → `creating` → INSERT → `created` → `saved`.

On `save()` of an existing instance: `saving` → `updating` → UPDATE → `updated` → `saved`.

Changes made by `saving` or `updating` are included in that UPDATE. Changes
made by `updated` or `saved` happen after SQL completes, so they remain dirty
until another `save()` (including a nested save from the observer) persists them.

On `delete()`: `deleting` → DELETE → `deleted`. For soft deletes, the row is updated rather than removed; `deleting` and `deleted` still fire.

On `restore()` (soft deletes only): `restoring` → UPDATE → `restored`.

## Patterns

### Block a save with `throw`

`creating`, `updating`, `saving`, and `deleting` can prevent the operation by throwing. The error propagates out of the `save()` / `delete()` call and the database is untouched:

```ts
ObserverRegistry.register(Order, {
  updating(order) {
    if (order.getOriginal("status") === "paid" && order.status === "draft") {
      throw new Error("Cannot reset a paid order to draft");
    }
  },
});
```

### Mutate the model before save

Set or normalize attributes inside `saving` / `creating` / `updating`. The change is included in the SQL that runs:

```ts
ObserverRegistry.register(Post, {
  saving(post) {
    if (!post.slug) {
      post.slug = post.title.toLowerCase().replace(/\s+/g, "-");
    }
  },
});
```

### Inspect what changed

`getDirty()` returns the in-memory pending changes; `wasChanged(key?)` reports what changed after the save completes:

```ts
ObserverRegistry.register(User, {
  updating(user) {
    if ("email" in user.getDirty()) {
      // queue a verification email for the new address
    }
  },
  updated(user) {
    if (user.wasChanged("plan")) {
      // emit a billing webhook
    }
  },
});
```

## Bypassing observers

Sometimes you need to write without firing events — bulk imports, data migrations, periodic cleanup.

```ts
// One-shot: instance method
await user.saveQuietly();
await user.deleteQuietly();

// Per call: explicit option
await model.save({ events: false });

// Bulk methods
await User.insert(records, { events: false });
await User.createMany(records, { events: false });
await User.saveMany(models, { events: false });

// Factory graph: models and relationships are still hydrated
await User.factory().has(Post.factory(), "posts").createQuietly();

// Low-level builder inserts and upserts skip observers
await User.query().insert(records);
await User.query().upsert(records, "id");
```

For a complete seeder tree, set `static withoutModelEvents = true` on its root `Seeder`; the setting propagates through `this.call()`. See [Seeders and Factories](./seeders.md#writing-a-seeder).

Builder `update()` and `delete()` dispatch their after-hooks when observers are registered, but skip per-instance before-hooks. For full lifecycle control, work through model instances.

## Testing observers

In test setup, register the observers you want to exercise and unregister them in teardown:

```ts
import { beforeEach, afterEach } from "bun:test";
import { ObserverRegistry } from "@rekkr/orm";
import User from "../src/models/User";
import { UserObserver } from "../src/observers/UserObserver";

beforeEach(() => {
  UserObserver.observe(User);
});

afterEach(() => {
  ObserverRegistry.unregister(User);
});
```

Avoid sharing observer state between tests — each registration is global until removed.

## Common pitfalls

- **Builder writes skip before-hooks.** `Model.where(...).update(...)` dispatches `updated`/`saved` and `delete()` dispatches `deleted`, but neither runs the corresponding before-hooks. Builder `insert()` and `upsert()` bypass the registry entirely. Fetch instances and call `.save()` / `.delete()` when the full lifecycle matters.
- **`saving` runs before `creating`/`updating`.** If both hooks set the same attribute, `creating`/`updating` wins because it runs later.
- **`created` runs after the insert.** The primary key is set by then, but the relation cache is still empty. If you need to immediately load a freshly created relation, do it in `created` (after) — not `creating` (before).
- **Cyclic saves.** Calling `.save()` on another model inside an observer can cascade into more observer fires. Guard with a flag or use [`saveQuietly`](./models.md#quiet-operations-skip-observers) inside the observer.
- **Async work inside observers blocks the calling code.** If you need fire-and-forget behavior, push the work to a queue rather than awaiting it inline.

## Where to next

- [Models — quiet operations](./models.md#quiet-operations-skip-observers) — `saveQuietly` / `deleteQuietly` and `{ events: false }` flags.
- [Models — `touches`](./models.md#touches--bump-parent-timestamps) — declarative parent-timestamp updates, simpler than an observer.
- [Transactions](./transactions.md) — wrap multi-model writes so observer-driven side effects don't fire when the parent change rolls back.
