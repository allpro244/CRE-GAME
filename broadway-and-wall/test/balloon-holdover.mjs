// A YEAR OF HOLDOVER IS ALL A DESK GIVES — a matured note that nobody will
// take out is extended once by a desk with capital, or filed on; it does not
// sit past its maturity being serviced forever.
//
//   pnpm engine && node test/balloon-holdover.mjs
//
// Before workout.ts holdoverDecision, three thirty-year campaigns carried 61
// building-months of matured paper on the book with the file reading "still
// waiting on a takeout". The invariants now flag any note more than a month
// past maturity with no file open, and any note fourteen months past maturity
// without an extension or a filing.
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

// A building with a bank loan, whose balloon lands in two months, on a firm
// with no cash and an empty building, so the ladder cannot renew it and the
// coupon is the only thing that clears.
function setUp(seed) {
  let g = E.firstListings(E.newGame(seed, parcels, 6_000_000), parcels, bbls);
  for (let m = 0; m < 6; m++) g = E.advanceMonth(g, parcels, bbls, adjacency);
  const li = g.listings.map((l) => ({ l, rec: E.resolveRec(parcels, g, l.bbl) })).filter((x) => x.rec && x.rec.class === "office" && x.rec.bldgArea > 8000 && x.l.ask < 3_500_000).sort((a, b) => b.l.ask - a.l.ask)[0];
  if (!li) throw new Error("no office on the tape");
  const r = E.executePurchase(g, parcels, li.l.bbl, li.l.ask, "harbor", false, 1);
  if (r.err) throw new Error(r.err);
  g = JSON.parse(JSON.stringify(r.s));
  const h = g.holdings[li.l.bbl];
  h.loan.maturityM = g.month + 2;
  return { g, bbl: li.l.bbl };
}
const monthsOf = (g, bbl, n, log) => {
  for (let i = 0; i < n; i++) {
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    if (g.gameOver) g = { ...g, gameOver: null };
    const h = g.holdings[bbl];
    if (log && h?.loan) log.push(`m${g.month} mat${h.loan.maturityM} ext${h.loan.extensions ?? 0} wk:${g.workouts?.[bbl]?.stage ?? "-"}/${g.workouts?.[bbl]?.cause ?? "-"} svc${g.workouts?.[bbl]?.servicedMs ?? "-"}`);
  }
  return g;
};

console.log("\nBALLOON HOLDOVER — the desk extends once, or files\n");

// ---- scenario A: a serviced balloon file, a desk with capital — after a year of
// holdover the desk documents the extension itself, once.
{
  const { g: g0, bbl } = setUp(4242);
  let g = JSON.parse(JSON.stringify(g0));
  const h = g.holdings[bbl];
  h.tenants = []; h.occ = 0;                       // nothing a permanent desk will size against
  g.loc = { balance: 0, drawnTotal: 0, interestPaid: 0 };
  for (const l of g.lenders ?? []) if (l.name === "First Harbor Bank") { l.capital = Math.max(l.capital, l.book * 0.12); l.delinquent = Math.min(l.delinquent, 0.01); }
  // The note matured eleven months ago and the firm has cleared every coupon
  // since — the file the old engine left open forever. Opened through the
  // engine's own door so it carries every field a real file does.
  h.loan.maturityM = g.month - 11;
  h.loan.ioUntilM = g.month + 120;
  h.loan.monthlyPmt = Math.round((h.loan.balance * h.loan.ratePct) / 100 / 12);
  E.openWorkout(g, bbl, "balloon", Math.round(h.loan.balance * 1.01));
  const w0 = g.workouts?.[bbl];
  check(!!w0 && w0.cause === "balloon", `a balloon file is open (${w0?.cause ?? "none"})`);
  w0.servicing = true; w0.servicedMs = 11;
  // Clears the coupon for months; cash and line together nowhere near the
  // payoff — the line fully drawn, or the auto-cure pays the note off out of
  // the revolver (which is the right thing for a funded sponsor to do).
  g.cash = 30_000;
  { const lim = E.locLimit(g, parcels); g.loc = { balance: lim, drawnTotal: lim, interestPaid: 0 }; }
  const bal0 = h.loan.balance; const mat0 = h.loan.maturityM; const rate0 = h.loan.ratePct;
  const log = [];
  g = monthsOf(g, bbl, 2, log);
  const h2 = g.holdings[bbl]; const w2 = g.workouts?.[bbl];
  if (!h2?.loan) console.log("    (note gone — " + g.news.slice(0, 3).map((x) => x.text.slice(0, 120)).join(" // ") + ")");
  const extended = !!h2?.loan && h2.loan.maturityM > g.month && (h2.loan.extensions ?? 0) === 1;
  check(extended, `after twelve serviced months the desk documented an extension (${extended ? `to m${h2.loan.maturityM} from m${mat0}, ${rate0}% → ${h2.loan.ratePct}%` : log.join(" | ")})`);
  if (extended) {
    check(h2.loan.ratePct > rate0, "an extension re-prices up");
    check(h2.loan.sweep === true, "extended paper is swept paper");
    check(h2.loan.balance <= bal0 * 1.03 + 1, `the fee, if capitalised, is a point or two (${(h2.loan.balance / bal0 * 100 - 100).toFixed(2)}%)`);
    const interest = (h2.loan.balance * h2.loan.ratePct) / 100 / 12;
    check(h2.loan.monthlyPmt + 1 >= interest * 0.999, "the re-priced cheque covers the re-priced interest");
    check(!!w2 && w2.stage === "forbearance" && w2.decideM === h2.loan.maturityM, `the file reads forbearance to the new maturity (${w2?.stage} → m${w2?.decideM})`);
    check(E.requestForbearance(g, parcels, bbl).err !== undefined, "the borrower cannot ask for a second extension on top of it");
    // ride it out: at the extended maturity the note is an ordinary balloon again — renewed by a desk, filed on, or gone; never extended twice
    const until = h2.loan.maturityM - g.month + 15;
    g = monthsOf(g, bbl, until, log);
    const h3 = g.holdings[bbl]; const w3 = g.workouts?.[bbl];
    check(!h3?.loan || (h3.loan.extensions ?? 0) <= 1, `never extended twice (${!h3?.loan ? "note gone" : `ext ${h3.loan.extensions ?? 0}, mat m${h3.loan.maturityM}, file ${w3?.stage ?? "-"}`})`);
    check(!h3?.loan || h3.loan.maturityM > g.month - 14 || w3?.stage === "foreclosure", `at the extended maturity something happened (${!h3?.loan ? "gone" : `mat m${h3.loan.maturityM} at m${g.month}, file ${w3?.stage ?? "-"}, renewed ${h3.loan.renewedM ?? "-"}`})`);
  }
  const v = E.checkInvariants(g, parcels).filter((x) => x.code === "balloon");
  check(v.length === 0, `no balloon invariant at the end (${v.map((x) => x.detail).join("; ") || "clean"})`);
}

