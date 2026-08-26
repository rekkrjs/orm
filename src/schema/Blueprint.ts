import type {
  ColumnDefinition,
  IndexDefinition,
  PrimaryKeyDefinition,
  ColumnType,
  ForeignKeyDefinition,
  ReferentialAction,
} from "../types/index.js";
import { snakeCase } from "../utils.js";
import { SchemaRawExpression } from "./RawExpression.js";

const REFERENTIAL_ACTIONS = new Set<ReferentialAction>([
  "cascade",
  "restrict",
  "set null",
  "no action",
  "set default",
]);

function referentialAction(action: string): ReferentialAction {
  const normalized = action.trim().toLowerCase().replace(/\s+/g, " ") as ReferentialAction;
  if (!REFERENTIAL_ACTIONS.has(normalized)) {
    throw new Error(`Invalid foreign key action: ${action}`);
  }
  return normalized;
}

function describeSchemaValue(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null) return "NULL";
  const type = typeof value;
  const article = type === "object" || type === "undefined" ? "an" : "a";
  return `${article} ${type} value`;
}

export class ForeignKeyBuilder {
  fk: ForeignKeyDefinition;
  blueprint: Blueprint;

  constructor(blueprint: Blueprint, columns: string[], name?: string) {
    this.blueprint = blueprint;
    this.fk = { name, columns, references: [], onTable: "" };
    blueprint.foreignKeys.push(this.fk);
  }

  references(columns: string | string[]): this {
    this.fk.references = Array.isArray(columns) ? columns : [columns];
    return this;
  }

  on(table: string): this {
    this.fk.onTable = table;
    return this;
  }

  onDelete(action: string): this {
    this.fk.onDelete = this.validateAction(action, "delete");
    return this;
  }

  onUpdate(action: string): this {
    this.fk.onUpdate = this.validateAction(action, "update");
    return this;
  }

  private validateAction(action: string, event: "delete" | "update"): ReferentialAction {
    const normalized = referentialAction(action);
    if (normalized === "set null") {
      // Schema.table() may reference a column that already exists in the
      // database. Only columns declared in this blueprint can be checked here;
      // the database remains authoritative for existing columns.
      const nonNullable = this.fk.columns.find((name) =>
        this.blueprint.columns.some((column) => column.name === name && !column.nullable)
      );
      if (nonNullable) {
        throw new Error(`ON ${event.toUpperCase()} SET NULL requires nullable foreign key column "${nonNullable}".`);
      }
    }
    return normalized;
  }

  cascadeOnDelete(): this {
    return this.onDelete("cascade");
  }

  restrictOnDelete(): this {
    return this.onDelete("restrict");
  }

  nullOnDelete(): this {
    return this.onDelete("set null");
  }

  cascadeOnUpdate(): this {
    return this.onUpdate("cascade");
  }

  restrictOnUpdate(): this {
    return this.onUpdate("restrict");
  }

  nullOnUpdate(): this {
    return this.onUpdate("set null");
  }

  noActionOnUpdate(): this {
    return this.onUpdate("no action");
  }

  noActionOnDelete(): this {
    return this.onDelete("no action");
  }
}

export class Blueprint {
  readonly table: string;
  columns: ColumnDefinition[] = [];
  indexes: IndexDefinition[] = [];
  primaryKey?: PrimaryKeyDefinition;
  foreignKeys: ForeignKeyDefinition[] = [];
  commands: { name: string; parameters?: Record<string, any> }[] = [];

  private currentColumn?: ColumnDefinition;

  constructor(table: string) {
    this.table = table;
  }

  private addColumn(type: ColumnType, name: string, length?: number): this {
    const column: ColumnDefinition = {
      name,
      type,
      length,
      nullable: false,
      autoIncrement: false,
      primary: false,
      unique: false,
      index: false,
      unsigned: false,
    };
    this.columns.push(column);
    this.currentColumn = column;
    return this;
  }

  private addTemporalColumn(type: "dateTime" | "time" | "timestamp", name: string, precision?: number): this {
    if (precision !== undefined && (!Number.isInteger(precision) || precision < 0 || precision > 6)) {
      throw new RangeError("Temporal precision must be an integer between 0 and 6.");
    }
    this.addColumn(type, name);
    if (precision !== undefined) this.currentColumn!.precision = precision;
    return this;
  }

  increments(name: string = "id"): this {
    const col = this.addColumn("integer", name);
    col.currentColumn!.autoIncrement = true;
    col.currentColumn!.primary = true;
    col.currentColumn!.unsigned = true;
    return this;
  }

