import { Command } from "../commands/Command.js";
import { ConnectionManager } from "../connection/ConnectionManager.js";
import { TenantContext } from "../connection/TenantContext.js";
import { TypeGenerator } from "../typegen/TypeGenerator.js";
import { discoverModelTables } from "../typegen/discoverModelTables.js";
import { normalizePathList, snakeCase } from "../utils.js";
import { writeFile } from "fs/promises";
import { join } from "path";
import { parseTargetFromOptions, getModelPaths, getScopeExclusions } from "./MigrationHelpers.js";
import type { Connection } from "../connection/Connection.js";
import type { OrmConfig } from "../config/OrmConfig.js";

export function makeTypesGenerateCommand(config: OrmConfig, connection: Connection) {
  return class extends Command.define("types:generate {dir? : Output directory for generated types} {--landlord : Generate types for landlord models} {--tenant= : Generate types for a specific tenant}") {
    static description = "Generate TypeScript model type declarations from the database schema.";

    async handle() {
      const explicitOutDir = this.argumentOptional("dir");
      const target         = parseTargetFromOptions(this);
      const { landlord: landlordModels, tenant: tenantModels } = getModelPaths(config);
      const allGeneratedTables = new Map<string, string[]>();

      // getModelPaths() mirrors a plain `modelsPath` string into both scopes, so
      // `landlordModels && tenantModels` is true even in a single-tenant project.
      // Only a config that really separates the two counts as scoped — otherwise
      // the default invocation entered the tenant branch and threw after having
      // already written the landlord files.
      const hasScopedModels = !!config.modelsPath
        && typeof config.modelsPath === "object"
        && !Array.isArray(config.modelsPath);
      const skipIndex = target.scope === "default" && hasScopedModels;

      // ── Landlord ──────────────────────────────────────────────────────────
      if ((target.scope === "default" || target.scope === "landlord") && landlordModels) {
        const modelRoots          = normalizePathList(landlordModels);
        const useModelTypesFolder = !explicitOutDir;
        const outDir              = explicitOutDir ?? join(modelRoots[0], "types");
        const landlordExcludes    = getScopeExclusions(landlordModels, tenantModels);
        const allowedTables       = modelRoots.length > 0 ? await discoverModelTables(modelRoots, landlordExcludes) : undefined;

        if (modelRoots.length > 0 && (!allowedTables || allowedTables.length === 0)) {
          this.warn(`No models discovered in landlord model path(s): ${modelRoots.join(", ")}`);
        }

        const generator = new TypeGenerator(connection, {
          outDir,
          stubs: config.typeStubs,
          declarations: !config.typeStubs,
          modelDeclarations: config.typeDeclarations,
          modelDirectory: !useModelTypesFolder ? modelRoots[0] : undefined,
          modelDirectories: useModelTypesFolder ? modelRoots : undefined,
          excludeModelDirectories: landlordExcludes,
          modelImportPrefix: config.typeDeclarationImportPrefix,
          singularModels: config.typeDeclarationSingularModels,
          declarationDirName: "types",
          allowedTables,
          skipIndex,
        });

        const tables      = await generator.generate();
        const outputLabel = useModelTypesFolder ? modelRoots.map((r) => join(r, "types")).join(", ") : outDir;
        allGeneratedTables.set(outDir, [...(allGeneratedTables.get(outDir) ?? []), ...tables]);
        this.info(`Generated landlord model type declarations in ${outputLabel}`);
      }

      // ── Tenant ────────────────────────────────────────────────────────────
      const tenantBranchApplies = !!tenantModels
        && (target.scope === "tenant" || (target.scope === "default" && hasScopedModels));

      if (tenantBranchApplies) {
        if (!config.tenancy?.resolveTenant) {
          throw new Error("Tenant type generation requires tenancy.resolveTenant() in orm.config.ts.");
        }
        await ConnectionManager.setTenantResolver(config.tenancy.resolveTenant);

        const tenantId = target.scope === "tenant"
          ? target.tenantId
          : config.tenancy.listTenants
            ? String((await config.tenancy.listTenants())[0])
            : undefined;

        if (!tenantId) {
          throw new Error("Tenant type generation requires either --tenant <id> or tenancy.listTenants() in orm.config.ts.");
        }

        await TenantContext.run(tenantId, async () => {
          const context         = TenantContext.current()!;
          const modelRoots      = normalizePathList(tenantModels);
          const useModelTypesFolder = !explicitOutDir;
          const outDir          = explicitOutDir ?? join(modelRoots[0], "types");
          const tenantExcludes  = getScopeExclusions(tenantModels, landlordModels);
          const allowedTables   = modelRoots.length > 0 ? await discoverModelTables(modelRoots, tenantExcludes) : undefined;

          if (modelRoots.length > 0 && (!allowedTables || allowedTables.length === 0)) {
            this.warn(`No models discovered in tenant model path(s): ${modelRoots.join(", ")}`);
          }

          const generator = new TypeGenerator(context.connection, {
            outDir,
            stubs: config.typeStubs,
            declarations: !config.typeStubs,
            modelDeclarations: config.typeDeclarations,
            modelDirectory: !useModelTypesFolder ? modelRoots[0] : undefined,
            modelDirectories: useModelTypesFolder ? modelRoots : undefined,
            excludeModelDirectories: tenantExcludes,
            modelImportPrefix: config.typeDeclarationImportPrefix,
            singularModels: config.typeDeclarationSingularModels,
            declarationDirName: "types",
            allowedTables,
            skipIndex,
          });

          const tables      = await generator.generate();
          const outputLabel = useModelTypesFolder ? modelRoots.map((r) => join(r, "types")).join(", ") : outDir;
          allGeneratedTables.set(outDir, [...(allGeneratedTables.get(outDir) ?? []), ...tables]);
          this.info(`Generated tenant model type declarations in ${outputLabel}`);
        });

        await ConnectionManager.closeTenant(tenantId);
      }

      // ── Combined index ────────────────────────────────────────────────────
      if (skipIndex) {
        for (const [outDir, tables] of allGeneratedTables) {
          const uniqueTables = [...new Set(tables)];
          const indexLines   = uniqueTables.map((table) => {
            const className = table
              .split("_")
              .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
              .join("");
            return `export * from "./${snakeCase(className)}";`;
          });
          await writeFile(join(outDir, "index.ts"), indexLines.join("\n") + "\n", "utf-8");
        }
      }
    }
  };
}
