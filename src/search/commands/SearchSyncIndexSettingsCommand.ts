import { Command } from "../../commands/Command.js";
import type { OrmConfig } from "../../config/OrmConfig.js";
import { Search } from "../SearchManager.js";
import { loadSearchableModels, resolveSearchableModel } from "./resolveSearchableModel.js";
import { runWithTenant } from "./runWithTenant.js";

export function makeSearchSyncIndexSettingsCommand(config: OrmConfig) {
  return class extends Command.define("search:sync-index-settings {model? : Model class name (all if omitted)} {--tenant= : Run under a tenant context}") {
    static description = "Push per-model search index settings to the engine.";

    async handle() {
      const name = this.argumentOptional("model");
      const tenantId = this.option("tenant") as string | undefined;
      const targets = name
        ? [await resolveSearchableModel(config, name)]
        : await loadSearchableModels(config);

      await runWithTenant(tenantId, async () => {
        for (const ctor of targets) {
          if (!ctor) continue;
          const settings = (ctor as any).searchIndexSettings;
          if (!settings) { this.warn(`${ctor.name}: no searchIndexSettings defined, skipping.`); continue; }
          const index = (ctor as any).searchableAs();
          const engine = Search.engine();
          const caps = Search.capabilities();
          if (!caps.indexSettings || typeof engine.updateIndexSettings !== "function") {
            this.warn(`${ctor.name}: active search engine does not support index settings, skipping "${index}".`);
            continue;
          }
          await engine.updateIndexSettings(index, settings);
          this.info(`Synced settings for "${index}" (${ctor.name})${tenantId ? ` (tenant=${tenantId})` : ""}.`);
        }
      });
    }
  };
}
