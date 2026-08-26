import { Connection } from "../connection/Connection.js";
import { ConnectionManager } from "../connection/ConnectionManager.js";
import { TenantContext } from "../connection/TenantContext.js";
import { Migrator } from "../migration/Migrator.js";
import { SeederRunner } from "../seeding/Seeder.js";
import { normalizePathList } from "../utils.js";
import { relayStdoutToStderr, writeToStdout } from "./StdoutContract.js";
import { resolve, sep } from "path";
import type { OrmConfig, ModelsPath } from "../config/OrmConfig.js";
import type { MigrationStatusRow, MigratorOptions } from "../migration/Migrator.js";

export type MigrationCommand =
  | "migrate"
  | "migrate:rollback"
  | "migrate:status"
  | "migrate:reset"
  | "migrate:refresh"
  | "migrate:fresh";

/** Flags a migration command takes beyond its target. */
export interface MigrationCommandOptions {
  /** Regenerate model types once the command is done. */
  generateTypes?: boolean;
  /** Print the result as one JSON document on stdout, progress on stderr. */
  json?: boolean;
  /** `migrate:rollback` only: how many batches to undo. Defaults to 1. */
  steps?: number;
  /** `migrate` only: migrate even though applied migration files have changed. */
  allowChanged?: boolean;
}

/**
 * What a migration command did. Every key is filled in for the command it
 * belongs to, so `{"applied":[]}` says "nothing to migrate" rather than leaving
 * the consumer to guess from a missing field.
 */
export interface MigrationCommandResult {
  applied?: string[];
  rolledBack?: string[];
  migrations?: MigrationStatusRow[];
}

export type MigrationTarget =
  | { scope: "default" }
  | { scope: "landlord" }
  | { scope: "tenants" }
  | { scope: "tenant"; tenantId: string };

/** Read migration target from a command's options (--landlord / --tenants / --tenant=) */
export function parseTargetFromOptions(cmd: {
  option(name: string): string | boolean | undefined;
}): MigrationTarget {
  if (cmd.option("landlord")) return { scope: "landlord" };
  if (cmd.option("tenants"))  return { scope: "tenants" };
  const tenant = cmd.option("tenant");
  if (tenant && typeof tenant === "string") return { scope: "tenant", tenantId: tenant };
  return { scope: "default" };
}

/** Reads `--step=` / `--steps=` into a batch count. */
export function parseStepsOption(value: string | boolean | undefined): number | undefined {
  if (value === undefined || value === true || value === false || value === "") return undefined;
  const steps = Number(value);
  if (!Number.isInteger(steps) || steps < 1) {
    throw new Error(`--step must be a positive whole number of batches, got "${value}".`);
  }
  return steps;
}

/** Accepts the old `generateTypes` boolean in the options position. */
function normalizeCommandOptions(options: boolean | MigrationCommandOptions = {}): MigrationCommandOptions {
  return typeof options === "boolean" ? { generateTypes: options } : options;
}

/**
 * Under --json stdout carries the payload and nothing else, so every progress
 * line — including the ones the Migrator writes — is redirected to stderr.
 */
function progressWriter(options: MigrationCommandOptions): (line: string) => void {
  return options.json ? (line: string) => process.stderr.write(`${line}\n`) : (line: string) => console.log(line);
}

function migratorOptions(options: MigrationCommandOptions): Partial<MigratorOptions> {
  return {
    allowChanged: options.allowChanged,
    output: progressWriter(options),
    // Warnings are diagnostics, not results: stderr in either mode.
    warn: (line: string) => process.stderr.write(`${line}\n`),
  };
}

function mergeResult(target: MigrationCommandResult, next: MigrationCommandResult): MigrationCommandResult {
  if (next.applied)    (target.applied    ??= []).push(...next.applied);
  if (next.rolledBack) (target.rolledBack ??= []).push(...next.rolledBack);
  if (next.migrations) (target.migrations ??= []).push(...next.migrations);
  return target;
}

/** The keys a given command always emits, empty or not. */
function jsonPayload(command: MigrationCommand, result: MigrationCommandResult): Record<string, unknown> {
  switch (command) {
    case "migrate":
    case "migrate:fresh":
      return { applied: result.applied ?? [] };
    case "migrate:rollback":
    case "migrate:reset":
      return { rolledBack: result.rolledBack ?? [] };
    case "migrate:refresh":
      return { rolledBack: result.rolledBack ?? [], applied: result.applied ?? [] };
    default:
      return { migrations: result.migrations ?? [] };
  }
}

export function getDefaultMigrationsPath(config: OrmConfig): string | string[] {
  return config.migrationsPath || config.migrations?.landlord || "./database/migrations";
}

export function getModelPaths(config: OrmConfig): { landlord?: string | string[]; tenant?: string | string[] } {
  const mp = config.modelsPath;
  if (mp && typeof mp === "object" && !Array.isArray(mp)) return mp as ModelsPath;
  return { landlord: mp as string | string[] | undefined, tenant: mp as string | string[] | undefined };
}

