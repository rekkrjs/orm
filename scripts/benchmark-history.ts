import assert from "node:assert/strict";
import { cpus, platform, arch, release, totalmem } from "node:os";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const suites = ["tests/benchmark-pipeline.test.ts", "tests/benchmark-hydration-plan.test.ts"];
const repetitions = 3;
const root = resolve(import.meta.dir, "..");

export function parseMetrics(output: string): Record<string, number> {
  const metrics: Record<string, number> = {};
  for (const line of output.split("\n")) {
    if (!/^(PIPELINE|PIPELINE_TRAPS|CEILING|CASTPLAN) /.test(line)) continue;
    const [kind, ...fields] = line.trim().split(/\s+/);
    const labels = fields.filter((field) => /^(rows|phase)=/.test(field)).sort();
    for (const field of fields) {
      const match = /^(\w+)=(-?\d+(?:\.\d+)?)(?:\/row)?$/.exec(field);
      if (!match || match[1] === "rows") continue;
      const key = [kind, ...labels, match[1]].join(" ");
      assert(!(key in metrics), `Duplicate benchmark metric: ${key}`);
      metrics[key] = Number(match[2]);
    }
  }
  assert(Object.keys(metrics).length > 0, "No benchmark metrics found");
  return metrics;
}

export function summarize(runs: Record<string, number>[]) {
  assert(runs.length > 0, "No benchmark runs found");
  const keys = Object.keys(runs[0]!).sort();
  for (const run of runs) assert.deepEqual(Object.keys(run).sort(), keys, "Benchmark metrics changed between runs");
  return Object.fromEntries(keys.map((key) => {
    const samples = runs.map((run) => run[key]!).sort((a, b) => a - b);
    assert(samples.every(Number.isFinite), `Non-finite benchmark metric: ${key}`);
    const middle = Math.floor(samples.length / 2);
    const median = samples.length % 2 ? samples[middle]! : (samples[middle - 1]! + samples[middle]!) / 2;
    return [key, { median, min: samples[0]!, max: samples.at(-1)! }];
  }));
}

function git(...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: root });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  return result.stdout.toString();
}

async function fingerprint(paths: string[]): Promise<string> {
  const hash = new Bun.CryptoHasher("sha256");
  for (const path of [...new Set(paths)].sort()) {
    const file = Bun.file(resolve(root, path));
    hash.update(path + "\0");
    hash.update(await file.exists() ? await file.arrayBuffer() : "<deleted>");
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function record() {
  assert(Bun.argv.length <= 3, "Usage: bun run bench:record [previous-result.json]");
  const baseline = Bun.argv[2] ? await Bun.file(Bun.argv[2]).json() : undefined;
  const environment = {
    bun: Bun.version, bunRevision: Bun.revision, os: platform(), osRelease: release(), arch: arch(),
    cpu: cpus()[0]?.model, cpuCount: cpus().length, memoryBytes: totalmem(), timezone: "UTC",
  };
  const harnessHash = await fingerprint([...suites, "scripts/benchmark-history.ts"]);
  if (baseline) {
    assert.equal(baseline.protocol, "sqlite-json-v2", "Incompatible benchmark protocol; record a new baseline");
    assert.equal(baseline.harnessHash, harnessHash, "Harness changed; record a new baseline");
    assert.deepEqual(baseline.environment, environment, "Runtime/machine changed; record a new baseline");
  }
  const sourcePaths = () => git("ls-files", "-co", "--exclude-standard", "-z", "--",
    "src", "tests", "scripts", "package.json", "bun.lock", "tsconfig.json", "tsconfig.test.json").split("\0").filter(Boolean);
  const sourceHash = await fingerprint(sourcePaths());
  const revision = git("rev-parse", "HEAD").trim();
  const worktree = git("status", "--short");
  const runs: { repetition: number; suite: string; metrics: Record<string, number>; stdout: string; stderr: string }[] = [];
  // Separate processes keep global model instrumentation and JIT state isolated.
  for (let repetition = 1; repetition <= repetitions; repetition++) {
    for (const suite of suites) {
      console.log(`Benchmark ${repetition}/${repetitions}: ${suite}`);
      const child = Bun.spawn([process.execPath, "test", suite], {
        cwd: root, env: { ...process.env, TZ: "UTC", NO_COLOR: "1" }, stdout: "pipe", stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ]);
      assert.equal(exitCode, 0, stdout + stderr);
      runs.push({ repetition, suite, metrics: parseMetrics(stdout), stdout, stderr });
    }
  }
  assert.equal(await fingerprint(sourcePaths()), sourceHash, "Source changed during benchmark; rerun");
  assert.equal(git("rev-parse", "HEAD").trim(), revision, "Revision changed during benchmark; rerun");
  const summary = Object.assign({}, ...suites.map((suite) => summarize(runs.filter((run) => run.suite === suite).map((run) => run.metrics)))) as ReturnType<typeof summarize>;
  const comparison = baseline ? Object.keys(summary).map((metric) => {
    const previous = baseline.summary?.[metric]?.median;
    assert(Number.isFinite(previous), `Missing baseline metric: ${metric}`);
    const current = summary[metric]!.median;
    return { metric, previous, current, deltaPercent: previous === 0 ? null : (current / previous - 1) * 100 };
  }) : undefined;
  const recordedAt = new Date().toISOString();
  const directory = resolve(root, "benchmarks/results");
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, `${recordedAt.replaceAll(":", "-")}-${revision.slice(0, 7)}-${crypto.randomUUID().slice(0, 8)}.json`);
  await Bun.write(path, JSON.stringify({ protocol: "sqlite-json-v2", recordedAt, revision, worktree, sourceHash,
    harnessHash, environment, repetitions, suites, runs, summary, baseline: Bun.argv[2], comparison }, null, 2) + "\n");
  if (comparison) console.table(comparison);
  console.log(`Saved: ${path}`);
}

if (import.meta.main) await record();
