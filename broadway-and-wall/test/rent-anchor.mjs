// RENT ANCHOR — ECONOMY.md §F #1 / #3 / soft-market escalator.
//
//   1. Shortage pressure must not be a constant tax while vacancy is pinned
//      on the frictional rail (gap cannot move).
//   3. tightEma must not mint a Manhattan premium from supply failure
//      (rail-bound with no unpinned availability signal).
//   Soft: asking must not compound with CPI/cycle while availability is soft
//      — real rents climb in firm markets, not on empty floors.
//
//   node test/rent-anchor.mjs
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const SEEDS = (process.env.SEEDS ?? "550991,12007,73303,11,22,7").split(",").map(Number);
const HZ = Number(process.env.HZ ?? 1200);
const fr = E.frictionFloor("office");
const nat = E.NATURAL_VAC.office;

let bad = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`);
  if (!ok) bad++;
};
const med = (a) => {
  const b = [...a].filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y);
  return b.length ? b[Math.floor((b.length - 1) / 2)] : NaN;
};

console.log("\nRENT ANCHOR — pinned shortage is not earned Manhattan scarcity\n");

const rows = [];
for (const seed of SEEDS) {
  const { parcels: P0, adjacency, bbls } = loadCity(0, E.normalizeParcels);
  const parcels = structuredClone(P0);
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  const r0 = g.econ.rentIdx.office;
  const c0 = g.econ.cpi;
  const w0 = g.econ.wageIdx || 1;
  let pin = 0, sumTE = 0, pinTE = 0, pinN = 0, maxTE = 0;
  let softN = 0, softNom = 0, softReal = 0;
  for (let m = 0; m < HZ; m++) {
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    const rBefore = g.econ.rentIdx.office;
    const cBefore = g.econ.cpi;
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    const avail = (g.econ.cityVac.office ?? 0)
      + (g.econ.sublet?.office ?? 0) / Math.max(1, g.econ.stock?.office ?? 1);
    const gap = avail - nat;
    const pinned = (g.econ.cityVac.office ?? 0) <= fr + 1e-6;
    const te = g.econ.tightEma ?? 0;
    sumTE += te;
    maxTE = Math.max(maxTE, te);
    if (pinned) {
      pin++;
      pinTE += te;
      pinN++;
    }
    // Soft-month growth: accumulate log returns while gap > 0 after the tick.
    if (gap > 0) {
      softN++;
      softNom += Math.log(g.econ.rentIdx.office / Math.max(1e-9, rBefore));
      softReal += Math.log((g.econ.rentIdx.office / g.econ.cpi) / Math.max(1e-9, rBefore / cBefore));
    }
  }
  const yrs = HZ / 12;
  const realC = Math.pow((g.econ.rentIdx.office / g.econ.cpi) / (r0 / c0), 1 / yrs) - 1;
  const wageC = Math.pow((g.econ.wageIdx || 1) / w0, 1 / yrs) - 1;
  const rentLessWage = (Math.pow(g.econ.rentIdx.office / r0, 1 / yrs) - 1) - wageC;
  const rti = (g.econ.rentIdx.office / E.RENT_BASE.office) / (g.econ.wageIdx || 1);
  // Annualize soft-month log returns (softN months → per-year rate).
  const softNomYr = softN > 24 ? Math.expm1(softNom * (12 / softN)) : 0;
  const softRealYr = softN > 24 ? Math.expm1(softReal * (12 / softN)) : 0;
  rows.push({
    seed, realC, rentLessWage, rti, pinPct: pin / HZ,
    avgTE: sumTE / HZ, avgTEpin: pinN ? pinTE / pinN : 0, maxTE,
    softPct: softN / HZ, softNomYr, softRealYr,
  });
  console.log(
    `  seed ${seed}: real ${(realC * 100).toFixed(2)}%/yr  rent−wage ${(rentLessWage * 100).toFixed(2)}pp  `
    + `RTI ${rti.toFixed(2)}x  TEpin ${(pinN ? pinTE / pinN : 0).toFixed(3)}  `
    + `maxTE ${maxTE.toFixed(3)}  pin ${(pin / HZ * 100).toFixed(0)}%  `
    + `soft ${(softN / HZ * 100).toFixed(0)}%  softReal ${(softRealYr * 100).toFixed(2)}%/yr`,
  );
}

const medReal = med(rows.map((r) => r.realC));
const medRlw = med(rows.map((r) => r.rentLessWage));
const medRti = med(rows.map((r) => r.rti));
const medTEpin = med(rows.map((r) => r.avgTEpin));
const medTE = med(rows.map((r) => r.avgTE));
const medMaxTE = med(rows.map((r) => r.maxTE));
const medSoftReal = med(rows.map((r) => r.softRealYr));
const medSoftNom = med(rows.map((r) => r.softNomYr));

// Before rail fix: avgTEpin sat ABOVE avgTE, maxTE ~0.53, RTI ~1.13x.
// Before soft-escalator mute: real office ~1.43%/yr with soft months still
// compounding nominally near CPI.
check(medTEpin <= medTE + 0.02,
  `tightEma while pinned (${medTEpin.toFixed(3)}) is not above overall avg (${medTE.toFixed(3)}) — no rail-minted premium`);
check(medMaxTE <= 0.35,
  `median max tightEma ${medMaxTE.toFixed(3)} (need ≤ 0.35 — was saturating near 0.55 on the rail)`);
check(medRti <= 1.15,
  `median rent-to-income ${medRti.toFixed(2)}x (need ≤ 1.15)`);
check(medRti >= 0.55,
  `median rent-to-income ${medRti.toFixed(2)}x (need ≥ 0.55 — soft mute must not death-spiral asking)`);
const minRti = Math.min(...rows.map((r) => r.rti));
check(minRti >= 0.40,
  `worst-seed rent-to-income ${minRti.toFixed(2)}x (need ≥ 0.40)`);
check(medRlw <= 0.0035,
  `median rent−wage ${(medRlw * 100).toFixed(2)}pp/yr (need ≤ 0.35)`);
// Long-run US CRE real rent is roughly flat to +1%/yr (CBRE/NCREIF).
// Pre-soft-mute medians sat ~1.43%/yr with soft months still compounding
// near CPI; post-fix ~1.2%/yr with soft real negative. Band allows a
// dense town to track real wages without reopening the soft escalator.
check(medReal >= -0.010 && medReal <= 0.0135,
  `median real office rent ${(medReal * 100).toFixed(2)}%/yr (need −1.0…+1.35)`);
check(medSoftReal <= 0.0015,
  `median REAL office rent while soft ${(medSoftReal * 100).toFixed(2)}%/yr (need ≤ +0.15 — empty floors do not earn real growth)`);
check(medSoftNom <= 0.008,
  `median NOMINAL office rent while soft ${(medSoftNom * 100).toFixed(2)}%/yr (need ≤ +0.80 — no full-CPI asking escalator on a soft sheet)`);

if (bad) {
  console.error(`\n${bad} check(s) failed\n`);
  process.exit(1);
}
console.log("\nAll rent-anchor checks passed.\n");
