// PLAYTEST ANALYSIS — ECONOMY (throwaway, research only)
//   node tools/pt-an-econ.mjs /tmp/pt/econ
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = process.argv[2];
const CLASSES = ["office", "retail", "multifamily", "industrial"];
const runs = readdirSync(DIR).filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")));

const pct = (arr, p) => {
  const a = arr.filter(Number.isFinite).slice().sort((x, y) => x - y);
  if (!a.length) return NaN;
  return a[Math.min(a.length - 1, Math.floor(p * a.length))];
};
const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const corr = (a, b) => {
  const ma = mean(a), mb = mean(b);
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return n / Math.sqrt(da * db);
};
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "n/a");
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "n/a");

// Group by size; the standard 'city' band is the headline.
const bySize = {};
for (const r of runs) (bySize[r.cfg.size] ??= []).push(r);

console.log(`\n=== ECONOMY OBSERVER ===`);
console.log(`runs=${runs.length}  ` + Object.entries(bySize).map(([k, v]) => `${k}:${v.length}`).join(" "));
console.log(`horizon=${runs[0]?.months}m  resurrections total=${runs.reduce((a, r) => a + r.resurrections, 0)}`);

function analyse(label, set) {
  console.log(`\n--- ${label} (n=${set.length} seeds) ---`);

  // ---- REAL rent index by class. Nominal rent over a century is mostly CPI;
  // deflating is the only way to see whether rent actually went anywhere.
  console.log(`\n  REAL RENT (CPI-deflated, indexed to month 12 = 100), across seeds:`);
  for (const k of CLASSES) {
    const finals = [], amps = [], troughs = [];
    for (const r of set) {
      const h = r.hist.filter((x) => x.q >= 12);
      const base = (h[0].rent[k] / h[0].cpi);
      const series = h.map((x) => (x.rent[k] / x.cpi) / base * 100);
      finals.push(series[series.length - 1]);
      amps.push(Math.max(...series) - Math.min(...series));
      troughs.push(Math.min(...series));
    }
    console.log(`    ${k.padEnd(13)} end p10/p50/p90 = ${f0(pct(finals, .1))}/${f0(pct(finals, .5))}/${f0(pct(finals, .9))}   peak-trough swing median ${f0(pct(amps, .5))} pts   worst trough ${f0(Math.min(...troughs))}`);
  }

  // ---- Cycle: how many downturns, how long, how deep.
  const recCounts = [], recLens = [], recovLens = [], phaseShare = {};
  for (const r of set) {
    let inRec = false, start = 0, n = 0;
    const vac = r.hist.map((x) => x.vac.office);
    for (let i = 1; i < r.hist.length; i++) {
      // A downturn defined on the engine's own cycle deviation, not on phase
      // labels, so it measures the economy rather than the naming.
      const down = r.hist[i].cyc < -0.02;
      if (down && !inRec) { inRec = true; start = i; n++; }
      if (!down && inRec) { inRec = false; recLens.push(i - start); }
    }
    recCounts.push(n);
    // Vacancy recovery: months from a vacancy peak back under its long mean.
    const m = mean(vac);
    let peakI = -1;
    for (let i = 24; i < vac.length; i++) {
      if (vac[i] > m * 1.35 && peakI < 0) peakI = i;
      else if (peakI >= 0 && vac[i] < m) { recovLens.push(i - peakI); peakI = -1; }
    }
    for (const x of r.hist) phaseShare[x.cyc < -0.02 ? "down" : x.cyc > 0.02 ? "up" : "flat"] =
      (phaseShare[x.cyc < -0.02 ? "down" : x.cyc > 0.02 ? "up" : "flat"] ?? 0) + 1;
  }
  console.log(`\n  CYCLE: downturns per century p10/p50/p90 = ${f0(pct(recCounts, .1))}/${f0(pct(recCounts, .5))}/${f0(pct(recCounts, .9))}`);
  console.log(`    downturn length months p50=${f0(pct(recLens, .5))} p90=${f0(pct(recLens, .9))}   (n=${recLens.length} downturns)`);
  console.log(`    vacancy recovery months p50=${f0(pct(recovLens, .5))} p90=${f0(pct(recovLens, .9))}  (n=${recovLens.length} episodes)`);
  const tot = Object.values(phaseShare).reduce((a, b) => a + b, 0);
  console.log(`    time in down/flat/up = ${(100 * (phaseShare.down ?? 0) / tot).toFixed(0)}% / ${(100 * (phaseShare.flat ?? 0) / tot).toFixed(0)}% / ${(100 * (phaseShare.up ?? 0) / tot).toFixed(0)}%`);

  // ---- Correlation between classes, on real rent growth. Pooled across seeds.
  console.log(`\n  CLASS CO-MOVEMENT (corr of 12m real rent change, pooled over seeds):`);
  const growth = {};
  for (const k of CLASSES) {
    growth[k] = [];
    for (const r of set) {
      const h = r.hist;
      for (let i = 12; i < h.length; i++) {
        growth[k].push((h[i].rent[k] / h[i].cpi) / (h[i - 12].rent[k] / h[i - 12].cpi) - 1);
      }
    }
  }
  for (let i = 0; i < CLASSES.length; i++) {
    for (let j = i + 1; j < CLASSES.length; j++) {
      const a = CLASSES[i], b = CLASSES[j];
      console.log(`    ${a.slice(0, 4)}~${b.slice(0, 4)}  r=${f2(corr(growth[a], growth[b]))}`);
    }
  }

  // ---- Vacancy: 10-year means, never a snapshot (CLAUDE.md: a one-month read
  // reports the phase of the cycle, not the level of anything).
  console.log(`\n  VACANCY, decade means (median across seeds):`);
  const decs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (const k of CLASSES) {
    const line = decs.map((d) => {
      const vals = set.map((r) => mean(r.hist.filter((x) => x.q >= d * 120 && x.q < (d + 1) * 120).map((x) => x.vac[k])));
      return (100 * pct(vals, .5)).toFixed(1);
    });
    console.log(`    ${k.padEnd(13)} ${line.join("  ")}`);
  }

  // ---- Cap rates, decade means.
  console.log(`\n  CAP RATE %, decade means (median across seeds):`);
  for (const k of CLASSES) {
    const line = decs.map((d) => {
      const vals = set.map((r) => mean(r.hist.filter((x) => x.q >= d * 120 && x.q < (d + 1) * 120).map((x) => x.cap[k])));
      return pct(vals, .5).toFixed(2);
    });
    console.log(`    ${k.padEnd(13)} ${line.join("  ")}`);
  }

  // ---- Policy rate.
  const rates = set.flatMap((r) => r.hist.map((x) => x.rate));
  const rateDec = decs.map((d) => pct(set.map((r) => mean(r.hist.filter((x) => x.q >= d * 120 && x.q < (d + 1) * 120).map((x) => x.rate))), .5));
  console.log(`\n  POLICY / INDEX RATE %: overall p10/p50/p90 = ${f2(pct(rates, .1))}/${f2(pct(rates, .5))}/${f2(pct(rates, .9))}  min ${f2(Math.min(...rates))} max ${f2(Math.max(...rates))}`);
  console.log(`    decade medians: ${rateDec.map((x) => x.toFixed(2)).join("  ")}`);

  // ---- Construction cost, real.
  const costEnd = set.map((r) => { const h = r.hist[r.hist.length - 1]; return h.cost; });
  console.log(`\n  CONSTRUCTION COST INDEX (nominal costIdx): end p10/p50/p90 = ${f2(pct(costEnd, .1))}/${f2(pct(costEnd, .5))}/${f2(pct(costEnd, .9))}`);

  // ---- Inflation over the century.
  const cpiEnd = set.map((r) => r.hist[r.hist.length - 1].cpi);
  console.log(`  CPI at year 100: p10/p50/p90 = ${f1(pct(cpiEnd, .1))}x / ${f1(pct(cpiEnd, .5))}x / ${f1(pct(cpiEnd, .9))}x  ` +
    `(=> ${(100 * (Math.pow(pct(cpiEnd, .5), 1 / 100) - 1)).toFixed(2)}%/yr median)`);

  // ---- Land dispersion on the fixed cohort.
  console.log(`\n  LAND $/sf ON A FIXED COHORT (real, CPI-deflated; median across seeds):`);
  console.log(`    year   p10     p50     p90     p99     p90/p10`);
  for (let i = 0; i < (set[0]?.landSnaps.length ?? 0); i += 2) {
    const yr = Math.round((set[0].landSnaps[i].m + 1) / 12);
    const g = (f) => pct(set.map((r) => (r.landSnaps[i]?.[f] ?? NaN) / (r.landSnaps[i]?.cpi ?? 1)), .5);
    const ratio = pct(set.map((r) => (r.landSnaps[i]?.p90 ?? NaN) / Math.max(1e-9, r.landSnaps[i]?.p10 ?? NaN)), .5);
    console.log(`    ${String(yr).padStart(4)}  ${f1(g("p10")).padStart(6)}  ${f1(g("p50")).padStart(6)}  ${f1(g("p90")).padStart(6)}  ${f1(g("p99")).padStart(6)}  ${f1(ratio).padStart(6)}x`);
  }

  // ---- Absorption and completions.
  const absTot = {}, compTot = {};
  for (const k of CLASSES) {
    absTot[k] = pct(set.map((r) => mean(r.hist.filter((x) => x.q > 12).map((x) => x.abs?.[k] ?? 0))), .5);
    compTot[k] = pct(set.map((r) => mean(r.hist.filter((x) => x.q > 12).map((x) => x.comp?.[k] ?? 0))), .5);
  }
  console.log(`\n  ABSORPTION vs COMPLETIONS (median seed, mean sf/12mo window):`);
  for (const k of CLASSES) console.log(`    ${k.padEnd(13)} absorb ${Math.round(absTot[k]).toLocaleString().padStart(9)}   complete ${Math.round(compTot[k]).toLocaleString().padStart(9)}`);

  // ---- Rivals.
  const fails = set.map((r) => r.rivalFails.length);
  const alive = set.map((r) => r.rivalsAlive);
  console.log(`\n  RIVALS: started ${set[0]?.rivalsAtStart}, failures per century p10/p50/p90 = ${f0(pct(fails, .1))}/${f0(pct(fails, .5))}/${f0(pct(fails, .9))}, alive at 100y median ${f0(pct(alive, .5))}`);
  const dem = set.map((r) => r.demolished);
  console.log(`  DEMOLITIONS per century median ${f0(pct(dem, .5))}   city-built median ${f0(pct(set.map((r) => r.cityBuilt), .5))}`);
}
function f0(x) { return Number.isFinite(x) ? String(Math.round(x)) : "n/a"; }

analyse("SIZE = city (headline)", bySize.city ?? []);
for (const s of ["hamlet", "town", "metro", "giant"]) if (bySize[s]?.length) analyse(`SIZE = ${s}`, bySize[s]);
