// A LOAN IS PAID WHENEVER CASH OR THE LINE CAN PAY IT (owner, 2026-11-10:
// "make loans automatically paid if you have the money or loc").
// A levered building whose roll pays nothing, an empty account and an open
// line: for a year, no payment may be missed, no default file may open, and
// the deed stays yours. Then the same with the line taken away: the clock must
// start, so the test can fail.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

let bad = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`); if (!ok) bad++; };
console.log("\nLOANS ARE PAID FROM CASH OR THE LINE\n");
const { parcels, bbls, adjacency } = loadCity(0, E.normalizeParcels);

function setup(seed) {
  for (let s = seed; s < seed + 400; s++) {
    const g = E.firstListings(E.newGame(s, parcels, 80_000_000), parcels, bbls);
    const li = (g.listings ?? []).find((l) => {
      const r = E.resolveRec(parcels, g, l.bbl);
      return r && r.class !== "land" && r.bldgArea > 0 && l.ask > 5_000_000 && l.ask < 25_000_000;
    });
    if (!li) continue;
    const b = E.executePurchase(g, parcels, li.bbl, li.ask, "savings", false, 0.65);
    if (b.err || !b.s.holdings[li.bbl]?.loan) continue;
    return { g: b.s, bbl: li.bbl };
  }
  throw new Error("No levered building.");
}

function run(withLine) {
  let { g, bbl } = setup(71);
  const pmt = g.holdings[bbl].loan.monthlyPmt;
  g.holdings[bbl].tenants = [];              // the roll pays nothing
  if (g.holdings[bbl].occ !== undefined) g.holdings[bbl].occ = 0;
  g.cash = 0;
  g.loc = { balance: 0, drawnTotal: 0, interestPaid: 0 };
  // other buildings' income must not pay it: this is the only deed
  const missed = [];
  let filed = false, line0 = 0;
  for (let m = 0; m < 12; m++) {
    if (!withLine) g.loc = { balance: 9e12, drawnTotal: 9e12, interestPaid: 0 };  // over-advanced: nothing left to draw
    const before = g.news.length;
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    for (const x of g.news.slice(0, g.news.length - before)) if (/Missed payment|missed three|default file/i.test(x.text)) missed.push(x.text);
    if (g.workouts?.[bbl]) filed = true;
    line0 = Math.max(line0, g.loc?.balance ?? 0);
  }
  return { g, bbl, pmt, missed, filed };
}

{
  const r = run(true);
  check(E.locAvailable(r.g, parcels) >= 0, `the line had room (avail ${Math.round(E.locAvailable(r.g, parcels))})`);
  check(r.missed.length === 0, `no missed payment in a year with the line open${r.missed.length ? ` — ${r.missed[0]}` : ""}`);
  check(!r.filed, "no default file opened");
  check(!!r.g.holdings[r.bbl]?.loan, "the deed and its loan are still yours");
  check((r.g.loc?.balance ?? 0) > 0, `the line paid the debt service (balance ${Math.round(r.g.loc?.balance ?? 0)}, payment ${r.pmt}/mo)`);
}
{
  const r = run(false);
  check(r.missed.length > 0 || r.filed, "with no cash and no line, the payment is missed (the test can fail)");
}
console.log(bad ? `\n${bad} failed\n` : "\nall clear\n");
process.exit(bad ? 1 : 0);
