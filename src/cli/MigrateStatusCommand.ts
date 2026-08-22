import { Command } from "../commands/Command.js";
import { parseTargetFromOptions, runConfiguredMigrationCommand } from "./MigrationHelpers.js";
import type { Connection } from "../connection/Connection.js";
import type { OrmConfig } from "../config/OrmConfig.js";

export function makeMigrateStatusCommand(config: OrmConfig, connection: Connection) {
  return class extends Command.define("migrate:status {--landlord : Run on landlord connection} {--tenants : Run on all tenants} {--tenant= : Run on a specific tenant} {--json : Print {\"migrations\":[...]} on stdout instead of a table}") {
    static description = "Show the status of all migrations.";
    async handle() {
      await runConfiguredMigrationCommand("migrate:status", config, connection, parseTargetFromOptions(this), {
        json: !!this.option("json"),
      });
    }
  };
}
