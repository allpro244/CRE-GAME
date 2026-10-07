// LOC AUTO-PAYDOWN — idle cash clears the revolver when able.
//
//   pnpm engine && node test/loc-auto-paydown.mjs
//
// DEBT SERVICE FIRST, THEN THE LINE: after every scheduled payment, cash above
// next month's debt service pays the revolver down, and the swept dollars stay
// redrawable as the firm's own cash parked on the line (parkedOnLine) — the
// leasing desk may draw them back, nothing more. (It used to hold back six
// months of debt service, never under $250K.) A sale used to leave the line
// drawn until the next Advance, so the top bar could show millions of cash
// next to an expensive drawn balance. Sale proceeds (and the month tick) must
// pay it down immediately.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

let bad = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`);
  if (!ok) bad++;
};

console.log("\nLOC AUTO-PAYDOWN\n");

const { parcels, bbls } = loadCity(0, E.normalizeParcels);

// --- 1. Month tick still sweeps idle cash above the reserve -----------------
{
  let g = E.newGame(42, parcels, 5_000_000);
  g.loc = { balance: 1_000_000, drawnTotal: 1_000_000, interestPaid: 0 };
  g.cash = 2_000_000;
  g = E.advanceMonth(g, parcels, bbls);
  check((g.loc?.balance ?? 0) === 0, "month tick clears the line when cash covers it");
  check(g.cash >= E.monthlyDebtService(g), "next month\u2019s debt service remains after the sweep");
}

// --- 2. Sale proceeds pay the line immediately (no Advance required) --------
{
  let g = E.firstListings(E.newGame(43, parcels, 80_000_000), parcels, bbls);
  const listing = (g.listings ?? []).find((l) => {
    const r = E.resolveRec(parcels, g, l.bbl);
    return r && r.class !== "land" && r.bldgArea > 0 && l.ask < 25_000_000;
  });
  if (!listing) throw new Error("No building to buy.");
  const bought = E.executePurchase(g, parcels, listing.bbl, listing.ask, "cash", false, 1);
  if (bought.err) throw new Error(bought.err);
  g = bought.s;
  const bbl = listing.bbl;
  // Drawn line larger than the operating float but smaller than sale proceeds,
  // so the close must clear it without waiting for Advance.
  g.loc = { balance: 500_000, drawnTotal: 500_000, interestPaid: 0 };
  g.cash = 100_000;
  const v = E.ownedHoldingValue(g, parcels, g.holdings[bbl]);
  const listed = E.listForSale(g, parcels, bbl, Math.round(v * 0.95), "quiet");
  if (listed.err) throw new Error(listed.err);
  g = listed.s;
  // Price at a round cash-in that covers the drawn line after friction/tax.
  g.holdings[bbl].sale.offer = {
    price: Math.max(Math.round(v * 0.9), 1_200_000),
    expiresM: g.month + 2,
    from: "Test Buyer",
  };
  const locBefore = g.loc.balance;
  const closed = E.acceptSaleOffer(g, parcels, bbl, false);
  if (closed.err) throw new Error(closed.err);
  g = closed.s;
  check((g.loc?.balance ?? 0) === 0, "sale proceeds clear the line without advancing");
  check(g.cash >= E.monthlyDebtService(g), "sale leaves next month\u2019s debt service in the account");
  check(
    (g.news ?? []).some((n) => /Idle cash paid .* down on the line/.test(n.text)),
    `paydown is written into the news tape (was drawn $${(locBefore / 1e6).toFixed(2)}M)`,
  );
}

// --- 3. Debt service first, then the line ----------------------------------
{
  // a firm with a free-and-clear building, so the line has room to redraw
  let g0 = E.firstListings(E.newGame(44, parcels, 40_000_000), parcels, bbls);
  const li = g0.listings.find((l) => { const r = E.resolveRec(parcels, g0, l.bbl); return r && r.class !== "land" && r.bldgArea > 0 && l.ask > 4_000_000 && l.ask < 30_000_000; });
  const b = E.executePurchase(g0, parcels, li.bbl, li.ask, "cash", false, 1);
  if (b.err) throw new Error(b.err);
  const g = b.s;
  g.loc = { balance: 500_000, drawnTotal: 500_000, interestPaid: 0 };
  const keep = E.monthlyDebtService(g);
  check(keep > 0, `next month's debt service is held back (${keep})`);
  g.cash = keep + 80_000;
  const paid = E.sweepLocIdleCash(g);
  check(paid === 80_000, "sweep pays every dollar above next month's debt service");
  check(g.loc.balance === 420_000, "line balance falls by the same amount");
  check(g.cash === keep, "cash lands on next month's debt service, not a six-month hoard");
  check(E.parkedOnLine(g) === 80_000, "the swept cash is recorded as parked on the line");
  // drawing spends the parked cash first
  const d = E.drawLoc(g, parcels, 30_000);
  check(!d.err && E.parkedOnLine(d.s) === 50_000, `a draw spends parked cash first (${d.err ?? E.parkedOnLine(d.s)}, avail ${E.locAvailable(g, parcels)})`);
  // the leasing desk may redraw parked cash, and no more than the line has room for
  check(E.lineDeskMayDraw(g, parcels) === Math.min(80_000, E.locAvailable(g, parcels)), "the desk may draw back exactly the parked cash");
}

if (bad) {
  console.error(`\n${bad} check(s) failed\n`);
  process.exit(1);
}
console.log("\nAll LOC auto-paydown checks passed.\n");
