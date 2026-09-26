import { afterEach, describe, expect, test } from "./harness.js";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { Command } from "../src/commands/Command.js";
import type { OrmConfig } from "../src/config/OrmConfig.js";
import type { Connection } from "../src/connection/Connection.js";
import { Schema } from "../src/index.js";
import { Search } from "../src/search/index.js";
import type { SearchCapabilities, SearchEngine, SearchableRecord } from "../src/search/index.js";
import {
  makeSearchCreateIndexCommand, makeSearchDeleteIndexCommand, makeSearchFlushCommand,
  makeSearchFtsOptimizeCommand, makeSearchFtsRebuildCommand, makeSearchImportCommand,
  makeSearchListIndexesCommand, makeSearchReimportCommand, makeSearchReindexCommand,
  makeSearchStatusCommand, makeSearchSyncIndexSettingsCommand, makeSearchVerifyCommand,
} from "../src/search/commands/index.js";
import { setupTestDb } from "./helpers.js";

const INDEX = "cli_posts_search";
const SETTINGS = { sortableAttributes: ["name"] };
const FTS = { columns: ["name"] };
const rows = (index: string) => [
  { index, id: 1, data: { name: "alpha" } },
  { index, id: 2, data: { name: "beta" } },
];

class CommandEngine implements SearchEngine {
  calls: unknown[][] = [];
  indexes = new Set<string>();

  capabilities(): SearchCapabilities {
    return {
      nativeMultiSearch: false, indexSettings: true, matchesPosition: false,
      highlight: false, crop: false, facets: false, minScore: false,
      searchOn: false, rawQuery: false,
    };
  }
  configureIndex(index: string, schema: Record<string, unknown>) { this.calls.push(["configureIndex", index, schema]); }
  async update(records: SearchableRecord[]) { this.calls.push(["update", records]); }
  async delete(records: SearchableRecord[]) { this.calls.push(["delete", records]); }
  async search() { return []; }
  async paginate() { return { hits: [], total: 0, page: 1, perPage: 10 }; }
  async flush(index: string) { this.calls.push(["flush", index]); }
  async createIndex(index: string, options?: Record<string, unknown>) {
    this.calls.push(["createIndex", index, options]);
    this.indexes.add(index);
  }
  async deleteIndex(index: string) { this.calls.push(["deleteIndex", index]); this.indexes.delete(index); }
  async updateIndexSettings(index: string, settings: Record<string, unknown>) {
    this.calls.push(["updateIndexSettings", index, settings]);
  }
  async indexExists(index: string) { this.calls.push(["indexExists", index]); return this.indexes.has(index); }
  async health() { this.calls.push(["health"]); return { status: "ok" }; }
  async optimize(index: string) { this.calls.push(["optimize", index]); }
  async rebuild(index: string) { this.calls.push(["rebuild", index]); }
  async swapIndexes(a: string, b: string) { this.calls.push(["swapIndexes", a, b]); }
}

