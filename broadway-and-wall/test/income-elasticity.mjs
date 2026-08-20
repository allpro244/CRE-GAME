// THE INCOME EFFECT — does a richer city demand more space?
//
//   node test/income-elasticity.mjs            4 seeds x 100 years, ~5 min
//   SEEDS=1,2,3 YRS=50 node test/income-elasticity.mjs
//
// WHY THIS FILE EXISTS. Space demand in this engine is
//
//   targetRaw = baseStock * (1-natVac) * employIdx^elastic * (1+11*sectorMom)
//               * affordEff * swanLvl
//
// and income appears in exactly one of those terms: `affordEff`, and there only
// as a RELATIVE PRICE (burden = rent/wage) clamped to AFFORD_BAND [0.76, 1.12].
// Measured with tools/rails.mjs, that clamp sits at its CEILING in 70-95% of
// calls and at its floor in 0.0% — so the one channel by which a city getting
// richer can demand more space is a rail, pinned open, essentially always.
//
// The consequence compounds and only shows up in long saves, which is why this
// harness runs a CENTURY by default. Measured on tip 3c9b497, 4 seeds x 100y:
// real office rent -0.35%/yr against real wages +1.34%/yr, so rent-to-income
// falls 1.7%/yr forever — 0.55 at fifty years, 0.16 at a hundred. Space becomes
// structurally, permanently almost free relative to what the city earns, and
// nothing in the model can stop it.
//
// WHAT THE RECORD SAYS — AND THE FIRST VERSION OF THIS FILE GOT IT WRONG.
//
// This harness originally asserted that RENT PER SQUARE FOOT divided by wages
// should be trendless. No realistic economy can pass that clause, which makes
// it the same kind of fake as a test that cannot fail. Devaney (2010), "Trends
// in office rents in the City of London: 1867-1959", Explorations in Economic
// History 47(2):198-212, is a repeat-measures index over NINETY-THREE YEARS
// and finds NO real growth in office rents over the period as a whole. So real
// rent per square foot is trendless — and if real wages grow at all, rent per
// square foot over wages must therefore FALL, by arithmetic, forever.
// Demanding otherwise asks the model to beat the record.
//
// THE QUANTITY THAT IS ACTUALLY BOUNDED is occupancy cost per WORKER against
// pay — what a tenant writes a cheque for, relative to what it earns:
//
//     payroll share  =  (real rent per sf  x  sf per worker) / real wage
//
// Rent per sf can be flat while rent per worker falls, because sf per worker
// falls: that is what densification MEANS, and it is why the two look like a
// contradiction and are not. The LEVEL anchor is JLL's 3-30-300 rule of thumb
// ($3 utilities / $30 rent / $300 payroll per sf per year — office rent near a
// tenth of payroll); cite it for the level only, as it is a 2010s heuristic
// rather than a historical series. The TREND anchor is Brookfield (Feb 2024),
// which puts occupancy cost as a share of corporate revenue as effectively
// halved over three decades; read against payroll instead of revenue — pay per
// worker grew far more slowly than revenue per worker — that is a fall of
// roughly 30-40% over thirty years, about -1.2 to -1.7%/yr.
//
// So the band below is NOT "trendless". It is "may decline at the pace the
// record shows a densification era declining, and may not collapse" — because
// what the model must not do is extrapolate one thirty-year era across a
// century as though it were a law.
//
// So the quantity this file measures is the PHYSICAL one: square feet of
// demand per job (commercial) and per resident (housing). A model with no
// income effect holds those flat except for its secular menu. A real city's
// rise with income.
//
// This is a REPORT, not a gate — see CLAUDE.md on the lettered tests.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const SEEDS = (process.env.SEEDS ?? "4242,550991,12007,91117").split(",").map(Number);
const YRS = Number(process.env.YRS ?? 100);
const K = ["office", "retail", "multifamily", "industrial"];

