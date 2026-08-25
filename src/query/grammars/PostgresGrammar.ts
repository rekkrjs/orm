import { Grammar } from "./Grammar.js";

export class PostgresGrammar extends Grammar {
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

  placeholder(index: number): string {
    return `$${index}`;
  }

  override compileDelete(table: string, wheres: string, joins?: string[], limit?: number): string {
    // PostgreSQL has no DELETE ... LIMIT. Emitting it produces a syntax error at
    // the server; failing here says what to do instead.
    if (limit !== undefined) {
      throw new Error(
        "PostgreSQL does not support DELETE ... LIMIT. Select the rows first and delete by key, e.g. " +
        "`whereIn(pk, await query.limit(n).pluck(pk)).delete()`.",
      );
    }
    return super.compileDelete(table, wheres, joins);
  }

  compileRandomOrder(): string {
    return "ORDER BY RANDOM()";
  }

  compileInsertDefault(table: string): string {
    return `INSERT INTO ${table} DEFAULT VALUES`;
  }

  compileDateWhere(type: string, column: string, operator: string, value: any, binding?: (value: any) => string): string {
    const val = binding ? binding(value) : this.escape(value);
    switch (type) {
      case "date":
        return `(${column})::date ${operator} ${val}`;
      case "day":
        return `EXTRACT(DAY FROM ${column}) ${operator} ${val}`;
      case "month":
        return `EXTRACT(MONTH FROM ${column}) ${operator} ${val}`;
      case "year":
        return `EXTRACT(YEAR FROM ${column}) ${operator} ${val}`;
      case "time":
        return `(${column})::time ${operator} ${val}`;
      default:
        return `${column} ${operator} ${val}`;
    }
  }

  compileInsertOrIgnore(table: string, columns: string[], values: string[]): string {
    if (columns.length === 0) return `${this.compileInsertDefault(table)} ON CONFLICT DO NOTHING`;
    return `INSERT INTO ${table} (${columns.map((c) => this.wrap(c)).join(", ")}) VALUES ${values.join(", ")} ON CONFLICT DO NOTHING`;
  }

  compileUpsert(
    table: string,
    columns: string[],
    values: string[],
    uniqueBy: string[],
    updateColumns: string[]
  ): string {
    const updateCols = updateColumns
      .map((c) => `${this.wrap(c)} = EXCLUDED.${this.wrap(c)}`)
      .join(", ");
    return `INSERT INTO ${table} (${columns.map((c) => this.wrap(c)).join(", ")}) VALUES ${values.join(", ")} ON CONFLICT (${uniqueBy.map((c) => this.wrap(c)).join(", ")}) DO UPDATE SET ${updateCols}`;
  }

  compileJsonContains(column: string, value: any, binding?: (value: any) => string): string {
    const expected = binding ? binding(JSON.stringify([value])) : this.escape(JSON.stringify([value]));
    return `${column}::jsonb @> ${expected}::jsonb`;
  }

  compileJsonLength(column: string, operator: string, value: any, binding?: (value: any) => string): string {
    return `jsonb_array_length(${column}) ${operator} ${binding ? binding(value) : this.escape(value)}`;
  }

  /** `LIKE` is case-sensitive here, so the insensitive default needs `ILIKE`. */
  override compileLike(
    column: string,
    value: string,
    not: boolean,
    binding?: (value: any) => string,
    caseSensitive: boolean = false
  ): string {
    if (caseSensitive) return super.compileLike(column, value, not, binding, true);
    const op = not ? "NOT ILIKE" : "ILIKE";
    return `${column} ${op} ${binding ? binding(value) : this.escape(value)}`;
  }

  compileRegexp(column: string, value: string, not: boolean, binding?: (value: any) => string): string {
    const op = not ? "!~" : "~";
    return `${column} ${op} ${binding ? binding(value) : this.escape(value)}`;
  }

  compileFullText(columns: string[], value: string, binding?: (value: any) => string): string {
    const cols = columns.length > 1
      ? `concat_ws(' ', ${columns.join(", ")})`
      : columns[0];
    return `to_tsvector('english', ${cols}) @@ plainto_tsquery('english', ${binding ? binding(value) : this.escape(value)})`;
  }

  compileExplain(sql: string): string {
    return `EXPLAIN (FORMAT JSON) ${sql}`;
  }
}
