import { Command } from "../../commands/Command.js";
import type { OrmConfig } from "../../config/OrmConfig.js";
import { Search } from "../SearchManager.js";
import { resolveSearchableModel } from "./resolveSearchableModel.js";
import { runWithTenant } from "./runWithTenant.js";

export function makeSearchCreateIndexCommand(config: OrmConfig) {
  return class extends Command.define("search:create-index {model : Model class name} {--tenant= : Run under a tenant context}") {
    static description = "Create the search index for a model.";

    async handle() {
      const name = this.argument("model");
      const tenantId = this.option("tenant") as string | undefined;
      const ctor = await resolveSearchableModel(config, name);
      if (!ctor) { this.error(`Model "${name}" not found or not searchable.`); return; }

      await runWithTenant(tenantId, async () => {
        const index = (ctor as any).searchableAs();
        const primaryKey = (ctor as any).primaryKey ?? "id";
        const engine = Search.engine() as any;

        const ftsConfig = (ctor as any).searchFtsConfig;
        if (ftsConfig && typeof engine.configureIndex === "function") {
          engine.configureIndex(index, ftsConfig);
          this.info(`Applied FTS schema for "${index}" from ${ctor.name}.fts.`);
        }

        await engine.createIndex(index, { primaryKey });
        this.info(`Created index "${index}" (primaryKey="${primaryKey}")${tenantId ? ` (tenant=${tenantId})` : ""}.`);
      });
    }
  };
}
