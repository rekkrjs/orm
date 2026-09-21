import { Connection, Model, Schema } from "../src/index.js";
import { rm } from "fs/promises";

export class PermissiveModel<T extends Record<string, any> = any> extends Model<T> {
  static guarded: string[] = [];
}

export function setupTestDb() {
  const connection = new Connection({ url: "sqlite://:memory:" });
  Model.setConnection(connection);
  Schema.setConnection(connection);
  return connection;
}

export async function teardownTestDb(connection: Connection) {
  await connection.driver.close();
}

export async function cleanupSqliteFile(path: string): Promise<void> {
  await rm(path, { force: true });
  await rm(`${path}-wal`, { force: true });
  await rm(`${path}-shm`, { force: true });
}

/**
 * The public shape of a model: what a loaded relation or a re-wrapped result
 * keeps. Protected members drop out of those `Omit`-based types, so a loaded
 * element is never assignable to the class itself — assert against this instead.
 */
export type PublicShape<M> = { [K in keyof M]: M[K] };
