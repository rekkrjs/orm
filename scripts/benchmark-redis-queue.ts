// Redis queue investigation: isolated source variants, no production source edits.
// See benchmarks/redis-queue-investigation.md. Requires local redis-server by default.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpus, platform, release } from "node:os";
import { mkdir, mkdtemp } from "node:fs/promises";
import { resolve } from "node:path";
import { RedisClient } from "bun";

const numberOption = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  assert(Number.isInteger(value) && value >= 0 && value <= 200_000, name);
  return value;
};
const count = numberOption("REDIS_BENCH_COUNT", 20_000);
const warmup = numberOption("REDIS_BENCH_WARMUP", 2_000);
const concurrency = numberOption("REDIS_BENCH_CONCURRENCY", 8);
const repetitions = numberOption("REDIS_BENCH_REPETITIONS", 6);
assert(count && concurrency && repetitions);
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const parseInfo = (raw: string) => Object.fromEntries(raw.split(/\r?\n/).filter(line => line.includes(":")).map(line => {
  const i = line.indexOf(":"); return [line.slice(0, i), line.slice(i + 1)];
}));
const summary = (values: Float64Array) => {
  values.sort();
  return { medianMs: values[Math.floor(values.length / 2)], p95Ms: values[Math.ceil(values.length * .95) - 1], p99Ms: values[Math.ceil(values.length * .99) - 1], maxMs: values.at(-1) };
};
const SEED = `
local base, count = tonumber(ARGV[1]), tonumber(ARGV[2])
for i = base + 1, base + count do
  redis.call('HSET', ARGV[3] .. i, 'queue', 'bench', 'jobClass', 'Job', 'payload', ARGV[4],
    'attempts', 0, 'maxAttempts', 3, 'availableAt', ARGV[5], 'createdAt', ARGV[5])
  redis.call('RPUSH', KEYS[1], i)
end
redis.call('SET', KEYS[2], base + count)
return count`;

async function child() {
  const file = process.argv[process.argv.indexOf("--child") + 1]!;
  const { RedisQueueDriver } = await import(resolve(file));
  const client = new RedisClient(process.env.REDIS_BENCH_URL!);
  const prefix = `queue_probe_${crypto.randomUUID()}:`;
  const driver = new RedisQueueDriver(client, { prefix });
  const seed = async (rows: number) => {
    for (let start = 0; start < rows; start += 1_000) await client.send("EVAL", [SEED, "2", `${prefix}pending:bench`, `${prefix}id`, String(start), String(Math.min(1_000, rows - start)), `${prefix}job:`, '{"args":[]}', String(Math.floor(Date.now() / 1000))]);
  };
  const run = async (rows: number) => {
    const times = new Float64Array(rows), reserveTimes = new Float64Array(rows), completeTimes = new Float64Array(rows);
    const seen = new Uint8Array(rows + 1);
    let next = 0;
    const start = performance.now();
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (next < rows) {
        const index = next++, started = performance.now();
        const job = await driver.reserve("bench", 300);
        const reserved = performance.now();
        assert(job && job.id > 0 && job.id <= rows && !seen[job.id], "Missing/duplicate job");
        seen[job.id] = 1;
        const completed = await driver.complete(job.id, job.reservationToken);
        assert(completed !== false, "Acknowledgement lost");
        const finished = performance.now();
        times[index] = finished - started; reserveTimes[index] = reserved - started; completeTimes[index] = finished - reserved;
      }
    }));
    const elapsedMs = performance.now() - start;
    assert.equal(seen.reduce((sum, value) => sum + value, 0), rows);
    assert.equal(Number(await client.send("ZCARD", [`${prefix}reserved:bench`])), 0);
    assert.equal(Number(await client.send("LLEN", [`${prefix}pending:bench`])), 0);
    return { elapsedMs, jobsPerSecond: rows * 1000 / elapsedMs, ...summary(times), reserve: summary(reserveTimes), complete: summary(completeTimes) };
  };
  try {
    await client.send("PING", []);
    if (warmup) { await seed(warmup); await run(warmup); }
    await seed(count);
    const before = parseInfo(String(await client.send("INFO", ["stats", "cpu", "commandstats", "persistence"])));
    const memoryBefore = process.memoryUsage();
    const result = await run(count);
    const after = parseInfo(String(await client.send("INFO", ["stats", "cpu", "commandstats", "persistence"])));
    const delta = Object.fromEntries(["total_net_input_bytes", "total_net_output_bytes", "used_cpu_sys", "used_cpu_user", "rdb_saves", "aof_delayed_fsync", "evicted_scripts"].map(key => [key, Number(after[key] ?? 0) - Number(before[key] ?? 0)]));
    const commands = Object.fromEntries(Object.keys(after).filter(key => key.startsWith("cmdstat_")).map(key => {
      const parse = (s = "") => Object.fromEntries(s.split(",").map(kv => { const [k,v] = kv.split("="); return [k, Number(v)]; }));
      const a = parse(after[key]), b = parse(before[key]);
      return [key.slice(8), { calls: (a.calls ?? 0) - (b.calls ?? 0), usec: (a.usec ?? 0) - (b.usec ?? 0) }];
    }).filter(([, value]) => (value as any).calls));
    let leaseCheck = "not-applicable-diagnostic";
    if (!file.endsWith("/v2.ts") && !file.endsWith("/v3-constant-token.ts") && !file.endsWith("/v3-no-token-lua.ts")) {
      await driver.dispatch("lease-proof", "Job", '{"args":[]}', 0, 5);
      const old = await driver.reserve("lease-proof", 300);
      const current = await driver.reserve("lease-proof", 0);
      assert(old && current && old.id === current.id && old.reservationToken !== current.reservationToken);
      assert.equal(await driver.complete(old.id, old.reservationToken), false);
      assert.equal(await driver.release(old.id, old.reservationToken, 0), false);
      assert.equal(await driver.fail(old.id, old.reservationToken, "stale"), false);
      assert.equal(await driver.heartbeat(old.id, old.reservationToken), false);
      assert.equal(await driver.heartbeat(current.id, current.reservationToken), true);
      assert.equal(await driver.release(current.id, current.reservationToken, 0), true);
      const latest = await driver.reserve("lease-proof", 300);
      assert(latest && latest.reservationToken !== current.reservationToken);
      assert.equal(await driver.complete(latest.id, latest.reservationToken), true);
      assert.equal(Number(await client.send("LLEN", [`${prefix}failed`])), 0);
      leaseCheck = "passed";
    }
    console.log(JSON.stringify({ ...result, leaseCheck, memoryBefore, memoryAfter: process.memoryUsage(), delta, commands, persistence: { before: before.rdb_bgsave_in_progress, after: after.rdb_bgsave_in_progress } }));
  } finally {
    // Only this run's keys; never change configuration or flush a shared server.
    let cursor = "0";
    do {
      const result = await client.send("SCAN", [cursor, "MATCH", `${prefix}*`, "COUNT", "1000"]) as [string, string[]];
      cursor = String(result[0]); if (result[1].length) await client.send("DEL", result[1]);
    } while (cursor !== "0");
    client.close();
  }
}

