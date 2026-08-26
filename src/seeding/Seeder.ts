import { existsSync } from "fs";
import { readdir, stat } from "fs/promises";
import { basename, extname, resolve } from "path";
import { pathToFileURL } from "url";
import { AsyncLocalStorage } from "node:async_hooks";
import { Connection } from "../connection/Connection.js";
import { ConnectionManager } from "../connection/ConnectionManager.js";
import { TenantContext } from "../connection/TenantContext.js";
import { Model } from "../model/Model.js";
import { ObserverRegistry } from "../model/Observer.js";
import { Schema } from "../schema/Schema.js";
import { normalizePathList, toPosixPath } from "../utils.js";

type SeederClass = new (connection?: Connection) => Seeder;
type SeederEntry = Seeder | SeederClass;
type SeederInput = SeederEntry | SeederEntry[] | Record<string, SeederEntry>;
const seederRunContext = new AsyncLocalStorage<{ calledOnce: Set<SeederClass> }>();

function isSeederClass(value: unknown): value is SeederClass {
  return typeof value === "function";
}

function normalizeSeederEntries(input: SeederInput | SeederInput[]): SeederEntry[] {
  const items = Array.isArray(input) ? input : [input];
  const seeders: SeederEntry[] = [];
  for (const item of items) {
    if (Array.isArray(item)) {
      seeders.push(...item);
      continue;
    }
    if (item && typeof item === "object" && !isSeederClass(item) && !(item instanceof Seeder)) {
      seeders.push(...Object.values(item as Record<string, SeederEntry>));
      continue;
    }
    seeders.push(item as SeederEntry);
  }
  return seeders;
}

async function runSeederEntry(entry: SeederEntry, connection: Connection): Promise<void> {
  const instance = typeof entry === "function" ? new entry(connection) : entry.setConnection(connection);
  const run = () => instance.run();
  if ((instance.constructor as typeof Seeder).withoutModelEvents) {
    await ObserverRegistry.withoutEvents(run);
  } else {
    await run();
  }
}

export abstract class Seeder {
  static withoutModelEvents = false;

  constructor(protected connection: Connection = Schema.getConnection()) {}

  abstract run(): Promise<void> | void;

  setConnection(connection: Connection): this {
    this.connection = connection;
    return this;
  }

  protected async call(...seeders: SeederInput[]): Promise<void> {
    const called = seederRunContext.getStore()?.calledOnce;
    for (const seeder of normalizeSeederEntries(seeders)) {
      const seederClass = (isSeederClass(seeder) ? seeder : seeder.constructor) as SeederClass;
      called?.add(seederClass);
      await runSeederEntry(seeder, this.connection);
    }
  }

  protected async callOnce(...seeders: SeederInput[]): Promise<void> {
    const called = seederRunContext.getStore()?.calledOnce;
    for (const seeder of normalizeSeederEntries(seeders)) {
      const seederClass = (isSeederClass(seeder) ? seeder : seeder.constructor) as SeederClass;
      if (called?.has(seederClass)) continue;
      await this.call(seeder);
    }
  }
}

export class SeederRunner {
  constructor(private connection?: Connection) {}

  private getConnection(): Connection {
    return TenantContext.current()?.connection || this.connection || Schema.getConnection();
  }

