import { Connection, Model, Schema } from "../src/index.js";

/**
 * A disposable database for a targeted multidriver test.
 *
 * Each context owns a namespace of its own — a database on MySQL, a schema on
 * PostgreSQL — and drops **only that one** when it is done. It never sweeps by
 * prefix: two suites running at once, on one machine or several, must not be
 * able to delete each other's namespace, and a pid is not unique across
 * machines or containers.
 */
export type ServerDriver = "mysql" | "postgres";

export const mysqlUrl = process.env.MYSQL_TEST_URL;
export const postgresUrl = process.env.POSTGRES_TEST_URL;

export function serverUrl(driver: ServerDriver): string | undefined {
  return driver === "mysql" ? mysqlUrl : postgresUrl;
}

export interface DriverContext {
  driver: ServerDriver;
  connection: Connection;
  namespace: string;
  dispose(): Promise<void>;
}

function uniqueNamespace(): string {
  return `orm_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function createDriverContext(driver: ServerDriver): Promise<DriverContext> {
  const url = serverUrl(driver);
  if (!url) throw new Error(`${driver} tests need ${driver === "mysql" ? "MYSQL_TEST_URL" : "POSTGRES_TEST_URL"}.`);

  const namespace = uniqueNamespace();
  const admin = new Connection({ url });
  try {
    if (driver === "mysql") {
      await admin.run("SET time_zone = '+00:00'");
      await admin.run(`CREATE DATABASE \`${namespace}\``);
    }
    else await admin.run(`CREATE SCHEMA "${namespace}"`);
  } finally {
    await admin.close().catch(() => null);
  }

  let connection: Connection;
  if (driver === "mysql") {
    const target = new URL(url);
    target.pathname = `/${namespace}`;
    connection = new Connection({ url: target.toString(), max: 1 });
    // ORM stores UTC and refuses a session that is not. One session (max: 1)
    // is what makes a SET stick — it reaches a single pooled connection.
    await connection.run("SET time_zone = '+00:00'");
  } else {
    // `schema` only qualifies what the ORM builds; raw SQL in a test would still
    // land in public. A single session with search_path set keeps everything —
    // ORM and raw SQL alike — inside the namespace.
    connection = new Connection({ url, schema: namespace, max: 1 });
    await connection.run(`SET search_path TO "${namespace}"`);
  }

  Model.setConnection(connection);
  Schema.setConnection(connection);

  return {
    driver,
    connection,
    namespace,
    dispose: async () => {
      await connection.close().catch(() => null);
      const cleaner = new Connection({ url });
      try {
        if (driver === "mysql") {
          await cleaner.run("SET time_zone = '+00:00'");
          await cleaner.run(`DROP DATABASE IF EXISTS \`${namespace}\``);
        }
        else await cleaner.run(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
      } finally {
        await cleaner.close().catch(() => null);
      }
    },
  };
}
