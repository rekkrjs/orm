#!/usr/bin/env bun
import { SQL } from "bun";
import { Connection } from "../src/connection/Connection.js";
import { ConnectionManager } from "../src/connection/ConnectionManager.js";
import { configureOrm } from "../src/config/OrmConfig.js";
import type { OrmConfig } from "../src/config/OrmConfig.js";
import { MigrationCreator } from "../src/migration/MigrationCreator.js";
import { TypeGenerator } from "../src/typegen/TypeGenerator.js";
import { existsSync } from "fs";
import { mkdir, mkdtempDisposable, readdir, writeFile } from "fs/promises";
import { basename, extname, join, resolve } from "path";
import { pathToFileURL } from "url";
import { styleText } from "node:util";
import { normalizePathList, snakeCase } from "../src/utils.js";
import { discoverModelTables } from "../src/typegen/discoverModelTables.js";
import { DatabaseQueueDriver } from "../src/queue/DatabaseQueueDriver.js";
import { RedisQueueDriver, resolveQueueRedisClient } from "../src/queue/RedisQueueDriver.js";
import type { QueueDriver } from "../src/queue/QueueDriver.js";
import { Worker } from "../src/queue/Worker.js";
import { registerJob } from "../src/queue/Job.js";
import { registerCommand, resolveCommand, listCommands, isCommandConstructor } from "../src/commands/Command.js";
import { CommandRunner, parseBooleanOptionValue } from "../src/commands/CommandRunner.js";
import { parseSignatureName } from "../src/commands/SignatureParser.js";
import { registerOrmCommands } from "../src/cli/index.js";
import { relayStdoutToStderr } from "../src/cli/StdoutContract.js";
import { getFlagValue, parsePositiveInteger, readFlag } from "../src/cli/flags.js";
import { buildOrmConfigTemplate } from "../src/cli/configTemplate.js";
import {
  BelongsTo,
  BelongsToMany,
  Blueprint,
  Grammar,
  HasMany,
  HasManyThrough,
  HasOne,
  HasOneThrough,
  Migration,
  MorphMany,
  MorphMap,
  MorphOne,
  MorphTo,
  MorphToMany,
  MySqlGrammar,
  ObserverRegistry,
  PostgresGrammar,
  Schema,
  SQLiteGrammar,
  TypeMapper,
  Builder,
  Model,
} from "../src/index.js";

/** The commands whose stdout is a machine contract under `--json`. */
const JSON_CONTRACT_COMMANDS = new Set<string>([
  "migrate",
  "migrate:rollback",
  "migrate:status",
  "migrate:reset",
  "migrate:refresh",
  "migrate:fresh",
]);

function parseEnvPathSetting(value?: string): string | string[] | undefined {
  if (!value) return undefined;
  const paths = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (paths.length === 0) return undefined;
  return paths.length === 1 ? paths[0] : paths;
}

function hasLocalOrmConfig(): boolean {
  const tsConfigPath = join(process.cwd(), "orm.config.ts");
  const jsConfigPath = join(process.cwd(), "orm.config.js");
  return existsSync(tsConfigPath) || existsSync(jsConfigPath);
}

