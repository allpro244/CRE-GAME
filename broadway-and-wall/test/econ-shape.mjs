// THE SHAPE OF THE ECONOMY, AGAINST THE HISTORICAL RECORD.
//
//   pnpm engine && node test/econ-shape.mjs          (3 seeds, ~4 min)
//   SEEDS=1,2,3,4,5,6 node test/econ-shape.mjs       (more seeds, slower)
//
// This is a REPORT, not a gate — see CLAUDE.md on the lettered tests. It
// exists because three complaints from playtest were all, when measured,
// true, and none of them was visible to any harness in the repo:
//
//   "office always wins"            — crude return: office 11.4-12.0% on every
//                                     seed, next class 9.2-9.9%. Highest
//                                     growth AND highest yield AND (2 of 3
//                                     seeds) shallowest drawdowns.
//   "rates are too easy to guess"   — 61-70% of monthly moves continued the
//                                     previous month's direction; runs of one
//                                     direction reached 62 months; only 5-6%
//                                     of months were flat. Monthly change sd
//                                     6-8bp against ~25-30bp for a real index.
//   "rent growth outruns the rates" — through each seed's biggest 8-year rate
//                                     rise, OFFICE VALUE ROSE (+4/+22/+16%).
//                                     In 2022-23 (+500bp in 18 months) even
//                                     industrial, with the best rent growth in
//                                     modern history, lost 15-20% of value.
//
// Every band below is a historical anchor, not a taste: US CPI 1975-2025 and
// its tails, the FOMC's hold share, monthly change sd of a market loan index,
// and the risk ordering of class returns (the class with the deepest
// recessions carries the highest cap — office — so no class should hold the
// top return seat on most seeds).
//
// Cyclical quantities are measured over the whole run, never a snapshot; the
// world runs WITHOUT a player (resurrected on gameOver, per CLAUDE.md).
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const K = ["office", "retail", "multifamily", "industrial"];
const SEEDS = (process.env.SEEDS ?? "4242,550991,12007").split(",").map(Number);
const YEARS = Number(process.env.YEARS ?? 50);
// Natural vacancy per class — mirrors NATURAL_VAC in market.ts; used only to
// turn an asking index into a crude value index, so a drift there cannot fail
// this report, only shade it.
const NV = { office: 0.115, retail: 0.085, multifamily: 0.045, industrial: 0.07 };

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const pct = (x, d = 0) => `${(100 * x).toFixed(d)}%`;

// One band per line, printed the way the lettered tests print: the measured
// number, the band, and IN/OUT. Nothing here exits non-zero.
const rows = [];
function band(label, value, lo, hi, fmt = (v) => v.toFixed(2)) {
  const inBand = value >= lo && value <= hi;
  rows.push({ label, value, lo, hi, inBand, fmt });
}

const perSeed = [];
for (const seed of SEEDS) {
  const { parcels: P0, adjacency, bbls } = loadCity(0, E.normalizeParcels);
  const parcels = JSON.parse(JSON.stringify(P0));
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  const R = [];
  for (let m = 0; m < YEARS * 12; m++) {
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    const e = g.econ;
    R.push({
      rate: e.indexRate, policy: e.nat?.policy ?? e.indexRate, cpi: e.cpi ?? 1,
      rent: Object.fromEntries(K.map((k) => [k, e.rentIdx[k]])),
      cap: Object.fromEntries(K.map((k) => [k, e.capRate[k]])),
    });
    g = E.advanceMonth(g, parcels, bbls, adjacency);
  }

  // ---- inflation: mean and tails -----------------------------------------
  const infl = [];
  for (let y = 1; y < YEARS; y++) infl.push(R[y * 12].cpi / R[(y - 1) * 12].cpi - 1);

  // ---- class returns: crude unlevered total return -----------------------
  const ret = {};
  for (const k of K) {
    const cagr = (R.at(-1).rent[k] / R[0].rent[k]) ** (1 / YEARS) - 1;
    ret[k] = 100 * cagr + mean(R.map((r) => r.cap[k]));
  }
  const winner = K.reduce((a, b) => (ret[b] > ret[a] ? b : a));
  const spread = Math.max(...K.map((k) => ret[k])) - Math.min(...K.map((k) => ret[k]));

  // ---- the rate path -----------------------------------------------------
  // TWO OBSERVABLES, TWO SHAPES. The POLICY rate is a committee: it holds most
  // months, and when it moves it moves in steps — flatness is ITS virtue. The
  // LOAN INDEX is a market: it is never flat, its monthly direction is close
  // to a coin flip, and its monthly change runs 15-30bp. Grading the index on
  // the committee's flatness (as the first cut of this file did) demands a
  // frozen market, which is its own kind of fake.
  const d = R.slice(1).map((r, i) => r.rate - R[i].rate);
  const dp = R.slice(1).map((r, i) => r.policy - R[i].policy);
  const flat = dp.filter((x) => Math.abs(x) <= 0.005).length / dp.length;
  const signs = d.filter((x) => Math.abs(x) > 0.005).map(Math.sign);
  let same = 0;
  for (let i = 1; i < signs.length; i++) if (signs[i] === signs[i - 1]) same++;
  const persist = signs.length > 1 ? same / (signs.length - 1) : 0;
  const rateSd = sd(d);

  // ---- transmission: the biggest 2-year rate spike -----------------------
  // 24 months is a real tightening cycle (1979-81, 1994, 2022); the 8-year
  // window in the first measurement let slow rent compounding hide the fault.
  let spike = { i: 0, dr: -Infinity };
  for (let i = 0; i + 24 < R.length; i++) {
    const dr = R[i + 24].rate - R[i].rate;
    if (dr > spike.dr) spike = { i, dr };
  }
  const a = R[spike.i], b = R[spike.i + 24];
  // REAL, NOT NOMINAL. In an inflation-era century property gained nominal
  // value straight through the worst rate spikes (the 1970s did exactly that)
  // while losing real value — a nominal metric grades those centuries wrong.
  const cpiW = b.cpi / a.cpi;
  const vLift = {};
  for (const k of K) {
    const v0 = a.rent[k] * (1 - NV[k]) / (a.cap[k] / 100);
    const v1 = b.rent[k] * (1 - NV[k]) / (b.cap[k] / 100);
    vLift[k] = (v1 / v0) / cpiW - 1;
  }
  const bestThroughSpike = Math.max(...K.map((k) => vLift[k]));

  perSeed.push({ seed, infl, ret, winner, spread, flat, persist, rateSd, spike: spike.dr, bestThroughSpike });
}

