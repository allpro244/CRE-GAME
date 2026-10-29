// CITY HALL — the budget is an identity, a crisis is a failed rollover, and a
// policy moves the number it says it moves.
//
//   node test/citygov.mjs              one seed, twenty years, plus the forced cases
//   YEARS=60 SEEDS=11,22 node test/citygov.mjs
//
// 1. THE BUDGET IDENTITY, every month: Δcash = revenue − spending − principal
//    repaid + borrowed (citygov.ts). Checked on the engine's own lines, and
//    the run must actually have borrowed and repaid, or it proved nothing.
// 2. A CRISIS ONLY WHEN A ROLLOVER FAILS. Every crisis in the run is a month
//    in `failedRolls`; and forced: a city with unpaid bills and the market shut
//    does NOT go into crisis in a month nothing matures, DOES the month a
//    bond matures, and does not when the same maturity meets an open market.
// 3. POLICIES MOVE THEIR NUMBERS: an abatement lowers a new building's tax in
//    the pro forma (and raises what it is worth); a higher property tax lowers
//    a building's value; a higher transfer tax lowers what a seller nets; rent
//    stabilisation holds a renewal under the market; a service cut and a
//    payroll-tax rise pull jobs.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(pathToFileURL(join(HERE, ".engine.mjs")).href);
const { loadCity } = await import(pathToFileURL(join(HERE, "city.mjs")).href);

