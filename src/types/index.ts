import type { FullTextOptions, PostgresFullTextLanguage } from "../fulltext.js";

export type ColumnType =
  | "string"
  | "char"
  | "text"
  | "mediumText"
  | "longText"
  | "integer"
  | "bigInteger"
  | "smallInteger"
  | "tinyInteger"
  | "float"
  | "double"
  | "decimal"
  | "boolean"
  | "date"
  | "dateTime"
  | "time"
  | "timestamp"
  | "json"
  | "jsonb"
  | "binary"
  | "uuid"
  | "enum";

export interface ColumnDefinition {
  name: string;
  type: ColumnType;
  length?: number;
  precision?: number;
  scale?: number;
  nullable: boolean;
  default?: any;
  autoIncrement: boolean;
  primary: boolean;
  unique: boolean;
  index: boolean;
  unsigned: boolean;
  values?: readonly string[];
  comment?: string;
  defaultUuid?: boolean;
  after?: string;
  changed?: boolean;
}

export interface PrimaryKeyDefinition {
  columns: string[];
  name?: string;
}

export interface IndexDefinition {
  name: string;
  columns: string[];
  unique: boolean;
  type?: "index" | "unique" | "fulltext";
  language?: PostgresFullTextLanguage;
}

export type ReferentialAction = "cascade" | "restrict" | "set null" | "no action" | "set default";

export interface ForeignKeyDefinition {
  name?: string;
  columns: string[];
  references: string[];
  onTable: string;
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
}

export interface WhereClause {
  type: "basic" | "in" | "null" | "raw" | "nested" | "between" | "between_columns" | "column" | "exists" | "like" | "regexp" | "fulltext" | "json_contains" | "json_length" | "date" | "all" | "any";
  column: string;
  columns?: string[];
  operator?: string;
  value?: any;
  boolean: "and" | "or";
  scope?: string;
  not?: boolean;
  /** "like" clauses only: compile the exact-comparison form for the dialect. */
  caseSensitive?: boolean;
  /** "fulltext" clauses only: a validated, immutable options snapshot. */
  fullTextOptions?: Readonly<FullTextOptions>;
  dateType?: string;
  query?: WhereClause[];
  bindings?: readonly unknown[];
}

export interface OrderClause {
  column: string;
  direction: "asc" | "desc";
  raw?: boolean;
  bindings?: readonly unknown[];
}

export interface HavingClause {
  type?: "basic" | "between";
  column?: string;
  operator?: string;
  value?: any;
  sql?: string;
  boolean: "and" | "or";
  bindings?: readonly unknown[];
  not?: boolean;
}

export interface UnionClause {
  query: string;
  all: boolean;
}

export type SQLitePragmaConfig = {
  journalMode?: string | false;
  synchronous?: string | false;
  foreignKeys?: boolean;
  /**
   * How long (ms) a write waits for a competing lock before giving up with
   * SQLITE_BUSY. Defaults to 5000; set 0 to keep SQLite's own default of
   * failing immediately.
   */
  busyTimeoutMs?: number;
};

export type ConnectionConfig =
  | { url: string; schema?: string; max?: number; prepare?: boolean; bigint?: boolean; sqlitePragmas?: false | SQLitePragmaConfig }
  | {
      driver: "sqlite" | "mysql" | "postgres";
      host?: string;
      port?: number;
      database?: string;
      username?: string;
      password?: string;
      filename?: string; // sqlite
      schema?: string;
      max?: number;
      prepare?: boolean;
      bigint?: boolean;
      sqlitePragmas?: false | SQLitePragmaConfig;
    };
