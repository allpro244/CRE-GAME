// THE LEASE-UP MARK ENDS WHEN THE BUILDING STABILISES, NOT ON A DATE.
//
//   pnpm engine && node test/leaseup-mark.mjs
//
// `leaseUpMark` values a new building "as-is on completion" — as-if-stabilised
// less the fill cheque, the forgone income and the risk. It used to switch off
// at a fixed 19 / 38 months after delivery, whatever the roll looked like, and
// the ordinary in-place blend took over the next month. Measured on player
// deliveries (seed 12007, see the commit that added this): an office 88% let
// marked -24.5% between month 37 and 38; a block of flats 65% let marked -44%
// between month 18 and 19; the market's own read of unowned buildings stepped
// by up to 22%. Nothing about any of those buildings changed that month.
//
// Now the mark applies while the roll is short of the occupancy the corner
// stabilises at, the years left are read off the lease-up curve from where the
// roll is, and the value it deducts from is the building's own ordinary mark
// with the gap let at market — so it lands on the blend as the gap closes.
// Holds, on the same building in the same month with only the clock moved:
//   1. a partly let building does not step at the old window end
//   2. nor at the outer bound where the as-is premium has faded out
//   3. an empty building is not worth more for having sat empty longer
//   4. a building let to its stabilised level has left lease-up
//   5. the unowned read (assetValue) is continuous across the same edge
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, bbls } = loadCity(0, E.normalizeParcels);

let bad = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`); if (!ok) bad++; };
const pc = (x) => `${(x * 100).toFixed(1)}%`;
const TOL = 0.03;   // a month of calendar is worth well under this on an unchanged roll

console.log("\nLEASE-UP MARK — ends on the roll, not the calendar\n");

// Buildings off the opening tape, held as if owned, with the roll replaced by
// one market lease of a chosen size: the only thing that varies below is the
// clock (deliveredM) or the size of that lease.
let tested = 0;
for (const seed of [12007, 550991, 11, 7919]) {
  const g = E.firstListings(E.newGame(seed, parcels, 400_000_000), parcels, bbls);
  const picks = g.listings
    .map((li) => ({ li, rec: E.resolveRec(parcels, g, li.bbl) }))
    .filter((x) => x.rec && x.rec.bldgArea > 4000 && (x.rec.class === "office" || x.rec.class === "multifamily") && !x.li.halfBuilt && !x.li.distress);
  const seen = new Set();
  for (const { li, rec } of picks) {
    if (seen.has(rec.class)) continue;
    const h0 = E.asIfOwned(g, li.bbl, li.ask, E.disclosureFor(g, li.bbl), rec);
    const template = (h0.tenants ?? [])[0];
    const apt = rec.class === "multifamily";
    if (!apt && !template) continue;
    seen.add(rec.class);
    tested++;
    const span = apt ? 19 : 38;
    const rsf = E.rentableSf(rec);
    const stabOcc = E.stabilisedOccupancy(rec, g.econ);
    const rent = E.marketRentPsfYr(rec, g.econ, h0.condition, h0.condIdx);
    const let_ = (share) => apt
      ? { ...h0, occ: share, tenants: [] }
      : { ...h0, tenants: share > 0 ? [{ ...template, sf: share * rsf, rentPsf: rent, recovery: "nnn", net: true, freeUntilM: undefined, startM: g.month, endM: g.month + 120 }] : [] };
    const at = (h, sinceM) => E.holdingValue(rec, g.econ, { ...h, deliveredM: g.month - sinceM }, g.month);
    const tag = `seed ${seed} ${rec.class} ${Math.round(rec.bldgArea / 1000)}k sf`;

    // 1 · partly let across the old window end
    for (const share of [0.3, 0.6]) {
      const h = let_(share);
      const a = at(h, span - 1), b = at(h, span);
      check(Math.abs(b / a - 1) < TOL, `${tag}, ${pc(share)} let: month ${span - 1} → ${span} moves ${pc(b / a - 1)}`);
    }
    // 2 · across the outer bound. The as-is premium fades out evenly between
    //     one and two spans, so every month of the fade moves the mark by the
    //     same slice; the last month must be one more slice, not a step.
    {
      const h = let_(0.3);
      const a = at(h, 2 * span - 2), b = at(h, 2 * span - 1), c = at(h, 2 * span), d = at(h, 2 * span + 1);
      const slice = b - a, last = c - b, after = d - c;
      check(Math.abs(last - slice) <= Math.abs(slice) * 0.05 + 1 && Math.abs(after) <= 1,
        `${tag}, 30% let: the fade's last month moves ${pc(c / b - 1)} against ${pc(b / a - 1)} the month before, and ${pc(d / c - 1)} after`);
    }
    // 3 · empty is not worth more for having been empty longer
    {
      const h = let_(0);
      const d0 = at(h, 0), late = at(h, span - 1);
      check(late <= d0 * 1.001, `${tag}, empty: month ${span - 1} ${Math.round(late / 1e3)}K ≤ opening ${Math.round(d0 / 1e3)}K`);
    }
    // 4 · let to the corner's stabilised level at month 6 → the ordinary
    //     blend. (The dirt under it is still new fabric's dirt — no demolition
    //     allowance on a six-month-old building — so the floor is the land.)
    {
      const share = Math.min(1, stabOcc + 0.01);
      const h = let_(share);
      const young = at(h, 6);
      const blend = Math.max(E.landValue(rec, g.econ), E.holdingValue(rec, g.econ, { ...h, deliveredM: undefined }, g.month));
      const capNoRoll = Math.min(13, Math.max(2.8, E.capRateFor(rec, g.econ, h.condition, h.condIdx))) / 100;
      const mark = E.leaseUpMarkAt(rec, g.econ, h.condition, 6, share, capNoRoll);
      check(mark === null && Math.abs(young / blend - 1) < 1e-9,
        `${tag}, ${pc(share)} let (stabilises at ${pc(stabOcc)}) at month 6 has left lease-up (${Math.round(young / 1e3)}K vs blend ${Math.round(blend / 1e3)}K)`);
    }
  }
}
check(tested >= 3, `sampled ${tested} buildings — enough to mean something`);

// 5 · the market's read of a building nobody owns, across the same edge
{
  const g = E.firstListings(E.newGame(12007, parcels), parcels, bbls);
  // the market's clock is only stamped once the first month runs
  const econ = { ...g.econ, m: g.econ.m ?? g.month };
  let n = 0, worst = 0, where = "";
  for (const bbl of bbls) {
    const rec = E.resolveRec(parcels, g, bbl);
    if (!rec || rec.class === "land" || !(rec.bldgArea > 0)) continue;
    const span = rec.class === "multifamily" ? 19 : 38;
    const v = (sinceM) => E.assetValue({ ...rec, yearBuilt: E.START_YEAR + econ.m / 12 - sinceM / 12 }, econ, "good");
    const j = v(span) / v(span - 1) - 1;
    n++;
    if (Math.abs(j) > Math.abs(worst)) { worst = j; where = `${bbl} ${rec.class}`; }
  }
  check(n > 100 && Math.abs(worst) < TOL, `unowned: ${n} buildings, worst move from month span-1 to span ${pc(worst)} (${where})`);
}

console.log(bad ? `\n${bad} FAILED` : "\nall clear");
process.exit(bad ? 1 : 0);
