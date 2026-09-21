// Mide los `any` de la frontera pública: recorre los .d.ts alcanzables desde
// los entrypoints de `exports` en package.json y cuenta en miembros públicos.
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(root + "package.json", "utf8"));
const entries = Object.values(pkg.exports as Record<string, { types: string }>)
  .map((e) => root + e.types.replace(/^\.\//, "").replace(/^src\//, "dist/src/").replace(/\.ts$/, ".d.ts"));

const seen = new Set<string>();
const queue = [...entries];
while (queue.length) {
  const file = queue.pop()!;
  if (seen.has(file) || !existsSync(file)) continue;
  seen.add(file);
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(/from ['"](\.[^'"]+)['"]/g)) {
    const base = resolve(dirname(file), m[1]!).replace(/\.js$/, "");
    for (const cand of [base + ".d.ts", base + "/index.d.ts"]) if (existsSync(cand)) queue.push(cand);
  }
}

let total = 0, rets = 0, params = 0;
const retHits: string[] = [], paramHits: string[] = [];
for (const file of [...seen].sort()) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (/^\s*(private|\/\/|\*|\/\*)/.test(line)) return;
    total += (line.match(/\bany\b/g) ?? []).length;
    const where = `${relative(root, file)}:${i + 1}`;
    if (/\):\s*any\b|\):\s*Promise<any>/.test(line)) { rets++; retHits.push(`${where}  ${line.trim()}`); }
    const p = (line.match(/[(,]\s*\.{0,3}[A-Za-z_$][\w$]*\??:\s*any\b/g) ?? []).length;
    if (p) { params += p; paramHits.push(`${where}  ${line.trim()}`); }
  });
}
console.log(`ficheros públicos: ${seen.size}\nretornos any: ${rets}\nparámetros any: ${params}\nany totales: ${total}`);
if (process.argv[2] === "--list") console.log("\n== retornos ==\n" + retHits.join("\n") + "\n\n== parámetros ==\n" + paramHits.join("\n"));