  /** The conventional auto-incrementing big integer primary key. Alias of bigIncrements(). */
  id(name: string = "id"): this {
    return this.bigIncrements(name);
  }

  bigIncrements(name: string = "id"): this {
    const col = this.addColumn("bigInteger", name);
    col.currentColumn!.autoIncrement = true;
    col.currentColumn!.primary = true;
    col.currentColumn!.unsigned = true;
    return this;
  }

  string(name: string, length: number = 255): this {
    return this.addColumn("string", name, length);
  }

  char(name: string, length: number = 255): this {
    return this.addColumn("char", name, length);
  }

  text(name: string): this {
    return this.addColumn("text", name);
  }

  mediumText(name: string): this {
    return this.addColumn("mediumText", name);
  }

  longText(name: string): this {
    return this.addColumn("longText", name);
  }

  integer(name: string): this {
    return this.addColumn("integer", name);
  }

  bigInteger(name: string): this {
    return this.addColumn("bigInteger", name);
  }

  smallInteger(name: string): this {
    return this.addColumn("smallInteger", name);
  }

  tinyInteger(name: string): this {
    return this.addColumn("tinyInteger", name);
  }

  unsignedBigInteger(name: string): this {
    return this.bigInteger(name).unsigned();
  }

  unsignedInteger(name: string): this {
    return this.integer(name).unsigned();
  }

  unsignedSmallInteger(name: string): this {
    return this.smallInteger(name).unsigned();
  }

  unsignedTinyInteger(name: string): this {
    return this.tinyInteger(name).unsigned();
  }

  float(name: string, precision: number = 8, scale: number = 2): this {
    this.addColumn("float", name);
    this.currentColumn!.precision = precision;
    this.currentColumn!.scale = scale;
    return this;
  }

  double(name: string, precision: number = 8, scale: number = 2): this {
    this.addColumn("double", name);
    this.currentColumn!.precision = precision;
    this.currentColumn!.scale = scale;
    return this;
  }

  decimal(name: string, precision: number = 8, scale: number = 2): this {
    this.addColumn("decimal", name);
    this.currentColumn!.precision = precision;
    this.currentColumn!.scale = scale;
    return this;
  }

  boolean(name: string): this {
    return this.addColumn("boolean", name);
  }

  date(name: string): this {
    return this.addColumn("date", name);
  }

  dateTime(name: string, precision?: number): this {
    return this.addTemporalColumn("dateTime", name, precision);
  }

  time(name: string, precision?: number): this {
    return this.addTemporalColumn("time", name, precision);
  }

  timestamp(name: string, precision?: number): this {
    return this.addTemporalColumn("timestamp", name, precision);
  }

  json(name: string): this {
    return this.addColumn("json", name);
  }

  jsonb(name: string): this {
    return this.addColumn("jsonb", name);
  }

  binary(name: string): this {
    return this.addColumn("binary", name);
  }

  uuid(name: string): this {
    return this.addColumn("uuid", name);
  }

  foreignId(name: string): this {
    return this.bigInteger(name).unsigned();
  }

  foreignUuid(name: string): this {
    return this.uuid(name);
  }

  enum(name: string, values: readonly string[]): this {
    const validated = this.validateEnumValues(name, values);
    this.addColumn("enum", name);
    this.currentColumn!.values = validated;
    return this;
  }

  nullable(value: boolean = true): this {
    if (this.currentColumn) this.currentColumn.nullable = value;
    return this;
  }

  default(value?: any): this {
    if (this.currentColumn) {
      this.currentColumn.default = value;
    }
    return this;
  }

  useCurrent(): this {
    return this.default(new SchemaRawExpression("CURRENT_TIMESTAMP"));
  }

  defaultUuid(): this {
    if (this.currentColumn) {
      if (this.currentColumn.type === "enum") {
        throw this.invalidEnumUuidDefault(this.currentColumn);
      }
      this.currentColumn.defaultUuid = true;
    }
    return this;
  }

  unique(): this {
    if (this.currentColumn) {
      this.currentColumn.unique = true;
    }
    return this;
  }

  index(): this;
  index(columns: string | string[], name?: string): this;
  index(columns?: string | string[], name?: string): this {
    if (columns === undefined) {
      if (this.currentColumn) {
        this.currentColumn.index = true;
        this.indexes.push({
          name: `${this.table}_${this.currentColumn.name}_index`,
          columns: [this.currentColumn.name],
          unique: false,
        });
      }
      return this;
    }

    const cols = Array.isArray(columns) ? columns : [columns];
    this.indexes.push({
      name: name || `${this.table}_${cols.join("_")}_index`,
      columns: cols,
      unique: false,
    });
    return this;
  }

