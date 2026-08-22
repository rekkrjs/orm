import { describe, test, expect, afterEach } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Connection, Schema } from "../src/index.js";
import { makeTypesGenerateCommand } from "../src/cli/TypesGenerateCommand.js";
import type { OrmConfig } from "../src/config/OrmConfig.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});

async function project(): Promise<{ root: string; models: string; out: string }> {
  const root = await mkdtemp(join(tmpdir(), "orm-typegen-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const models = join(root, "models");
  const out = join(root, "out");
  await mkdir(models, { recursive: true });
  await writeFile(
    join(models, "Widget.ts"),
    'import { Model } from "@rekkr/orm";\nexport class Widget extends Model.define<{ id: number }>("widgets") {}\n',
  );
  return { root, models, out };
}

async function connect(): Promise<Connection> {
  const connection = new Connection({ url: "sqlite://:memory:" });
  cleanup.push(() => connection.close());
  Schema.setConnection(connection);
  await Schema.create("widgets", (table) => { table.increments("id"); });
  return connection;
}

/** Instantiate the command directly so handle() errors surface instead of being printed. */
async function runHandle(config: OrmConfig, connection: Connection, dir: string, options: Record<string, any> = {}) {
  const CommandClass = makeTypesGenerateCommand(config, connection) as any;
  const instance = new CommandClass();
  instance._parsedArgs = { dir };
  instance._parsedOptions = options;
  await instance.handle();
}

describe("types:generate scope selection", () => {
  test("a plain modelsPath string does not enter the tenant branch", async () => {
    const { models, out } = await project();
    const connection = await connect();

    // No tenancy config at all — the documented default invocation for a
    // single-database project. This used to throw "requires resolveTenant()"
    // after the landlord files had already been written.
    const config = { connection: { url: "sqlite://:memory:" }, modelsPath: models } as unknown as OrmConfig;
    await expect(runHandle(config, connection, out)).resolves.toBeUndefined();
  });

  test("an array modelsPath is also treated as unscoped", async () => {
    const { models, out } = await project();
    const connection = await connect();

    const config = { connection: { url: "sqlite://:memory:" }, modelsPath: [models] } as unknown as OrmConfig;
    await expect(runHandle(config, connection, out)).resolves.toBeUndefined();
  });

  test("a genuinely scoped config still requires tenancy.resolveTenant", async () => {
    const { models, out } = await project();
    const connection = await connect();

    const config = {
      connection: { url: "sqlite://:memory:" },
      modelsPath: { landlord: models, tenant: models },
    } as unknown as OrmConfig;

    await expect(runHandle(config, connection, out)).rejects.toThrow(/resolveTenant/);
  });

  test("--tenant still opts into the tenant branch on an unscoped config", async () => {
    const { models, out } = await project();
    const connection = await connect();

    const config = { connection: { url: "sqlite://:memory:" }, modelsPath: models } as unknown as OrmConfig;
    await expect(runHandle(config, connection, out, { tenant: "acme" })).rejects.toThrow(/resolveTenant/);
  });
});
