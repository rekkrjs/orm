import { registerCommand } from "../commands/Command.js";
import { makeMigrateCommand } from "./MigrateCommand.js";
import { makeMigrateRollbackCommand } from "./MigrateRollbackCommand.js";
import { makeMigrateResetCommand } from "./MigrateResetCommand.js";
import { makeMigrateRefreshCommand } from "./MigrateRefreshCommand.js";
import { makeMigrateFreshCommand } from "./MigrateFreshCommand.js";
import { makeMigrateStatusCommand } from "./MigrateStatusCommand.js";
import { makeDbSeedCommand } from "./DbSeedCommand.js";
import { makeSchemaDumpCommand } from "./SchemaDumpCommand.js";
import { makeSchemaSquashCommand } from "./SchemaSquashCommand.js";
import { makeTypesGenerateCommand } from "./TypesGenerateCommand.js";
import { makeQueueInstallCommand } from "./QueueInstallCommand.js";
import { makeMakeModelCommand } from "./MakeModelCommand.js";
import { makeMakeMigrationCommand } from "./MakeMigrationCommand.js";
import { makeMakePolicyCommand } from "./MakePolicyCommand.js";
import { makeMakeCommandCommand } from "../commands/cli/index.js";
import { registerSearchCommands } from "../search/commands/index.js";
import { makeMakeJobCommand } from "../queue/commands/index.js";
import type { Connection } from "../connection/Connection.js";
import type { OrmConfig } from "../config/OrmConfig.js";

export function registerOrmCommands(config: OrmConfig, connection: Connection): void {
  registerCommand(makeMigrateCommand(config, connection));
  registerCommand(makeMigrateRollbackCommand(config, connection));
  registerCommand(makeMigrateResetCommand(config, connection));
  registerCommand(makeMigrateRefreshCommand(config, connection));
  registerCommand(makeMigrateFreshCommand(config, connection));
  registerCommand(makeMigrateStatusCommand(config, connection));
  registerCommand(makeDbSeedCommand(config, connection));
  registerCommand(makeSchemaDumpCommand(config, connection));
  registerCommand(makeSchemaSquashCommand(config, connection));
  registerCommand(makeTypesGenerateCommand(config, connection));
  registerCommand(makeQueueInstallCommand(config));
  registerCommand(makeMakeModelCommand(config));
  registerCommand(makeMakeMigrationCommand(config));
  registerCommand(makeMakePolicyCommand(config));
  registerCommand(makeMakeCommandCommand(config));
  if (config.queue) {
    registerCommand(makeMakeJobCommand(config));
  }
  if (config.search) {
    registerSearchCommands(config);
  }
}