  primary(): this;
  primary(columns: string | string[], name?: string): this;
  primary(columns?: string | string[], name?: string): this {
    if (columns === undefined) {
      if (this.currentColumn) {
        this.currentColumn.primary = true;
      }
      return this;
    }

    this.primaryKey = {
      columns: Array.isArray(columns) ? columns : [columns],
      name,
    };
    return this;
  }

  unsigned(): this {
    if (this.currentColumn) {
      this.currentColumn.unsigned = true;
    }
    return this;
  }

  comment(text: string): this {
    if (this.currentColumn) {
      this.currentColumn.comment = text;
    }
    return this;
  }

  /**
   * Place the column right after an existing one when adding it to a table.
   * Only MySQL can reorder columns; Postgres and SQLite append and ignore this.
   */
  after(column: string): this {
    if (this.currentColumn) {
      this.currentColumn.after = column;
    }
    return this;
  }

  change(): void {
    if (!this.currentColumn) {
      throw new Error("change() must be called after a column definition.");
    }
    if (this.currentColumn.type === "enum") {
      throw new Error(
        `Changing enum column "${this.table}.${this.currentColumn.name}" is not supported portably. ` +
          "Use an explicit driver-supported schema operation in a new migration.",
      );
    }
    this.currentColumn.changed = true;
    this.commands.push({
      name: "change",
      parameters: { column: this.currentColumn },
    });
  }

  validate(): void {
    for (const column of this.columns) {
      if (column.type !== "enum") continue;
      this.validateEnumValues(column.name, column.values);
      if (column.defaultUuid) throw this.invalidEnumUuidDefault(column);
      if (column.default === null || column.default === undefined) continue;
      this.validateEnumDefault(column, column.default);
    }
  }

  private validateEnumValues(name: string, values: unknown): readonly string[] {
    const location = `"${this.table}.${name}"`;
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error(`Enum column ${location} requires at least one value.`);
    }

