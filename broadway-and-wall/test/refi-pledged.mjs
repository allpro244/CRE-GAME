// A PLEDGED DEED REFINANCES OUT OF THE POOL AT THE CLOSING.
//
// The new lender's proceeds pay the facility its release price at the same
// table, so a sponsor never needs the release cheque in the bank first; at the
// pool's minimum the takeout repays the whole line. Checks: the refinance
// closes, the deed leaves the pool (or the facility is gone), the facility
// balance falls by exactly the release price, and the cash that moved is the
// new principal less the release and the fees.
import { assertFreshBundle } from "./fresh.mjs";
if (!process.env.ENGINE) assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(process.env.ENGINE ? join(HERE, "..", process.env.ENGINE) : join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
let fails = 0;
const ok = (c, m) => { console.log(`${c ? "  OK  " : "  FAIL"}  ${m}`); if (!c) fails++; };

function book(seed, poolN) {
  const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
  let g = E.firstListings(E.newGame(4400 + seed, parcels), parcels, bbls);
  g = { ...g, cash: 60e6 };
  let bought = 0;
  for (let m = 0; m < 90 && bought < 8; m++) {
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    for (const L of g.listings ?? []) {
      if (bought >= 8) break;
      const rec = E.resolveRec(parcels, g, L.bbl);
      if (!rec || rec.class === "land" || !rec.bldgArea || g.holdings[L.bbl]) continue;
      if (L.ask < 400_000 || L.ask > g.cash * 0.6) continue;
      const r = E.executePurchase(g, parcels, L.bbl, L.ask, "cash", false, 1);
      if (r && r.s && r.s.holdings[L.bbl]) { g = r.s; bought++; }
    }
  }
  const pool = E.pledgeable(g, parcels).slice(0, poolN).map((c) => c.bbl);
  const qt = E.facilityQuotes(g, parcels, pool).find((x) => x.available);
  if (pool.length < poolN || !qt) return null;
  const r = E.openFacility(g, parcels, pool, qt.productId, 1);
  return r.err ? null : { g: r.s, parcels };
}

for (const [poolN, label] of [[5, "a five-deed pool releases one deed"], [E.FACILITY_MIN_ASSETS, "a pool at its minimum is repaid in full"]]) {
  let done = false;
  for (let seed = 0; seed < 6 && !done; seed++) {
    const b = book(seed, poolN);
    if (!b) continue;
    const { g, parcels } = b;
    for (const bbl of g.facility.bbls) {
      const rq = E.refiQuotes(g, parcels, bbl);
      const q = rq.quotes.find((x) => x.available && x.maxProceeds > 0);
      if (!q) continue;
      const rel = E.refiFacilityRelease(g, parcels, bbl);
      const r = E.refinance(g, parcels, bbl, q.id, 1);
      if (r.err) { console.log(`  (seed ${seed} ${bbl}: ${r.err})`); continue; }
      const n = r.s;
      console.log(`  ${label}: $${(q.maxProceeds / 1e6).toFixed(2)}M ${q.id}, release $${(rel.price / 1e6).toFixed(2)}M`);
      ok(!!rel, "the deed was pledged going in");
      ok(!n.facility || !n.facility.bbls.includes(bbl), "the deed is out of the pool");
      if (poolN === E.FACILITY_MIN_ASSETS) ok(!n.facility, "the facility is gone — every deed is free");
      else ok(n.facility && Math.abs((g.facility.balance - n.facility.balance) - rel.price) < 2, `the facility balance fell by the release price (${((g.facility.balance - (n.facility?.balance ?? 0)) / 1e6).toFixed(2)}M)`);
      ok(!!n.holdings[bbl].loan && n.holdings[bbl].loan.balance > 0, "the new mortgage is on the deed");
      const fee = (n.holdings[bbl].loan.balance - rel.price) - (n.cash - g.cash) - (g.holdings[bbl].loan?.balance ?? 0);
      ok(fee >= 0 && fee < 0.06 * n.holdings[bbl].loan.balance, `cash moved = principal - release - fees (fees $${Math.round(fee / 1e3)}k)`);
      done = true; break;
    }
  }
  ok(done, `${label} — exercised`);
}
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
