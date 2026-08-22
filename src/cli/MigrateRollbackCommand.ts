import { Command } from "../commands/Command.js";
import { parseStepsOption, parseTargetFromOptions, runConfiguredMigrationCommand } from "./MigrationHelpers.js";
import type { Connection } from "../connection/Connection.js";
import type { OrmConfig } from "../config/OrmConfig.js";

export function makeMigrateRollbackCommand(config: OrmConfig, connection: Connection) {
  return class extends Command.define("migrate:rollback {--step= : How many batches to roll back (default 1)} {--steps= : Alias of --step} {--landlord : Run on landlord connection} {--tenants : Run on all tenants} {--tenant= : Run on a specific tenant} {--types : Generate types after rollback} {--json : Print {\"rolledBack\":[...]} on stdout, progress on stderr}") {
    static description = "Rollback the last batch of migrations.";
    async handle() {
      await runConfiguredMigrationCommand("migrate:rollback", config, connection, parseTargetFromOptions(this), {
        generateTypes: !!this.option("types"),
        steps: parseStepsOption(this.option("step") ?? this.option("steps")),
        json: !!this.option("json"),
      });
    }
  };
}