function isInteractiveTerminal(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function resolveReplTmpRoot(): string {
  return process.env.ORM_REPL_TMPDIR || process.env.TMPDIR || process.env.TEMP || process.env.TMP || "/tmp";
}

async function promptYesNo(question: string, defaultYes = true): Promise<boolean> {
  if (!isInteractiveTerminal()) return defaultYes;
  const suffix = defaultYes ? " [Y/n] " : " [y/N] ";
  for (;;) {
    process.stdout.write(`${question}${suffix}`);
    const input = await new Promise<string>((resolve) => {
      process.stdin.resume();
      process.stdin.once("data", (chunk) => resolve(String(chunk).trim()));
    });
    if (!input) return defaultYes;
    const normalized = input.toLowerCase();
    if (["y", "yes"].includes(normalized)) return true;
    if (["n", "no"].includes(normalized)) return false;
    process.stdout.write("Please answer yes or no.\n");
  }
}

async function promptText(question: string, defaultValue: string): Promise<string> {
  if (!isInteractiveTerminal()) return defaultValue;
  process.stdout.write(`${question} (${defaultValue}): `);
  const input = await new Promise<string>((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", (chunk) => resolve(String(chunk).trim()));
  });
  return input || defaultValue;
}

async function buildInitTemplateFromPrompts(): Promise<string> {
  const databaseUrl = await promptText("Database URL", "sqlite://./database/app.db");
  const migrationsPath = await promptText("Migrations path", "./database/migrations");
  const seedersPath = await promptText("Seeders path", "./database/seeders");
  const modelsPath = await promptText("Models path", "./app/models");
  const commandsPath = await promptText("Commands path", "./app/commands");

  const enableTenancy = await promptYesNo("Add multitenancy section?", false);
  const enableSearch = await promptYesNo("Add search section?", true);
  const enableQueue = await promptYesNo("Add queue section?", true);
  const enableCache = await promptYesNo("Add cache section?", false);
  const enableLogs = await promptYesNo("Enable SQL logging section?", false);

  return buildOrmConfigTemplate({
    databaseUrl,
    migrationsPath,
    seedersPath,
    modelsPath,
    commandsPath,
    enableTenancy,
    enableSearch,
    enableQueue,
    enableCache,
    enableLogs,
  });
}

async function runInitCommand(rawArgs: string[]): Promise<number> {
  const force = rawArgs.includes("--force") || rawArgs.includes("-f");
  const tsConfigPath = join(process.cwd(), "orm.config.ts");
  const jsConfigPath = join(process.cwd(), "orm.config.js");
  const tsExists = existsSync(tsConfigPath);
  const jsExists = existsSync(jsConfigPath);

  if ((tsExists || jsExists) && !force) {
    const existing = tsExists ? tsConfigPath : jsConfigPath;
    console.error(`${styleText("red", "Config already exists:", { stream: process.stderr })} ${existing}`);
    console.error("Use `orm init --force` to overwrite `orm.config.ts`.");
    return 1;
  }

  const template = await buildInitTemplateFromPrompts();
  await writeFile(tsConfigPath, template, "utf-8");
  console.log(`${styleText("green", "Created:")} ${tsConfigPath}`);
  if (jsExists) {
    console.warn(`${styleText("yellow", "Note:", { stream: process.stderr })} ${jsConfigPath} still exists and may cause confusion.`);
  }
  return 0;
}

async function walkJobFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkJobFiles(fullPath));
      continue;
    }
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (name.endsWith(".d.ts") || name.endsWith(".test.ts") || name.endsWith(".spec.ts")) continue;
    if (![".ts", ".js", ".mts", ".mjs"].includes(extname(name))) continue;
    files.push(fullPath);
  }
  return files;
}

