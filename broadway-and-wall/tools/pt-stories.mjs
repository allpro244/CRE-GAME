// PLAYTEST ANALYSIS — STORY MINER (throwaway, research only)
//
// Pulls the memorable runs out of the tournament output. Everything here is
// read back off a recorded run — nothing is composed. Each line prints the run
// it came from so it can be re-run and checked.
//
//   node tools/pt-stories.mjs /tmp/pt/main
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = process.argv[2];
const runs = readdirSync(DIR).filter((f) => f.endsWith(".json"))
  .map((f) => ({ f, r: JSON.parse(readFileSync(join(DIR, f), "utf8")) }));

const M = (n) => {
  if (!Number.isFinite(n)) return "n/a";
  const s = n < 0 ? "-" : "", a = Math.abs(n);
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  return `${s}$${(a / 1e3).toFixed(0)}k`;
};
const id = (x) => `${x.r.cfg.strategy}/seed ${x.r.cfg.citySeed} ${x.r.cfg.cityName}`;

console.log(`\n=== STORY MINE (${runs.length} runs) ===`);

// 1. Richest runs.
console.log(`\n--- THE BIGGEST FORTUNES (real terminal, CPI-deflated) ---`);
for (const x of runs.slice().sort((a, b) => b.r.finalReal - a.r.finalReal).slice(0, 6)) {
  const r = x.r;
  console.log(`  ${M(r.finalReal).padStart(8)} real (${M(r.finalNW)} nominal, CPI ${r.cpi.toFixed(1)}x)  ${id(x)}`);
  console.log(`      ${r.st.bought} bought / ${r.st.built ?? r.st.builtN} built / ${r.st.sold} sold, ${r.st.leases} leases, peak ${M(r.peakNW)}, worst drawdown ${(100 * Math.min(1, r.maxDD)).toFixed(0)}%, finished #${r.rank} of ${r.nRivals + 1}`);
}

// 2. The comeback: worst drawdown that still finished rich.
console.log(`\n--- BURIED, THEN BACK (deep drawdown, strong finish) ---`);
for (const x of runs.filter((x) => !x.r.died && x.r.maxDD > 0.5 && x.r.finalReal > 2e7)
  .sort((a, b) => b.r.maxDD - a.r.maxDD).slice(0, 5)) {
  const r = x.r;
  const peakY = 2000 + Math.floor(r.ddPeakM / 12), troughY = 2000 + Math.floor(r.ddTroughM / 12);
  console.log(`  ${id(x)}: down ${(100 * r.maxDD).toFixed(0)}% (peak ${peakY} -> trough ${troughY}), finished ${M(r.finalReal)} real`);
}

// 3. The long wait: flat for decades, then paid off.
console.log(`\n--- LOOKED DEAD FOR DECADES, THEN PAID (NW at year 60 vs year 100) ---`);
const slow = [];
for (const x of runs) {
  const r = x.r;
  if (r.died) continue;
  const at60 = r.annual.find((a) => a.y === 2060);
  if (!at60 || at60.real <= 0) continue;
  const mult = r.finalReal / at60.real;
  if (at60.real < 2e7 && mult > 4) slow.push({ x, at60, mult });
}
for (const s of slow.sort((a, b) => b.mult - a.mult).slice(0, 5)) {
  console.log(`  ${id(s.x)}: ${M(s.at60.real)} real at 2060 -> ${M(s.x.r.finalReal)} at 2100 (${s.mult.toFixed(1)}x in the last 40 years)`);
}

// 4. Single-asset home runs, from the sale log in the story stream.
console.log(`\n--- SINGLE BUILDINGS THAT RAN (recorded sales above 2.5x basis) ---`);
const bigSales = [];
for (const x of runs) for (const s of x.r.stories) if (s.tag === "sale") bigSales.push({ x, s });
for (const b of bigSales.sort((a, b) => (parseFloat(b.s.text.match(/([\d.]+)x basis/)?.[1] ?? 0)) - (parseFloat(a.s.text.match(/([\d.]+)x basis/)?.[1] ?? 0))).slice(0, 8)) {
  console.log(`  ${b.s.y}  ${b.s.text}`);
  console.log(`        (${id(b.x)})`);
}

// 5. Rival failures — who dies and when.
console.log(`\n--- RIVAL MORTALITY (pooled) ---`);
const styleFails = {}, styleFirst = {};
let totalFails = 0;
for (const x of runs) for (const f of x.r.rivalFails) {
  styleFails[f.style] = (styleFails[f.style] ?? 0) + 1;
  (styleFirst[f.style] ??= []).push(2000 + Math.floor(f.m / 12));
  totalFails++;
}
console.log(`  ${totalFails} rival failures across ${runs.length} runs`);
for (const [st, n] of Object.entries(styleFails).sort((a, b) => b[1] - a[1])) {
  const yrs = styleFirst[st].sort((a, b) => a - b);
  console.log(`    ${st.padEnd(14)} ${String(n).padStart(4)} failures   median year ${yrs[Math.floor(yrs.length / 2)]}   earliest ${yrs[0]}`);
}

// 6. Named rival collapses with a traceable date.
console.log(`\n--- EARLIEST NAMED RIVAL COLLAPSES ---`);
const named = [];
for (const x of runs) for (const f of x.r.rivalFails) named.push({ x, f });
for (const n of named.sort((a, b) => a.f.m - b.f.m).slice(0, 6)) {
  console.log(`  ${2000 + Math.floor(n.f.m / 12)}  ${n.f.name} (${n.f.style}) failed in ${n.x.r.cfg.cityName} — ${id(n.x)}`);
}

// 7. Deaths, with the last thing that happened.
console.log(`\n--- THE WIPEOUTS ---`);
const dead = runs.filter((x) => x.r.died).sort((a, b) => a.r.diedM - b.r.diedM);
console.log(`  ${dead.length} of ${runs.length} runs ended in bankruptcy`);
for (const x of dead.slice(0, 6)) {
  const r = x.r;
  const last = r.annual[r.annual.length - 1];
  console.log(`  ${2000 + Math.floor(r.diedM / 12)}  ${id(x)} — peak ${M(r.peakNW)}, ended ${M(last?.nw)} with ${last?.n} buildings left`);
}

// 8. Cities that were unusually kind or cruel to everybody.
console.log(`\n--- THE CITIES THEMSELVES (median real outcome across all strategies on that seed) ---`);
const bySeed = {};
for (const x of runs) (bySeed[x.r.cfg.citySeed] ??= []).push(x.r);
const seedRows = Object.entries(bySeed).map(([d, set]) => {
  const v = set.map((r) => r.finalReal).sort((a, b) => a - b);
  return { d, name: set[0].cfg.cityName, med: v[Math.floor(v.length / 2)], n: set.length,
    deaths: set.filter((r) => r.died).length, lots: set[0].cfg.lots };
}).sort((a, b) => b.med - a.med);
for (const s of seedRows) {
  console.log(`  seed ${s.d} ${s.name.padEnd(20)} median ${M(s.med).padStart(8)} across ${s.n} strategies, ${s.deaths} bankrupt, ${s.lots} lots`);
}
