import { Command } from "../commands/Command.js";
import { confirmProductionMigration, parseTargetFromOptions, runConfiguredMigrationCommand } from "./MigrationHelpers.js";
import type { Connection } from "../connection/Connection.js";
import type { OrmConfig } from "../config/OrmConfig.js";

export function makeMigrateCommand(config: OrmConfig, connection: Connection) {
  return class extends Command.define("migrate {--landlord : Run on landlord connection} {--tenants : Run on all tenants} {--tenant= : Run on a specific tenant} {--types : Generate types after migration} {--allow-changed : Migrate even if applied migration files have changed} {--pretend : Print pending migration SQL without running it} {--force : Run without confirmation in production} {--json : Print one JSON result on stdout, progress on stderr}") {
    static description = "Run pending migrations.";
    async handle() {
      const pretend = !!this.option("pretend");
      if (!await confirmProductionMigration(this, pretend)) return;
      await runConfiguredMigrationCommand("migrate", config, connection, parseTargetFromOptions(this), {
        generateTypes: !!this.option("types"),
        allowChanged: !!this.option("allow-changed"),
        pretend,
        json: !!this.option("json"),
      });
    }
  };
}
