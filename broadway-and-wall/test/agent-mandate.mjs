// LEASING PLAN — desk works a posted sheet, not four mandate bands.
//
//   pnpm exec node test/agent-mandate.mjs
import { assertFreshBundle } from "./fresh.mjs";
if (!process.env.ENGINE) assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(process.env.ENGINE ? join(HERE, "..", process.env.ENGINE) : join(HERE, ".engine.mjs"));

let bad = 0;
const fail = (m) => { bad++; console.log(`  FAIL  ${m}`); };
const ok = (m) => console.log(`  OK    ${m}`);

console.log("\nLEASING PLAN\n");

// Score: fat TI pulls net effective down vs face-only.
{
  const loi = {
    id: 1, bbl: "x", kind: "new", name: "Acme", sector: "tech", credit: 2,
    sf: 10000, rentPsf: 40, termM: 120, tiPsf: 60, freeM: 0, net: true,
  };
  const faceOnly = 40 / 40; // 1.0 if judged on face
  const score = E.loiMandateScore(loi, 40);
  if (!(score < 0.92)) fail(`fat TI should pull score under par (got ${score.toFixed(3)}, face would be ${faceOnly})`);
  else ok(`fat TI lowers mandate score (${score.toFixed(3)} vs face 1.00)`);
}

// Starter sheet: the default brief — two dials, sign within eight points of market, hold a year.
{
  const plan = E.starterPlan();
  const row = plan.sheet.office;
  if (Math.abs(row.targetNePct - 0.92) > 0.001 || row.patienceM !== 12) fail(`starter brief should be 92% / 12 mo (got ${JSON.stringify(row)})`);
  else ok(`starter brief is ${(row.targetNePct * 100).toFixed(0)}% net effective, ${row.patienceM} months' patience`);
  if (Object.keys(row).some((k) => ["quotePct", "maxTiPsf", "maxFreeM", "termLoM"].includes(k))) fail("starter row still carries a package filter");
  else ok("no package filters on the starter row");
}

// Total upfront cash includes commission, not only the line labelled TI.
{
  const loi = {
    id: 2, bbl: "x", kind: "new", name: "Long Paper", sector: "tech", credit: 2,
    sf: 10_000, rentPsf: 40, termM: 120, tiPsf: 20, freeM: 0, net: true,
  };
  const tiM = E.loiTiMonths(loi);
  const allM = E.loiSigningMonths(loi, E.AGENT_FEE);
  if (Math.abs(tiM - 6) > 0.01) fail(`TI should be 6.0 months (got ${tiM.toFixed(1)})`);
  else ok("TI is measured proportionately to face rent");
  if (!(allM > tiM + 1)) {
    fail(`TI + commission should exceed TI-only (${allM.toFixed(1)} vs ${tiM.toFixed(1)} months)`);
  } else ok(`total upfront cash catches what TI-only misses (${allM.toFixed(1)} months)`);
}

// The desk protects operating liquidity even when one lease is individually fundable.
{
  const reserve = E.agentCashReserve({
    holdings: {
      a: { loan: { monthlyPmt: 40_000 } },
      b: { loan: { monthlyPmt: 20_000 } },
    },
    facility: null,
    loc: { balance: 0 },
    econ: { indexRate: 5 },
  });
  if (reserve !== 360_000) fail(`six months of $60K debt service should reserve $360K (got ${reserve})`);
  else ok("delegated desk protects six months of debt service");
}