  private async runAtomic<T>(callback: (connection: Connection) => T | Promise<T>): Promise<T> {
    const connection = this.getConnection();
    const context = TenantContext.current();
    // rls runs inside withTenant()'s transaction, so the seeder must not open
    // another. search_path is no longer transactional (reserved connection,
    // session-scoped SET) — the seeder opens its own real transaction on the
    // dedicated connection for atomicity.
    const usesTenantTransaction = context?.strategy === "rls";
    const previousSchemaConnection = (Schema as any).connection as Connection | undefined;
    const previousModelConnection = (Model as any).connection as Connection | undefined;
    const previousDefaultConnection = ConnectionManager.getDefault();

    const bind = async (boundConnection: Connection, runner: () => T | Promise<T>): Promise<T> => {
      Schema.setConnection(boundConnection);
      Model.setConnection(boundConnection);
      try {
        return await TenantContext.withConnection(boundConnection, runner);
      } finally {
        if (previousSchemaConnection) {
          Schema.setConnection(previousSchemaConnection);
        } else {
          delete (Schema as any).connection;
        }
        if (previousModelConnection) {
          Model.setConnection(previousModelConnection);
        } else {
          delete (Model as any).connection;
        }
        if (previousDefaultConnection) {
          ConnectionManager.setDefault(previousDefaultConnection);
        } else {
          ConnectionManager.clearDefault();
        }
      }
    };

    if (connection.isInTransaction() || usesTenantTransaction) {
      return await bind(connection, async () => await callback(connection));
    }
    return await connection.transaction(async (txConnection) => {
      return await bind(txConnection, async () => await callback(txConnection));
    });
  }

  async run(...seeders: SeederInput[]): Promise<void> {
    await seederRunContext.run({ calledOnce: new Set() }, async () => {
      await this.runAtomic(async (txConnection) => {
        for (const seeder of normalizeSeederEntries(seeders)) {
          await runSeederEntry(seeder, txConnection);
        }
        return undefined;
      });
    });
  }

  async runPaths(paths: string | string[]): Promise<void> {
    await this.runFiles(await this.getSeederFiles(paths));
  }

  async runDefault(paths: string | string[]): Promise<void> {
    const files: string[] = [];
    for (const path of normalizePathList(paths)) {
      const candidates = await this.getSeederFiles(path);
      const roots = candidates.filter((file) => basename(file, extname(file)) === "DatabaseSeeder");
      files.push(...(roots.length > 0 ? roots : candidates));
    }
    await this.runFiles(files);
  }

  async runFile(file: string): Promise<void> {
    await this.run(await this.loadSeederClass(file));
  }

  async runTarget(target: string, searchPaths: string | string[] = "./database/seeders"): Promise<void> {
    const resolved = resolve(target);
    if (existsSync(resolved) && (await stat(resolved)).isFile()) {
      await this.runFile(resolved);
      return;
    }

    const files = await this.getSeederFiles(searchPaths);
    const normalizedTarget = target.replace(/\.(ts|js|mts|mjs|cts|cjs)$/i, "");
    const match = files.find((file) => {
      const name = basename(file, extname(file));
      return name === normalizedTarget || file.endsWith(target) || file.endsWith(`${target}.ts`) || file.endsWith(`${target}.js`);
    });

    if (!match) {
      throw new Error(`Seeder "${target}" could not be found in ${normalizePathList(searchPaths).join(", ")}.`);
    }

    await this.runFile(match);
  }

  private async runFiles(files: string[]): Promise<void> {
    const seeders: SeederClass[] = [];
    for (const file of files) seeders.push(await this.loadSeederClass(file));
    await this.run(...seeders);
  }

  private async loadSeederClass(file: string): Promise<SeederClass> {
    const resolved = resolve(file);
    const module = await import(/* @vite-ignore */ pathToFileURL(resolved).href);
    const SeederClass = module.default || Object.values(module)[0];
    if (!SeederClass) throw new Error(`Seeder ${file} does not export a class.`);
    return SeederClass as SeederClass;
  }

  private async getSeederFiles(paths: string | string[]): Promise<string[]> {
    const files: string[] = [];
    for (const path of normalizePathList(paths)) {
      const root = resolve(path);
      if (!existsSync(root)) continue;
      for (const entry of await readdir(root, { withFileTypes: true })) {
        if (!entry.isFile()) continue;
        if (entry.name.endsWith(".d.ts") || entry.name.endsWith(".test.ts") || entry.name.endsWith(".spec.ts")) continue;
        if (![".ts", ".js", ".mts", ".mjs", ".cts", ".cjs"].includes(extname(entry.name))) continue;
        files.push(toPosixPath(resolve(root, entry.name)));
      }
    }
    return files.sort((a, b) => basename(a).localeCompare(basename(b)) || a.localeCompare(b));
  }
}
