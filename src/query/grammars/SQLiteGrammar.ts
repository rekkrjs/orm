import { Grammar } from "./Grammar.js";

export class SQLiteGrammar extends Grammar {
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
    return `"${value.replaceAll('"', '""')}"`;
  }

  placeholder(_index: number): string {
    return "?";
  }

  override compileUnionArm(sql: string): string {
    // SQLite rejects parentheses around a compound-SELECT arm ("near \"(\":
    // syntax error"); a derived table is the portable equivalent.
    return `SELECT * FROM (${sql})`;
  }

  compileRandomOrder(): string {
    return "ORDER BY RANDOM()";
  }

  compileInsertDefault(table: string): string {
    return `INSERT INTO ${table} DEFAULT VALUES`;
  }

  compileOffset(offset: number, limit?: number): string {
    const limitSql = limit === undefined ? "LIMIT -1 " : "";
    return `${limitSql}OFFSET ${offset}`;
  }

  compileDateWhere(type: string, column: string, operator: string, value: any, binding?: (value: any) => string): string {
    const val = binding ? binding(value) : this.escape(value);
    switch (type) {
      case "date":
        return `date(${column}) ${operator} ${val}`;
      case "day":
        return `CAST(strftime('%d', ${column}) AS INTEGER) ${operator} ${val}`;
      case "month":
        return `CAST(strftime('%m', ${column}) AS INTEGER) ${operator} ${val}`;
      case "year":
        return `CAST(strftime('%Y', ${column}) AS INTEGER) ${operator} ${val}`;
      case "time":
        return `time(${column}) ${operator} ${val}`;
      default:
        return `${column} ${operator} ${val}`;
    }
  }

  compileInsertOrIgnore(table: string, columns: string[], values: string[]): string {
    if (columns.length === 0) return `INSERT OR IGNORE INTO ${table} DEFAULT VALUES`;
    return `INSERT OR IGNORE INTO ${table} (${columns.map((c) => this.wrap(c)).join(", ")}) VALUES ${values.join(", ")}`;
  }

  compileUpsert(
    table: string,
    columns: string[],
    values: string[],
    uniqueBy: string[],
    updateColumns: string[]
  ): string {
    const updateCols = updateColumns
      .map((c) => `${this.wrap(c)} = excluded.${this.wrap(c)}`)
      .join(", ");
    return `INSERT INTO ${table} (${columns.map((c) => this.wrap(c)).join(", ")}) VALUES ${values.join(", ")} ON CONFLICT(${uniqueBy.map((c) => this.wrap(c)).join(", ")}) DO UPDATE SET ${updateCols}`;
  }

  compileJsonContains(column: string, value: any, binding?: (value: any) => string): string {
    const expected = binding ? binding(value) : this.escape(value);
    return `EXISTS (SELECT 1 FROM json_each(${column}) WHERE json_each.value = ${expected})`;
  }

  compileJsonDoesntContain(column: string, value: any, binding?: (value: any) => string): string {
    return `${column} IS NOT NULL AND NOT (${this.compileJsonContains(column, value, binding)})`;
  }

  compileJsonLength(column: string, operator: string, value: any, binding?: (value: any) => string): string {
    return `(SELECT COUNT(*) FROM json_each(${column})) ${operator} ${binding ? binding(value) : this.escape(value)}`;
  }

  /**
   * SQLite has no case-sensitive LIKE operator — `LIKE` folds ASCII case unless
   * `PRAGMA case_sensitive_like` is on, which the caller cannot be made to
   * guarantee. `GLOB` always compares exactly, so the case-sensitive form
   * switches operator and translates the pattern.
   *
   * `%` and `_` become `*` and `?`. GLOB's own metacharacters are escaped in the
   * same pass, never a second one: translating first and escaping afterwards
   * would re-escape the wildcards just produced and match them literally.
   */
  private static toGlobPattern(value: string): string {
    let out = "";
    for (const char of value) {
      if (char === "%") out += "*";
      else if (char === "_") out += "?";
      else if (char === "*" || char === "?" || char === "[") out += `[${char}]`;
      else out += char;
    }
    return out;
  }

  override compileLike(
    column: string,
    value: string,
    not: boolean,
    binding?: (value: any) => string,
    caseSensitive: boolean = false
  ): string {
    if (!caseSensitive) return super.compileLike(column, value, not, binding);
    const pattern = SQLiteGrammar.toGlobPattern(value);
    const op = not ? "NOT GLOB" : "GLOB";
    return `${column} ${op} ${binding ? binding(pattern) : this.escape(pattern)}`;
  }

  compileRegexp(column: string, value: string, not: boolean, binding?: (value: any) => string): string {
    const op = not ? "NOT REGEXP" : "REGEXP";
    return `${column} ${op} ${binding ? binding(value) : this.escape(value)}`;
  }

  compileFullText(columns: string[], value: string, options: import("../../fulltext.js").FullTextOptions, binding?: (value: any) => string): string {
    if (Object.keys(options).length > 0) {
      throw new Error("SQLite full-text fallback does not support full-text options. Use the SqliteFTS5Engine.");
    }
    const escaped = value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
    const clauses = columns.map((column) => `${column} LIKE ${binding ? binding(`%${escaped}%`) : this.escape(`%${escaped}%`)} ESCAPE '\\'`);
    return clauses.length === 1 ? clauses[0] : `(${clauses.join(" OR ")})`;
  }

  compileExplain(sql: string): string {
    return `EXPLAIN QUERY PLAN ${sql}`;
  }
}
