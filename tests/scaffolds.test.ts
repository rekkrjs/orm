import { afterEach, describe, expect, test } from "./harness.js";
import { mkdtemp, readFile, readdir, rm } from "fs/promises";
import { join } from "path";
import { makeMakeModelCommand } from "../src/cli/MakeModelCommand.js";
import { makeMakeSearchableCommand } from "../src/search/commands/MakeSearchableCommand.js";
import { importFile } from "../src/utils.js";
import type { OrmConfig } from "../src/config/OrmConfig.js";

// Inside the checkout, so the scaffolds' `@rekkr/orm` import resolves to this package.
const cleanup: string[] = [];
afterEach(async () => {
  for (const dir of cleanup.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(process.cwd(), "tests", "temp_scaffolds_"));
  cleanup.push(dir);
  return dir;
}

async function run(factory: (config: OrmConfig) => any, config: OrmConfig, name: string, options: Record<string, unknown>) {
  const command = new (factory(config))();
  command._parsedArgs = { name };
  command._parsedOptions = options;
  const messages: string[] = [];
  command.info = (message: string) => messages.push(message);
  command.warn = (message: string) => messages.push(`warn: ${message}`);
  await command.handle();
  return messages;
}

describe("make:model", () => {
  // The migration creates the table make:model names; the model has to read
  // that same table, whether or not it matches the model's own convention.
  test("scaffolds a plain model that reads the table its migration creates", async () => {
    const dir = await scratch();
    const migrations = join(dir, "migrations");
    const config = { migrationsPath: migrations } as unknown as OrmConfig;

    for (const [name, table] of [["User", "users"], ["Category", "categories"], ["Status", "statuses"]] as const) {
      await run(makeMakeModelCommand, config, name, { dir, migration: true });

      const source = await readFile(join(dir, `${name}.ts`), "utf-8");
      expect(source).not.toContain("interface");
      expect(source).not.toContain("Model.define");
      expect(source).toContain(`export class ${name} extends Model {`);

      const [migration] = (await readdir(migrations)).filter((file) => file.endsWith(`_create_${table}_table.ts`));
      expect(await readFile(join(migrations, migration!), "utf-8")).toContain(`Schema.create("${table}"`);
      const model = (await importFile(join(dir, `${name}.ts`)))[name];
      expect(model.getTable()).toBe(table);
    }

    // Only a table the convention would get wrong is named in the class.
    expect(await readFile(join(dir, "User.ts"), "utf-8")).not.toContain("static override table");
    expect(await readFile(join(dir, "Category.ts"), "utf-8")).toContain('static override table = "categories";');
  });
});

describe("make:searchable", () => {
  test("scaffolds a named model class registered for search", async () => {
    const dir = await scratch();

    expect(await run(makeMakeSearchableCommand, {} as OrmConfig, "Category", { dir }))
      .toEqual([`Created searchable model: ${join(dir, "Category.ts")}`]);

    const source = await readFile(join(dir, "Category.ts"), "utf-8");
    expect(source).not.toContain("interface");
    expect(source).not.toContain("export default");
    const scaffold = await importFile(join(dir, "Category.ts"));
    expect(scaffold.Category).toBe(scaffold.CategoryRecord);
    expect(scaffold.CategoryRecord.getTable()).toBe("categories");
    expect(scaffold.Category.searchableAs()).toBe("categories");
    expect(scaffold.Category.searchFtsConfig).toBeUndefined();
  });
});
