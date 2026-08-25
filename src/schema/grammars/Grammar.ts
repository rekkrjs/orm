import { Blueprint } from "../Blueprint.js";
import type { ColumnDefinition, IndexDefinition, ForeignKeyDefinition, PrimaryKeyDefinition } from "../../types/index.js";
import { SchemaRawExpression } from "../RawExpression.js";

export abstract class Grammar {
  protected wrappers: Record<string, string> = { prefix: '"', suffix: '"' };

  wrap(value: string): string {
    if (value.includes(".")) {
      return value.split(".").map((v) => this.wrap(v)).join(".");
    }
    const { prefix, suffix } = this.wrappers;
    return `${prefix}${value.replaceAll(suffix, `${suffix}${suffix}`)}${suffix}`;
  }

  wrapArray(values: string[]): string[] {
    return values.map((v) => this.wrap(v));
  }

  compileCreate(blueprint: Blueprint, table: string): string {
    const columns = this.getTableDefinitions(blueprint).map((col) => `    ${col}`).join(",\n");
    const sql = `CREATE TABLE ${this.wrap(table)} (\n${columns}\n)`;
    return sql;
  }

  compileCreateIfNotExists(blueprint: Blueprint, table: string): string {
    const columns = this.getTableDefinitions(blueprint).map((col) => `    ${col}`).join(",\n");
    return `CREATE TABLE IF NOT EXISTS ${this.wrap(table)} (\n${columns}\n)`;
  }

  compileDrop(table: string): string {
    return `DROP TABLE ${this.wrap(table)}`;
  }

  compileDropIfExists(table: string): string {
    return `DROP TABLE IF EXISTS ${this.wrap(table)}`;
  }

  compileRename(from: string, to: string): string {
    return `ALTER TABLE ${this.wrap(from)} RENAME TO ${this.wrap(to)}`;
  }

  compileAdd(blueprint: Blueprint, table: string): string[] {
    blueprint.validate();
    return blueprint.columns
      // A changed column already exists on the table; compileChange() rewrites
      // it in place, so adding it again would fail as a duplicate.
      .filter((column) => !column.changed)
      .map((column) => this.compileAddColumn(blueprint, table, column));
  }

  protected compileAddColumn(blueprint: Blueprint, table: string, column: ColumnDefinition): string {
    return `ALTER TABLE ${this.wrap(table)} ADD COLUMN ${this.getColumn(blueprint, column)}`;
  }

  protected getColumns(blueprint: Blueprint): string[] {
    blueprint.validate();
    return blueprint.columns.map((col) => this.getColumn(blueprint, col));
  }

  /** Everything that goes inside CREATE TABLE (...): columns, then table-level constraints. */
  protected getTableDefinitions(blueprint: Blueprint): string[] {
    const definitions = this.getColumns(blueprint);
    const primaryKey = this.compilePrimaryKey(blueprint.primaryKey);
    if (primaryKey) definitions.push(primaryKey);
    return definitions;
  }

  protected compilePrimaryKey(primaryKey?: PrimaryKeyDefinition): string | null {
    if (!primaryKey) return null;
    const constraint = primaryKey.name ? `CONSTRAINT ${this.wrap(primaryKey.name)} ` : "";
    return `${constraint}PRIMARY KEY (${this.wrapArray(primaryKey.columns).join(", ")})`;
  }

  compileAddPrimaryKey(table: string, primaryKey: PrimaryKeyDefinition): string {
    const constraint = primaryKey.name ? ` CONSTRAINT ${this.wrap(primaryKey.name)}` : "";
    return `ALTER TABLE ${this.wrap(table)} ADD${constraint} PRIMARY KEY (${this.wrapArray(primaryKey.columns).join(", ")})`;
  }

  protected getColumn(_blueprint: Blueprint, column: ColumnDefinition): string {
    let sql = `${this.wrap(column.name)} ${this.getType(column)}`;
    if (column.unsigned) sql += this.modifyUnsigned(column);
    if (!column.nullable) sql += " NOT NULL";
    if (column.defaultUuid) sql += this.modifyDefaultUuid(column);
    else if (column.default !== null && column.default !== undefined) {
      sql += ` DEFAULT ${this.getColumnDefault(column)}`;
    }
    if (column.autoIncrement) sql += this.modifyAutoIncrement(column);
    if (column.comment) sql += this.modifyComment(column);
    return sql;
  }

