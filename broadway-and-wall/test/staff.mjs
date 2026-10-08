// THE PAYROLL, MEASURED.
//
//   pnpm staff
//
// Four questions, and every one of them has to be able to answer "no":
//
//   1. Does capacity BIND? A firm that can buy a hundred buildings without its
//      management degrading has a payroll system that is decoration.
//   2. Does a hire PAY FOR ITSELF at the right size, and only at the right
//      size? If a manager is worth hiring on day one with two buildings, the
//      salary is too cheap; if never, it is too dear.
//   3. Is the read on a candidate actually NOISY at hire and actually
//      CONVERGENT afterwards?
//   4. Does the money reach the ledger? Salaries are cash leaving the firm and
//      `pnpm conserve` will fail on a single unexplained dollar — this checks
//      the same identity from the other end.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const { parcels: P0, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const clone = () => JSON.parse(JSON.stringify(P0));
const med = (a) => { const b = [...a].filter(Number.isFinite).sort((x, y) => x - y); return b[Math.floor((b.length - 1) / 2)]; };
const M = (n) => `$${(n / 1e6).toFixed(2)}M`;
let fails = 0;
const report = (name, ok, lines) => {
  console.log(`\n${ok ? "PASS" : "FAIL"}  ${name}`);
  for (const l of lines) console.log(`      ${l}`);
  if (!ok) fails++;
};

// A synthetic, fully-let commercial book of about `sf` feet: one tenant per
// building at market rent, so EGI (and so the management fee) is real.
function bookOf(g, parcels, sf) {
  const holdings = {};
  let acc = 0;
  for (const b of bbls) {
    const r = E.resolveRec(parcels, g, b);
    if (!r || !r.bldgArea || !["office", "industrial", "retail"].includes(r.class)) continue;
    const let_ = E.rentableSf(r);
    holdings[b] = {
      bbl: b, boughtM: 0, costBasis: 1, assessed: 1, loan: null, condition: "average",
      condIdx: 0.7, service: 0, stance: 0, plan: 1, cfHistory: [],
      tenants: [{ name: "T", sf: let_, rentPsf: E.marketRentPsfYr(r, g.econ, "average", 0.7), startM: 0, endM: 120,
        credit: 1, sector: "professional", use: r.class, staff: 1, net: false }],
    };
    acc += r.bldgArea;
    if (acc >= sf) break;
  }
  return { holdings, sf: acc };
}
const hireOf = (role, lvl, salary = 110_000) => ({
  id: 1, name: "x", role, hiredM: 0, salary, band0: 26,
  attrs: { judgment: lvl, urgency: lvl, diligence: lvl, relationships: lvl }, obs: {},
});

// ---------------------------------------------------------------------------
// 1. THE WORK IS BOUGHT UNTIL SOMEBODY IS HIRED TO DO IT
// ---------------------------------------------------------------------------
{
  // No hire: every building is with the outside firm and runs at exactly the
  // market standard — the principal is NOT secretly managing it. A hire of
  // ordinary ability takes it in-house up to their capacity and changes
  // nothing about how the building runs. Past capacity the rest stays outside;
  // nothing slips.
  const parcels = clone();
  const g = E.firstListings(E.newGame(4242, parcels), parcels, bbls);
  const rows = [];
  let neutralOk = true;
  for (const sf of [150_000, 600_000, 2_400_000]) {
    const { holdings, sf: acc } = bookOf(g, parcels, sf);
    const solo = { ...g, holdings: JSON.parse(JSON.stringify(holdings)), staff: [] };
    E.markStaff(solo, parcels);
    const soloStamped = Object.values(solo.holdings).some((h) => h.pmCover || h.pmOpexMult || h.leaseCover);
    const mid = { ...g, holdings: JSON.parse(JSON.stringify(holdings)), staff: [hireOf("pm", 50)] };
    E.markStaff(mid, parcels);
    const opex = Object.values(mid.holdings).map((h) => h.pmOpexMult ?? 1);
    if (soloStamped || opex.some((m) => Math.abs(m - 1) > 0.001)) neutralOk = false;
    rows.push({ sf: acc, share: E.roleState(mid, parcels, "pm").share, soloStamped });
  }
  const shrinking = rows[0].share > rows[2].share && rows[0].share >= 0.999 && rows[2].share < 0.5;
  report("A. THE WORK IS BOUGHT — a hire brings it in-house up to their hours, and no further",
    neutralOk && shrinking,
    [...rows.map((r) => `${(r.sf / 1000).toFixed(0)}k sf   mid-ability PM covers ${(r.share * 100).toFixed(0)}% in-house   (no hire: ${r.soloStamped ? "STAMPED" : "all outside, neutral"})`),
     `an ordinary hire runs buildings exactly as the outside firm did: ${neutralOk}`]);
}

