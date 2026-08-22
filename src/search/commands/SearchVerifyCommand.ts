import { Command } from "../../commands/Command.js";
import type { OrmConfig } from "../../config/OrmConfig.js";
import { Search } from "../SearchManager.js";
import { loadSearchableModels } from "./resolveSearchableModel.js";
import { runWithTenant } from "./runWithTenant.js";

interface VerifyRow {
  model: string;
  index: string;
  exists: boolean | "unknown";
  error?: string;
}

export function makeSearchVerifyCommand(config: OrmConfig) {
  return class extends Command.define(
    "search:verify " +
    "{--tenant= : Verify a single tenant context} " +
    "{--all-tenants : Verify across every tenant from config.listTenants} " +
    "{--include-landlord : With --all-tenants, also verify the landlord variant} " +
    "{--fix : Auto-create any missing indexes}",
  ) {
    static description = "Check that every searchable model has its index created on the engine.";

    async handle() {
      const models = await loadSearchableModels(config);
      if (models.length === 0) {
        this.warn("No searchable models discovered.");
        return;
      }

      const engine = Search.engine() as any;
      if (typeof engine.indexExists !== "function") {
        this.warn("Active engine does not implement indexExists(); cannot verify.");
        return;
      }

      const singleTenant = this.option("tenant") as string | undefined;
      const allTenants = Boolean(this.option("all-tenants"));
      const includeLandlord = Boolean(this.option("include-landlord"));
      const fix = Boolean(this.option("fix"));

      let scopes: Array<{ tenantId: string | null; label: string }> = [];
      if (singleTenant) {
        scopes = [{ tenantId: singleTenant, label: `tenant=${singleTenant}` }];
      } else if (allTenants) {
        const lister = Search.config()?.listTenants;
        const ids = lister ? ((await lister()) ?? []) : [];
        scopes = ids.map((id) => ({ tenantId: id, label: `tenant=${id}` }));
        if (includeLandlord) scopes.unshift({ tenantId: null, label: "landlord" });
      } else {
        scopes = [{ tenantId: null, label: "default" }];
      }

      let missing = 0;
      let fixed = 0;
      const errors: string[] = [];

      for (const scope of scopes) {
        this.line(`▶ ${scope.label}`);
        for (const ctor of models) {
          const row = await checkOne(ctor, scope.tenantId, engine, fix);
          if (row.exists === false) {
            missing++;
            if (fix) fixed++;
            this.warn(`  ✗ ${ctor.name.padEnd(24)} → ${row.index}${fix ? "  (CREATED)" : "  (MISSING)"}`);
          } else if (row.exists === true) {
            this.line(`  ✓ ${ctor.name.padEnd(24)} → ${row.index}`);
          } else {
            errors.push(`${ctor.name}: ${row.error}`);
            this.error(`  ! ${ctor.name.padEnd(24)} → ${row.index}  (${row.error})`);
          }
        }
      }

      this.line("");
      if (errors.length > 0) {
        this.error(`Errors: ${errors.length}`);
        process.exitCode = 1;
      } else if (missing > 0 && !fix) {
        this.warn(`Missing: ${missing}. Re-run with --fix to create.`);
        process.exitCode = 1;
      } else if (fix && fixed > 0) {
        this.info(`Created ${fixed} missing index(es). All verified.`);
      } else {
        this.info(`All indexes present.`);
      }
    }

  };
}

async function checkOne(
  ctor: any,
  tenantId: string | null,
  engine: any,
  fix: boolean,
): Promise<VerifyRow> {
  return await runWithTenant(tenantId ?? undefined, async (): Promise<VerifyRow> => {
    const index = ctor.searchableAs();
    try {
      const exists = await engine.indexExists(index);
      if (exists) return { model: ctor.name, index, exists: true };
      if (!fix) return { model: ctor.name, index, exists: false };
      const ftsConfig = ctor.searchFtsConfig;
      if (ftsConfig && typeof engine.configureIndex === "function") {
        engine.configureIndex(index, ftsConfig);
      }
      await engine.createIndex(index, { primaryKey: ctor.primaryKey ?? "id" });
      return { model: ctor.name, index, exists: false };
    } catch (err) {
      return {
        model: ctor.name,
        index,
        exists: "unknown",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}
