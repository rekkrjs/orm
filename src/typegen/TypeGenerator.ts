import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join, relative, resolve } from "path";
import { Connection } from "../connection/Connection.js";
import { TypeMapper } from "./TypeMapper.js";

/** A generated stub extends Model, whose default timestamp pair is active. */
const DEFAULT_TIMESTAMP_COLUMNS = ["created_at", "updated_at"];
import { discoverModelDeclarations, type ModelDeclarationInfo } from "./discoverModelTables.js";
import { normalizePathList, snakeCase } from "../utils.js";
import { Model } from "../model/Model.js";

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** A column name as a property key: quoted unless it is an identifier (`first-name`, `2fa`). */
function propertyKey(name: string): string {
  return IDENTIFIER.test(name) ? name : JSON.stringify(name);
}

/**
 * Instance members every model inherits (`save`, `delete`, `toJSON`, `constructor`...).
 * A column of that name cannot become a property of the model class; it stays
 * reachable, typed, through `getAttribute()`.
 */
function modelMembers(): Set<string> {
  const names = new Set(Object.keys(new Model()));
  for (let proto = Model.prototype; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    for (const name of Object.getOwnPropertyNames(proto)) names.add(name);
  }
  return names;
}

/**
 * tsconfig.json is JSON with comments and trailing commas. Strings are matched
 * first so that `"@/*"` or a URL is never mistaken for the start of a comment.
 */
export function parseJsonc(text: string): unknown {
  return JSON.parse(text
    .replace(/^\uFEFF/, "")
    .replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_, string) => string ?? "")
    .replace(/("(?:\\.|[^"\\])*")|,(\s*[}\]])/g, (_, string, close) => string ?? close));
}

interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  default?: any;
}

export interface ModelDeclaration {
  path: string;
  className?: string;
}

export interface TypeGeneratorOptions {
  outDir: string;
  stubs?: boolean;
  declarations?: boolean;
  modelDeclarations?: Record<string, string | ModelDeclaration>;
  modelDirectory?: string;
  modelDirectories?: string[];
  excludeModelDirectories?: string[];
  modelImportPrefix?: string;
  singularModels?: boolean;
  declarationDirName?: string;
  allowedTables?: string[];
  skipIndex?: boolean;
  tsconfigPath?: string;
  /** Where warnings go. Defaults to console.warn. */
  warn?: (message: string) => void;
}

export class TypeGenerator {
  constructor(
    private connection: Connection,
    private options: TypeGeneratorOptions
  ) {}

