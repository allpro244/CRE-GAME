// THE RUN DOES NOT END WITH EQUITY ON THE BOOK — at the twelfth insolvent
// month, with the line exhausted and nothing unfiled left to take, the
// bankruptcy sale reaches a building whose lender has a file open: the lien
// is paid off the top, the file closes with the deed, the surplus clears the
// hole. The run ends only when there is nothing saleable at all.
//
//   pnpm engine && node test/insolvency-sale.mjs
//
// Found by the playable campaign in PLAYTHROUGH_2026-09.md: a firm ended on
// "the creditors took everything, and it wasn't enough" with one building
// still owned at $3.14M of appraisal and $887K of net worth on the same card,
// because a covenant file kept the building off the seizure list.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);

let bad = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`); if (!ok) bad++; };
const M = (x) => `$${(x / 1e6).toFixed(2)}M`;

// One let office on a modest note, a covenant file open on it, eleven months of
// negative cash behind the firm.
function setUp(seed) {
  let g = E.firstListings(E.newGame(seed, parcels, 6_000_000), parcels, bbls);
  // Six months in, or as long after as it takes for such an office to list
  // (up to three years): which buildings come to market is the town's luck,
  // and a re-cut plat re-deals it.
  const pick = (gg) => gg.listings.map((l) => ({ l, rec: E.resolveRec(parcels, gg, l.bbl) }))
    .filter((x) => x.rec && x.rec.class === "office" && x.rec.bldgArea > 8000 && x.l.ask < 3_500_000)
    .sort((a, b) => b.l.ask - a.l.ask)[0];
  let li;
  for (let m = 0; m < 36 && !(m >= 6 && (li = pick(g))); m++) g = E.advanceMonth(g, parcels, bbls, adjacency);
  li ??= pick(g);
  if (!li) throw new Error("no office on the tape in three years");
  const r = E.executePurchase(g, parcels, li.l.bbl, li.l.ask, "harbor", false, 1);
  if (r.err) throw new Error(r.err);
  g = JSON.parse(JSON.stringify(r.s));
  const h = g.holdings[li.l.bbl];
  // Equity in the deed: a third of the price on the note.
  h.loan.balance = h.loan.principal = Math.round(li.l.ask * 0.33);
  h.loan.monthlyPmt = Math.round((h.loan.balance * h.loan.ratePct) / 100 / 12);
  h.loan.sweep = true;                       // a covenant file stays open on swept paper
  E.openWorkout(g, li.l.bbl, "covenant", Math.round(h.loan.balance * 0.1));
  g.cash = -150_000;
  g.insolventMs = 11; g.underwaterMs = 11;
  return { g, bbl: li.l.bbl, price: li.l.ask };
}

console.log("\nINSOLVENCY SALE — a filed building is the last thing taken, not a reason to end the run\n");

// ---- A: no line, nothing unfiled — the twelfth month sells the filed building
{
  const { g: g0, bbl, price } = setUp(4242);
  let g = JSON.parse(JSON.stringify(g0));
  { const lim = E.locLimit(g, parcels); g.loc = { balance: lim, drawnTotal: lim, interestPaid: 0 }; }
  const w0 = g.workouts?.[bbl];
  check(!!w0 && w0.cause === "covenant", `a covenant file is open on the only building (${w0?.cause ?? "none"})`);
  const v0 = E.ownedHoldingValue(g, parcels, g.holdings[bbl]);
  const lien0 = g.holdings[bbl].loan.balance;
  const cash0 = g.cash;
  g = E.advanceMonth(g, parcels, bbls, adjacency);
  const ex = (g.exits ?? []).find((x) => x.bbl === bbl && x.forced);
  check(!g.holdings[bbl] && !!ex, `the building was sold through the waterfall (${ex ? `${M(ex.price)} gross on a ${M(v0)} mark, ${M(lien0)} lien` : `still owned; ${g.news.slice(0, 2).map((n) => n.text.slice(0, 100)).join(" // ")}`})`);
  check(!g.workouts?.[bbl], "the file closed with the deed");
  check(g.cash > cash0, `the surplus reached the account (${M(cash0)} → ${M(g.cash)})`);
  const stillEquity = g.gameOver && Object.values(g.holdings).some((h) => !g.developments[h.bbl]);
  check(!stillEquity, `the run does not end while a saleable building remains (${g.gameOver ? `over: ${g.gameOver.cause.slice(0, 60)}` : "run continues"})`);
  if (g.cash >= 0) check(!g.gameOver, `with the hole cleared the run continues (cash ${M(g.cash)}, price was ${M(price)})`);
  const bad1 = E.checkInvariants(g, parcels);
  check(bad1.length === 0, `no invariant fired (${bad1.map((x) => x.code).join(", ") || "clean"})`);
}

// ---- B: the same file, the line undrawn — the line is drawn and the deed stays
{
  const { g: g0, bbl } = setUp(4242);
  let g = JSON.parse(JSON.stringify(g0));
  g.loc = { balance: 0, drawnTotal: 0, interestPaid: 0 };
  const lim = E.locLimit(g, parcels);
  // THE PREMISE IS THAT THE LINE IS BIGGER THAN THE HOLE (2026-10-09). The
  // hole was a fixed $150K while the line is sized off whatever office the
  // town listed: on one world a $2.6M office with an $815K line, on another
  // a $713K one with $259K, landing in tax season, where the line was
  // drawn to exhaustion and the deed then went — which is the rule working.
  // The hole is now half the undrawn line, so the case under test is the
  // case being run.
  g.cash = -Math.round(lim * 0.5);
  g = E.advanceMonth(g, parcels, bbls, adjacency);
  check(!!g.holdings[bbl], `with ${M(lim)} of line undrawn against a ${M(lim * 0.5)} hole, the deed is not touched`);
  check(g.cash >= 0 || (g.loc?.balance ?? 0) > 0, `the line covered the hole first (cash ${M(g.cash)}, drawn ${M(g.loc?.balance ?? 0)})`);
  check(!g.gameOver, "the run continues");
}

// ---- C: a filed building beside an unfiled one — the unfiled one goes first
{
  const { g: g0, bbl } = setUp(4242);
  let g = JSON.parse(JSON.stringify(g0));
  const other = g.listings.map((l) => ({ l, rec: E.resolveRec(parcels, g, l.bbl) }))
    .filter((x) => x.rec && x.l.bbl !== bbl && x.rec.class !== "lot" && x.l.ask < 2_500_000 && x.l.ask > 400_000)
    .sort((a, b) => a.l.ask - b.l.ask)[0];
  if (other) {
    g.cash = 6_000_000;
    const r = E.executePurchase(g, parcels, other.l.bbl, other.l.ask, "cash", false, 1);
    if (r.err) throw new Error(r.err);
    g = JSON.parse(JSON.stringify(r.s));
    g.cash = -150_000; g.insolventMs = 11; g.underwaterMs = 11;
    { const lim = E.locLimit(g, parcels); g.loc = { balance: lim, drawnTotal: lim, interestPaid: 0 }; }
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    check(!!g.holdings[bbl] && !g.holdings[other.l.bbl], `the unfiled building went first and the filed one stayed (filed ${g.holdings[bbl] ? "kept" : "taken"}, unfiled ${g.holdings[other.l.bbl] ? "kept" : "taken"})`);
    check(!!g.workouts?.[bbl], "its file is still open");
  } else console.log("  (no second building on the tape to test the order)");
}

console.log(bad ? `\n${bad} FAILED` : "\nall clear");
process.exit(bad ? 1 : 0);
