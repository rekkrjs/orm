import { Connection } from "../connection/Connection.js";
import { Blueprint } from "./Blueprint.js";
import { Grammar } from "./grammars/Grammar.js";
import { SQLiteGrammar } from "./grammars/SQLiteGrammar.js";
import { MySqlGrammar } from "./grammars/MySqlGrammar.js";
import { PostgresGrammar } from "./grammars/PostgresGrammar.js";
import { ConnectionManager } from "../connection/ConnectionManager.js";
import { TenantContext } from "../connection/TenantContext.js";
import { TransactionContext } from "../connection/TransactionContext.js";
import { declaredColumnLength } from "../utils.js";
import { SchemaRawExpression } from "./RawExpression.js";

export interface SchemaColumn {
  name: string;
  type: string;
  primary: boolean;
  autoIncrement: boolean;
  nullable: boolean;
  default?: any;
  /** Declared length for character types, when the driver reports one. */
  length?: number;
  /** Precision and scale for exact numeric columns, when available. */
  precision?: number;
  scale?: number;
  /** Whether the database declared this numeric column UNSIGNED. */
  unsigned?: boolean;
}

function characterLength(type: unknown): number | undefined {
  const declared = String(type ?? "").toLowerCase();
  return /^(?:var)?char(?:acter)?(?: varying)?\s*\(/.test(declared)
    ? declaredColumnLength(declared) ?? undefined
    : undefined;
}

function numericSize(type: unknown): { precision?: number; scale?: number } {
  const match = /^(?:decimal|numeric)\s*\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)/i.exec(String(type ?? ""));
  if (!match) return {};
  return {
    precision: Number(match[1]),
    scale: match[2] === undefined ? 0 : Number(match[2]),
  };
}

export interface SchemaIndex {
  name: string;
  columns: string[];
  unique: boolean;
  primary?: boolean;
}

export interface SchemaForeignKey {
  name?: string;
  columns: string[];
  references: string[];
  onTable: string;
  onDelete?: string;
  onUpdate?: string;
}

export class Schema {
  static connection: Connection;

  static raw(sql: string): SchemaRawExpression {
    return new SchemaRawExpression(sql);
  }

  static setConnection(connection: Connection): void {
    this.connection = connection;
    ConnectionManager.setDefault(connection);
  }

  static getConnection(): Connection {
    const transactionConnection = TransactionContext.current();
    const tenantConnection = TenantContext.current()?.connection;
    const connection = transactionConnection || tenantConnection || this.connection || ConnectionManager.getDefault();
    if (!connection) {
      throw new Error("No database connection set.");
    }
    return connection;
  }

  /**
   * Splits a possibly qualified table name. Models hand introspection whatever
   * `qualifyTable()` produced, which carries the schema on every driver except
   * SQLite — so every driver has to be able to take it apart again, not just
   * PostgreSQL.
   */
  private static splitQualifiedTable(
    connection: Connection,
    table: string
  ): { schema: string | undefined; table: string } {
    const fallback = connection.getSchema() || undefined;
    if (connection.getDriverName() === "sqlite" || !table.includes(".")) {
      return { schema: fallback, table };
    }
    const [schemaPart, ...tableParts] = table.split(".");
    if (!schemaPart || tableParts.length === 0) return { schema: fallback, table };
    return { schema: schemaPart, table: tableParts.join(".") };
  }

  /**
   * A blueprint's commands — change, dropColumn, renameColumn, dropIndex,
   * dropUnique, dropForeign — all describe edits to a table that already
   * exists. `create()` builds the whole table in one CREATE statement and never
   * runs them, so accepting one silently would produce a table that does not
   * match the migration that appears to describe it: a `.change()` column, for
   * instance, would be created but skipped when its fluent index is compiled.
   */
  private static assertNoAlterCommands(blueprint: Blueprint): void {
    const command = blueprint.commands[0];
    if (!command) return;
    throw new Error(
      `${command.name}() only applies to an existing table and cannot be used in ` +
        `Schema.create("${blueprint.table}") or Schema.createIfNotExists("${blueprint.table}"). ` +
        "Move it to Schema.table().",
    );
  }