export function getScopeExclusions(
  ourModels: string | string[] | undefined,
  otherModels: string | string[] | undefined,
): string[] | undefined {
  if (!ourModels || !otherModels) return undefined;
  const ourRoots   = normalizePathList(ourModels).map((r) => resolve(process.cwd(), r));
  const otherRoots = normalizePathList(otherModels).map((r) => resolve(process.cwd(), r));
  return otherRoots.filter((other) =>
    ourRoots.some((our) => other.startsWith(our + sep) || other === our),
  );
}

export function createTypeGeneratorOptions(config: OrmConfig, modelsPathOverride?: string | string[]) {
  const modelRoots = normalizePathList(
    modelsPathOverride ??
    (typeof config.modelsPath === "string" || Array.isArray(config.modelsPath) ? config.modelsPath : undefined) ??
    config.typeDeclarationModelsDir,
  );
  return {
    declarations: !config.typeStubs,
    stubs: config.typeStubs,
    modelDeclarations: config.typeDeclarations,
    modelDirectory: modelRoots[0],
    modelDirectories: modelRoots.length > 1 ? modelRoots : undefined,
    modelImportPrefix: config.typeDeclarationImportPrefix,
    singularModels: config.typeDeclarationSingularModels,
    declarationDirName: "types",
  };
}

export function createMigrationOptions(config: OrmConfig) {
  return { createIfMissing: config.migrations?.createIfMissing };
}

export function buildMigrator(
  config: OrmConfig,
  connection: Connection,
  path: string | string[],
  scope: "landlord" | "tenant",
  extraOptions: Partial<MigratorOptions> = {},
  generateTypes: boolean = false,
): Migrator {
  return new Migrator(
    connection,
    path,
    generateTypes ? config.typesOutDir : undefined,
    generateTypes ? createTypeGeneratorOptions(config, getModelPaths(config)[scope]) : {},
    { ...createMigrationOptions(config), ...extraOptions },
  );
}

export async function runMigratorCommand(
  command: MigrationCommand,
  migrator: Migrator,
  options: MigrationCommandOptions = {},
  statusLabel?: string,
): Promise<MigrationCommandResult> {
  if (command === "migrate")           return { applied: await migrator.runWithResult() };
  if (command === "migrate:rollback")  return { rolledBack: await migrator.rollbackWithResult(options.steps ?? 1) };
  if (command === "migrate:reset")     return { rolledBack: await migrator.resetWithResult() };
  if (command === "migrate:refresh")   return await migrator.refreshWithResult();
  if (command === "migrate:fresh")     return { applied: await migrator.freshWithResult() };
  const migrations = await migrator.status();
  if (!options.json) {
    if (statusLabel) console.log(statusLabel);
    console.table(migrations);
  }
  return { migrations };
}

export async function getTenantIds(config: OrmConfig): Promise<string[]> {
  if (!config.tenancy?.listTenants) {
    throw new Error("Tenant migrations require tenancy.listTenants() in orm.config.ts.");
  }
  return (await config.tenancy.listTenants()).map(String);
}

export async function runTenantMigrator(
  command: MigrationCommand,
  config: OrmConfig,
  connectionPath: string | string[],
  tenantId: string,
  options: boolean | MigrationCommandOptions = {},
): Promise<MigrationCommandResult> {
  const commandOptions = normalizeCommandOptions(options);
  let result: MigrationCommandResult = {};
  await TenantContext.run(tenantId, async () => {
    const context = TenantContext.current();
    if (!context) throw new Error(`Tenant "${tenantId}" did not resolve to an active context.`);
    progressWriter(commandOptions)(`Tenant: ${tenantId}`);
    const migrator = buildMigrator(
      config,
      context.connection,
      connectionPath,
      "tenant",
      { ...migratorOptions(commandOptions), tenantId },
      commandOptions.generateTypes,
    );
    result = await runMigratorCommand(command, migrator, commandOptions);
  });
  return result;
}

export async function runTenantMigrationCommand(
  command: MigrationCommand,
  config: OrmConfig,
  tenantPath: string | string[],
  tenantId: string,
  options: boolean | MigrationCommandOptions = {},
): Promise<MigrationCommandResult> {
  try {
    return await runTenantMigrator(command, config, tenantPath, tenantId, options);
  } finally {
    const context = ConnectionManager.getResolvedTenant(tenantId);
    ConnectionManager.purgeTenant(tenantId);
    if (context?.ownsConnection) {
      await context.connection.close();
    }
  }
}

