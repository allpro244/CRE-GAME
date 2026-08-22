// WHERE DOES THIS CITY ACTUALLY SIT? — the distribution of availability, with
// no player and no shock.
//
// The glut harness surfaced this as a side effect and it may matter more than
// anything the glut itself showed. Its CONTROL arm — an ordinary city, nothing
// injected — sat at office vacancy 23.9%, 5.9%, 3.7%, 3.7%, 3.7% at month 36
// across five seeds, against a natural rate of 11.5%. Three of five welded to
// the frictional floor, one wildly overbuilt, none near natural. A control that
// is itself an extreme is not a counterfactual, and a third to a half of every
// "glut effect" measured against it is the control rising rather than the
// treatment falling.
//
// A real metro office market spends most of its life within a few points of its
// natural rate and visits the tails in cycles. If this one is bimodal — pinned
// or flooded — then the vacancy series is not a market, it is two states.
//
// WHAT IT FOUND, at the commit that added it (8 seeds x 60y):
//   office       median 6.8% against a natural 11.5%. On the frictional floor
//                27.6% of months, within 2pp of natural only 15.2%.
//   industrial   median 1.5% against 7.0%. On the floor 89.3% of months, near
//                natural 2.4%.
//   retail       median 8.4% against 8.5%, near natural 39.1% — this is what a
//                market looks like, and it is in the same engine.
//   multifamily  median 3.3% against 4.5%, near natural 48.5%.
// US office vacancy has been at or above 12% for most of forty years; national
// industrial ran 4-7% through the 2010s. A city that spends a quarter of its
// life at 3.7% office and nine tenths at 1.5% industrial is not visiting the
// tight tail, it is living in it.
//
// The mechanism, and why it is a rail rather than a rate: the frictional floor
// is imposed as a clamp on cityVac. A real frictional vacancy is a RESIDENCE
// TIME — space stands empty because leases end and re-letting takes months of
// marketing, negotiation and fit-out — so it falls out of the roll and the
// latency instead of being asserted underneath them. Imposed as a floor, it
// becomes the answer whenever demand outruns what the city can build, and the
// shortage escalator then runs off it.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels: P0, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const SEEDS = (process.env.SEEDS ?? "550991,12007,11,4242,91117,73303,22,33").split(",").map(Number);
const HZ = Number(process.env.YRS ?? 60) * 12;
const NAT = E.NATURAL_VAC;
// ONE FLOOR, THE ENGINE'S. This used to hardcode FLOOR_RATIO with industrial
// 0.32 and multifamily 0.22 — the swap of frictionFloor (industrial 0.22,
// multifamily 0.30). A watcher that mirrors the number it is watching is the
// third kind of fake. Read the function.
const FLOOR = Object.fromEntries(Object.keys(NAT).map((k) => [k, E.frictionFloor(k)]));
const q = (xs, p) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : NaN; };
const pct = (v) => (v * 100).toFixed(1) + "%";

const bag = { office: [], retail: [], multifamily: [], industrial: [] };
const avail = { office: [], retail: [], multifamily: [], industrial: [] };
for (const seed of SEEDS) {
  const parcels = JSON.parse(JSON.stringify(P0));
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  for (let m = 0; m < HZ; m++) {
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    if (m < 60) continue;                                  // let it settle
    const e = g.econ;
    for (const k of Object.keys(bag)) {
      bag[k].push(e.cityVac[k]);
      avail[k].push(e.cityVac[k] + (e.sublet?.[k] ?? 0) / Math.max(1, e.stock?.[k] ?? 1));
    }
  }
}
console.log(`WHERE THE CITY SITS — ${SEEDS.length} seeds x ${HZ / 12}y, no player, no shock, months 60+\n`);
console.log(`  class          natural   friction floor    p5      p25   MEDIAN     p75      p95`);
for (const k of Object.keys(bag)) {
  const fl = FLOOR[k];
  console.log(`  ${k.padEnd(13)} ${pct(NAT[k]).padStart(6)}   ${pct(fl).padStart(12)}`
    + `   ${pct(q(bag[k], .05)).padStart(6)}  ${pct(q(bag[k], .25)).padStart(6)}  ${pct(q(bag[k], .5)).padStart(6)}`
    + `  ${pct(q(bag[k], .75)).padStart(6)}  ${pct(q(bag[k], .95)).padStart(6)}`);
}
console.log(`\n  HOW OFTEN IS IT NEAR NATURAL, AND HOW OFTEN AT AN EXTREME`);
console.log(`  class          within 2pp of natural   on the friction floor (<0.5pp above)   more than 10pp over`);
for (const k of Object.keys(bag)) {
  const fl = FLOOR[k];
  const near = bag[k].filter((v) => Math.abs(v - NAT[k]) <= 0.02).length / bag[k].length;
  const pinned = bag[k].filter((v) => v <= fl + 0.005).length / bag[k].length;
  const flooded = bag[k].filter((v) => v - NAT[k] > 0.10).length / bag[k].length;
  console.log(`  ${k.padEnd(13)} ${pct(near).padStart(21)}   ${pct(pinned).padStart(36)}   ${pct(flooded).padStart(18)}`);
}
console.log(`\n  A metro office market spends most of its life within a few points of its natural`);
console.log(`  rate. If this one is mostly pinned or mostly flooded, the vacancy series is two`);
console.log(`  states rather than a market — and every counterfactual measured against it is`);
console.log(`  measured against an extreme.`);
console.log(`\n  Availability (direct vacancy + sublet), which is what the rent channel reads:`);
for (const k of Object.keys(avail)) {
  console.log(`  ${k.padEnd(13)} median ${pct(q(avail[k], .5)).padStart(6)}   p95 ${pct(q(avail[k], .95)).padStart(6)}`
    + `   gap over natural: median ${pct(q(avail[k], .5) - NAT[k]).padStart(6)}   p95 ${pct(q(avail[k], .95) - NAT[k]).padStart(6)}`);
}