    const seen = new Set<string>();
    for (const value of values) {
      if (typeof value !== "string") {
        throw new Error(`Enum column ${location} values must all be strings.`);
      }
      if (value.length === 0) {
        throw new Error(`Enum column ${location} must not contain an empty value.`);
      }
      if ([...value].length > 255) {
        throw new Error(`Enum column ${location} values must not exceed 255 characters.`);
      }
      if (value.includes("\0")) {
        throw new Error(
          `Enum column ${location} must not contain NUL characters because PostgreSQL text cannot store them.`,
        );
      }
      if (value.endsWith(" ")) {
        throw new Error(
          `Enum column ${location} must not contain a value with trailing spaces because MySQL removes them.`,
        );
      }
      if (seen.has(value)) {
        throw new Error(`Enum column ${location} contains duplicate value ${JSON.stringify(value)}.`);
      }
      seen.add(value);
    }
    return Object.freeze([...values]);
  }

  private validateEnumDefault(column: ColumnDefinition, value: unknown): void {
    const values = this.validateEnumValues(column.name, column.values);
    if (typeof value !== "string" || !values.includes(value)) {
      throw new Error(
        `Invalid enum default for "${this.table}.${column.name}": ${describeSchemaValue(value)} ` +
          `is not one of ${values.map((item) => JSON.stringify(item)).join(", ")}.`,
      );
    }
  }

  private invalidEnumUuidDefault(column: ColumnDefinition): Error {
    const values = this.validateEnumValues(column.name, column.values);
    return new Error(
      `Invalid enum default for "${this.table}.${column.name}": generated UUIDs are not declared enum values. ` +
        `Use one of ${values.map((item) => JSON.stringify(item)).join(", ")}.`,
    );
  }

  timestamps(): void;
  timestamps(options: { precision?: number }): void;
  timestamps(createdAtColumn: string, updatedAtColumn: string, options?: { precision?: number }): void;
  timestamps(
    createdAtColumnOrOptions?: string | { precision?: number },
    updatedAtColumn?: string,
    options?: { precision?: number },
  ): void {
    const argumentCount = arguments.length;
    const optionsOnly = argumentCount === 1 && typeof createdAtColumnOrOptions === "object" && createdAtColumnOrOptions !== null;
    const namedColumns = argumentCount === 2 || (
      argumentCount === 3 && (options === undefined || (typeof options === "object" && options !== null))
    );
    if (argumentCount !== 0 && !optionsOnly && !namedColumns) {
      throw new Error("timestamps() expects either zero or two column names.");
    }

    const created = namedColumns ? createdAtColumnOrOptions : "created_at";
    const updated = namedColumns ? updatedAtColumn : "updated_at";
    if (typeof created !== "string" || created.length === 0) {
      throw new Error("timestamps() created-at column must be a non-empty string.");
    }
    if (typeof updated !== "string" || updated.length === 0) {
      throw new Error("timestamps() updated-at column must be a non-empty string.");
    }
    if (created === updated) {
      throw new Error("timestamps() must use different created-at and updated-at columns.");
    }

    const precision = optionsOnly ? createdAtColumnOrOptions.precision : options?.precision;
    this.timestamp(created, precision).nullable();
    this.timestamp(updated, precision).nullable();
  }

  softDeletes(name: string = "deleted_at", options: { precision?: number } = {}): void {
    this.timestamp(name, options.precision).nullable();
  }

  /** The 100-character nullable remember_token column session cookies are matched against. */
  rememberToken(): this {
    return this.string("remember_token", 100).nullable();
  }

  morphs(name: string): void {
    this.string(`${name}_type`);
    this.bigInteger(`${name}_id`).unsigned();
    this.index(
      [`${name}_type`, `${name}_id`],
      `${this.table}_${name}_type_${name}_id_index`,
    );
  }

  nullableMorphs(name: string): void {
    this.string(`${name}_type`).nullable();
    this.bigInteger(`${name}_id`).unsigned().nullable();
    this.index(
      [`${name}_type`, `${name}_id`],
      `${this.table}_${name}_type_${name}_id_index`,
    );
  }

  uuidMorphs(name: string): void {
    this.string(`${name}_type`);
    this.uuid(`${name}_id`);
    this.index(
      [`${name}_type`, `${name}_id`],
      `${this.table}_${name}_type_${name}_id_index`,
    );
  }

  nullableUuidMorphs(name: string): void {
    this.string(`${name}_type`).nullable();
    this.uuid(`${name}_id`).nullable();
    this.index(
      [`${name}_type`, `${name}_id`],
      `${this.table}_${name}_type_${name}_id_index`,
    );
  }

  foreign(columns: string | string[], name?: string): ForeignKeyBuilder {
    const cols = Array.isArray(columns) ? columns : [columns];
    return new ForeignKeyBuilder(this, cols, name);
  }

  constrained(table?: string, column: string = "id", name?: string): ForeignKeyBuilder {
    if (!this.currentColumn) {
      throw new Error(
        "constrained() must be called after a column definition.",
      );
    }
    const localColumn = this.currentColumn.name;
    const foreignTable = table || this.guessConstrainedTable(localColumn);
    return this.foreign(localColumn, name).references(column).on(foreignTable);
  }

  cascadeOnDelete(): ForeignKeyBuilder {
    return this.constrained().cascadeOnDelete();
  }

  uniqueIndex(columns: string | string[], name?: string): this {
    const cols = Array.isArray(columns) ? columns : [columns];
    this.indexes.push({
      name: name || `${this.table}_${cols.join("_")}_unique`,
      columns: cols,
      unique: true,
    });
    return this;
  }

  private guessConstrainedTable(column: string): string {
    const base = column.endsWith("_id")
      ? column.slice(0, -3)
      : column.endsWith("Id")
        ? column.slice(0, -2)
        : column;
    return `${snakeCase(base)}s`;
  }

  dropColumn(column: string | string[]): void {
    this.commands.push({
      name: "dropColumn",
      parameters: { column: Array.isArray(column) ? column : [column] },
    });
  }

  dropTimestamps(): void {
    this.dropColumn(["created_at", "updated_at"]);
  }

  dropTimestampsTz(): void {
    this.dropTimestamps();
  }

  dropSoftDeletes(column: string = "deleted_at"): void {
    this.dropColumn(column);
  }

  dropSoftDeletesTz(column: string = "deleted_at"): void {
    this.dropSoftDeletes(column);
  }

  dropRememberToken(): void {
    this.dropColumn("remember_token");
  }

  dropMorphs(name: string, indexName: string | null = null): void {
    this.dropIndex(indexName ?? `${this.table}_${name}_type_${name}_id_index`);
    this.dropColumn([`${name}_type`, `${name}_id`]);
  }

  renameColumn(from: string, to: string): void {
    this.commands.push({ name: "renameColumn", parameters: { from, to } });
  }

  dropIndex(name: string): void {
    this.commands.push({ name: "dropIndex", parameters: { name } });
  }

  dropUnique(name: string): void {
    this.commands.push({ name: "dropUnique", parameters: { name } });
  }

  dropForeign(name: string): void {
    this.commands.push({ name: "dropForeign", parameters: { name } });
  }
}
