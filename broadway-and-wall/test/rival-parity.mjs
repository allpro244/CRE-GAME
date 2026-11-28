// NAMED COMPETITORS PAY FOR CONSTRUCTION AND FORECLOSURE CURES.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels } = loadCity(0, E.normalizeParcels);

let bad = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`);
  if (!ok) bad++;
};

console.log("\nRIVAL ECONOMIC PARITY\n");

{
  const g = E.newGame(98211, parcels);
  const r = g.rivals[0];
  r.cash = 0;
  r.debt = 100_000;
  g.month = 5;
  g.cityJobs = [{
    bbl: r.bbls[0] ?? Object.keys(parcels)[0],
    use: "office", sf: 20_000, floors: 5, startM: 0, deliverM: 10,
    firmId: r.id, cost: 1_000_000, spent: 0, equityLeft: 0,
    debt: 100_000, commitment: 100_000, ratePct: 8,
  }];
  E.fundJobs(g);
  check(g.cityJobs[0].orphaned === true,
    "rival job stops when commitment is exhausted and sponsor cannot fund the call");
  check((g.cityJobs[0].debt ?? 0) <= (g.cityJobs[0].commitment ?? 0),
    "rival construction debt never exceeds its commitment");
}

{
  const g = E.newGame(98212, parcels);
  const r = g.rivals.find((x) => x.bbls.length) ?? g.rivals[0];
  const bbl = r.bbls[0] ?? Object.keys(parcels)[0];
  if (!r.bbls.includes(bbl)) r.bbls.push(bbl);
  r.cash = 200_000;
  r.stressMs = 0;
  g.lenders = [];
  g.bankFcls = [{
    bbl, lender: "Harbor National", firmId: r.id, firm: r.name,
    debt: 1_000_000, noticedM: 20, saleM: 30,
  }];
  const before = r.cash;
  E.tickBankForeclosures(g, parcels);
  check(!g.bankFcls.some((x) => x.bbl === bbl), "funded rival foreclosure reinstates");
  check(before - r.cash === 80_000, "rival actually pays the 8% cure rather than winning a free lottery");
}

{
  const g = E.newGame(98213, parcels);
  const r = g.rivals[0];
  r.cash = 20_000_000;
  r.debt = 1_000_000;
  g.month = 1;
  g.cityJobs = [{
    bbl: r.bbls[0] ?? Object.keys(parcels)[0],
    use: "office", sf: 200_000, floors: 20, startM: 0, deliverM: 10,
    firmId: r.id, cost: 100_000_000, spent: 0, equityLeft: 0,
    debt: 1_000_000, commitment: 70_000_000, ratePct: 8,
    lender: "Regional Bank", repudiatedM: 0, replaceM: 0,
  }];
  E.fundJobs(g);
  check(g.cityJobs[0].repudiatedM !== undefined,
    "replacement lender refuses a facility whose total sources cannot finish the rival job");
}

{
  const g = E.newGame(98214, parcels);
  const r = g.rivals[0];
  r.mktOcc = 0.88;
  r.occ = 0.72;
  const source = Object.values(parcels).find((x) => x.class !== "land" && x.bldgArea > 0);
  const low = { ...source, demandScore: 12 };
  const high = { ...source, demandScore: 92 };
  const markedLow = E.markAsset(g, r, low);
  const markedHigh = E.markAsset(g, r, high);
  const baseLow = E.assetValue(low, g.econ, E.assetGrade(r, low));
  const baseHigh = E.assetValue(high, g.econ, E.assetGrade(r, high));
  const lowScale = markedLow.v / Math.max(1, baseLow);
  const highScale = markedHigh.v / Math.max(1, baseHigh);
  check(lowScale < highScale,
    "portfolio stress penalizes a weak rival asset more than a strong one");
}

// ONE RULEBOOK FOR IDLE CASH (playtest F6). A competitor's cash earns what
// the player's earns — the operating account at the bank's deposit rate, the
// rest in bills (lenders.ts cashInterestMonthly) — and it pays the same office
// whether or not it owns anything (sim.ts firmOverheadMonthly). The street
// used to earn the bill rate on its whole balance, untaxed, and an empty firm
// paid no overhead, so its $2.5M compounded at ~3.4% while the player's made
// 1.3%.
{
  const emptyFirm = (seed, cash, month) => {
    const g = E.newGame(seed, parcels);
    g.econ.nat.policy = 5;
    const r = g.rivals.find((x) => x.failedM === undefined && !x.builderProf && !(g.cityJobs ?? []).some((j) => j.firmId === x.id));
    for (const [b, l] of Object.entries(g.cityLoans ?? {})) if (l.obligorId === r.id) delete g.cityLoans[b];
    r.bbls = []; r.debt = 0; r.lineBal = 0; r.basis = 0; r.extendedTo = {}; r.stressMs = 0;
    r.cash = cash; g.month = month;
    return { g, r };
  };
  const busy = (g, r) => r.bbls.length > 0 || (g.cityJobs ?? []).some((j) => j.firmId === r.id);
  // An ordinary month, under the distribution floor: the change in the account
  // is the month's interest less the office, to the dollar.
  {
    const { g, r } = emptyFirm(98213, 600_000, 5);
    const c0 = r.cash;
    const office = E.firmOverheadMonthly({ ...g, prevGav: 0 }, parcels);
    const want = Math.round(E.cashInterestMonthly(g, c0)) - office;
    E.tickRivals(g, parcels);
    const on5m = Math.round(E.cashInterestMonthly(g, 5e6));
    check(office > 0 && on5m > 0, `the office and the interest are real numbers ($${office}/mo; $${on5m}/mo on $5M)`);
    check(busy(g, r) || r.cash - c0 === want,
      `an empty firm's month is the player's rule: interest less the office ($${(r.cash - c0).toLocaleString()} against $${want.toLocaleString()})`);
  }
  // A December: the interest is taxed, net of the office, as the player's is
  // (sim.ts: depositInterestYr is ordinary income, last year's G&A deductible).
  {
    const { g, r } = emptyFirm(98213, 3_000_000, 12);
    const c0 = r.cash, t0 = r.taxPaid ?? 0;
    const office = E.firmOverheadMonthly({ ...g, prevGav: 0 }, parcels);
    const want = Math.round((E.cashInterestMonthly(g, c0) * 12 - office * 12) * E.INCOME_TAX_RATE);
    E.tickRivals(g, parcels);
    const paid = (r.taxPaid ?? 0) - t0;
    check(busy(g, r) || (want > 0 && Math.abs(paid - want) <= 1),
      `an empty firm's deposit interest is taxed, net of overhead, like the player's ($${paid.toLocaleString()} paid against $${want.toLocaleString()})`);
  }
  // An empty, debt-free firm that cannot pay next month's office closes it;
  // the office alone must not walk a firm with no creditor through the debt
  // arrears calendar (no "fell behind on its debt", no negative balance).
  {
    const { g, r } = emptyFirm(98213, 1_000, 5);
    r.uncalled = 0;
    E.tickRivals(g, parcels);
    check(busy(g, r) || (r.failedM === g.month && r.endReason === "woundUp" && !(r.stressMs > 0) && r.cash >= 0),
      `an empty firm that cannot pay its office winds up instead of falling into arrears (end ${r.endReason ?? "none"}, arrears ${r.stressMs ?? 0}, cash $${Math.round(r.cash).toLocaleString()})`);
  }
}

console.log("");
process.exit(bad ? 1 : 0);
