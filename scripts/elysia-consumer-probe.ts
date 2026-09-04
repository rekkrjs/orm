// Revalidate the actual consumer and the Collection workaround.
// See .tmp_hacks/elysia-1.4-collection-constructor-name.md.
// Usage: bun scripts/elysia-consumer-probe.ts /path/to/orm_bench_elysia
import assert from "node:assert/strict";
import { mkdir, mkdtemp, cp, symlink } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { Collection, DB, ConnectionManager, reconfigureOrm } from "../src/index.js";
const consumer = resolve(process.argv[2] ?? "../benchmarks/orm_bench_elysia");
await mkdir("tmp", { recursive: true });
const fixture = await mkdtemp(resolve("tmp/elysia-consumer-"));
await mkdir(`${fixture}/src`);
await cp(`${consumer}/src/index.ts`, `${fixture}/src/index.ts`);
// This consumer predates v2: migrate its removed v0.8 getArray alias in the copy.
const entry = `${fixture}/src/index.ts`;
await Bun.write(entry, (await Bun.file(entry).text()).replaceAll(".getArray()", ".get()"));
await mkdir(`${fixture}/node_modules/@bunnykit`, { recursive: true });
await symlink(resolve("."), `${fixture}/node_modules/@bunnykit/orm`);
await symlink(`${consumer}/node_modules/elysia`, `${fixture}/node_modules/elysia`);
process.env.MYSQL_TEST_URL = "sqlite://:memory:"; // This child only; synthetic data.
const { app } = await import(`${fixture}/src/index.ts`);
const { Elysia } = await import(`${fixture}/node_modules/elysia/dist/index.mjs`);
const borrowed = ConnectionManager.getDefault()!;
try {
  await DB.raw("CREATE TABLE users (id integer, name text, email text, email_verified_at text, active integer, created_at text, updated_at text)");
  await DB.table("users").insert({ id: 1, name: "Ada", email: "ada@example.test", active: 1 });
  const response = await app.handle(new Request("http://localhost/elysia"));
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), [{ id: 1, name: "Ada", email: "ada@example.test", emailVerifiedAt: null, active: true, createdAt: null, updatedAt: null }]);
  const controller = new Elysia().get("/collection", ({ set, cookie }: any) => {
    set.status = 207; set.headers["x-request-id"] = "probe"; set.headers["x-content-type-options"] = "nosniff";
    cookie.probe.set({ value: "present", httpOnly: true });
    return new Collection([{ id: 1 }]);
  });
  const request = () => controller.handle(new Request("http://localhost/collection"));
  const patched = await request();
  assert.equal(patched.status, 207);
  assert.equal(patched.headers.get("x-request-id"), "probe");
  assert.equal(patched.headers.get("x-content-type-options"), "nosniff");
  assert.match(patched.headers.get("set-cookie") ?? "", /probe=present/);
  assert.deepEqual(await patched.json(), [{ id: 1 }]);
  const descriptor = Object.getOwnPropertyDescriptor(Collection, "name")!;
  let unpatched;
  try {
    Object.defineProperty(Collection, "name", { value: "Collection" });
    const response = await request();
    unpatched = { status: response.status, requestId: response.headers.get("x-request-id"), cookie: response.headers.get("set-cookie") };
  } finally { Object.defineProperty(Collection, "name", descriptor); }
  const next = await reconfigureOrm({ connection: { url: "sqlite://:memory:" } });
  assert.equal((await next.connection.query("SELECT 1 AS value"))[0].value, 1);
  const pkg = await Bun.file(`${consumer}/node_modules/elysia/package.json`).json();
  console.log(JSON.stringify({ bun: Bun.version, elysia: pkg.version, consumer: "orm_bench_elysia", sourceSha256: createHash("sha256").update(await Bun.file(`${consumer}/src/index.ts`).text()).digest("hex"), migration: "v0.8 getArray() -> get(); local package alias", actualRoute: "passed", reconfigure: "passed", patched: { status: patched.status, headers: "preserved", cookie: "preserved" }, unpatched }, null, 2));
} finally { await ConnectionManager.closeAll(); await borrowed.close(); }
