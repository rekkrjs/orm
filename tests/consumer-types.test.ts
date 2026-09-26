import { afterAll, beforeAll, describe, expect, ormCli, runProcess, test } from "./harness.js";
import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
import { Connection, Schema, TypeGenerator } from "../src/index.js";

/**
 * What an installer's `tsc` sees. The package is copied — not linked — into a
 * project outside the repo: from inside it, `import "bun"` would resolve
 * against our own node_modules and hide exactly the errors this is here for.
 * The consumer's own flags must never reach our implementation, and a Node.js
 * project without @types/bun must typecheck.
 */
const root = join(import.meta.dirname, "..");
const tsc = join(root, "node_modules", ".bin", "tsc");

const app = `
import { Connection, DB, Model, configureOrm, type OrmConfig } from "@rekkr/orm";
import { Cache } from "@rekkr/orm/cache";
import { Command } from "@rekkr/orm/commands";
import { Events } from "@rekkr/orm/events";
import { registerPolicy } from "@rekkr/orm/policies";
import { Queue } from "@rekkr/orm/queue";
import { Search } from "@rekkr/orm/search";
import { rule } from "@rekkr/orm/validation";

const config: OrmConfig = { connection: { url: "sqlite://app.db" } };

class User extends Model {
  static override table = "users";
}

export async function main(): Promise<number> {
  configureOrm(config);
  const user = await User.where("email", "alice@example.com").first();
  const rows = await DB.table("audit_logs").where("event", "login").limit(10).get();
  const connection = new Connection({ url: "sqlite://:memory:" });
  await connection.close();
  return rows.length + (user ? 1 : 0);
}

export { Cache, Command, Events, Queue, Search, registerPolicy, rule };
`;

const strictFlags = {
  exactOptionalPropertyTypes: true,
  noUncheckedIndexedAccess: true,
  noImplicitOverride: true,
  noPropertyAccessFromIndexSignature: true,
};

const columns: Record<string, Record<string, unknown>> = {
  strict: {},
  "strict + common strictness flags": strictFlags,
  "skipLibCheck: false": { skipLibCheck: false },
};

const projects = new Map<string, string>();

/**
 * Code the ORM writes into an application, by path: every scaffold, as the CLI
 * writes it, and the types `types:generate` emits both as declarations merged
 * into models and as stub classes. It is compiled with the consumer's flags,
 * `noImplicitOverride` included.
 */
const generated = new Map<string, string>();

// Column names that are valid SQL but not TypeScript identifiers, or that
// collide with members every model inherits from `Model`.
const awkwardColumns = ["first-name", "2fa", "save", "delete", "constructor", "toJSON"];

async function generateSources(): Promise<void> {
  const scaffold = mkdtempSync(join(tmpdir(), "orm-consumer-scaffolds-"));
  const cli = async (...args: string[]) => {
    const result = await runProcess([...ormCli, ...args], { cwd: scaffold, timeoutMs: 30_000 });
    if (result.exitCode !== 0 || result.stderr !== "") {
      throw new Error(`orm ${args.join(" ")} failed (${result.exitCode}):\n${result.stderr}${result.stdout}`);
    }
  };
  // The CLI imports the files it scaffolded (commands, models), which import the package.
  mkdirSync(join(scaffold, "node_modules", "@rekkr"), { recursive: true });
  symlinkSync(root, join(scaffold, "node_modules", "@rekkr", "orm"));
  try {
    // Non-interactive `orm init` takes every default, search and queue included.
    await cli("init");
    mkdirSync(join(scaffold, "database"));
    const connection = new Connection({ url: `sqlite://${join(scaffold, "database", "app.db")}` });
    try {
      await Schema.create("accounts", (table) => {
        table.increments("id");
        table.string("name");
        table.string("email").nullable();
        table.timestamps();
      }, connection);
      await connection.run(`CREATE TABLE "awkward_rows" ("id" INTEGER PRIMARY KEY, "title" TEXT NOT NULL, ${awkwardColumns.map((c) => `"${c}" TEXT`).join(", ")})`);

      await cli("make:model", "Account");
      await cli("make:model", "AwkwardRow");
      await cli("make:model", "Category");
      await cli("make:migration", "create_posts_table", "--model");
      await cli("make:migration", "add_status_to_posts_table");
      await cli("make:migration", "backfill_slugs");
      await cli("make:command", "SendReport");
      await cli("make:job", "ProcessPodcast");
      await cli("make:policy", "Post", "--model=Post");
      await cli("make:policy", "Comment");
      await cli("make:searchable", "Article");
      await cli("queue:install", "--models=app/models/queue");
      await cli("types:generate");
      await new TypeGenerator(connection, { outDir: join(scaffold, "stubs"), stubs: true }).generate();
    } finally {
      await connection.close();
    }
    for (const file of readdirSync(scaffold, { recursive: true, encoding: "utf8" })) {
      if (file.endsWith(".ts") && !file.startsWith("node_modules")) generated.set(file, await readFile(join(scaffold, file), "utf-8"));
    }
  } finally {
    rmSync(scaffold, { recursive: true, force: true });
  }
  generated.set("use.ts", [
    `import { AccountsBase, AwkwardRowsBase } from "./stubs";`,
    `import { Account } from "./app/models/Account";`,
    `import { AwkwardRow } from "./app/models/AwkwardRow";`,
    `import { Article } from "./app/models/Article";`,
    `export class StubAccount extends AccountsBase {}`,
    `export const hits = Article.search("rust").get();`,
    `export const email: string | null | undefined = new Account().email;`,
    `export const title: string = new AwkwardRow().title;`,
    `export const firstName = new AwkwardRow().getAttribute("first-name");`,
    `export const stubTitle: string = new AwkwardRowsBase().title;`,
    `export const saved: Promise<unknown> = new AwkwardRow().save();`,
    `export const filled: Account = new Account().fill({ name: "Ana", email: null });`,
    ``,
  ].join("\n"));
}

