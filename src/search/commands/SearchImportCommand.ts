import { Command } from "../../commands/Command.js";
import type { OrmConfig } from "../../config/OrmConfig.js";
import { resolveSearchableModel } from "./resolveSearchableModel.js";
import { importModel, resolveChunkSize } from "./importHelper.js";
import { runWithTenant } from "./runWithTenant.js";

export function makeSearchImportCommand(config: OrmConfig) {
  return class extends Command.define("search:import {model : Model class name} {--chunk= : Rows per batch} {--dry-run : Count rows without pushing} {--tenant= : Run under a tenant context}") {
    static description = "Bulk-index existing rows of a searchable model.";

    async handle() {
      const name = this.argument("model");
      const tenantId = this.option("tenant") as string | undefined;
      const ctor = await resolveSearchableModel(config, name);
      if (!ctor) { this.error(`Model "${name}" not found or not searchable.`); return; }

      const chunk = resolveChunkSize(config, this.option("chunk"));
      const dryRun = Boolean(this.option("dry-run"));

      await runWithTenant(tenantId, async () => {
        const { total, chunks } = await importModel(
          config,
          ctor,
          { chunk, dryRun },
          { info: (m) => this.info(m), warn: (m) => this.warn(m) },
        );
        const prefix = dryRun ? "[dry-run] " : "";
        const tenantNote = tenantId ? ` (tenant=${tenantId})` : "";
        this.info(`${prefix}Done. ${dryRun ? "Would import" : "Imported"} ${total} rows in ${chunks} chunk(s) into "${(ctor as any).searchableAs()}"${tenantNote}.`);
      });
    }
  };
}
