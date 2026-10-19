// THE ENGINE DRAWS ONLY FROM ITS OWN STREAMS.
//   node test/rng-discipline.mjs
//
// A run is its seed: the same seed and the same moves give the same town,
// which is what makes a save rebuild exactly and a bug reproducible. One
// `Math.random()` or wall-clock read in src/engine breaks that silently — the
// game still plays, it just never plays the same way twice. Every draw goes
// through `rng(s, stream)`; the clock is read only to stamp a save.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const ENGINE = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "engine");
const BANNED = /\bMath\.random\s*\(|\bDate\.now\s*\(|\bperformance\.now\s*\(|\bnew Date\s*\(/;
// save.ts stamps when a slot was written; it never feeds the simulation.
const ALLOWED = new Set(["save.ts:Date.now"]);
let bad = 0;
for (const f of readdirSync(ENGINE).filter((x) => x.endsWith(".ts"))) {
  readFileSync(join(ENGINE, f), "utf8").split("\n").forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "");
    const m = code.match(BANNED);
    if (!m) return;
    if (ALLOWED.has(`${f}:${m[0].replace(/\s*\($/, "").replace(/^new /, "new ")}`)) return;
    console.log(`  FAIL  src/engine/${f}:${i + 1}  ${line.trim()}`);
    bad++;
  });
}
console.log(bad ? `\nFAIL — ${bad} non-deterministic call${bad === 1 ? "" : "s"} in the engine` : "PASS — no Math.random or clock reads in the engine");
process.exit(bad ? 1 : 0);
