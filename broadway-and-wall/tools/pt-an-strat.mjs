// PLAYTEST ANALYSIS — STRATEGY TOURNAMENT (throwaway, research only)
//   node tools/pt-an-strat.mjs /tmp/pt/main
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
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const M = (n) => {
  if (!Number.isFinite(n)) return "n/a";
  const s = n < 0 ? "-" : "", a = Math.abs(n);
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(0)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}k`;
  return `${s}$${a.toFixed(0)}`;
};

const byStrat = {}, bySeed = {};
for (const r of runs) {
  (byStrat[r.cfg.strategy] ??= []).push(r);
  (bySeed[r.cfg.citySeed] ??= []).push(r);
}
const STRATS = Object.keys(byStrat);
const START = runs[0]?.cfg.startCash ?? 5e6;

console.log(`\n=== STRATEGY TOURNAMENT ===`);
console.log(`runs=${runs.length}  strategies=${STRATS.length}  seeds=${Object.keys(bySeed).length}  horizon=${runs[0]?.cfg.months}m  start=${M(START)}  size=${runs[0]?.cfg.size}`);

// ---------------------------------------------------------------- headline
// REAL terminal wealth is the only honest scale: median CPI over a century is
// ~14x, so a nominal number is mostly a measure of inflation.
console.log(`\n--- TERMINAL WEALTH, REAL (CPI-deflated, ${M(START)} start) ---`);
console.log(`  strategy        n   died   p10       p25       MEDIAN    p75       p90       mean      real CAGR(med)`);
const summary = [];
for (const s of STRATS) {
  const set = byStrat[s];
  const real = set.map((r) => r.finalReal);
  const med = pct(real, .5);
  const yrs = (runs[0]?.cfg.months ?? 1200) / 12;
  const cagr = med > 0 ? (Math.pow(med / START, 1 / yrs) - 1) * 100 : NaN;
  const died = set.filter((r) => r.died).length;
  summary.push({ s, set, real, med, cagr, died });
  console.log(`  ${s.padEnd(14)} ${String(set.length).padStart(2)}  ${String(died).padStart(2)}/${set.length}  ` +
    [.1, .25, .5, .75, .9].map((p) => M(pct(real, p)).padStart(8)).join("  ") + `  ${M(mean(real)).padStart(8)}  ${Number.isFinite(cagr) ? cagr.toFixed(2) + "%" : "n/a"}`);
}

// ---------------------------------------------------------------- risk
console.log(`\n--- RISK ---`);
// Drawdown is capped at 100% for reporting. An uncapped figure reads "802%",
// which is not a drawdown — it is net worth having gone through zero into a
// large negative, and that deserves its own column rather than a number that
// looks like a percentage and is not one.
console.log(`  strategy        bankrupt%  medDD  p90DD  wentNegative%  medDeathYr  survivorMedian(real)`);
for (const { s, set } of summary) {
  const dd = set.map((r) => Math.min(1, r.maxDD));
  const neg = set.filter((r) => r.maxDD > 1).length;
  const deaths = set.filter((r) => r.died).map((r) => 2000 + Math.floor(r.diedM / 12));
  const surv = set.filter((r) => !r.died).map((r) => r.finalReal);
  console.log(`  ${s.padEnd(14)} ${(100 * set.filter((r) => r.died).length / set.length).toFixed(0).padStart(6)}%  ` +
    `${(100 * pct(dd, .5)).toFixed(0).padStart(4)}%  ${(100 * pct(dd, .9)).toFixed(0).padStart(4)}%  ` +
    `${(100 * neg / set.length).toFixed(0).padStart(11)}%  ` +
    `${(deaths.length ? String(pct(deaths, .5)) : "-").padStart(10)}    ${M(pct(surv, .5)).padStart(8)}`);
}

// ---- THE DEATH SPIRAL, measured rather than anecdoted.
// A dead run does not end when it runs out of money; the creditors seize one
// asset every few months while the deficit keeps compounding. This asks how
// long that endgame lasts and how far underwater it gets, because from the
// player's chair it is an unwinnable stretch they still have to sit through.
console.log(`\n--- ENDGAME LENGTH (runs that died) ---`);
console.log(`  strategy        n   yrs cash<0 before death (p50/p90)   final NW at death   peak NW before it`);
for (const { s, set } of summary) {
  const dead = set.filter((r) => r.died);
  if (!dead.length) { console.log(`  ${s.padEnd(14)}  0   -`); continue; }
  const spans = [], finals = [], peaks = [];
  for (const r of dead) {
    const firstNeg = r.annual.find((a) => a.cash < 0);
    if (firstNeg) spans.push(2000 + Math.floor(r.diedM / 12) - firstNeg.y);
    finals.push(r.annual.length ? r.annual[r.annual.length - 1].nw : NaN);
    peaks.push(r.peakNW);
  }
  console.log(`  ${s.padEnd(14)} ${String(dead.length).padStart(2)}   ${String(pct(spans, .5) ?? "-").padStart(5)} / ${String(pct(spans, .9) ?? "-").padStart(3)} yrs` +
    `                ${M(pct(finals, .5)).padStart(10)}        ${M(pct(peaks, .5)).padStart(8)}`);
}

// risk-adjusted: median divided by the downside you must accept to get it.
console.log(`\n--- RISK-ADJUSTED (a strategy that 10x's sometimes and dies usually is not "best") ---`);
console.log(`  strategy        median/start  p10/start   worst run    ratio med:p10   survival-weighted median`);
for (const { s, set, real, med } of summary) {
  const p10 = pct(real, .1);
  const worst = Math.min(...real);
  const swm = med * (set.filter((r) => !r.died).length / set.length);
  console.log(`  ${s.padEnd(14)} ${(med / START).toFixed(1).padStart(10)}x  ${(p10 / START).toFixed(2).padStart(8)}x  ${M(worst).padStart(9)}  ` +
    `${(p10 > 0 ? (med / p10).toFixed(1) : "inf").padStart(12)}   ${M(swm).padStart(10)}`);
}

// ---------------------------------------------------- skill vs luck (ANOVA)
// Two-way decomposition of log real wealth: how much of the spread is the
// strategy you chose, and how much is the city you were dealt? Bankrupt runs
// are floored rather than dropped — dropping them would decompose the variance
// of the survivors only, which is the survivorship artefact CLAUDE.md warns of.
console.log(`\n--- SKILL vs LUCK (two-way ANOVA on log10 real terminal wealth) ---`);
{
  const FLOOR = START * 0.01;
  const cell = {}; const seeds = Object.keys(bySeed);
  const vals = [];
  for (const r of runs) {
    const v = Math.log10(Math.max(FLOOR, r.finalReal));
    cell[`${r.cfg.strategy}|${r.cfg.citySeed}`] = v;
    vals.push(v);
  }
  const grand = mean(vals);
  const sMeans = {}, dMeans = {};
  for (const s of STRATS) sMeans[s] = mean(byStrat[s].map((r) => Math.log10(Math.max(FLOOR, r.finalReal))));
  for (const d of seeds) dMeans[d] = mean(bySeed[d].map((r) => Math.log10(Math.max(FLOOR, r.finalReal))));
  let ssStrat = 0, ssSeed = 0, ssTot = 0;
  for (const s of STRATS) ssStrat += byStrat[s].length * (sMeans[s] - grand) ** 2;
  for (const d of seeds) ssSeed += bySeed[d].length * (dMeans[d] - grand) ** 2;
  for (const v of vals) ssTot += (v - grand) ** 2;
  const ssRes = ssTot - ssStrat - ssSeed;
  console.log(`  total variance explained by STRATEGY (skill): ${(100 * ssStrat / ssTot).toFixed(1)}%`);
  console.log(`  total variance explained by CITY SEED (luck): ${(100 * ssSeed / ssTot).toFixed(1)}%`);
  console.log(`  interaction + within (right strategy for THAT city): ${(100 * ssRes / ssTot).toFixed(1)}%`);
  console.log(`  (n=${runs.length} cells, ${STRATS.length} strategies x ${seeds.length} seeds, bankrupt floored at ${M(FLOOR)})`);
}

// ---------------------------------------------------- per-seed winners
console.log(`\n--- WHO WON EACH CITY (real terminal wealth) ---`);
const wins = {};
for (const d of Object.keys(bySeed).sort((a, b) => a - b)) {
  const set = bySeed[d].slice().sort((a, b) => b.finalReal - a.finalReal);
  wins[set[0].cfg.strategy] = (wins[set[0].cfg.strategy] ?? 0) + 1;
  console.log(`  seed ${d} ${String(set[0].cfg.cityName).padEnd(18)} winner ${set[0].cfg.strategy.padEnd(14)} ${M(set[0].finalReal).padStart(8)}   runner-up ${set[1]?.cfg.strategy.padEnd(14)} ${M(set[1]?.finalReal).padStart(8)}`);
}
console.log(`\n  WIN COUNT: ` + Object.entries(wins).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join("  "));

// ---------------------------------------------------- dominance check
console.log(`\n--- DOMINANCE (CLAUDE.md treats a trivialising strategy as a defect to report) ---`);
{
  const meds = summary.map((x) => ({ s: x.s, m: x.med })).sort((a, b) => b.m - a.m);
  const best = meds[0], second = meds[1];
  console.log(`  best median ${best.s} ${M(best.m)} vs 2nd ${second.s} ${M(second.m)}  =>  ${(best.m / Math.max(1, second.m)).toFixed(2)}x`);
  // How often does the top strategy actually top the table? A real dominant
  // strategy wins nearly every city, not just the median.
  let topWins = 0;
  for (const d of Object.keys(bySeed)) {
    const set = bySeed[d].slice().sort((a, b) => b.finalReal - a.finalReal);
    if (set[0].cfg.strategy === best.s) topWins++;
  }
  console.log(`  ${best.s} wins ${topWins}/${Object.keys(bySeed).length} individual cities`);
}

// ---------------------------------------------------- activity + friction
console.log(`\n--- ACTIVITY (medians) ---`);
console.log(`  strategy        bought  sold  built  leases  refis  refiFail  balloonInBad/total  idleMo  nothingToDoMo`);
for (const { s, set } of summary) {
  const g = (f) => pct(set.map(f), .5);
  console.log(`  ${s.padEnd(14)} ${String(g((r) => r.st.bought)).padStart(6)}  ${String(g((r) => r.st.sold)).padStart(4)}  ` +
    `${String(g((r) => r.st.builtN)).padStart(5)}  ${String(g((r) => r.st.leases)).padStart(6)}  ${String(g((r) => r.st.refis)).padStart(5)}  ` +
    `${String(g((r) => r.st.refiAllQuotesFailed)).padStart(8)}  ${String(g((r) => r.st.balloonInBad)).padStart(8)}/${String(g((r) => r.st.balloonTotal)).padStart(5)}  ` +
    `${String(g((r) => r.idleMonths)).padStart(6)}  ${String(g((r) => r.nothingToDoMonths)).padStart(8)}`);
}

console.log(`\n--- FRICTION: the obvious move that failed (pooled over all ${runs.length} runs) ---`);
const errAgg = new Map();
const errRuns = new Map();
for (const r of runs) {
  const seen = new Set();
  for (const { k, v } of r.errs) {
    errAgg.set(k, (errAgg.get(k) ?? 0) + v);
    if (!seen.has(k)) { errRuns.set(k, (errRuns.get(k) ?? 0) + 1); seen.add(k); }
  }
}
const attAgg = new Map();
for (const r of runs) for (const { k, v } of r.attempts) attAgg.set(k, (attAgg.get(k) ?? 0) + v);
console.log(`  count   runs  rate    message`);
for (const [k, v] of [...errAgg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 22)) {
  const fn = k.split(" :: ")[0];
  const att = attAgg.get(fn) ?? 0;
  console.log(`  ${String(v).padStart(6)}  ${String(errRuns.get(k)).padStart(4)}  ${att ? (100 * v / att).toFixed(0) + "%" : "-"}`.padEnd(24) + k);
}

console.log(`\n--- CALL SUCCESS RATES ---`);
for (const [fn, att] of [...attAgg.entries()].sort((a, b) => b[1] - a[1])) {
  let fails = 0;
  for (const [k, v] of errAgg) if (k.startsWith(fn + " :: ")) fails += v;
  if (att < 200) continue;
  console.log(`  ${fn.padEnd(26)} ${String(att).padStart(7)} attempts  ${(100 * (1 - fails / att)).toFixed(1)}% succeeded`);
}