if (process.argv.includes("--child")) { await child(); process.exit(0); }

await mkdir("tmp", { recursive: true });
const directory = await mkdtemp(resolve("tmp/redis-investigation-"));
const baseline = Bun.spawnSync(["git", "show", "683373b:src/queue/RedisQueueDriver.ts"]);
assert.equal(baseline.exitCode, 0);
const v3Baseline = Bun.spawnSync(["git", "show", "654e508:src/queue/RedisQueueDriver.ts"]);
assert.equal(v3Baseline.exitCode, 0);
// Keep historical variants fixed; compare production changes through worktree.
const current = v3Baseline.stdout.toString();
const variants: Record<string, string> = { v2: baseline.stdout.toString(), v3: current, worktree: await Bun.file("src/queue/RedisQueueDriver.ts").text() };
// Attribution only: this deliberately removes protection and must never ship.
variants["v3-no-token-lua"] = current
  .replace("    redis.call('HSET', jobKey, 'reservationToken', ARGV[3])", "")
  .replace("if redis.call('HGET', KEYS[1], 'reservationToken') ~= ARGV[2] then return 0 end", "");
variants["v3-constant-token"] = current.replace("crypto.randomUUID()", "'00000000-0000-4000-8000-000000000000'");
variants["v3-no-spread"] = current.replace("return this.toJobRecord(id, { ...fields, reservationToken: token }, attempts);", "fields.reservationToken = token; return this.toJobRecord(id, fields, attempts);");
// Candidate: read only the queue name instead of fetching the payload again.
variants["v3-hget-queue"] = current.replace(
  'const fields = (await this.client.hgetall(this.jobKey(id))) as unknown as StoredJob | undefined;\n    return Number(await this.eval(',
  'const queue = await this.client.send("HGET", [this.jobKey(id), "queue"]);\n    return Number(await this.eval('
).replace('this.reservedKey(fields?.queue ?? "default")', 'this.reservedKey(queue ?? "default")');
// Candidate: retain the token check, resolve the queue and acknowledge in one Lua call.
variants["v3-atomic-complete"] = current.replace(
  "redis.call('ZREM', KEYS[2], ARGV[1])\nreturn redis.call('DEL', KEYS[1])",
  "local queue = redis.call('HGET', KEYS[1], 'queue') or 'default'\nredis.call('ZREM', ARGV[3] .. queue, ARGV[1])\nreturn redis.call('DEL', KEYS[1])"
).replace('    const fields = (await this.client.hgetall(this.jobKey(id))) as unknown as StoredJob | undefined;\n    return Number(await this.eval(\n      COMPLETE_LUA,\n      [this.jobKey(id), this.reservedKey(fields?.queue ?? "default")],\n      [id, token],',
'    return Number(await this.eval(\n      COMPLETE_LUA,\n      [this.jobKey(id)],\n      [id, token, this.key("reserved:")],');
// Candidate: same scripts and round trips, cached SHA with NOSCRIPT fallback.
const evalStart = current.indexOf("  private eval(");
const evalEnd = current.indexOf("  async dispatch(", evalStart);
assert(evalStart !== -1 && evalEnd > evalStart);
variants["v3-evalsha"] = 'import { createHash } from "node:crypto";\nconst scriptHashes = new Map<string, string>();\n' + current.slice(0, evalStart) + `  private eval(script: string, keys: string[], argv: (string | number)[]): Promise<any> {
    let hash = scriptHashes.get(script);
    if (!hash) { hash = createHash("sha1").update(script).digest("hex"); scriptHashes.set(script, hash); }
    const args = [String(keys.length), ...keys, ...argv.map(String)];
    return this.client.send("EVALSHA", [hash, ...args]).catch(error => {
      if (String(error).includes("NOSCRIPT")) return this.client.send("EVAL", [script, ...args]);
      throw error;
    });
  }

` + current.slice(evalEnd);
const selected = (process.env.REDIS_BENCH_VARIANTS ?? "v2,v3").split(",");
for (const variant of selected) {
  assert(variants[variant], `Unknown variant ${variant}`);
  await Bun.write(`${directory}/${variant}.ts`, variants[variant]!);
}
let server: ReturnType<typeof Bun.spawn> | undefined;
let client: RedisClient | undefined;
let url = process.env.REDIS_BENCH_URL;
try {
  if (!url) {
    const socket = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    const port = socket.port; await socket.stop(true);
    const binary = Bun.which("redis-server"); assert(binary, "redis-server required (or REDIS_BENCH_URL for a shared server)");
    server = Bun.spawn([binary, "--bind", "127.0.0.1", "--port", String(port), "--save", "", "--appendonly", "no", "--dir", directory, "--logfile", `${directory}/redis.log`], { stdout: "ignore", stderr: "pipe" });
    url = `redis://127.0.0.1:${port}`;
  }
  for (let attempt = 0; attempt < 40; attempt++) {
    client = new RedisClient(url!);
    try { await client.send("PING", []); break; } catch (error) {
      client.close(); client = undefined;
      if (attempt === 39) throw error;
      await Bun.sleep(25);
    }
  }
  assert(client);
  const info = parseInfo(String(await client.send("INFO", ["server", "persistence"])));
  const serverInfo = Object.fromEntries(["redis_version", "redis_mode", "os", "arch_bits", "hz", "configured_hz", "aof_enabled"].map(key => [key, info[key]]));
  const runs = [];
  for (let pair = 0; pair < repetitions; pair++) {
    const order = [...selected];
    // Reverse order each repetition to counter warming/drift.
    if (pair % 2) order.reverse();
    for (const variant of order) {
      const processResult: Bun.Subprocess<"ignore", "pipe", "pipe"> = Bun.spawn([process.execPath, import.meta.path, "--child", `${directory}/${variant}.ts`], { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { ...process.env, REDIS_BENCH_URL: url! } });
      const [out, err, code]: [string, string, number] = await Promise.all([new Response(processResult.stdout).text(), new Response(processResult.stderr).text(), processResult.exited]);
      assert.equal(code, 0, err);
      const result = JSON.parse(out);
      runs.push({ pair, variant, ...result });
      console.log(`${pair + 1}/${repetitions} ${variant}: ${Math.round(result.jobsPerSecond)} jobs/s, p99=${result.p99Ms.toFixed(3)} ms`);
    }
  }
  const recordedAt = new Date().toISOString();
  const record = { protocol: "redis-queue-investigation-v1", recordedAt, commit: Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim(), bun: { version: Bun.version, revision: Bun.revision }, machine: { cpu: cpus()[0]?.model, platform: platform(), release: release() }, dedicatedServer: !!server, server: serverInfo,
    config: await client.send("CONFIG", ["GET", "save", "appendonly", "appendfsync", "hash-max-listpack-entries", "hash-max-listpack-value"]), count, warmup, concurrency, repetitions, harnessSha256: sha(await Bun.file(import.meta.path).text()), variants: Object.fromEntries(selected.map(variant => [variant, { sha256: sha(variants[variant]!), source: variants[variant] }])), runs };
  await mkdir("benchmarks/redis", { recursive: true });
  const path = `benchmarks/redis/${recordedAt.replaceAll(":", "-")}.json`;
  await Bun.write(path, JSON.stringify(record, null, 2) + "\n"); console.log(`Saved: ${path}`);
} finally {
  client?.close();
  if (server) { server.kill("SIGTERM"); await server.exited; }
}
