import { Command } from "../commands/Command.js";
import { confirmProductionMigration, parseStepsOption, parseTargetFromOptions, runConfiguredMigrationCommand } from "./MigrationHelpers.js";
import type { Connection } from "../connection/Connection.js";
import type { OrmConfig } from "../config/OrmConfig.js";

export function makeMigrateRollbackCommand(config: OrmConfig, connection: Connection) {
  return class extends Command.define("migrate:rollback {--step= : How many batches to roll back (default 1)} {--landlord : Run on landlord connection} {--tenants : Run on all tenants} {--tenant= : Run on a specific tenant} {--types : Generate types after rollback} {--pretend : Print rollback SQL without running it} {--force : Run without confirmation in production} {--json : Print one JSON result on stdout, progress on stderr}") {
    static description = "Rollback the last batch of migrations.";
    async handle() {
      const pretend = !!this.option("pretend");
      if (!await confirmProductionMigration(this, pretend)) return;
      await runConfiguredMigrationCommand("migrate:rollback", config, connection, parseTargetFromOptions(this), {
        generateTypes: !!this.option("types"),
        steps: parseStepsOption(this.option("step")),
        pretend,
        json: !!this.option("json"),
      });
    }
  };
}
