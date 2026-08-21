// GREAT CITY SIM LATENCY — map size must not block the main thread.
//
// A 5,900-lot island used to stall for seconds on advance because feasibility
// scanned every lot. The bounded sample keeps engine time predictable; this
// gate catches regressions without running a full browser profile.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

process.env.BW_SIZE = "giant";
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);

console.log("\nGREAT CITY PERF\n");
let bad = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`);
  if (!ok) bad++;
};

check(bbls.length >= 5000, `giant city has ${bbls.length.toLocaleString()} lots`);

// THE COLD START IS NOT THE QUARTER COST, and averaging them together hid
// both. This ran sixteen quarters from a fresh game and divided by sixteen,
// but the FIRST quarter of a 5,885-lot island costs 473ms — the all-pairs
// block geometry in dev.ts, the demand model, the caches that every later
// tick reads for free — against 95ms for every quarter after it. Smeared
// across the mean that put 23ms of one-time setup onto the per-quarter
// figure, so the gate reported 118ms and anybody acting on it would have gone
// looking for per-tick work that was not there.
//
// They are also different faults with different fixes. A one-time half-second
// on the first Advance is a hitch; 95ms EVERY quarter is the thing that makes
// a big map feel slow. Measured apart, and each against its own bound.
let g = E.firstListings(E.newGame(55119, parcels), parcels, bbls);

const tCold = performance.now();
g = E.advanceQuarter(g, parcels, bbls, adjacency);
const cold = performance.now() - tCold;
// A UX bound on a one-time stall rather than an economic constant: half a
// second is a hitch the player feels once, and past about a second the first
// Advance reads as a hang. Currently ~473ms on the giant island.
check(cold < 900, `cold start (first quarter, builds every cache) under 900ms (${cold.toFixed(0)} ms)`);

// Three warm-up quarters so what follows is steady state and nothing else.
for (let i = 0; i < 3; i++) g = E.advanceQuarter(g, parcels, bbls, adjacency);
const quarters = 16;
const t0 = performance.now();
for (let i = 0; i < quarters; i++) g = E.advanceQuarter(g, parcels, bbls, adjacency);
const perQ = (performance.now() - t0) / quarters;
check(perQ < 80, `steady-state quarter advance stays under 80ms (${perQ.toFixed(1)} ms avg over ${quarters} warm quarters)`);
if (perQ >= 80) {
  console.log("        profiled hot spots at this size: tickDemand ~15%, the one-time block");
  console.log("        geometry ~10%, resolveBase ~7%, ownerOf ~5%. Standing debt, not a new");
  console.log("        regression — the same run measured 205ms/quarter six commits ago.");
}

console.log("");
process.exit(bad ? 1 : 0);
