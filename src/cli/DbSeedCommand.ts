import { Command } from "../commands/Command.js";
import { parseTargetFromOptions, runDbSeedCommand } from "./MigrationHelpers.js";
import type { Connection } from "../connection/Connection.js";
import type { OrmConfig } from "../config/OrmConfig.js";

export function makeDbSeedCommand(config: OrmConfig, connection: Connection) {
  return class extends Command.define("db:seed {seeder? : Seeder class name to run} {--landlord : Run on landlord connection} {--tenants : Run on all tenants} {--tenant= : Run on a specific tenant} {--force : Run without confirmation in production}") {
    static description = "Run database seeders.";
    async handle() {
      await runDbSeedCommand(
        this,
        config,
        connection,
        parseTargetFromOptions(this),
        this.argumentOptional("seeder"),
      );
    }
  };
}
