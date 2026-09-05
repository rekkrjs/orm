import { createHash } from "node:crypto";
import { existsSync } from "fs";
import { mkdir, readdir, readFile, writeFile } from "fs/promises";
import { basename, join, relative, resolve } from "path";
import { Connection, type PretendStatement } from "../connection/Connection.js";
import { TenantContext } from "../connection/TenantContext.js";
import { TransactionContext } from "../connection/TransactionContext.js";
import { Schema } from "../schema/Schema.js";
import { Blueprint } from "../schema/Blueprint.js";
import { Builder } from "../query/Builder.js";
import { TypeGenerator } from "../typegen/TypeGenerator.js";
import type { TypeGeneratorOptions } from "../typegen/TypeGenerator.js";
import { discoverModelTables } from "../typegen/discoverModelTables.js";
import type { Migration } from "./Migration.js";
import { acquireMigrationLock, MIGRATION_LOCKS_TABLE, type MigrationLockHandle } from "./MigrationLock.js";
import { normalizePathList, toPosixPath } from "../utils.js";
import type { ConnectionConfig } from "../types/index.js";

interface MigrationRecord {
  id: number;
  migration: string;
  batch: number;
  tenant: string | null;
  checksum: string | null;
}

export interface MigrationStatusRow {
  migration: string;
  status: string;
  tenant: string | null;
  /** Batch the migration was applied in, or null while it is still pending. */
  batch: number | null;
  checksum: string;
  storedChecksum: string | null;
}

export interface PretendMigrationResult {
  migration: string;
  direction: "up" | "down";
  tenant: string | null;
  statements: PretendStatement[];
}

export interface MigratorOptions {
  tenantId?: string | null;
  /**
   * Migrate even though some already-applied migration files have changed since
   * they ran. Off by default: run() refuses rather than skip them in silence.
   */
  allowChanged?: boolean;
  /**
   * Where progress lines go. Defaults to stdout. The CLI redirects this to
   * stderr under --json so the payload on stdout stays machine-readable.
   */
  output?: (line: string) => void;
  /** Where warnings go. Defaults to console.warn, i.e. stderr in both modes. */
  warn?: (line: string) => void;
  lock?: boolean;
  lockTimeoutMs?: number;
  /** SQLite only: age at which a lock row left behind by a dead process is taken over. Default 15 minutes. */
  lockMaxAgeMs?: number;
  createIfMissing?: boolean | {
    database?: boolean;
    schema?: boolean;
  };
}

export type MigrationEvent =
  | "migrating"
  | "migrated"
  | "rollingBack"
  | "rolledBack"
  | "schemaDumped"
  | "schemaSquashed";

export interface MigrationEventPayload {
  migration?: string;
  batch?: number;
  path?: string;
}

export type MigrationEventListener = (payload: MigrationEventPayload) => void | Promise<void>;

export class Migrator {
  private static listeners = new Map<MigrationEvent, Set<MigrationEventListener>>();

  constructor(
    private connection: Connection,
    private path: string | string[],
    private typeGeneratorOptions: Omit<TypeGeneratorOptions, "outDir"> = {},
    private options: MigratorOptions = {}
  ) {}

  private getPaths(): string[] {
    return normalizePathList(this.path);
  }

  /** Progress output. Never the command's result — that is the caller's to render. */
  private write(line: string): void {
    (this.options.output ?? console.log)(line);
  }

  /** Diagnostics. Kept off stdout even in plain text mode. */
  private warn(line: string): void {
    (this.options.warn ?? console.warn)(line);
  }

  /**
   * The migrations table is shared by every tenant, so creating it — and its
   * index — is not covered by the per-tenant lock: two tenants bootstrapping at
   * once race, and the loser dies on "index migrations_tenant_index already
   * exists". A tenant-independent lock serialises just that.
   */
  private async ensureMigrationsTable(): Promise<void> {
    if (this.migrationsTableReady) return;
    const lock = this.shouldLock()
      ? await acquireMigrationLock(this.connection, "migrations:bootstrap", {
          timeoutMs: this.options.lockTimeoutMs,
          maxAgeMs: this.options.lockMaxAgeMs,
        })
      : null;
    try {
      await this.prepareMigrationsTable();
    } finally {
      await lock?.release();
    }
    this.migrationsTableReady = true;
  }

