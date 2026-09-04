import { Schema } from "../schema/Schema.js";
import { Connection } from "../connection/Connection.js";
import type { JobRecord, QueueDriver } from "./QueueDriver.js";

export interface DatabaseQueueDriverOptions {
  table?: string;
  failedTable?: string;
}

interface RawJobRow {
  id: number;
  reservation_token: string;
  queue: string;
  job_class: string;
  payload: string;
  attempts: number;
  max_attempts: number;
  available_at: number;
  reserved_at: number | null;
  created_at: number;
}

function toJobRecord(row: RawJobRow): JobRecord {
  return {
    id: row.id,
    reservationToken: row.reservation_token,
    queue: row.queue,
    jobClass: row.job_class,
    payload: row.payload,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    availableAt: row.available_at,
    reservedAt: row.reserved_at,
    createdAt: row.created_at,
  };
}

export class DatabaseQueueDriver implements QueueDriver {
  private table: string;
  private failedTable: string;
  private sqliteMutex: Promise<void> = Promise.resolve();

  constructor(private connection: Connection, options: DatabaseQueueDriverOptions = {}) {
    this.table = options.table ?? "jobs";
    this.failedTable = options.failedTable ?? "failed_jobs";
    Connection.assertSafeIdentifier(this.table, "queue table");
    Connection.assertSafeIdentifier(this.failedTable, "failed queue table");
  }

