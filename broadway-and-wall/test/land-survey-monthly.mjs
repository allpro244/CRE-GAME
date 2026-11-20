// THE LAND SURVEY IS READ ROUND THE YEAR, NOT IN ONE DAY.
//
//   pnpm engine && node test/land-survey-monthly.mjs
//
// The whole 24-lot panel was surveyed in one month a year, and the appraisers
// took the year's evidence in one step: over fifty years in four towns the
// land level stood exactly still in 72-82% of months and every lot in town
// repriced at once in the month after the survey, by as much as x2.17. The
// panel is now read two lots a month at the same weight.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { makeCity } = await import(join(HERE, "..", "src", "citygen", "index.mjs"));

let bad = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "OK  " : "FAIL"}  ${msg}`); if (!cond) bad++; };
console.log("\nTHE LAND SURVEY, ROUND THE YEAR\n");

const SEED = 99;
const parcels = E.normalizeParcels(makeCity("somewhere", SEED, { size: "city" }).parcels);
const bbls = Object.keys(parcels);
let g = E.firstListings(E.newGame(SEED, parcels, 2_500_000, undefined, { citySize: "city", cityLots: bbls.length }), parcels, bbls);
const idx = [g.econ.landIdx];
for (let m = 0; m < 36; m++) { g = E.advanceQuarter(g, parcels, bbls); idx.push(g.econ.landIdx); }
const surveyMonths = new Set((g.landTape ?? []).filter((p) => p.kind === "s" && p.m > g.month - 12).map((p) => p.m));
ok(surveyMonths.size >= 9, `the last year's survey indications arrived in ${surveyMonths.size} different months (one, before)`);
const perYear = (g.landTape ?? []).filter((p) => p.kind === "s" && p.m > g.month - 12).reduce((a, p) => a + p.w, 0);
ok(perYear > 0 && perYear <= 12 + 1e-9, `the year's survey evidence is no more than the panel's 24 lots at half weight (${perYear.toFixed(1)} of 12)`);
let worst = 0;
for (let i = 13; i < idx.length; i++) worst = Math.max(worst, Math.abs(Math.log(idx[i] / idx[i - 1])));
ok(worst < Math.log(1.25), `no month in years 2-3 moves the town's land level by a quarter (largest x${Math.exp(worst).toFixed(2)})`);
console.log(bad ? `\nland-survey-monthly: ${bad} FAILED\n` : "\nland-survey-monthly: ok\n");
process.exit(bad ? 1 : 0);
