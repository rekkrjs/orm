import { Command } from "../../commands/Command.js";
import type { OrmConfig } from "../../config/OrmConfig.js";
import { Search } from "../SearchManager.js";
import { resolveSearchableModel } from "./resolveSearchableModel.js";
import { runWithTenant } from "./runWithTenant.js";

export function makeSearchDeleteIndexCommand(config: OrmConfig) {
  return class extends Command.define("search:delete-index {model : Model class name} {--force : Skip confirmation} {--tenant= : Run under a tenant context}") {
    static description = "Delete the search index for a model (destructive).";

    async handle() {
      const name = this.argument("model");
      const tenantId = this.option("tenant") as string | undefined;
      const ctor = await resolveSearchableModel(config, name);
      if (!ctor) { this.error(`Model "${name}" not found or not searchable.`); return; }

      await runWithTenant(tenantId, async () => {
        const index = (ctor as any).searchableAs();
        if (!this.option("force")) {
          this.warn(`This will permanently delete index "${index}"${tenantId ? ` (tenant=${tenantId})` : ""}. Re-run with --force to confirm.`);
          return;
        }
        await Search.engine().deleteIndex(index);
        this.info(`Deleted index "${index}"${tenantId ? ` (tenant=${tenantId})` : ""}.`);
      });
    }
  };
}