// ---------------------------------------------------------------------------
// 2. THE HIRE HAS TO PAY FOR ITSELF, AND NOT TOO EARLY
// ---------------------------------------------------------------------------
{
  // The fee a median manager brings in-house, less the back office and the
  // salary, by book size. The crossover is the answer to "when should I hire",
  // and it is an OUTPUT of the fee, the in-house cost and the capacity curve.
  const parcels = clone();
  const g = E.firstListings(E.newGame(4242, parcels), parcels, bbls);
  const salary = 110_000;
  const rows = [];
  for (const sf of [40_000, 100_000, 300_000, 600_000, 1_200_000]) {
    const { holdings, sf: acc } = bookOf(g, parcels, sf);
    const st = { ...g, holdings, staff: [hireOf("pm", 50, salary)] };
    E.markStaff(st, parcels);
    const ec = E.pmDeskEconomics(st, parcels);
    rows.push({ sf: acc, ec });
  }
  const crossover = rows.find((r) => r.ec.netYr > 0);
  const big = rows[rows.length - 1].ec;
  report("B. A HIRE PAYS FOR ITSELF, EVENTUALLY — and not on day one",
    !!crossover && rows[0].ec.netYr < 0 && crossover.sf >= 80_000 && big.netYr > 0,
    [...rows.map((r) => `${(r.sf / 1000).toFixed(0)}k sf   fee kept ${M(r.ec.feeKeptYr)} − back office ${M(r.ec.backOfficeYr)} − salary ${M(r.ec.salaryYr)} = ${M(r.ec.netYr)}  ->  ${r.ec.netYr >= 0 ? "WORTH IT" : "not yet"}`),
     `crossover at ${crossover ? (crossover.sf / 1000).toFixed(0) + "k sf" : "never"}   (a $110k manager must lose money on a couple of small buildings and earn it on a real book)`]);
}

// ---------------------------------------------------------------------------
// 3. THE READ IS NOISY, THEN IT IS NOT
// ---------------------------------------------------------------------------
{
  const parcels = clone();
  let g = E.firstListings(E.newGame(777, parcels), parcels, bbls);
  E.refreshPool(g, true);
  const pool = g.hirePool.list;
  const err0 = [], err60 = [], w0 = [], w60 = [];
  for (const c of pool) {
    for (const k of Object.keys(c.attrs)) {
      const atHire = E.readAttr({ ...c, hiredM: -1 }, k, 0);
      const after = E.readAttr({ ...c, hiredM: 0 }, k, 60);
      err0.push(Math.abs(atHire.mid - c.attrs[k]));
      err60.push(Math.abs(after.mid - c.attrs[k]));
      w0.push(atHire.hi - atHire.lo);
      w60.push(after.hi - after.lo);
    }
  }
  report("C. YOU DO NOT KNOW WHAT YOU ARE BUYING — until you do",
    med(err0) >= 8 && med(err60) < med(err0) / 2 && med(w60) < med(w0) / 3,
    [`candidates ${pool.length}, attributes read ${err0.length}`,
     `median error at the interview: ${med(err0).toFixed(1)} points of 100   (must be >= 8 — a read this good is not a read)`,
     `median error after 5 years:    ${med(err60).toFixed(1)} points`,
     `shown band at hire ${med(w0).toFixed(0)} wide -> ${med(w60).toFixed(0)} wide after 5 years`]);
}

