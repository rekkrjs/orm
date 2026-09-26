import { afterAll, beforeAll, describe, expect, ormCli, ormModule, readText, runProcess, test } from "./harness.js";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { pathToFileURL } from "url";
import { Connection } from "../src/connection/Connection.js";

describe.serial("schema CLI commands", () => {
  let project: string;
  let database: string;
  let migration: string;

  const run = (args: string[]) => runProcess([...ormCli, ...args], {
    cwd: project,
    env: { ...process.env, NODE_ENV: "test" },
  });

  beforeAll(async () => {
    await mkdir(join(process.cwd(), "tmp_agents"), { recursive: true });
    project = await mkdtemp(join(process.cwd(), "tmp_agents", "schema-commands-"));
    database = join(project, "app.sqlite");
    const migrations = join(project, "migrations");
    migration = "20260926000000_create_schema_cli_items.ts";
    await mkdir(migrations);
    await writeFile(join(project, "orm.config.ts"), `export default {
  connection: { url: ${JSON.stringify(`sqlite://${database}`)} },
  migrationsPath: ${JSON.stringify(migrations)},
};\n`);
    await writeFile(join(migrations, migration), `import { Migration, Schema } from ${JSON.stringify(pathToFileURL(ormModule("src/index.ts")).href)};
export default class CreateSchemaCliItems extends Migration {
  async up() { await Schema.create("schema_cli_items", table => { table.increments("id"); table.string("name"); }); }
  async down() { await Schema.dropIfExists("schema_cli_items"); }
}\n`);
  });

  afterAll(async () => {
    await rm(project, { recursive: true, force: true });
  });

  test("schema:dump writes SQL without changing migration state; schema:squash records a new baseline", async () => {
    expect(await run(["migrate"])).toMatchObject({ exitCode: 0, stderr: "" });
    const connection = new Connection({ url: `sqlite://${database}` });
    try {
      const before = await connection.query("SELECT migration, batch FROM migrations ORDER BY migration");
      expect(before).toEqual([{ migration: `migrations/${migration}`, batch: 1 }]);

      const dumpPath = join(project, "dump", "schema.sql");
      expect(await run(["schema:dump", dumpPath])).toMatchObject({
        exitCode: 0,
        stderr: "",
        stdout: expect.stringContaining(`Schema dumped to ${dumpPath}`),
      });
      const dump = await readText(dumpPath);
      expect(dump).toContain("CREATE TABLE");
      expect(dump).toContain("schema_cli_items");
      expect(await connection.query("SELECT migration, batch FROM migrations ORDER BY migration")).toEqual(before);

      const squashPath = join(project, "baseline", "schema.sql");
      expect(await run(["schema:squash", squashPath])).toMatchObject({
        exitCode: 0,
        stderr: "",
        stdout: expect.stringContaining(`Schema squashed to ${squashPath}`),
      });
      expect(await readText(squashPath)).toBe(dump);
      expect(await connection.query("SELECT migration, batch FROM migrations ORDER BY migration"))
        .toEqual([{ migration: `migrations/${migration}`, batch: 2 }]);
      expect(await connection.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_cli_items'"))
        .toEqual([{ name: "schema_cli_items" }]);
      expect(await run(["migrate"])).toMatchObject({ exitCode: 0, stderr: "" });
      expect(await connection.query("SELECT migration, batch FROM migrations ORDER BY migration"))
        .toEqual([{ migration: `migrations/${migration}`, batch: 2 }]);
    } finally {
      await connection.close();
    }
  });
});