  private static getGrammar(connection?: Connection): Grammar {
    const driver = (connection ?? this.getConnection()).getDriverName();
    switch (driver) {
      case "sqlite":
        return new SQLiteGrammar();
      case "mysql":
        return new MySqlGrammar();
      case "postgres":
        return new PostgresGrammar();
    }
  }

  static async create(table: string, callback: (blueprint: Blueprint) => void, conn?: Connection): Promise<void> {
    const blueprint = new Blueprint(table);
    callback(blueprint);
    this.assertNoAlterCommands(blueprint);
    const connection = conn ?? this.getConnection();
    const grammar = this.getGrammar(connection);
    const sql = grammar.compileCreate(blueprint, connection.qualifyTable(table));
    await connection.run(sql);

    const indexes = grammar.compileIndexes(blueprint, connection.qualifyTable(table));
    for (const indexSql of indexes) {
      await connection.run(indexSql);
    }

    const fks = grammar.compileForeignKeys(blueprint, connection.qualifyTable(table));
    for (const fkSql of fks) {
      await connection.run(fkSql);
    }
  }

  static async createIfNotExists(table: string, callback: (blueprint: Blueprint) => void, conn?: Connection): Promise<void> {
    const blueprint = new Blueprint(table);
    callback(blueprint);
    this.assertNoAlterCommands(blueprint);
    const connection = conn ?? this.getConnection();
    const grammar = this.getGrammar(connection);
    const sql = grammar.compileCreateIfNotExists(blueprint, connection.qualifyTable(table));
    await connection.run(sql);

    const indexes = grammar.compileIndexes(blueprint, connection.qualifyTable(table));
    for (const indexSql of indexes) {
      await connection.run(indexSql);
    }

    const fks = grammar.compileForeignKeys(blueprint, connection.qualifyTable(table));
    for (const fkSql of fks) {
      await connection.run(fkSql);
    }
  }

  static async createSchema(schema: string, conn?: Connection): Promise<void> {
    Connection.assertSafeIdentifier(schema, "schema name");
    const connection = conn ?? this.getConnection();
    const driver = connection.getDriverName();
    if (driver === "sqlite") {
      throw new Error("Schema creation is not supported for SQLite connections.");
    }
    const grammar = this.getGrammar(connection);
    const keyword = driver === "mysql" ? "DATABASE" : "SCHEMA";
    await connection.run(`CREATE ${keyword} IF NOT EXISTS ${grammar.wrap(schema)}`);
  }

  static async dropSchema(schema: string, options: { cascade?: boolean } = {}): Promise<void> {
    Connection.assertSafeIdentifier(schema, "schema name");
    const connection = this.getConnection();
    const driver = connection.getDriverName();
    if (driver === "sqlite") {
      throw new Error("Schema dropping is not supported for SQLite connections.");
    }
    const grammar = this.getGrammar();
    const keyword = driver === "mysql" ? "DATABASE" : "SCHEMA";
    const cascade = driver === "postgres" && options.cascade ? " CASCADE" : "";
    await connection.run(`DROP ${keyword} IF EXISTS ${grammar.wrap(schema)}${cascade}`);
  }