  async generate(): Promise<string[]> {
    const driver = this.connection.getDriverName();
    const bigint = this.connection.getConfig().bigint ?? false;
    let tables = await this.getTables();
    if (this.options.allowedTables) {
      const allowed = new Set(this.options.allowedTables.map((t) => t.toLowerCase()));
      tables = tables.filter((t) => allowed.has(t.toLowerCase()));
    }
    const declarationOnly = this.options.declarations ?? !this.options.stubs;
    const targets: { outDir: string; modelImportPrefix?: string; modelDirectory?: string }[] = declarationOnly
      ? this.getDeclarationTargets()
      : [{ outDir: this.options.outDir }];

    const tsconfigAliases = declarationOnly ? await this.readTsconfigPaths() : new Map<string, string>();

    for (const target of targets) {
      await mkdir(target.outDir, { recursive: true });

      const discovered = target.modelDirectory
        ? await discoverModelDeclarations(target.modelDirectory, target.outDir, this.options.excludeModelDirectories)
        : new Map<string, ModelDeclarationInfo>();

      for (const table of tables) {
        const columns = await this.getColumns(table);
        const className = this.toClassName(table);
        const interfaceName = `${className}Attributes`;

        const lines: string[] = [];

        const modelDeclarations = this.getModelDeclarations(table, className, discovered, target.modelImportPrefix, tsconfigAliases);
        const model = discovered.get(table);
        if (declarationOnly && model?.defaultExport && !this.options.modelDeclarations?.[table]) {
          (this.options.warn ?? console.warn)(
            `${model.className} in ${relative(process.cwd(), model.absolutePath)} is a default export, so the types generated ` +
              `for "${table}" do not apply to it: TypeScript merges them only into a named export. ` +
              `Export it as \`export class ${model.className}\`.`,
          );
        }
        // The SQL type alone cannot tell whether a model decodes a column. Ask
        // the model when one was discovered. Only generated stubs have a safe
        // fallback: they extend Model with its default timestamp pair active.
        const discoveredDates = discovered.get(table)?.dateCastColumns;
        const fallbackDates = !declarationOnly && this.options.stubs
          ? DEFAULT_TIMESTAMP_COLUMNS
          : [];
        const dateColumns = new Set(discoveredDates ?? fallbackDates);
        const columnType = (col: { name: string; type: string; nullable: boolean }): string =>
          dateColumns.has(col.name)
            ? (col.nullable ? "Date | null" : "Date")
            : TypeMapper.sqlToTsType(col.type, col.nullable, driver, bigint);

        if (!declarationOnly) {
          lines.push(`import { Model } from "@rekkr/orm";`);
          lines.push("");
        }

        lines.push(`export interface ${interfaceName} {`);
        for (const col of columns) {
          const tsType = columnType(col);
          lines.push(`  ${propertyKey(col.name)}${col.nullable ? "?" : ""}: ${tsType};`);
        }
        lines.push("}");
        lines.push("");

        const members = modelMembers();
        const clashing = columns.filter((col) => members.has(col.name)).map((col) => JSON.stringify(col.name));
        const merged = clashing.length > 0 ? `Omit<${interfaceName}, ${clashing.join(" | ")}>` : interfaceName;

        if (declarationOnly && modelDeclarations.length > 0) {
          for (const decl of modelDeclarations) {
            lines.push(`declare module "${decl.path}" {`);
            lines.push(`  interface ${decl.className} extends ${merged} {`);
            lines.push(`    getAttribute<K extends keyof ${interfaceName}>(key: K): ${interfaceName}[K];`);
            lines.push(`    getAttribute(key: string): any;`);
            lines.push(`    setAttribute<K extends keyof ${interfaceName}>(key: K, value: ${interfaceName}[K]): void;`);
            lines.push(`  }`);
            lines.push("}");
            lines.push("");
          }
        }

        if (!declarationOnly && this.options.stubs) {
          lines.push(`export class ${className}Base extends Model<${interfaceName}> {`);
          lines.push(`  static override table = "${table}";`);
          lines.push("");

          for (const col of columns) {
            // No accessor for a name that is not an identifier or that a Model member already takes.
            if (!IDENTIFIER.test(col.name) || members.has(col.name)) continue;
            const tsType = columnType(col);
            // A nullable column is optional in the interface, so getAttribute() may return undefined.
            lines.push(`  get ${col.name}(): ${tsType}${col.nullable ? " | undefined" : ""} {`);
            lines.push(`    return this.getAttribute("${col.name}");`);
            lines.push(`  }`);
            lines.push(`  set ${col.name}(value: ${tsType}) {`);
            lines.push(`    this.setAttribute("${col.name}", value);`);
            lines.push(`  }`);
            lines.push("");
          }

          lines.push("}");
        }

        const ext = declarationOnly ? "d.ts" : "ts";
        const fileName = `${snakeCase(className)}.${ext}`;
        const filePath = join(target.outDir, fileName);
        await writeFile(filePath, lines.join("\n") + "\n", "utf-8");
      }

      if (!this.options.skipIndex) {
        const ext = declarationOnly ? "d.ts" : "ts";
        const indexLines = tables.map((table) => {
          const className = this.toClassName(table);
          const fileName = snakeCase(className);
          return `export * from "./${fileName}";`;
        });
        await writeFile(join(target.outDir, `index.${ext}`), indexLines.join("\n") + "\n", "utf-8");
      }
    }
    return tables;
  }

  private async readTsconfigPaths(): Promise<Map<string, string>> {
    const tsconfigPath = this.options.tsconfigPath || join(process.cwd(), "tsconfig.json");
    const result = new Map<string, string>();
    try {
      const content = await readFile(tsconfigPath, "utf-8");
      const parsed = parseJsonc(content) as {
        compilerOptions?: { paths?: Record<string, string[]>; baseUrl?: string };
      };
      const paths = parsed.compilerOptions?.paths ?? {};
      const baseUrl = parsed.compilerOptions?.baseUrl ?? ".";
      const baseDir = join(dirname(tsconfigPath), baseUrl);

      for (const [pattern, values] of Object.entries(paths)) {
        if (!pattern.endsWith("/*")) continue;
        const aliasPrefix = pattern.slice(0, -2);
        for (const value of values) {
          if (!value.endsWith("/*")) continue;
          const resolvedDir = resolve(baseDir, value.slice(0, -2));
          result.set(aliasPrefix, resolvedDir);
        }
      }
    } catch {
      // tsconfig not found or unparseable — no aliases
    }
    return result;
  }

  private getModelDeclarations(
    table: string,
    fallbackClassName: string,
    discovered: Map<string, ModelDeclarationInfo>,
    modelImportPrefix: string | undefined,
    tsconfigAliases: Map<string, string>
  ): { path: string; className: string }[] {
    const declaration = this.options.modelDeclarations?.[table];
    if (declaration) {
      const path = typeof declaration === "string" ? declaration : declaration.path;
      const cls = typeof declaration === "string"
        ? this.toModelClassName(table, fallbackClassName)
        : (declaration.className || this.toModelClassName(table, fallbackClassName));
      return [{ path, className: cls }];
    }

    const info = discovered.get(table);
    if (info) {
      const prefix = modelImportPrefix || this.options.modelImportPrefix;
      const paths: { path: string; className: string }[] = [];

      // Primary path: relative or alias-prefix based
      if (prefix) {
        paths.push({ path: `${prefix.replace(/\/$/, "")}/${info.relativeToRoot}`, className: info.className });
      } else {
        paths.push({ path: info.relativePath, className: info.className });
      }

      // Additional alias paths from tsconfig
      for (const [aliasPrefix, aliasDir] of tsconfigAliases) {
        const rel = relative(aliasDir, info.absolutePath).replace(/\.[^/.]+$/, "");
        if (!rel.startsWith("..")) {
          const aliasPath = `${aliasPrefix}/${rel}`;
          if (!paths.some((p) => p.path === aliasPath)) {
            paths.push({ path: aliasPath, className: info.className });
          }
        }
      }

      return paths;
    }

    const convention = this.getConventionModelDeclaration(table, modelImportPrefix);
    return convention ? [convention] : [];
  }

