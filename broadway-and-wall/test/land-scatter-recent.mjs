// THE LAND LEVEL WEIGHS A PRINT BY HOW FAR TODAY'S PRINTS STRAY.
//
//   pnpm engine && node test/land-scatter-recent.mjs
//
// The land index judged how far one print strays by the scatter of every
// year it had kept (up to forty), and a town's dirt scatters far more once a
// few lots ripen for towers: late indications ranging x1,000 were each taken
// for a precise reading, and the level chased them (seed 31337: 4.81 -> 0.95
// in five years). It now reads the scatter off the evidence on the tape.
// Here: a tape most of which strays x30 either way, as the survey does late
// in a town. The scatter the index weighs a print by follows it; the opening
// years' scatter does not, and a run of high sales then barely moves the level.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { makeCity } = await import(join(HERE, "..", "src", "citygen", "index.mjs"));

let bad = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "OK  " : "FAIL"}  ${msg}`); if (!cond) bad++; };
console.log("\nTHE LAND LEVEL, AGAINST TODAY'S SCATTER\n");

const SEED = 99;
const parcels = E.normalizeParcels(makeCity("somewhere", SEED, { size: "city" }).parcels);
const bbls = Object.keys(parcels);
let g = E.firstListings(E.newGame(SEED, parcels, 2_500_000, undefined, { citySize: "city", cityLots: bbls.length }), parcels, bbls);
for (let m = 0; m < 24; m++) g = E.advanceQuarter(g, parcels, bbls);
// vacant urban lots: every one a land sale prints a level from (propmarket.ts urbanLot)
const lots = bbls.map((b) => E.resolveRec(parcels, g, b))
  .filter((r) => r && r.class === "land" && r.lotArea > 0 && !r.ag && !r.homeLot && !r.tract);
ok(lots.length >= 8, `${lots.length} vacant urban lots to print on`);
const sell = (rec, k) => E.printLandTrade(g, rec, E.landRead(rec, g.econ).texture * rec.lotArea * k, "test", 1);
ok(typeof E.landPrintScatter === "function", "the land index exposes the scatter it weighs a print by");
if (typeof E.landPrintScatter === "function") {
  const sd0 = Math.sqrt(E.landPrintScatter(g));
  // sales straying x30 each way about the level, most of the tape, as the survey is late in a town
  for (let i = 0; i < 200; i++) sell(lots[i % lots.length], i % 2 ? 30 : 1 / 30);
  const sd1 = Math.sqrt(E.landPrintScatter(g));
  console.log(`     a print's scatter (log sd per unit weight): ${sd0.toFixed(2)} on the opening tape, ${sd1.toFixed(2)} after 200 sales at x30 and x1/30 (most of the tape) (log 30 = ${Math.log(30).toFixed(2)})`);
  ok(sd1 > 2 * sd0, "the scatter follows the evidence on the tape, not the opening years");
  ok(sd1 > 0.5 * Math.log(30), "a tape of sales straying x30 is read as straying about that far");
  const before = g.econ.landIdx;
  for (let i = 0; i < 6; i++) sell(lots[(i + 3) % lots.length], 30);
  E.tickLandRead(g);
  ok(g.econ.landIdx / before < 1.5, `six more sales at x30 among them lift the level by less than half (x${(g.econ.landIdx / before).toFixed(2)})`);
}
console.log(bad ? `\nland-scatter-recent: ${bad} FAILED\n` : "\nland-scatter-recent: ok\n");
process.exit(bad ? 1 : 0);
