import { Builder } from "../query/Builder.js";
import { currentSchemaVersion, type Connection } from "../connection/Connection.js";

/** The introspected shape of a primary key column, as `Schema.getColumn` reports it. */
export interface PrimaryKeyColumn {
  name?: string;
  type?: unknown;
  primary?: boolean;
  autoIncrement?: boolean;
  default?: unknown;
  /** MySQL: the default is an expression such as `(uuid())`, not a literal. */
  defaultIsExpression?: boolean;
  length?: number;
}

interface RememberedColumn {
  readonly schemaVersion: number;
  readonly column: PrimaryKeyColumn;
}

/** Per database (the resource connection), per schema, table and column. */
const rememberedColumns = new WeakMap<Connection, Map<string, RememberedColumn>>();

/**
 * The primary key column that UUID generation and `insertAndResolveKey` decide
 * from, read once per table instead of before every insert: on PostgreSQL the
 * lookup was 86% of a `create()`. It is read again once this process may have
 * changed the schema (see `currentSchemaVersion`). A key changed by another
 * process is seen after a restart, as a model's static configuration would be.
 * A missing table is not remembered, so its creation is noticed.
 */
export async function primaryKeyColumn(connection: Connection, table: string, column: string): Promise<PrimaryKeyColumn | null> {
  const database = connection.resourceConnection();
  const key = `${connection.getSchema() ?? ""}\0${table}\0${column}`;
  const schemaVersion = currentSchemaVersion();
  const remembered = rememberedColumns.get(database)?.get(key);
  if (remembered?.schemaVersion === schemaVersion) return remembered.column;

  const { Schema } = await import("../schema/Schema.js");
  const found = await Schema.getColumn(table, column, connection);
  // Tagged with the version the read started at: one that overlapped a schema
  // change is already stale when it lands.
  if (found) {
    let columns = rememberedColumns.get(database);
    if (!columns) rememberedColumns.set(database, columns = new Map());
    columns.set(key, { schemaVersion, column: found });
  }
  return found;
}

/**
 * Inserts one record and returns the primary key the row actually ended up with.
 *
 * Every insert path funnels through here, because "the id of the last insert"
 * is not the same question as "this row's primary key":
 *
 * - SQLite and PostgreSQL answer the second one directly, with `RETURNING`.
 * - MySQL reports `AUTO_INCREMENT` values and nothing else. A literal column
 *   default is knowable from introspection; an expression default (`(uuid())`)
 *   is rejected before inserting, because there is no reliable key to return.
 */
export async function insertAndResolveKey(
  connection: Connection,
  table: string,
  attributes: Record<string, any>,
  primaryKey: string,
  column: PrimaryKeyColumn | null | undefined
): Promise<any> {
  const driver = connection.getDriverName();
  const builder = new Builder(connection, table);
  const supplied = attributes[primaryKey];

  if (supplied !== null && supplied !== undefined && supplied !== "") {
    await builder.insert(attributes as any);
    return supplied;
  }

  // Only refuse when introspection actually told us the key is unreachable. A
  // column we could not read says nothing, and turning that into a hard failure
  // would block ordinary inserts on any table the driver cannot introspect.
  if (
    driver === "mysql" &&
    column &&
    !column.autoIncrement &&
    (column.default === undefined || column.default === null || column.defaultIsExpression)
  ) {
    throw new Error(
      `Cannot insert into ${table} without "${primaryKey}": MySQL cannot return a key assigned by an expression or trigger. ` +
        `Provide the key explicitly, use AUTO_INCREMENT, or use a literal default.`
    );
  }

  const reported = await builder.insertGetId(attributes as any, primaryKey as any);

  if (driver === "postgres" || driver === "sqlite") return reported ?? null;

  if (column?.autoIncrement) return reported ?? null;
  if (column?.default !== undefined && column?.default !== null && !column?.defaultIsExpression) {
    return column.default;
  }
  return null;
}
