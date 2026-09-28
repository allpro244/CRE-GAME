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
let g = E.firstListings(E.newGame(12007, parcels, 25_000_000), parcels, bbls);
const listing = g.listings.find((l) => { const r = E.resolveRec(parcels, g, l.bbl); return r && r.class !== "land" && r.bldgArea > 0; });
const bought = E.buyListing(g, parcels, listing.bbl, "cash");
check(!bought.err, `buy — ${bought.err ?? "ok"}`);
g = bought.s;
const bbl = listing.bbl;
const h = g.holdings[bbl];
const asIs = Math.round(E.ownedHoldingValue(g, parcels, h));
const senior = Math.round((asIs * 0.5) / 25_000) * 25_000;
h.loan = {
  product: "harbor", principal: senior, balance: senior, ratePct: 6,
  spread: 2, ioUntilM: g.month + 36, amortYears: 30, maturityM: g.month + 60,
  monthlyPmt: Math.round((senior * 6) / 100 / 12), minDSCR: 1.2, maxLTV: 0.8,
  sweep: false, cleanQs: 0, originM: g.month - 12, origValue: asIs,
  prepay: "open", prepayUntilM: g.month - 1,
};
const placed = E.placeMezz(g, parcels, bbl);
check(!placed.err, `mezz placed — ${placed.err ?? "ok"}`);
g = placed.s;
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
