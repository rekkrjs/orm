import { afterEach, describe, expect, test } from "./harness.js";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { makeMakeModelCommand } from "../src/cli/MakeModelCommand.js";
import { makeMakePolicyCommand } from "../src/cli/MakePolicyCommand.js";
import { makeMakeJobCommand } from "../src/queue/commands/MakeJobCommand.js";
import { makeMakeSearchableCommand } from "../src/search/commands/MakeSearchableCommand.js";
import { importFile } from "../src/utils.js";
import type { OrmConfig } from "../src/config/OrmConfig.js";

// Inside the checkout, so the scaffolds' `@rekkr/orm` import resolves to this package.
const cleanup: string[] = [];
afterEach(async () => {
  for (const dir of cleanup.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function scratch(): Promise<string> {
  await mkdir(join(process.cwd(), "tmp_agents"), { recursive: true });
  const dir = await mkdtemp(join(process.cwd(), "tmp_agents", "temp_scaffolds_"));
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

  test("does not replace an existing model or create an unrequested migration", async () => {
    const dir = await scratch();
    const path = join(dir, "User.ts");
    // A migration written by mistake lands in the scratch directory, not the checkout.
    const config = { migrationsPath: join(dir, "migrations") } as unknown as OrmConfig;
    await writeFile(path, "// keep this model\n");
    expect(await run(makeMakeModelCommand, config, "User", { dir }))
      .toEqual([`warn: Skipped: ${path} already exists`]);
    expect(await readFile(path, "utf-8")).toBe("// keep this model\n");
    expect(await readdir(dir)).toEqual(["User.ts"]);
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

  test("does not replace an existing searchable model", async () => {
    const dir = await scratch();
    const path = join(dir, "Category.ts");
    await writeFile(path, "// keep this searchable model\n");
    expect(await run(makeMakeSearchableCommand, {} as OrmConfig, "Category", { dir }))
      .toEqual([`warn: Skipped: ${path} already exists`]);
    expect(await readFile(path, "utf-8")).toBe("// keep this searchable model\n");
    expect(await readdir(dir)).toEqual(["Category.ts"]);
  });
});

describe("make:policy", () => {
  test("creates a policy in the configured directory with the requested model methods", async () => {
    const dir = await scratch();
    const path = join(dir, "ArticlePolicy.ts");
    const config = { policyPath: dir } as OrmConfig;
    expect(await run(makeMakePolicyCommand, config, "article", { model: "Article" }))
      .toEqual([`Created policy: ${path}`]);
    expect(await readdir(dir)).toEqual(["ArticlePolicy.ts"]);
    const source = await readFile(path, "utf-8");
    expect(source).toContain("export default class ArticlePolicy");
    expect(source).toContain("view(user: any, model: Article): boolean");
    expect(source).toContain("update(user: any, model: Article): boolean");
    expect(source).toContain("delete(user: any, model: Article): boolean");
    const Policy = (await importFile(path)).default;
    expect([new Policy().view({}, {}), new Policy().create({}), new Policy().update({}, {}), new Policy().delete({}, {})])
      .toEqual([true, true, true, true]);

    await writeFile(path, "// keep this policy\n");
    expect(await run(makeMakePolicyCommand, config, "ArticlePolicy", {}))
      .toEqual([`warn: Skipped: ${path} already exists`]);
    expect(await readFile(path, "utf-8")).toBe("// keep this policy\n");
  });

  test("types the model as any when no model is given", async () => {
    const dir = await scratch();
    const path = join(dir, "CommentPolicy.ts");
    expect(await run(makeMakePolicyCommand, { policyPath: dir } as OrmConfig, "comment", {}))
      .toEqual([`Created policy: ${path}`]);
    expect(await readdir(dir)).toEqual(["CommentPolicy.ts"]);
    const source = await readFile(path, "utf-8");
    expect(source.startsWith("export default class CommentPolicy {")).toBe(true);
    expect(source).not.toContain("type ");
    for (const method of ["view(user: any, model: any)", "create(user: any)", "update(user: any, model: any)", "delete(user: any, model: any)"]) {
      expect(source).toContain(`${method}: boolean`);
    }
    const Policy = (await importFile(path)).default;
    expect([new Policy().view({}, {}), new Policy().create({}), new Policy().update({}, {}), new Policy().delete({}, {})])
      .toEqual([true, true, true, true]);
  });
});

describe("make:job", () => {
  test("creates and registers a job in the configured directory", async () => {
    const dir = await scratch();
    const path = join(dir, "SendDigestJob.ts");
    const config = { queue: { jobsPath: dir } } as OrmConfig;
    expect(await run(makeMakeJobCommand, config, "send_digest", { queue: "mail" }))
      .toEqual([`Created job: ${path}`]);
    expect(await readdir(dir)).toEqual(["SendDigestJob.ts"]);
    const Job = (await importFile(path)).default;
    // The registry the scaffold's own import reaches: the source on Bun, dist/ on
    // Node.js. Not a static import: the declarations-only typecheck has no package.
    const { resolveJob } = await import("@rekkr/orm/queue" as string);
    expect(resolveJob("SendDigestJob")).toBe(Job);
    expect([Job.queue, Job.maxAttempts, Job.delay]).toEqual(["mail", 3, 0]);
    expect(await new Job().handle()).toBeUndefined();

    await writeFile(path, "// keep this job\n");
    expect(await run(makeMakeJobCommand, config, "SendDigestJob", {}))
      .toEqual([`warn: Skipped: ${path} already exists`]);
    expect(await readFile(path, "utf-8")).toBe("// keep this job\n");
  });
});