// ------------------------------------------------------------------ report
console.log(`\nECON SHAPE — ${SEEDS.length} seed(s) x ${YEARS} years, no player\n`);
for (const p of perSeed) {
  console.log(`seed ${String(p.seed).padEnd(7)} winner ${p.winner.padEnd(11)}`
    + ` spread ${p.spread.toFixed(1)}pt`
    + `  CPI ${pct(mean(p.infl), 1)}±${pct(sd(p.infl), 1)}`
    + `  rate: flat ${pct(p.flat)} persist ${pct(p.persist)} sd ${(100 * p.rateSd).toFixed(0)}bp`
    + `  spike +${p.spike.toFixed(1)}pt -> best class value ${pct(p.bestThroughSpike)}`);
}
console.log("");

const allInfl = perSeed.flatMap((p) => p.infl);
const winners = perSeed.map((p) => p.winner);
const topShare = Math.max(...K.map((k) => winners.filter((w) => w === k).length)) / winners.length;

// NCREIF NPI 1978-2023 total returns by property type: industrial ~9.7%,
// apartment ~9.2%, retail ~8.7%, office ~7.7% — a real forty-five-year spread
// of about two points. The band admits that; what it refuses is the four-point
// spread the first measurement found, with the top seat never changing hands.
band("class return spread, max-min (pts)", mean(perSeed.map((p) => p.spread)), 0, 2.2, (v) => v.toFixed(1));
band("one class's winner share", topShare, 0, 0.6001, pct);
band("CPI annual mean", mean(allInfl), 0.02, 0.045, (v) => pct(v, 1));
// The sd and tail bands admit BOTH kinds of half-century, because history
// has both: a window containing the 1970s runs sd ~3.0 with 8-12 years over
// 5%; the post-Volcker window (1990-2020) runs sd ~1.1 with zero. What the
// first cut demanded — every seed gets a Great Inflation — is not the record.
// What the record does refuse is a sim that can NEVER produce one, so the
// tails are graded on the mean across seeds with a floor above zero.
band("CPI annual sd", sd(allInfl), 0.011, 0.035, (v) => pct(v, 1));
band("CPI years > 5% (per 50)", mean(perSeed.map((p) => p.infl.filter((x) => x > 0.05).length)) * (50 / (YEARS - 1)), 1, 12, (v) => v.toFixed(1));
band("policy flat-month share", mean(perSeed.map((p) => p.flat)), 0.40, 0.95, pct);
band("next-month same direction", mean(perSeed.map((p) => p.persist)), 0.30, 0.60, pct);
band("monthly rate-change sd (bp)", 100 * mean(perSeed.map((p) => p.rateSd)), 15, 30, (v) => v.toFixed(0));
// ONLY REAL SPIKES ARE GRADED. Values rising through a SLOW tightening is
// historical fact (2004-06: +425bp over two years and prices boomed); what
// must hurt is a fast one (1980, 1994, 2022). A seed whose biggest 2-year
// move is under 3 points had no fast cycle to grade.
const spiky = perSeed.filter((p) => p.spike >= 3);
if (spiky.length) {
  band(`best class value thru 2y spike >=3pt (${spiky.length} seed${spiky.length === 1 ? "" : "s"})`,
    mean(spiky.map((p) => p.bestThroughSpike)), -1, 0.0001, pct);
}

let out = 0;
for (const r of rows) {
  if (!r.inBand) out++;
  console.log(`${r.inBand ? "  in  " : "  OUT "} ${r.label.padEnd(34)} ${r.fmt(r.value).padStart(8)}   band ${r.fmt(r.lo)}..${r.fmt(r.hi)}`);
}
console.log(`\n${rows.length - out} of ${rows.length} shapes sit inside their historical band.`);
console.log("This is a REPORT. A band is a calibration, not an identity — see CLAUDE.md.");