const SEEDS = (process.env.SEEDS ?? "550991").split(",").map(Number);
const YEARS = Number(process.env.YEARS ?? 20);
let fails = 0;
const ok = (cond, msg) => { console.log(`  ${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fails++; };
const clone = (x) => structuredClone(x);
const M = (x) => `$${(x / 1e6).toFixed(2)}M`;

const c = loadCity(0, E.normalizeParcels);
let warm = null, warmParcels = null;

console.log("1. the budget identity, and 2a. crises in the run");
for (const seed of SEEDS) {
  const parcels = clone(c.parcels);
  let g = E.firstListings(E.newGame(seed, parcels), parcels, c.bbls);
  let worst = 0, months = 0, borrowed = 0, repaid = 0, elections = 0;
  for (let m = 0; m < YEARS * 12; m++) {
    if (g.gameOver) g = { ...g, gameOver: null, cash: 6e6 };
    const before = g.econ.gov ? g.econ.gov.cash : undefined;
    g = E.advanceQuarter(g, parcels, c.bbls, c.adjacency);
    const G = g.econ.gov;
    if (!G || before === undefined) continue;
    const L = G.mo;
    const want = E.revTotal(L) - E.spendTotal(L) - L.principal + L.borrowed;
    const err = Math.abs(G.cash - before - want);
    worst = Math.max(worst, err / Math.max(1, Math.abs(want), Math.abs(G.cash)));
    months++; borrowed += L.borrowed; repaid += L.principal;
    if (m === 10 * 12) { warm = clone(g); warmParcels = clone(parcels); }
  }
  const G = g.econ.gov;
  elections = G.log.filter((x) => x.kind === "election").length;
  ok(months > 100 && worst < 1e-9, `seed ${seed}: ${months} months, Δcash = rev − spend − principal + borrowed (worst relative miss ${worst.toExponential(1)})`);
  ok(borrowed > 0 && repaid > 0, `seed ${seed}: the run borrowed ${M(borrowed)} and repaid ${M(repaid)} — the identity was asked about real flows`);
  ok(G.crises.every((x) => G.failedRolls.includes(x.m)), `seed ${seed}: ${G.crises.length} crises, every one a failed rollover (${G.failedRolls.length} failed)`);
  ok(elections >= Math.floor(YEARS / 4) - 1, `seed ${seed}: ${elections} elections in ${YEARS} years`);
}

console.log("\n2b. a crisis is a failed rollover and nothing else (forced)");
{
  // A city that has run out of money: cash deep in the red (unpaid bills),
  // which alone puts its spread past where the market clears.
  const stage = (g, matures) => {
    const G = g.econ.gov;
    G.cash = -0.6 * G.rev12;
    G.control = null;
    // Nothing matures next month unless asked; one bond does if asked.
    for (const b of G.bonds) if (b.matM <= g.month + 2) b.matM = g.month + 24;
    if (matures) G.bonds.push({ face: 0.05 * G.rev12, coupon: 0.05, matM: g.month + 1, kind: "note" });
    return g;
  };
  const p1 = clone(warmParcels);
  let a = E.advanceQuarter(stage(clone(warm), false), p1, c.bbls, c.adjacency);
  ok(!a.econ.gov.open, `bills unpaid ${M(-0.6 * warm.econ.gov.rev12)}: spread ${a.econ.gov.spread.toFixed(2)}, market closed to the city`);
  ok(a.econ.gov.crises.length === warm.econ.gov.crises.length && !a.econ.gov.control, "closed market, nothing maturing: no crisis (the bills ride)");
  const p2 = clone(warmParcels);
  let b = E.advanceQuarter(stage(clone(warm), true), p2, c.bbls, c.adjacency);
  const Gb = b.econ.gov;
  ok(Gb.crises.length === warm.econ.gov.crises.length + 1 && !!Gb.control && Gb.failedRolls.includes(b.month),
    `closed market, a note matures: crisis, control board (services ${Gb.policy.service.toFixed(2)}, property tax ${(Gb.policy.propRate * 100).toFixed(2)}%)`);
  ok(b.econ.taxMult > a.econ.taxMult && Gb.policy.service < a.econ.gov.policy.service, "the board's surcharge reaches econ.taxMult; services are cut");
  // The same maturity in a healthy city rolls.
  const p3 = clone(warmParcels);
  const h = clone(warm);
  const Gh = h.econ.gov;
  for (const x of Gh.bonds) if (x.matM <= h.month + 2) x.matM = h.month + 24;
  Gh.bonds.push({ face: 2 * Math.max(0, Gh.cash) + 1e6, coupon: 0.05, matM: h.month + 1, kind: "note" });
  const r = E.advanceQuarter(h, p3, c.bbls, c.adjacency);
  ok(r.econ.gov.crises.length === warm.econ.gov.crises.length && r.econ.gov.mo.borrowed > 0,
    `open market, a maturity bigger than cash: rolled (borrowed ${M(r.econ.gov.mo.borrowed)}), no crisis`);
}

console.log("\n3. policies move the numbers they claim to");
{
  const g0 = clone(warm);
  const parcels = warmParcels;
  // (a) abatement in the pro forma
  let site = null;
  for (const bbl of c.bbls) {
    const rec = E.resolveRec(parcels, g0, bbl);
    if (!rec || rec.class !== "land" || rec.lotArea < 6000) continue;
    const fl = Math.min(E.maxFloorsFor(rec, 0.6, "multifamily"), 8);
    const gA = clone(g0); gA.econ.gov.policy.abate = null;
    const p = E.planDevelopment(gA, parcels, bbl, "multifamily", fl, 0.6, "gmp");
    if (p && p.taxYr1 > 0) { site = { bbl, fl, p }; break; }
  }
  ok(!!site, "found a lot that plans");
  if (site) {
    const gB = clone(g0); gB.econ.gov.policy.abate = { pct: 0.7, years: 15 };
    const q = E.planDevelopment(gB, parcels, site.bbl, "multifamily", site.fl, 0.6, "gmp");
    ok(q && q.taxYr1 < site.p.taxYr1 * 0.5, `abatement 70%/15y: year-one tax ${M(site.p.taxYr1)} → ${M(q?.taxYr1 ?? NaN)}`);
    ok(q && q.exitYield < site.p.exitYield && q.hurdleRatio > site.p.hurdleRatio,
      `…and the building is worth more: exit yield ${site.p.exitYield.toFixed(3)}% → ${q?.exitYield.toFixed(3)}%, hurdle ${site.p.hurdleRatio.toFixed(3)} → ${q?.hurdleRatio.toFixed(3)}`);
  }
  // (b) property tax rate → value
  const rec = c.bbls.map((b) => E.resolveRec(parcels, g0, b)).find((r) => r && r.class === "office" && r.bldgArea > 20000);
  const e1 = clone(g0.econ), e2 = clone(g0.econ);
  e1.taxMult = 1; e2.taxMult = 1.3;
  const v1 = E.assetValue(rec, e1, "standard"), v2 = E.assetValue(rec, e2, "standard");
  ok(v2 < v1, `property tax ×1.3: an office building's value ${M(v1)} → ${M(v2)}`);
  // (c) transfer tax → what a seller nets
  const h = { costBasis: 5e6, deprTaken: 0, tenants: [] };
  const s1 = clone(g0), s2 = clone(g0);
  s1.econ.gov.policy.transferRate = 0.006; s2.econ.gov.policy.transferRate = 0.012;
  const n1 = E.saleTaxQuote(h, 10e6, s1).net, n2 = E.saleTaxQuote(h, 10e6, s2).net;
  ok(Math.abs((n1 - n2) - 10e6 * 0.006) < 2, `transfer tax 0.6% → 1.2% on a $10M sale: the seller nets ${M(n1)} → ${M(n2)}`);
  // (d) rent stabilisation
  const e3 = clone(g0.econ);
  e3.nat.infl = 0.06;
  e3.gov.policy.rentCap = { share: 0.7, sinceYr: 3000 };
  const capped = E.renewalAsk(e3, 1990, 40, 30);
  ok(Math.abs(capped - 30 * (1 + 0.7 * 0.06)) < 1e-9, `stabilised renewal: asked $40 on a $30 lease → $${capped.toFixed(2)} (cap ${(0.7 * 6).toFixed(1)}%)`);
  const e4 = clone(e3); e4.gov.policy.rentCap = null;
  const free = E.flatRollStep(e4, 1990, 30, 40), held = E.flatRollStep(e3, 1990, 30, 40);
  ok(held < free, `a stabilised roll walks to market slower: $30 → $${held.toFixed(3)} vs $${free.toFixed(3)} a month`);
  const newBuild = E.renewalAsk({ ...e3, gov: { ...e3.gov, policy: { ...e3.gov.policy, rentCap: { share: 0.7, sinceYr: 2000 } } } }, 2010, 40, 30);
  ok(newBuild === 40, "a building newer than the law is not stabilised");
  // (e) services and the payroll tax pull jobs
  const base = clone(g0), cut = clone(g0), tax = clone(g0);
  cut.econ.gov.policy.service = 0.8;
  tax.econ.gov.policy.wageRate += 0.01;
  const pb = clone(parcels), pc = clone(parcels), pt = clone(parcels);
  const B = E.advanceQuarter(base, pb, c.bbls, c.adjacency), C = E.advanceQuarter(cut, pc, c.bbls, c.adjacency), T = E.advanceQuarter(tax, pt, c.bbls, c.adjacency);
  ok(C.econ.gov.jApplied < B.econ.gov.jApplied && C.econ.gov.mApplied < B.econ.gov.mApplied, `services −20%: job pull ${(B.econ.gov.jApplied * 1e4).toFixed(2)} → ${(C.econ.gov.jApplied * 1e4).toFixed(2)} bp, residents ${(C.econ.gov.mApplied * 1e4).toFixed(2)} bp`);
  ok(T.econ.gov.jApplied < B.econ.gov.jApplied, `payroll tax +1pt: job pull ${(T.econ.gov.jApplied * 1e4).toFixed(2)} bp`);
  ok(C.econ.gov.mo.spend.services < B.econ.gov.mo.spend.services * 0.85, `…and services spending ${M(B.econ.gov.mo.spend.services * 12)} → ${M(C.econ.gov.mo.spend.services * 12)} a year`);
}

console.log(fails ? `\nFAIL — ${fails} check${fails === 1 ? "" : "s"}` : "\nPASS — the budget balances, crises are failed rollovers, policies bite");
process.exit(fails ? 1 : 0);
