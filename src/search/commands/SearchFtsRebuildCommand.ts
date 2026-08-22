import { Command } from "../../commands/Command.js";
import type { OrmConfig } from "../../config/OrmConfig.js";
import { Search } from "../SearchManager.js";
import { resolveSearchableModel } from "./resolveSearchableModel.js";
import { runWithTenant } from "./runWithTenant.js";

export function makeSearchFtsRebuildCommand(config: OrmConfig) {
  return class extends Command.define("search:fts:rebuild {model : Model class name} {--tenant= : Run under a tenant context}") {
    static description = "Run FTS rebuild to repopulate the index from the source content table.";

    async handle() {
      const name = this.argument("model");
      const tenantId = this.option("tenant") as string | undefined;
      const ctor = await resolveSearchableModel(config, name);
      if (!ctor) { this.error(`Model "${name}" not found or not searchable.`); return; }
      const engine = Search.engine() as any;
      if (typeof engine.rebuild !== "function") {
        this.error(`Active engine does not support rebuild().`);
        return;
      }
      await runWithTenant(tenantId, async () => {
        const index = (ctor as any).searchableAs();
        this.info(`Rebuilding "${index}"${tenantId ? ` (tenant=${tenantId})` : ""} from source table...`);
        try {
          await engine.rebuild(index);
        } catch (err) {
          this.error(err instanceof Error ? err.message : String(err));
          return;
        }
        this.info(`Done.`);
      });
    }
  };
}