// Refer leaves the letter; pass deletes it.
{
  const { loadCity } = await import(join(HERE, "city.mjs"));
  const { parcels, bbls } = loadCity(2, E.normalizeParcels);
  let g = E.firstListings(E.newGame(77001, parcels), parcels, bbls);
  g = { ...g, cash: 200e6, agent: true, leasingPlan: E.starterPlan({ ...E.STARTER_PLAN_ROW, targetNePct: 0.95 }) };

  // Buy something and wait for an LOI.
  let loi = null;
  for (let m = 0; m < 90 && !loi; m++) {
    g = E.advanceQuarter(g, parcels, bbls, null);
    g = { ...g, cash: Math.max(g.cash, 200e6), agent: true, leasingPlan: E.starterPlan({ ...E.STARTER_PLAN_ROW, targetNePct: 0.95 }) };
    for (const L of g.listings ?? []) {
      if (g.holdings[L.bbl]) continue;
      const rec = E.resolveRec(parcels, g, L.bbl);
      if (!rec || rec.class === "land" || !rec.bldgArea) continue;
      const r = E.executePurchase(g, parcels, L.bbl, L.ask, null, false, 0);
      if (r?.s?.holdings[L.bbl]) { g = { ...r.s, cash: 200e6, agent: true, leasingPlan: E.starterPlan({ ...E.STARTER_PLAN_ROW, targetNePct: 0.95 }) }; break; }
    }
    loi = (g.lois ?? []).find((l) => l.kind === "new") ?? null;
  }
  if (!loi) {
    console.log("  SKIP  no LOI in window to exercise refer/pass");
  } else {
    // Force a mid-band letter: score between pass and floor by editing rent.
    const rec = E.resolveRec(parcels, g, loi.bbl);
    const h = g.holdings[loi.bbl];
    const market = E.managedRentPsfYr(rec, g.econ, h, loi.use);
    const mid = structuredClone(g);
    const target = mid.lois.find((l) => l.id === loi.id);
    target.rentPsf = +(market * 0.88).toFixed(2);
    target.tiPsf = 0;
    target.freeM = 0;
    target.referred = false;
    // One month of agent desk.
    mid.agent = true;
    mid.leasingPlan = E.starterPlan({ ...E.STARTER_PLAN_ROW, targetNePct: 0.95 });
    // tickLeasing runs the agent — advance one month via advanceQuarter's internals
    // by calling through a month of sim if exported; else re-run via advanceQuarter.
    const after = E.advanceQuarter(mid, parcels, bbls, null);
    const still = (after.lois ?? []).find((l) => l.id === loi.id);
    const news = (after.news ?? []).slice(0, 12).map((n) => n.text).join(" ");
    const negotiated = !still
      || still.referred
      || still.countered
      || /countered|walked|referred|passed|took/i.test(news);
    if (negotiated) ok("mid-band letter was negotiated by the desk (not left untouched)");
    else fail("mid-band letter sat on the open pile with no desk action");

    // Even a permissive mandate may not choose between mutually-exclusive
    // tenants or commit adjacent space to an incumbent expansion.
    const choice = structuredClone(g);
    const base = choice.lois.find((l) => l.id === loi.id);
    base.tourId = 999;
    base.rentPsf *= 1.1;
    base.tiPsf = 0;
    base.freeM = 0;
    base.referred = false;
    const rival = { ...structuredClone(base), id: Math.max(...choice.lois.map((l) => l.id)) + 1, name: "Competing Tenant" };
    choice.lois = [base, rival];
    choice.agent = true;
    choice.leasingPlan = E.starterPlan({ ...E.STARTER_PLAN_ROW, targetNePct: 0.70 });
    // "mine": every competing tour is the principal's.
    const mine = structuredClone(choice);
    mine.leasingPlan.tourRule = "mine";
    const afterChoice = E.advanceQuarter(mine, parcels, bbls, null);
    const decided = afterChoice.lois.filter((l) => l.id === base.id || l.id === rival.id);
    if (decided.length === 2 && decided.every((l) => l.referred)) {
      ok("tour rule \"mine\": a competitive tour is referred so the principal chooses");
    } else fail("agent chose a winner from a competitive tour under \"mine\"");
    // default "best": same credit, so not a dead heat — the desk picks one.
    const best = E.advanceQuarter(structuredClone(choice), parcels, bbls, null);
    const left = best.lois.filter((l) => l.id === base.id || l.id === rival.id);
    if (left.length <= 1 && !left.some((l) => l.referred)) ok(`tour rule "best": the desk takes one and the other loses the space (${left.length} left)`);
    else fail(`tour rule "best" still referred the tour (${left.map((l) => l.referred).join(",")})`);
    // a dead heat on different covenants stays the principal's
    const heat = structuredClone(choice);
    heat.lois[1].credit = heat.lois[0].credit === 2 ? 1 : 2;
    const afterHeat = E.advanceQuarter(heat, parcels, bbls, null);
    const h2 = afterHeat.lois.filter((l) => l.id === base.id || l.id === rival.id);
    if (h2.length === 2 && h2.every((l) => l.referred)) ok("a dead heat on different credit is referred");
    else fail("desk decided a dead heat between covenants");

    const expansion = structuredClone(g);
    const ex = expansion.lois.find((l) => l.id === loi.id);
    ex.kind = "expansion";
    ex.referred = false;
    ex.rentPsf *= 1.1;
    ex.tiPsf = 0;
    expansion.lois = [ex];
    expansion.agent = true;
    expansion.leasingPlan = E.starterPlan({ ...E.STARTER_PLAN_ROW, targetNePct: 0.70 });
    const afterExpansion = E.advanceQuarter(expansion, parcels, bbls, null);
    if (afterExpansion.lois[0]?.referred) ok("incumbent expansion is referred to the principal");
    else fail("agent auto-signed an incumbent expansion");
  }
}

console.log("");
process.exit(bad ? 1 : 0);
