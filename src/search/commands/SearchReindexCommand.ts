import { Command } from "../../commands/Command.js";
import type { OrmConfig } from "../../config/OrmConfig.js";
import { Search } from "../SearchManager.js";
import { resolveSearchableModel } from "./resolveSearchableModel.js";
import { importModel, resolveChunkSize } from "./importHelper.js";
import { runWithTenant } from "./runWithTenant.js";

/**
 * Zero-downtime reindex: build a fresh `*_next` index, swap with the live
 * one, then drop the old. Requires an engine with `swapIndexes()` (Meili).
 */
export function makeSearchReindexCommand(config: OrmConfig) {
  return class extends Command.define(
    "search:reindex {model : Model class name} " +
    "{--chunk= : Rows per batch} " +
    "{--suffix= : Temp index suffix (default _next)} " +
    "{--tenant= : Run under a tenant context}",
  ) {
    static description = "Zero-downtime reindex via build → swap → drop (engine must implement swapIndexes).";

    async handle() {
      const name = this.argument("model");
      const tenantId = this.option("tenant") as string | undefined;
      const suffix = (this.option("suffix") as string | undefined) ?? "_next";
      const ctor = await resolveSearchableModel(config, name);
      if (!ctor) { this.error(`Model "${name}" not found or not searchable.`); return; }

      const engine = Search.engine() as any;
      if (typeof engine.swapIndexes !== "function") {
        this.error("Active engine does not support swapIndexes(). Use search:reimport instead.");
        return;
      }

      const chunk = resolveChunkSize(config, this.option("chunk"));

      await runWithTenant(tenantId, async () => {
        const live = (ctor as any).searchableAs();
        const next = `${live}${suffix}`;

        this.info(`Creating fresh index "${next}"...`);
        const ftsConfig = (ctor as any).searchFtsConfig;
        if (ftsConfig && typeof engine.configureIndex === "function") {
          engine.configureIndex(next, ftsConfig);
        }
        await engine.createIndex(next, { primaryKey: (ctor as any).primaryKey ?? "id" });

        // Push settings to the temp index if defined.
        const settings = (ctor as any).searchIndexSettings;
        if (settings) {
          this.info(`Pushing settings to "${next}"...`);
          await engine.updateIndexSettings(next, settings);
        }

        // Bulk-import while temporarily aliasing the model's index to the temp.
        const originalAs = (ctor as any).searchableAs;
        (ctor as any).searchableAs = () => next;
        try {
          const { total, chunks } = await importModel(
            config, ctor, { chunk, dryRun: false },
            { info: (m) => this.info(m), warn: (m) => this.warn(m) },
          );
          this.info(`Imported ${total} rows in ${chunks} chunk(s) to "${next}".`);
        } finally {
          (ctor as any).searchableAs = originalAs;
        }

        this.info(`Swapping "${live}" ↔ "${next}"...`);
        await engine.swapIndexes(live, next);

        this.info(`Dropping stale "${next}"...`);
        await engine.deleteIndex(next);

        this.info(`Reindex complete${tenantId ? ` (tenant=${tenantId})` : ""}.`);
      });
    }
  };
}
