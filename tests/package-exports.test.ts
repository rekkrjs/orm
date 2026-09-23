import { afterAll, beforeAll, expect, test, evalCommand, runProcess } from "./harness.js";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * What an installed package resolves to at runtime, from a project outside the
 * repo: inside it, the package name would resolve to the repo itself. Every
 * subpath must load through require() as well as import — a CommonJS project,
 * Jest or a CJS config file reaches the package through require() — and both
 * must hand back one module, since two copies would each keep their own
 * configureOrm() state.
 */
const root = join(import.meta.dirname, "..");
const subpaths = Object.keys(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).exports);
let project: string;

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), "orm-exports-"));
  const packageDir = join(project, "node_modules", "@rekkr", "orm");
  mkdirSync(packageDir, { recursive: true });
  copyFileSync(join(root, "package.json"), join(packageDir, "package.json"));
  for (const dir of ["src", "dist"]) symlinkSync(join(root, dir), join(packageDir, dir));
});

afterAll(() => {
  rmSync(project, { recursive: true, force: true });
});

test("every export loads through require() and import as one module", async () => {
  const script = `
    const { createRequire } = await import("node:module");
    const require = createRequire(${JSON.stringify(join(project, "index.js"))});
    const loaded = {};
    for (const subpath of ${JSON.stringify(subpaths)}) {
      const specifier = "@rekkr/orm" + subpath.slice(1);
      try {
        loaded[subpath] = require(specifier) === await import(specifier) ? "one module" : "two copies";
      } catch (error) {
        loaded[subpath] = error.code ?? error.message;
      }
    }
    console.log(JSON.stringify(loaded));
  `;
  const result = await runProcess(evalCommand(script), { cwd: project, timeoutMs: 20_000 });
  expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  expect(JSON.parse(result.stdout)).toEqual(Object.fromEntries(subpaths.map((subpath) => [subpath, "one module"])));
}, 30_000);
