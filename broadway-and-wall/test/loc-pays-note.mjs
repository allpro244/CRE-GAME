// THE LINE PAYS THE NOTE — an overdrawn account with an open revolver is not
// a missed payment.
//
//   pnpm engine && node test/loc-pays-note.mjs
//
// fundCashNeed drew exactly the payment into an account that was already
// overdrawn, left it overdrawn, and paid nothing. The facility then reported
// its cheque "short" — month one, month two — with millions undrawn on the
// line, until month-end coverCashShortfall filled the hole and the clock reset.
// The owner's report: "when you have plenty of LOC you get a notification,
// typically for 2 months only, that you haven't paid your note."
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

console.log("\nTHE LINE PAYS THE NOTE\n");

const { parcels, bbls } = loadCity(0, E.normalizeParcels);

// --- 1. fundCashNeed: overdrawn cash + open line pays in full -------------
{
  const g = { cash: -400_000, loc: { balance: 0, drawnTotal: 0, interestPaid: 0 } };
  // Bypass the borrowing base: a stub state with a fixed limit is all this
  // arithmetic needs. locAvailable reads the real state, so use a real game.
  let s = E.firstListings(E.newGame(77201, parcels, 80_000_000), parcels, bbls);
  for (const L of (s.listings ?? []).slice(0, 12)) {
    const rec = E.resolveRec(parcels, s, L.bbl);
    if (!rec || rec.class === "land" || !rec.bldgArea) continue;
    const r = E.executePurchase(s, parcels, L.bbl, L.ask, "cash", false, 1);
    if (!r.err) s = r.s;
  }
  s.cash = g.cash;
  s.loc = g.loc;
  const room = E.locAvailable(s, parcels);
  check(room > 1_000_000, `line has room ($${(room / 1e6).toFixed(2)}M)`);
  const paid = E.fundCashNeed(s, parcels, 100_000);
  check(paid === 100_000, `overdrawn account pays the note from the line (paid $${paid})`);
  check(s.cash >= 0, `the draw also fills the hole (cash $${Math.round(s.cash)})`);

  // Line short of hole + note: the note still has first call on the draw.
  s.cash = -400_000;
  s.loc = { balance: 0, drawnTotal: 0, interestPaid: 0 };
  // The limit reads net worth, which the balance itself moves, so walk the
  // balance up until about 150K of room is left.
  let room2 = E.locAvailable(s, parcels);
  for (let i = 0; i < 40 && room2 > 200_000; i++) {
    s.loc.balance += Math.round((room2 - 150_000) * 0.5);
    room2 = E.locAvailable(s, parcels);
  }
  const paid2 = E.fundCashNeed(s, parcels, 100_000);
  check(room2 >= 100_000 && paid2 === 100_000, `a thin line pays the note before the hole (room $${Math.round(room2)}, paid $${paid2})`);
}

// --- 2. A facility month on an overdrawn account: no arrears, one notice --
{
  let g = E.firstListings(E.newGame(77101, parcels, 80_000_000), parcels, bbls);
  const picks = [];
  for (const L of g.listings ?? []) {
    const rec = E.resolveRec(parcels, g, L.bbl);
    if (!rec || rec.class === "land" || !rec.bldgArea) continue;
    picks.push(L);
    if (picks.length >= 8) break;
  }
  for (const L of picks) {
    const r = E.executePurchase(g, parcels, L.bbl, L.ask, "cash", false, 1);
    if (r.err) throw new Error(r.err);
    g = r.s;
  }
  const pool = Object.keys(g.holdings);
  const qt = E.facilityQuotes(g, parcels, pool).find((x) => x.available);
  check(!!qt, "facility desk quotes the pool");
  if (!qt) process.exit(1);
  const opened = E.openFacility(g, parcels, pool, qt.productId, 1);
  check(!opened.err && !!opened.s.facility, "facility opens");
  g = opened.s;

  let arrears = 0, notices = 0, shortNews = 0;
  for (let m = 0; m < 4; m++) {
    g = { ...g, cash: -300_000, loc: { ...g.loc } };
    g = E.advanceMonth(g, parcels, bbls);
    arrears = Math.max(arrears, g.facility?.arrearsMs ?? 0);
    const fresh = g.news.filter((x) => x.q === g.month);
    notices += fresh.filter((x) => /line of credit drew/.test(x.text)).length;
    shortNews += fresh.filter((x) => /payment came up .* short/.test(x.text)).length;
  }
  check(arrears === 0, `facility never in arrears while the line has room (max ${arrears})`);
  check(shortNews === 0, `no "payment came up short" news (${shortNews})`);
  check(notices === 1, `exactly one "line is paying your notes" notice over four dry months (${notices})`);
}

console.log(bad ? `\n${bad} FAILED\n` : "\nall clear\n");
process.exit(bad ? 1 : 0);
