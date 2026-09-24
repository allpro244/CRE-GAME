// THE SHEET MOVES. Underwriting standards, property type, the engineer's
// report and your file each move a desk's advance rate; the coverage tests
// loosen at the top of the cycle; and the debt fund's appetite is its own,
// not a bank's.
//
//   pnpm engine && pnpm advance
//
// GATE. Measured before this existed (`pnpm ltvdist`, six seeds x 30 years):
// the best senior advance on a live listing sat at 53-62% between the
// quartiles in every cut — credit window, phase, era, class, occupancy —
// because every stated rate was a constant and the only lever could cut.
//
// STANDING FACT: no playtest in this repo is based on Manhattan. Every
// harness run and number here is a GENERATED city.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, bbls, adjacency } = loadCity(0, E.normalizeParcels);

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) fails++; };
const near = (a, b, tol = 0.0051) => Math.abs(a - b) <= tol;
const pc = (x) => `${(x * 100).toFixed(1)}%`;

const base = E.firstListings(E.newGame(550991, parcels), parcels, bbls);
const at = (ci, app) => { const g = structuredClone(base); g.econ.creditIdx = ci; g.bankApp = app; return g; };
const shut = at(0.5, 0.5), mid = at(0.9, 0.9), loose = at(1.2, 1.15);

// --- 1. the standards index spans the scale and the sheets follow it --------
const stS = E.underwritingStandards(shut), stM = E.underwritingStandards(mid), stL = E.underwritingStandards(loose);
ok(stS <= -0.95 && near(stM, 0, 0.02) && stL >= 0.95, `standards: shut ${stS.toFixed(2)}, mid ${stM.toFixed(2)}, loose ${stL.toFixed(2)}`);
for (const id of ["harbor", "savings", "savings25", "pelican", "conduit", "cordage", "mezz", "land"]) {
  const p = E.productById(id);
  const a = E.statedLtv(shut, p).ltv, b = E.statedLtv(mid, p).ltv, c = E.statedLtv(loose, p).ltv;
  ok(a < b && b < c && near(b, p.ltv), `${id.padEnd(9)} sheet shut ${pc(a)} < mid ${pc(b)} (= ${pc(p.ltv)}) < loose ${pc(c)}`);
}
{
  const h = E.productById("harbor"), sv = E.productById("savings"), ld = E.productById("land");
  ok(near(E.statedLtv(shut, h).ltv, 0.58) && near(E.statedLtv(loose, h).ltv, 0.73), `harbor runs 58% shut to 73% loose around its 68% sheet`);
  ok(near(E.statedLtv(shut, sv).ltv, 0.60) && near(E.statedLtv(loose, sv).ltv, 0.78), `regional runs 60% shut to 78% loose around its 72% sheet`);
  ok(near(E.statedLtv(shut, ld).ltv, 0.35) && near(E.statedLtv(loose, ld).ltv, 0.60), `land money runs 35% shut to 60% loose — first to go, last back`);
  ok(E.statedLtv(loose, E.productById("mezz"), "multifamily").ltv <= 0.95 - 0.03 + 1e-9, `the mezz stack never opens in breach of its own 95% covenant`);
}