  private async prepareMigrationsTable(): Promise<void> {
    if (await Schema.hasTable("migrations", this.connection)) return;
    await Schema.createIfNotExists("migrations", (table: Blueprint) => {
      table.increments("id");
      table.string("migration");
      table.string("tenant").nullable().index();
      table.string("checksum").nullable();
      table.integer("batch");
    }, this.connection);
  }

  private getTenantId(): string | null {
    return this.options.tenantId ?? null;
  }

  private shouldCreateIfMissing(kind: "database" | "schema"): boolean {
    const option = this.options.createIfMissing;
    if (!option) return false;
    if (option === true) return true;
    return Boolean(option[kind]);
  }

  private getTargetSchema(): string | undefined {
    return TenantContext.current()?.schema || this.connection.getSchema();
  }

  private getTargetDatabase(): string | undefined {
    const config = this.connection.getConfig();
    if ("url" in config) {
      const url = new URL(config.url);
      const database = url.pathname.replace(/^\/+/, "");
      return database || undefined;
    }
    return config.database || config.filename;
  }

  private getAdminConnectionConfig(): ConnectionConfig | undefined {
    const driver = this.connection.getDriverName();
    if (driver === "sqlite") return undefined;

    const config = this.connection.getConfig();
    const adminDatabase = driver === "mysql" ? "mysql" : "postgres";

    if ("url" in config) {
      const url = new URL(config.url);
      url.pathname = `/${adminDatabase}`;
      return { url: url.toString() };
    }

    return { ...config, database: adminDatabase };
  }