  static async table(table: string, callback: (blueprint: Blueprint) => void, conn?: Connection): Promise<void> {
    const blueprint = new Blueprint(table);
    callback(blueprint);
    const connection = conn ?? this.getConnection();
    const grammar = this.getGrammar(connection);
    const qualifiedTable = connection.qualifyTable(table);

    // Compile every statement before running any of them. Grammars reject what
    // their driver cannot express (SQLite has no ADD PRIMARY KEY and no column
    // changes) by throwing at compile time, and a migration that dies halfway
    // leaves the table in a state no rollback describes.
    const statements: string[] = [];
    const push = (sql: string | string[]) => {
      if (Array.isArray(sql)) statements.push(...sql);
      else statements.push(sql);
    };

    for (const command of blueprint.commands) {
      if (command.name === "dropColumn") {
        push(grammar.compileDropColumn(qualifiedTable, command.parameters!.column));
      } else if (command.name === "renameColumn") {
        push(grammar.compileColumnRename(qualifiedTable, command.parameters!.from, command.parameters!.to));
      } else if (command.name === "dropIndex" || command.name === "dropUnique") {
        const indexName = command.parameters!.name as string;
        const driver = connection.getDriverName();
        if (driver === "mysql") {
          push(`DROP INDEX ${grammar.wrap(indexName)} ON ${grammar.wrap(qualifiedTable)}`);
        } else if (driver === "postgres") {
          push(`DROP INDEX IF EXISTS ${grammar.wrap(connection.qualifyTable(indexName))}`);
        } else {
          push(`DROP INDEX ${grammar.wrap(indexName)}`);
        }
      } else if (command.name === "dropForeign") {
        const given = command.parameters!.name as string;
        let constraintName = given;
        if (connection.getDriverName() !== "sqlite") {
          const existing = await this.getForeignKeys(table, connection);
          const exact = existing.find((fk) => fk.name === given);
          if (!exact) {
            const byColumn = existing.find(
              (fk) => fk.columns.length === 1 && fk.columns[0] === given
            );
            if (byColumn?.name) constraintName = byColumn.name;
          }
        }
        push(`ALTER TABLE ${grammar.wrap(qualifiedTable)} DROP CONSTRAINT ${grammar.wrap(constraintName)}`);
      } else if (command.name === "change") {
        push(grammar.compileChange(qualifiedTable, command.parameters!.column));
      }
    }

    push(grammar.compileAdd(blueprint, qualifiedTable));

    if (blueprint.primaryKey) {
      push(grammar.compileAddPrimaryKey(qualifiedTable, blueprint.primaryKey));
    }

    push(grammar.compileIndexes(blueprint, qualifiedTable));
    push(grammar.compileForeignKeys(blueprint, qualifiedTable));

    for (const sql of statements) {
      await connection.run(sql);
    }
  }

  static async drop(table: string): Promise<void> {
    const grammar = this.getGrammar();
    const connection = this.getConnection();
    await connection.run(grammar.compileDrop(connection.qualifyTable(table)));
  }

  static async dropIfExists(table: string): Promise<void> {
    const grammar = this.getGrammar();
    const connection = this.getConnection();
    await connection.run(grammar.compileDropIfExists(connection.qualifyTable(table)));
  }

  static async rename(from: string, to: string): Promise<void> {
    const grammar = this.getGrammar();
    const connection = this.getConnection();
    // RENAME TO requires a bare target across postgres/sqlite — the table
    // stays in the source schema. Only the source side may be qualified.
    await connection.run(grammar.compileRename(connection.qualifyTable(from), to));
  }

  static async hasTable(table: string, conn?: Connection): Promise<boolean> {
    const connection = conn ?? this.getConnection();
    const driver = connection.getDriverName();
    const schema = connection.getSchema() || "public";
    let sql: string;
    let bindings: any[] = [];
    if (driver === "sqlite") {
      sql = "SELECT name FROM sqlite_master WHERE type='table' AND name = ?";
      bindings = [table];
    } else if (driver === "mysql") {
      sql = "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?";
      bindings = [table];
    } else {
      sql = "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2";
      bindings = [schema, table];
    }
    const result = await connection.query(sql, bindings);
    return result.length > 0;
  }

