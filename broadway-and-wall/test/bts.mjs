// BUILD-TO-SUIT: LIST THE SHELL, WAIT FOR AN ANCHOR, BUILD, DELIVER PRE-LET.
//
//   pnpm engine && pnpm exec node test/bts.mjs
//
// The whole player flow, through the real monthly tick rather than around it:
//
//   proposeBuildToSuit  lists the site (h.btsOffer) — it signs nobody
//   advanceQuarter      tickBuildToSuit brings an anchor at demand/climate odds
//                       and writes its signed terms to g.btsProspects
//   planDevelopment     the anchored plan: less lease-up reserve, no less debt
//   startDevelopment    breaks ground with the commitment frozen on the job
//   advanceQuarter...   draws, completion, the named tenant takes possession
//   a few more months   the anchor's rent actually arrives
//
// This file used to call proposeBuildToSuit and read g.btsProspects on the next
// line. That was the old API — the button minted a named credit tenant on the
// click. It became a listing (an anchor "comes when one comes"), the test was
// never moved, and it crashed on `undefined[bbl]` for as long as it sat outside
// `pnpm check`. The engine flow was measured before this rewrite: an anchor
// signs on this site within a few months, so it was the TEST that was stale.
//
// It is also a ledger test. Every month from the listing to the rent is
// reconciled with conserve's identity, so the draws, the deposit the anchor
// posts at delivery and its first rent cheques must all be booked. And it
// asserts its own coverage: the categories this flow must move (`dev`, `noi`,
// and a deposit taken) are checked to have moved, so the identity cannot pass
// on a run that built nothing.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const { parcels, bbls, adjacency } = loadCity(0, E.normalizeParcels);
let g = E.newGame(71191, parcels, 500_000_000);
// Bought at half the mark — dirt picked up in the opening depression, which
// is what a developer who shops a build-to-suit has usually done: the land
// basis is in the yield on cost, and the rent the shell needs follows it.
const handOver = (b) => {
  const basis = Math.round(E.landValue(parcels[b], g.econ) * 0.5);
  g.holdings[b] = {
    bbl: b, boughtM: 0, costBasis: basis, assessed: basis, loan: null,
    condition: "average", condIdx: 0.55, svcIdx: 0.55,
    service: 0, stance: 0, plan: 1, tenants: [], cfHistory: [],
  };
};
// A SITE WHERE A BUILD-TO-SUIT CAN CLOSE. An anchor signs at the rent the
// shell needs to clear its hurdle, and only up to what it would pay for new
// space (btsRentRead) — so the flow is tested on a lot where those meet, the
// lot a developer would actually shop. Most lots do not; that is tested below.
// The site is handed over rather than bought: purchase is not what this file
// tests, and the ledger reconciliation below starts after the hand-over.
let bbl, use, floors, read0;
const lots = bbls.filter((b) => parcels[b]?.class === "land" && parcels[b]?.lotArea > 4_000 && !parcels[b].bldgArea)
  .sort((a, b) => (parcels[b].demandScore ?? 0) - (parcels[a].demandScore ?? 0));
search: for (const b of lots.slice(0, 120)) {
  for (const u of ["office", "retail", "industrial"]) {
    if (E.zoneUseBar(parcels[b], u, g.econ)) continue;
    handOver(b);
    for (const fl of u === "retail" ? [2, 1] : [8, 6, 4, 2]) {
      if (fl > E.maxFloorsFor(parcels[b], 0.62, u)) continue;
      const rd = E.btsRentRead(g, parcels, b, u, fl, 0.62);
      if (rd && rd.need <= rd.market) { bbl = b; use = u; floors = fl; read0 = rd; break search; }
    }
    delete g.holdings[b];
  }
}
if (!bbl) throw new Error("No lot in the test city where a build-to-suit can close.");
console.log(`       site ${bbl}: ${floors} fl of ${use}, needs $${read0.need}/sf against $${read0.market.toFixed(2)} market`);

