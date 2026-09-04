import { afterCommit, currentTenantId } from "../connection/ExecutionContext.js";
import { TenantContext } from "../connection/TenantContext.js";
import type { Model, ModelConstructor } from "../model/Model.js";
import { ObserverRegistry, type ObserverContract } from "../model/Observer.js";
import { getSearchConfig, getSearchEngine, Search } from "./SearchManager.js";
import { makeSearchableRecord, type SearchableModelConstructor } from "./Searchable.js";
import { MakeSearchableJob } from "./jobs/MakeSearchableJob.js";
import { RemoveFromSearchJob } from "./jobs/RemoveFromSearchJob.js";
import { Queue } from "../queue/Queue.js";

const owner = Symbol("SearchObserver");

class SearchObserver implements ObserverContract<Model> {
  async saved(model: Model): Promise<void> {
    const ctor = Object.getPrototypeOf(model).constructor as SearchableModelConstructor;
    const shouldIndex = ctor.shouldBeSearchable ? ctor.shouldBeSearchable(model) : true;
    const record = makeSearchableRecord(model);
    if (!record) return;
    if (this.softDeletedTrashed(model)) {
      await this.dispatchDelete(record);
      return;
    }
    if (shouldIndex === false) {
      await this.dispatchDelete(record);
      return;
    }
    await this.dispatchUpdate(record);
  }

  async deleted(model: Model): Promise<void> {
    const record = makeSearchableRecord(model);
    if (!record) return;
    await this.dispatchDelete(record);
  }

  private softDeletedTrashed(model: Model): boolean {
    return Boolean((model as any).trashed?.());
  }

  private async dispatchUpdate(record: ReturnType<typeof makeSearchableRecord>) {
    if (!record) return;
    const cfg = getSearchConfig();
    if (cfg?.queue) {
      await Queue.dispatch(new MakeSearchableJob(record), {
        queue: cfg.queue.name,
        connection: cfg.queue.connection,
      });
      return;
    }
    const snapshot = structuredClone(record);
    const engine = getSearchEngine();
    const tenantId = currentTenantId();
    const deliver = async () => {
      if (Search.config() === cfg && Search.enqueueUpdate(snapshot)) return;
      await engine.update([snapshot]);
    };
    await afterCommit(() => tenantId === undefined ? deliver() : TenantContext.run(tenantId, deliver));
  }

  private async dispatchDelete(record: ReturnType<typeof makeSearchableRecord>) {
    if (!record) return;
    const cfg = getSearchConfig();
    if (cfg?.queue) {
      await Queue.dispatch(new RemoveFromSearchJob(record), {
        queue: cfg.queue.name,
        connection: cfg.queue.connection,
      });
      return;
    }
    const snapshot = structuredClone(record);
    const engine = getSearchEngine();
    const tenantId = currentTenantId();
    const deliver = async () => {
      if (Search.config() === cfg && Search.enqueueDelete(snapshot)) return;
      await engine.delete([snapshot]);
    };
    await afterCommit(() => tenantId === undefined ? deliver() : TenantContext.run(tenantId, deliver));
  }
}

export function attachSearchObserver(modelClass: ModelConstructor): void {
  const observer = new SearchObserver();
  ObserverRegistry.register(modelClass, observer, owner as any);
}

export function detachSearchObservers(modelClass: ModelConstructor): void {
  ObserverRegistry.unregisterOwned(modelClass, owner as any);
}