  static async hasColumn(table: string, column: string, conn?: Connection): Promise<boolean> {
    const connection = conn ?? this.getConnection();
    const driver = connection.getDriverName();
    const schema = connection.getSchema() || "public";
    const grammar = this.getGrammar(connection);
    let sql: string;
    let bindings: any[] = [];
    if (driver === "sqlite") {
      sql = `PRAGMA table_info(${grammar.wrap(table)})`;
      const result = await connection.query(sql);
      return result.some((row: any) => row.name === column);
    } else if (driver === "mysql") {
      sql = "SELECT column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?";
      bindings = [table, column];
    } else {
      sql = "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3";
      bindings = [schema, table, column];
    }
    const result = await connection.query(sql, bindings);
    return result.length > 0;
  }

  static async getIndexes(table: string, conn?: Connection): Promise<SchemaIndex[]> {
    const connection = conn ?? this.getConnection();
    const driver = connection.getDriverName();
    const grammar = this.getGrammar(connection);
    const qualified = this.splitQualifiedTable(connection, table);
    const schema = qualified.schema || "public";
    const tableName = qualified.table;

    if (driver === "sqlite") {
      const indexes = await connection.query(`PRAGMA index_list(${grammar.wrap(table)})`);
      const results: SchemaIndex[] = [];
      for (const index of indexes as any[]) {
        const name = String(index.name);
        const columns = await connection.query(`PRAGMA index_info(${grammar.wrap(name)})`);
        results.push({
          name,
          columns: columns.map((row: any) => String(row.name)),
          unique: Number(index.unique) === 1,
          primary: String(index.origin || "") === "pk",
        });
      }
      return results;
    }

    if (driver === "mysql") {
      const rows = await connection.query(
        `SELECT index_name AS \`index_name\`, column_name AS \`column_name\`, non_unique AS \`non_unique\`
         FROM information_schema.statistics
         WHERE table_schema = COALESCE(?, DATABASE()) AND table_name = ?
         ORDER BY index_name, seq_in_index`,
        [qualified.schema ?? null, tableName]
      );
      return this.groupIndexRows(
        rows as any[],
        "index_name",
        "column_name",
        (row) => Number(row.non_unique) === 0,
        (row) => row.index_name === "PRIMARY",
      );
    }

    const rows = await connection.query(
      `SELECT
         i.relname AS index_name,
         a.attname AS column_name,
         ix.indisunique AS is_unique,
         ix.indisprimary AS is_primary,
         k.ordinality
       FROM pg_class t
       JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN pg_index ix ON t.oid = ix.indrelid
       JOIN pg_class i ON i.oid = ix.indexrelid
       JOIN unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ordinality) ON true
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
       WHERE n.nspname = $1 AND t.relname = $2
       ORDER BY i.relname, k.ordinality`,
      [schema, tableName]
    );
    return this.groupIndexRows(rows as any[], "index_name", "column_name", (row) => !!row.is_unique, (row) => !!row.is_primary);
  }

  static async hasIndex(table: string, indexOrColumns: string | string[]): Promise<boolean> {
    const expectedColumns = Array.isArray(indexOrColumns) ? indexOrColumns : undefined;
    const indexes = await this.getIndexes(table);
    if (!expectedColumns) {
      return indexes.some((index) => index.name === indexOrColumns);
    }
    return indexes.some((index) => (
      index.columns.length === expectedColumns.length &&
      index.columns.every((column, indexPosition) => column === expectedColumns[indexPosition])
    ));
  }

