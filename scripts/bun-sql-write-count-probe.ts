/**
 * Does Bun report the affected-row count in the same property on every adapter?
 *
 * Bun 1.4.0 does not: SQLite and PostgreSQL put it in `count` (leaving
 * `affectedRows` null), MySQL puts it in `affectedRows` (leaving `count` at 0).
 * `@rekkr/orm` therefore needs a per-driver split to read a portable count.
 * This probe decides when that split can be retired.
 *
 * Usage:
 *   bun scripts/bun-sql-write-count-probe.ts <mysqlUrl> <postgresUrl>
 *
 * Both URLs are required for a verdict. Probing a subset can produce a false
 * FIXED: SQLite and PostgreSQL agree with each other, so omitting MySQL hides
 * the very divergence this probe exists to detect. Exit 3 = a single property
 * works on every adapter (fixed), exit 0 = still divergent or inconclusive,
 * exit 1 = a server could not be reached.
 *
 * See .tmp_hacks/bun-sql-write-count.md.
 */
import { SQL } from "bun";

const CANDIDATES = ["count", "affectedRows", "rowCount", "rowsAffected", "changes"] as const;
const TABLE = "orm_write_count_probe";

type Row = { adapter: string; values: Record<string, unknown>; matched: string[]; noOp: unknown };

async function probe(adapter: string, url?: string): Promise<Row> {
  const db = adapter === "sqlite"
    ? new SQL({ adapter: "sqlite", filename: ":memory:" })
    : new SQL({ url, max: 1 });

  const pk = adapter === "mysql" ? "INT AUTO_INCREMENT PRIMARY KEY"
    : adapter === "postgres" ? "SERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY";

  try {
    await db.unsafe(`DROP TABLE IF EXISTS ${TABLE}`);
    await db.unsafe(`CREATE TABLE ${TABLE} (id ${pk}, n TEXT)`);
    await db.unsafe(`INSERT INTO ${TABLE} (n) VALUES ('a'),('b'),('c')`);

    // Two rows change value: every adapter should agree this affected 2.
    const result: any = await db.unsafe(`UPDATE ${TABLE} SET n='z' WHERE id IN (1,2)`);
    const values: Record<string, unknown> = {};
    for (const key of CANDIDATES) values[key] = result?.[key];
    const matched = CANDIDATES.filter((key) => result?.[key] === 2);

    // Informational only: matched-vs-changed is a server semantic, not a Bun
    // bug, and is never expected to converge. It is excluded from the verdict.
    await db.unsafe(`UPDATE ${TABLE} SET n='same' WHERE id=3`);
    const noOpResult: any = await db.unsafe(`UPDATE ${TABLE} SET n='same' WHERE id=3`);
    const noOp = matched.length
      ? noOpResult?.[matched[0]!]
      : (noOpResult?.affectedRows ?? noOpResult?.count);

    await db.unsafe(`DROP TABLE IF EXISTS ${TABLE}`);
    return { adapter, values, matched, noOp };
  } finally {
    await db.close?.().catch(() => null);
  }
}

const mysqlUrl = process.argv[2];
const postgresUrl = process.argv[3];

if (!mysqlUrl || !postgresUrl) {
  console.error("Both a MySQL and a PostgreSQL URL are required.");
  console.error("Probing a subset can report a false FIXED: SQLite and PostgreSQL");
  console.error("already agree, so leaving MySQL out hides the divergence.");
  console.error("Usage: bun scripts/bun-sql-write-count-probe.ts <mysqlUrl> <postgresUrl>");
  process.exit(1);
}

console.log(`bun ${Bun.version} (${Bun.revision.slice(0, 9)})`);

const targets: Array<[string, string | undefined]> = [["sqlite", undefined]];
if (postgresUrl) targets.push(["postgres", postgresUrl]);
if (mysqlUrl) targets.push(["mysql", mysqlUrl]);

const rows: Row[] = [];
for (const [adapter, url] of targets) {
  try {
    rows.push(await probe(adapter, url));
  } catch (error) {
    console.error(`Could not probe ${adapter}: ${(error as Error).message}`);
    process.exit(1);
  }
}

const width = Math.max(...CANDIDATES.map((key) => key.length), 8);
console.log(`\n  UPDATE affecting 2 rows:\n`);
console.log(`  ${"adapter".padEnd(10)}${CANDIDATES.map((k) => k.padStart(width + 2)).join("")}`);
for (const row of rows) {
  const cells = CANDIDATES.map((key) => String(row.values[key] ?? "-").padStart(width + 2)).join("");
  console.log(`  ${row.adapter.padEnd(10)}${cells}`);
}

const portable = CANDIDATES.filter((key) => rows.every((row) => row.matched.includes(key)));

console.log(`\n  no-op UPDATE (informational, server semantic, not part of the verdict):`);
for (const row of rows) console.log(`    ${row.adapter.padEnd(10)} ${row.noOp}`);

if (portable.length > 0) {
  console.log(`\nFIXED — \`${portable[0]}\` reports the affected count on every adapter probed.`);
  console.log("The per-driver split in @rekkr/orm can be retired:");
  console.log("see the removal checklist in .tmp_hacks/bun-sql-write-count.md.");
  process.exit(3);
}

console.log("\nSTILL DIVERGENT — no single property reports the affected count everywhere.");
for (const row of rows) {
  console.log(`  ${row.adapter.padEnd(10)} needs ${row.matched.length ? row.matched.join(" or ") : "(none worked)"}`);
}
console.log("Keep the per-driver split; see .tmp_hacks/bun-sql-write-count.md.");
process.exit(0);
