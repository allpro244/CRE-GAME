// A LOT'S PLACE IN THE BUILD QUEUE IS ITS RANK, NOT LAST JANUARY'S DOLLARS.
//
//   pnpm engine && node test/land-queue-monthly.mjs
//
// The queue's ranking was measured once a year and every lot was placed in it
// by setting its residual THIS month against the dollar residuals the panel's
// sites had last January. A market move that lifts or sinks every residual
// together then slid every lot years up or down a queue whose order had not
// changed, and January slid it back. The queue is now re-measured monthly.
// Here: between two mid-year months the queue's cutoffs must follow the
// residuals (re-measured), not sit at January's dollars with only the take-up
// refreshed. Over a stretch with no January in it they must move.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { makeCity } = await import(join(HERE, "..", "src", "citygen", "index.mjs"));

let bad = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "OK  " : "FAIL"}  ${msg}`); if (!cond) bad++; };
console.log("\nTHE BUILD QUEUE, RE-MEASURED EVERY MONTH\n");

const SEED = 99;
const parcels = E.normalizeParcels(makeCity("somewhere", SEED, { size: "city" }).parcels);
const bbls = Object.keys(parcels);
let g = E.firstListings(E.newGame(SEED, parcels, 2_500_000, undefined, { citySize: "city", cityLots: bbls.length }), parcels, bbls);
for (let m = 0; m < 25; m++) g = E.advanceQuarter(g, parcels, bbls);
ok(g.econ.landQueuePrev === undefined, "no year-old measurement is kept to glide from");
const sig = (e) => JSON.stringify(["office", "retail", "multifamily", "industrial"].map((u) => e.landQueue?.[u]?.psf ?? []));
let moved = 0, steps = 0, sites = 0;
for (let m = 0; m < 10; m++) {
  const before = sig(g.econ);
  g = E.advanceQuarter(g, parcels, bbls);
  if (g.month % 12 === 0) continue;   // a January re-measured on either rule
  steps++; if (sig(g.econ) !== before) moved++;
  sites = Math.max(sites, JSON.parse(sig(g.econ)).flat().length);
}
ok(sites > 0, `the town has sampled sites in a queue (${sites})`);
ok(moved >= steps - 1, `the queue's cutoffs moved in ${moved} of ${steps} mid-year months (never, when measured yearly)`);
console.log(bad ? `\nland-queue-monthly: ${bad} FAILED\n` : "\nland-queue-monthly: ok\n");
process.exit(bad ? 1 : 0);