const dirs: string[] = [];
const connections: Connection[] = [];
afterEach(async () => {
  Search.reset();
  await Promise.all(connections.splice(0).map((connection) => connection.close()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture() {
  const connection = setupTestDb();
  connections.push(connection);
  await Schema.create("cli_posts", (table) => {
    table.increments("id");
    table.string("name");
    table.timestamps();
  });
  await connection.run("INSERT INTO cli_posts (name) VALUES (?)", ["alpha"]);
  await connection.run("INSERT INTO cli_posts (name) VALUES (?)", ["beta"]);

  await mkdir(join(process.cwd(), "tmp_agents"), { recursive: true });
  const dir = await mkdtemp(join(process.cwd(), "tmp_agents", "temp_search_command_handlers_"));
  dirs.push(dir);
  await writeFile(join(dir, "CliPost.ts"), `import { Model } from "../../src/index.js";
import { Search } from "../../src/search/index.js";
export class CliPostRecord extends Model { static override table = "cli_posts"; }
export const CliPost = Search.register(CliPostRecord, {
  index: "${INDEX}",
  settings: ${JSON.stringify(SETTINGS)},
  fts: ${JSON.stringify(FTS)},
  toSearchableArray: (model: any) => ({ name: model.getAttribute("name") }),
});\n`);
  const engine = new CommandEngine();
  Search.reset();
  Search.configure({ engine });
  return { config: { modelsPath: dir, connection: { url: "sqlite://:memory:" } } as OrmConfig, engine };
}

async function run(
  factory: (config: OrmConfig) => new () => Command,
  config: OrmConfig,
  model?: string,
  options: Record<string, string | boolean> = {},
): Promise<string[]> {
  const command = new (factory(config))();
  command._parsedArgs = model ? { model } : {};
  command._parsedOptions = options;
  const messages: string[] = [];
  command.info = (message) => messages.push(`info:${message}`);
  command.warn = (message) => messages.push(`warn:${message}`);
  command.error = (message) => messages.push(`error:${message}`);
  command.line = (message = "") => messages.push(`line:${message}`);
  await command.handle();
  return messages;
}

describe("search command handlers", () => {
  test("creates, inspects, syncs, verifies, flushes and deletes only the model's index", async () => {
    const { config, engine } = await fixture();
    expect(await run(makeSearchCreateIndexCommand, config, "CliPost")).toEqual([
      `info:Applied FTS schema for "${INDEX}" from CliPostRecord.fts.`,
      `info:Created index "${INDEX}" (primaryKey="id").`,
    ]);
    expect(engine.calls).toEqual([
      ["configureIndex", INDEX, FTS],
      ["createIndex", INDEX, { primaryKey: "id" }],
    ]);
    engine.indexes.add("other_index");

    engine.calls = [];
    expect(await run(makeSearchStatusCommand, config)).toEqual([
      "info:Engine status: ok",
      "line:Indexes:",
      `line:  - CliPostRecord → ${INDEX}`,
    ]);
    expect(engine.calls).toEqual([["health"]]);

    engine.calls = [];
    expect(await run(makeSearchListIndexesCommand, config)).toEqual([
      `line:${"CliPostRecord".padEnd(24)} → ${INDEX}`,
    ]);
    expect(engine.calls).toEqual([]);

    expect(await run(makeSearchSyncIndexSettingsCommand, config, "CliPost")).toEqual([
      `info:Synced settings for "${INDEX}" (CliPostRecord).`,
    ]);
    expect(engine.calls).toEqual([["updateIndexSettings", INDEX, SETTINGS]]);

    engine.calls = [];
    expect(await run(makeSearchVerifyCommand, config)).toEqual([
      "line:▶ default",
      `line:  ✓ ${"CliPostRecord".padEnd(24)} → ${INDEX}`,
      "line:",
      "info:All indexes present.",
    ]);
    expect(engine.calls).toEqual([["indexExists", INDEX]]);

    engine.calls = [];
    expect(await run(makeSearchFlushCommand, config, "CliPost")).toEqual([`info:Flushed index "${INDEX}".`]);
    expect(engine.calls).toEqual([["flush", INDEX]]);

    engine.calls = [];
    expect(await run(makeSearchDeleteIndexCommand, config, "CliPost")).toEqual([
      `warn:This will permanently delete index "${INDEX}". Re-run with --force to confirm.`,
    ]);
    expect(engine.calls).toEqual([]);
    expect(engine.indexes.has(INDEX)).toBe(true);
    expect(await run(makeSearchDeleteIndexCommand, config, "CliPost", { force: true }))
      .toEqual([`info:Deleted index "${INDEX}".`]);
    expect(engine.calls).toEqual([["deleteIndex", INDEX]]);
    expect([...engine.indexes]).toEqual(["other_index"]);
  });

  test("imports, reimports and reindexes the exact rows in the right order", async () => {
    const { config, engine } = await fixture();
    expect(await run(makeSearchImportCommand, config, "CliPost", { chunk: "1", "dry-run": true }))
      .toEqual([
        "info:[dry-run] Indexed 1 rows...",
        "info:[dry-run] Indexed 2 rows...",
        `info:[dry-run] Done. Would import 2 rows in 2 chunk(s) into "${INDEX}".`,
      ]);
    expect(engine.calls).toEqual([]);

    expect(await run(makeSearchImportCommand, config, "CliPost", { chunk: "1" }))
      .toEqual([
        "info:Indexed 1 rows...",
        "info:Indexed 2 rows...",
        `info:Done. Imported 2 rows in 2 chunk(s) into "${INDEX}".`,
      ]);
    expect(engine.calls.map((call) => [call[0], (call[1] as SearchableRecord[]).length]))
      .toEqual([["update", 1], ["update", 1]]);
    expect(engine.calls.flatMap((call) => call[1] as SearchableRecord[]).sort((a, b) => Number(a.id) - Number(b.id)))
      .toEqual(rows(INDEX));

    engine.calls = [];
    expect(await run(makeSearchReimportCommand, config, "CliPost", { chunk: "2" }))
      .toEqual([
        `warn:Flushing index "${INDEX}"...`,
        "info:Indexed 2 rows...",
        `info:Done. Reimported 2 rows in 1 chunk(s) into "${INDEX}".`,
      ]);
    expect(engine.calls.map((call) => call[0])).toEqual(["flush", "update"]);
    expect(engine.calls[0]).toEqual(["flush", INDEX]);
    expect((engine.calls[1]![1] as SearchableRecord[]).sort((a, b) => Number(a.id) - Number(b.id)))
      .toEqual(rows(INDEX));

    engine.calls = [];
    const next = `${INDEX}_fresh`;
    expect(await run(makeSearchReindexCommand, config, "CliPost", { chunk: "2", suffix: "_fresh" }))
      .toEqual([
        `info:Creating fresh index "${next}"...`,
        `info:Pushing settings to "${next}"...`,
        "info:Indexed 2 rows...",
        `info:Imported 2 rows in 1 chunk(s) to "${next}".`,
        `info:Swapping "${INDEX}" ↔ "${next}"...`,
        `info:Dropping stale "${next}"...`,
        "info:Reindex complete.",
      ]);
    expect(engine.calls.map((call) => call[0])).toEqual([
      "configureIndex", "createIndex", "updateIndexSettings", "update", "swapIndexes", "deleteIndex",
    ]);
    expect(engine.calls[0]).toEqual(["configureIndex", next, FTS]);
    expect(engine.calls[1]).toEqual(["createIndex", next, { primaryKey: "id" }]);
    expect(engine.calls[2]).toEqual(["updateIndexSettings", next, SETTINGS]);
    expect((engine.calls[3]![1] as SearchableRecord[]).sort((a, b) => Number(a.id) - Number(b.id)))
      .toEqual(rows(next));
    expect(engine.calls[4]).toEqual(["swapIndexes", INDEX, next]);
    expect(engine.calls[5]).toEqual(["deleteIndex", next]);
    expect(await run(makeSearchListIndexesCommand, config)).toEqual([
      `line:${"CliPostRecord".padEnd(24)} → ${INDEX}`,
    ]);
  });

  test("FTS maintenance commands target the model index and report unsupported engines", async () => {
    const { config, engine } = await fixture();
    expect(await run(makeSearchFtsOptimizeCommand, config, "CliPost")).toEqual([
      `info:Optimizing "${INDEX}"...`, "info:Done.",
    ]);
    expect(await run(makeSearchFtsRebuildCommand, config, "CliPost")).toEqual([
      `info:Rebuilding "${INDEX}" from source table...`, "info:Done.",
    ]);
    expect(engine.calls).toEqual([["optimize", INDEX], ["rebuild", INDEX]]);

    (engine as { optimize?: (index: string) => Promise<void> }).optimize = undefined;
    engine.calls = [];
    expect(await run(makeSearchFtsOptimizeCommand, config, "CliPost"))
      .toEqual(["error:Active engine does not support optimize(). FTS5-only command."]);
    expect(engine.calls).toEqual([]);
  });
});
