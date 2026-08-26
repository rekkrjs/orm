import { Command } from "../commands/Command.js";
import { parseTargetFromOptions, runSeederCommand } from "./MigrationHelpers.js";
import type { Connection } from "../connection/Connection.js";
import type { OrmConfig } from "../config/OrmConfig.js";

export function makeDbSeedCommand(config: OrmConfig, connection: Connection) {
  return class extends Command.define("db:seed {seeder? : Seeder class name to run} {--landlord : Run on landlord connection} {--tenants : Run on all tenants} {--tenant= : Run on a specific tenant} {--force : Run without confirmation in production}") {
    static description = "Run database seeders.";
    async handle() {
      if (
        process.env.NODE_ENV === "production" &&
        !this.option("force") &&
        !await this.confirm("Application is in production. Run database seeders?", false)
      ) {
        this.warn("Database seeding cancelled.");
        process.exitCode = 1;
        return;
      }
      const seeder = this.argumentOptional("seeder");
      const scope  = parseTargetFromOptions(this);
      await runSeederCommand(config, connection, scope, seeder);
    }
  };
}
