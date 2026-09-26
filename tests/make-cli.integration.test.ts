import { afterAll, beforeAll, describe, expect, ormCli, readText, runProcess, test } from "./harness.js";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "fs/promises";
import { join } from "path";

describe.serial("make commands through orm", () => {
  let project: string;
  let models: string;
  let migrations: string;
  let policies: string;
  let jobs: string;
  let commands: string;

  beforeAll(async () => {
    await mkdir(join(process.cwd(), "tmp_agents"), { recursive: true });
    project = await mkdtemp(join(process.cwd(), "tmp_agents", "make-cli-"));
    models = join(project, "app", "models");
    migrations = join(project, "database", "migrations");
    policies = join(project, "app", "policies");
    jobs = join(project, "src", "jobs");
    commands = join(project, "app", "commands");
    await writeFile(join(project, "orm.config.ts"), `export default {
  connection: { url: ${JSON.stringify(`sqlite://${join(project, "app.sqlite")}`)} },
  queue: { driver: "db" },
  search: { engine: "sqlite" },
};\n`);
  });

  afterAll(async () => {
    await rm(project, { recursive: true, force: true });
  });

  test("each generator is callable and writes only its default files", async () => {
    const run = (args: string[]) => runProcess([...ormCli, ...args], {
      cwd: project,
      env: { ...process.env, NODE_ENV: "test", DATABASE_URL: "" },
    });
    for (const args of [
      ["make:model", "Article", "--migration"],
      ["make:migration", "create_tags_table"],
      ["make:searchable", "Category"],
      ["make:policy", "Article", "--model=Article"],
      ["make:job", "SendDigest", "--queue=mail"],
      ["make:command", "NotifyUsers"],
    ]) {
      expect(await run(args)).toMatchObject({ exitCode: 0, stderr: "" });
    }

    expect((await readdir(models)).sort()).toEqual(["Article.ts", "Category.ts"]);
    expect(await readText(join(models, "Article.ts"))).toContain("export class Article extends Model");
    expect(await readText(join(models, "Category.ts"))).toContain("Search.register(CategoryRecord");

    const migrationFiles = (await readdir(migrations)).sort();
    expect(migrationFiles).toHaveLength(2);
    const articlesMigration = migrationFiles.find((name) => name.endsWith("_create_articles_table.ts"));
    const tagsMigration = migrationFiles.find((name) => name.endsWith("_create_tags_table.ts"));
    expect(articlesMigration).toMatch(/^\d{14}_create_articles_table\.ts$/);
    expect(tagsMigration).toMatch(/^\d{14}_create_tags_table\.ts$/);
    expect(await readText(join(migrations, articlesMigration!))).toContain('Schema.create("articles"');
    expect(await readText(join(migrations, tagsMigration!))).toContain('Schema.create("tags"');

    expect(await readdir(policies)).toEqual(["ArticlePolicy.ts"]);
    expect(await readText(join(policies, "ArticlePolicy.ts"))).toContain("view(user: any, model: Article)");
    expect(await readdir(jobs)).toEqual(["SendDigestJob.ts"]);
    expect(await readText(join(jobs, "SendDigestJob.ts"))).toContain('queue = "mail"');
    expect(await readdir(commands)).toEqual(["NotifyUsersCommand.ts"]);
    expect(await readText(join(commands, "NotifyUsersCommand.ts"))).toContain('signature = "app:notify-users"');
  }, 30_000);
});
