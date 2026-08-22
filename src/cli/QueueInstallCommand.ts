import { Command } from "../commands/Command.js";
import { MigrationCreator } from "../migration/MigrationCreator.js";
import { normalizePathList } from "../utils.js";
import { getDefaultMigrationsPath, getModelPaths } from "./MigrationHelpers.js";
import { mkdir, writeFile, access } from "fs/promises";
import { join } from "path";
import type { OrmConfig } from "../config/OrmConfig.js";

/**
 * The driver reads `queue.table` / `queue.failedTable`, so the generated schema
 * has to follow the config — a hardcoded stub silently creates tables the
 * worker never looks at.
 */
function buildMigrationStub(jobsTable: string, failedTable: string): string {
  const className = `Create${pascalCase(jobsTable)}Tables`;
  return `import { Migration, Schema } from "@rekkr/orm";

export default class ${className} extends Migration {
  async up(): Promise<void> {
    await Schema.create(${JSON.stringify(jobsTable)}, (table) => {
      table.bigIncrements("id");
      table.string("queue").index();
      table.string("job_class", 512);
      table.text("payload");
      table.smallInteger("attempts").unsigned();
      table.smallInteger("max_attempts").unsigned();
      table.integer("available_at").unsigned();
      table.integer("reserved_at").unsigned().nullable();
      table.integer("created_at").unsigned();
    });

    await Schema.create(${JSON.stringify(failedTable)}, (table) => {
      table.bigIncrements("id");
      table.string("queue");
      table.string("job_class", 512);
      table.text("payload");
      table.text("exception");
      table.integer("failed_at").unsigned();
    });
  }

  async down(): Promise<void> {
    await Schema.dropIfExists(${JSON.stringify(failedTable)});
    await Schema.dropIfExists(${JSON.stringify(jobsTable)});
  }
}
`;
}

function pascalCase(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

const JOB_MODEL_STUB_TEMPLATE = `import { Model } from "@rekkr/orm";

interface JobAttributes {
  id: number;
  queue: string;
  job_class: string;
  payload: string;
  attempts: number;
  max_attempts: number;
  available_at: number;
  reserved_at: number | null;
  created_at: number;
}

export class Job extends Model.define<JobAttributes>(__JOBS_TABLE__) {
  static timestamps = false;
}
`;

const FAILED_JOB_MODEL_STUB_TEMPLATE = `import { Model } from "@rekkr/orm";

interface FailedJobAttributes {
  id: number;
  queue: string;
  job_class: string;
  payload: string;
  exception: string;
  failed_at: number;
}

export class FailedJob extends Model.define<FailedJobAttributes>(__FAILED_TABLE__) {
  static timestamps = false;
}
`;

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false);
}

export function makeQueueInstallCommand(config: OrmConfig) {
  return class extends Command.define("queue:install {dir? : Migration output directory} {--models= : Directory to create job models in}") {
    static description = "Generate the jobs and failed_jobs migration and optional models.";

    async handle() {
      const jobsTable   = config.queue?.table ?? "jobs";
      const failedTable = config.queue?.failedTable ?? "failed_jobs";

      const migrationRoots = normalizePathList(config.migrationsPath || config.migrations?.landlord);
      const migrationDir = this.argumentOptional("dir")
        ?? migrationRoots[0]
        ?? String(getDefaultMigrationsPath(config));

      if (jobsTable !== "jobs" || failedTable !== "failed_jobs") {
        this.info(`Using configured queue tables: ${jobsTable}, ${failedTable}`);
      }

      // Migration
      const creator = new MigrationCreator();
      const migrationPath = await creator.createWithContent(
        `create_${jobsTable}_tables`,
        migrationDir,
        buildMigrationStub(jobsTable, failedTable),
      );
      this.info(`Created migration: ${migrationPath}`);

      // Models — use --models flag, fall back to config modelsPath (landlord), skip if neither
      const { landlord } = getModelPaths(config);
      const modelsFlag   = this.option("models") as string | undefined;
      const modelsDir    = modelsFlag ?? (landlord ? normalizePathList(landlord)[0] : undefined);

      if (modelsDir) {
        await mkdir(modelsDir, { recursive: true });

        const jobPath = join(modelsDir, "Job.ts");
        if (await exists(jobPath)) {
          this.warn(`Skipped: ${jobPath} already exists`);
        } else {
          await writeFile(jobPath, JOB_MODEL_STUB_TEMPLATE.replace("__JOBS_TABLE__", JSON.stringify(jobsTable)), "utf-8");
          this.info(`Created model: ${jobPath}`);
        }

        const failedJobPath = join(modelsDir, "FailedJob.ts");
        if (await exists(failedJobPath)) {
          this.warn(`Skipped: ${failedJobPath} already exists`);
        } else {
          await writeFile(failedJobPath, FAILED_JOB_MODEL_STUB_TEMPLATE.replace("__FAILED_TABLE__", JSON.stringify(failedTable)), "utf-8");
          this.info(`Created model: ${failedJobPath}`);
        }
      }
    }
  };
}