async function createReplBootstrap(config: OrmConfig, dir: string): Promise<string> {
  const bootstrapPath = join(dir, "bootstrap.ts");
  const modelRoots = normalizePathList(
    typeof config.modelsPath === "object" && !Array.isArray(config.modelsPath)
      ? ([config.modelsPath.landlord, config.modelsPath.tenant].filter(Boolean) as string[]).flat()
      : config.modelsPath || config.typeDeclarationModelsDir
  );
  const tsConfigPath = join(process.cwd(), "orm.config.ts");
  const jsConfigPath = join(process.cwd(), "orm.config.js");
  const configPath = existsSync(tsConfigPath) ? tsConfigPath : existsSync(jsConfigPath) ? jsConfigPath : null;
  const source = `
    import {
      BelongsTo,
      BelongsToMany,
      Blueprint,
      Builder,
      Collection,
      Connection,
      ConnectionManager,
      DB,
      Grammar,
      HasMany,
      HasManyThrough,
      HasOne,
      HasOneThrough,
      Migration,
      MigrationCreator,
      Migrator,
      MorphMany,
      MorphMap,
      MorphOne,
      MorphTo,
      MorphToMany,
      MySqlGrammar,
      ObserverRegistry,
      PostgresGrammar,
      Schema,
      SQLiteGrammar,
      TenantContext,
      TypeGenerator,
      TypeMapper,
      Model,
      RuleBuilder,
      ValidationError,
      Validator,
      collect,
      configureOrm,
      rule
    } from "@rekkr/orm";
    import { existsSync } from "fs";
    import { readdir } from "fs/promises";
    import { basename, extname, join, resolve } from "path";
    import { pathToFileURL } from "url";

    const configPath = ${JSON.stringify(configPath)};
    const configModule = configPath ? await import(pathToFileURL(configPath).href) : null;
    const replConfig = configModule ? (configModule.default || configModule) : ${JSON.stringify(config)};
    const orm = configureOrm(replConfig);
    const connection = orm.connection;

    // The REPL is a single long-lived interactive session: idle gaps between
    // commands are expected and the user pins a tenant explicitly via
    // useTenant()/clearTenant(). The default idle-TTL + background sweep would
    // otherwise close the active tenant's pool out from under the prompt.
    ConnectionManager.disableTenantSweep();
    ConnectionManager.defaultTenantTtl = undefined;

    const modelRoots = ${JSON.stringify(modelRoots)};

    async function walkFiles(dir) {
      const entries = await readdir(dir, { withFileTypes: true });
      const files = [];
      for (const entry of entries) {
        if (entry.name === "types") continue;
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          files.push(...await walkFiles(fullPath));
          continue;
        }
        if (!entry.isFile()) continue;
        const name = entry.name;
        if (name.endsWith(".d.ts") || name.endsWith(".test.ts") || name.endsWith(".spec.ts")) continue;
        if (![".ts", ".js", ".mts", ".mjs", ".cts", ".cjs"].includes(extname(name))) continue;
        files.push(fullPath);
      }
      return files;
    }

    async function loadModels(roots) {
      const loaded = {};
      function registerModel(name, model) {
        if (!name || typeof model !== "function" || !(model.prototype instanceof Model)) return;
        loaded[name] = model;
        globalThis[name] = model;
      }
      for (const root of roots) {
        const resolvedRoot = resolve(process.cwd(), root);
        if (!existsSync(resolvedRoot)) continue;
        const files = await walkFiles(resolvedRoot);
        for (const file of files.sort()) {
          const mod = await import(pathToFileURL(file).href);
          for (const [exportName, exported] of Object.entries(mod)) {
            if (exportName === "default") continue;
            registerModel(exportName, exported);
          }
          if (typeof mod.default === "function" && mod.default.prototype instanceof Model) {
            const fileName = basename(file, extname(file));
            registerModel(fileName, mod.default);
            if (mod.default.name && mod.default.name !== fileName) {
              registerModel(mod.default.name, mod.default);
            }
          }
        }
      }
      globalThis.Models = loaded;
      return loaded;
    }

    const loadedModels = await loadModels(modelRoots);
    const originalTenantContextCurrent = TenantContext.current.bind(TenantContext);
    const originalDefaultConnection = connection;
    let activeTenantContext;

    function tenant() {
      return activeTenantContext;
    }

    async function clearTenant() {
      activeTenantContext = undefined;
      ConnectionManager.setDefault(originalDefaultConnection);
      Model.setConnection(originalDefaultConnection);
      return undefined;
    }

    async function useTenant(tenantId) {
      const resolved = await ConnectionManager.resolveTenant(tenantId);
      // Work on a shallow copy so we never mutate the object cached in
      // ConnectionManager.tenantCache (mutating schemaMode/connection there
      // would corrupt later TenantContext.run() resolutions for this tenant).
      const context = { ...resolved };
      let tenantConnection = context.connection;
      if (context.strategy === "schema" && context.schemaMode === "search_path" && context.schema) {
        // REPL doesn't wrap each query in a transaction, so search_path won't apply.
        // Create a connection with schema set directly (qualify mode) for REPL usage.
        tenantConnection = tenantConnection.withSchema(context.schema);
        context.connection = tenantConnection;
        context.schemaMode = "qualify";
      }
      // Pin the active REPL tenant so it cannot be expired/swept between
      // interactive commands even if a sweep is somehow re-enabled.
      context.expiresAt = undefined;
      activeTenantContext = context;
      // Set as default so Model.getConnection() picks up the tenant connection
      // even if TenantContext.current override doesn't propagate (e.g. module scope mismatch).
      ConnectionManager.setDefault(tenantConnection);
      Model.setConnection(tenantConnection);
      return context;
    }

    TenantContext.current = () => originalTenantContextCurrent() || activeTenantContext;

    Object.assign(globalThis, {
      Connection,
      Builder,
      Collection,
      ConnectionManager,
      DB,
      Blueprint,
      Grammar,
      SQLiteGrammar,
      MySqlGrammar,
      PostgresGrammar,
      Model,
      HasMany,
      BelongsTo,
      HasOne,
      HasManyThrough,
      HasOneThrough,
      BelongsToMany,
      MorphMap,
      MorphTo,
      MorphOne,
      MorphMany,
      MorphToMany,
      ObserverRegistry,
      Migration,
      Migrator,
      MigrationCreator,
      TypeGenerator,
      TypeMapper,
      RuleBuilder,
      Validator,
      ValidationError,
      rule,
      Schema,
      TenantContext,
      collect,
      configureOrm,
      db: connection,
      connection,
      orm,
      config: replConfig,
      Models: loadedModels,
      useTenant,
      clearTenant,
      tenant,
    });

    console.log(\`ORM REPL ready. Loaded \${Object.keys(loadedModels).length} model classes from modelsPath.\`);
  `;
  await writeFile(bootstrapPath, source, "utf-8");
  return bootstrapPath;
}

