import { Command } from "../../commands/Command.js";
import type { OrmConfig } from "../../config/OrmConfig.js";
import { Search } from "../SearchManager.js";
import { resolveSearchableModel } from "./resolveSearchableModel.js";
import { runWithTenant } from "./runWithTenant.js";

export function makeSearchFlushCommand(config: OrmConfig) {
  return class extends Command.define("search:flush {model : Model class name} {--tenant= : Run under a tenant context}") {
    static description = "Remove all records from the search index for a model.";

    async handle() {
      const name = this.argument("model");
      const tenantId = this.option("tenant") as string | undefined;
      const ctor = await resolveSearchableModel(config, name);
      if (!ctor) { this.error(`Model "${name}" not found or not searchable.`); return; }

      await runWithTenant(tenantId, async () => {
        const index = (ctor as any).searchableAs();
        await Search.engine().flush(index);
        this.info(`Flushed index "${index}"${tenantId ? ` (tenant=${tenantId})` : ""}.`);
      });
    }
  };
}