  static async getForeignKeys(table: string, conn?: Connection): Promise<SchemaForeignKey[]> {
    const connection = conn ?? this.getConnection();
    const driver = connection.getDriverName();
    const grammar = this.getGrammar(connection);
    const qualified = this.splitQualifiedTable(connection, table);
    const schema = qualified.schema || "public";
    const tableName = qualified.table;

    if (driver === "sqlite") {
      const rows = await connection.query(`PRAGMA foreign_key_list(${grammar.wrap(table)})`);
      const grouped = new Map<string, SchemaForeignKey>();
      for (const row of rows as any[]) {
        const key = String(row.id);
        const fk = grouped.get(key) || {
          name: undefined,
          columns: [],
          references: [],
          onTable: String(row.table),
          onDelete: row.on_delete ? String(row.on_delete).toLowerCase() : undefined,
          onUpdate: row.on_update ? String(row.on_update).toLowerCase() : undefined,
        };
        fk.columns.push(String(row.from));
        fk.references.push(String(row.to));
        grouped.set(key, fk);
      }
      return [...grouped.values()];
    }

    if (driver === "mysql") {
      const rows = await connection.query(
        `SELECT
           k.constraint_name AS \`constraint_name\`,
           k.column_name AS \`column_name\`,
           k.referenced_table_name AS \`referenced_table_name\`,
           k.referenced_column_name AS \`referenced_column_name\`,
           rc.delete_rule AS \`delete_rule\`,
           rc.update_rule AS \`update_rule\`,
           k.ordinal_position AS \`ordinal_position\`
         FROM information_schema.key_column_usage k
         JOIN information_schema.referential_constraints rc
           ON rc.constraint_schema = k.constraint_schema
          AND rc.constraint_name = k.constraint_name
         WHERE k.table_schema = COALESCE(?, DATABASE())
           AND k.table_name = ?
           AND k.referenced_table_name IS NOT NULL
         ORDER BY k.constraint_name, k.ordinal_position`,
        [qualified.schema ?? null, tableName]
      );
      return this.groupForeignKeyRows(rows as any[], "constraint_name", "column_name", "referenced_table_name", "referenced_column_name", "delete_rule", "update_rule");
    }

    const rows = await connection.query(
      `SELECT
         tc.constraint_name,
         kcu.column_name,
         ccu.table_name AS referenced_table_name,
         ccu.column_name AS referenced_column_name,
         rc.delete_rule,
         rc.update_rule,
         kcu.ordinal_position
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
       JOIN information_schema.referential_constraints rc
         ON rc.constraint_name = tc.constraint_name
        AND rc.constraint_schema = tc.table_schema
       WHERE tc.constraint_type = 'FOREIGN KEY'
         AND tc.table_schema = $1
         AND tc.table_name = $2
       ORDER BY tc.constraint_name, kcu.ordinal_position`,
      [schema, tableName]
    );
    return this.groupForeignKeyRows(rows as any[], "constraint_name", "column_name", "referenced_table_name", "referenced_column_name", "delete_rule", "update_rule");
  }

  static async hasForeignKey(table: string, keyOrColumns: string | string[]): Promise<boolean> {
    const expectedColumns = Array.isArray(keyOrColumns) ? keyOrColumns : undefined;
    const foreignKeys = await this.getForeignKeys(table);
    if (!expectedColumns) {
      return foreignKeys.some((fk) => fk.name === keyOrColumns);
    }
    return foreignKeys.some((fk) => (
      fk.columns.length === expectedColumns.length &&
      fk.columns.every((column, indexPosition) => column === expectedColumns[indexPosition])
    ));
  }

  private static groupIndexRows(
    rows: any[],
    nameKey: string,
    columnKey: string,
    unique: (row: any) => boolean,
    primary: (row: any) => boolean = () => false
  ): SchemaIndex[] {
    const grouped = new Map<string, SchemaIndex>();
    for (const row of rows) {
      const name = String(row[nameKey]);
      const index = grouped.get(name) || { name, columns: [], unique: unique(row), primary: primary(row) };
      index.columns.push(String(row[columnKey]));
      index.unique = index.unique || unique(row);
      index.primary = index.primary || primary(row);
      grouped.set(name, index);
    }
    return [...grouped.values()];
  }

