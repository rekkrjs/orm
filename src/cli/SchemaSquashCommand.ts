import { Command } from "../commands/Command.js";
import { buildMigrator, getDefaultMigrationsPath } from "./MigrationHelpers.js";
import type { Connection } from "../connection/Connection.js";
import type { OrmConfig } from "../config/OrmConfig.js";

export function makeSchemaSquashCommand(config: OrmConfig, connection: Connection) {
  return class extends Command.define("schema:squash {path? : Schema file path to squash from}") {
    static description = "Dump the schema and mark all migrations as run.";
    async handle() {
      const outputPath = this.argumentOptional("path") ?? "./database/schema.sql";
      const migrator   = buildMigrator(config, connection, getDefaultMigrationsPath(config), "landlord");
      await migrator.squash(outputPath);
      this.info(`Schema squashed to ${outputPath}`);
    }
  };
}
