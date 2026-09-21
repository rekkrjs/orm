export type EventConstructor<TEvent = unknown> = new (...args: any[]) => TEvent;
export type EventListener<TEvent> = (event: TEvent) => void;
export type EventHandlerContract<TEvent> = {
  handle(event: TEvent): void;
};
export type EventHandlerConstructor<TEvent> = new () => EventHandlerContract<TEvent>;
export type EventSubscriber<TEvent> =
  | EventListener<TEvent>
  | EventHandlerContract<TEvent>
  | EventHandlerConstructor<TEvent>;
export type Unsubscribe = () => void;

type ListenerEntry<TEvent = unknown> = {
  original: EventSubscriber<TEvent>;
  handler: EventHandlerContract<TEvent>;
  once: boolean;
};

/**
 * Optional base class for class-based event handlers.
 *
 * Extending this class is not required. Any class or object with a `handle`
 * method can be registered with `Events.listen()`.
 */
export abstract class EventHandler<TEvent> implements EventHandlerContract<TEvent> {
  abstract handle(event: TEvent): void;
}

export class Events {
  private static listeners = new Map<EventConstructor, ListenerEntry[]>();

  static listen<TEvent>(
    eventClass: EventConstructor<TEvent>,
    subscriber: EventSubscriber<TEvent>,
  ): Unsubscribe {
    return this.addListener(eventClass, subscriber, false);
  }

  static once<TEvent>(
    eventClass: EventConstructor<TEvent>,
    subscriber: EventSubscriber<TEvent>,
  ): Unsubscribe {
    return this.addListener(eventClass, subscriber, true);
  }

  static unlisten<TEvent>(
    eventClass: EventConstructor<TEvent>,
    subscriber: EventSubscriber<TEvent>,
  ): void {
    const entries = this.listeners.get(eventClass);
    if (!entries) return;

    // Remove one registration per call: listen() twice means two independent
    // subscriptions, so one unlisten() must not cancel both.
    const index = entries.findIndex((entry) => this.matchesSubscriber(entry, subscriber));
    if (index === -1) return;
    const remaining = entries.filter((_, i) => i !== index);
    if (remaining.length === 0) {
      this.listeners.delete(eventClass);
      return;
    }

    this.listeners.set(eventClass, remaining);
  }

  static async dispatch<TEvent extends object>(event: TEvent): Promise<TEvent> {
    const eventClass = event.constructor as EventConstructor<TEvent>;
    const entries = this.listeners.get(eventClass) as ListenerEntry<TEvent>[] | undefined;
    if (!entries || entries.length === 0) return event;

    // One listener failing must not silently cancel the ones behind it: each is
    // isolated, and the failures are reported together once every handler ran.
    const errors: unknown[] = [];

    for (const entry of [...entries]) {
      if (!this.isRegistered(eventClass, entry)) continue;

      if (entry.once) {
        this.removeEntry(eventClass, entry);
      }

      try {
        await entry.handler.handle(event);
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, `${errors.length} listeners failed for ${eventClass.name}.`);
    }

    return event;
  }

  static clear<TEvent>(eventClass?: EventConstructor<TEvent>): void {
    if (eventClass) {
      this.listeners.delete(eventClass);
      return;
    }

    this.listeners.clear();
  }

  static hasListeners<TEvent>(eventClass: EventConstructor<TEvent>): boolean {
    return (this.listeners.get(eventClass)?.length ?? 0) > 0;
  }

  private static addListener<TEvent>(
    eventClass: EventConstructor<TEvent>,
    subscriber: EventSubscriber<TEvent>,
    once: boolean,
  ): Unsubscribe {
    const entry: ListenerEntry<TEvent> = {
      original: subscriber,
      handler: this.resolveHandler(subscriber),
      once,
    };
    const entries = this.listeners.get(eventClass) ?? [];

    entries.push(entry as ListenerEntry);
    this.listeners.set(eventClass, entries);

    return () => {
      this.removeEntry(eventClass, entry);
    };
  }

  private static resolveHandler<TEvent>(subscriber: EventSubscriber<TEvent>): EventHandlerContract<TEvent> {
    if (this.isHandlerClass(subscriber)) {
      return new subscriber();
    }

    if (this.isHandlerInstance(subscriber)) {
      return subscriber;
    }

    return {
      handle: subscriber,
    };
  }

  private static isHandlerClass<TEvent>(
    subscriber: EventSubscriber<TEvent>,
  ): subscriber is EventHandlerConstructor<TEvent> {
    return typeof subscriber === "function" && typeof subscriber.prototype?.handle === "function";
  }

  private static isHandlerInstance<TEvent>(
    subscriber: EventSubscriber<TEvent>,
  ): subscriber is EventHandlerContract<TEvent> {
    return typeof subscriber === "object" && subscriber !== null && typeof subscriber.handle === "function";
  }

  private static matchesSubscriber<TEvent>(
    entry: ListenerEntry<TEvent>,
    subscriber: EventSubscriber<TEvent>,
  ): boolean {
    return entry.original === subscriber || entry.handler === subscriber;
  }

  private static isRegistered<TEvent>(
    eventClass: EventConstructor<TEvent>,
    entry: ListenerEntry<TEvent>,
  ): boolean {
    return this.listeners.get(eventClass)?.includes(entry as ListenerEntry) ?? false;
  }

  private static removeEntry<TEvent>(
    eventClass: EventConstructor<TEvent>,
    entry: ListenerEntry<TEvent>,
  ): void {
    const entries = this.listeners.get(eventClass);
    if (!entries) return;

    const index = entries.indexOf(entry as ListenerEntry);
    if (index === -1) return;

    entries.splice(index, 1);
    if (entries.length === 0) {
      this.listeners.delete(eventClass);
    }
  }
}
