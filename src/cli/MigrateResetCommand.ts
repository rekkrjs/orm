import { Command } from "../commands/Command.js";
import { confirmProductionMigration, parseTargetFromOptions, runConfiguredMigrationCommand } from "./MigrationHelpers.js";
import type { Connection } from "../connection/Connection.js";
import type { OrmConfig } from "../config/OrmConfig.js";

export function makeMigrateResetCommand(config: OrmConfig, connection: Connection) {
  return class extends Command.define("migrate:reset {--landlord : Run on landlord connection} {--tenants : Run on all tenants} {--tenant= : Run on a specific tenant} {--types : Generate types after reset} {--force : Run without confirmation in production} {--json : Print {\"rolledBack\":[...]} on stdout, progress on stderr}") {
    static description = "Rollback all migrations.";
    async handle() {
      if (!await confirmProductionMigration(this)) return;
      await runConfiguredMigrationCommand("migrate:reset", config, connection, parseTargetFromOptions(this), {
        generateTypes: !!this.option("types"),
        json: !!this.option("json"),
      });
    }
  };
}
