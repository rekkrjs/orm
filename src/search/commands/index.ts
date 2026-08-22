import { registerCommand } from "../../commands/Command.js";
import type { OrmConfig } from "../../config/OrmConfig.js";
import { makeSearchImportCommand } from "./SearchImportCommand.js";
import { makeSearchFlushCommand } from "./SearchFlushCommand.js";
import { makeSearchReimportCommand } from "./SearchReimportCommand.js";
import { makeSearchCreateIndexCommand } from "./SearchCreateIndexCommand.js";
import { makeSearchDeleteIndexCommand } from "./SearchDeleteIndexCommand.js";
import { makeSearchSyncIndexSettingsCommand } from "./SearchSyncIndexSettingsCommand.js";
import { makeSearchStatusCommand } from "./SearchStatusCommand.js";
import { makeSearchFtsOptimizeCommand } from "./SearchFtsOptimizeCommand.js";
import { makeSearchFtsRebuildCommand } from "./SearchFtsRebuildCommand.js";
import { makeSearchListIndexesCommand } from "./SearchListIndexesCommand.js";
import { makeSearchVerifyCommand } from "./SearchVerifyCommand.js";
import { makeSearchReindexCommand } from "./SearchReindexCommand.js";
import { makeMakeSearchableCommand } from "./MakeSearchableCommand.js";

export { makeSearchImportCommand } from "./SearchImportCommand.js";
export { makeSearchFlushCommand } from "./SearchFlushCommand.js";
export { makeSearchReimportCommand } from "./SearchReimportCommand.js";
export { makeSearchCreateIndexCommand } from "./SearchCreateIndexCommand.js";
export { makeSearchDeleteIndexCommand } from "./SearchDeleteIndexCommand.js";
export { makeSearchSyncIndexSettingsCommand } from "./SearchSyncIndexSettingsCommand.js";
export { makeSearchStatusCommand } from "./SearchStatusCommand.js";
export { makeSearchFtsOptimizeCommand } from "./SearchFtsOptimizeCommand.js";
export { makeSearchFtsRebuildCommand } from "./SearchFtsRebuildCommand.js";
export { makeSearchListIndexesCommand } from "./SearchListIndexesCommand.js";
export { makeSearchVerifyCommand } from "./SearchVerifyCommand.js";
export { makeSearchReindexCommand } from "./SearchReindexCommand.js";
export { makeMakeSearchableCommand } from "./MakeSearchableCommand.js";

export function registerSearchCommands(config: OrmConfig): void {
  registerCommand(makeSearchImportCommand(config));
  registerCommand(makeSearchReimportCommand(config));
  registerCommand(makeSearchFlushCommand(config));
  registerCommand(makeSearchCreateIndexCommand(config));
  registerCommand(makeSearchDeleteIndexCommand(config));
  registerCommand(makeSearchSyncIndexSettingsCommand(config));
  registerCommand(makeSearchStatusCommand(config));
  registerCommand(makeSearchFtsOptimizeCommand(config));
  registerCommand(makeSearchFtsRebuildCommand(config));
  registerCommand(makeSearchListIndexesCommand(config));
  registerCommand(makeSearchVerifyCommand(config));
  registerCommand(makeSearchReindexCommand(config));
  registerCommand(makeMakeSearchableCommand(config));
}
