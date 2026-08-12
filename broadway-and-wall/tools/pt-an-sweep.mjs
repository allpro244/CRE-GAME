// PLAYTEST ANALYSIS — SIZE / STARTING-CASH SWEEP (throwaway, research only)
//
// Answers one question: does the winning strategy change with the size of the
// pond or the size of the opening cheque? Only BALANCED blocks are reported —
// a cell where some strategies finished and others did not would rank the
// strategies that happen to run fastest.
//
//   node tools/pt-an-sweep.mjs /tmp/pt/sweep
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = process.argv[2];
const runs = readdirSync(DIR).filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")));

const pct = (arr, p) => {
  const a = arr.filter(Number.isFinite).slice().sort((x, y) => x - y);
  if (!a.length) return NaN;
  return a[Math.min(a.length - 1, Math.floor(p * a.length))];
};
const M = (n) => {
  if (!Number.isFinite(n)) return "n/a";
  const s = n < 0 ? "-" : "", a = Math.abs(n);
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(0)}M`;
  return `${s}$${(a / 1e3).toFixed(0)}k`;
};

// Group into conditions: one per (size, startCash).
const cond = {};
for (const r of runs) {
  const k = `${r.cfg.size}|${r.cfg.startCash}`;
  (cond[k] ??= []).push(r);
}

console.log(`\n=== SWEEP (${runs.length} runs) ===`);
for (const [k, set] of Object.entries(cond)) {
  const [size, cashS] = k.split("|");
  const strats = [...new Set(set.map((r) => r.cfg.strategy))];
  const seeds = [...new Set(set.map((r) => r.cfg.citySeed))];
  const full = strats.length * seeds.length;
  const balanced = set.length === full;
  console.log(`\n--- size=${size}  start=${M(+cashS)}  (${set.length} runs, ${strats.length} strategies x ${seeds.length} seeds)${balanced ? "" : "  ** INCOMPLETE — ranking withheld **"}`);
  if (!balanced) continue;

  const rows = strats.map((s) => {
    const sub = set.filter((r) => r.cfg.strategy === s);
    return {
      s,
      med: pct(sub.map((r) => r.finalReal), .5),
      died: sub.filter((r) => r.died).length,
      n: sub.length,
      p90: pct(sub.map((r) => r.finalReal), .9),
    };
  }).sort((a, b) => b.med - a.med);
  console.log(`    rank  strategy        median real   p90 real    bankrupt`);
  rows.forEach((r, i) => console.log(`    ${String(i + 1).padStart(4)}  ${r.s.padEnd(14)} ${M(r.med).padStart(11)}  ${M(r.p90).padStart(9)}    ${r.died}/${r.n}`));
}

// Cross-condition comparison of the ranking itself.
console.log(`\n--- DOES THE WINNER MOVE? ---`);
for (const [k, set] of Object.entries(cond)) {
  const strats = [...new Set(set.map((r) => r.cfg.strategy))];
  const seeds = [...new Set(set.map((r) => r.cfg.citySeed))];
  if (set.length !== strats.length * seeds.length) continue;
  const rows = strats.map((s) => {
    const sub = set.filter((r) => r.cfg.strategy === s);
    return { s, med: pct(sub.map((r) => r.finalReal), .5) };
  }).sort((a, b) => b.med - a.med);
  const [size, cashS] = k.split("|");
  console.log(`  ${size.padEnd(7)} ${M(+cashS).padStart(5)}  ->  ${rows.slice(0, 3).map((r) => `${r.s}(${M(r.med)})`).join("  ")}`);
}