// --- 2. property type, condition, and your file -----------------------------
{
  const sv = E.productById("savings");
  const office = E.statedLtv(mid, sv, "office", "standard").ltv;
  ok(near(E.statedLtv(mid, sv, "multifamily", "standard").ltv, office + 0.05), `apartments: five points over the office sheet`);
  ok(near(E.statedLtv(mid, sv, "industrial", "standard").ltv, office + 0.02), `warehouses: two over`);
  ok(near(E.statedLtv(mid, sv, "retail", "standard").ltv, office - 0.02), `shops: two under`);
  ok(near(E.statedLtv(mid, sv, "office", "worn").ltv, office - 0.03) && near(E.statedLtv(mid, sv, "office", "obsolete").ltv, office - 0.03),
    `a worn or obsolete building has three points held back for the repairs`);
  ok(near(E.statedLtv(mid, sv, "office", "good").ltv, office), `a good building is the sheet`);
  const ld = E.productById("land");
  ok(near(E.statedLtv(mid, ld, "land", "worn").ltv, ld.ltv), `dirt has no class band and no engineer's report`);
  const g = structuredClone(mid); g.lenderRel = { "First Harbor Bank": 100, "Cordage Debt Partners": 100, "Meridian Street Capital": 100 };
  const h = E.productById("harbor");
  ok(near(E.statedLtv(g, h).ltv, E.statedLtv(mid, h).ltv + 0.04), `a full file at the hometown bank is worth four points of advance`);
  ok(near(E.statedLtv(g, E.productById("cordage")).ltv, E.statedLtv(mid, E.productById("cordage")).ltv)
    && near(E.statedLtv(g, E.productById("conduit")).ltv, E.statedLtv(mid, E.productById("conduit")).ltv), `the debt fund and the conduit have no file to reward`);
  const why = E.statedLtv(g, h, "multifamily", "worn").why.join(", ");
  ok(/their 68% sheet/.test(why) && /\+5 for multifamily/.test(why) && /−3 held back/.test(why) && /\+4 for your file/.test(why), `the sheet says how it was built: "${why}"`);
  const before = JSON.stringify(mid); E.statedLtv(mid, sv, "office", "worn"); E.underwritingStandards(mid);
  ok(JSON.stringify(mid) === before, `reading the sheet mutates nothing`);
}

// --- 3. coverage and debt yield loosen at the top, and only there -----------
{
  // the regional: its hold size and single-name room clear a $10M loan, so only the three legs speak
  const p = E.productById("savings");
  // the window fully open in both (tight = 0, same coupon); only the desks' appetite differs
  const a = at(1.0, 0.9), b = at(1.0, 1.15);
  const la = Math.max(0, E.underwritingStandards(a)), lb = Math.max(0, E.underwritingStandards(b));
  ok(lb > la + 0.3, `standards ${la.toFixed(2)} → ${lb.toFixed(2)} on the street's appetite alone`);
  const qa = E.quote(a, p, 10_000_000, 700_000, "office", false, undefined, "standard");
  const qb = E.quote(b, p, 10_000_000, 700_000, "office", false, undefined, "standard");
  ok(near(qa.ratePct, qb.ratePct, 0.011), `same coupon in both (${qa.ratePct}% / ${qb.ratePct}%)`);
  const expDscr = (p.uwDscr - 0.07 * la) / (p.uwDscr - 0.07 * lb);
  const expDy = (1 - 0.12 * la) / (1 - 0.12 * lb);
  const expLtv = E.statedLtv(b, p, "office", "standard").ltv / E.statedLtv(a, p, "office", "standard").ltv;
  ok(near(qb.byDscr / qa.byDscr, expDscr, 0.003), `coverage leg: ${pc(qb.byDscr / qa.byDscr - 1)} more proceeds when standards loosen (expected ${pc(expDscr - 1)})`);
  ok(near(qb.byDebtYield / qa.byDebtYield, expDy, 0.003), `debt-yield leg: ${pc(qb.byDebtYield / qa.byDebtYield - 1)} more (expected ${pc(expDy - 1)})`);
  ok(!qa.holdCapped && !qb.holdCapped && near(qb.byLtv / qa.byLtv, expLtv, 0.003), `advance leg: ${pc(qb.byLtv / qa.byLtv - 1)} more (expected ${pc(expLtv - 1)})`);
  // and a shut window does what it always did — the tight terms are untouched
  const c = at(0.5, 0.5);
  const qc = E.quote(c, p, 10_000_000, 700_000, "office", false, undefined, "standard");
  ok(qc.byDscr < qa.byDscr && qc.byDebtYield < qa.byDebtYield && qc.byLtv < qa.byLtv, `every leg is smaller with the window shut (advance ${pc(qc.byLtv / 1e7)} vs ${pc(qa.byLtv / 1e7)})`);
}

