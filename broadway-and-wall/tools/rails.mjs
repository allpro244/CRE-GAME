// WHICH CLAMPS ARE HOLDING THE MODEL UP.
//
//   node tools/rails.mjs                 3 towns x 50 years
//   N=6 HZ=720 node tools/rails.mjs      more of both
//   BIND=0.02 node tools/rails.mjs       a stricter definition of load-bearing
//
// CLAUDE.md names this fault and nothing in the repo tested for it:
//
//   "A rail that hides a fault. A clamp that stops a number going somewhere
//    absurd is fine as a guard and is a bug when it is load-bearing. If a
//    variable rests against its rail in normal play, the rail is holding up
//    the model."
//
// There are 118 clamp() call sites across the engine. Some are guards that have
// never fired in fifty years and some ARE the model, and from reading the code
// there is no way to tell which — both look like `clamp(x, a, b)`. The only
// difference is measurable: does the variable sit on the bound during ordinary
// play.
//
// It is worth the tool because the one time this was checked by hand it found
// something. `clamp(momentum * 2.4, -0.28, 0.45)` in the starts quota bound in
// 11.3% of months, which meant that in one month in nine the rent a developer
// underwrote was not the elasticity the coefficient advertised — it was
// whichever bound the market was leaning on. Three other clamps measured beside
// it bound 0.0-0.4% of the time. Reading them, all four looked identical.
//
// HOW IT WORKS. The engine is copied to a scratch tree and every `clamp(`
// callsite is rewritten to `__rail(id, ` — a recorder that counts how often the
// value it is handed lands on either bound, then returns exactly what clamp
// would have returned. So the instrumented engine computes the same numbers as
// the real one; the only difference is that it keeps a tally. Then it plays the
// same fixed towns with no player in them and prints the tally.
//
// WHAT IT DOES NOT SEE. Hand-written `Math.max(a, Math.min(b, x))` that never
// went through the helper, and the per-module variants named clampA / clampL /
// clampN / clamp01. Those are listed at the end as UNINSTRUMENTED so the
// coverage of this tool is visible rather than assumed — a tool that silently
// skips half its subject is the same fault it is looking for.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");
const WORK = join(APP, ".audit-rails");

const N = Number(process.env.N ?? 3);
const HZ = Number(process.env.HZ ?? 600);
const BIND = Number(process.env.BIND ?? 0.01);

// ------------------------------------------------------------- instrument

rmSync(WORK, { recursive: true, force: true });
mkdirSync(join(WORK, "test"), { recursive: true });
cpSync(join(APP, "src"), join(WORK, "src"), { recursive: true });
cpSync(join(APP, "test", "city.mjs"), join(WORK, "test", "city.mjs"));
cpSync(join(APP, "test", ".entry.ts"), join(WORK, "test", ".entry.ts"));

const sites = [];
const IDENT = /[A-Za-z0-9_$.]/;