/**
 * A project that installed the package plus one runtime's types. As published
 * it carries src, bin and the emitted dist; installed from git it has no dist,
 * and its types fall back to the TypeScript source.
 */
function createProject(types: "node" | "bun", fromGit = false): string {
  const project = mkdtempSync(join(tmpdir(), `orm-consumer-${types}-`));
  const packageDir = join(project, "node_modules", "@rekkr", "orm");
  mkdirSync(packageDir, { recursive: true });
  copyFileSync(join(root, "package.json"), join(packageDir, "package.json"));
  for (const dir of ["src", "bin"]) cpSync(join(root, dir), join(packageDir, dir), { recursive: true });
  if (!fromGit) execFileSync(tsc, ["-p", join(root, "tsconfig.json"), "--emitDeclarationOnly", "--declarationMap", "false", "--outDir", join(packageDir, "dist")]);
  // Only the runtime's own type packages: a Node.js project has no @types/bun to lean on.
  for (const name of types === "node" ? ["@types/node", "undici-types"] : ["@types/node", "undici-types", "@types/bun", "bun-types"]) {
    mkdirSync(join(project, "node_modules", name, ".."), { recursive: true });
    symlinkSync(join(root, "node_modules", name), join(project, "node_modules", name));
  }
  writeFileSync(join(project, "app.ts"), app);
  for (const [file, source] of generated) {
    mkdirSync(dirname(join(project, "generated", file)), { recursive: true });
    writeFileSync(join(project, "generated", file), source);
  }
  return project;
}

beforeAll(async () => {
  await generateSources();
  for (const types of ["node", "bun"] as const) projects.set(types, createProject(types));
  projects.set("bun-git", createProject("bun", true));
}, 120_000);

afterAll(() => {
  for (const project of projects.values()) rmSync(project, { recursive: true, force: true });
});

function typecheck(types: string, extra: Record<string, unknown>, project = projects.get(types)!): string {
  const config = join(project, `tsconfig.${Object.keys(extra).length}.json`);
  writeFileSync(config, JSON.stringify({
    compilerOptions: {
      target: "ESNext", module: "ESNext", moduleResolution: "bundler", strict: true,
      skipLibCheck: true, noEmit: true, types: [types], ...extra,
    },
    include: ["app.ts", "generated/**/*.ts"],
  }));
  try {
    execFileSync(tsc, ["-p", config], { cwd: project, encoding: "utf8" });
    return "";
  } catch (error: any) {
    return String(error.stdout || error.message);
  }
}

describe("consumer typecheck of a git install", () => {
  // No dist: the types fall back to the source, which must not need the
  // optional peers (pg, mysql2, ioredis) a Bun project never installs.
  test("Bun with @types/bun: strict", () => {
    expect(typecheck("bun", {}, projects.get("bun-git"))).toBe("");
  }, 60_000);
});

describe("consumer typecheck of the published declarations", () => {
  for (const types of ["node", "bun"]) {
    for (const [column, flags] of Object.entries(columns)) {
      test(`${types === "node" ? "Node.js without @types/bun" : "Bun with @types/bun"}: ${column}`, () => {
        expect(typecheck(types, flags)).toBe("");
      }, 60_000);
    }
  }
});

describe("the suite's own type tests against the emitted declarations", () => {
  // Consumers see the ORM through its .d.ts, and emitting declarations can
  // rewrite what the source infers. Here src/ holds nothing but those .d.ts,
  // so every test that imports ../src typechecks against what ships.
  test("typecheck with every source module replaced by its declaration", () => {
    const tree = mkdtempSync(join(tmpdir(), "orm-dts-tests-"));
    try {
      execFileSync(tsc, ["-p", join(root, "tsconfig.json"), "--emitDeclarationOnly", "--declarationMap", "false", "--outDir", tree]);
      mkdirSync(join(tree, "tests"));
      // Top-level files only: other tests write scratch projects under tests/ while this runs.
      for (const file of readdirSync(join(root, "tests")).filter((name) => name.endsWith(".ts"))) {
        copyFileSync(join(root, "tests", file), join(tree, "tests", file));
      }
      for (const dir of ["benchmarks", "scripts"]) cpSync(join(root, dir), join(tree, dir), { recursive: true });
      symlinkSync(join(root, "node_modules"), join(tree, "node_modules"));
      writeFileSync(join(tree, "tsconfig.json"), JSON.stringify({
        compilerOptions: {
          target: "ESNext", module: "ESNext", moduleResolution: "bundler", strict: true, skipLibCheck: true,
          noEmit: true, esModuleInterop: true, allowSyntheticDefaultImports: true, resolveJsonModule: true,
          lib: ["ESNext"], types: ["bun"],
        },
        include: ["tests/**/*"],
      }));
      let output = "";
      try {
        execFileSync(tsc, ["-p", join(tree, "tsconfig.json")], { cwd: tree, encoding: "utf8" });
      } catch (error: any) {
        output = String(error.stdout || error.message);
      }
      expect(output).toBe("");
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  }, 120_000);
});
