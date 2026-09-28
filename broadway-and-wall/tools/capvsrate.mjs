// CAP RATE vs BASE RATE — what the engine actually produces, binned by the
// loan index, with the office target decomposed into its terms.
//
//   CITY_SEEDS=1 SEEDS=8 HZ=1200 node tools/capvsrate.mjs
//
// Written for the owner's report "the base rate is 2% but the lowest cap rate
// I can sell at is 8%". It answers three questions the acceptance tests do
// not ask: what cap does each class carry at each level of the index, which
// TERM of the target is responsible when money is cheap, and how often the
// 11% ceiling is the number rather than a guard. Reads the engine's own
// constants (CAP_BASE, CAP_VAC_BETA, NATURAL_VAC) so the decomposition cannot
// drift from the formula it is decomposing — if the target line in market.ts
// changes, change the `comp` block here the same day.
//
// Rebuild the bundle first (`pnpm engine`); every harness refuses a stale one.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const APP = join(dirname(fileURLToPath(import.meta.url)), "..");
const E = await import(join(APP, "test", ".engine.mjs"));
const { loadCity } = await import(join(APP, "test", "city.mjs"));
const N = Number(process.env.SEEDS ?? 6);
const HZ = Number(process.env.HZ ?? 1200);
const K = ["office", "retail", "multifamily", "industrial"];
const q = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]; };
const f2 = (x) => Number.isFinite(x) ? x.toFixed(2) : "  —  ";

const rows = [];          // one per month
const parcelCaps = [];    // capRateFor over built office parcels at low-rate months
const eraOf = {};
for (let i = 0; i < N; i++) {
  const seed = 1000 + i * 7919;
  const { parcels: P0, adjacency, bbls } = loadCity(i, E.normalizeParcels);
  const parcels = JSON.parse(JSON.stringify(P0));
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  eraOf[seed] = g.econ.eraKey;
  for (let m = 0; m < HZ; m++) {
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    const e = g.econ;
    const crunch = 1.6 * Math.max(0, 1 - e.creditIdx);
    const retMean = K.reduce((a, k) => a + (e.retExp?.[k] ?? 0), 0) / 4;
    const comp = {};
    for (const k of K) {
      const vacGap = (e.cityVac?.[k] ?? E.NATURAL_VAC[k]) - E.NATURAL_VAC[k];
      comp[k] = {
        base: E.CAP_BASE[k],
        rate: 0.55 * ((e.indexRate - 100 * Math.max(0, (e.nat?.inflExp ?? 0.02) - 0.02)) - 5.4),
        cycle: -0.25 * e.cycleDev,
        crunch,
        sector: -30 * (e.sectorMom?.[k] ?? 0),
        vacRisk: Math.max(-0.6, Math.min(2.0, E.CAP_VAC_BETA[k] * vacGap * 100)),
        flows: Math.max(-1.3, Math.min(1.3, -0.65 * ((e.retExp?.[k] ?? 0) - retMean))),
      };
    }
    rows.push({
      seed, m, era: e.eraKey, phase: e.phase, idx: e.indexRate, policy: e.nat?.policy ?? NaN,
      prem: e.nat?.termPrem ?? NaN, credit: e.creditIdx, cycleDev: e.cycleDev, inflExp: (e.nat?.inflExp ?? 0.02) * 100,
      cap: { ...e.capRate }, vac: { ...e.cityVac }, comp,
    });
    // once a year in a cheap-money month: what does a buyer cap each office building at?
    if (m % 12 === 0 && e.indexRate <= 2.5) {
      for (const b of bbls) {
        const rec = E.resolveRec(parcels, g, b);
        if (!rec || rec.class !== "office" || !rec.bldgArea) continue;
        const cond = E.initialCondition ? E.initialCondition(rec) : "worn";
        parcelCaps.push({ seed, m, cap: E.capRateFor(rec, e, cond), cond, demand: rec.demandScore });
      }
    }
  }
  process.stderr.write(`seed ${seed} (${g.econ.eraKey}) done\n`);
}

