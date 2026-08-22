import { Command } from "../commands/Command.js";
import { buildMigrator, getDefaultMigrationsPath } from "./MigrationHelpers.js";
import type { Connection } from "../connection/Connection.js";
import type { OrmConfig } from "../config/OrmConfig.js";

export function makeSchemaDumpCommand(config: OrmConfig, connection: Connection) {
  return class extends Command.define("schema:dump {path? : Output file path}") {
    static description = "Dump the current database schema to a SQL file.";
    async handle() {
      const outputPath = this.argumentOptional("path") ?? "./database/schema.sql";
      const migrator   = buildMigrator(config, connection, getDefaultMigrationsPath(config), "landlord");
      await migrator.dumpSchema(outputPath);
      this.info(`Schema dumped to ${outputPath}`);
    }
  };
}