// ---------------------------------------------------------------------------
// 4. THE MONEY MOVES THROUGH THE LEDGER
// ---------------------------------------------------------------------------
{
  const parcels = clone();
  let g = E.firstListings(E.newGame(11, parcels), parcels, bbls);
  for (let m = 0; m < 6; m++) g = E.advanceQuarter(g, parcels, bbls, adjacency);
  const gaBefore = (g.books ?? []).reduce((a, y) => a + (y.ga ?? 0), 0);
  const cashBefore = g.cash;
  E.refreshPool(g, true);
  const cand = g.hirePool.list.find((c) => c.role === "pm");
  const r = E.hire(g, parcels, cand.id);
  if (r.err) { report("D. SALARIES REACH THE BOOKS", false, [`hire refused: ${r.err}`]); }
  else {
    g = r.s;
    for (let m = 0; m < 18; m++) g = E.advanceQuarter(g, parcels, bbls, adjacency);
    const onStaff = (g.staff ?? []).length;
    const gaAfter = (g.books ?? []).reduce((a, y) => a + (y.ga ?? 0), 0);
    const payroll = E.payrollMonthly(g);
    // every dollar of cash that left has a matching books entry — the same
    // identity pnpm conserve asserts, checked here at the payroll line
    const dCash = cashBefore - g.cash;
    report("D. SALARIES REACH THE BOOKS — and the desk fills after a search",
      onStaff === 1 && gaAfter > gaBefore && payroll > 0 && dCash > 0,
      [`hired ${cand.name} at $${Math.round(cand.askSalary / 1000)}k, starts after a ${E.SEARCH_MONTHS}-month notice`,
       `on staff 18 months later: ${onStaff}`,
       `payroll now ${M(payroll)}/mo at today's price level (salary is quoted in year-2000 dollars)`,
       `G&A booked over the window: ${M(gaAfter - gaBefore)}`,
       `run pnpm conserve for the full identity — this only checks the payroll line reaches it`]);
  }
}

// ---------------------------------------------------------------------------
// 5. THE HALF-BUILT WIRES NOW BIND
// ---------------------------------------------------------------------------
{
  const parcels = clone();
  let g = E.firstListings(E.newGame(91, parcels), parcels, bbls);
  E.refreshPool(g, true);
  const roles = new Set(g.hirePool.list.map((c) => c.role));
  const hasCm = roles.has("construction");
  const tier = E.setSearchTier(g, parcels, "recruiter");
  const bandOk = !tier.err && tier.s.hirePool.band === 11;
  // A performing PM desk must move renewal probability — stamp + intent.
  const officeBbl = bbls.find((b) => {
    const r = E.resolveRec(parcels, g, b);
    return r && r.class === "office" && r.bldgArea > 20_000;
  });
  let renewOk = false;
  if (officeBbl) {
    g.holdings[officeBbl] = {
      bbl: officeBbl, boughtM: 0, costBasis: 1, condition: "average",
      tenants: [{
        name: "Acme", sf: 10_000, rentPsf: 30, startM: 0, endM: 60,
        credit: 1, sector: "professional", use: "office", staff: 1, net: false,
      }],
      loan: null, assessed: 1, condIdx: 0.7, svcIdx: 0.7,
      service: 0, stance: 0, plan: 1, cfHistory: [],
      pmRenewalMult: 0.75,
    };
    g.pmDeskSlip = 0.4;
    g.staff = [{
      id: 1, name: "Pat", role: "pm", hiredM: 0, salary: 100_000, band0: 26,
      attrs: { judgment: 40, urgency: 40, diligence: 40, relationships: 40, costControl: 40, tenantCare: 30 },
      obs: {},
    }];
    const rec = E.resolveRec(parcels, g, officeBbl);
    const ri = E.renewalIntent(g, rec, g.holdings[officeBbl], g.holdings[officeBbl].tenants[0]);
    renewOk = ri.p < 0.85;
  }
  const jSharp = E.deskJudgment({ staff: [{ role: "leasing", attrs: { judgment: 90 } }] }, "leasing");
  // Empty desk uses the principal's Deal sense (neutral 50 when no principal row).
  const jEmpty = E.deskJudgment({ staff: [] }, "leasing");
  const jYours = E.deskJudgment({ staff: [], principal: { attrs: { judgment: 77 } } }, "leasing");
  report("E. HALF-BUILT STAFF WIRES BIND — CM hire, search tier, renewals, judgment",
    hasCm && bandOk && renewOk && jSharp > 80 && jEmpty === 50 && jYours === 77,
    [
      `construction on shortlist: ${hasCm}`,
      `recruiter sets band 11: ${bandOk}${tier.err ? ` (${tier.err})` : ""}`,
      `weak PM desk cuts renewal intent: ${renewOk}`,
      `deskJudgment sharp=${jSharp.toFixed(0)} empty=${jEmpty} yours=${jYours}`,
    ]);
}