  protected abstract getType(column: ColumnDefinition): string;

  protected modifyUnsigned(_column: ColumnDefinition): string {
    return "";
  }

  protected modifyAutoIncrement(_column: ColumnDefinition): string {
    return "";
  }

  protected modifyComment(_column: ColumnDefinition): string {
    return "";
  }

  protected modifyDefaultUuid(_column: ColumnDefinition): string {
    return "";
  }

  protected getDefaultValue(value: any): string {
    if (value instanceof SchemaRawExpression) return value.sql;
    if (value === null) return "NULL";
    if (typeof value === "boolean") return value ? "1" : "0";
    if (typeof value === "number") return String(value);
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  /** JSON defaults are values, not JavaScript's "[object Object]" string. */
  protected getColumnDefault(column: ColumnDefinition): string {
    const json = column.type === "json" || column.type === "jsonb";
    const value = json && column.default !== null &&
      !(column.default instanceof SchemaRawExpression) && typeof column.default !== "string"
      ? JSON.stringify(column.default)
      : column.default;
    return this.getDefaultValue(value);
  }

  protected compileEnumCheck(column: ColumnDefinition): string {
    if (column.type !== "enum") return "";
    const values = column.values!.map((value) => this.getDefaultValue(value)).join(", ");
    return ` CHECK (${this.wrap(column.name)} IN (${values}))`;
  }

  protected assertPortableChange(column: ColumnDefinition): void {
    if (column.type === "enum") {
      throw new Error(
        `Changing enum column "${column.name}" is not supported portably. ` +
          "Use an explicit driver-supported schema operation in a new migration.",
      );
    }
    // MySQL would take `MODIFY COLUMN ... PRIMARY KEY` and either add the key or
    // fail with "Multiple primary key defined" depending on what the table
    // already has; Postgres has no ALTER COLUMN spelling for it at all. Refusing
    // in one place keeps the same blueprint from meaning two different things.
    if (column.primary) {
      throw new Error(
        `Changing column "${column.name}" into a primary key is not supported portably. ` +
          "Add a table-level primary key with primary([...]) instead.",
      );
    }
  }

  compileIndexes(blueprint: Blueprint, table: string): string[] {
    const statements: string[] = [];
    for (const column of blueprint.columns) {
      // A changed column keeps the indexes it already has: restating .unique()
      // in a change() block describes the column as it should end up, it does
      // not ask for a second index. uniqueIndex()/dropUnique() are how a
      // migration actually adds or removes one, and uniqueIndex() lands in
      // blueprint.indexes below under the very same generated name.
      if (column.changed || !column.unique) continue;
      statements.push(this.compileIndex(table, {
        name: `${blueprint.table}_${column.name}_unique`,
        columns: [column.name],
        unique: true,
      }));
    }
    for (const index of blueprint.indexes) {
      statements.push(this.compileIndex(table, index));
    }
    return statements;
  }

  protected compileIndex(table: string, index: IndexDefinition): string {
    const type = index.unique ? "UNIQUE INDEX" : "INDEX";
    return `CREATE ${type} ${this.wrap(index.name)} ON ${this.wrap(table)} (${this.wrapArray(index.columns).join(", ")})`;
  }

  compileForeignKeys(blueprint: Blueprint, table: string): string[] {
    return blueprint.foreignKeys.map((fk) => this.compileForeignKey(table, fk));
  }

  protected compileForeignKey(table: string, fk: ForeignKeyDefinition): string {
    const constraint = fk.name ? ` CONSTRAINT ${this.wrap(fk.name)}` : "";
    const sql = `ALTER TABLE ${this.wrap(table)} ADD${constraint} FOREIGN KEY (${this.wrapArray(fk.columns).join(", ")}) REFERENCES ${this.wrap(fk.onTable)} (${this.wrapArray(fk.references).join(", ")})`;
    let full = sql;
    if (fk.onDelete) full += ` ON DELETE ${fk.onDelete}`;
    if (fk.onUpdate) full += ` ON UPDATE ${fk.onUpdate}`;
    return full;
  }

  abstract compileColumnRename(table: string, from: string, to: string): string;
  abstract compileDropColumn(table: string, columns: string[]): string | string[];
  abstract compileChange(table: string, column: ColumnDefinition): string | string[];
}
