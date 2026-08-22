import { Command } from "../../commands/Command.js";
import type { OrmConfig } from "../../config/OrmConfig.js";
import { Search } from "../SearchManager.js";
import { resolveSearchableModel } from "./resolveSearchableModel.js";
import { runWithTenant } from "./runWithTenant.js";

export function makeSearchFtsOptimizeCommand(config: OrmConfig) {
  return class extends Command.define("search:fts:optimize {model : Model class name} {--tenant= : Run under a tenant context}") {
    static description = "Run FTS5 'optimize' on the model's index (merges b-tree levels).";

    async handle() {
      const name = this.argument("model");
      const tenantId = this.option("tenant") as string | undefined;
      const ctor = await resolveSearchableModel(config, name);
      if (!ctor) { this.error(`Model "${name}" not found or not searchable.`); return; }
      const engine = Search.engine() as any;
      if (typeof engine.optimize !== "function") {
        this.error(`Active engine does not support optimize(). FTS5-only command.`);
        return;
      }
      await runWithTenant(tenantId, async () => {
        const index = (ctor as any).searchableAs();
        this.info(`Optimizing "${index}"${tenantId ? ` (tenant=${tenantId})` : ""}...`);
        await engine.optimize(index);
        this.info(`Done.`);
      });
    }
  };
}