  private static groupForeignKeyRows(
    rows: any[],
    nameKey: string,
    columnKey: string,
    tableKey: string,
    referenceKey: string,
    deleteKey: string,
    updateKey: string
  ): SchemaForeignKey[] {
    const grouped = new Map<string, SchemaForeignKey>();
    for (const row of rows) {
      const name = String(row[nameKey]);
      const fk = grouped.get(name) || {
        name,
        columns: [],
        references: [],
        onTable: String(row[tableKey]),
        onDelete: row[deleteKey] ? String(row[deleteKey]).toLowerCase() : undefined,
        onUpdate: row[updateKey] ? String(row[updateKey]).toLowerCase() : undefined,
      };
      fk.columns.push(String(row[columnKey]));
      fk.references.push(String(row[referenceKey]));
      grouped.set(name, fk);
    }
    return [...grouped.values()];
  }

  static async getColumns(table: string, connection?: Connection): Promise<SchemaColumn[]> {
    const conn = connection ?? this.getConnection();
    const driver = conn.getDriverName();
    const qualified = this.splitQualifiedTable(conn, table);
    const schema = qualified.schema || "public";
    const grammar = this.getGrammar(conn);

    if (driver === "sqlite") {
      const rows = await conn.query(`PRAGMA table_info(${grammar.wrap(table)})`);
      return (rows as any[]).map((row) => {
        const size = numericSize(row.type);
        return {
          name: row.name,
          type: row.type,
          primary: row.pk > 0,
          autoIncrement: false,
          nullable: row.notnull === 0,
          default: row.dflt_value ?? undefined,
          length: characterLength(row.type),
          ...size,
        };
      });
    }

    if (driver === "mysql") {
      const rows = await conn.query(
        "SELECT column_name AS Field, column_type AS Type, column_key AS `Key`, extra AS Extra, is_nullable AS Nullable, column_default AS `Default`, character_maximum_length AS CharacterLength, numeric_precision AS `Precision`, numeric_scale AS `Scale` FROM information_schema.columns WHERE table_schema = COALESCE(?, DATABASE()) AND table_name = ? ORDER BY ordinal_position",
        [qualified.schema ?? null, qualified.table]
      );
      return (rows as any[]).map((row) => ({
        name: row.Field,
        type: row.Type,
        primary: row.Key === "PRI",
        autoIncrement: String(row.Extra || "").toLowerCase().includes("auto_increment"),
        nullable: row.Nullable === "YES",
        default: row.Default ?? undefined,
        length: row.CharacterLength == null ? characterLength(row.Type) : Number(row.CharacterLength),
        precision: row.Precision == null ? undefined : Number(row.Precision),
        scale: row.Scale == null ? undefined : Number(row.Scale),
        unsigned: /\bunsigned\b/i.test(String(row.Type)),
      }));
    }

    const rows = await conn.query(
      `SELECT c.column_name, c.data_type, c.is_nullable, c.column_default, c.character_maximum_length,
       c.numeric_precision, c.numeric_scale,
       COALESCE(bool_or(tc.constraint_type = 'PRIMARY KEY'), false) AS primary_key
       FROM information_schema.columns c
       LEFT JOIN information_schema.key_column_usage kcu
         ON c.table_schema = kcu.table_schema
        AND c.table_name = kcu.table_name
        AND c.column_name = kcu.column_name
       LEFT JOIN information_schema.table_constraints tc
         ON kcu.table_schema = tc.table_schema
        AND kcu.constraint_name = tc.constraint_name
        AND tc.constraint_type = 'PRIMARY KEY'
       WHERE c.table_schema = $1
         AND c.table_name = $2
       GROUP BY c.column_name, c.data_type, c.is_nullable, c.column_default, c.character_maximum_length, c.numeric_precision, c.numeric_scale, c.ordinal_position
       ORDER BY c.ordinal_position`,
      [schema, qualified.table]
    );
    return (rows as any[]).map((row) => ({
      name: row.column_name,
      type: row.data_type,
      primary: !!row.primary_key,
      autoIncrement: false,
      nullable: row.is_nullable === "YES",
      default: row.column_default ?? undefined,
      length: row.character_maximum_length ?? undefined,
      precision: row.numeric_precision == null ? undefined : Number(row.numeric_precision),
      scale: row.numeric_scale == null ? undefined : Number(row.numeric_scale),
      unsigned: false,
    }));
  }

