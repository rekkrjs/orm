// Public HTTP workload. Historical Hono measurements use a different protocol.
import assert from "node:assert/strict";
import { resolve } from "node:path";

export const workloads = ["users", "records"] as const;
export const modes = ["rekkr", "rekkr-rawJson", "rekkr-json"] as const;
export const endpoint = (workload: string, mode: string) => `${workload === "records" ? "/benchmark-records" : ""}/${mode}`;
const date = (day: number) => `2024-01-${String(day % 28 + 1).padStart(2, "0")} 12:34:56.000`;
const iso = (value: string | null) => value === null ? null : value.replace(" ", "T") + "Z";
export const users = Array.from({ length: 500 }, (_, i) => ({
  id: i + 1, name: `User ${i + 1}`, email: `user${i + 1}@example.com`,
  email_verified_at: i % 4 ? date(i) : null, active: i % 2,
  created_at: date(i), updated_at: date(i + 1),
}));
export const records = Array.from({ length: 1_000 }, (_, i) => ({
  id: i + 1, name: `Record ${i + 1}`, status: ["draft", "published", "archived"][i % 3]!,
  description: `Deterministic benchmark record ${i + 1}. ` + "Payload text. ".repeat(8),
  score: i % 101, amount: `${i % 1000}.${String(i % 100).padStart(2, "0")}`, active: i % 2,
  // Length-ordered keys also match MySQL's binary JSON key order.
  metadata: JSON.stringify({ tags: ["benchmark", `group-${i % 10}`], index: i, enabled: i % 2 === 1 }),
  created_at: date(i), updated_at: date(i + 1),
}));
export const expectedBody = (workload: string) => JSON.stringify(workload === "users"
  ? users.map(row => ({ id: row.id, name: row.name, email: row.email,
    emailVerifiedAt: iso(row.email_verified_at), active: Boolean(row.active),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) }))
  : records.map(row => ({ ...row, active: Boolean(row.active), metadata: JSON.parse(row.metadata),
    created_at: iso(row.created_at), updated_at: iso(row.updated_at) })));

export async function startHttpBenchmark(options: { url: string; source?: string; port?: number }) {
  const source = resolve(options.source ?? "src");
  // Absolute import prevents the package self-reference from loading the worktree
  // when a tagged snapshot was requested.
  const { Connection, Model, Builder } = await import(`${source}/index.ts`) as typeof import("../../src/index.js");
  const db = new Connection({ url: options.url, max: 10 });
  assert.equal(db.getDriverName(), "mysql", "HTTP benchmark requires MySQL/MariaDB");
  const prefix = `bench_http_${crypto.randomUUID().replaceAll("-", "")}`;
  const tables = { users: `${prefix}_users`, records: `${prefix}_records` };
  const created: string[] = [];
  let server: ReturnType<typeof Bun.serve> | undefined;
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    await server?.stop(true);
    try { for (const table of created) await db.run(`DROP TABLE \`${table}\``); }
    finally { await db.close(); }
  })();
  async function seed(table: string, definition: string, rows: Record<string, unknown>[]) {
    await db.run(`CREATE TABLE \`${table}\` (${definition})`);
    created.push(table); // Only a successful CREATE grants cleanup ownership.
    const columns = Object.keys(rows[0]!);
    for (let offset = 0; offset < rows.length; offset += 100) {
      const batch = rows.slice(offset, offset + 100);
      await db.run(`INSERT INTO \`${table}\` (${columns.map(key => `\`${key}\``).join(",")}) VALUES ${batch.map(() => `(${columns.map(() => "?").join(",")})`).join(",")}`,
        batch.flatMap(row => columns.map(key => row[key])));
    }
  }
  try {
    const version = (await db.query("SELECT VERSION() AS version"))[0].version;
    await seed(tables.users, "id BIGINT UNSIGNED PRIMARY KEY, name VARCHAR(150), email VARCHAR(255), email_verified_at DATETIME(3), active BOOLEAN, created_at DATETIME(3), updated_at DATETIME(3)", users);
    await seed(tables.records, "id BIGINT UNSIGNED PRIMARY KEY, name VARCHAR(255), status ENUM('draft','published','archived'), description TEXT, score INT, amount DECIMAL(10,2), active BOOLEAN, metadata JSON, created_at DATETIME(3), updated_at DATETIME(3)", records);
    class User extends Model { static connection = db; static table = tables.users; static casts = { active: "boolean" }; }
    class Record extends Model {
      static table = tables.records;
      static connection = db;
      static casts = { id: "number", score: "number", amount: "decimal:2", active: "boolean", metadata: "json" };
    }
    const handlers = new Map<string, () => Promise<Response>>();
    for (const workload of workloads) {
      const model = workload === "users" ? User : Record;
      const columns = workload === "users"
        ? ["id", "name", "email", "email_verified_at as emailVerifiedAt", "active", "created_at as createdAt", "updated_at as updatedAt"]
        : Object.keys(records[0]!);
      for (const mode of modes) handlers.set(endpoint(workload, mode), async () => {
        let rows;
        if (mode === "rekkr") {
          rows = (await new Builder(db, tables[workload]).select(...columns).orderBy("id").get()).toArray();
          for (const row of rows) {
            row.active = Boolean(row.active);
            if (workload === "records") {
              row.id = Number(row.id); row.score = Number(row.score); row.amount = Number(row.amount).toFixed(2);
              if (typeof row.metadata === "string") row.metadata = JSON.parse(row.metadata);
            }
          }
        } else {
          const query = model.select(...columns).orderBy("id");
          rows = mode === "rekkr-json" ? await query.json() : await query.rawJson();
        }
        // Explicit stringify keeps the final serialization in the measured path.
        return new Response(JSON.stringify(rows), { headers: { "content-type": "application/json; charset=UTF-8" } });
      });
    }
    server = Bun.serve({ hostname: "127.0.0.1", port: options.port ?? 0,
      fetch(request) {
        const handler = handlers.get(new URL(request.url).pathname);
        return request.method === "GET" && handler ? handler() : new Response("Not found", { status: 404 });
      },
    });
    return { server, close, tables, source, databaseVersion: version };
  } catch (error) { await close(); throw error; }
}

if (import.meta.main) {
  assert(process.env.BENCH_HTTP_URL, "Set BENCH_HTTP_URL to a MySQL/MariaDB database URL");
  const app = await startHttpBenchmark({ url: process.env.BENCH_HTTP_URL, source: process.env.BENCH_ORM_SOURCE,
    port: Number(process.env.BENCH_HTTP_PORT ?? 3000) });
  const shutdown = async () => { await app.close(); process.exit(0); };
  process.on("SIGTERM", shutdown); process.on("SIGINT", shutdown);
  console.log(JSON.stringify({ ready: true, url: app.server.url.href, source: app.source, databaseVersion: app.databaseVersion, tables: app.tables }));
}
