import { Command } from "../commands/Command.js";
import { parseTargetFromOptions, runConfiguredMigrationCommand } from "./MigrationHelpers.js";
import type { Connection } from "../connection/Connection.js";
import type { OrmConfig } from "../config/OrmConfig.js";

export function makeMigrateCommand(config: OrmConfig, connection: Connection) {
  return class extends Command.define("migrate {--landlord : Run on landlord connection} {--tenants : Run on all tenants} {--tenant= : Run on a specific tenant} {--types : Generate types after migration} {--allow-changed : Migrate even if applied migration files have changed} {--json : Print {\"applied\":[...]} on stdout, progress on stderr}") {
    static description = "Run pending migrations.";
    async handle() {
      await runConfiguredMigrationCommand("migrate", config, connection, parseTargetFromOptions(this), {
        generateTypes: !!this.option("types"),
        allowChanged: !!this.option("allow-changed"),
        json: !!this.option("json"),
      });
    }
  };
}