  static async getColumn(
    table: string,
    column: string,
    conn?: Connection
  ): Promise<{
    name: string;
    type: string;
    primary: boolean;
    autoIncrement: boolean;
    default?: any;
    defaultIsExpression?: boolean;
    length?: number;
    precision?: number;
    scale?: number;
    unsigned?: boolean;
  } | null> {
    const connection = conn ?? this.getConnection();
    const driver = connection.getDriverName();
    const qualified = this.splitQualifiedTable(connection, table);
    const schema = qualified.schema || "public";
    const tableName = qualified.table;
    const grammar = this.getGrammar(connection);
    if (driver === "sqlite") {
      const rows = await connection.query(`PRAGMA table_info(${grammar.wrap(table)})`);
      const row = rows.find((item: any) => item.name === column);
      return row
        ? ({
            name: row.name,
            type: row.type,
            primary: row.pk > 0,
            autoIncrement: false,
            default: row.dflt_value ?? undefined,
            length: characterLength(row.type),
            ...numericSize(row.type),
          } as any)
        : null;
    }

    if (driver === "mysql") {
      const rows = await connection.query(
        "SELECT column_name AS Field, column_type AS Type, column_key AS `Key`, extra AS Extra, column_default AS `Default`, character_maximum_length AS CharacterLength, numeric_precision AS `Precision`, numeric_scale AS `Scale` FROM information_schema.columns WHERE table_schema = COALESCE(?, DATABASE()) AND table_name = ? AND column_name = ?",
        [qualified.schema ?? null, tableName, column]
      );
      const row = rows[0];
      return row
        ? ({
            name: row.Field,
            type: row.Type,
            primary: row.Key === "PRI",
            autoIncrement: String(row.Extra || "").toLowerCase().includes("auto_increment"),
            default: row.Default ?? undefined,
            defaultIsExpression: String(row.Extra || "").toLowerCase().includes("default_generated"),
            length: row.CharacterLength == null ? characterLength(row.Type) : Number(row.CharacterLength),
            precision: row.Precision == null ? undefined : Number(row.Precision),
            scale: row.Scale == null ? undefined : Number(row.Scale),
            unsigned: /\bunsigned\b/i.test(String(row.Type)),
          } as any)
        : null;
    }

    const rows = await connection.query(
      `SELECT c.column_name, c.data_type, c.column_default, c.character_maximum_length,
       c.numeric_precision, c.numeric_scale,
       COALESCE(tc.constraint_type = 'PRIMARY KEY', false) AS primary_key
       FROM information_schema.columns c
       LEFT JOIN information_schema.key_column_usage kcu
         ON c.table_schema = kcu.table_schema
        AND c.table_name = kcu.table_name
        AND c.column_name = kcu.column_name
       LEFT JOIN information_schema.table_constraints tc
         ON kcu.table_schema = tc.table_schema
        AND kcu.constraint_name = tc.constraint_name
       WHERE c.table_schema = $1
         AND c.table_name = $2
         AND c.column_name = $3`,
      [schema, tableName, column]
    );
    const row = rows[0];
    return row
      ? ({
          name: row.column_name,
          type: row.data_type,
          primary: !!row.primary_key,
          autoIncrement: false,
          default: row.column_default ?? undefined,
          length: row.character_maximum_length ?? undefined,
          precision: row.numeric_precision == null ? undefined : Number(row.numeric_precision),
          scale: row.numeric_scale == null ? undefined : Number(row.numeric_scale),
          unsigned: false,
        } as any)
      : null;
  }
}
