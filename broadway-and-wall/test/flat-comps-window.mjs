// THE FLATS' EFFECTIVE RENT IS READ OFF SIX MONTHS OF LETTINGS, NOT ONE.
//
//   pnpm engine && node test/flat-comps-window.mjs
//
// The comps list was also cut to its last 400 lettings, about one month of a
// town's flats, so the effective index every builder underwrites a block at
// swung 15-20% with whichever blocks let that month, and the land option
// magnified that into lots repricing 40% a month. The list is now kept as a
// month's sum per kind, the whole six months of it.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { makeCity } = await import(join(HERE, "..", "src", "citygen", "index.mjs"));

let bad = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "OK  " : "FAIL"}  ${msg}`); if (!cond) bad++; };
console.log("\nTHE FLATS' COMPS, SIX MONTHS OF THEM\n");

const SEED = 99;
const parcels = E.normalizeParcels(makeCity("somewhere", SEED, { size: "city" }).parcels);
const bbls = Object.keys(parcels);
let g = E.firstListings(E.newGame(SEED, parcels, 2_500_000, undefined, { citySize: "city", cityLots: bbls.length }), parcels, bbls);
const eff = [];
for (let m = 0; m < 30; m++) {
  g = E.advanceQuarter(g, parcels, bbls);
  if (m >= 12) eff.push(g.econ.effRentIdx.multifamily);
}
const list = g.econ.deals?.multifamily ?? [];
const months = new Set(list.map((d) => d.m));
const lettings = list.reduce((a, d) => a + (d.n ?? 1), 0);
ok(months.size >= 6, `the comps hold ${months.size} months of lettings (${lettings} lettings in ${list.length} rows)`);
ok(list.every((d) => d.m > g.month - 7), "nothing older than six months is kept");
let worst = 0;
for (let i = 1; i < eff.length; i++) worst = Math.max(worst, Math.abs(Math.log(eff[i] / eff[i - 1])));
ok(worst < Math.log(1.08), `the flats' effective index moves less than 8% in any month of years 2-3 (largest ${(100 * (Math.exp(worst) - 1)).toFixed(1)}%)`);
console.log(bad ? `\nflat-comps-window: ${bad} FAILED\n` : "\nflat-comps-window: ok\n");
process.exit(bad ? 1 : 0);
