import { Grammar } from "./Grammar.js";
import type { ColumnDefinition } from "../../types/index.js";

export class PostgresGrammar extends Grammar {
  protected wrappers = { prefix: '"', suffix: '"' };

  protected getDefaultValue(value: any): string {
    if (typeof value === "boolean") {
      return value ? "TRUE" : "FALSE";
    }
    return super.getDefaultValue(value);
  }

  protected getType(column: ColumnDefinition): string {
    switch (column.type) {
      case "string":
        return `VARCHAR(${column.length || 255})`;
      case "char":
        return `CHAR(${column.length || 255})`;
      case "text":
      // Postgres has a single unbounded text type; TEXT holds ~1GB, past both.
      case "mediumText":
      case "longText":
        return "TEXT";
      case "integer":
        return "INTEGER";
      case "bigInteger":
        return "BIGINT";
      case "smallInteger":
        return "SMALLINT";
      case "tinyInteger":
        return "SMALLINT";
      case "float":
        return `REAL`;
      case "double":
        return `DOUBLE PRECISION`;
      case "decimal":
        return `DECIMAL(${column.precision || 8}, ${column.scale || 2})`;
      case "boolean":
        return "BOOLEAN";
      case "date":
        return "DATE";
      case "dateTime":
        return `TIMESTAMP(${column.precision ?? 0}) WITHOUT TIME ZONE`;
      case "time":
        return `TIME(${column.precision ?? 0}) WITHOUT TIME ZONE`;
      case "timestamp":
        return `TIMESTAMP(${column.precision ?? 0}) WITHOUT TIME ZONE`;
      case "json":
        return "JSON";
      case "jsonb":
        return "JSONB";
      case "binary":
        return "BYTEA";
      case "uuid":
        return "UUID";
      case "enum":
        return `VARCHAR(255)`;
      default:
        return "TEXT";
    }
  }

  protected modifyAutoIncrement(column: ColumnDefinition): string {
    if (column.autoIncrement) {
      return column.type === "bigInteger" ? " GENERATED ALWAYS AS IDENTITY" : " GENERATED ALWAYS AS IDENTITY";
    }
    return "";
  }

  protected modifyDefaultUuid(_column: ColumnDefinition): string {
    return " DEFAULT gen_random_uuid()";
  }

  protected getColumn(_blueprint: any, column: ColumnDefinition): string {
    let sql = `${this.wrap(column.name)} ${this.getType(column)}`;
    if (!column.nullable) sql += " NOT NULL";
    if (column.defaultUuid) sql += this.modifyDefaultUuid(column);
    else if (column.default !== null && column.default !== undefined) {
      sql += ` DEFAULT ${this.getColumnDefault(column)}`;
    }
    if (column.autoIncrement) sql += this.modifyAutoIncrement(column);
    if (column.primary) sql += " PRIMARY KEY";
    sql += this.compileEnumCheck(column);
    return sql;
  }

  compileColumnRename(table: string, from: string, to: string): string {
    return `ALTER TABLE ${this.wrap(table)} RENAME COLUMN ${this.wrap(from)} TO ${this.wrap(to)}`;
  }

  compileDropColumn(table: string, columns: string[]): string {
    return `ALTER TABLE ${this.wrap(table)} ${columns.map((col) => `DROP COLUMN ${this.wrap(col)}`).join(", ")}`;
  }

  compileChange(table: string, column: ColumnDefinition): string[] {
    this.assertPortableChange(column);
    const alter = `ALTER TABLE ${this.wrap(table)} ALTER COLUMN ${this.wrap(column.name)}`;
    // The old default is still attached while TYPE runs, and Postgres refuses a
    // type change whose existing default cannot be cast to the new type. Drop it
    // first, then restate it in the new type's terms. DROP DEFAULT on a column
    // that has none is a no-op, so it is safe to emit unconditionally — and it
    // is what resets a default the blueprint no longer declares.
    const statements = [
      `${alter} DROP DEFAULT`,
      `${alter} TYPE ${this.getType(column)}`,
      `${alter} ${column.nullable ? "DROP" : "SET"} NOT NULL`,
    ];
    if (column.defaultUuid) {
      statements.push(`${alter} SET${this.modifyDefaultUuid(column)}`);
    } else if (column.default !== null && column.default !== undefined) {
      statements.push(`${alter} SET DEFAULT ${this.getColumnDefault(column)}`);
    }
    statements.push(
      `COMMENT ON COLUMN ${this.wrap(table)}.${this.wrap(column.name)} IS ${this.getDefaultValue(column.comment ?? null)}`,
    );
    return statements;
  }

  compileIndex(table: string, index: any): string {
    const type = index.unique ? "UNIQUE INDEX" : "INDEX";
    return `CREATE ${type} ${this.wrap(index.name)} ON ${this.wrap(table)} (${this.wrapArray(index.columns).join(", ")})`;
  }

  protected compileForeignKey(table: string, fk: any): string {
    const constraint = fk.name ? ` CONSTRAINT ${this.wrap(fk.name)}` : "";
    const referencedTable = fk.onTable.includes(".")
      ? fk.onTable
      : table.includes(".")
      ? `${table.split(".")[0]}.${fk.onTable}`
      : fk.onTable;
    const sql = `ALTER TABLE ${this.wrap(table)} ADD${constraint} FOREIGN KEY (${this.wrapArray(fk.columns).join(", ")}) REFERENCES ${this.wrap(referencedTable)} (${this.wrapArray(fk.references).join(", ")})`;
    let full = sql;
    if (fk.onDelete) full += ` ON DELETE ${fk.onDelete}`;
    if (fk.onUpdate) full += ` ON UPDATE ${fk.onUpdate}`;
    return full;
  }

  compileCreate(blueprint: any, table: string): string {
    const columns = this.getTableDefinitions(blueprint).map((col) => `    ${col}`).join(",\n");
    const sql = `CREATE TABLE ${this.wrap(table)} (\n${columns}\n)`;
    return sql;
  }

  compileCreateIfNotExists(blueprint: any, table: string): string {
    const columns = this.getTableDefinitions(blueprint).map((col) => `    ${col}`).join(",\n");
    const sql = `CREATE TABLE IF NOT EXISTS ${this.wrap(table)} (\n${columns}\n)`;
    return sql;
  }
}
