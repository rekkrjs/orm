import { describe, test, expect, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { pathToFileURL } from "url";
import { buildOrmConfigTemplate } from "../src/cli/configTemplate.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const base = {
  databaseUrl: "sqlite://./database/app.db",
  migrationsPath: "./database/migrations",
  seedersPath: "./database/seeders",
  modelsPath: "./app/models",
  commandsPath: "./app/commands",
  enableTenancy: false,
  enableSearch: false,
  enableQueue: false,
  enableCache: false,
  enableLogs: false,
};

/** Writes the generated config and imports it, which is what `orm` does. */
async function importGenerated(source: string): Promise<any> {
  const dir = await mkdtemp(join(tmpdir(), "orm-config-template-"));
  dirs.push(dir);
  const file = join(dir, "orm.config.ts");
  await writeFile(file, source, "utf-8");
  return (await import(pathToFileURL(file).href)).default;
}

describe("orm init config template", () => {
  test("round-trips ordinary answers", async () => {
    const config = await importGenerated(buildOrmConfigTemplate(base));
    expect(config.migrationsPath).toBe("./database/migrations");
    expect(config.modelsPath).toBe("./app/models");
    expect(config.commands.commandsPath).toBe("./app/commands");
  });

  test("an answer containing a quote does not break the file", async () => {
    const databaseUrl = 'sqlite://./a"b.db';
    const config = await importGenerated(buildOrmConfigTemplate({ ...base, databaseUrl }));
    expect(config.connection.url).toBe(databaseUrl);
  });

  test("an answer containing template syntax is data, not code", async () => {
    // Interpolated into a template literal this would have been evaluated the
    // moment the config was imported.
    const marker = join(await mkdtemp(join(tmpdir(), "orm-injection-")), "pwned");
    dirs.push(marker);
    const hostile = 'sqlite://./x${(globalThis.__ormPwned = true, "")}.db';

    const config = await importGenerated(buildOrmConfigTemplate({ ...base, databaseUrl: hostile }));

    expect((globalThis as any).__ormPwned).toBeUndefined();
    expect(config.connection.url).toBe(hostile);
  });

  test("a backtick and a backslash survive intact", async () => {
    const modelsPath = "./app/mo`dels\\x";
    const config = await importGenerated(buildOrmConfigTemplate({ ...base, modelsPath }));
    expect(config.modelsPath).toBe(modelsPath);
  });

  test("an answer that closes the object literal cannot inject a property", async () => {
    const hostile = './app/models", injected: "yes';
    const config = await importGenerated(buildOrmConfigTemplate({ ...base, modelsPath: hostile }));
    expect(config.modelsPath).toBe(hostile);
    expect(config.injected).toBeUndefined();
  });

  test("optional sections are still emitted", async () => {
    const config = await importGenerated(buildOrmConfigTemplate({
      ...base,
      enableQueue: true,
      enableCache: true,
      enableLogs: true,
    }));
    expect(config.queue.driver).toBe("db");
    expect(config.cache.prefix).toBe("orm:");
    expect(config.log.console).toBe(true);
  });
});