let bad = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`); if (!ok) bad++; };
const med = (a) => { const s = [...a].filter(Number.isFinite).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const cagr = (v1, v0, y) => (v0 > 0 && v1 > 0 ? Math.pow(v1 / v0, 1 / y) - 1 : NaN);
const pc = (x, d = 2) => `${(100 * x).toFixed(d)}%`;

const rows = [];
for (let si = 0; si < SEEDS.length; si++) {
  const { parcels: P0, adjacency, bbls } = loadCity(si, E.normalizeParcels);
  const parcels = JSON.parse(JSON.stringify(P0));
  let g = E.firstListings(E.newGame(SEEDS[si], parcels), parcels, bbls);
  const T = [];
  for (let m = 0; m < YRS * 12; m++) {
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    const e = g.econ;
    T.push({
      cpi: e.cpi ?? 1, wage: e.wageIdx ?? 1, jobs: e.jobs ?? 1, pop: e.population ?? 1,
      rent: Object.fromEntries(K.map((k) => [k, e.rentIdx[k]])),
      pool: Object.fromEntries(K.map((k) => [k, e.pool?.[k] ?? 0])),
      occ: Object.fromEntries(K.map((k) => [k, e.occupied?.[k] ?? 0])),
      afford: Object.fromEntries(K.map((k) => [k, e.affordEff?.[k] ?? 1])),
    });
    g = E.advanceMonth(g, parcels, bbls, adjacency);
  }
  const a = T[0], z = T[T.length - 1];
  const r = { seed: SEEDS[si] };
  r.wageReal = cagr(z.wage / z.cpi, a.wage / a.cpi, YRS);
  // Reported for continuity: real rent per sf against real pay. The record says
  // this SHOULD fall when wages grow (see the header) — it is not a clause.
  const rti = T.map((t) => (t.rent.office / E.RENT_BASE.office) / Math.max(0.35, t.wage));
  r.rtiStart = med(rti.slice(0, 60)); r.rtiEnd = med(rti.slice(-60));
  r.rtiTrend = cagr(r.rtiEnd, r.rtiStart, YRS);
  // THE CLAUSE QUANTITY: occupancy cost per worker as a share of pay, indexed
  // to 1.0 at the opening. rent/sf x sf/worker / wage — cpi cancels between
  // rent and wage, so this is a pure quantity ratio.
  const payShare = T.map((t) => {
    const sfPerJob = (t.pool.office ?? 0) / Math.max(1, t.jobs);
    return ((t.rent.office / E.RENT_BASE.office) * sfPerJob) / Math.max(0.35, t.wage);
  });
  const ps0 = med(payShare.slice(0, 60));
  r.payShareEnd = med(payShare.slice(-60)) / Math.max(1e-9, ps0);
  r.payShareTrend = cagr(r.payShareEnd, 1, YRS);
  // THE PHYSICAL QUANTITY: square feet of demand per job / per resident.
  for (const k of K) {
    const per = T.map((t) => t.pool[k] / Math.max(1, k === "multifamily" ? t.pop : t.jobs));
    r[`sfPer.${k}`] = cagr(med(per.slice(-60)), med(per.slice(0, 60)), YRS);
    r[`rentReal.${k}`] = cagr(z.rent[k] / z.cpi, a.rent[k] / a.cpi, YRS);
    // The affordability multiplier: is it resting on the ceiling?
    r[`affordCeil.${k}`] = T.filter((t) => t.afford[k] >= 1.1199).length / T.length;
    r[`affordMed.${k}`] = med(T.map((t) => t.afford[k]));
  }
  rows.push(r);
  console.log(`  seed ${String(r.seed).padEnd(7)} realWage ${pc(r.wageReal)}/yr  realRent(off) ${pc(r["rentReal.office"])}/yr  `
    + `RTI ${r.rtiStart.toFixed(2)}→${r.rtiEnd.toFixed(2)} (${pc(r.rtiTrend)}/yr)  `
    + `sf/job off ${pc(r["sfPer.office"])}  sf/person mf ${pc(r["sfPer.multifamily"])}  affordCeil(off) ${pc(r["affordCeil.office"], 0)}`);
}

console.log(`\nTHE INCOME EFFECT — ${SEEDS.length} seeds x ${YRS} years, no player\n`);
const M = (k) => med(rows.map((r) => r[k]));

console.log("  the physical quantity — demand per worker (per resident for housing), CAGR");
for (const k of K) console.log(`    ${k.padEnd(13)} ${pc(M(`sfPer.${k}`)).padStart(8)}/yr     real rent/sf ${pc(M(`rentReal.${k}`)).padStart(8)}/yr`);
console.log("\n  the affordability multiplier — the one channel income has");
for (const k of K) console.log(`    ${k.padEnd(13)} median ${M(`affordMed.${k}`).toFixed(3)}   resting on its 1.12 ceiling ${pc(M(`affordCeil.${k}`), 0)} of months`);
console.log(`\n  real wage growth        ${pc(M("wageReal"))}/yr`);
console.log(`  rent per sf / pay       ${M("rtiStart").toFixed(2)} → ${M("rtiEnd").toFixed(2)}   drift ${pc(M("rtiTrend"))}/yr   (reported; the record says this falls)`);
console.log(`  OCCUPANCY COST PER WORKER as a share of pay, indexed 1.0 at the opening`);
console.log(`                          1.00 → ${M("payShareEnd").toFixed(2)}   drift ${pc(M("payShareTrend"))}/yr`);
console.log("");

// ---- the clauses -----------------------------------------------------------
// A century is long enough that a drift of even half a point a year is a
// factor of 1.6. Real rent-to-income series are trendless over the long run
// (US median rent / median income has no century trend); the band is that
// fact with room for one city's weather.
// The observed FAST era is -1.2 to -1.7%/yr sustained for three decades
// (Brookfield, read against payroll). A century is not one era — it contains
// densifying and space-EXPANDING stretches, the latter well attested: central
// air conditioning enlarged floor area per worker through the 1960s-70s. A
// century-long average at or beyond the fastest observed thirty-year era means
// the model has turned an era into a law. -1.0%/yr is that test, and it is
// deliberately more permissive than the record's own fast trend.
check(M("payShareTrend") >= -0.010,
  `occupancy cost per worker, share of pay: ${pc(M("payShareTrend"))}/yr (need >= -1.00%/yr — the fastest densification era on record is -1.2 to -1.7%/yr over THREE DECADES; a century at that pace is an era mistaken for a law)`);
check(M("payShareEnd") >= 0.30,
  `occupancy cost per worker ends at ${M("payShareEnd").toFixed(2)} of its opening share of pay (need >= 0.30 — office rent runs near a tenth of payroll on JLL's 3-30-300; a two-thirds collapse in that share is space becoming free)`);
// Housing floor space per person rose ~1%/yr in the US over 70 years. A model
// with no income effect holds it flat; the claim is only that it is not
// NEGATIVE while the city gets richer.
check(M("sfPer.multifamily") >= -0.001,
  `housing demand per resident ${pc(M("sfPer.multifamily"))}/yr (need >= -0.10%/yr — floor space per person rose with income everywhere it has been measured)`);
// Office densification is real and should show as a FALL. What is not real is
// a fall so large it is the only secular force in the model.
check(M("sfPer.office") >= -0.015,
  `office demand per job ${pc(M("sfPer.office"))}/yr (need >= -1.50%/yr — densification is real; -2.5%/yr sustained for a century is not)`);
check(M("affordCeil.office") <= 0.50,
  `affordability multiplier rests on its ceiling ${pc(M("affordCeil.office"), 0)} of months (need <= 50% — a rail that binds most of the run is the model, not a guard)`);

console.log(bad ? `\n${bad} check(s) failed` : "\nAll income-effect checks passed");
console.log("A REPORT, NOT A GATE — a band is a calibration, see CLAUDE.md.");
