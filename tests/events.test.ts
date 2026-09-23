import { describe, expect, test } from "./harness.js";
import { EventHandler, Events } from "../src/events/index.js";

class UserRegistered {
  constructor(
    public userId: number,
    public email: string,
  ) {}
}

class UserDeleted {
  constructor(public userId: number) {}
}

describe("Events", () => {
  test("dispatches function listeners in registration order and awaits async listeners", async () => {
    Events.clear();
    const calls: string[] = [];

    Events.listen(UserRegistered, async (event) => {
      await Promise.resolve();
      calls.push(`first:${event.userId}`);
    });
    Events.listen(UserRegistered, (event) => {
      calls.push(`second:${event.email}`);
    });

    const event = new UserRegistered(1, "alice@example.com");
    const result = await Events.dispatch(event);

    expect(result).toBe(event);
    expect(calls).toEqual(["first:1", "second:alice@example.com"]);
  });

  test("instantiates class handlers once when they are registered", async () => {
    Events.clear();

    class SendWelcomeEmail extends EventHandler<UserRegistered> {
      static constructed = 0;
      static calls: string[] = [];

      constructor() {
        super();
        SendWelcomeEmail.constructed++;
      }

      handle(event: UserRegistered) {
        SendWelcomeEmail.calls.push(event.email);
      }
    }

    Events.listen(UserRegistered, SendWelcomeEmail);

    await Events.dispatch(new UserRegistered(1, "alice@example.com"));
    await Events.dispatch(new UserRegistered(2, "bob@example.com"));

    expect(SendWelcomeEmail.constructed).toBe(1);
    expect(SendWelcomeEmail.calls).toEqual(["alice@example.com", "bob@example.com"]);
  });

  test("supports structural class handlers without extending EventHandler", async () => {
    Events.clear();
    const calls: number[] = [];

    class RecordRegistration {
      handle(event: UserRegistered) {
        calls.push(event.userId);
      }
    }

    Events.listen(UserRegistered, RecordRegistration);
    await Events.dispatch(new UserRegistered(3, "cara@example.com"));

    expect(calls).toEqual([3]);
  });

  test("returns an unsubscribe callback for temporary listeners", async () => {
    Events.clear();
    const calls: number[] = [];

    const offFirst = Events.listen(UserRegistered, (event) => {
      calls.push(event.userId);
    });
    Events.listen(UserRegistered, (event) => {
      calls.push(event.userId * 10);
    });

    offFirst();
    await Events.dispatch(new UserRegistered(4, "drew@example.com"));

    expect(calls).toEqual([40]);
  });

  test("supports once listeners", async () => {
    Events.clear();
    let calls = 0;

    Events.once(UserRegistered, () => {
      calls++;
    });

    await Events.dispatch(new UserRegistered(1, "alice@example.com"));
    await Events.dispatch(new UserRegistered(2, "bob@example.com"));

    expect(calls).toBe(1);
    expect(Events.hasListeners(UserRegistered)).toBe(false);
  });

  test("unlistens function, instance, and class handlers by identity", async () => {
    Events.clear();
    const calls: string[] = [];

    const functionListener = (event: UserRegistered) => {
      calls.push(`function:${event.userId}`);
    };
    const instanceHandler = {
      handle(event: UserRegistered) {
        calls.push(`instance:${event.userId}`);
      },
    };
    class ClassHandler {
      handle(event: UserRegistered) {
        calls.push(`class:${event.userId}`);
      }
    }

    Events.listen(UserRegistered, functionListener);
    Events.listen(UserRegistered, instanceHandler);
    Events.listen(UserRegistered, ClassHandler);

    Events.unlisten(UserRegistered, functionListener);
    Events.unlisten(UserRegistered, instanceHandler);
    Events.unlisten(UserRegistered, ClassHandler);

    await Events.dispatch(new UserRegistered(5, "erin@example.com"));

    expect(calls).toEqual([]);
  });

  test("clear can remove listeners for one event or all events", async () => {
    Events.clear();
    const calls: string[] = [];

    Events.listen(UserRegistered, () => {
      calls.push("registered");
    });
    Events.listen(UserDeleted, () => {
      calls.push("deleted");
    });

    Events.clear(UserRegistered);

    await Events.dispatch(new UserRegistered(1, "alice@example.com"));
    await Events.dispatch(new UserDeleted(1));
    expect(calls).toEqual(["deleted"]);

    Events.clear();
    await Events.dispatch(new UserDeleted(2));
    expect(calls).toEqual(["deleted"]);
  });
});
