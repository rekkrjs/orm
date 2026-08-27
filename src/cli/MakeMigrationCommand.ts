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

type MigrationInference = { kind: "create" | "alter"; table: string };

function inferMigration(migrationName: string): MigrationInference | undefined {
  const snake = snakeCase(migrationName);
  const createMatch = snake.match(/^create_(.+?)(?:_table)?$/);
  if (createMatch) return { kind: "create", table: createMatch[1] };
  const alterMatch = snake.match(/^add_.+_to_(.+?)_table$/);
  if (alterMatch) return { kind: "alter", table: alterMatch[1] };
  return undefined;
}

function buildMigrationStub(className: string, inference?: MigrationInference): string {
  if (inference?.kind === "create") {
    return `import { Migration, Schema } from "@rekkr/orm";

export default class ${className} extends Migration {
  async up(): Promise<void> {
    await Schema.create("${inference.table}", (table) => {
      table.increments("id");
      table.timestamps();
    });
  }

  async down(): Promise<void> {
    await Schema.dropIfExists("${inference.table}");
  }
}
`;
  }

  if (inference?.kind === "alter") {
    return `import { Migration, Schema } from "@rekkr/orm";

export default class ${className} extends Migration {
  async up(): Promise<void> {
    await Schema.table("${inference.table}", (table) => {
      //
    });
  }

  async down(): Promise<void> {
    await Schema.table("${inference.table}", (table) => {
      //
    });
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
  created_at: Date;
  updated_at: Date;
}

export class ${modelClass} extends Model.define<${modelClass}Attributes>("${tableName}") {}
`;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false);
}

export function makeMakeMigrationCommand(config: OrmConfig) {
  return class extends Command.define("make:migration {name : Migration name e.g. create_users_table} {--model : Also create a model for create_<table>_table migrations} {--m : Alias for --model} {--dir= : Directory to create the migration in} {--models-dir= : Directory to create the model in}") {
    static description = "Create a new migration file.";

    async handle() {
      const name         = this.argument("name");
      const withModel    = this.option("model") || this.option("m");
      const className    = toClassName(name);
      const inference    = inferMigration(name);

      const migrationRoots = normalizePathList(config.migrationsPath || config.migrations?.landlord);
      const migrationDir   = (this.option("dir") as string | undefined)
        ?? migrationRoots[0]
        ?? String(getDefaultMigrationsPath(config));

      const creator       = new MigrationCreator();
      const migrationPath = await creator.createWithContent(name, migrationDir, buildMigrationStub(className, inference));
      this.info(`Created migration: ${migrationPath}`);

      if (withModel && inference?.kind === "create") {
        const tableName   = inference.table;
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
      } else if (withModel) {
        this.warn("--model only applies to create_<table>_table migrations.");
      }
    }
  };
}
