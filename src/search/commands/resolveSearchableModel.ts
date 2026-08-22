import { readdir } from "fs/promises";
import { existsSync } from "fs";
import { basename, extname, join, resolve } from "path";
import { pathToFileURL } from "url";
import { normalizePathList } from "../../utils.js";
import type { OrmConfig } from "../../config/OrmConfig.js";
import type { ModelConstructor } from "../../model/Model.js";
import type { SearchableModelConstructor } from "../Searchable.js";

async function walkModelFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await walkModelFiles(full));
      continue;
    }
    if (!entry.isFile()) continue;
    const name = entry.name;
    if (name.endsWith(".d.ts") || name.endsWith(".test.ts") || name.endsWith(".spec.ts")) continue;
    if (![".ts", ".js", ".mts", ".mjs"].includes(extname(name))) continue;
    out.push(full);
  }
  return out;
}

function modelPathRoots(config: OrmConfig): string[] {
  const mp = config.modelsPath;
  if (!mp) return [];
  if (typeof mp === "string" || Array.isArray(mp)) return normalizePathList(mp);
  const combined: string[] = [];
  if (mp.landlord) combined.push(...normalizePathList(mp.landlord));
  if (mp.tenant) combined.push(...normalizePathList(mp.tenant));
  return combined;
}

async function loadSearchableModelMap(config: OrmConfig): Promise<Map<string, SearchableModelConstructor>> {
  const roots = modelPathRoots(config);
  const loaded = new Map<string, SearchableModelConstructor>();
  const register = (name: string | undefined, ctor: unknown) => {
    if (!name || typeof ctor !== "function") return;
    const model = ctor as unknown as SearchableModelConstructor & ModelConstructor;
    if (model.searchable === true && typeof model.searchableAs === "function") {
      loaded.set(name, model);
    }
  };

  for (const root of roots) {
    const abs = resolve(process.cwd(), root);
    if (!existsSync(abs)) continue;
    const files = await walkModelFiles(abs);
    for (const file of files) {
      const mod = await import(pathToFileURL(file).href);
      for (const [exportName, exported] of Object.entries(mod)) {
        if (exportName === "default") continue;
        register(exportName, exported);
      }
      if (typeof mod.default === "function") {
        const fileName = basename(file, extname(file));
        register(fileName, mod.default);
        register(mod.default.name, mod.default);
      }
    }
  }
  return loaded;
}

export async function loadSearchableModels(config: OrmConfig): Promise<SearchableModelConstructor[]> {
  const loaded = await loadSearchableModelMap(config);
  return [...loaded.values()];
}

export async function resolveSearchableModel(
  config: OrmConfig,
  name: string,
): Promise<SearchableModelConstructor | undefined> {
  const loaded = await loadSearchableModelMap(config);
  return loaded.get(name) ?? [...loaded.values()].find((m) => m.name === name);
}