export async function runConfiguredMigrationCommand(
  command: MigrationCommand,
  config: OrmConfig,
  connection: Connection,
  target: MigrationTarget,
  options: boolean | MigrationCommandOptions = {},
): Promise<MigrationCommandResult> {
  const commandOptions = normalizeCommandOptions(options);
  const previousConnectionLogQueries = connection.logQueries;
  const previousGlobalLogQueries = Connection.logQueries;
  connection.logQueries = false;
  Connection.logQueries = false;
  // Anything the run prints — a console.log inside a migration's up(), an event
  // listener, listTenants() — would otherwise corrupt the document on stdout.
  const restoreStdout = commandOptions.json ? relayStdoutToStderr() : undefined;
  try {
    const result = await runConfiguredMigrationCommandWithoutSqlLogging(command, config, connection, target, commandOptions);
    // One JSON document per invocation, written last: a tenant loop must not
    // produce one payload per tenant.
    if (commandOptions.json) writeToStdout(`${JSON.stringify(jsonPayload(command, result))}\n`);
    return result;
  } finally {
    restoreStdout?.();
    connection.logQueries = previousConnectionLogQueries;
    Connection.logQueries = previousGlobalLogQueries;
  }
}

async function runConfiguredMigrationCommandWithoutSqlLogging(
  command: MigrationCommand,
  config: OrmConfig,
  connection: Connection,
  target: MigrationTarget,
  options: MigrationCommandOptions = {},
): Promise<MigrationCommandResult> {
  const result: MigrationCommandResult = {};
  const progress = progressWriter(options);
  const landlordMigrator = (path: string | string[]) =>
    buildMigrator(config, connection, path, "landlord", migratorOptions(options), options.generateTypes);

  if (!config.migrations) {
    const defaultPath = getDefaultMigrationsPath(config);
    if (target.scope === "tenant" || target.scope === "tenants") {
      if (!config.tenancy?.resolveTenant) {
        throw new Error("Tenant migrations require tenancy.resolveTenant() in orm.config.ts.");
      }
      ConnectionManager.setTenantResolver(config.tenancy.resolveTenant);
      if (target.scope === "tenant") {
        return mergeResult(result, await runTenantMigrationCommand(command, config, defaultPath, target.tenantId, options));
      }
      for (const tenantId of await getTenantIds(config)) {
        mergeResult(result, await runTenantMigrationCommand(command, config, defaultPath, tenantId, options));
      }
      return result;
    }
    return mergeResult(result, await runMigratorCommand(command, landlordMigrator(defaultPath), options));
  }

  const landlordPath = config.migrations.landlord;
  const tenantPath   = config.migrations.tenant;

  const runLandlord = async () => {
    if (!landlordPath) return;
    progress("Landlord migrations");
    mergeResult(result, await runMigratorCommand(command, landlordMigrator(landlordPath), options));
  };

  const runAllTenants = async () => {
    if (!tenantPath) return;
    if (!config.tenancy?.resolveTenant) {
      throw new Error("Tenant migrations require tenancy.resolveTenant() in orm.config.ts.");
    }
    ConnectionManager.setTenantResolver(config.tenancy.resolveTenant);
    for (const tenantId of await getTenantIds(config)) {
      mergeResult(result, await runTenantMigrationCommand(command, config, tenantPath, tenantId, options));
    }
  };

  if (target.scope === "landlord") { await runLandlord(); return result; }
  if (target.scope === "tenants")  { await runAllTenants(); return result; }
  if (target.scope === "tenant") {
    if (!tenantPath) return result;
    if (!config.tenancy?.resolveTenant) {
      throw new Error("Tenant migrations require tenancy.resolveTenant() in orm.config.ts.");
    }
    ConnectionManager.setTenantResolver(config.tenancy.resolveTenant);
    return mergeResult(result, await runTenantMigrationCommand(command, config, tenantPath, target.tenantId, options));
  }

  // default: landlord first, then tenants (rollback reverses order)
  if (command === "migrate:rollback") {
    await runAllTenants();
    await runLandlord();
  } else {
    await runLandlord();
    await runAllTenants();
  }
  return result;
}

export async function runSeederCommand(
  config: OrmConfig,
  connection: Connection,
  scope: MigrationTarget,
  target?: string,
): Promise<void> {
  const seederPath = config.seedersPath || "./database/seeders";
  const runner = new SeederRunner(connection);

  const runDefault = async () => {
    if (target) { await runner.runTarget(target, seederPath); return; }
    await runner.runDefault(seederPath);
  };

  if (scope.scope === "default" || scope.scope === "landlord") { await runDefault(); return; }

  if (!config.tenancy?.resolveTenant) {
    throw new Error("Tenant seeding requires tenancy.resolveTenant() in orm.config.ts.");
  }
  ConnectionManager.setTenantResolver(config.tenancy.resolveTenant);

  if (scope.scope === "tenant") {
    await TenantContext.run(scope.tenantId, runDefault);
    return;
  }

  for (const tenantId of await getTenantIds(config)) {
    await TenantContext.run(tenantId, runDefault);
  }
}