async function runRepl(config: OrmConfig, replArgs: string[]): Promise<number> {
  const tmpRoot = resolveReplTmpRoot();
  await mkdir(tmpRoot, { recursive: true });
  await using tmpDir = await mkdtempDisposable(join(tmpRoot, "orm-repl-"));
  const bootstrapPath = await createReplBootstrap(config, tmpDir.path);
  // The transpiler cache must outlive the disposable bootstrap dir so repeated
  // REPL sessions reuse it instead of transpiling the ORM from scratch.
  const cachePath = join(tmpRoot, "orm-repl-cache");
  await mkdir(cachePath, { recursive: true });
  await using terminal = new Bun.Terminal({
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
    data(_terminal, data) {
      const text = Buffer.from(data).toString("binary");
      const rewritten = text.replace(/\x1b\[2K> /g, "\x1b[2Korm> ");
      process.stdout.write(Buffer.from(rewritten, "binary"));
    },
  });
  const proc = Bun.spawn(["bun", "repl", ...replArgs], {
    env: {
      ...process.env,
      TMPDIR: tmpDir.path,
      TEMP: tmpDir.path,
      TMP: tmpDir.path,
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: cachePath,
    },
    terminal,
  });

  const stdin = process.stdin;
  const restoreRawMode = stdin.isTTY && typeof stdin.setRawMode === "function";

  if (restoreRawMode) {
    stdin.setRawMode(true);
  }
  stdin.resume();

  const onData = (chunk: Buffer) => {
    terminal.write(chunk);
  };
  stdin.on("data", onData);

  const cleanup = () => {
    stdin.off("data", onData);
    if (restoreRawMode) {
      stdin.setRawMode(false);
    }
  };

  const stop = () => terminal.close();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    terminal.write(`.load ${bootstrapPath}\n`);
    return await proc.exited;
  } finally {
    cleanup();
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

/**
 * Pulls the global `--config <path>` / `--config=<path>` out of the argument
 * list. It is global rather than per-command so that one flag points every
 * command at the application's own config module, and it is removed from the
 * args before dispatch so the command's own parser never sees it.
 */
function extractConfigOption(args: string[]): { args: string[]; configPath?: string } {
  const remaining: string[] = [];
  let configPath: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--config") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) throw new Error("--config needs a path, e.g. --config config/database.ts");
      configPath = value;
      index++;
      continue;
    }
    if (arg.startsWith("--config=")) {
      const value = arg.slice("--config=".length);
      if (!value) throw new Error("--config needs a path, e.g. --config config/database.ts");
      configPath = value;
      continue;
    }
    remaining.push(arg);
  }
  return { args: remaining, configPath };
}

/** Read the last `--name` / `--name=true|false` occurrence, like parseArgs. */
function extractBooleanOption(args: string[], name: string): boolean {
  const flag = `--${name}`;
  let value: string | boolean | undefined;
  for (const arg of args) {
    if (arg === "--") break;
    if (arg === flag) value = true;
    else if (arg.startsWith(`${flag}=`)) value = arg.slice(flag.length + 1);
  }
  return parseBooleanOptionValue(value, name) ?? false;
}

