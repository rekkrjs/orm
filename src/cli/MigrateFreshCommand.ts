import { Command } from "../commands/Command.js";
import { parseTargetFromOptions, runConfiguredMigrationCommand } from "./MigrationHelpers.js";
import type { Connection } from "../connection/Connection.js";
import type { OrmConfig } from "../config/OrmConfig.js";

export function makeMigrateFreshCommand(config: OrmConfig, connection: Connection) {
  return class extends Command.define("migrate:fresh {--landlord : Run on landlord connection} {--tenants : Run on all tenants} {--tenant= : Run on a specific tenant} {--types : Generate types after migration} {--json : Print {\"applied\":[...]} on stdout, progress on stderr}") {
    static description = "Drop all tables and rerun all migrations.";
    async handle() {
      await runConfiguredMigrationCommand("migrate:fresh", config, connection, parseTargetFromOptions(this), {
        generateTypes: !!this.option("types"),
        json: !!this.option("json"),
      });
    }
  };
}