for (const f of readdirSync(join(APP, "src", "engine")).filter((x) => x.endsWith(".ts"))) {
  const rel = join("src", "engine", f);
  const src = readFileSync(join(WORK, rel), "utf8");
  const lines = src.split("\n");
  let out = "", i = 0, hits = 0;
  while (i < src.length) {
    const at = src.indexOf("clamp(", i);
    if (at < 0) { out += src.slice(i); break; }
    const prev = at > 0 ? src[at - 1] : "";
    // Only the bare helper: not clampA/clampL/clampN/clamp01, not a property
    // access, and not the definition line itself.
    const isCall = !IDENT.test(prev);
    const line = src.slice(0, at).split("\n").length;
    const isDef = /^\s*(export\s+)?(const clamp\s*=|function clamp\s*\()/.test(lines[line - 1] ?? "");
    if (!isCall || isDef) { out += src.slice(i, at + 6); i = at + 6; continue; }
    const id = sites.length;
    sites.push({ file: f, line, text: (lines[line - 1] ?? "").trim() });
    out += src.slice(i, at) + `__rail(${id}, `;
    i = at + 6;
    hits++;
  }
  if (hits) {
    writeFileSync(join(WORK, rel), `import { __rail } from "./__rails";\n` + out);
  }
}

// A CLAMP BINDS WHEN IT CHANGES THE ANSWER, NOT WHEN THE ANSWER EQUALS A BOUND.
//
// The first version of this counted `v <= a` and duly reported its loudest
// finding: `clamp(e.wageDebt, 0, 0.25)` at 100.0% of the floor. Investigated,
// `wageDebt` is IDENTICALLY zero — the nominal-wage-rigidity mechanism only
// accrues when nominal wage growth would be negative, and in a world with 2%
// expected inflation and positive productivity that essentially never happens,
// which is correct: aggregate nominal wages did not fall in the US even in
// 2009. Nothing was being held back by anything. The variable simply equals its
// own floor, and `<=` cannot tell that apart from a value being pressed against
// a rail by opposing force.
//
// That is the difference between a guard and the model, and getting it wrong
// meant the tool's top row was an artefact of one character. Strict now: a bind
// is counted only when the clamp actually moved the value.
// SECOND PASS (2026-10-13): HAND-WRITTEN CAPS. `Math.min(0.04, jobVac)` held a
// town's labour shortage at 4-9% for decades and this tool could not see it,
// because it was never a clamp(). Every two-argument Math.min / Math.max with
// a numeric literal on one side is a bound too; it is rewritten to
// `__mm(id, isMin, a, b)`, which returns exactly what Math did and counts how
// often the literal won. Bounds of 0 and 1 and tiny epsilons are reported
// apart, as ARITHMETIC — a quantity that cannot be negative, a share that
// cannot pass one, a divisor that cannot be zero — because those are what a
// number is rather than a model choice.
const mmSites = [];
const NUM = /^\s*-?(\d[\d_]*\.?\d*|\.\d+)(e-?\d+)?\s*$/;
function splitArgs(s) {
  const out = []; let depth = 0, cur = "";
  for (const ch of s) {
    if ("([{".includes(ch)) depth++;
    if (")]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur); return out;
}
function rewriteMM(src, file, lineOf) {
  let out = "", i = 0;
  const re = /Math\.(min|max)\(/g;
  while (true) {
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) { out += src.slice(i); break; }
    const open = m.index + m[0].length;
    let depth = 1, j = open;
    while (j < src.length && depth > 0) { const c = src[j]; if (c === "(") depth++; else if (c === ")") depth--; j++; }
    const inner = src.slice(open, j - 1);
    const args = splitArgs(inner);
    const lit = args.length === 2 ? args.findIndex((x) => NUM.test(x)) : -1;
    if (lit < 0 || args.every((x) => NUM.test(x))) {
      out += src.slice(i, open) + rewriteMM(inner, file, (k) => lineOf(open + k)) + ")";
      i = j; continue;
    }
    const v = Number(args[lit].replace(/_/g, ""));
    const id = mmSites.length;
    const line = lineOf(m.index);
    mmSites.push({ file, line, isMin: m[1] === "min", lit: v, arith: v === 0 || v === 1 || Math.abs(v) < 1e-3 });
    const a0 = rewriteMM(args[0], file, (k) => lineOf(open + k));
    const a1 = rewriteMM(args[1], file, (k) => lineOf(open + args[0].length + 1 + k));
    out += src.slice(i, m.index) + `__mm(${id}, ${m[1] === "min"}, ${lit}, ${a0}, ${a1})`;
    i = j;
  }
  return out;
}
for (const f of readdirSync(join(APP, "src", "engine")).filter((x) => x.endsWith(".ts"))) {
  const rel = join("src", "engine", f);
  let src = readFileSync(join(WORK, rel), "utf8");
  const header = src.startsWith("import { __rail }") ? src.slice(0, src.indexOf("\n") + 1) : "";
  const body = src.slice(header.length);
  const orig = readFileSync(join(APP, rel), "utf8");
  const origLines = orig.split("\n");
  const bodyLines = body.split("\n");
  // line numbers are reported against the ORIGINAL file; the clamp pass does
  // not add or remove newlines inside the body, so body line k is file line k.
  const starts = [0]; for (let k = 0; k < body.length; k++) if (body[k] === "\n") starts.push(k + 1);
  const lineOf = (pos) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo + 1; };
  const before = mmSites.length;
  const rewritten = rewriteMM(body, f, lineOf);
  for (let k = before; k < mmSites.length; k++) mmSites[k].text = (origLines[mmSites[k].line - 1] ?? bodyLines[mmSites[k].line - 1] ?? "").trim();
  if (mmSites.length > before) writeFileSync(join(WORK, rel), `import { __mm } from "./__rails";\n` + header + rewritten);
}

writeFileSync(join(WORK, "src", "engine", "__rails.ts"), `
export const __mmTally: { won: number; n: number }[] = [];
export function __mm(id: number, isMin: boolean, lit: number, a: number, b: number): number {
  const t = (__mmTally[id] ??= { won: 0, n: 0 });
  t.n++;
  const r = isMin ? Math.min(a, b) : Math.max(a, b);
  const other = lit === 0 ? b : a;
  if (other !== r) t.won++;
  return r;
}
export const __tally: { lo: number; hi: number; n: number }[] = [];
export function __rail(id: number, v: number, a: number, b: number): number {
  const t = (__tally[id] ??= { lo: 0, hi: 0, n: 0 });
  t.n++;
  if (v < a) t.lo++;
  else if (v > b) t.hi++;
  return Math.max(a, Math.min(b, v));
}
`);
writeFileSync(join(WORK, "test", ".entry.ts"),
  readFileSync(join(APP, "test", ".entry.ts"), "utf8") + `\nexport { __tally, __mmTally } from "../src/engine/__rails";\n`);

await run(join(APP, "node_modules", ".bin", "esbuild"),
  [join(WORK, "test", ".entry.ts"), "--bundle", "--format=esm", "--platform=node",
    "--outfile=" + join(WORK, "test", ".engine.mjs")], { cwd: APP });

// ------------------------------------------------------------------- play

const probe = `
process.env.CITY_SEEDS = "1";
const E = await import(${JSON.stringify(join(WORK, "test", ".engine.mjs"))});
const { loadCity } = await import(${JSON.stringify(join(WORK, "test", "city.mjs"))});
for (let i = 0; i < ${N}; i++) {
  const { parcels, adjacency, bbls } = loadCity(i, E.normalizeParcels);
  let g = E.firstListings(E.newGame(4242 + i, parcels), parcels, bbls);
  for (let m = 0; m < ${HZ}; m++) {
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
  }
}
console.log(JSON.stringify({ c: E.__tally, m: E.__mmTally }));
`;
writeFileSync(join(WORK, "probe.mjs"), probe);
const { stdout } = await run(process.execPath, [join(WORK, "probe.mjs")], { cwd: APP, maxBuffer: 1 << 26 });
const both = JSON.parse(stdout.trim().split("\n").pop());
const tally = both.c, mmTally = both.m;

// ----------------------------------------------------------------- report

const pad = (s, n) => String(s).padEnd(n);
const rp = (s, n) => String(s).padStart(n);
const rows = sites.map((s, i) => {
  const t = tally[i] ?? { lo: 0, hi: 0, n: 0 };
  const share = t.n ? (t.lo + t.hi) / t.n : 0;
  return { ...s, ...t, share };
});

const live = rows.filter((r) => r.n > 0);
const dead = rows.filter((r) => r.n === 0);
const bearing = live.filter((r) => r.share >= BIND).sort((a, b) => b.share - a.share);
const guards = live.filter((r) => r.share < BIND);

console.log(`\nRAILS — ${sites.length} clamp() callsites, ${N} towns x ${HZ / 12} years, no player\n`);
console.log(`  ${bearing.length} are LOAD-BEARING (a bound is reached in >= ${(BIND * 100).toFixed(0)}% of calls)`);
console.log(`  ${guards.length} are guards`);
console.log(`  ${dead.length} were never called at all`);

if (bearing.length) {
  console.log(`\nLOAD-BEARING — the model rests on these, and reading the code cannot tell you that\n`);
  console.log(`  ${pad("where", 22)}${rp("calls", 10)}${rp("at floor", 10)}${rp("at ceil", 9)}   code`);
  for (const r of bearing.slice(0, 30)) {
    console.log(`  ${pad(r.file.replace(".ts", "") + ":" + r.line, 22)}${rp(r.n.toLocaleString(), 10)}`
      + `${rp(((100 * r.lo) / r.n).toFixed(1) + "%", 10)}${rp(((100 * r.hi) / r.n).toFixed(1) + "%", 9)}   ${r.text.slice(0, 74)}`);
  }
}

if (dead.length) {
  console.log(`\nNEVER CALLED — dead code, or a branch no city ever reaches\n`);
  for (const r of dead.slice(0, 14)) console.log(`  ${pad(r.file.replace(".ts", "") + ":" + r.line, 22)}${r.text.slice(0, 88)}`);
  if (dead.length > 14) console.log(`  ...and ${dead.length - 14} more`);
}

// Coverage, stated rather than assumed.
{
  const mrows = mmSites.map((s, i) => { const t = mmTally[i] ?? { won: 0, n: 0 }; return { ...s, ...t, share: t.n ? t.won / t.n : 0 }; });
  const mb = mrows.filter((r) => r.n > 0 && r.share >= BIND);
  const model = mb.filter((r) => !r.arith).sort((a, b) => b.share - a.share);
  const arith = mb.filter((r) => r.arith);
  console.log(`\nHAND-WRITTEN BOUNDS — ${mmSites.length} Math.min/max sites with a literal; ${model.length} load-bearing model bounds, ${arith.length} load-bearing arithmetic (0, 1, epsilon)\n`);
  console.log(`  ${pad("where", 22)}${rp("calls", 12)}${rp("bound won", 11)}   code`);
  for (const r of model.slice(0, Number(process.env.SHOW ?? 60))) {
    console.log(`  ${pad(r.file.replace(".ts", "") + ":" + r.line, 22)}${rp(r.n.toLocaleString(), 12)}${rp(((100 * r.won) / r.n).toFixed(1) + "%", 11)}   ${(r.isMin ? "min " : "max ") + r.lit + "  " + (r.text ?? "").slice(0, 70)}`);
  }
}

const other = [];
for (const f of readdirSync(join(APP, "src", "engine")).filter((x) => x.endsWith(".ts"))) {
  const src = readFileSync(join(APP, "src", "engine", f), "utf8");
  for (const name of ["clampA(", "clampL(", "clampN(", "clamp01("]) {
    const c = src.split(name).length - 1;
    if (c) other.push(`${f}:${name.slice(0, -1)} x${c}`);
  }
  const raw = (src.match(/Math\.max\([^;\n]*Math\.min\(/g) ?? []).length;
  if (raw) other.push(`${f}:hand-written max/min x${raw}`);
}
console.log(`\nUNINSTRUMENTED — outside this tool's reach, listed so the coverage is visible\n`);
console.log(`  ${other.join("\n  ")}`);
console.log(`\n  A guard that never fires is a guard and should be left alone. A bound the`);
console.log(`  market leans on is the model wearing a guard's clothes, and the number`);
console.log(`  beside it in the code is not the number doing the work.\n`);

rmSync(WORK, { recursive: true, force: true });
