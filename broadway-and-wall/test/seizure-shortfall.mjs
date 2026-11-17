// A SEIZURE THAT DOES NOT COVER THE MORTGAGE — who pays the difference.
//
//   pnpm engine && node test/seizure-shortfall.mjs
//
// The creditors' sale (sim.ts, the insolvency waterfall) states its own rule:
// what the sale does not cover is "the lender's loss on non-recourse paper
// and yours on paper you signed for". It did neither. The owners' share was
// computed as net - lien, which on an underwater building is the shortfall
// with a minus sign, and that was added to cash. So a NON-recourse borrower
// paid the whole shortfall in cash while the lender charged the same dollars
// off, and a RECOURSE borrower paid it twice.
//
// Found in a playtest (Hamlet, seed 4242, month 17): "sold at $90K ... Did
// not cover the $646K mortgage; loan was non-recourse" — and cash went from
// -$29K to -$604K in the same month.
//
// Three runs from one state, differing only in the loan's recourse flag and
// in whether the bailiff comes this month:
//   control        the same month with no seizure
//   non-recourse   cash moves by the tenants' deposits only; the lender
//                  charges off the shortfall
//   recourse       cash moves by the deposits and the shortfall, once; the
//                  lender charges off nothing
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(pathToFileURL(join(HERE, ".engine.mjs")).href);
const { loadCity } = await import(pathToFileURL(join(HERE, "city.mjs")).href);
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);

let bad = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`); if (!ok) bad++; };
const K = (x) => `${x < 0 ? "-" : ""}$${Math.round(Math.abs(x) / 1000)}K`;
const clone = (x) => JSON.parse(JSON.stringify(x));
const TOL = 2;   // rounding at the edge of a dollar

// One let building bought with a note, then the note written up to well over
// anything a forced sale could fetch.
function setUp(seed) {
  let g = E.firstListings(E.newGame(seed, parcels, 6_000_000), parcels, bbls);
  const pick = (gg) => gg.listings.map((l) => ({ l, rec: E.resolveRec(parcels, gg, l.bbl) }))
    .filter((x) => x.rec && x.rec.class !== "land" && x.rec.bldgArea > 4000 && x.l.ask > 600_000 && x.l.ask < 3_500_000)
    .filter((x) => (E.buyQuote(gg, parcels, x.l.bbl, x.l.ask, "harbor", 1).principal ?? 0) > 0)
    .sort((a, b) => b.l.ask - a.l.ask)[0];
  let li;
  for (let m = 0; m < 36 && !(m >= 3 && (li = pick(g))); m++) g = E.advanceMonth(g, parcels, bbls, adjacency);
  li ??= pick(g);
  if (!li) throw new Error("nothing a lender will write a note on in three years");
  const r = E.executePurchase(g, parcels, li.l.bbl, li.l.ask, "harbor", false, 1);
  if (r.err) throw new Error(r.err);
  g = clone(r.s);
  const h = g.holdings[li.l.bbl];
  h.loan.balance = h.loan.principal = Math.round(li.l.ask * 1.6);   // underwater at any price up to the mark
  g.cash = -30_000;
  { const lim = E.locLimit(g, parcels); g.loc = { balance: lim, drawnTotal: lim, interestPaid: 0 }; }
  return { g, bbl: li.l.bbl };
}

function run(g0, bbl, { recourse, seize }) {
  let g = clone(g0);
  g.holdings[bbl].loan.recourse = recourse;
  g.insolventMs = seize ? 11 : 0; g.underwaterMs = seize ? 11 : 0;
  const lender = g.holdings[bbl].loan.holder ?? E.productById(g.holdings[bbl].loan.product).lender;
  const deposits = E.depositsOn(g.holdings[bbl]);
  const off0 = E.lenderByName(g, lender)?.chargeOffsTotal ?? 0;
  g = E.advanceMonth(g, parcels, bbls, adjacency);
  const ex = (g.exits ?? []).find((x) => x.bbl === bbl && x.forced);
  const news = g.news.find((n) => /creditors took/.test(n.text))?.text ?? "";
  return { g, ex, news, deposits, cash: g.cash, chargedOff: (E.lenderByName(g, lender)?.chargeOffsTotal ?? 0) - off0, lender };
}

console.log("\nSEIZURE SHORTFALL — the lender's loss on non-recourse paper, yours once on paper you signed for\n");

for (const seed of (process.env.SEEDS ?? "4242,11").split(",").map(Number)) {
  const { g, bbl } = setUp(seed);
  const mark = E.ownedHoldingValue(g, parcels, g.holdings[bbl]);
  const lien = g.holdings[bbl].loan.balance;
  const ctl = run(g, bbl, { recourse: false, seize: false });
  const non = run(g, bbl, { recourse: false, seize: true });
  const rec = run(g, bbl, { recourse: true, seize: true });
  console.log(`  seed ${seed}: mark ${K(mark)}, lien ${K(lien)}, deposits ${K(non.deposits)}; cash after the month — no seizure ${K(ctl.cash)}, non-recourse ${K(non.cash)}, recourse ${K(rec.cash)}`);
  check(!ctl.ex && !!ctl.g.holdings[bbl], "control: no seizure, the building is still owned");
  check(!!non.ex && !!rec.ex, `both seizures sold the building (${non.ex ? K(non.ex.price) : "not sold"} gross)`);
  if (!non.ex || !rec.ex) continue;
  // The shortfall, as the lender books it on the non-recourse run.
  const shortfall = non.chargedOff;
  check(shortfall > 0 && shortfall < lien * 1.1, `non-recourse: ${non.lender} charges off the shortfall (${K(shortfall)} of a ${K(lien)} lien)`);
  check(/non-recourse/.test(non.news), `the news says so (${non.news.slice(0, 140)})`);
  // What the seizure itself did to cash: against the same month without one.
  const dNon = non.cash - ctl.cash, dRec = rec.cash - ctl.cash;
  check(Math.abs(dNon + non.deposits) <= TOL,
    `non-recourse: the seizure costs the borrower no cash beyond the deposits that go with the deed (${K(dNon)}; deposits ${K(-non.deposits)})`);
  check(rec.chargedOff === 0, `recourse: the lender charges off nothing (${K(rec.chargedOff)})`);
  check(Math.abs(dRec + rec.deposits + shortfall) <= TOL,
    `recourse: the borrower pays the shortfall once (${K(dRec)}; deposits ${K(-rec.deposits)} + shortfall ${K(-shortfall)} = ${K(-rec.deposits - shortfall)})`);
  for (const [name, r] of [["non-recourse", non], ["recourse", rec]]) {
    const inv = E.checkInvariants(r.g, parcels);
    check(inv.length === 0, `${name}: invariants hold${inv.length ? ` — ${inv.slice(0, 2).join("; ")}` : ""}`);
  }
}

console.log(bad ? `\n${bad} FAILED` : "\nall clear");
process.exit(bad ? 1 : 0);
