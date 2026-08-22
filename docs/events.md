# Events

ORM includes a lightweight, process-global event dispatcher for application-level events that are not tied to a single model lifecycle.

Import it from the events subpath:

```ts
import { EventHandler, Events } from "@rekkr/orm/events";
```

Use observers when you want model lifecycle hooks such as `created`, `updated`, or `deleted`. Use events when you want to publish named domain activity and let different parts of your app react without coupling them directly.

## API

| Method | Purpose |
|---|---|
| `Events.listen(EventClass, listener)` | Register a function listener, handler instance, or handler class. Returns an unsubscribe callback. |
| `Events.once(EventClass, listener)` | Register a listener that removes itself before its first invocation. Returns an unsubscribe callback. |
| `Events.dispatch(event)` | Dispatch an event instance and await each listener in registration order. Returns the event instance. |
| `Events.unlisten(EventClass, listener)` | Remove matching listeners by the same function, handler instance, or handler class used at registration. |
| `Events.clear(EventClass?)` | Remove listeners for one event class, or all listeners when no class is passed. |
| `Events.hasListeners(EventClass)` | Check whether an event class has listeners registered. |

## Defining Events

An event can be any class. Put the data listeners need on the event instance.

```ts
export class InvoicePaid {
  constructor(
    public invoiceId: number,
    public customerId: number,
    public amount: number,
  ) {}
}
```

## Function Listeners

Register a function listener with `Events.listen()`.

```ts
import { Events } from "@rekkr/orm/events";
import { InvoicePaid } from "./events/InvoicePaid";

Events.listen(InvoicePaid, async (event) => {
  await sendReceipt(event.customerId, event.invoiceId);
});
```

Dispatch an event instance with `Events.dispatch()`.

```ts
await Events.dispatch(new InvoicePaid(invoice.id, invoice.customer_id, invoice.total));
```

Listeners run in registration order. Async listeners are awaited before the next listener runs.

## Class Handlers

You can register a handler class. ORM instantiates the handler once at registration, the same registration-time lifecycle used by model observers.

```ts
import { EventHandler, Events } from "@rekkr/orm/events";
import { InvoicePaid } from "./events/InvoicePaid";

class SendInvoiceReceipt extends EventHandler<InvoicePaid> {
  async handle(event: InvoicePaid) {
    await sendReceipt(event.customerId, event.invoiceId);
  }
}

Events.listen(InvoicePaid, SendInvoiceReceipt);
```

Extending `EventHandler` is optional. Any zero-argument class with a `handle(event)` method can be registered.

```ts
class RecordRevenue {
  async handle(event: InvoicePaid) {
    await revenueLedger.record(event.invoiceId, event.amount);
  }
}

Events.listen(InvoicePaid, RecordRevenue);
```

Handler classes must be constructable with no arguments because ORM creates the handler instance during registration.

## Registering Events

Register listeners once during application startup, after your application dependencies are available.

```ts
import { configureOrm } from "@rekkr/orm";
import { Events } from "@rekkr/orm/events";
import { InvoicePaid } from "./events/InvoicePaid";
import { SendInvoiceReceipt } from "./listeners/SendInvoiceReceipt";

configureOrm({
  connection: { url: process.env.DATABASE_URL! },
});

Events.listen(InvoicePaid, SendInvoiceReceipt);
```

There is no decorator-based auto-registration or event file discovery. Import the module that defines the handler and call `Events.listen()` explicitly.

Avoid registering the same listener inside request handlers or Svelte reactive code. `Events` is global process state, so repeated registration will make the listener run multiple times.

## Temporary Listeners

`listen()` returns an unsubscribe callback. This is useful for tests, one-off workflows, or code that needs to attach a listener and remove it immediately afterward.

```ts
const off = Events.listen(InvoicePaid, (event) => {
  captured.push(event.invoiceId);
});

await Events.dispatch(new InvoicePaid(1, 10, 500));
off();
```

Use `once()` when the listener should automatically remove itself after the first dispatch.

```ts
Events.once(InvoicePaid, async (event) => {
  await notifyAccounting(event.invoiceId);
});
```

## Removing Listeners

Remove a listener by passing the same function, handler instance, or handler class used during registration.

```ts
const listener = (event: InvoicePaid) => {
  console.log(event.invoiceId);
};

Events.listen(InvoicePaid, listener);
Events.unlisten(InvoicePaid, listener);
```

Class handlers are removed by their class constructor.

```ts
Events.listen(InvoicePaid, SendInvoiceReceipt);
Events.unlisten(InvoicePaid, SendInvoiceReceipt);
```

Clear listeners for one event class or for every event class.

```ts
Events.clear(InvoicePaid);
Events.clear();
```

## Error Behavior

`dispatch()` does not swallow listener errors. If a listener throws or rejects, `dispatch()` rejects and later listeners are not called.

```ts
try {
  await Events.dispatch(new InvoicePaid(invoice.id, invoice.customer_id, invoice.total));
} catch (error) {
  logger.error(error);
}
```

If a listener failure should not block the caller, catch the error inside that listener.

## Cache Invalidation Example

Events can keep cache invalidation separate from model observers.

```ts
import { Cache } from "@rekkr/orm/cache";
import { Events } from "@rekkr/orm/events";

class EnrollmentChanged {
  constructor(public studentId: number) {}
}

class ForgetEnrollmentCache {
  async handle() {
    await Cache.forgetTags(["enrollments"]);
  }
}

Events.listen(EnrollmentChanged, ForgetEnrollmentCache);

await Events.dispatch(new EnrollmentChanged(student.id));
```

## Testing

Because event registrations are global process state, clear them between tests when a test registers listeners.

```ts
import { afterEach, test } from "bun:test";
import { Events } from "@rekkr/orm/events";

afterEach(() => {
  Events.clear();
});

test("dispatches an event", async () => {
  const calls: number[] = [];

  Events.listen(InvoicePaid, (event) => {
    calls.push(event.invoiceId);
  });

  await Events.dispatch(new InvoicePaid(1, 10, 500));
});
```

For narrower cleanup, keep the unsubscribe callback returned by `listen()`:

```ts
const off = Events.listen(InvoicePaid, listener);

try {
  await runScenario();
} finally {
  off();
}
```

## Events vs Observers

Use observers for persistence lifecycle hooks:

```ts
class InvoiceObserver extends Observer<Invoice> {
  async updated(invoice: Invoice) {
    await Cache.forgetTags([`invoice:${invoice.id}`]);
  }
}
```

Use events for domain activity you choose to publish:

```ts
await invoice.markPaid();
await Events.dispatch(new InvoicePaid(invoice.id, invoice.customer_id, invoice.total));
```

Observers are model-bound and fire from model instance operations. Events are explicit and only fire when you call `Events.dispatch()`.
