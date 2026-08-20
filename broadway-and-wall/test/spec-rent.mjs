// BUILD QUALITY MOVES RENT, AND COST STILL MOVES MORE.
//
//   pnpm engine && node test/spec-rent.mjs
//
// The specification slider used to move hard cost ±31% and day-one rent not
// at all, because every new building opened "good". Class A vs B asking-rent
// spreads run 8–15%; spec 0..1 maps onto ±10% around mid-spec. Trophy still
// costs more than it rents — the slight advantage is the rent, a small cap
// tightener, and slower wear, not a YoC win for gold-plated bones.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const { parcels, bbls } = loadCity(0, E.normalizeParcels);
const g = E.firstListings(E.newGame(550991, parcels), parcels, bbls);

let bad = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`);
  if (!ok) bad++;
};

console.log("\nSPECIFICATION → RENT\n");

check(typeof E.specRentMult === "function", "specRentMult is exported");
check(Math.abs(E.specRentMult(0.5) - 1) < 1e-9, "mid-spec is 1.00× rent");
check(Math.abs(E.specRentMult(1) - 1.10) < 1e-9, "trophy spec is +10% rent");
check(Math.abs(E.specRentMult(0) - 0.90) < 1e-9, "budget spec is −10% rent");

let rec = null;
for (const b of bbls) {
  const r = E.resolveRec(parcels, g, b);
  if (!r || r.class === "land" || !r.lotArea || r.lotArea < 6000) continue;
  rec = r;
  break;
}
if (!rec) throw new Error("need a lot for the spec rent fixture");

const cheap = { ...rec, class: "office", mix: undefined, bldgArea: 80_000, floors: 8, buildSpec: 0.2 };
const mid = { ...rec, class: "office", mix: undefined, bldgArea: 80_000, floors: 8, buildSpec: 0.5 };
const trophy = { ...rec, class: "office", mix: undefined, bldgArea: 80_000, floors: 8, buildSpec: 0.8 };

const rCheap = E.marketRentPsfYr(cheap, g.econ, "good");
const rMid = E.marketRentPsfYr(mid, g.econ, "good");
const rTrophy = E.marketRentPsfYr(trophy, g.econ, "good");
const rentSpread = rTrophy / rCheap;
const costSpread = E.specCostMult(0.8) / E.specCostMult(0.2);
const capCheap = E.capRateFor(cheap, g.econ, "good");
const capTrophy = E.capRateFor(trophy, g.econ, "good");

check(rTrophy > rMid && rMid > rCheap, `rent rises with spec  (${rCheap.toFixed(2)} → ${rMid.toFixed(2)} → ${rTrophy.toFixed(2)})`);
check(rTrophy / rMid > 1.04 && rTrophy / rMid < 1.10, `trophy vs mid is a Class A/B rent band, not a doubling (${((rTrophy / rMid - 1) * 100).toFixed(1)}%)`);
check(costSpread > rentSpread, `cost still moves more than rent  (cost ×${costSpread.toFixed(3)} vs rent ×${rentSpread.toFixed(3)})`);
check(capTrophy < capCheap && capCheap - capTrophy < 0.25,
  `trophy cap is a little tighter (${capTrophy.toFixed(2)} vs ${capCheap.toFixed(2)})`);

// Existing stock without a spec stamp must not silently reprice.
const raw = { ...rec, buildSpec: undefined };
const stamped = { ...rec, buildSpec: 0.5 };
check(Math.abs(E.marketRentPsfYr(raw, g.econ, rec.class === "land" ? "standard" : "standard")
  - E.marketRentPsfYr(stamped, g.econ, "standard")) < 1e-9,
  "unstamped stock rents as mid-spec");

console.log("");
process.exit(bad ? 1 : 0);