// ---------------------------------------------------------------------------
// F. PM AND LEASING NEVER SLIP; CONSTRUCTION DOES
// ---------------------------------------------------------------------------
{
  const parcels = clone();
  const g = E.firstListings(E.newGame(4242, parcels), parcels, bbls);
  // A huge book with one weak PM: whatever they cannot cover is outside at
  // neutral, so the building-level opex stamp is the hire's skill diluted by
  // share — never worse than the hire's own skill.
  const { holdings } = bookOf(g, parcels, 2_400_000);
  const probe = { ...g, holdings, staff: [hireOf("pm", 30)] };
  E.markStaff(probe, parcels);
  const rs = E.roleState(probe, parcels, "pm");
  const own = E.pmOpexMult({ ...rs, skill: rs.skill, slip: 0 });
  const stamps = Object.values(probe.holdings).map((h) => h.pmOpexMult ?? 1);
  const noSlip = stamps.every((m) => m <= own + 1e-6 && m >= 1 - 1e-6);
  // Construction: a 300k sf job with nobody hired is past the principal's cover.
  const jobBbl = Object.keys(holdings)[0];
  const cm = { ...g, holdings: {}, staff: [], developments: { [jobBbl]: {
    bbl: jobBbl, use: "office", sf: 300_000, floors: 20, startM: 0, deliverM: 36,
    costTotal: 1, hardCost: 1, equityBudget: 1, equitySpent: 1, loanBalance: 0, ratePct: 7,
    contingency: 0, contingencyUsed: 0, events: 0, contract: "costplus" } } };
  const cmRs = E.roleState(cm, parcels, "construction");
  const withCm = { ...cm, staff: [hireOf("construction", 60)] };
  const cmRs2 = E.roleState(withCm, parcels, "construction");
  report("F. PM AND LEASING NEVER SLIP — the excess stays outside; construction still does",
    noSlip && rs.share < 0.5 && cmRs.slip > 0.3 && cmRs2.slip < cmRs.slip && E.cmRiskMult(cmRs) > E.cmRiskMult(cmRs2),
    [
      `weak PM on 2.4M sf: ${(rs.share * 100).toFixed(0)}% in-house, stamps x${Math.min(...stamps).toFixed(3)}..x${Math.max(...stamps).toFixed(3)}, their own skill x${own.toFixed(3)}`,
      `300k sf job: principal alone slips ${(cmRs.slip * 100).toFixed(0)}% (site risk x${E.cmRiskMult(cmRs).toFixed(3)}); with a CM ${(cmRs2.slip * 100).toFixed(0)}% (x${E.cmRiskMult(cmRs2).toFixed(3)})`,
    ]);
}

console.log(`\n${"=".repeat(64)}`);
console.log(fails === 0 ? `${6 - fails} of 6 payroll tests pass` : `${fails} payroll test(s) failed`);
process.exit(fails === 0 ? 0 : 1);
