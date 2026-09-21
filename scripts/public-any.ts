/**
 * Mide los `any` de la frontera pública: emite las declaraciones, recorre los
 * `.d.ts` alcanzables desde los entrypoints de `exports` en package.json y
 * cuenta los `any` que ve quien consume el paquete.
 *
 *   bun run scripts/public-any.ts            cifras
 *   bun run scripts/public-any.ts --list     además, cada firma culpable
 *   bun run scripts/public-any.ts --check    trinquete: falla si alguna sube
 *
 * El trinquete corre dentro de `bun run test`. Si baja, baja el tope: el
 * criterio es que estos números sólo se mueven hacia abajo. Subirlos pide una
 * razón escrita, no un ajuste silencioso.
 */
import { readFileSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import { dirname, resolve, relative, join } from "node:path";
import { tmpdir } from "node:os";

// 2026-09-21: 259→265 y 864→872 al dar rama propia a `hasManyThrough` y
// `hasOneThrough` en los tres mapeos de relaciones. Son seis ramas de tipo
// condicional con la misma forma que las siete que ya había
// (`F extends (...args: any[]) => Rel<any>`): fontanería interna que no
// ensancha nada de lo que el usuario pasa. De hecho estrecha: antes esas dos
// relaciones caían en el `Relation<infer R>` genérico.
const TOPE = { retornos: 20, parametros: 265, total: 872 };

const root = new URL("..", import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const out = mkdtempSync(join(tmpdir(), "public-any-"));
try {
  const tsc = Bun.spawnSync(["bunx", "tsc", "--emitDeclarationOnly", "--declaration", "--outDir", out], { cwd: root });
  if (tsc.exitCode !== 0) {
    console.error(tsc.stdout.toString() + tsc.stderr.toString());
    process.exit(1);
  }

  const entries = Object.values(pkg.exports as Record<string, { types: string }>)
    .map((e) => join(out, e.types.replace(/^\.\//, "").replace(/\.ts$/, ".d.ts")));

  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const m of readFileSync(file, "utf8").matchAll(/from ['"](\.[^'"]+)['"]/g)) {
      const base = resolve(dirname(file), m[1]!).replace(/\.js$/, "");
      for (const cand of [base + ".d.ts", base + "/index.d.ts"]) if (existsSync(cand)) queue.push(cand);
    }
  }

  let total = 0, retornos = 0, parametros = 0;
  const retHits: string[] = [], paramHits: string[] = [];
  for (const file of [...seen].sort()) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (/^\s*(private|\/\/|\*|\/\*)/.test(line)) return;
      total += (line.match(/\bany\b/g) ?? []).length;
      const donde = `${relative(out, file)}:${i + 1}`;
      if (/\):\s*any\b|\):\s*Promise<any>/.test(line)) { retornos++; retHits.push(`${donde}  ${line.trim()}`); }
      const p = (line.match(/[(,]\s*\.{0,3}[A-Za-z_$][\w$]*\??:\s*any\b/g) ?? []).length;
      if (p) { parametros += p; paramHits.push(`${donde}  ${line.trim()}`); }
    });
  }

  const medido = { retornos, parametros, total };
  console.log(`ficheros públicos: ${seen.size}`);
  for (const k of ["retornos", "parametros", "total"] as const) {
    console.log(`${k}: ${medido[k]}${medido[k] === TOPE[k] ? "" : ` (tope ${TOPE[k]})`}`);
  }
  if (process.argv.includes("--list")) {
    console.log("\n== retornos ==\n" + retHits.join("\n") + "\n\n== parámetros ==\n" + paramHits.join("\n"));
  }

  if (process.argv.includes("--check")) {
    const subidas = (["retornos", "parametros", "total"] as const).filter((k) => medido[k] > TOPE[k]);
    if (subidas.length) {
      console.error(
        `\n✗ La frontera pública ha ganado \`any\`: ${subidas.map((k) => `${k} ${TOPE[k]} → ${medido[k]}`).join(", ")}.\n` +
        `  Mira cuál con \`bun run scripts/public-any.ts --list\`. Si es deliberado, sube TOPE con una nota.`
      );
      process.exit(1);
    }
    const bajadas = (["retornos", "parametros", "total"] as const).filter((k) => medido[k] < TOPE[k]);
    if (bajadas.length) {
      console.error(
        `\n✗ La frontera pública ha mejorado y el tope se ha quedado viejo: ` +
        `${bajadas.map((k) => `${k} ${TOPE[k]} → ${medido[k]}`).join(", ")}.\n` +
        `  Baja TOPE en scripts/public-any.ts para que el trinquete no ceda lo ganado.`
      );
      process.exit(1);
    }
    console.log("\n✓ Frontera pública sin `any` nuevos.");
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
