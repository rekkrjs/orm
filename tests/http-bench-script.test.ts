import { expect, test } from "bun:test";
import { SQL } from "bun";
import { createHash } from "node:crypto";
import { ConnectionManager } from "../src/index.js";
import { startHttpBenchmark, workloads, modes, endpoint, expectedBody } from "../benchmarks/http/server.js";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

test("HTTP benchmark has deterministic routes and cleans only its own tables", async () => {
  const url = process.env.MYSQL_TEST_URL;
  if (!url) throw new Error("MYSQL_TEST_URL is required");
  const sql = new SQL({ url, max: 1 });
  const sentinel = `bench_http_neighbor_${crypto.randomUUID().replaceAll("-", "")}`;
  const previousDefault = ConnectionManager.getDefault();
  const prototype = Object.getOwnPropertyDescriptors(Object.prototype);
  const apps: Awaited<ReturnType<typeof startHttpBenchmark>>[] = [];
  await sql.unsafe(`CREATE TABLE \`${sentinel}\` (id INT PRIMARY KEY, value VARCHAR(32))`);
  try {
    await sql.unsafe(`INSERT INTO \`${sentinel}\` VALUES (1, 'untouched')`);
    // Two overlapping servers: closing the first must not affect the second.
    apps.push(await startHttpBenchmark({ url }));
    apps.push(await startHttpBenchmark({ url }));
    for (const app of apps) {
      for (const workload of workloads) for (const mode of modes) {
        const response = await fetch(new URL(endpoint(workload, mode), app.server.url));
        expect(response.status).toBe(200);
        expect(hash(await response.text())).toBe(hash(expectedBody(workload)));
      }
      expect((await fetch(new URL("/missing", app.server.url))).status).toBe(404);
    }
    const tableNames = async () => (await sql.unsafe("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND LEFT(table_name, 11) = 'bench_http_'"))
      .map((row: { name: string }) => row.name).sort();
    const beforeFailedStart = await tableNames();
    await expect(startHttpBenchmark({ url, port: apps[1]!.server.port })).rejects.toThrow();
    expect(await tableNames()).toEqual(beforeFailedStart);
    await apps[0]!.close();
    for (const table of Object.values(apps[0]!.tables)) expect(await tableNames()).not.toContain(table);
    for (const workload of workloads) for (const mode of modes) {
      expect(hash(await (await fetch(new URL(endpoint(workload, mode), apps[1]!.server.url))).text())).toBe(hash(expectedBody(workload)));
    }
    await apps[1]!.close();
    expect(await sql.unsafe<{ value: string }[]>(`SELECT value FROM \`${sentinel}\``)).toEqual([{ value: "untouched" }]);
    expect(ConnectionManager.getDefault()).toBe(previousDefault);
    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(prototype);
  } finally {
    for (const app of apps) await app.close();
    await sql.unsafe(`DROP TABLE \`${sentinel}\``); await sql.close();
  }
}, 30_000);
