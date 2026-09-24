import { describe, expect, evalCommand, ormModule, runProcess, test } from "./harness.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Connection, Model, Schema } from "../src/index.js";
import { primaryKeyColumn } from "../src/model/PrimaryKeyResolution.js";
import { shouldGeneratePrimaryKeyForColumn } from "../src/utils.js";
import { PermissiveModel } from "./helpers.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * `primaryKeyColumn()` remembers a table's key column so create() stops reading
 * the schema before every insert. These pin what it must never remember: a
 * read that overlapped a schema change, one database's answer for another's
 * table, and a table that did not exist yet.
 */
describe("primaryKeyColumn", () => {
  test("a lookup that overlaps a schema change is not kept", async () => {
    const connection = new Connection({ url: "sqlite://:memory:" });
    await connection.run("CREATE TABLE overlap_rows (id INTEGER PRIMARY KEY, name TEXT)");
    const original = Schema.getColumn;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let reads = 0;
    Schema.getColumn = async function (this: typeof Schema, ...args: Parameters<typeof Schema.getColumn>) {
      if (++reads === 1) await gate;
      return await original.apply(this, args);
    } as typeof Schema.getColumn;
    try {
      const overlapped = primaryKeyColumn(connection, "overlap_rows", "id");
      await connection.run("ALTER TABLE overlap_rows ADD COLUMN extra TEXT");
      release();
      expect((await overlapped)?.name).toBe("id");

      await primaryKeyColumn(connection, "overlap_rows", "id");
      expect(reads).toBe(2);
      await primaryKeyColumn(connection, "overlap_rows", "id");
      expect(reads).toBe(2);
    } finally {
      Schema.getColumn = original;
      await connection.close();
    }
  });

  test("each database keeps its own answer for the same table name", async () => {
    const assigned = new Connection({ url: "sqlite://:memory:" });
    const generated = new Connection({ url: "sqlite://:memory:" });
    try {
      await assigned.run("CREATE TABLE twin_rows (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)");
      await generated.run("CREATE TABLE twin_rows (id VARCHAR(36) PRIMARY KEY, name TEXT)");
      // Twice: the second round answers from memory.
      for (let round = 0; round < 2; round++) {
        expect(shouldGeneratePrimaryKeyForColumn(await primaryKeyColumn(assigned, "twin_rows", "id"))).toBe(false);
        expect(shouldGeneratePrimaryKeyForColumn(await primaryKeyColumn(generated, "twin_rows", "id"))).toBe(true);
      }
      // A transaction's session is the same database, so it shares the answer.
      await generated.transaction(async (tx) => {
        expect(shouldGeneratePrimaryKeyForColumn(await primaryKeyColumn(tx, "twin_rows", "id"))).toBe(true);
      });
    } finally {
      await assigned.close();
      await generated.close();
    }
  });

  // Another process's DDL cannot bump this one's schema version, so the only
  // thing that lets a create() see a table that appears later is not having
  // remembered its absence.
  test("a table that did not exist is not remembered, so one created by another process is used", async () => {
    const dir = await mkdtemp(join(tmpdir(), "orm-pk-cache-"));
    const url = `sqlite://${join(dir, "app.sqlite")}`;
    const connection = new Connection({ url });
    class LateRow extends PermissiveModel {
      declare id: string;
      static override table = "late_rows";
      static override timestamps = false;
    }
    Model.setConnection(connection);
    try {
      await expect(LateRow.create({ name: "too early" })).rejects.toThrow();

      const script = `
        const { Connection } = await import(${JSON.stringify(ormModule("src/index.ts"))});
        const other = new Connection({ url: ${JSON.stringify(url)} });
        await other.run("CREATE TABLE late_rows (id VARCHAR(36) PRIMARY KEY, name TEXT)");
        await other.close();
      `;
      expect((await runProcess(evalCommand(script))).exitCode).toBe(0);

      expect((await LateRow.create({ name: "in time" })).id).toMatch(UUID);
    } finally {
      await connection.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
