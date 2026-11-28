// COVENANTS TEST WHAT THE PAPER SAYS, CURES SAY WHAT THEY COST, AND THE LINE
// OBEYS ITS OWN COVENANT (playtest 2026-11-27, findings F1, F2, F14).
//
//   pnpm engine && node test/covenant-ltv.mjs        (~15 s)
//
// F1  - permanent paper (agency, life company, conduit) carries no LTV
//       maintenance test; bank paper does, and its cure is sized against the
//       appraisal the test reads, so a cure actually ends the breach.
//     - every automatic cure is announced with its amount, and the books show
//       it as principal repaid (negative `borrowed`), not debt service.
//     - a building with no income is not auto-cured: no cheque ends that breach.
// F2  - a same-month refinance into the desk that holds the note, for the same
//       money at no better price, is refused; a better price still closes.
// F14 - the revolver is what is left under total debt <= 60% of gross assets.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(pathToFileURL(join(HERE, ".engine.mjs")).href);
const { loadCity } = await import(pathToFileURL(join(HERE, "city.mjs")).href);
const { parcels: P0, adjacency, bbls } = loadCity(0, E.normalizeParcels);

let bad = 0;
const check = (ok, msg) => { console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`); if (!ok) bad++; };
const K = (x) => `$${Math.round(x / 1e3)}K`;
const adv = (g, parcels) => E.advanceMonth(g, parcels, bbls, adjacency);
const rec = (g, parcels, b) => E.resolveRec(parcels, g, b);
const newsNow = (g, re) => g.news.filter((n) => n.q === g.month && re.test(n.text)).map((n) => n.text);

const parcels = JSON.parse(JSON.stringify(P0));
let g0 = E.firstListings(E.newGame(12007, parcels, 8_000_000), parcels, bbls);
g0 = adv(g0, parcels);
// A let apartment building both an agency desk and the hometown bank will write.
let B = null;
for (const li of g0.listings) {
  const r = rec(g0, parcels, li.bbl);
  if (!r || r.class !== "multifamily" || li.halfBuilt || li.ask > 4_000_000) continue;
  const a = E.buyListing(g0, parcels, li.bbl, "agencyFixed", 1);
  const h = E.buyListing(g0, parcels, li.bbl, "harbor", 1);
  if (a.s.holdings[li.bbl]?.loan && h.s.holdings[li.bbl]?.loan) { B = li.bbl; break; }
}
check(!!B, `an apartment building both desks will finance (${B})`);
if (!B) process.exit(1);

/** Bought on `prod`, holiday over, the lender's appraisal 10 points through the LTV covenant. */
function breachedOn(prod) {
  const r = E.buyListing(g0, parcels, B, prod, 1);
  const s = structuredClone(r.s);
  const h = s.holdings[B], L = h.loan;
  L.holidayUntilM = s.month;
  h.apprV = Math.round(L.balance / (L.maxLTV + 0.10));
  h.apprM = s.month + 1;   // fresh: the annual re-strike does not move it this month
  return s;
}

console.log("\nF1 — permanent paper has no LTV maintenance test\n");
{
  const s = breachedOn("agencyFixed");
  const h = s.holdings[B];
  check(!E.ltvTested(h.loan), "agency paper is flagged as LTV-at-origination only");
  const l0 = E.ltv(rec(s, parcels, B), s, h);
  const d0 = E.dscr(rec(s, parcels, B), s, h);
  const bal0 = h.loan.balance;
  const s1 = adv(s, parcels);
  const h1 = s1.holdings[B];
  check(l0 > h.loan.maxLTV, `the appraisal reads LTV ${(100 * l0).toFixed(0)}% against a ${(100 * h.loan.maxLTV).toFixed(0)}% sheet (coverage ${d0?.toFixed(2)})`);
  check(!h1.loan.sweep && !(h1.loan.breachMs > 0), "no breach, no sweep");
  check(Math.abs(h1.loan.balance - bal0) < 1, `no principal taken (${K(bal0)} → ${K(h1.loan.balance)})`);
  check(newsNow(s1, /ovenant/).length === 0, "and nothing on the news about a covenant");
}

console.log("\nF1 — bank paper is tested, cured in full, announced, and booked as principal\n");
{
  const s = breachedOn("harbor");
  const h = s.holdings[B];
  check(E.ltvTested(h.loan), "bank paper keeps its LTV test");
  const need = E.equityCureNeed(rec(s, parcels, B), s, h);
  const bal0 = h.loan.balance, pmt0 = h.loan.monthlyPmt;
  const s1 = adv(s, parcels);
  const h1 = s1.holdings[B];
  const R1 = rec(s1, parcels, B);
  const l1 = E.ltv(R1, s1, h1);
  const paid = bal0 - h1.loan.balance;
  const bm = s1.booksMonthly.at(-1);
  check(paid > 0 && need > 0, `the firm paid ${K(paid)} of principal (cure need ${K(need)})`);
  check(l1 <= h1.loan.maxLTV + 0.002, `the cure reaches the covenant on the appraisal it is tested on (LTV ${(100 * l1).toFixed(1)}% vs ${(100 * h1.loan.maxLTV).toFixed(0)}%)`);
  check(!h1.loan.sweep && !(h1.loan.breachMs > 0), "the breach is over: no sweep, no clock");
  const lines = newsNow(s1, /Covenant cure/);
  check(lines.length === 1 && /\$\d/.test(lines[0]), `the cure is announced with its amount: "${(lines[0] ?? "").slice(0, 110)}…"`);
  check(Math.abs(bm.borrowed + paid) < Math.max(2, 0.01 * paid), `the books show it as principal repaid (borrowed ${K(bm.borrowed)})`);
  check(bm.debtSvc < 2 * pmt0, `and debt service is the scheduled payment, not the cure (${K(bm.debtSvc)} vs ${K(pmt0)}/mo)`);
}

console.log("\nF1 — no income: the breach stands and no cheque is written\n");
{
  const s = breachedOn("harbor");
  const h = s.holdings[B];
  h.renovatingUntilM = s.month + 6;   // gutted: no rent, the costs still run
  const R = rec(s, parcels, B);
  const d0 = E.dscr(R, s, h);
  const bal0 = h.loan.balance, cash0 = s.cash;
  const s1 = adv(s, parcels);
  const h1 = s1.holdings[B];
  check(d0 !== null && d0 <= 0, `coverage with the building empty: ${d0?.toFixed(2)}`);
  check(Math.abs(h1.loan.balance - bal0) < 1, `no cure paid into it (${K(bal0)} → ${K(h1.loan.balance)})`);
  check(h1.loan.sweep && h1.loan.breachMs === 1, "the breach stands: swept, month one of the clock");
  check(newsNow(s1, /Covenant cure/).length === 0, `no cure on the news (cash ${K(cash0)} → ${K(s1.cash)})`);
}

console.log("\nF2 — a refinance that changes nothing is refused\n");
{
  const r = E.buyListing(g0, parcels, B, "harbor", 1);
  const s = r.s;
  const x = E.refinance(s, parcels, B, "harbor", 1);
  check(!!x.err && /Nothing to refinance/.test(x.err), `same desk, same month, same loan: "${(x.err ?? "closed").slice(0, 90)}…"`);
  check(x.s === s, "and nothing moved");
  const q = E.refiQuotes(s, parcels, B).quotes.find((z) => z.id === "harbor");
  check(q && !q.available && /Nothing to refinance/.test(q.why ?? ""), "the desk's card is closed with the same reason");
  const other = E.refinance(s, parcels, B, "cordage", 1);
  check(!/Nothing to refinance/.test(other.err ?? ""), `another desk is unaffected (${other.err ? other.err.slice(0, 60) : "closed"})`);
  // a better price is a real refinance: mark the note's coupon two points dearer than today's sheet
  const s2 = structuredClone(s);
  s2.holdings[B].loan.ratePct = +(s2.holdings[B].loan.ratePct + 2).toFixed(2);
  const y = E.refinance(s2, parcels, B, "harbor", 1);
  check(!y.err, `a lower coupon from the same desk still closes${y.err ? ": " + y.err : ` (${y.s.holdings[B].loan.ratePct}% vs ${s2.holdings[B].loan.ratePct}%)`}`);
}

console.log("\nF14 — the line is what is left under total debt <= 60% of assets\n");
/** Independent covenant arithmetic, every deed at today's mark, plus own unrestricted cash. */
function base(s) {
  let gav = 0, debt = 0, dep = 0;
  for (const h of Object.values(s.holdings)) {
    if (h.fundOwned) continue;
    gav += E.ownedHoldingValue(s, parcels, h);
    debt += (h.loan?.balance ?? 0) + (h.mezz?.balance ?? 0);
    for (const t of h.tenants) dep += t.deposit ?? 0;
  }
  gav += Math.max(0, s.cash - (s.loc?.balance ?? 0) - dep);
  for (const d of Object.values(s.developments ?? {})) {
    gav += Math.max(0, (d.equitySpent ?? 0) + (d.drawn ?? 0) - (d.reserveUsed ?? 0));
    debt += d.loanBalance ?? 0;
  }
  return { gav, debt: debt + (s.facility?.balance ?? 0) };
}
const live = (s) => { const t = structuredClone(s); if (t.loc) { delete t.loc.reviewVals; delete t.loc.reviewM; } return t; };
{
  const lev = live(E.buyListing(g0, parcels, B, "harbor", 1).s);
  const b = base(lev);
  const lim = E.locLimit(lev, parcels);
  const cap = Math.max(0, E.LOC_LTV * b.gav - b.debt);
  check(lim <= cap + 1, `levered: limit ${K(lim)} <= 60% x ${K(b.gav)} - ${K(b.debt)} of debt = ${K(cap)}`);
  // the same book with its own cash spent: the deed alone is the base
  const dry = structuredClone(lev); dry.cash = 50_000;
  const bd = base(dry);
  check(bd.debt > E.LOC_LTV * bd.gav && E.locLimit(dry, parcels) === 0,
    `levered at ${(100 * bd.debt / bd.gav).toFixed(0)}% with the cash spent: no line (was 60% of net worth on top of the mortgage)`);
  const cov = E.lineCovenant(lev, parcels);
  check(Math.abs(cov.gav - b.gav) < 1 && Math.abs(cov.debt - b.debt) < 1, `the screen's covenant reads the same book (${K(cov.gav)} / ${K(cov.debt)})`);

  const cashBuy = E.buyListing(g0, parcels, B, "cash");
  const un = live(cashBuy.s);
  const bu = base(un);
  const limU = E.locLimit(un, parcels);
  check(!cashBuy.err && bu.debt === 0, "an unlevered book");
  check(limU > 0 && limU <= E.LOC_LTV * bu.gav + 1, `unlevered: a line (${K(limU)}) within 60% of ${K(bu.gav)} of assets`);

  // a line drawn above the new limit is called through the over-advance path
  const over = structuredClone(E.buyListing(g0, parcels, B, "harbor", 1).s);
  const limO = E.locLimit(over, parcels);
  over.loc = { ...(over.loc ?? { drawnTotal: 0, interestPaid: 0 }), balance: limO + 400_000, drawnTotal: limO + 400_000 };
  const o1 = adv(over, parcels);
  check(Number.isFinite(o1.cash), `month runs with the line over its limit (cash ${K(o1.cash)})`);
  check((o1.loc.balance ?? 0) < limO + 400_000 || (o1.locOverMs ?? 0) >= 1, `the bank calls it (line ${K(limO + 400_000)} → ${K(o1.loc.balance)}, over-advanced ${o1.locOverMs ?? 0} mo)`);
}

console.log(bad ? `\n${bad} check(s) failed.` : "\nAll checks pass.");
process.exit(bad ? 1 : 0);