console.log(`\n${N} cities x ${HZ} months. Eras: ${Object.values(eraOf).join(", ")}\n`);
const bins = [[0, 2], [2, 2.5], [2.5, 3], [3, 4], [4, 5], [5, 6], [6, 8], [8, 10], [10, 99]];
console.log("Cap rate by loan-index bin (p10 / p50 / p90), and office spread over the index");
console.log("index bin     n      office              retail              multifam            industrial          office-idx p50");
for (const [lo, hi] of bins) {
  const r = rows.filter((x) => x.idx >= lo && x.idx < hi);
  if (!r.length) continue;
  const line = [`${lo.toString().padStart(2)}-${hi === 99 ? "  " : hi.toString().padEnd(4)}`.padEnd(10), r.length.toString().padStart(6)];
  for (const k of K) {
    const c = r.map((x) => x.cap[k]);
    line.push(`${f2(q(c, 0.1))} ${f2(q(c, 0.5))} ${f2(q(c, 0.9))}`.padEnd(19));
  }
  line.push(f2(q(r.map((x) => x.cap.office - x.idx), 0.5)));
  console.log(line.join("  "));
}

const low = rows.filter((x) => x.idx <= 2.5);
console.log(`\nMonths with index <= 2.5%: ${low.length} of ${rows.length} (${(100 * low.length / rows.length).toFixed(1)}%)`);
if (low.length) {
  console.log("  by era: " + Object.entries(low.reduce((a, x) => (a[x.era] = (a[x.era] ?? 0) + 1, a), {})).map(([k, v]) => `${k} ${v}`).join(", "));
  console.log("  by phase: " + Object.entries(low.reduce((a, x) => (a[x.phase] = (a[x.phase] ?? 0) + 1, a), {})).map(([k, v]) => `${k} ${v}`).join(", "));
  console.log(`  office cap >= 8.0 in ${(100 * low.filter((x) => x.cap.office >= 8).length / low.length).toFixed(1)}% of those months; >= 7.0 in ${(100 * low.filter((x) => x.cap.office >= 7).length / low.length).toFixed(1)}%`);
  console.log(`  policy p50 ${f2(q(low.map((x) => x.policy), 0.5))}  termPrem p50 ${f2(q(low.map((x) => x.prem), 0.5))}  credit p50 ${f2(q(low.map((x) => x.credit), 0.5))}  office vac p50 ${(100 * q(low.map((x) => x.vac.office), 0.5)).toFixed(1)}%`);
  console.log("\n  Office cap TARGET decomposition at index <= 2.5 (p10 / p50 / p90):");
  for (const c of ["base", "rate", "cycle", "crunch", "sector", "vacRisk", "flows"]) {
    const v = low.map((x) => x.comp.office[c]);
    console.log(`    ${c.padEnd(8)} ${f2(q(v, 0.1))}  ${f2(q(v, 0.5))}  ${f2(q(v, 0.9))}`);
  }
  const tgt = low.map((x) => Object.values(x.comp.office).reduce((a, b) => a + b, 0));
  console.log(`    ${"TARGET".padEnd(8)} ${f2(q(tgt, 0.1))}  ${f2(q(tgt, 0.5))}  ${f2(q(tgt, 0.9))}     actual capRate.office p50 ${f2(q(low.map((x) => x.cap.office), 0.5))}`);
  for (const k of ["multifamily", "retail", "industrial"]) {
    const tk = low.map((x) => Object.values(x.comp[k]).reduce((a, b) => a + b, 0));
    console.log(`    ${k} target p50 ${f2(q(tk, 0.5))}  actual p50 ${f2(q(low.map((x) => x.cap[k]), 0.5))}  vacRisk p50 ${f2(q(low.map((x) => x.comp[k].vacRisk), 0.5))}  flows p50 ${f2(q(low.map((x) => x.comp[k].flows), 0.5))}`);
  }
}
if (low.length) {
  const dep = low.filter((x) => x.phase === "depression" || x.phase === "recession");
  const ok = low.filter((x) => !(x.phase === "depression" || x.phase === "recession"));
  console.log(`\n  index <= 2.5 split: recession/depression n=${dep.length} office cap p50 ${f2(q(dep.map((x) => x.cap.office), 0.5))} vac p50 ${(100 * q(dep.map((x) => x.vac.office), 0.5)).toFixed(1)}%  |  recovery/expansion/peak n=${ok.length} office cap p50 ${f2(q(ok.map((x) => x.cap.office), 0.5))} vac p50 ${(100 * q(ok.map((x) => x.vac.office), 0.5)).toFixed(1)}%  >=8: ${(100 * ok.filter((x) => x.cap.office >= 8).length / Math.max(1, ok.length)).toFixed(1)}%`);
  console.log(`  inflExp p50 in cheap money ${f2(q(low.map((x) => x.inflExp), 0.5))}%`);
}
{
  const hi = rows.filter((x) => x.cap.office >= 10.999).length;
  console.log(`\n  office cap ON THE 11% CEILING: ${(100 * hi / rows.length).toFixed(2)}% of all months; multifamily ${(100 * rows.filter((x) => x.cap.multifamily >= 10.999).length / rows.length).toFixed(2)}%`);
  const real = rows.map((x) => x.idx - x.inflExp);
  console.log(`  real index (index - inflExp) p10/p50/p90 ${f2(q(real, 0.1))} / ${f2(q(real, 0.5))} / ${f2(q(real, 0.9))}   inflExp p10/p50/p90 ${f2(q(rows.map((x) => x.inflExp), 0.1))} / ${f2(q(rows.map((x) => x.inflExp), 0.5))} / ${f2(q(rows.map((x) => x.inflExp), 0.9))}`);
  const hiIdx = rows.filter((x) => x.idx >= 10);
  console.log(`  index >= 10: n=${hiIdx.length}  inflExp p50 ${f2(q(hiIdx.map((x) => x.inflExp), 0.5))}  real index p50 ${f2(q(hiIdx.map((x) => x.idx - x.inflExp), 0.5))}  office cap p50 ${f2(q(hiIdx.map((x) => x.cap.office), 0.5))}`);
}
if (parcelCaps.length) {
  const c = parcelCaps.map((x) => x.cap);
  console.log(`\n  capRateFor over built OFFICE parcels in cheap-money years (n=${c.length}): p10 ${f2(q(c, 0.1))}  p50 ${f2(q(c, 0.5))}  p90 ${f2(q(c, 0.9))}`);
  console.log(`    share >= 8.0: ${(100 * c.filter((x) => x >= 8).length / c.length).toFixed(1)}%   share <= 6.5: ${(100 * c.filter((x) => x <= 6.5).length / c.length).toFixed(1)}%`);
  for (const cond of ["good", "worn", "obsolete"]) {
    const cc = parcelCaps.filter((x) => x.cond === cond).map((x) => x.cap);
    if (cc.length) console.log(`    ${cond.padEnd(9)} n=${cc.length.toString().padStart(5)}  p50 ${f2(q(cc, 0.5))}`);
  }
}
// Whole-run summary, for reference against the real century
console.log(`\nWhole run: index p10/p50/p90 ${f2(q(rows.map((x) => x.idx), 0.1))} / ${f2(q(rows.map((x) => x.idx), 0.5))} / ${f2(q(rows.map((x) => x.idx), 0.9))}`);
for (const k of K) console.log(`  ${k.padEnd(12)} cap p10/p50/p90 ${f2(q(rows.map((x) => x.cap[k]), 0.1))} / ${f2(q(rows.map((x) => x.cap[k]), 0.5))} / ${f2(q(rows.map((x) => x.cap[k]), 0.9))}   spread over index p50 ${f2(q(rows.map((x) => x.cap[k] - x.idx), 0.5))}   vac p50 ${(100 * q(rows.map((x) => x.vac[k]), 0.5)).toFixed(1)}%`);
// Correlation of office cap with index, and the OLS slope
const xs = rows.map((x) => x.idx), ys = rows.map((x) => x.cap.office);
const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
let sxy = 0, sxx = 0, syy = 0;
for (let i = 0; i < xs.length; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
console.log(`  office cap on index: slope ${(sxy / sxx).toFixed(3)}  corr ${(sxy / Math.sqrt(sxx * syy)).toFixed(3)}`);