// --- 4. the acquisition card reports today's sheet --------------------------
{
  let g = base; let done = false;
  for (const L of g.listings) {
    const rec = E.resolveRec(parcels, g, L.bbl);
    if (!rec || rec.class === "land" || !rec.bldgArea) continue;
    const q = E.buyQuote(g, parcels, L.bbl, L.ask, "harbor", 1);
    if (q.principal <= 0) continue;
    const sheet = E.statedLtv(g, E.productById("harbor"), rec.class, E.gradeOf(g, rec)).ltv;
    ok(near(q.ltvCap, sheet) && typeof q.sheetWhy === "string" && /sheet/.test(q.sheetWhy), `buyQuote.ltvCap ${pc(q.ltvCap)} is the sheet today (${q.sheetWhy})`);
    done = true; break;
  }
  ok(done, "found a financeable listing at the opening bell");
}

// --- 5. the debt fund's appetite is its own ---------------------------------
{
  let g = base;
  for (let q = 0; q < 16; q++) g = E.advanceQuarter(g, parcels, bbls, adjacency);
  const c = g.lenders.find((l) => l.name === "Cordage Debt Partners");
  const nim = (c.bookYield ?? 0) - (c.fundCost ?? 0) - (c.panicBps ?? 0);
  ok(c.appetite >= 0.8, `Cordage at month ${g.month} (${g.econ.phase}, credit ${g.econ.creditIdx.toFixed(2)}): appetite ${c.appetite.toFixed(2)} on a ${nim.toFixed(2)}-point margin (was 0.3 on 0.8 points)`);
  const h = g.lenders.find((l) => l.name === "First Harbor Bank");
  ok(near(h.bookYield - g.econ.indexRate, 1.9, 1.2), `the hometown bank's book still reprices toward index + 1.9 (now index + ${(h.bookYield - g.econ.indexRate).toFixed(2)})`);
}

// --- 6. the desks' minimum cheques are written for this town --------------
{
  const g = E.firstListings(E.newGame(550991, parcels), parcels, bbls);
  const built = g.listings.filter((li) => { const r = E.resolveRec(parcels, g, li.bbl); return r && r.class !== "land" && r.bldgArea > 0 && !li.halfBuilt; });
  const quotes = (id) => built.filter((li) => E.buyQuote(g, parcels, li.bbl, li.ask, id, 1).principal > 0).length / Math.max(1, built.length);
  ok(g.loanScale !== undefined && g.loanScale > 0.2 && g.loanScale < 1, `this town's loan scale is ${g.loanScale} (median built value over a $4M reference)`);
  const sv = E.productById("savings"), cd = E.productById("conduit"), pl = E.productById("pelican");
  ok(E.loanMin(g, sv) < sv.minLoan && E.loanMin(g, sv) >= 500_000, `the regional's minimum cheque here is $${(E.loanMin(g, sv) / 1e6).toFixed(2)}M, not $2.5M`);
  ok(E.loanMin(g, cd) >= 1_000_000 && E.loanMin(g, cd) < cd.minLoan, `the conduit's is $${(E.loanMin(g, cd) / 1e6).toFixed(2)}M, floored at $1M`);
  ok(quotes("savings") >= 0.3, `the regional quotes ${(quotes("savings") * 100).toFixed(0)}% of the opening tape (was 9%)`);
  // the life company across three towns and two dates — it is the desk most sensitive to the window and the grade
  let pn = 0, pq = 0;
  for (const seed of [12007, 11, 4242]) {
    let g2 = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
    for (let q = 0; q < 20; q++) g2 = E.advanceQuarter(g2, parcels, bbls, adjacency);
    for (const li of g2.listings) { const r = E.resolveRec(parcels, g2, li.bbl); if (!r || r.class === "land" || !r.bldgArea || li.halfBuilt) continue; pn++; if (E.buyQuote(g2, parcels, li.bbl, li.ask, "pelican", 1).principal > 0) pq++; }
  }
  ok(pn > 25 && pq / pn >= 0.08, `the life company quotes ${(pq / pn * 100).toFixed(0)}% of ${pn} listings five years in, three towns — standard buildings at a quarter point more (was 0%)`);
  const qGood = E.quote(g, pl, 6_000_000, 450_000, "office", false, undefined, "good"), qStd = E.quote(g, pl, 6_000_000, 450_000, "office", false, undefined, "standard"), qWorn = E.quote(g, pl, 6_000_000, 450_000, "office", false, undefined, "worn");
  ok(near(qStd.ratePct - qGood.ratePct, 0.25, 0.011) && E.conditionOk(pl, "standard") && !E.conditionOk(pl, "worn"), `Pelican: standard +${(qStd.ratePct - qGood.ratePct).toFixed(2)}% over good; worn refused${qWorn.principal > 0 ? " (quote path still sizes; originate refuses)" : ""}`);
}

