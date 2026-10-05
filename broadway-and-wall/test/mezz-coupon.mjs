// THE JUNIOR COUPON IS PAID ONCE A MONTH, NOT TWICE.
//
// serviceMezz paid and booked the coupon itself and ALSO returned it into the
// holding's debt cash, which the month then paid and booked again. The ledger
// balanced — both halves were booked — so conserve could not see it; the
// borrower simply paid 2x the junior coupon for as long as the mezz was on.
// This holds one month's debt service on a senior + mezz stack to the two
// coupons, once each.
//
//   pnpm engine && node test/mezz-coupon.mjs
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

let bad = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`); if (!ok) bad++; };
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
// A building that can carry a mezzanine behind a 50% senior: the first one,
// searching openings from seed 12007, where the mezz desk will place. The
// test is about how the coupon is booked, not about which lots one opening
// happens to list.
let g, bbl, placedOk = false;
for (let seed = 12007; seed < 12007 + 30 && !placedOk; seed++) {
  const g0 = E.firstListings(E.newGame(seed, parcels, 25_000_000), parcels, bbls);
  for (const listing of g0.listings) {
    const r = E.resolveRec(parcels, g0, listing.bbl);
    if (!r || r.class === "land" || !(r.bldgArea > 0)) continue;
    const bought = E.buyListing(g0, parcels, listing.bbl, "cash");
    if (bought.err) continue;
    let gg = bought.s;
    const h = gg.holdings[listing.bbl];
    const asIs = Math.round(E.ownedHoldingValue(gg, parcels, h));
    const senior = Math.round((asIs * 0.5) / 25_000) * 25_000;
    h.loan = {
      product: "harbor", principal: senior, balance: senior, ratePct: 6,
      spread: 2, ioUntilM: gg.month + 36, amortYears: 30, maturityM: gg.month + 60,
      monthlyPmt: Math.round((senior * 6) / 100 / 12), minDSCR: 1.2, maxLTV: 0.8,
      sweep: false, cleanQs: 0, originM: gg.month - 12, origValue: asIs,
      prepay: "open", prepayUntilM: gg.month - 1,
    };
    const placed = E.placeMezz(gg, parcels, listing.bbl);
    if (placed.err) continue;
    g = placed.s; bbl = listing.bbl; placedOk = true;
    break;
  }
}
check(placedOk, `buy and place a mezz behind a 50% senior${placedOk ? "" : " — no building on 30 openings would take one"}`);
if (!placedOk) { console.log(`\n${bad} FAILED`); process.exit(1); }
const m = g.holdings[bbl].mezz;
const seniorPmt = g.holdings[bbl].loan.monthlyPmt;
const book = (s) => (s.books ?? []).reduce((a, e) => a + (e.debtSvc ?? 0), 0);
const d0 = book(g);
const next = E.advanceMonth(g, parcels, bbls, adjacency);
const coupon = next.holdings[bbl]?.mezz?.monthlyPmt ?? m.monthlyPmt;
const paid = book(next) - d0 - (next.loc?.interestPaid ?? 0) + (g.loc?.interestPaid ?? 0);
const want = seniorPmt + coupon;
check(Math.abs(paid - want) <= 2, `one month of debt service is the senior payment plus one junior coupon: booked ${Math.round(paid).toLocaleString()} against ${want.toLocaleString()} (${seniorPmt.toLocaleString()} + ${coupon.toLocaleString()})`);

console.log(bad ? `\n${bad} FAILED` : "\nall clear");
process.exit(bad ? 1 : 0);