  private getConventionModelDeclaration(table: string, modelImportPrefix?: string): { path: string; className: string } | null {
    const prefix = modelImportPrefix || this.options.modelImportPrefix || this.options.modelDirectory;
    if (!prefix) return null;
    const className = this.toModelClassName(table);
    return {
      path: `${prefix.replace(/\/$/, "")}/${className}`,
      className,
    };
  }

  private toModelClassName(table: string, fallback?: string): string {
    if (this.options.singularModels === false) {
      return fallback || this.toClassName(table);
    }
    return this.toClassName(this.singularizeTable(table));
  }

  private singularizeTable(table: string): string {
    return table
      .split("_")
      .map((part) => this.singularizeWord(part))
      .join("_");
  }

  private singularizeWord(word: string): string {
    if (word.endsWith("ies") && word.length > 3) return `${word.slice(0, -3)}y`;
    if (word.endsWith("ses") || word.endsWith("xes") || word.endsWith("zes") || word.endsWith("ches") || word.endsWith("shes")) {
      return word.slice(0, -2);
    }
    if (word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
    return word;
  }

  private async getTables(): Promise<string[]> {
    const driver = this.connection.getDriverName();
    let sql: string;
    let bindings: any[] = [];

    if (driver === "sqlite") {
      sql = `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_inner_sequence' AND name != 'migrations'`;
    } else if (driver === "mysql") {
      sql = "SHOW TABLES";
    } else {
      const schema = this.connection.getSchema() || "public";
      sql = `SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'`;
      bindings = [schema];
    }

    const rows = await this.connection.queryPrimary(sql, bindings);

    if (driver === "sqlite") {
      return rows.map((r: any) => r.name);
    } else if (driver === "mysql") {
      const key = Object.keys(rows[0] ?? {})[0] ?? "Tables_in_" + (await this.getCurrentDatabase());
      return rows.map((r: any) => r[key]);
    } else {
      return rows.map((r: any) => r.table_name);
    }
  }

  private getDeclarationTargets(): { outDir: string; modelImportPrefix: string; modelDirectory?: string }[] {
    const modelDirectories = normalizePathList(this.options.modelDirectories || this.options.modelDirectory);
    if (modelDirectories.length === 0) {
      return [
        {
          outDir: this.options.outDir,
          modelImportPrefix: this.options.modelImportPrefix || this.options.modelDirectory || "",
        },
      ];
    }

    // A single root with an explicit output directory (`orm types:generate <dir>`)
    // writes there, importing the models by their path relative to it.
    if (!this.options.modelDirectories && this.options.modelDirectory) {
      return [{ outDir: this.options.outDir, modelImportPrefix: this.options.modelImportPrefix || "", modelDirectory: this.options.modelDirectory }];
    }

    const declarationDirName = this.options.declarationDirName || "types";
    return modelDirectories.map((dir) => ({
      outDir: join(dir, declarationDirName),
      modelImportPrefix: this.options.modelImportPrefix || "..",
      modelDirectory: dir,
    }));
  }

  private async getCurrentDatabase(): Promise<string> {
    const rows = await this.connection.queryPrimary<{ db: string }>("SELECT DATABASE() as db");
    return rows[0]?.db || "";
  }

  private async getColumns(table: string): Promise<ColumnInfo[]> {
    const driver = this.connection.getDriverName();

    if (driver === "sqlite") {
      const rows = await this.connection.queryPrimary(`PRAGMA table_info(${table})`);
      return rows.map((r: any) => ({
        name: r.name,
        type: r.type,
        nullable: !r.notnull,
        default: r.dflt_value,
      }));
    }

    if (driver === "mysql") {
      const rows = await this.connection.queryPrimary(`SHOW COLUMNS FROM ${table}`);
      return rows.map((r: any) => ({
        name: r.Field,
        type: r.Type,
        nullable: r.Null === "YES",
        default: r.Default,
      }));
    }

    // postgres
    const schema = this.connection.getSchema() || "public";
    const rows = await this.connection.queryPrimary(
      `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = $1 AND table_schema = $2 ORDER BY ordinal_position`,
      [table, schema]
    );
    return rows.map((r: any) => ({
      name: r.column_name,
      type: r.data_type,
      nullable: r.is_nullable === "YES",
      default: r.column_default,
    }));
  }

  private toClassName(table: string): string {
    return table
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join("");
  }
}
