// Does this Bun still drop the event-loop reference for in-flight MySQL queries?
// Diagnostic only — not part of the test suite. Background and removal steps:
// .tmp_hacks/bun-mysql-event-loop.md
//
// Usage: bun scripts/bun-mysql-eventloop-probe.ts [mysql-url]
//        (falls back to $MYSQL_TEST_URL)
//
// Exit codes:
//   0  at least one trigger still truncates → keep the workaround
//   3  every trigger resolved              → the workaround can be retired
//   1  could not reach the server          → nothing was learned
//
// Several triggers, not one. The pooled-queries shape of oven-sh/bun#26235 has
// become *flaky* rather than fixed — it resolved 2 runs out of 6 here — while
// `reserve()`, `begin()` and a second client still truncate every single time.
// oven-sh/bun#27102 is related but does not contain these exact local triggers;
// see the docs for the upstream map. A probe that only tried the flaky shape
// would authorise removal on a lucky run, so the verdict is pessimistic.
//
// Each attempt is a child process: it must be free of anything that would hold
// the event loop open on its own, which is why the parent uses spawnSync and
// why nothing in this file uses a top-level await.
import { SQL } from "bun";

// The pooled trigger resolved 2/6 times on a still-broken runtime. Twenty clean
// runs make a lucky false FIXED verdict vanishingly unlikely without turning
// this manual, upgrade-only probe into a long soak test.
const ATTEMPTS = 20;

/** Each trigger leaves the pool with more than one connection in play, then queries again. */
const TRIGGERS = {
  "reserve/release": async (sql: SQL) => {
    await sql.unsafe("SELECT 1");
    const reserved = await (sql as any).reserve();
    reserved.release?.();
  },
  "transaction": async (sql: SQL) => {
    await sql.unsafe("SELECT 1");
    await sql.begin(async (tx: any) => { await tx.unsafe("SELECT 1"); });
  },
  "second client": async (sql: SQL, url: string) => {
    await sql.unsafe("SELECT 1");
    const second = new SQL({ url, max: 1 });
    await second.unsafe("SELECT 1");
  },
  "pooled queries": async (sql: SQL) => {
    await Promise.all([sql.unsafe("SELECT 1"), sql.unsafe("SELECT 2")]);
  },
} satisfies Record<string, (sql: SQL, url: string) => Promise<void>>;

type TriggerName = keyof typeof TRIGGERS;

const CHILD_FLAG = "--child";
const args = process.argv.slice(2);
const url = args.find((arg) => !arg.startsWith("--")) ?? process.env.MYSQL_TEST_URL;

const childIndex = args.indexOf(CHILD_FLAG);
if (childIndex !== -1) runChild(url!, args[childIndex + 1] as TriggerName);
else runParent(url);

function runChild(url: string, trigger: TriggerName): void {
  const sql = new SQL({ url, max: 2 });

  async function probe(): Promise<void> {
    await TRIGGERS[trigger](sql, url);
    // The query that used to vanish, with nothing else keeping the loop alive.
    await sql.unsafe("SELECT 3");
    console.log("RESOLVED");
  }

  // Floated deliberately: `await probe()` at top level is itself a reference
  // Bun counts, and would mask the very thing being measured.
  probe().catch((error) => console.log(`ERROR ${error?.message ?? error}`));
}

function runParent(url?: string): void {
  if (!url) {
    console.error("Usage: bun scripts/bun-mysql-eventloop-probe.ts <mysql-url>  (or set MYSQL_TEST_URL)");
    process.exit(1);
  }

  console.log(`bun ${Bun.version} (${Bun.revision.slice(0, 9)})`);

  let truncated = 0;
  for (const trigger of Object.keys(TRIGGERS) as TriggerName[]) {
    let resolved = 0;
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      const child = Bun.spawnSync([process.execPath, "run", import.meta.path, url, CHILD_FLAG, trigger], {
        stdout: "pipe",
        stderr: "pipe",
        timeout: 30_000,
      });
      const stdout = child.stdout.toString().trim();
      const stderr = child.stderr.toString().trim();

      if (stdout.startsWith("ERROR") || (!stdout && stderr)) {
        console.error(`Could not run the probe: ${stdout.replace(/^ERROR /, "") || stderr}`);
        process.exit(1);
      }
      if (stdout.includes("RESOLVED")) resolved++;
    }

    const verdict = resolved === ATTEMPTS ? "resolved" : "TRUNCATED";
    console.log(`  ${trigger.padEnd(16)} ${String(resolved).padStart(2)}/${ATTEMPTS} resolved  ${verdict}`);
    if (resolved !== ATTEMPTS) truncated++;
  }

  if (truncated === 0) {
    console.log("\nFIXED — every trigger resolved with nothing else holding the event loop open.");
    console.log("The workaround in src/connection/Connection.ts can be retired:");
    console.log("see the removal checklist in .tmp_hacks/bun-mysql-event-loop.md.");
    process.exit(3);
  }

  console.log(`\nSTILL BROKEN — ${truncated} of ${Object.keys(TRIGGERS).length} triggers truncate.`);
  console.log("Keep the WORKAROUND(bun-mysql-eventloop) block in src/connection/Connection.ts.");
  process.exit(0);
}