  private async withSqliteMutex<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.sqliteMutex;
    let release!: () => void;
    this.sqliteMutex = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }

  async migrate(): Promise<void> {
    const driver = this.connection.getDriverName();
    const t = this.table;
    const f = this.failedTable;

    if (driver === "sqlite") {
      await this.connection.run(`
        CREATE TABLE IF NOT EXISTS ${t} (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          queue TEXT NOT NULL DEFAULT 'default',
          job_class TEXT NOT NULL,
          payload TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          max_attempts INTEGER NOT NULL DEFAULT 3,
          available_at INTEGER NOT NULL,
          reserved_at INTEGER,
          created_at INTEGER NOT NULL
        )
      `);
      await this.connection.run(`CREATE INDEX IF NOT EXISTS ${t}_queue_available ON ${t} (queue, available_at, reserved_at)`);
      await this.connection.run(`
        CREATE TABLE IF NOT EXISTS ${f} (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          queue TEXT NOT NULL,
          job_class TEXT NOT NULL,
          payload TEXT NOT NULL,
          exception TEXT NOT NULL,
          failed_at INTEGER NOT NULL
        )
      `);
    } else if (driver === "mysql") {
      await this.connection.run(`
        CREATE TABLE IF NOT EXISTS \`${t}\` (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          queue VARCHAR(255) NOT NULL DEFAULT 'default',
          job_class VARCHAR(512) NOT NULL,
          payload LONGTEXT NOT NULL,
          attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
          max_attempts TINYINT UNSIGNED NOT NULL DEFAULT 3,
          available_at INT UNSIGNED NOT NULL,
          reserved_at INT UNSIGNED,
          created_at INT UNSIGNED NOT NULL,
          INDEX ${t}_queue_available (queue, available_at, reserved_at)
        )
      `);
      await this.connection.run(`
        CREATE TABLE IF NOT EXISTS \`${f}\` (
          id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          queue VARCHAR(255) NOT NULL,
          job_class VARCHAR(512) NOT NULL,
          payload LONGTEXT NOT NULL,
          exception LONGTEXT NOT NULL,
          failed_at INT UNSIGNED NOT NULL
        )
      `);
    } else {
      await this.connection.run(`
        CREATE TABLE IF NOT EXISTS ${t} (
          id BIGSERIAL PRIMARY KEY,
          queue VARCHAR(255) NOT NULL DEFAULT 'default',
          job_class VARCHAR(512) NOT NULL,
          payload TEXT NOT NULL,
          attempts SMALLINT NOT NULL DEFAULT 0,
          max_attempts SMALLINT NOT NULL DEFAULT 3,
          available_at INTEGER NOT NULL,
          reserved_at INTEGER,
          created_at INTEGER NOT NULL
        )
      `);
      await this.connection.run(`CREATE INDEX IF NOT EXISTS ${t}_queue_available ON ${t} (queue, available_at, reserved_at)`);
      await this.connection.run(`
        CREATE TABLE IF NOT EXISTS ${f} (
          id BIGSERIAL PRIMARY KEY,
          queue VARCHAR(255) NOT NULL,
          job_class VARCHAR(512) NOT NULL,
          payload TEXT NOT NULL,
          exception TEXT NOT NULL,
          failed_at INTEGER NOT NULL
        )
      `);
    }
    // Additive migration keeps pending jobs and upgrades existing installations.
    if (!await Schema.hasColumn(this.table, "reservation_token", this.connection)) {
      try {
        await this.connection.run(`ALTER TABLE ${this.connection.getGrammar().wrap(this.table)} ADD COLUMN reservation_token VARCHAR(64) NULL`);
      } catch (error) {
        if (!await Schema.hasColumn(this.table, "reservation_token", this.connection)) throw error;
      }
    }
  }

  private placeholders(count: number): string {
    if (this.connection.getDriverName() === "postgres") {
      return Array.from({ length: count }, (_, i) => `$${i + 1}`).join(", ");
    }
    return Array.from({ length: count }, () => "?").join(", ");
  }

  async dispatch(queue: string, jobClass: string, payload: string, delaySeconds: number, maxAttempts: number): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const availableAt = now + delaySeconds;
    const t = this.table;
    const driver = this.connection.getDriverName();

    if (driver === "mysql") {
      await this.connection.run(
        `INSERT INTO \`${t}\` (queue, job_class, payload, attempts, max_attempts, available_at, created_at) VALUES (?, ?, ?, 0, ?, ?, ?)`,
        [queue, jobClass, payload, maxAttempts, availableAt, now],
      );
    } else if (driver === "postgres") {
      await this.connection.run(
        `INSERT INTO ${t} (queue, job_class, payload, attempts, max_attempts, available_at, created_at) VALUES ($1, $2, $3, 0, $4, $5, $6)`,
        [queue, jobClass, payload, maxAttempts, availableAt, now],
      );
    } else {
      await this.connection.run(
        `INSERT INTO ${t} (queue, job_class, payload, attempts, max_attempts, available_at, created_at) VALUES (?, ?, ?, 0, ?, ?, ?)`,
        [queue, jobClass, payload, maxAttempts, availableAt, now],
      );
    }
  }

  async reserve(queue: string, retryAfterSeconds: number): Promise<JobRecord | null> {
    const now = Math.floor(Date.now() / 1000);
    const token = crypto.randomUUID();
    const driver = this.connection.getDriverName();
    const grammar = this.connection.getGrammar();
    const t = grammar.wrap(this.table);
    const p = (n: number) => grammar.placeholder(n);
    const reserve = () => this.connection.transaction(async conn => {
      const rows = await conn.query(`SELECT * FROM ${t}
        WHERE queue = ${p(1)} AND (reserved_at IS NULL OR reserved_at <= ${p(2)}) AND available_at <= ${p(3)}
        ORDER BY id ASC LIMIT 1 ${driver === "sqlite" ? "" : "FOR UPDATE SKIP LOCKED"}`,
        [queue, now - retryAfterSeconds, now]) as RawJobRow[];
      const row = rows[0];
      if (!row) return null;
      await conn.run(`UPDATE ${t} SET reserved_at = ${p(1)}, reservation_token = ${p(2)}, attempts = attempts + 1 WHERE id = ${p(3)}`, [now, token, row.id]);
      return toJobRecord({ ...row, reservation_token: token, reserved_at: now, attempts: row.attempts + 1 });
    });
    return driver === "sqlite" ? this.withSqliteMutex(reserve) : reserve();
  }

  async complete(id: number, token: string): Promise<boolean> {
    const g = this.connection.getGrammar();
    const result = await this.connection.run(`DELETE FROM ${g.wrap(this.table)} WHERE id = ${g.placeholder(1)} AND reservation_token = ${g.placeholder(2)}`, [id, token]);
    return this.connection.affectedRows(result) > 0;
  }

  async fail(id: number, token: string, exception: string): Promise<boolean> {
    const driver = this.connection.getDriverName();
    const g = this.connection.getGrammar();
    const t = g.wrap(this.table);
    const fail = () => this.connection.transaction(async conn => {
      const rows = await conn.query(`SELECT * FROM ${t} WHERE id = ${g.placeholder(1)} AND reservation_token = ${g.placeholder(2)} ${driver === "sqlite" ? "" : "FOR UPDATE"}`, [id, token]) as RawJobRow[];
      const row = rows[0];
      if (!row) return false;
      await conn.run(`INSERT INTO ${g.wrap(this.failedTable)} (queue, job_class, payload, exception, failed_at) VALUES (${this.placeholders(5)})`,
        [row.queue, row.job_class, row.payload, exception, Math.floor(Date.now() / 1000)]);
      await conn.run(`DELETE FROM ${t} WHERE id = ${g.placeholder(1)} AND reservation_token = ${g.placeholder(2)}`, [id, token]);
      return true;
    });
    return driver === "sqlite" ? this.withSqliteMutex(fail) : fail();
  }

  async release(id: number, token: string, delaySeconds: number): Promise<boolean> {
    const g = this.connection.getGrammar();
    const result = await this.connection.run(`UPDATE ${g.wrap(this.table)} SET reserved_at = NULL, reservation_token = NULL, available_at = ${g.placeholder(1)} WHERE id = ${g.placeholder(2)} AND reservation_token = ${g.placeholder(3)}`,
      [Math.floor(Date.now() / 1000) + delaySeconds, id, token]);
    return this.connection.affectedRows(result) > 0;
  }

  async heartbeat(id: number, token: string): Promise<boolean> {
    const g = this.connection.getGrammar();
    // Select under lock also distinguishes a valid same-second MySQL heartbeat
    // from its zero changed-row count.
    const beat = () => this.connection.transaction(async conn => {
      const rows = await conn.query(`SELECT id FROM ${g.wrap(this.table)} WHERE id = ${g.placeholder(1)} AND reservation_token = ${g.placeholder(2)} ${this.connection.getDriverName() === "sqlite" ? "" : "FOR UPDATE"}`, [id, token]);
      if (!rows.length) return false;
      await conn.run(`UPDATE ${g.wrap(this.table)} SET reserved_at = ${g.placeholder(1)} WHERE id = ${g.placeholder(2)} AND reservation_token = ${g.placeholder(3)}`, [Math.floor(Date.now() / 1000), id, token]);
      return true;
    });
    return this.connection.getDriverName() === "sqlite" ? this.withSqliteMutex(beat) : beat();
  }

  async size(queue?: string): Promise<number> {
    const driver = this.connection.getDriverName();
    const t = driver === "mysql" ? `\`${this.table}\`` : this.table;
    const rows = (queue
      ? driver === "postgres"
        ? await this.connection.query(`SELECT COUNT(*) as cnt FROM ${t} WHERE queue = $1`, [queue])
        : await this.connection.query(`SELECT COUNT(*) as cnt FROM ${t} WHERE queue = ?`, [queue])
      : await this.connection.query(`SELECT COUNT(*) as cnt FROM ${t}`)) as { cnt: number }[];
    return Number(rows[0]?.cnt ?? 0);
  }
}