let bad = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`);
  if (!ok) bad++;
};
const die = (msg) => {
  check(false, msg);
  console.log(`\n${bad} failed\n`);
  process.exit(1);
};

// ---- the ledger identity, as conserve states it ------------------------------
const IN = ["noi", "sold", "interest", "borrowed", "lpCalled", "fees"];
const OUT = ["debtSvc", "leasing", "capex", "dev", "taxes", "bought", "ga", "lpDistributed"];
const TOL = 1000;
const bookTotals = (s) => {
  const t = {};
  for (const k of [...IN, ...OUT]) t[k] = 0;
  for (const y of s.books ?? []) for (const k of [...IN, ...OUT]) t[k] += y[k] ?? 0;
  return t;
};
const depositsHeld = (s) => {
  let d = 0;
  for (const h of Object.values(s.holdings ?? {})) for (const t of h.tenants ?? []) d += t.deposit ?? 0;
  return d;
};
const snap = (s) => ({ cash: s.cash + (s.fund?.cash ?? 0), books: bookTotals(s), loc: s.loc?.balance ?? 0, dep: depositsHeld(s) });
const moved = {};
for (const k of [...IN, ...OUT]) moved[k] = 0;
let depMoved = 0, months = 0, worst = 0, breaks = 0;
let prev = snap(g);
// One month of the real tick, reconciled.
const step = () => {
  g = E.advanceQuarter(g, parcels, bbls, adjacency);
  if (g.gameOver) die(`game ended at month ${g.month}: ${g.gameOver}`);
  const cur = snap(g);
  let explained = cur.loc - prev.loc + cur.dep - prev.dep;
  for (const k of IN) { const d = cur.books[k] - prev.books[k]; explained += d; moved[k] += Math.abs(d); }
  for (const k of OUT) { const d = cur.books[k] - prev.books[k]; explained -= d; moved[k] += Math.abs(d); }
  depMoved += Math.abs(cur.dep - prev.dep);
  const resid = cur.cash - prev.cash - explained;
  if (Math.abs(resid) > TOL) breaks++;
  worst = Math.max(worst, Math.abs(resid));
  months++;
  prev = cur;
};

console.log("\nBUILD-TO-SUIT DEVELOPMENT\n");
const proposed = E.proposeBuildToSuit(g, parcels, bbl, use, floors, 0.62);
if (proposed.err) die(`listing refused: ${proposed.err}`);
g = proposed.s;
check(!!g.holdings[bbl].btsOffer && !g.btsProspects?.[bbl],
  "proposing LISTS the site — nobody is signed on the click");
const again = E.proposeBuildToSuit(g, parcels, bbl, use, floors, 0.62);
check(!again.err && again.s.holdings[bbl].btsOffer.sinceM === g.holdings[bbl].btsOffer.sinceM,
  "re-listing the same programme keeps its place on the book");

{
  const fifty = E.proposeBuildToSuit(g, parcels, bbl, use, floors, 0.62, 50);
  const long = E.proposeBuildToSuit(g, parcels, bbl, use, floors, 0.62, 80);
  check(fifty.s.holdings[bbl].btsOffer.termY === 50 && long.s.holdings[bbl].btsOffer.termY === E.BTS_TERM_MAX_Y,
    `the listing carries the term you offer (${E.BTS_TERM_MIN_Y}-${E.BTS_TERM_MAX_Y} years)`);
  const r15 = E.btsRentRead(g, parcels, bbl, use, floors, 0.62, 2, 15), r50 = E.btsRentRead(g, parcels, bbl, use, floors, 0.62, 2, 50);
  check(r50.need <= r15.need * 1.05, `fifty-year paper does not need much more rent than fifteen ($${r50.need} vs $${r15.need}) — the commission steps down`);
}

// ---- wait for an anchor, through tickBuildToSuit ----------------------------
// Ten years is far past the odds on a small shed in a normal market (the
// monthly hazard floors at 0.4% and runs to 9%); an anchor that never comes in
// ten years is a flow that cannot complete, and that is the fault this file is
// here to catch.
const WAIT = 120;
const listedM = g.month;
while (!g.btsProspects?.[bbl] && g.month - listedM < WAIT) {
  step();
  if (!g.btsProspects?.[bbl] && !g.holdings[bbl]?.btsOffer) die(`the listing vanished at month ${g.month} with no anchor signed`);
}
const bts = g.btsProspects?.[bbl];
if (!bts) die(`no anchor signed in ${WAIT} months — the build-to-suit flow cannot complete`);
console.log(`       ${bts.name} signed after ${g.month - listedM} month(s): ${bts.sf.toLocaleString()} sf at $${bts.rentPsf}/sf for ${bts.termM / 12} yr`);
check(!g.holdings[bbl].btsOffer, "the listing comes off the book when an anchor signs");
check(bts.credit >= 1 && bts.termM >= 180, "bankable tenant signs long paper before groundbreak");
check(bts.rentPsf > 0, "commitment carries fixed rent");
check(bts.use === use && bts.floors === floors, "the anchor signs for the programme that was listed");
check(bts.startByM === bts.signedM + E.BTS_START_WINDOW_M, `the lease carries an outside date for groundbreak (${E.BTS_START_WINDOW_M} months)`);

const anchored = E.planDevelopment(g, parcels, bbl, use, floors, 0.62, "gmp",
  undefined, { bts });
const readAtSign = E.btsRentRead(g, parcels, bbl, use, floors, 0.62, bts.credit, bts.termM / 12);
check(bts.rentPsf >= readAtSign.market - 0.01 && bts.rentPsf <= readAtSign.ceiling + 0.01,
  `a build-to-suit lets at market or better, within the anchor's ceiling ($${bts.rentPsf} against $${readAtSign.market.toFixed(2)} market, $${readAtSign.ceiling.toFixed(2)} ceiling)`);
