import { Command } from "../../commands/Command.js";
import type { OrmConfig } from "../../config/OrmConfig.js";
import { Search } from "../SearchManager.js";
import { loadSearchableModels } from "./resolveSearchableModel.js";

export function makeSearchListIndexesCommand(config: OrmConfig) {
  return class extends Command.define(
    "search:list-indexes " +
    "{--tenant= : Resolve indexes for a single tenant id} " +
    "{--tenants= : Comma-separated list of tenant ids} " +
    "{--all-tenants : Resolve for every tenant returned by config.tenancy.listTenants} " +
    "{--include-landlord : When listing tenants, also include the un-scoped landlord index}",
  ) {
    static description = "List the index name each searchable model resolves to, optionally per-tenant.";

    async handle() {
      const models = await loadSearchableModels(config);
      if (models.length === 0) {
        this.warn("No searchable models discovered.");
        return;
      }

      const tenantArg = this.option("tenant") as string | undefined;
      const tenantsArg = this.option("tenants") as string | undefined;
      const allTenants = Boolean(this.option("all-tenants"));
      const includeLandlord = Boolean(this.option("include-landlord"));

      let tenantIds: Array<string | null> | null = null;
      if (tenantArg) {
        tenantIds = [tenantArg];
      } else if (tenantsArg) {
        tenantIds = tenantsArg.split(",").map((s) => s.trim()).filter(Boolean);
      } else if (allTenants) {
        const cfgListed = Search.config()?.listTenants;
        const list = cfgListed ? (await cfgListed()) ?? [] : [];
        tenantIds = list.slice();
      }

      if (tenantIds && includeLandlord) tenantIds = [null, ...tenantIds];

      for (const m of models) {
        const base = ((m as any).searchIndex ?? (m as any).getTable()) as string;
        if (!tenantIds) {
          const resolved = Search.indexFor(base, null);
          this.line(`${m.name.padEnd(24)} → ${resolved}`);
          continue;
        }
        const scoped = Search.indexesFor(base, tenantIds);
        this.line(m.name);
        for (const [key, name] of Object.entries(scoped)) {
          const label = key === "__landlord__" ? "(landlord)" : `tenant=${key}`;
          this.line(`  ${label.padEnd(20)} → ${name}`);
        }
      }
    }
  };
}
