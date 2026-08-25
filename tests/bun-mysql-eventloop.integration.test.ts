import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { Connection } from "../src/index.js";

const mysqlUrl = process.env.MYSQL_TEST_URL;
const runIfMySql = mysqlUrl ? test.serial : test.skip;

/**
 * Bun 1.4.0 stops holding the event loop open for an in-flight MySQL query once
 * the pool has had more than one connection in play, so a program that awaits
 * ORM calls without keeping the loop alive some other way exits 0 half way
 * through its work. `Connection` pins the loop open to compensate; this is the
 * regression test for that. Background: .tmp_hacks/bun-mysql-event-loop.md
 *
 * The work happens in a child process, on purpose: `bun test` keeps the loop
 * busy by itself, which would hide the very thing being asserted. The child
 * floats its promise (`main().catch(...)`) rather than awaiting at top level,
 * because a pending top-level await is a reference Bun does count.
 */
function childScript(url: string, table: string): string {
  const ormEntry = JSON.stringify(join(import.meta.dir, "../src/index.js"));
  const builderEntry = JSON.stringify(join(import.meta.dir, "../src/query/Builder.js"));
  return `
import { Connection } from ${ormEntry};
import { Builder } from ${builderEntry};

const connection = new Connection({ url: ${JSON.stringify(url)} });

async function main() {
  await connection.run("CREATE TABLE ${table} (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(32))");
  // insertGetId() reserves a pooled session on MySQL to read LAST_INSERT_ID().
  // Everything after this point is what used to vanish.
  const id = await new Builder(connection, "${table}").insertGetId({ name: "x" });
  const rows = await connection.query("SELECT COUNT(*) AS n FROM ${table}");
  await connection.run("DROP TABLE ${table}");
  await connection.close();
  console.log("OK id=" + id + " count=" + Number(rows[0].n));
}

main().catch((error) => { console.error(error); process.exit(1); });
`;
}

describe.serial("Bun MySQL event-loop workaround", () => {
  runIfMySql("a script that floats its promise still finishes its work", async () => {
    const table = `orm_eventloop_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
    const directory = await mkdtemp(join(tmpdir(), "orm-eventloop-"));
    const file = join(directory, "child.ts");
    await writeFile(file, childScript(mysqlUrl!, table));

    try {
      const child = Bun.spawn([process.execPath, "run", file], { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);

      // Without the workaround the child prints nothing at all and still exits 0.
      expect(stderr).toBe("");
      expect(stdout.trim()).toBe("OK id=1 count=1");
      expect(exitCode).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
      const cleaner = new Connection({ url: mysqlUrl! });
      await cleaner.run(`DROP TABLE IF EXISTS ${table}`).catch(() => null);
      await cleaner.close().catch(() => null);
    }
  });
});
