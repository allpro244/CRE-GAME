// Development cash lifecycle probe.
const E = await import("./test/.engine.mjs");
const { loadCity } = await import("./test/city.mjs");
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);

const M = (n) => (n === undefined ? "  --   " : `${n < 0 ? "-" : " "}$${(Math.abs(n) / 1e6).toFixed(2)}M`);
const USE = process.env.USE ?? "office";
const SEED = Number(process.env.SEED ?? 7919);

let g = E.firstListings(E.newGame(SEED, parcels), parcels, bbls);
g = { ...g, cash: 400e6 };   // remove capital constraint entirely

// --- buy a piece of dirt, all cash -----------------------------------------
let bought = null;
for (let m = 0; m < 240 && !bought; m++) {
  g = E.advanceQuarter(g, parcels, bbls, adjacency);
  if (!g.talks) {
    for (const l of g.listings) {
      const rec = E.resolveRec(parcels, g, l.bbl);
      if (!rec || rec.class !== "land" || rec.lotArea < 6000) continue;
      const fl = Math.min(E.maxFloorsFor(rec, 0.6), 12);
      const plan = E.planDevelopment(g, parcels, l.bbl, USE, fl, 0.6, "gmp");
      if (!plan) continue;
      const r = E.negotiate(g, parcels, l.bbl, Math.round(l.ask * 1.02));
      if (!r.err) { g = r.s; break; }
    }
  }
  if (g.talks?.agreed) {
    const r = E.closeDeal(g, parcels, "cash", 0);
    if (!r.err) { g = r.s; bought = g.talks ? null : Object.keys(g.holdings)[0]; }
    else { g = E.walkAway(g, parcels).s; }
  } else if (g.talks) {
    const r = E.acceptCounter(g, parcels);
    if (!r.err) g = r.s; else g = E.walkAway(g, parcels).s;
  }
}
const bbl = Object.keys(g.holdings)[0];
const rec = E.resolveRec(parcels, g, bbl);
console.log(`site ${bbl} ${rec.address} lot ${rec.lotArea}sf  cash ${M(g.cash)}  month ${g.month}`);

const fl = Math.min(E.maxFloorsFor(rec, 0.6), 12);
const plan = E.planDevelopment(g, parcels, bbl, USE, fl, 0.6, "gmp");
console.log("PLAN", JSON.stringify({
  use: USE, floors: plan.floors, sf: plan.sf,
  hardCost: plan.hardCost, softCost: plan.softCost, contingency: plan.contingency,
  demo: plan.demo, leaseUp: plan.leaseUp, costTotal: plan.costTotal,
  ltc: plan.ltc, commitment: plan.commitment, interestReserve: plan.interestReserve,
  equity: plan.equity, equityAtClose: plan.equityAtClose, months: plan.months,
  projectCost: plan.costTotal + plan.interestReserve,
  check_equity_plus_commitment: plan.equity + plan.commitment,
}, null, 1));

const cashBefore = g.cash;
const r = E.startDevelopment(g, parcels, bbl, USE, plan.floors, 0.6, "gmp");
if (r.err) { console.log("REFUSED:", r.err); process.exit(1); }
g = r.s;
console.log(`\nGROUND BROKEN. cash ${M(cashBefore)} -> ${M(g.cash)}  (paid ${M(cashBefore - g.cash)}, equityAtClose ${M(plan.equityAtClose)})`);

// --- month by month ---------------------------------------------------------
let prevCash = g.cash;
let totalOut = 0, totalIn = 0;
const startCash = cashBefore;
const startM = g.month;
console.log(`\n${"m".padStart(4)} ${"cash".padStart(9)} ${"dCash".padStart(9)} ${"eqSpent".padStart(9)} ${"eqBudget".padStart(9)} ${"drawn".padStart(9)} ${"loanBal".padStart(9)} ${"iRes".padStart(9)} ${"resUsed".padStart(9)} ${"contUsed".padStart(9)} ${"costTot".padStart(9)}`);
let delivered = false, deliverM = null;
for (let m = 0; m < 90; m++) {
  const dPrev = g.developments[bbl] ? JSON.parse(JSON.stringify(g.developments[bbl])) : null;
  g = E.advanceQuarter(g, parcels, bbls, adjacency);
  const d = g.developments[bbl];
  const dc = g.cash - prevCash;
  if (dc < 0) totalOut += -dc; else totalIn += dc;
  const row = (o) => o
    ? `${M(o.equitySpent).padStart(9)} ${M(o.equityBudget).padStart(9)} ${M(o.drawn).padStart(9)} ${M(o.loanBalance).padStart(9)} ${M(o.interestReserve).padStart(9)} ${M(o.reserveUsed).padStart(9)} ${M(o.contingencyUsed).padStart(9)} ${M(o.costTotal).padStart(9)}`
    : "  (delivered)";
  console.log(`${String(g.month).padStart(4)} ${M(g.cash).padStart(9)} ${M(dc).padStart(9)} ${row(d ?? dPrev)}`);
  prevCash = g.cash;
  if (!d && dPrev) { delivered = true; deliverM = g.month; }
  if (delivered && g.month > deliverM + 2) break;
}

console.log(`\n--- SUMMARY -------------------------------------------------`);
console.log(`plan.equity          ${M(plan.equity)}`);
console.log(`plan.costTotal       ${M(plan.costTotal)}`);
console.log(`commitment           ${M(plan.commitment)}`);
console.log(`cash at ground break ${M(startCash)}`);
console.log(`cash now             ${M(g.cash)}`);
console.log(`net cash change      ${M(g.cash - startCash)}`);
console.log(`gross cash OUT       ${M(totalOut)}  (all sources, incl. G&A/tax/noise)`);
console.log(`gross cash IN        ${M(totalIn)}`);
const books = g.books.reduce((a, b) => a + b.dev, 0);
console.log(`books "dev" total    ${M(books)}   = ${(books / plan.equity).toFixed(2)}x plan.equity`);
console.log(`multiple of equity   ${((startCash - g.cash) / plan.equity).toFixed(2)}x  (net)`);
