import { AsyncLocalStorage } from "node:async_hooks";
import type { ModelConstructor } from "./Model.js";

export interface ObserverContract<T = any> {
  creating?(model: T): Promise<void> | void;
  created?(model: T): Promise<void> | void;
  updating?(model: T): Promise<void> | void;
  updated?(model: T): Promise<void> | void;
  saving?(model: T): Promise<void> | void;
  saved?(model: T): Promise<void> | void;
  deleting?(model: T): Promise<void> | void;
  deleted?(model: T): Promise<void> | void;
  restoring?(model: T): Promise<void> | void;
  restored?(model: T): Promise<void> | void;
}

const OBSERVER_EVENTS: (keyof ObserverContract)[] = [
  "creating", "created", "updating", "updated",
  "saving", "saved", "deleting", "deleted",
  "restoring", "restored",
];

type ObservedModel<TObserver> = TObserver extends ObserverContract<infer TModel> ? TModel : any;
type ObservableModelConstructor<TModel> = ModelConstructor<any> & (new (...args: any[]) => TModel);

export class Observer<T = any> implements ObserverContract<T> {
  creating(model: T) {}
  created(model: T) {}
  updating(model: T) {}
  updated(model: T) {}
  saving(model: T) {}
  saved(model: T) {}
  deleting(model: T) {}
  deleted(model: T) {}
  restoring(model: T) {}
  restored(model: T) {}

  static observe<TObserver extends ObserverContract<any>>(
    this: new () => TObserver,
    modelClass: ObservableModelConstructor<ObservedModel<TObserver>>,
  ): void;
  static observe<TObserver extends ObserverContract<any>>(
    this: new () => TObserver,
    modelClasses: readonly ObservableModelConstructor<ObservedModel<TObserver>>[],
  ): void;
  static observe<TObserver extends ObserverContract<any>>(
    this: new () => TObserver,
    modelClassOrClasses: ObservableModelConstructor<ObservedModel<TObserver>> | readonly ObservableModelConstructor<ObservedModel<TObserver>>[],
  ): void {
    const observer = new this();
    const modelClasses = Array.isArray(modelClassOrClasses) ? modelClassOrClasses : [modelClassOrClasses];
    for (const modelClass of modelClasses) {
      ObserverRegistry.register(modelClass, observer, this);
    }
  }

  static unobserve<TObserver extends ObserverContract<any>>(
    this: new () => TObserver,
    modelClass: ObservableModelConstructor<ObservedModel<TObserver>>,
  ): void;
  static unobserve<TObserver extends ObserverContract<any>>(
    this: new () => TObserver,
    modelClasses: readonly ObservableModelConstructor<ObservedModel<TObserver>>[],
  ): void;
  static unobserve<TObserver extends ObserverContract<any>>(
    this: new () => TObserver,
    modelClassOrClasses: ObservableModelConstructor<ObservedModel<TObserver>> | readonly ObservableModelConstructor<ObservedModel<TObserver>>[],
  ): void {
    const modelClasses = Array.isArray(modelClassOrClasses) ? modelClassOrClasses : [modelClassOrClasses];
    for (const modelClass of modelClasses) {
      ObserverRegistry.unregisterOwned(modelClass, this);
    }
  }
}

type ObserverEntry = {
  observer: ObserverContract<any>;
  owner?: Function;
};

const eventState = new AsyncLocalStorage<boolean>();

export class ObserverRegistry {
  private static observers = new Map<ModelConstructor<any>, ObserverEntry[]>();
  private static byEvent = new Map<string, Map<ModelConstructor<any>, ObserverEntry[]>>();

  static register<T>(modelClass: ModelConstructor<T>, observer: ObserverContract<T>, owner?: Function): void {
    if (!this.observers.has(modelClass)) {
      this.observers.set(modelClass, []);
    }
    const entry: ObserverEntry = { observer, owner };
    this.observers.get(modelClass)!.push(entry);
    for (const event of OBSERVER_EVENTS) {
      const handler = observer[event];
      if (handler && handler !== Observer.prototype[event]) {
        const map = this.byEvent.get(event) || new Map();
        const list = map.get(modelClass) || [];
        list.push(entry);
        map.set(modelClass, list);
        this.byEvent.set(event, map);
      }
    }
  }

  static get<T>(modelClass: ModelConstructor<T>): ObserverContract<T>[] {
    return (this.observers.get(modelClass) || []).map((entry) => entry.observer);
  }

  static hasAny<T>(modelClass: ModelConstructor<T>): boolean {
    const list = this.observers.get(modelClass);
    return !!list && list.length > 0;
  }

  static eventsMuted(): boolean {
    return eventState.getStore() === true;
  }

  static withoutEvents<T>(callback: () => T): T {
    return eventState.run(true, callback);
  }

  static hasFor<T>(event: keyof ObserverContract, modelClass: ModelConstructor<T>): boolean {
    const map = this.byEvent.get(event);
    if (!map) return false;
    const list = map.get(modelClass);
    return !!list && list.length > 0;
  }

  static unregister<T>(modelClass: ModelConstructor<T>): void {
    this.observers.delete(modelClass);
    for (const map of this.byEvent.values()) {
      map.delete(modelClass);
    }
  }

  static unregisterOwned<T>(modelClass: ModelConstructor<T>, owner: Function): void {
    const current = this.observers.get(modelClass);
    if (!current) return;
    const remaining = current.filter((entry) => entry.owner !== owner);
    if (remaining.length === 0) {
      this.observers.delete(modelClass);
    } else {
      this.observers.set(modelClass, remaining);
    }

    for (const map of this.byEvent.values()) {
      const list = map.get(modelClass);
      if (!list) continue;
      const filtered = list.filter((entry) => entry.owner !== owner);
      if (filtered.length === 0) {
        map.delete(modelClass);
      } else {
        map.set(modelClass, filtered);
      }
    }
  }

  static async dispatch<T>(event: keyof ObserverContract, model: T): Promise<void> {
    if (this.eventsMuted()) return;
    const eventMap = this.byEvent.get(event);
    if (!eventMap) return;
    const observers = eventMap.get(Object.getPrototypeOf(model).constructor as ModelConstructor<T>);
    if (!observers) return;
    for (const entry of observers) {
      const handler = entry.observer[event];
      if (handler) {
        await handler.call(entry.observer, model);
      }
    }
  }
}
