import type { FullTextOptions } from "../../fulltext.js";

export abstract class Grammar {
  abstract wrap(value: string): string;

  protected unwrapIdentifier(value: string): string {
    const pairs: Array<[string, string, RegExp]> = [
      ['"', '"', /""/g],
      ["`", "`", /``/g],
      ["[", "]", /]]/g],
    ];
    for (const [prefix, suffix, escapedSuffix] of pairs) {
      if (value.startsWith(prefix) && value.endsWith(suffix) && value.length >= 2) {
        return value.slice(1, -1).replace(escapedSuffix, suffix);
      }
    }
    return value;
  }

  wrapArray(values: string[]): string[] {
    return values.map((v) => this.wrap(v));
  }

  abstract placeholder(index: number): string;

  escape(value: any): string {
    if (value === null) return "NULL";
    if (typeof value === "boolean") return value ? "1" : "0";
    if (typeof value === "number") return String(value);
    if (value instanceof Date) value = value.toISOString();
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  abstract compileRandomOrder(): string;

  compileOffset(offset: number, _limit?: number): string {
    return `OFFSET ${offset}`;
  }

  compileLock(lockMode?: string): string {
    return lockMode ? ` ${lockMode}` : "";
  }

  abstract compileDateWhere(type: string, column: string, operator: string, value: any, binding?: (value: any) => string): string;

  abstract compileInsertDefault(table: string): string;

  abstract compileInsertOrIgnore(table: string, columns: string[], values: string[]): string;

  abstract compileUpsert(
    table: string,
    columns: string[],
    values: string[],
    uniqueBy: string[],
    updateColumns: string[]
  ): string;

  compileUpdate(table: string, sets: string[], wheres: string, joins?: string[]): string {
    let sql = `UPDATE ${table}`;
    if (joins && joins.length > 0) {
      sql += ` ${joins.join(" ")}`;
    }
    sql += ` SET ${sets.join(", ")}`;
    if (wheres) sql += ` ${wheres}`;
    return sql.trim();
  }

  /**
   * Scopes one arm of a compound (UNION) query so that an ORDER BY / LIMIT it
   * declares stays inside that arm instead of binding to the whole compound.
   * Postgres and MySQL accept plain parentheses; SQLite does not (see its
   * override) — hence the grammar hook rather than a literal in the builder.
   */
  compileUnionArm(sql: string): string {
    return `(${sql})`;
  }

  compileDelete(table: string, wheres: string, joins?: string[], limit?: number): string {
    let sql = `DELETE FROM ${table}`;
    if (joins && joins.length > 0) {
      sql += ` ${joins.join(" ")}`;
    }
    if (wheres) sql += ` ${wheres}`;
    if (limit !== undefined) sql += ` LIMIT ${limit}`;
    return sql.trim();
  }

  abstract compileJsonContains(column: string, value: any, binding?: (value: any) => string): string;

  compileJsonDoesntContain(column: string, value: any, binding?: (value: any) => string): string {
    return `NOT (${this.compileJsonContains(column, value, binding)})`;
  }

  abstract compileJsonLength(column: string, operator: string, value: any, binding?: (value: any) => string): string;

  /**
   * Pattern matching, case-insensitive by default.
   *
   * Each dialect gets the operator that expresses the intent natively rather
   * than `LOWER(column) LIKE LOWER(?)`, which would make an index on the column
   * unusable everywhere to buy what two of the three dialects already do. The
   * cost is that the default follows the dialect's own configuration: SQLite
   * honours `PRAGMA case_sensitive_like`, MySQL the column's collation. Pass
   * `caseSensitive` when the comparison must not depend on either.
   */
  compileLike(
    column: string,
    value: string,
    not: boolean,
    binding?: (value: any) => string,
    caseSensitive: boolean = false
  ): string {
    const op = not ? "NOT LIKE" : "LIKE";
    return `${column} ${op} ${binding ? binding(value) : this.escape(value)}`;
  }

  abstract compileRegexp(column: string, value: string, not: boolean, binding?: (value: any) => string): string;

  /** `columns` contains identifiers already wrapped by Builder. */
  abstract compileFullText(columns: string[], value: string, options: Readonly<FullTextOptions>, binding?: (value: any) => string): string;

  abstract compileExplain(sql: string): string;
}
