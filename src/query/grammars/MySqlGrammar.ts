import { Grammar } from "./Grammar.js";
import { formatDateForDriver } from "../../utils.js";

export class MySqlGrammar extends Grammar {
  override escape(value: any): string {
    return super.escape(value instanceof Date ? formatDateForDriver(value, "mysql") : value);
  }

  wrap(value: string): string {
    if (/\s+as\s+/i.test(value)) {
      const [column, alias] = value.split(/\s+as\s+/i);
      return `${this.wrap(column)} AS ${this.wrap(alias)}`;
    }
    if (value.includes(".")) {
      return value.split(".").map((v) => this.wrap(v)).join(".");
    }
    if (value === "*") return value;
    value = this.unwrapIdentifier(value);
    return `\`${value.replaceAll("`", "``")}\``;
  }

  placeholder(_index: number): string {
    return "?";
  }

  compileRandomOrder(): string {
    return "ORDER BY RAND()";
  }

  compileInsertDefault(table: string): string {
    return `INSERT INTO ${table} () VALUES ()`;
  }

  compileDateWhere(type: string, column: string, operator: string, value: any, binding?: (value: any) => string): string {
    const val = binding ? binding(value) : this.escape(value);
    switch (type) {
      case "date":
        return `DATE(${column}) ${operator} ${val}`;
      case "day":
        return `DAY(${column}) ${operator} ${val}`;
      case "month":
        return `MONTH(${column}) ${operator} ${val}`;
      case "year":
        return `YEAR(${column}) ${operator} ${val}`;
      case "time":
        return `TIME(${column}) ${operator} ${val}`;
      default:
        return `${column} ${operator} ${val}`;
    }
  }

  compileInsertOrIgnore(table: string, columns: string[], values: string[]): string {
    if (columns.length === 0) return `INSERT IGNORE INTO ${table} () VALUES ()`;
    return `INSERT IGNORE INTO ${table} (${columns.map((c) => this.wrap(c)).join(", ")}) VALUES ${values.join(", ")}`;
  }

  compileUpsert(
    table: string,
    columns: string[],
    values: string[],
    _uniqueBy: string[],
    updateColumns: string[]
  ): string {
    const updateCols = updateColumns
      .map((c) => `${this.wrap(c)} = VALUES(${this.wrap(c)})`)
      .join(", ");
    return `INSERT INTO ${table} (${columns.map((c) => this.wrap(c)).join(", ")}) VALUES ${values.join(", ")} ON DUPLICATE KEY UPDATE ${updateCols}`;
  }

  compileJsonContains(column: string, value: any, binding?: (value: any) => string): string {
    return `JSON_CONTAINS(${column}, ${binding ? binding(JSON.stringify(value)) : this.escape(JSON.stringify(value))})`;
  }

  compileJsonLength(column: string, operator: string, value: any, binding?: (value: any) => string): string {
    return `JSON_LENGTH(${column}) ${operator} ${binding ? binding(value) : this.escape(value)}`;
  }

  /**
   * `LIKE` follows the column's collation, which is case-insensitive under every
   * default. `LIKE BINARY` forces a byte comparison for the case-sensitive form.
   */
  override compileLike(
    column: string,
    value: string,
    not: boolean,
    binding?: (value: any) => string,
    caseSensitive: boolean = false
  ): string {
    if (!caseSensitive) return super.compileLike(column, value, not, binding);
    const op = not ? "NOT LIKE BINARY" : "LIKE BINARY";
    return `${column} ${op} ${binding ? binding(value) : this.escape(value)}`;
  }

  compileRegexp(column: string, value: string, not: boolean, binding?: (value: any) => string): string {
    const op = not ? "NOT REGEXP" : "REGEXP";
    return `${column} ${op} ${binding ? binding(value) : this.escape(value)}`;
  }

  compileFullText(columns: string[], value: string, options: import("../../fulltext.js").FullTextOptions, binding?: (value: any) => string): string {
    if (options.language !== undefined || options.vector !== undefined) {
      throw new Error("MySQL full-text search does not support language or vector options.");
    }
    if (options.mode !== undefined && options.mode !== "boolean") {
      throw new Error(`MySQL full-text search does not support ${options.mode} mode.`);
    }
    if (options.mode === "boolean" && options.expanded) {
      throw new Error("MySQL full-text search cannot combine boolean mode with query expansion.");
    }
    const mode = options.mode === "boolean" ? "IN BOOLEAN MODE" : "IN NATURAL LANGUAGE MODE";
    const expanded = options.expanded ? " WITH QUERY EXPANSION" : "";
    return `MATCH (${columns.join(", ")}) AGAINST (${binding ? binding(value) : this.escape(value)} ${mode}${expanded})`;
  }

  compileExplain(sql: string): string {
    return `EXPLAIN ${sql}`;
  }
}
