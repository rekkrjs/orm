import type { OrmConfig } from "../../config/OrmConfig.js";
import type { CommandContext } from "../../commands/Command.js";
import { Search } from "../SearchManager.js";
import { makeSearchableRecord } from "../Searchable.js";
import type { SearchableModelConstructor } from "../Searchable.js";

export interface ImportOptions {
  chunk: number;
  dryRun: boolean;
}

export async function importModel(
  config: OrmConfig,
  ctor: SearchableModelConstructor,
  options: ImportOptions,
  ctx: Pick<CommandContext<string>, "info" | "warn">,
): Promise<{ total: number; chunks: number }> {
  const engine = Search.engine();
  const chunk = options.chunk;
  let total = 0;
  let chunks = 0;

  await (ctor as any).query().chunk(chunk, async (items: any) => {
    const records = [];
    for (const item of items) {
      const record = makeSearchableRecord(item);
      if (record) records.push(record);
    }
    if (records.length === 0) return;
    chunks++;
    if (!options.dryRun) await engine.update(records);
    total += records.length;
    ctx.info(`${options.dryRun ? "[dry-run] " : ""}Indexed ${total} rows...`);
  });

  return { total, chunks };
}

export function resolveChunkSize(
  config: OrmConfig,
  raw: string | boolean | undefined,
): number {
  return parseInt(String(raw ?? config.search?.chunk ?? 500), 10);
}