check(bts.termM === E.BTS_TERM_DEFAULT_Y * 12 && bts.bumpPct > 0, `they sign the listed term (${bts.termM / 12} yrs) with an annual bump (${bts.bumpPct}%)`);
check(anchored.hurdleRatio >= 1, `the signed rent builds the building (anchored hurdle ${anchored.hurdleRatio.toFixed(3)}x the month they sign)`);
// AGAINST THE SAME BUILDING, SPECULATIVE, THE SAME MONTH (2026-10-09). `spec`
// was priced the month the site was listed and the anchor signs months later,
// so this compared a signed lease against a credit market that had moved in
// between. It passed while the credit window stepped with the phase label and
// failed once credit followed national unemployment; neither said anything
// about the lease. The claim is about the lease, so both sides are priced now.
const specNow = E.planDevelopment(g, parcels, bbl, use, floors, 0.62, "gmp");
check(anchored.leaseUp < specNow.leaseUp, "anchor reduces speculative lease-up reserve");
check(anchored.ratePct < specNow.ratePct, `a signed credit lease borrows cheaper (${anchored.ratePct.toFixed(2)}% vs ${specNow.ratePct.toFixed(2)}% spec)`);
check(anchored.ltcMax >= specNow.ltcMax, `signed lease supports at least as much construction financing (LTC ${anchored.ltcMax.toFixed(3)} vs ${specNow.ltcMax.toFixed(3)} speculative, same month)`);

