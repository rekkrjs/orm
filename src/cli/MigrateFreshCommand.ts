import { Command } from "../commands/Command.js";
import { confirmProductionMigration, parseTargetFromOptions, runConfiguredMigrationCommand, runMigrationWithSeeding } from "./MigrationHelpers.js";
import type { Connection } from "../connection/Connection.js";
import type { OrmConfig } from "../config/OrmConfig.js";

export function makeMigrateFreshCommand(config: OrmConfig, connection: Connection) {
  return class extends Command.define("migrate:fresh {--landlord : Run on landlord connection} {--tenants : Run on all tenants} {--tenant= : Run on a specific tenant} {--types : Generate types after migration} {--seed : Run database seeders after migration} {--seeder= : Run a specific seeder (requires --seed)} {--force : Run without confirmation in production} {--json : Print one JSON result on stdout, progress on stderr}") {
    static description = "Drop all tables and rerun all migrations.";
    async handle() {
      const seed = !!this.option("seed");
      const seeder = this.option("seeder") as string | undefined;
      if (seeder !== undefined && !seed) throw new Error("--seeder requires --seed.");
      if (!await confirmProductionMigration(this)) return;

      const scope = parseTargetFromOptions(this);
      const options = {
        generateTypes: !!this.option("types"),
        json: !!this.option("json"),
      };
      if (seed) {
        await runMigrationWithSeeding("migrate:fresh", this, config, connection, scope, options, seeder);
      } else {
        await runConfiguredMigrationCommand("migrate:fresh", config, connection, scope, options);
      }
    }
  };
}
