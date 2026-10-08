// A MORTGAGE CAN BE PAID DOWN WITHOUT BEING RETIRED — the principal falls by
// exactly the amount, the note's own prepayment terms apply to the dollars
// that leave early, the payment is re-cut on the remaining amortisation, the
// cash leaves through the ledger, and the covenant cure number cures.
//
//   pnpm engine && node test/paydown.mjs
//
// Found in PLAYTHROUGH_2026-09.md ("a loan cannot be paid down in part"):
// payOffLoan was all or nothing, so an owner facing a DSCR test had to find
// the whole balance or let the sweep take it out of the building.
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
const K = (x) => `$${Math.round(x / 1e3)}K`;
const debtSvc = (g) => (g.books ?? []).reduce((a, e) => a + (e.debtSvc ?? 0), 0);

console.log("\nPAYDOWN — part of the principal, on the note's own terms\n");

// A let building bought on a bank note.
let g = E.firstListings(E.newGame(12007, parcels, 8_000_000), parcels, bbls);
let bbl = null;
for (const li of g.listings) {
  const rec = E.resolveRec(parcels, g, li.bbl);
  if (!rec || rec.class === "land" || !rec.bldgArea || li.halfBuilt || li.ask > 5_000_000) continue;
  for (const prod of ["savings", "harbor", "savings25"]) {
    const r = E.executePurchase(g, parcels, li.bbl, li.ask, prod, false, 1);
    if (!r.err && r.s.holdings[li.bbl]?.loan) { g = r.s; bbl = li.bbl; break; }
  }
  if (bbl) break;
}
check(!!bbl, `a building bought on a mortgage (${bbl})`);
for (let m = 0; m < 3; m++) g = E.advanceMonth(g, parcels, bbls, adjacency);
const h0 = g.holdings[bbl];
const loan0 = { ...h0.loan };
const amt = Math.round(loan0.balance * 0.2);
const pen = E.prepayPenalty({ ...loan0, balance: amt }, g.month, g.econ);
const r = E.paydownLoan(g, parcels, bbl, amt);
check(!r.err, `pays down ${K(amt)} of ${K(loan0.balance)}${r.err ? ": " + r.err : ""}`);
const g1 = r.s, loan1 = g1.holdings[bbl].loan;
check(Math.abs(loan0.balance - loan1.balance - amt) < 1, `the balance falls by exactly the amount (${K(loan0.balance)} → ${K(loan1.balance)})`);
check(Math.abs((g.cash - g1.cash) - (amt + pen)) < 1, `cash falls by the amount plus the prepayment charge (${K(g.cash - g1.cash)}, charge ${K(pen)} on "${loan0.prepay ?? "open"}" paper)`);
check(Math.abs((debtSvc(g1) - debtSvc(g)) - (amt + pen)) < 1, "and every dollar of it is on the ledger as debt service");
check(loan1.monthlyPmt < loan0.monthlyPmt, `the payment is re-cut lower (${K(loan0.monthlyPmt)} → ${K(loan1.monthlyPmt)} a month)`);
check(g1.holdings[bbl].loan && g1.holdings[bbl].loan.maturityM === loan0.maturityM, "the note survives with its maturity");
check(g.holdings[bbl].loan.balance === loan0.balance, "the caller's state is untouched");
// the tick agrees with the recast
const g2 = E.advanceMonth(g1, parcels, bbls, adjacency);
const l2 = g2.holdings[bbl]?.loan;
check(!!l2 && Math.abs(l2.monthlyPmt - loan1.monthlyPmt) / loan1.monthlyPmt < 0.02, `the next month's tick keeps the recast payment (${K(l2?.monthlyPmt ?? 0)})`);

// refusals
check(!!E.paydownLoan(g, parcels, bbl, loan0.balance + 10).err, "the whole balance is refused — that is Pay off");
check(!!E.paydownLoan(g, parcels, bbl, 0).err, "zero is refused");
const poor = structuredClone(g); poor.cash = amt / 4;
const rp = E.paydownLoan(poor, parcels, bbl, amt);
check(!!rp.err && poor.loc !== undefined ? (poor.loc?.balance ?? 0) === (rp.s.loc?.balance ?? 0) : !!rp.err, `short of cash it refuses and does not draw the line (${rp.err?.slice(0, 50)})`);

// a stepdown note charges on the dollars prepaid
const step = structuredClone(g);
step.holdings[bbl].loan.prepay = "stepdown"; step.holdings[bbl].loan.prepayUntilM = step.month + 30;
const rs = E.paydownLoan(step, parcels, bbl, amt);
const stepPen = (step.cash - rs.s.cash) - amt;
check(!rs.err && Math.abs(stepPen - amt * 0.03) < 2, `a step-down note charges 3% on the ${K(amt)} prepaid with 30 months left (${K(stepPen)})`);

// the cure number cures
const brk = structuredClone(g);
const rec = E.resolveRec(parcels, brk, bbl);
brk.holdings[bbl].loan.minDSCR = (E.dscr(rec, brk, brk.holdings[bbl]) ?? 1) * 1.25;
const need = E.equityCureNeed(rec, brk, brk.holdings[bbl]);
const rc = E.paydownLoan(brk, parcels, bbl, need);
const d2 = rc.err ? 0 : E.dscr(rec, rc.s, rc.s.holdings[bbl]);
check(need > 0 && !rc.err && d2 >= rc.s.holdings[bbl].loan.minDSCR - 0.01, `paying the cure number (${K(need)}) puts DSCR back over the test (${d2?.toFixed(2)} ≥ ${rc.s.holdings[bbl]?.loan.minDSCR.toFixed(2)})`);

console.log(bad ? `\n${bad} FAILED` : "\nall clear");
process.exit(bad ? 1 : 0);