/** A configuration that does not load or does not connect is a user error, not a crash. */
function failWithConfigError(err: unknown): never {
  console.error(`${styleText("red", "Error:", { stream: process.stderr })} ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

async function loadExplicitConfig(path: string): Promise<OrmConfig> {
  const resolved = resolve(process.cwd(), path);
  if (!existsSync(resolved)) {
    throw new Error(`Config file not found: ${resolved}`);
  }
  const mod = await import(pathToFileURL(resolved).href);
  const config = mod.default || mod;
  if (!config || typeof config !== "object") {
    throw new Error(`${resolved} does not export a configuration object.`);
  }
  return config as OrmConfig;
}

async function loadConfig(allowFallback = false, explicitPath?: string): Promise<OrmConfig> {
  if (explicitPath) return await loadExplicitConfig(explicitPath);

  const configPath = join(process.cwd(), "orm.config.ts");
  if (existsSync(configPath)) {
    const mod = await import(configPath);
    return mod.default || mod;
  }

  const jsConfigPath = join(process.cwd(), "orm.config.js");
  if (existsSync(jsConfigPath)) {
    const mod = await import(jsConfigPath);
    return mod.default || mod;
  }

  // Fallback to environment variables
  const url = process.env.DATABASE_URL;
  if (url) {
    return {
      connection: { url },
      migrationsPath: parseEnvPathSetting(process.env.MIGRATIONS_PATH) || "./database/migrations",
      seedersPath: parseEnvPathSetting(process.env.SEEDERS_PATH),
      modelsPath: parseEnvPathSetting(process.env.MODELS_PATH),
    };
  }

  const driver = process.env.DB_CONNECTION as any;
  if (driver) {
    if (!Connection.SUPPORTED_DRIVERS.includes(driver)) {
      throw new Error(
        `DB_CONNECTION=${driver} is not a supported driver. Use one of: ${Connection.SUPPORTED_DRIVERS.join(", ")}, ` +
          `or point orm at your application's config with --config <path>.`
      );
    }
    return {
      connection: {
        driver,
        host: process.env.DB_HOST,
        port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
        database: process.env.DB_DATABASE,
        username: process.env.DB_USERNAME,
        password: process.env.DB_PASSWORD,
        filename: process.env.DB_DATABASE,
      },
      migrationsPath: parseEnvPathSetting(process.env.MIGRATIONS_PATH) || "./database/migrations",
      seedersPath: parseEnvPathSetting(process.env.SEEDERS_PATH),
      modelsPath: parseEnvPathSetting(process.env.MODELS_PATH),
    };
  }

  if (allowFallback) {
    return {
      connection: { url: "sqlite://:memory:" },
      migrationsPath: parseEnvPathSetting(process.env.MIGRATIONS_PATH) || "./database/migrations",
      seedersPath: parseEnvPathSetting(process.env.SEEDERS_PATH),
      modelsPath: parseEnvPathSetting(process.env.MODELS_PATH),
    };
  }

  throw new Error(
    "No database configuration found. Create orm.config.ts or set DATABASE_URL / DB_CONNECTION environment variables."
  );
}