// ---- scenario B: every desk in receivership — a receiver does not extend, it files
{
  const { g: g0, bbl } = setUp(550991);
  let g = JSON.parse(JSON.stringify(g0));
  const h = g.holdings[bbl];
  h.tenants = []; h.occ = 0; g.cash = 40_000; g.loc = { balance: 0, drawnTotal: 0, interestPaid: 0 };
  for (const l of g.lenders ?? []) l.failedM = g.month;
  const log = [];
  g = monthsOf(g, bbl, 16, log);
  const w = g.workouts?.[bbl]; const h2 = g.holdings[bbl];
  check(!h2?.loan || (w && w.stage === "foreclosure") || (h2.loan.extensions ?? 0) === 0, `a receiver files rather than extends (${!h2?.loan ? "note gone" : `${w?.stage ?? "no file"}, ext ${h2.loan.extensions ?? 0}`})`);
  check(!h2?.loan || h2.loan.maturityM > g.month - 14 || w?.stage === "foreclosure", `nothing sits past maturity unfiled (${log.slice(-2).join(" | ")})`);
}

// ---- scenario C: a FILED balloon past its holdover year, on its one extension,
// whose coupon becomes fundable. Paying interest does not retire a principal that
// fell due: both pull-backs (the monthly tick and the July docket) used to return
// it to notice, 13+ months past maturity with neither an extension nor a filing —
// found by test/invariants.mjs (levered bot, seed 4000, m114). The control is the
// same file before its holdover year is out, which IS pulled back: the rule that
// a lender does not auction a note being paid still holds inside the year.
{
  const filed = (monthsPast) => {
    const { g: g0, bbl } = setUp(4242);
    const g = JSON.parse(JSON.stringify(g0));
    const h = g.holdings[bbl];
    h.loan.maturityM = g.month - monthsPast;
    h.loan.extensions = 1;
    h.loan.ioUntilM = g.month + 120;
    h.loan.monthlyPmt = Math.round((h.loan.balance * h.loan.ratePct) / 100 / 12);
    E.openWorkout(g, bbl, "balloon", Math.round(h.loan.balance * 1.01));
    const w = g.workouts[bbl];
    // the decision month is now, so the monthly tick reaches its pull-back branch
    w.stage = "foreclosure"; w.saleM = g.month + 3; w.decideM = g.month;
    // the coupon clears many times over; the payoff does not
    g.loc = { balance: 0, drawnTotal: 0, interestPaid: 0 };
    g.cash = Math.min(h.loan.balance * 0.2, h.loan.monthlyPmt * 24);
    return { g, bbl, h };
  };
  for (const [name, run] of [["the July docket", (g) => E.reinstateFundedForeclosures(g, parcels)], ["the monthly tick", (g) => E.tickWorkouts(g, parcels)]]) {
    const late = filed(13);
    check(E.couponFundable(late.g, parcels, late.h), `${name}: the coupon is fundable (the case under test)`);
    run(late.g);
    check(late.g.workouts?.[late.bbl]?.stage === "foreclosure", `${name}: 13 months past maturity on its one extension, it stays filed (${late.g.workouts?.[late.bbl]?.stage ?? "no file"})`);
    const early = filed(8);
    run(early.g);
    check(early.g.workouts?.[early.bbl]?.stage === "notice", `${name}: 8 months past, inside the holdover year, a fundable coupon still pulls it back (${early.g.workouts?.[early.bbl]?.stage ?? "no file"})`);
  }
}

console.log(bad ? `\n${bad} FAILED` : "\nall clear");
process.exit(bad ? 1 : 0);
