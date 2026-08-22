import { Command } from "../../commands/Command.js";
import type { OrmConfig } from "../../config/OrmConfig.js";
import { Search } from "../SearchManager.js";
import { loadSearchableModels } from "./resolveSearchableModel.js";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(2)} ${units[i]}`;
}

export function makeSearchStatusCommand(config: OrmConfig) {
  return class extends Command.define("search:status") {
    static description = "Show search engine health and list configured indexes.";

    async handle() {
      const engine = Search.engine() as any;
      if (typeof engine.health === "function") {
        const h = await engine.health();
        this.info(`Engine status: ${h.status}`);
      } else {
        this.warn("Engine does not implement health().");
      }

      const models = await loadSearchableModels(config);
      if (models.length === 0) {
        this.warn("No searchable models discovered.");
      } else {
        this.line("Indexes:");
        for (const m of models) this.line(`  - ${m.name} → ${(m as any).searchableAs()}`);
      }

      // Engine-specific diagnostics (currently SqliteFTS5Engine).
      if (typeof engine.diagnostics === "function") {
        const d = await engine.diagnostics();
        this.line("");
        this.info(`Engine diagnostics (${d.driver ?? "engine"}):`);
        if (d.journal_mode !== undefined) this.line(`  journal_mode      ${d.journal_mode}`);
        if (d.synchronous !== undefined) this.line(`  synchronous       ${d.synchronous}`);
        if (d.page_count !== undefined) this.line(`  page_count        ${d.page_count}`);
        if (d.page_size !== undefined) this.line(`  page_size         ${d.page_size}`);
        if (typeof d.size_bytes === "number") this.line(`  size              ${formatBytes(d.size_bytes)}`);
        if (d.freelist_count !== undefined) this.line(`  freelist_count    ${d.freelist_count}`);
        if (typeof d.fragmentation_pct === "number") {
          this.line(`  fragmentation     ${(d.fragmentation_pct * 100).toFixed(2)}%`);
        }
        if (d.wal_autocheckpoint !== undefined) this.line(`  wal_autocheckpt   ${d.wal_autocheckpoint}`);
        if (d.cache_size !== undefined) this.line(`  cache_size        ${d.cache_size}`);
        if (d.index_rows && typeof d.index_rows === "object") {
          this.line(`  index row counts:`);
          for (const [name, count] of Object.entries(d.index_rows as Record<string, number>)) {
            this.line(`    ${name.padEnd(24)} ${count}`);
          }
        }
      }
    }
  };
}
