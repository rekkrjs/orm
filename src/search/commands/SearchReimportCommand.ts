import { Command } from "../../commands/Command.js";
import type { OrmConfig } from "../../config/OrmConfig.js";
import { Search } from "../SearchManager.js";
import { resolveSearchableModel } from "./resolveSearchableModel.js";
import { importModel, resolveChunkSize } from "./importHelper.js";
import { runWithTenant } from "./runWithTenant.js";

export function makeSearchReimportCommand(config: OrmConfig) {
  return class extends Command.define("search:reimport {model : Model class name} {--chunk= : Rows per batch} {--tenant= : Run under a tenant context}") {
    static description = "Flush a model's search index, then bulk-import all rows.";

    async handle() {
      const name = this.argument("model");
      const tenantId = this.option("tenant") as string | undefined;
      const ctor = await resolveSearchableModel(config, name);
      if (!ctor) { this.error(`Model "${name}" not found or not searchable.`); return; }

      const chunk = resolveChunkSize(config, this.option("chunk"));

      await runWithTenant(tenantId, async () => {
        const index = (ctor as any).searchableAs();
        this.warn(`Flushing index "${index}"...`);
        await Search.engine().flush(index);

        const { total, chunks } = await importModel(
          config,
          ctor,
          { chunk, dryRun: false },
          { info: (m) => this.info(m), warn: (m) => this.warn(m) },
        );
        this.info(`Done. Reimported ${total} rows in ${chunks} chunk(s) into "${index}"${tenantId ? ` (tenant=${tenantId})` : ""}.`);
      });
    }
  };
}
