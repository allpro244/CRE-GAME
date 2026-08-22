// VACANCY → RENT PATH. Instrument, then count the rail.
//
//   pnpm engine && pnpm vac-rent
//
// REPORT, not a gate. RENT_VACANCY_RESPONSE_PLAN.md: do not retune DEEP_RATE,
// glut(), FIT_MAX or CAP_VAC_BETA. The curve is honest. The suspects are the
// −0.008/mo clamp on rentPress and the 8-month EMA. This stamps vacTerm →
// EMA → clamp → drift every month and counts how often the rail binds, in
// BOTH nominal and real (wage) terms.
//
// STANDING FACT: no playtest in this repo is based on Manhattan. Every
// harness run and number here is a GENERATED city.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const YEARS = Number(process.env.YEARS ?? 15);
const SEEDS = (process.env.SEEDS ?? "1,7").split(",").map(Number);
const CLASSES = ["office", "retail", "multifamily", "industrial"];

const { parcels, bbls } = loadCity(0, E.normalizeParcels);

const natOf = (_g, k) => E.NATURAL_VAC[k];

const acc = {};
for (const k of CLASSES) {
  acc[k] = {
    months: 0, soft: 0, bindSoft: 0, bindAll: 0,
    nomSoft: [], realSoft: [],
    nomDeep: [], realDeep: [],
    risingSoft: 0,
    vacTermSoft: [], pressEmaSoft: [], pressClampedSoft: [],
  };
}

for (const seed of SEEDS) {
  let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
  const startWage = g.econ.wageIdx ?? 1;
  const startRent = Object.fromEntries(CLASSES.map((k) => [k, g.econ.rentIdx[k]]));
  let lastRent = { ...startRent };
  let lastWage = startWage;
  for (let m = 0; m < YEARS * 12; m++) {
    g = E.advanceMonth(g, parcels, bbls, {});
    const wage = g.econ.wageIdx ?? 1;
    for (const k of CLASSES) {
      const p = g.econ.rentPath?.[k];
      if (!p) continue;
      const a = acc[k];
      a.months++;
      const gap = p.gap;
      const soft = gap > 0.03;
      const deep = gap > 0.10;
      if (p.clampBound) a.bindAll++;
      if (soft) {
        a.soft++;
        if (p.clampBound) a.bindSoft++;
        a.nomSoft.push(p.nomCh);
        a.realSoft.push((1 + p.nomCh) / (wage / lastWage) - 1);
        a.vacTermSoft.push(p.vacTerm);
        a.pressEmaSoft.push(p.pressEma);
        a.pressClampedSoft.push(p.pressClamped);
        if (p.nomCh > 0) a.risingSoft++;
      }
      if (deep) {
        a.nomDeep.push(p.nomCh);
        a.realDeep.push((1 + p.nomCh) / (wage / lastWage) - 1);
      }
      lastRent[k] = g.econ.rentIdx[k];
    }
    lastWage = wage;
  }
  console.log(`seed ${seed}: ${YEARS}y  wage ${(g.econ.wageIdx ?? 1).toFixed(3)}`);
}

const mean = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
const yr = (mo) => ((1 + mo) ** 12 - 1) * 100;

console.log("\nVACANCY → RENT PATH  (generated city)\n");
console.log("class        soft-mo  rail%   nom%/yr  real%/yr  deep nom  rising%  vacTerm/mo  ema/mo  clamp/mo");
for (const k of CLASSES) {
  const a = acc[k];
  const rail = a.soft ? (a.bindSoft / a.soft) * 100 : 0;
  const rising = a.soft ? (a.risingSoft / a.soft) * 100 : 0;
  console.log(
    `${k.padEnd(12)} ${String(a.soft).padStart(7)}  ${rail.toFixed(0).padStart(5)}  `
    + `${yr(mean(a.nomSoft)).toFixed(2).padStart(7)}  ${yr(mean(a.realSoft)).toFixed(2).padStart(8)}  `
    + `${yr(mean(a.nomDeep)).toFixed(2).padStart(8)}  ${rising.toFixed(0).padStart(6)}  `
    + `${(mean(a.vacTermSoft) * 100).toFixed(3).padStart(10)}  ${(mean(a.pressEmaSoft) * 100).toFixed(3).padStart(6)}  `
    + `${(mean(a.pressClampedSoft) * 100).toFixed(3).padStart(8)}`,
  );
}
console.log("\nrail% is the share of soft months (gap > +3pp) in which rentPress sat on ±0.008.");
console.log("A clamp that binds in a glut is load-bearing — CLAUDE.md, fake number five.\n");