// ---- the signature has an end, and it belongs to the site ---------------------
{
  const late = structuredClone(g);
  late.month = bts.startByM + 1;
  E.tickBuildToSuit(late, parcels);
  check(!late.btsProspects?.[bbl] && late.news.some((n) => n.text.includes(bts.name) && n.text.includes("walked")),
    "past the outside date with nothing in the ground, the anchor walks and says so");
  const sold = structuredClone(g);
  delete sold.holdings[bbl];
  E.tickBuildToSuit(sold, parcels);
  check(!sold.btsProspects?.[bbl], "terms do not outlive the site they were signed on");
  const forged = E.startDevelopment(structuredClone(g), parcels, bbl, use, floors, 0.62, "gmp",
    undefined, { bts: { ...bts, name: "Nobody Signed Ltd" } });
  check(!forged.err && !forged.s.developments[bbl]?.bts, "a commitment that is not on the book builds spec");
}

// ---- break ground -----------------------------------------------------------
const devBefore = prev.books.dev;
const started = E.startDevelopment(g, parcels, bbl, use, floors, 0.62, "gmp",
  anchored.ltcMax, { bts });
if (started.err) die(`BTS project breaks ground: ${started.err}`);
g = started.s;
check(g.developments[bbl].bts?.name === bts.name, "named commitment is frozen on the job");
check(g.developments[bbl].bts?.sf === bts.sf,
  "the job carries the feet the anchor signed for (rentable, not gross — the proforma clip does not bind)");
check(!g.btsProspects?.[bbl], "prospect leaves the pre-development desk at closing");
// startDevelopment is an action, not a tick: reconcile its day-one cheque too.
{
  const cur = snap(g);
  const dDev = cur.books.dev - devBefore;
  // The cheque has two lines since the takeout hedge (MDGA phase 5): the
  // equity to dev, and a rate cap or lock premium to debt service. Both left
  // the account; both must be on the books.
  const dHedge = (cur.books.debtSvc ?? 0) - (prev.books.debtSvc ?? 0);
  check(dDev > 0 && Math.abs((prev.cash - cur.cash) - dDev - dHedge + (cur.loc - prev.loc)) <= TOL,
    `the day-one equity cheque is booked to dev ($${Math.round(dDev).toLocaleString()}${dHedge ? ` + $${Math.round(dHedge).toLocaleString()} takeout hedge to debt service` : ""})`);
  moved.dev += Math.abs(dDev);
  prev = cur;
}

// ---- build it, month by month -----------------------------------------------
const deliverM = g.developments[bbl].deliverM;
while (g.developments[bbl] && g.month < deliverM + 24) step();
check(!g.developments[bbl], `completed BTS leaves construction (month ${g.month}, scheduled ${deliverM})`);
const tenant = g.holdings[bbl]?.tenants.find((t) => t.name === bts.name);
check(!!tenant, "named tenant takes possession at delivery");
check(tenant?.sf === bts.sf && tenant?.rentPsf === bts.rentPsf, "delivered lease matches signed BTS terms");
check(tenant?.endM - tenant?.startM === bts.termM, "the lease runs the signed term from delivery");
check(tenant?.bumpPct === bts.bumpPct, "the signed bump is on the delivered lease");
check((tenant?.deposit ?? 0) > 0, "the anchor posts a security deposit at possession");

// ---- and it pays --------------------------------------------------------------
const noiAtDelivery = prev.books.noi;
for (let i = 0; i < 6; i++) step();
check(g.holdings[bbl]?.tenants.some((t) => t.name === bts.name), "the anchor is still in occupation six months on");
check(prev.books.noi > noiAtDelivery, "the anchor's rent reaches the books");

// ---- the ledger, and what it was asked about ---------------------------------
check(breaks === 0, `${months} months reconciled against the ledger (worst residual $${Math.round(worst).toLocaleString()})`);
const dead = ["dev", "noi"].filter((k) => !(moved[k] > 0));
if (!(depMoved > 0)) dead.push("deposits");
check(!dead.length, `coverage: dev, noi and deposits all moved${dead.length ? ` — DEAD: ${dead.join(", ")}` : ""}`);

console.log(bad ? `\n${bad} failed\n` : "");
process.exit(bad ? 1 : 0);
