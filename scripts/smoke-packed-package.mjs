import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const scratchRoot = join(root, "tmp_agents");
mkdirSync(scratchRoot, { recursive: true });
const scratch = mkdtempSync(join(scratchRoot, "pack-smoke-"));

function run(executable, args, cwd, expectedStderr) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, DATABASE_URL: "" },
  });
  if (result.error || result.status !== 0 || (expectedStderr !== undefined && result.stderr !== expectedStderr)) {
    throw new Error(`${executable} ${args.join(" ")} failed (${result.status}):\n${result.stderr}${result.stdout}`, { cause: result.error });
  }
  return result.stdout;
}

try {
  const packed = JSON.parse(run("npm", ["pack", "--json", "--pack-destination", scratch], root));
  const { filename } = Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
  const tarball = join(scratch, filename);
  if (!existsSync(tarball)) throw new Error(`npm pack did not create ${tarball}`);

  for (const runtime of [process.execPath, "bun"]) {
    const project = join(scratch, runtime === "bun" ? "bun-project" : "node-project");
    mkdirSync(project);
    writeFileSync(join(project, "package.json"), '{"private":true,"type":"module"}\n');
    run("npm", ["install", "--ignore-scripts", "--no-save", "--no-audit", "--no-fund", tarball], project);
    const installed = join(project, "node_modules", "@rekkr", "orm");
    if (!existsSync(join(installed, "dist", "src", "index.js"))) {
      throw new Error(`Packed JavaScript is missing from ${installed}`);
    }
    writeFileSync(join(project, "exports.mjs"), `
import { createRequire } from "node:module";
import { Connection } from "@rekkr/orm";
if (typeof Connection !== "function" || createRequire(import.meta.url)("@rekkr/orm").Connection !== Connection) {
  throw new Error("import and require did not load the same Connection");
}
`);
    run(runtime, ["exports.mjs"], project, "");

    const cli = join(project, "node_modules", ".bin", "orm");
    if (!existsSync(cli)) throw new Error(`npm did not install the orm command in ${project}`);
    run(runtime, [cli, "init"], project, "");
    run(runtime, [cli, "make:migration", "create_posts_table"], project, "");
    const migrations = readdirSync(join(project, "database", "migrations"));
    if (migrations.length !== 1 || !/^\d{14}_create_posts_table\.ts$/.test(migrations[0])) {
      throw new Error(`Unexpected migrations in ${project}: ${migrations.join(", ")}`);
    }
    if (!run(runtime, [cli, "migrate"], project, "").includes("Migrated:")) {
      throw new Error(`${runtime} did not report a completed migration`);
    }
    writeFileSync(join(project, "verify.mjs"), `
import { Connection } from "@rekkr/orm";
const connection = new Connection({ url: "sqlite://./database/app.db" });
try {
  const rows = await connection.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'posts'");
  if (JSON.stringify(rows) !== '[{"name":"posts"}]') throw new Error("posts table is missing");
} finally {
  await connection.close();
}
`);
    run(runtime, ["verify.mjs"], project, "");
  }
  console.log("Packed package works on Node.js and Bun.");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