async function main() {
  const { args: rawArgs, configPath } = (() => {
    try {
      return extractConfigOption(process.argv.slice(2));
    } catch (err) {
      console.error(`${styleText("red", "Error:", { stream: process.stderr })} ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  })();
  // `orm run foo` is the documented spelling for application commands.
  // Keep direct `orm foo` dispatch for backwards compatibility.
  const args    = rawArgs[0] === "run" ? rawArgs.slice(1) : rawArgs;
  const command = args[0];
  const isInit = command === "init";

  // `--json` on a migration command makes stdout a contract. Relay everything
  // else — including whatever the config module or a migration prints — to
  // stderr from here on, before the config is even imported.
  if (JSON_CONTRACT_COMMANDS.has(command ?? "")) {
    try {
      // This outer relay intentionally stays installed until process exit so a
      // config or migration cannot corrupt the payload from a late callback.
      if (extractBooleanOption(args, "json")) relayStdoutToStderr();
    } catch (err) {
      console.error(`${styleText("red", "Error:", { stream: process.stderr })} ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }

  // Static metadata for built-in commands — shown before config loads
  const CORE_COMMANDS: Array<{ name: string; sig: string; desc: string }> = [
    { name: "migrate",          sig: "migrate {--landlord} {--tenants} {--tenant=} {--allow-changed} {--json}", desc: "Run pending migrations" },
    { name: "migrate:rollback", sig: "migrate:rollback {--step=} {--steps=} {--landlord} {--tenants} {--tenant=} {--json}", desc: "Rollback the last batch" },
    { name: "migrate:reset",    sig: "migrate:reset {--landlord} {--tenants} {--tenant=} {--json}", desc: "Rollback all migrations" },
    { name: "migrate:refresh",  sig: "migrate:refresh {--landlord} {--tenants} {--tenant=} {--json}", desc: "Reset and rerun all migrations" },
    { name: "migrate:fresh",    sig: "migrate:fresh {--landlord} {--tenants} {--tenant=} {--json}", desc: "Drop all tables and rerun migrations" },
    { name: "migrate:status",   sig: "migrate:status {--landlord} {--tenants} {--tenant=} {--json}", desc: "Show migration status" },
    { name: "make:migration",   sig: "make:migration {name} {--model} {--m} {--dir=} {--models-dir=}", desc: "Create a new migration file" },
    { name: "make:model",       sig: "make:model {name} {--migration} {--m} {--dir=}",           desc: "Create a new model file" },
    { name: "migrate:make",    sig: "migrate:make {name} {dir?}",                                desc: "Create a new migration file" },
    { name: "db:seed",          sig: "db:seed {seeder?} {--landlord} {--tenants} {--tenant=}",    desc: "Run database seeders" },
    { name: "schema:dump",      sig: "schema:dump {path?}",                                       desc: "Dump current schema to SQL" },
    { name: "schema:squash",    sig: "schema:squash {path?}",                                     desc: "Dump schema and mark migrations as run" },
    { name: "types:generate",   sig: "types:generate {dir?} {--landlord} {--tenant=}",            desc: "Generate TypeScript model types from DB schema" },
    { name: "queue:install",    sig: "queue:install {dir?} {--models=}",                          desc: "Generate the jobs and failed_jobs migration and optional models" },
    { name: "queue",            sig: "queue {--queue=} {--workers=}",                             desc: "Start the background job worker" },
    { name: "init",             sig: "init {--force} {-f}",                                       desc: "Create an orm.config.ts file" },
    { name: "repl",             sig: "repl",                                                      desc: "Start an interactive REPL" },
  ];

  const isHelp    = args.includes("--help") || args.includes("-h");
  const isTopHelp = !command || command === "--help" || command === "-h";

  function printStaticHelp() {
    console.log("\nUsage: orm [--config <path>] <command> [options]\n");
    console.log(`Run ${styleText("yellow", "orm <command> --help")} for command-specific usage.`);
    console.log(`${styleText("yellow", "--config <path>")} loads that module instead of ./orm.config.ts.\n`);
    console.log("Core commands:\n");
    for (const { name, desc } of [...CORE_COMMANDS].sort((a, b) => a.name.localeCompare(b.name))) {
      const color = (name === "queue" || name === "repl") ? "green" : "yellow";
      console.log(`  ${styleText(color, name.padEnd(30))}${desc}`);
    }
    console.log("");
  }

  function printStaticCommandHelp(meta: (typeof CORE_COMMANDS)[number]) {
    console.log(`\n${styleText("bold", meta.desc)}\n`);
    console.log(`${styleText("bold", "Usage:")}  orm ${styleText("yellow", meta.sig)}\n`);
    const tokens = meta.sig.match(/\{[^}]+\}/g) ?? [];
    const opts   = tokens.filter((t) => t.startsWith("{--"));
    if (opts.length > 0) {
      console.log(styleText("bold", "Options:"));
      for (const opt of opts) {
        const inner   = opt.slice(1, -1);
        const hasVal  = inner.endsWith("=");
        const optName = hasVal ? inner.slice(0, -1) : inner;
        const valHint = hasVal ? " <value>" : "";
        console.log(`  ${styleText("cyan", (optName + valHint).padEnd(28))}`);
      }
      console.log("");
    }
  }

  // These commands bypass CommandRunner, so handle their help before they
  // start an interactive or long-running process.
  if (isHelp && (command === "queue" || command === "repl")) {
    printStaticCommandHelp(CORE_COMMANDS.find((entry) => entry.name === command)!);
    return;
  }

  // REPL runs before configureOrm (uses in-memory SQLite fallback)
  if (command === "repl") {
    const config = await loadConfig(true, configPath);
    process.exit(await runRepl(config, args.slice(1)));
  }

  // Init runs before config loading.
  if (isInit) {
    process.exit(await runInitCommand(args.slice(1)));
  }

  // Load config — if it fails and the user asked for help, show static fallback
  let config: OrmConfig;
  try {
    config = await loadConfig(false, configPath);
  } catch (err) {
    if (isTopHelp) { printStaticHelp(); return; }
    if (isHelp) {
      const meta = CORE_COMMANDS.find((c) => c.name === command);
      if (meta) { printStaticCommandHelp(meta); return; }
    }
    const missingConfig = err instanceof Error
      && err.message.includes("No database configuration found")
      && !configPath
      && !hasLocalOrmConfig();
    if (missingConfig) {
      console.error(styleText("red", "No orm.config.ts found.", { stream: process.stderr }));
      if (process.stdin.isTTY && process.stdout.isTTY) {
        const shouldInit = await promptYesNo("Initialize orm.config.ts now?", true);
        if (shouldInit) {
          const code = await runInitCommand([]);
          if (code === 0) {
            console.log("Run your original command again after updating the config.");
          }
          process.exit(code);
        }
      }
      console.error("Run `orm init` to create a starter config.");
      process.exit(1);
    }
    // A config that does not load is the user's problem, not a crash: say what
    // is wrong on stderr instead of dumping a stack trace at them.
    failWithConfigError(err);
  }

  // Building the connection is still configuration work — an unsupported driver
  // or URL scheme surfaces here, and deserves the same treatment as a config
  // file that would not load.
  let connection: Connection;
  try {
    ({ connection } = configureOrm(config));
  } catch (err) {
    failWithConfigError(err);
  }
  registerOrmCommands(config, connection);

  // Walk user commandsPath and register user-defined commands
  for (const commandsPath of normalizePathList(config.commands?.commandsPath)) {
    const resolvedPath = resolve(process.cwd(), commandsPath);
    if (!existsSync(resolvedPath)) {
      console.warn(`[Commands] commandsPath not found: ${resolvedPath}`);
      continue;
    }
    for (const file of await walkJobFiles(resolvedPath)) {
      const mod = await import(pathToFileURL(file).href);
      for (const exported of Object.values(mod)) {
        if (
          typeof exported === "function" &&
          typeof (exported as any).signature === "string" &&
          typeof (exported as any).prototype?.handle === "function"
        ) {
          registerCommand(exported as any);
          continue;
        }
        if (
          typeof exported === "object" && exported !== null &&
          typeof (exported as any).signature === "string" &&
          typeof (exported as any).handle === "function"
        ) {
          registerCommand(exported as any);
        }
      }
    }
  }

  try {
    // Queue worker — long-running, stays hardcoded
    if (command === "queue") {
      const restArgs    = args.slice(1);
      const queueName   = getFlagValue(restArgs, "--queue") ?? config.queue?.defaultQueue ?? "default";
      const workersFlag = readFlag(restArgs, "--workers");
      if (workersFlag.kind === "missing-value") {
        console.error(
          `${styleText("red", "Error:", { stream: process.stderr })} --workers needs a value ` +
          "(--workers=4). Omit the flag entirely to use the configured default.",
        );
        process.exitCode = 1;
        return;
      }
      const rawWorkers  = workersFlag.kind === "value" ? workersFlag.value : String(config.queue?.workers ?? 1);
      const workerCount = parsePositiveInteger(rawWorkers);

      if (workerCount === undefined) {
        console.error(
          `${styleText("red", "Error:", { stream: process.stderr })} invalid worker count "${rawWorkers}". ` +
          "Expected a positive integer (--workers=4).",
        );
        process.exitCode = 1;
        return;
      }

      let driver: QueueDriver;
      if (config.queue?.driver === "db" || !config.queue?.driver) {
        driver = new DatabaseQueueDriver(connection, {
          table: config.queue?.table,
          failedTable: config.queue?.failedTable,
        });
        await driver.migrate();
      } else if (config.queue?.driver === "redis") {
        driver = new RedisQueueDriver(resolveQueueRedisClient(config.queue?.redis?.url), {
          prefix: config.cache?.prefix ? `${config.cache.prefix}queue:` : undefined,
        });
      } else if (typeof config.queue?.driver === "object" && "reserve" in config.queue.driver) {
        driver = config.queue.driver;
      } else {
        driver = new DatabaseQueueDriver(connection, {
          table: config.queue?.table,
          failedTable: config.queue?.failedTable,
        });
        await driver.migrate();
      }

      const jobsPaths = normalizePathList(config.queue?.jobsPath);
      // Counted here rather than from the registry as a whole: the search
      // subsystem registers its own jobs on import, which would mask an empty
      // jobsPath.
      let discoveredJobs = 0;
      for (const jobsPath of jobsPaths) {
        const resolvedPath = resolve(process.cwd(), jobsPath);
        if (!existsSync(resolvedPath)) {
          console.warn(`[Queue] jobsPath not found: ${resolvedPath}`);
          continue;
        }
        for (const file of await walkJobFiles(resolvedPath)) {
          const mod = await import(pathToFileURL(file).href);
          for (const exported of Object.values(mod)) {
            if (typeof exported === "function" && exported.prototype && typeof exported.prototype.handle === "function") {
              registerJob(exported as any);
              discoveredJobs++;
            }
          }
        }
      }

      // A jobsPath that yields nothing is almost always a misconfiguration, and
      // a worker that resolves nothing burns through the whole backlog retrying
      // jobs it can never run. Refuse instead.
      if (jobsPaths.length > 0 && discoveredJobs === 0) {
        console.error(
          `${styleText("red", "Error:", { stream: process.stderr })} jobsPath is configured ` +
          `(${jobsPaths.join(", ")}) but no job classes were registered.\n` +
          "Refusing to start: every pending job would be retried and eventually failed as unknown.",
        );
        process.exitCode = 1;
        return;
      }

      const worker = new Worker(driver, {
        queue: queueName,
        concurrency: workerCount,
        retryAfterSeconds: config.queue?.retryAfterSeconds,
        retryDelaySeconds: config.queue?.retryDelaySeconds,
        pollIntervalMs: config.queue?.pollIntervalMs,
      });
      console.log(`[Queue] Worker started. queue=${queueName} concurrency=${workerCount}`);
      const shutdown = () => { console.log("\n[Queue] Shutting down..."); worker.stop(); };
      process.once("SIGTERM", shutdown);
      process.once("SIGINT", shutdown);
      try {
        await worker.run();
      } catch (err) {
        // The worker loops swallow their own driver errors, so anything here is
        // a startup problem. Set the exit code rather than calling exit(): a
        // hard exit would cut short any job still draining.
        console.error("[Queue] Worker crashed:", err);
        process.exitCode = 1;
      }
      console.log("[Queue] Worker stopped.");
      return;
    }

    // No command or --help: list all registered commands
    if (!command || command === "--help" || command === "-h") {
      const commands = listCommands().sort((a, b) => parseSignatureName(a.signature).localeCompare(parseSignatureName(b.signature)));
      console.log("\nUsage: orm <command> [options]\n");
      if (commands.length === 0) {
        console.log("No commands registered.");
      } else {
        console.log("Available commands:\n");
        const allEntries = ([] as Array<[string, string]>).concat(
          commands.map((entry): [string, string] => [
            parseSignatureName(entry.signature),
            (isCommandConstructor(entry) ? entry.description : (entry as any).description) ?? "",
          ]),
          [["queue", "Start the background job worker"], ["repl", "Start an interactive REPL"]],
        ).sort(([a], [b]) => a.localeCompare(b));
        for (const [name, desc] of allEntries) {
          const color = (name === "queue" || name === "repl") ? "green" : "yellow";
          console.log(`  ${styleText(color, name.padEnd(30))}${desc}`);
        }
        console.log("");
      }
      return;
    }

    const entry = resolveCommand(command);
    if (!entry) {
      console.error(`${styleText("red", "Unknown command:", { stream: process.stderr })} ${command}`);
      console.error(`Run ${styleText("yellow", "orm --help", { stream: process.stderr })} to list available commands.`);
      process.exit(1);
    }

    try {
      await new CommandRunner().run(entry, args.slice(1));
    } catch (err) {
      console.error(`${styleText("red", "Error:", { stream: process.stderr })} ${err instanceof Error ? err.message : String(err)}`);
      console.error(`\nRun ${styleText("yellow", `orm ${command} --help`, { stream: process.stderr })} for usage.`);
      process.exit(1);
    }
  } finally {
    await ConnectionManager.closeAll();
  }
}

// Top-level await rather than `main().catch(...)`: a pending top-level await is
// a reference Bun counts, so the process cannot drain the event loop and exit 0
// half way through a command. That is a second line of defence behind the MySQL
// keep-alive in Connection — see .tmp_hacks/bun-mysql-event-loop.md.
try {
  await main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
