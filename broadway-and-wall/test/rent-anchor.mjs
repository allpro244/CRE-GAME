// RENT ANCHOR — ECONOMY.md §F #1 and #3.
//
//   1. Shortage pressure must not be a constant tax while vacancy is pinned
//      on the frictional rail (gap cannot move).
//   3. tightEma must not mint a Manhattan premium from supply failure
//      (rail-bound with no unpinned availability signal).
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
  let pinPressPos = 0, pinPressN = 0;
  for (let m = 0; m < HZ; m++) {
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    const pinned = (g.econ.cityVac.office ?? 0) <= fr + 1e-6;
    const te = g.econ.tightEma ?? 0;
    sumTE += te;
    maxTE = Math.max(maxTE, te);
    if (pinned) {
      pin++;
      pinTE += te;
      pinN++;
      pinPressN++;
      if ((g.econ.rentPress?.office ?? 0) > 0.002) pinPressPos++;
    }
  }
  const yrs = HZ / 12;
  const realC = Math.pow((g.econ.rentIdx.office / g.econ.cpi) / (r0 / c0), 1 / yrs) - 1;
  const wageC = Math.pow((g.econ.wageIdx || 1) / w0, 1 / yrs) - 1;
  const rentLessWage = (Math.pow(g.econ.rentIdx.office / r0, 1 / yrs) - 1) - wageC;
  const rti = (g.econ.rentIdx.office / E.RENT_BASE.office) / (g.econ.wageIdx || 1);
  rows.push({
    seed, realC, rentLessWage, rti, pinPct: pin / HZ,
    avgTE: sumTE / HZ, avgTEpin: pinN ? pinTE / pinN : 0, maxTE,
    pinPressHot: pinPressN ? pinPressPos / pinPressN : 0,
  });
  console.log(
    `  seed ${seed}: real ${(realC * 100).toFixed(2)}%/yr  rent−wage ${(rentLessWage * 100).toFixed(2)}pp  `
    + `RTI ${rti.toFixed(2)}x  TEpin ${(pinN ? pinTE / pinN : 0).toFixed(3)}  `
    + `maxTE ${maxTE.toFixed(3)}  pin ${(pin / HZ * 100).toFixed(0)}%`,
  );
}

const medReal = med(rows.map((r) => r.realC));
const medRlw = med(rows.map((r) => r.rentLessWage));
const medRti = med(rows.map((r) => r.rti));
const medTEpin = med(rows.map((r) => r.avgTEpin));
const medTE = med(rows.map((r) => r.avgTE));
const medMaxTE = med(rows.map((r) => r.maxTE));

// Before this fix: avgTEpin sat ABOVE avgTE (premium earned on the rail),
// maxTE reached ~0.53, RTI median ~1.13x, real office ~1.4%/yr.
check(medTEpin <= medTE + 0.02,
  `tightEma while pinned (${medTEpin.toFixed(3)}) is not above overall avg (${medTE.toFixed(3)}) — no rail-minted premium`);
check(medMaxTE <= 0.35,
  `median max tightEma ${medMaxTE.toFixed(3)} (need ≤ 0.35 — was saturating near 0.55 on the rail)`);
check(medRti <= 1.20,
  `median rent-to-income ${medRti.toFixed(2)}x (need ≤ 1.20)`);
check(medRlw <= 0.45,
  `median rent−wage ${ (medRlw * 100).toFixed(2)}pp/yr (need ≤ 0.45)`);
check(medReal >= -1.0 && medReal <= 1.65,
  `median real office rent ${(medReal * 100).toFixed(2)}%/yr (need −1.0…+1.65)`);

if (bad) {
  console.error(`\n${bad} check(s) failed\n`);
  process.exit(1);
}
console.log("\nAll rent-anchor checks passed.\n");
