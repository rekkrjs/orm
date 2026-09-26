import { Command } from "../../commands/Command.js";
import { normalizePathList } from "../../utils.js";
import { getModelPaths } from "../../cli/MigrationHelpers.js";
import { toClassName, toTableName } from "../../cli/MakeModelCommand.js";
import { mkdir, writeFile, access } from "fs/promises";
import { join } from "path";
import type { OrmConfig } from "../../config/OrmConfig.js";

export function buildStub(className: string): string {
  const table = toTableName(className);
  return [
    `import { Model } from "@rekkr/orm";`,
    `import { Search } from "@rekkr/orm/search";`,
    ``,
    `// Attribute types come from \`orm types:generate\` once the table exists.`,
    `export class ${className}Record extends Model {`,
    `  static override table = "${table}";`,
    `  static override fillable: string[] = [];`,
    `}`,
    ``,
    `export const ${className} = Search.register(${className}Record, {`,
    `  index: "${table}",`,
    `  // Optional. Without fts the index covers the table: text columns are searched.`,
    `  // fts: { columns: ["title", "body"], unindexed: ["status"] },`,
    `  // toSearchableArray: (m) => m.toJSON(),`,
    `  // shouldBeSearchable: (m) => true,`,
    `});`,
    ``,
    `export type ${className}Instance = InstanceType<typeof ${className}>;`,
    ``,
  ].join("\n");
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true).catch(() => false);
}

export function makeMakeSearchableCommand(config: OrmConfig) {
  return class extends Command.define(
    "make:searchable {name : Model class name} {--dir= : Directory to create the model in}",
  ) {
    static description = "Scaffold a searchable model wired up with Search.register().";

    async handle() {
      const className = toClassName(this.argument("name"));
      const { landlord } = getModelPaths(config);
      const modelsDir = (this.option("dir") as string | undefined)
        ?? (landlord ? normalizePathList(landlord)[0] : undefined)
        ?? "./app/models";

      await mkdir(modelsDir, { recursive: true });

      const modelPath = join(modelsDir, `${className}.ts`);
      if (await exists(modelPath)) {
        this.warn(`Skipped: ${modelPath} already exists`);
        return;
      }
      await writeFile(modelPath, buildStub(className), "utf-8");
      this.info(`Created searchable model: ${modelPath}`);
    }
  };
}
