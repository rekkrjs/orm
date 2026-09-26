import { describe, test, expect, afterEach } from "./harness.js";
import { existsSync } from "fs";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Connection, Schema } from "../src/index.js";
import { makeTypesGenerateCommand } from "../src/cli/TypesGenerateCommand.js";
import type { OrmConfig } from "../src/config/OrmConfig.js";

const cleanup: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const fn of cleanup.splice(0)) await fn();
});

/**
 * A project outside the checkout whose models import `@rekkr/orm` as an
 * application does. The package resolves through node_modules and its
 * package.json exports; without it every import failed and discovery saw no
 * models at all, whatever the command did with them.
 */
async function project(): Promise<{ root: string; models: string; out: string }> {
  const root = await mkdtemp(join(tmpdir(), "orm-typegen-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "node_modules", "@rekkr"), { recursive: true });
  await symlink(process.cwd(), join(root, "node_modules", "@rekkr", "orm"), "dir");
  const models = join(root, "models");
  const out = join(root, "out");
  await mkdir(join(models, "tenant"), { recursive: true });
  await writeFile(
    join(models, "Widget.ts"),
    'import { Model } from "@rekkr/orm";\nexport class Widget extends Model.define<{ id: number }>("widgets") {}\n',
  );
  // Nested inside the landlord root, for configs that give tenants their own path.
  await writeFile(
    join(models, "tenant", "Gizmo.ts"),
    'import { Model } from "@rekkr/orm";\nexport class Gizmo extends Model.define<{ id: number }>("gizmos") {}\n',
  );
  return { root, models, out };
}

async function connect(): Promise<Connection> {
  const connection = new Connection({ url: "sqlite://:memory:" });
  cleanup.push(() => connection.close());
  Schema.setConnection(connection);
  await Schema.create("widgets", (table) => { table.increments("id"); });
  await Schema.create("gizmos", (table) => { table.increments("id"); });
  return connection;
}

/** Instantiate the command directly so handle() errors surface instead of being printed. */
async function runHandle(config: OrmConfig, connection: Connection, dir: string, options: Record<string, any> = {}) {
  const CommandClass = makeTypesGenerateCommand(config, connection) as any;
  const instance = new CommandClass();
  instance._parsedArgs = { dir };
  instance._parsedOptions = options;
  const warnings: string[] = [];
  instance.warn = (message: string) => warnings.push(message);
  instance.info = () => {};
  await instance.handle();
  return warnings;
}

const declarations = async (out: string) => (await readdir(out)).filter((file) => file.endsWith(".d.ts")).sort();

describe("types:generate scope selection", () => {
  test("a plain modelsPath string generates every model's declarations", async () => {
    const { models, out } = await project();
    const connection = await connect();

    // No tenancy config at all — the documented default invocation for a
    // single-database project. This used to throw "requires resolveTenant()"
    // after the landlord files had already been written, and then excluded
    // its own model directory and generated nothing.
    const config = { connection: { url: "sqlite://:memory:" }, modelsPath: models } as unknown as OrmConfig;
    expect(await runHandle(config, connection, out)).toEqual([]);

    expect(await declarations(out)).toEqual(["gizmos.d.ts", "index.d.ts", "widgets.d.ts"]);
    const widgets = await readFile(join(out, "widgets.d.ts"), "utf-8");
    expect(widgets).toContain('declare module "../models/Widget" {');
    expect(widgets).toContain("interface Widget extends WidgetsAttributes {");
    expect(widgets).toContain("id: number;");
  });

  test("an array modelsPath is also treated as unscoped", async () => {
    const { models, out } = await project();
    const connection = await connect();

    const config = { connection: { url: "sqlite://:memory:" }, modelsPath: [models] } as unknown as OrmConfig;
    expect(await runHandle(config, connection, out)).toEqual([]);

    expect(await declarations(out)).toEqual(["gizmos.d.ts", "index.d.ts", "widgets.d.ts"]);
  });

  test("a scoped config keeps the tenant models out of the landlord declarations", async () => {
    const { models, out } = await project();
    const connection = await connect();

    const config = {
      connection: { url: "sqlite://:memory:" },
      modelsPath: { landlord: models, tenant: join(models, "tenant") },
    } as unknown as OrmConfig;
    expect(await runHandle(config, connection, out, { landlord: true })).toEqual([]);

    // gizmos lives under the tenant root, so the landlord pass leaves it out.
    expect(await declarations(out)).toEqual(["index.d.ts", "widgets.d.ts"]);
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
    // The landlord branch does not run for --tenant, so nothing was written.
    expect(existsSync(out)).toBe(false);
  });
});
