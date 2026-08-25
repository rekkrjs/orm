import { Command } from "../commands/Command.js";
import { MigrationCreator } from "../migration/MigrationCreator.js";
import { normalizePathList, pluralize, snakeCase } from "../utils.js";
import { getDefaultMigrationsPath, getModelPaths } from "./MigrationHelpers.js";
import { mkdir, writeFile, access } from "fs/promises";
import { join } from "path";
import type { OrmConfig } from "../config/OrmConfig.js";

function toTableName(modelName: string): string {
  const snake = snakeCase(modelName.replace(/Model$/i, ""));
  const lastWord = snake.split("_").pop()!;
  const pluralized = pluralize(lastWord);
  return snake.slice(0, snake.length - lastWord.length) + pluralized;
}

function toClassName(name: string): string {
  return name
    .split(/[_\-\s]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

function buildModelStub(className: string, tableName: string): string {
  return `import { Model } from "@rekkr/orm";

interface ${className}Attributes {
  id: number;
  created_at: Date;
  updated_at: Date;
}

export class ${className} extends Model.define<${className}Attributes>("${tableName}") {}
`;
}

function buildMigrationStub(tableName: string): string {
  return `import { Migration, Schema } from "@rekkr/orm";

export default class Create${tableName
  .split("_")
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
  .join("")}Table extends Migration {
  async up(): Promise<void> {
    await Schema.create("${tableName}", (table) => {
      table.increments("id");
      table.timestamps();
    });
  }

  async down(): Promise<void> {
    await Schema.dropIfExists("${tableName}");
  }
}
`;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false);
}

export function makeMakeModelCommand(config: OrmConfig) {
  return class extends Command.define("make:model {name : Model class name} {--migration : Also create a migration file} {--m : Alias for --migration} {--dir= : Directory to create the model in}") {
    static description = "Create a new model file.";

    async handle() {
      const rawName   = this.argument("name");
      const className = toClassName(rawName);
      const tableName = toTableName(rawName);
      const withMigration = this.option("migration") || this.option("m");

      // Resolve models dir
      const { landlord } = getModelPaths(config);
      const modelsDir = (this.option("dir") as string | undefined)
        ?? (landlord ? normalizePathList(landlord)[0] : undefined)
        ?? "./app/models";

      await mkdir(modelsDir, { recursive: true });

      const modelPath = join(modelsDir, `${className}.ts`);
      if (await exists(modelPath)) {
        this.warn(`Skipped: ${modelPath} already exists`);
      } else {
        await writeFile(modelPath, buildModelStub(className, tableName), "utf-8");
        this.info(`Created model: ${modelPath}`);
      }

      // Migration
      if (withMigration) {
        const migrationRoots = normalizePathList(config.migrationsPath || config.migrations?.landlord);
        const migrationDir   = migrationRoots[0] ?? String(getDefaultMigrationsPath(config));
        const creator        = new MigrationCreator();
        const migrationPath  = await creator.createWithContent(
          `create_${tableName}_table`,
          migrationDir,
          buildMigrationStub(tableName),
        );
        this.info(`Created migration: ${migrationPath}`);
      }
    }
  };
}
