import { Grammar } from "./Grammar.js";
import type { ColumnDefinition } from "../../types/index.js";
import { SchemaRawExpression } from "../RawExpression.js";

export class MySqlGrammar extends Grammar {
  protected wrappers = { prefix: "`", suffix: "`" };

  private needsHexLiteral(value: string): boolean {
    return /[\\\0\x1a]/.test(value);
  }

  private getStringLiteral(value: string, declareUtf8 = false): string {
    if (this.needsHexLiteral(value)) {
      const literal = `X'${Buffer.from(value, "utf8").toString("hex")}'`;
      return declareUtf8 ? `_utf8mb4 ${literal}` : literal;
    }
    return super.getDefaultValue(value);
  }

  protected getColumnDefault(column: ColumnDefinition): string {
    const json = column.type === "json" || column.type === "jsonb";
    const value = json && column.default !== null &&
      !(column.default instanceof SchemaRawExpression) && typeof column.default !== "string"
      ? JSON.stringify(column.default)
      : column.default;
    if (typeof value === "string" && this.needsHexLiteral(value)) {
      return json
        ? `CONVERT(${this.getStringLiteral(value)} USING utf8mb4)`
        : this.getStringLiteral(value, true);
    }
    return super.getColumnDefault(column);
  }

  protected getType(column: ColumnDefinition): string {
    switch (column.type) {
      case "string":
        return `VARCHAR(${column.length || 255})`;
      case "char":
        return `CHAR(${column.length || 255})`;
      case "text":
        return "TEXT";
      case "mediumText":
        return "MEDIUMTEXT";
      case "longText":
        return "LONGTEXT";
      case "integer":
        return "INT";
      case "bigInteger":
        return "BIGINT";
      case "smallInteger":
        return "SMALLINT";
      case "tinyInteger":
        return "TINYINT";
      case "float":
        return `FLOAT(${column.precision || 8}, ${column.scale || 2})`;
      case "double":
        return `DOUBLE(${column.precision || 8}, ${column.scale || 2})`;
      case "decimal":
        return `DECIMAL(${column.precision || 8}, ${column.scale || 2})`;
      case "boolean":
        return "BOOLEAN";
      case "date":
        return "DATE";
      case "dateTime":
        return "DATETIME";
      case "time":
        return "TIME";
      case "timestamp":
        return "TIMESTAMP";
      case "json":
        return "JSON";
      case "jsonb":
        return "JSON";
      case "binary":
        return "BLOB";
      case "uuid":
        return "CHAR(36)";
      case "enum": {
        const values = column.values!;
        const type = `ENUM(${values.map((value) => this.getStringLiteral(value)).join(", ")})`;
        return values.some((value) => this.needsHexLiteral(value))
          ? `${type} CHARACTER SET utf8mb4`
          : type;
      }
      default:
        return "TEXT";
    }
  }

  protected modifyUnsigned(column: ColumnDefinition): string {
    return column.unsigned ? " UNSIGNED" : "";
  }

  protected modifyAutoIncrement(column: ColumnDefinition): string {
    return column.autoIncrement ? " AUTO_INCREMENT" : "";
  }

  protected modifyDefaultUuid(_column: ColumnDefinition): string {
    return " DEFAULT (UUID())";
  }

  protected modifyComment(column: ColumnDefinition): string {
    return column.comment ? ` COMMENT '${column.comment.replace(/'/g, "\\'")}'` : "";
  }

  protected getColumn(_blueprint: any, column: ColumnDefinition): string {
    let sql = `${this.wrap(column.name)} ${this.getType(column)}`;
    if (column.unsigned) sql += this.modifyUnsigned(column);
    if (!column.nullable) sql += " NOT NULL";
    if (column.defaultUuid) sql += this.modifyDefaultUuid(column);
    else if (column.default !== undefined) {
      const json = column.type === "json" || column.type === "jsonb";
      const rendered = this.getColumnDefault(column);
      sql += ` DEFAULT ${json && column.default !== null ? `(${rendered})` : rendered}`;
    }
    if (column.autoIncrement) sql += this.modifyAutoIncrement(column);
    if (column.primary) sql += " PRIMARY KEY";
    if (column.comment) sql += this.modifyComment(column);
    return sql;
  }

  compileAdd(blueprint: any, table: string): string[] {
    blueprint.validate();
    return blueprint.columns.map((column: ColumnDefinition) => {
      let sql = `ALTER TABLE ${this.wrap(table)} ADD COLUMN ${this.getColumn(blueprint, column)}`;
      if (column.after) sql += ` AFTER ${this.wrap(column.after)}`;
      return sql;
    });
  }

  compileColumnRename(table: string, from: string, to: string): string {
    // MySQL requires full column definition for rename; simplified here.
    return `ALTER TABLE ${this.wrap(table)} RENAME COLUMN ${this.wrap(from)} TO ${this.wrap(to)}`;
  }

  compileDropColumn(table: string, columns: string[]): string {
    return `ALTER TABLE ${this.wrap(table)} ${columns.map((col) => `DROP COLUMN ${this.wrap(col)}`).join(", ")}`;
  }

  compileChange(table: string, column: ColumnDefinition): string {
    this.assertPortableChange(column);
    return `ALTER TABLE ${this.wrap(table)} MODIFY COLUMN ${this.getColumn({} as any, column)}`;
  }

  compileIndex(table: string, index: any): string {
    const type = index.unique ? "UNIQUE INDEX" : "INDEX";
    return `ALTER TABLE ${this.wrap(table)} ADD ${type} ${this.wrap(index.name)} (${this.wrapArray(index.columns).join(", ")})`;
  }

  // MySQL always calls the primary key "PRIMARY": a given name is accepted and ignored.
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
