// See benchmarks/http/README.md. Requires Bun, git, tar, oha and MySQL/MariaDB.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpus, platform, release, arch } from "node:os";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { endpoint, expectedBody, modes, workloads } from "../benchmarks/http/server.js";

const root = resolve(import.meta.dir, "..");
process.chdir(root);
assert(process.env.BENCH_HTTP_URL, "Set BENCH_HTTP_URL to a MySQL/MariaDB database URL");
const option = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  assert(Number.isInteger(value) && value > 0 && value <= 10_000, name);
  return value;
};
const seconds = option("BENCH_HTTP_SECONDS", 60), warmup = option("BENCH_HTTP_WARMUP", 5);
const connections = option("BENCH_HTTP_CONNECTIONS", 1000), repetitions = option("BENCH_HTTP_REPETITIONS", 1);
const refs = process.argv.slice(2);
if (!refs.length) refs.push("v2.5.0", "v3.1.1");
assert.equal(refs.length, 2, "Pass exactly two Git refs");
const command = (...args: string[]) => {
  const result = Bun.spawnSync(args, { cwd: root });
  assert.equal(result.exitCode, 0, `${args[0]} failed: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
};
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const output = resolve(process.env.BENCH_HTTP_OUTPUT ?? "benchmarks/http/results");
await mkdir(output, { recursive: true }); await mkdir("tmp_agents", { recursive: true });
const scratch = await mkdtemp(resolve("tmp_agents/bench-http-"));
const id = new Date().toISOString().replaceAll(":", "-") + "-" + crypto.randomUUID().slice(0, 8);
const record = {
  protocol: "orm-http-v1", createdAt: new Date().toISOString(),
  seconds, warmupSeconds: warmup, connections, repetitions, poolMax: 10,
  bun: Bun.version, bunRevision: Bun.revision, oha: command("oha", "--version"),
  machine: { cpu: cpus()[0]?.model, os: platform(), release: release(), arch: arch() },
  harnessSha256: sha(await Bun.file(import.meta.path).text() + await Bun.file("benchmarks/http/server.ts").text()),
  fixtures: Object.fromEntries(workloads.map(w => [w, { rows: w === "users" ? 500 : 1000,
    bytes: Buffer.byteLength(expectedBody(w)), sha256: sha(expectedBody(w)) }])),
  variants: [] as { ref: string; commit: string; sourceSha256: string }[],
  runs: [] as { ref: string; endpoint: string; repetition: number; databaseVersion: string; metrics: any }[],
};
const file = resolve(output, `${id}.json`);
const save = () => Bun.write(file, JSON.stringify(record, null, 2) + "\n");
let serverProcess: ReturnType<typeof Bun.spawn> | undefined;
let loadProcess: ReturnType<typeof Bun.spawn> | undefined;
let cancelled = false;
const cancel = () => { cancelled = true; loadProcess?.kill(); serverProcess?.kill(); };
process.on("SIGINT", cancel); process.on("SIGTERM", cancel);
try {
  const sources: string[] = [];
  for (const [index, ref] of refs.entries()) {
    const commit = command("git", "rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`);
    const directory = resolve(scratch, String(index)); await mkdir(directory);
    const archive = resolve(scratch, `${index}.tar`);
    command("git", "archive", `--output=${archive}`, commit, "src", "package.json");
    command("tar", "-xf", archive, "-C", directory);
    const source = resolve(directory, "src");
    const digest = createHash("sha256");
    for (const path of [...new Bun.Glob("**/*.ts").scanSync(source)].sort()) {
      digest.update(path).update(await Bun.file(resolve(source, path)).text());
    }
    record.variants.push({ ref, commit, sourceSha256: digest.digest("hex") }); sources.push(source);
  }
  await save();
  for (let repetition = 1; repetition <= repetitions; repetition++) {
    let index = 0;
    for (const workload of workloads) for (const mode of modes) {
      const path = endpoint(workload, mode);
      for (const variant of (index++ + repetition) % 2 ? [0, 1] : [1, 0]) {
        assert(!cancelled, "Benchmark interrupted");
        const child = Bun.spawn([process.execPath, "--no-env-file", "benchmarks/http/server.ts"], {
          env: { ...process.env, TZ: "UTC", BENCH_ORM_SOURCE: sources[variant], BENCH_HTTP_PORT: "0" },
          stdout: "pipe", stderr: Bun.file(resolve(scratch, "server.log")),
        });
        serverProcess = child;
        try {
          const timer = setTimeout(() => child.kill(), 30_000);
          const reader = child.stdout.getReader();
          let line = "";
          try {
            while (!line.includes("\n")) {
              const chunk = await reader.read();
              assert(!chunk.done, `Server failed to start; inspect ${scratch}/server.log`);
              line += new TextDecoder().decode(chunk.value);
            }
          } finally { clearTimeout(timer); reader.releaseLock(); }
          const ready = JSON.parse(line.trim());
          assert.equal(ready.source, sources[variant]);
          // Check all routes against independent expected fixture values, not
          // merely against one another; do this outside the timed load.
          for (const w of workloads) for (const m of modes) {
            const response = await fetch(new URL(endpoint(w, m), ready.url));
            assert.equal(response.status, 200); assert.equal(sha(await response.text()), sha(expectedBody(w)), endpoint(w, m));
          }
          let metrics: any;
          for (const [phase, duration] of [["warmup", warmup], ["measure", seconds]] as const) {
            console.log(`${refs[variant]} ${path} ${phase} ${duration}s (round ${repetition})`);
            const load = Bun.spawn(["oha", "-z", `${duration}s`, "-c", String(connections), "--no-tui", "-w",
              "--output-format", "json", new URL(path, ready.url).href], { stdout: "pipe", stderr: "inherit" });
            loadProcess = load;
            const text = await new Response(load.stdout).text();
            assert.equal(await load.exited, 0, "oha failed"); loadProcess = undefined;
            metrics = JSON.parse(text);
            assert.equal(metrics.summary.successRate, 1); assert.deepEqual(metrics.errorDistribution, {});
            assert.deepEqual(Object.keys(metrics.statusCodeDistribution), ["200"]);
          }
          record.runs.push({ ref: refs[variant]!, endpoint: path, repetition, databaseVersion: ready.databaseVersion, metrics });
          await save();
          console.log(`${metrics.summary.requestsPerSec.toFixed(2)} req/s`);
        } finally {
          child.kill();
          assert.equal(await child.exited, 0, `Server cleanup failed; inspect ${scratch}/server.log`);
          serverProcess = undefined;
        }
      }
    }
  }
  await rm(scratch, { recursive: true });
  console.log(`Results: ${file}`);
} finally {
  loadProcess?.kill(); serverProcess?.kill();
  process.off("SIGINT", cancel); process.off("SIGTERM", cancel);
  // Failed runs retain scratch logs and snapshots for diagnosis.
}
