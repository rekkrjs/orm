import { Command } from "../../commands/Command.js";
import { normalizePathList } from "../../utils.js";
import { getModelPaths } from "../../cli/MigrationHelpers.js";
import { mkdir, writeFile, access } from "fs/promises";
import { join } from "path";
import type { OrmConfig } from "../../config/OrmConfig.js";

function toClassName(name: string): string {
  return name
    .split(/[_\-\s]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

function snakeCase(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
}

function buildStub(className: string): string {
  const table = snakeCase(className) + "s";
  return [
    `import { Model } from "@rekkr/orm";`,
    `import { Search } from "@rekkr/orm/search";`,
    ``,
    `export interface ${className}Attributes {`,
    `  id: number;`,
    `  // TODO: add searchable fields`,
    `  created_at: string;`,
    `  updated_at: string;`,
    `}`,
    ``,
    `class _${className} extends Model.define<${className}Attributes>("${table}") {`,
    `  static fillable: string[] = [];`,
    `}`,
    ``,
    `export const ${className} = Search.define(_${className}, {`,
    `  index: "${table}",`,
    `  // settings: {`,
    `  //   filterableAttributes: [],`,
    `  //   sortableAttributes: ["created_at"],`,
    `  //   searchableAttributes: [],`,
    `  // },`,
    `  // toSearchableArray: (m) => m.toJSON(),`,
    `  // shouldBeSearchable: (m) => true,`,
    `});`,
    ``,
    `export type ${className}Instance = InstanceType<typeof ${className}>;`,
    `export default ${className};`,
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
    static description = "Scaffold a searchable model wired up with Search.define().";

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