  private async ensureDatabaseIfMissing(): Promise<void> {
    if (!this.shouldCreateIfMissing("database")) return;
    const driver = this.connection.getDriverName();
    if (driver === "sqlite") return;

    const database = this.getTargetDatabase();
    if (!database) {
      throw new Error("createIfMissing.database requires a database name in the connection config.");
    }

    const adminConfig = this.getAdminConnectionConfig();
    if (!adminConfig) return;

    const admin = new Connection(adminConfig);
    try {
      if (driver === "postgres") {
        const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);
        if (exists.length === 0) {
          await admin.run(`CREATE DATABASE ${admin.quoteIdentifier(database)}`);
        }
      } else if (driver === "mysql") {
        await admin.run(`CREATE DATABASE IF NOT EXISTS ${admin.quoteIdentifier(database)}`);
      }
    } finally {
      await admin.close();
    }
  }

  private async ensureSchemaIfMissing(): Promise<void> {
    if (!this.shouldCreateIfMissing("schema")) return;
    const schema = this.getTargetSchema();
    if (!schema) return;
    const driver = this.connection.getDriverName();
    if (driver === "sqlite") return;
    await Schema.createSchema(schema, this.connection);
  }

  private async ensureCreateIfMissing(): Promise<void> {
    await this.ensureDatabaseIfMissing();
    await this.ensureSchemaIfMissing();
  }

  private migrationsTable(connection: Connection = this.connection): string {
    return connection.qualifyTable("migrations");
  }

  private scopedMigrations(): Builder<any> {
    const builder = new Builder<any>(this.connection, this.migrationsTable());
    const tenantId = this.getTenantId();
    return tenantId === null ? builder.whereNull("tenant") : builder.where("tenant", tenantId);
  }

  private getLockName(): string {
    const tenantId = this.getTenantId();
    return tenantId === null ? "migrations:default" : `migrations:tenant:${tenantId}`;
  }

  private shouldLock(): boolean {
    return this.options.lock !== false;
  }

  private migrationsTableReady = false;

  private async acquireLock(): Promise<MigrationLockHandle | null> {
    if (!this.shouldLock()) return null;
    return await acquireMigrationLock(this.connection, this.getLockName(), {
      timeoutMs: this.options.lockTimeoutMs,
      maxAgeMs: this.options.lockMaxAgeMs,
    });
  }

  private async withMigrationLock<T>(callback: () => Promise<T>): Promise<T> {
    await this.ensureCreateIfMissing();
    const lock = await this.acquireLock();
    try {
      return await callback();
    } finally {
      await lock?.release();
    }
  }

  static on(event: MigrationEvent, listener: MigrationEventListener): () => void {
    const listeners = this.listeners.get(event) || new Set<MigrationEventListener>();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return () => listeners.delete(listener);
  }

  static clearListeners(event?: MigrationEvent): void {
    if (event) this.listeners.delete(event);
    else this.listeners.clear();
  }

  private async emit(event: MigrationEvent, payload: MigrationEventPayload): Promise<void> {
    for (const listener of Migrator.listeners.get(event) || []) {
      await listener(payload);
    }
  }

  private async getLastBatchNumber(): Promise<number> {
    await this.ensureMigrationsTable();
    const result = await this.scopedMigrations()
      .selectRaw("MAX(batch) as batch")
      .first();
    return (result as any)?.batch || 0;
  }

  private async getMigrationFiles(): Promise<{ id: string; fileName: string; fullPath: string; checksum: string }[]> {
    const files: { id: string; fileName: string; fullPath: string; checksum: string }[] = [];

    for (const path of this.getPaths()) {
      if (!existsSync(path)) continue;
      const entries = await readdir(path);
      for (const fileName of entries) {
        if (!fileName.endsWith(".ts") && !fileName.endsWith(".js")) continue;
        const fullPath = resolve(path, fileName);
        files.push({
          id: toPosixPath(relative(process.cwd(), fullPath)),
          fileName,
          fullPath,
          checksum: await this.checksumFile(fullPath),
        });
      }
    }

    return files.sort((a, b) => a.fileName.localeCompare(b.fileName) || a.id.localeCompare(b.id));
  }

  private async checksumFile(path: string): Promise<string> {
    const contents = await readFile(path);
    return createHash("sha256").update(contents).digest("hex");
  }

  private async withRuntimeConnection<T>(connection: Connection, callback: () => T | Promise<T>): Promise<T> {
    const previousLogQueries = connection.logQueries;

    connection.logQueries = false;
    try {
      return await TransactionContext.run(connection, () => TenantContext.withConnection(connection, callback));
    } finally {
      connection.logQueries = previousLogQueries;
    }
  }

  private async withoutSqlLogging<T>(callback: () => T | Promise<T>): Promise<T> {
    const previousConnectionLogQueries = this.connection.logQueries;
    this.connection.logQueries = false;
    try {
      return await callback();
    } finally {
      this.connection.logQueries = previousConnectionLogQueries;
    }
  }

  private async inTransaction<T>(callback: (connection: Connection) => T | Promise<T>): Promise<T> {
    return await this.connection.transaction(async (connection) => {
      return await this.withRuntimeConnection(connection, () => callback(connection));
    });
  }

  /** Applies every pending migration and returns their ids, in the order applied. */
  async run(): Promise<string[]> {
    return this.withoutSqlLogging(() => this.withMigrationLock(() => this.runUnlocked()));
  }

  /** Compiles every pending migration through the active driver's real grammar without writing. */
  async pretendRun(): Promise<PretendMigrationResult[]> {
    return this.withoutSqlLogging(async () => {
      const ran = await this.getRanRecordsReadOnly();
      const files = await this.getMigrationFiles();
      const pending = files.filter((file) => !ran.has(file.id) && !ran.has(file.fileName));
      this.reportChangedMigrations(files, ran);
      if (pending.length === 0) {
        this.write("Nothing to migrate.");
        return [];
      }

      const results: PretendMigrationResult[] = [];
      for (const file of pending) results.push(await this.pretendMigration(file.id, "up"));
      return results;
    });
  }

  private async runUnlocked(): Promise<string[]> {
    await this.ensureMigrationsTable();
    const ran = await this.getRanRecords();
    const files = await this.getMigrationFiles();
    const pending = files.filter((f) => !ran.has(f.id) && !ran.has(f.fileName));
    this.reportChangedMigrations(files, ran);

    if (pending.length === 0) {
      this.write("Nothing to migrate.");
      return [];
    }

    const batch = (await this.getLastBatchNumber()) + 1;
    const applied: string[] = [];

    await this.inTransaction(async (connection) => {
      for (const file of pending) {
        const migration = await this.resolve(file.id);
        this.write(`Migrating: ${file.id}`);
        await this.emit("migrating", { migration: file.id, batch });
        await migration.up();
        await new Builder(connection, this.migrationsTable(connection)).insert({
          migration: file.id,
          tenant: this.getTenantId(),
          checksum: file.checksum,
          batch,
        });
        await this.emit("migrated", { migration: file.id, batch });
        applied.push(file.id);
        this.write(`Migrated:  ${file.id}`);
      }
    });
    await this.generateTypesIfNeeded();
    return applied;
  }

  /**
   * A migration edited after it ran is not pending — it is already in the
   * migrations table — so run() would skip it and report "Nothing to migrate."
   * while the schema no longer matches the file that produced it. The only
   * honest options are to say so, or to be told to go ahead anyway.
   */
  private reportChangedMigrations(
    files: { id: string; fileName: string; checksum: string }[],
    ran: Map<string, MigrationRecord>
  ): void {
    const changed = files
      .filter((file) => {
        const record = ran.get(file.id) ?? ran.get(file.fileName);
        return !!record?.checksum && record.checksum !== file.checksum;
      })
      .map((file) => file.id);
    if (changed.length === 0) return;

    if (!this.options.allowChanged) {
      throw new Error(
        `${changed.length} migration file${changed.length === 1 ? " has" : "s have"} changed since ${changed.length === 1 ? "it" : "they"} ran: ` +
          `${changed.join(", ")}. The database no longer matches the file that produced it, and migrate cannot reconcile that on its own. ` +
          `Roll back and re-apply, or pass --allow-changed to migrate the rest anyway.`
      );
    }
    this.warn(`Warning: ${changed.length} changed migration(s) left untouched: ${changed.join(", ")}`);
  }

  /** Rolls back `steps` batches and returns the ids it undid, in the order undone. */
  async rollback(steps: number = 1): Promise<string[]> {
    return this.withoutSqlLogging(() => this.withMigrationLock(() => this.rollbackUnlocked(steps)));
  }

  /** Compiles the selected rollback batches without changing schema or migration records. */
  async pretendRollback(steps: number = 1): Promise<PretendMigrationResult[]> {
    return this.withoutSqlLogging(async () => {
      if (!(await Schema.hasTable("migrations", this.connection))) {
        this.write("Nothing to rollback.");
        return [];
      }

      const batches = await this.readRollbackBatches(steps);
      if (batches.length === 0) {
        this.write("Nothing to rollback.");
        return [];
      }
      const records = (await this.scopedMigrations()
        .whereIn("batch", batches)
        .orderBy("id", "desc")
        .get()) as MigrationRecord[];
      if (records.length === 0) {
        this.write("Nothing to rollback.");
        return [];
      }

      const results: PretendMigrationResult[] = [];
      for (const record of records) results.push(await this.pretendMigration(record.migration, "down"));
      return results;
    });
  }

  private async rollbackUnlocked(steps: number = 1): Promise<string[]> {
    await this.ensureMigrationsTable();
    const batches = await this.getRollbackBatches(steps);
    if (batches.length === 0) {
      this.write("Nothing to rollback.");
      return [];
    }

    const records = (await this.scopedMigrations()
      .whereIn("batch", batches)
      .orderBy("id", "desc")
      .get()) as MigrationRecord[];

    if (records.length === 0) {
      this.write("Nothing to rollback.");
      return [];
    }

    const rolledBack: string[] = [];
    await this.inTransaction(async (connection) => {
      for (const record of records) {
        const migration = await this.resolve(record.migration);
        this.write(`Rolling back: ${record.migration}`);
        await this.emit("rollingBack", { migration: record.migration, batch: record.batch });
        await migration.down();
        await new Builder(connection, this.migrationsTable(connection))
          .where("id", record.id)
          .delete();
        await this.emit("rolledBack", { migration: record.migration, batch: record.batch });
        rolledBack.push(record.migration);
        this.write(`Rolled back:  ${record.migration}`);
      }
    });
    await this.generateTypesIfNeeded();
    return rolledBack;
  }

  private async getRollbackBatches(steps: number): Promise<number[]> {
    await this.ensureMigrationsTable();
    return await this.readRollbackBatches(steps);
  }

  private async readRollbackBatches(steps: number): Promise<number[]> {
    const rows = await this.scopedMigrations()
      .select("batch")
      .orderBy("batch", "desc")
      .get();
    const batches: number[] = [];
    for (const row of rows as any[]) {
      const batch = Number(row.batch);
      if (!Number.isFinite(batch) || batches.includes(batch)) continue;
      batches.push(batch);
      if (batches.length >= steps) break;
    }
    return batches;
  }

  /** Rolls every batch back and returns the ids it undid. */
  async reset(): Promise<string[]> {
    return this.withoutSqlLogging(() => this.withMigrationLock(async () => {
      const rolledBack: string[] = [];
      while ((await this.getLastBatchNumber()) > 0) {
        rolledBack.push(...(await this.rollbackUnlocked()));
      }
      return rolledBack;
    }));
  }

  /** Rolls everything back and re-applies it, returning both halves. */
  async refresh(): Promise<{ rolledBack: string[]; applied: string[] }> {
    return this.withoutSqlLogging(() => this.withMigrationLock(async () => {
      const rolledBack: string[] = [];
      while ((await this.getLastBatchNumber()) > 0) {
        rolledBack.push(...(await this.rollbackUnlocked()));
      }
      return { rolledBack, applied: await this.runUnlocked() };
    }));
  }

  /** Drops every table and re-applies all migrations, returning what it applied. */
  async fresh(): Promise<string[]> {
    return this.withoutSqlLogging(() => this.withMigrationLock(async () => {
      await this.dropAllTables();
      return await this.runUnlocked();
    }));
  }

  private async generateTypesIfNeeded(): Promise<void> {
    const modelDirectories = normalizePathList(this.typeGeneratorOptions.modelDirectories || this.typeGeneratorOptions.modelDirectory);
    if (modelDirectories.length === 0) return;

    const outDir = join(modelDirectories[0], this.typeGeneratorOptions.declarationDirName || "types");
    const allowedTables = modelDirectories.length > 0 ? await discoverModelTables(modelDirectories) : undefined;
    const generator = new TypeGenerator(this.connection, {
      declarations: true,
      ...this.typeGeneratorOptions,
      outDir,
      allowedTables,
    });
    await generator.generate();
    const label = modelDirectories.map((dir) => join(dir, this.typeGeneratorOptions.declarationDirName || "types")).join(", ");
    this.write(`Regenerated types in ${label}`);
  }

  async status(): Promise<MigrationStatusRow[]> {
    return this.withoutSqlLogging(() => this.statusWithoutSqlLogging());
  }

  private async statusWithoutSqlLogging(): Promise<MigrationStatusRow[]> {
    await this.ensureCreateIfMissing();
    await this.ensureMigrationsTable();
    const ran = await this.getRanRecords();
    const files = await this.getMigrationFiles();
    const tenant = this.getTenantId();
    return files.map((file) => {
      const record = ran.get(file.id) || ran.get(file.fileName);
      const storedChecksum = record?.checksum ?? null;
      const batch = record?.batch;
      return {
        migration: file.id,
        status: !record ? "Pending" : storedChecksum && storedChecksum !== file.checksum ? "Changed" : "Ran",
        tenant,
        batch: batch === undefined || batch === null ? null : Number(batch),
        checksum: file.checksum,
        storedChecksum,
      };
    });
  }

  async dumpSchema(path: string): Promise<string> {
    return this.withoutSqlLogging(() => this.dumpSchemaWithoutSqlLogging(path));
  }

  private async dumpSchemaWithoutSqlLogging(path: string): Promise<string> {
    await this.ensureCreateIfMissing();
    const sql = await this.getSchemaDumpSql();
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, sql, "utf-8");
    await this.emit("schemaDumped", { path });
    return sql;
  }

  async squash(path: string): Promise<string> {
    return this.withoutSqlLogging(() => this.squashWithoutSqlLogging(path));
  }

  private async squashWithoutSqlLogging(path: string): Promise<string> {
    await this.ensureCreateIfMissing();
    const sql = await this.dumpSchemaWithoutSqlLogging(path);
    const files = await this.getMigrationFiles();

    let batch = 0;
    const lock = await this.acquireLock();
    try {
      await this.ensureMigrationsTable();
      batch = (await this.getLastBatchNumber()) + 1;
      await this.scopedMigrations().delete();
      for (const file of files) {
        await new Builder(this.connection, this.migrationsTable()).insert({
          migration: file.id,
          tenant: this.getTenantId(),
          checksum: file.checksum,
          batch,
        });
      }
    } finally {
      await lock?.release();
    }

    await this.emit("schemaSquashed", { path, batch });
    return sql;
  }

  private async getSchemaDumpSql(): Promise<string> {
    const driver = this.connection.getDriverName();
    if (driver === "sqlite") {
      const rows = await this.connection.query(
        "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND type IN ('table', 'index', 'trigger', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY type = 'table' DESC, name"
      );
      return rows.map((row: any) => `${String(row.sql).trim()};`).join("\n\n") + "\n";
    }

    if (driver === "mysql") {
      const tables = await this.connection.query("SHOW TABLES");
      const key = Object.keys(tables[0] ?? {})[0];
      const statements: string[] = [];
      for (const row of tables as any[]) {
        const table = row[key];
        const createRows = await this.connection.query(`SHOW CREATE TABLE ${this.connection.getGrammar().wrap(table)}`);
        statements.push(`${createRows[0]["Create Table"]};`);
      }
      return statements.join("\n\n") + "\n";
    }

    const schema = this.connection.getSchema() || "public";
    const tables = await this.connection.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name",
      [schema]
    );
    const statements: string[] = [];

    for (const tableRow of tables as any[]) {
      const table = tableRow.table_name;
      const columns = await this.connection.query(
        `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length, numeric_precision, numeric_scale
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2
         ORDER BY ordinal_position`,
        [schema, table]
      );
      const primaryKeys = await this.connection.query(
        `SELECT kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
          AND tc.table_name = kcu.table_name
         WHERE tc.table_schema = $1
           AND tc.table_name = $2
           AND tc.constraint_type = 'PRIMARY KEY'
         ORDER BY kcu.ordinal_position`,
        [schema, table]
      );
      const pkColumns = primaryKeys.map((row: any) => row.column_name);
      const columnSql = columns.map((column: any) => {
        let type = String(column.data_type).toUpperCase();
        if ((type === "CHARACTER VARYING" || type === "CHARACTER") && column.character_maximum_length) {
          type = `${type}(${column.character_maximum_length})`;
        } else if ((type === "NUMERIC" || type === "DECIMAL") && column.numeric_precision) {
          type = `${type}(${column.numeric_precision}${column.numeric_scale ? `, ${column.numeric_scale}` : ""})`;
        }

        let sql = `  ${this.connection.getGrammar().wrap(column.column_name)} ${type}`;
        if (column.is_nullable === "NO") sql += " NOT NULL";
        if (column.column_default !== null && column.column_default !== undefined) sql += ` DEFAULT ${column.column_default}`;
        return sql;
      });
      if (pkColumns.length > 0) {
        columnSql.push(`  PRIMARY KEY (${pkColumns.map((column: string) => this.connection.getGrammar().wrap(column)).join(", ")})`);
      }
      statements.push(`CREATE TABLE ${this.connection.getGrammar().wrap(`${schema}.${table}`)} (\n${columnSql.join(",\n")}\n);`);
    }

    return statements.join("\n\n") + "\n";
  }

  private async dropAllTables(): Promise<void> {
    // Whatever we cached about the migrations table stops being true here.
    this.migrationsTableReady = false;
    const driver = this.connection.getDriverName();
    const grammar = this.connection.getGrammar();

    if (driver === "sqlite") {
      await this.connection.run("PRAGMA foreign_keys = OFF");
      try {
        const rows = await this.connection.query(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        );
        for (const row of rows as any[]) {
          if (row.name === MIGRATION_LOCKS_TABLE) continue;
          await this.connection.run(`DROP TABLE IF EXISTS ${grammar.wrap(String(row.name))}`);
        }
      } finally {
        await this.connection.run("PRAGMA foreign_keys = ON");
      }
      return;
    }

    if (driver === "mysql") {
      const tables = await this.connection.query("SHOW TABLES");
      const key = Object.keys(tables[0] ?? {})[0];
      await this.connection.run("SET FOREIGN_KEY_CHECKS = 0");
      try {
        for (const row of tables as any[]) {
          await this.connection.run(`DROP TABLE IF EXISTS ${grammar.wrap(String(row[key]))}`);
        }
      } finally {
        await this.connection.run("SET FOREIGN_KEY_CHECKS = 1");
      }
      return;
    }

    const schema = this.connection.getSchema() || "public";
    const tables = await this.connection.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'",
      [schema]
    );
    for (const row of tables as any[]) {
      await this.connection.run(`DROP TABLE IF EXISTS ${grammar.wrap(`${schema}.${row.table_name}`)} CASCADE`);
    }
  }

  private async resolve(file: string): Promise<Migration> {
    const normalized = toPosixPath(file);
    const candidates = new Set<string>();

    if (normalized.includes("/")) {
      candidates.add(resolve(process.cwd(), normalized));
    } else {
      for (const path of this.getPaths()) {
        candidates.add(resolve(path, normalized));
      }
    }

    const matches = [...candidates].filter((candidate) => existsSync(candidate));
    if (matches.length === 0) {
      throw new Error(`Migration ${file} could not be found in the configured migration paths.`);
    }
    if (matches.length > 1) {
      throw new Error(`Migration ${file} is ambiguous across multiple migration paths.`);
    }

    const module = await import(/* @vite-ignore */ matches[0]);
    const MigrationClass = module.default || Object.values(module)[0];
    if (!MigrationClass) {
      throw new Error(`Migration ${file} does not export a class.`);
    }
    return new MigrationClass();
  }

  private async pretendMigration(file: string, direction: "up" | "down"): Promise<PretendMigrationResult> {
    const migration = await this.resolve(file);
    const { statements } = await this.connection.pretend(() =>
      this.withRuntimeConnection(this.connection, () =>
        direction === "up" ? migration.up() : migration.down()
      )
    );
    return { migration: file, direction, tenant: this.getTenantId(), statements };
  }

  private async getRanRecords(): Promise<Map<string, MigrationRecord>> {
    await this.ensureMigrationsTable();
    return await this.readRanRecords();
  }

  private async getRanRecordsReadOnly(): Promise<Map<string, MigrationRecord>> {
    if (!(await Schema.hasTable("migrations", this.connection))) return new Map();
    return await this.readRanRecords();
  }

  private async readRanRecords(): Promise<Map<string, MigrationRecord>> {
    const results = await this.scopedMigrations()
      .orderBy("id", "asc")
      .get();

    const records = new Map<string, MigrationRecord>();
    for (const row of results as MigrationRecord[]) {
      const migration = toPosixPath(String(row.migration));
      records.set(migration, row);
      records.set(basename(migration), row);
    }
    return records;
  }
}
