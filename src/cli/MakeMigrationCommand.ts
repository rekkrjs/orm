import { Command } from "../commands/Command.js";
import { MigrationCreator } from "../migration/MigrationCreator.js";
import { normalizePathList, pluralize, snakeCase } from "../utils.js";
import { getDefaultMigrationsPath, getModelPaths } from "./MigrationHelpers.js";
import { mkdir, writeFile, access } from "fs/promises";
import { join } from "path";
import type { OrmConfig } from "../config/OrmConfig.js";

function toClassName(name: string): string {
  return name
    .split(/[_\-\s]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

function inferTableName(migrationName: string): string | undefined {
  const snake = snakeCase(migrationName);
  const createMatch = snake.match(/^create_(.+?)(?:_table)?$/);
  if (createMatch) return createMatch[1];
  return undefined;
}

function buildMigrationStub(className: string, tableName?: string): string {
  if (tableName) {
    return `import { Migration, Schema } from "@rekkr/orm";

export default class ${className} extends Migration {
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

  return `import { Migration, Schema } from "@rekkr/orm";

export default class ${className} extends Migration {
  async up(): Promise<void> {
    //
  }

  async down(): Promise<void> {
    //
  }
}
`;
}

function buildModelStub(modelClass: string, tableName: string): string {
  return `import { Model } from "@rekkr/orm";

interface ${modelClass}Attributes {
  id: number;
  created_at: string;
  updated_at: string;
}

export class ${modelClass} extends Model.define<${modelClass}Attributes>("${tableName}") {}
`;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false);
}

export function makeMakeMigrationCommand(config: OrmConfig) {
  return class extends Command.define("make:migration {name : Migration name e.g. create_users_table} {--model : Also create a model file} {--m : Alias for --model} {--dir= : Directory to create the migration in} {--models-dir= : Directory to create the model in}") {
    static description = "Create a new migration file.";

    async handle() {
      const name         = this.argument("name");
      const withModel    = this.option("model") || this.option("m");
      const className    = toClassName(name);
      const tableName    = inferTableName(name);

      const migrationRoots = normalizePathList(config.migrationsPath || config.migrations?.landlord);
      const migrationDir   = (this.option("dir") as string | undefined)
        ?? migrationRoots[0]
        ?? String(getDefaultMigrationsPath(config));

      const creator       = new MigrationCreator();
      const migrationPath = await creator.createWithContent(name, migrationDir, buildMigrationStub(className, tableName));
      this.info(`Created migration: ${migrationPath}`);

      if (withModel && tableName) {
        const lastWord    = tableName.split("_").pop()!;
        const pluralized  = pluralize(lastWord);
        const pluralTable = tableName.slice(0, tableName.length - lastWord.length) + pluralized;
        const modelClass  = toClassName(pluralTable.split("_").map((w) => w.slice(0, 1).toUpperCase() + w.slice(1)).join("_")).replace(/s$/, "");

        const { landlord } = getModelPaths(config);
        const modelsDir    = (this.option("models-dir") as string | undefined)
          ?? (landlord ? normalizePathList(landlord)[0] : undefined)
          ?? "./app/models";
        await mkdir(modelsDir, { recursive: true });

        const modelPath = join(modelsDir, `${modelClass}.ts`);
        if (await exists(modelPath)) {
          this.warn(`Skipped: ${modelPath} already exists`);
        } else {
          await writeFile(modelPath, buildModelStub(modelClass, pluralTable), "utf-8");
          this.info(`Created model: ${modelPath}`);
        }
      } else if (withModel && !tableName) {
        this.warn("Could not infer table name from migration name. Use create_<table>_table format for --model to work.");
      }
    }
  };
}
