/**
 * Does bun:sql recover a prepared statement whose result shape changed?
 *
 * Bun 1.4.2 does not: after `ALTER TABLE ... ADD COLUMN`, a `SELECT *` it had
 * prepared fails with `cached plan must not change result type` (0A000) on
 * that connection for as long as the connection lives. `@rekkr/orm` therefore
 * defaults PostgreSQL to `prepare: false`. This probe decides when Bun's
 * default can be restored.
 *
 * Usage:
 *   bun scripts/bun-sql-prepared-plan-probe.ts <postgresUrl>
 *
 * Exit 3 = fixed: the statement works again outside a transaction, and after
 * failing inside one. Exit 0 = still broken. Exit 1 = the server could not be
 * reached or the probe could not set up its table.
 *
 * See .tmp_hacks/bun-sql-prepared-plan-cache.md.
 */
import { SQL } from "bun";

const url = process.argv[2];
if (!url) {
  console.error("Usage: bun scripts/bun-sql-prepared-plan-probe.ts <postgresUrl>");
  process.exit(1);
}

// One connection: every statement must meet the session that cached the plan.
const sql = new SQL({ url, max: 1, prepare: true });
const table = `orm_prepared_plan_probe_${process.pid}`;
const select = (runner: SQL) => runner.unsafe(`SELECT * FROM ${table} WHERE id = $1`, [1]);
// A second statement, prepared fresh for the transaction phase: on a broken
// Bun the first one stays unusable after the first ALTER.
const selectAgain = (runner: SQL) => runner.unsafe(`SELECT * FROM ${table} WHERE a = $1`, [1]);
const attempt = async (run: () => Promise<unknown>): Promise<string> => {
  try {
    await run();
    return "ok";
  } catch (error: any) {
    return `${error.errno ?? error.code} ${error.message}`;
  }
};

console.log(`bun ${Bun.version} (${Bun.revision.slice(0, 9)})`);
try {
  await sql.unsafe(`CREATE TABLE ${table} (id int PRIMARY KEY, a int)`);
  await sql.unsafe(`INSERT INTO ${table} VALUES (1, 1)`);
  await select(sql);
} catch (error) {
  console.error(`Could not set up the probe: ${(error as Error).message}`);
  process.exit(1);
}

let outside: string[];
let inside: string;
let afterTransaction: string;
let burst: string;
try {
  await sql.unsafe(`ALTER TABLE ${table} ADD COLUMN b int`);
  outside = [await attempt(() => select(sql)), await attempt(() => select(sql))];

  // Inside a transaction PostgreSQL aborts on the error, so no driver can hide
  // it there. What a fix must do is evict the plan, so the next query works.
  await selectAgain(sql);
  await sql.unsafe(`ALTER TABLE ${table} ADD COLUMN c int`);
  inside = await attempt(() => sql.begin((tx) => selectAgain(tx)));
  afterTransaction = await attempt(() => selectAgain(sql));

  // Informational: executions already pipelined on the connection when the
  // error arrives. PR #35120 fails those once and recovers for the next ones.
  const selectBurst = (runner: SQL) => runner.unsafe(`SELECT * FROM ${table} WHERE id > $1`, [0]);
  await selectBurst(sql);
  await sql.unsafe(`ALTER TABLE ${table} ADD COLUMN d int`);
  const settled = await Promise.allSettled(Array.from({ length: 10 }, () => selectBurst(sql)));
  const next = await Promise.allSettled(Array.from({ length: 10 }, () => selectBurst(sql)));
  const rejected = (results: PromiseSettledResult<unknown>[]) => results.filter((result) => result.status === "rejected").length;
  burst = `${rejected(settled)}/10 failed, then ${rejected(next)}/10`;
} finally {
  await sql.unsafe(`DROP TABLE IF EXISTS ${table}`).catch(() => {});
  await sql.close();
}

console.log(`\n  after ADD COLUMN, outside a transaction: ${outside.join(" | ")}`);
console.log(`  after ADD COLUMN, inside a transaction:  ${inside} (informational: an error here is expected)`);
console.log(`  next query after that transaction:       ${afterTransaction}`);
console.log(`  10 concurrent runs after ADD COLUMN:     ${burst} (informational)`);

if (outside.every((result) => result === "ok") && afterTransaction === "ok") {
  console.log("\nFIXED — bun:sql re-prepares a statement whose result shape changed.");
  console.log("Bun's `prepare: true` default can come back for PostgreSQL:");
  console.log("see the removal checklist in .tmp_hacks/bun-sql-prepared-plan-cache.md.");
  process.exit(3);
}

console.log("\nSTILL BROKEN — a cached plan keeps failing on its connection.");
console.log("Keep `prepare: false` for PostgreSQL; see .tmp_hacks/bun-sql-prepared-plan-cache.md.");
process.exit(0);