// --- 7. who is signing for this: the guarantor test, and the price of a strong name
{
  const g = E.firstListings(E.newGame(550991, parcels), parcels, bbls);
  const mid = structuredClone(g); mid.econ.creditIdx = 1.0; mid.bankApp = 1.0;
  const sv = E.productById("savings"), pl = E.productById("pelican"), cd = E.productById("cordage");
  const thin = { nw: 2_000_000 }, rich = { nw: 60_000_000 };
  const qThin = E.quote(mid, sv, 12_000_000, 900_000, "office", false, undefined, "standard", thin);
  const qRich = E.quote(mid, sv, 12_000_000, 900_000, "office", false, undefined, "standard", rich);
  ok(qThin.guarantorConstrained === true && qThin.principal === 4_000_000 && /worth half the loan/.test(qThin.guarantorWhy ?? ""), `a $2M sponsor at the regional on a $12M building: capped at $${(qThin.principal / 1e6).toFixed(1)}M — "${qThin.guarantorWhy}"`);
  ok(!qRich.guarantorConstrained && qRich.principal > 6_000_000, `a $60M sponsor: not capped ($${(qRich.principal / 1e6).toFixed(1)}M)`);
  ok(near(qThin.ratePct - qRich.ratePct, 0.10, 0.011), `and the strong name is worth a tenth of a point on recourse paper (${qThin.ratePct}% vs ${qRich.ratePct}%)`);
  const nThin = E.quote(mid, cd, 12_000_000, 900_000, "office", false, undefined, "standard", thin), nRich = E.quote(mid, cd, 12_000_000, 900_000, "office", false, undefined, "standard", rich);
  ok(!nThin.guarantorConstrained && nThin.principal === nRich.principal && nThin.ratePct === nRich.ratePct, `the debt fund sizes on the building alone: $${(nThin.principal / 1e6).toFixed(1)}M either way`);
  ok(E.guarantorCap(thin, pl) === Infinity, `the life company is non-recourse — no guarantor test`);
  ok(near(E.allInCostPct(cd, 9.0), 9.0 + (0.02 + 0.0125) * 100 / 3, 0.011), `all-in on the bridge: 9.00% coupon reads ${E.allInCostPct(cd, 9.0).toFixed(2)}% (two points and the cap over three years)`);
  ok(near(E.allInCostPct(sv, 6.0), 6.0 + 0.008 * 100 / 7, 0.011), `all-in on the regional: 6.00% reads ${E.allInCostPct(sv, 6.0).toFixed(2)}% (eight tenths of a point over seven years)`);
  const adv = E.deskAdvice([
    { id: "savings", label: "Alden", lender: "Alden Savings & Trust", maxProceeds: 6_000_000, allInPct: 6.11, available: true },
    { id: "cordage", label: "Cordage", lender: "Cordage Debt Partners", maxProceeds: 7_500_000, allInPct: 10.08, bridge: true, available: true },
  ], 5_000_000, true);
  ok(/Cheapest money that clears the payoff: Alden Savings & Trust at 6.11%/.test(adv ?? "") && /bridge money on a building that is already let/.test(adv ?? "") && /3.97 points a year more/.test(adv ?? ""), `the desk's advice: "${adv}"`);
}

console.log(fails ? `\n${fails} FAILED` : "\nALL PASS");
process.exit(fails ? 1 : 0);
