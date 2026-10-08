// MDGA instrument — DOES A BUILDING DELIVER WHAT ITS PLAN PROMISED? (MDGA_PLAN.md, F6)
// At six points in a run, puts the best scheme on the four highest-residual
// vacant lots (cash unconstrained, auto-lease on at Market), follows each to
// 36 months after delivery, and prints plan NOI / plan value against the
// value at delivery, NOI and value at +36 months, and the takeout loan.
//   pnpm engine && node tools/mdga/plan-vs-delivered.mjs   (slow: ~15 min)
//   PICK=fringe USE=multifamily …   small low-demand lots, the seed-4 shape
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, "..", "..", "test", ".engine.mjs"));
const { loadCity } = await import(join(HERE, "..", "..", "test", "city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const SEED = Number(process.env.SEED ?? 7919);
const FRINGE = process.env.PICK === "fringe";
const USE_ONLY = process.env.USE;
const USES = ["multifamily", "office", "retail", "industrial"];
const M = (n) => `$${(n / 1e6).toFixed(2)}M`;
const bestPlan = (g, bbl) => {
  const rec = E.resolveRec(parcels, g, bbl);
  let pick = null;
  for (const use of USES) {
    if (USE_ONLY && use !== USE_ONLY) continue;
    if (E.zoneUseBar(rec, use, g.econ)) continue;
    const cov = E.MAX_COVERAGE[use] ?? 0.7;
    const maxFl = Math.min(E.maxFloorsFor(rec, cov, use), FRINGE ? 5 : 12);
    for (const fl of [...new Set([2, 4, 6, 8, maxFl])].filter((f) => f >= 1 && f <= maxFl)) {
      const p = E.planDevelopment(g, parcels, bbl, use, fl, cov, "gmp");
      if (p && Number.isFinite(p.hurdleRatio) && (!pick || p.hurdleRatio > pick.p.hurdleRatio)) pick = { p, use, fl, cov };
    }
  }
  return pick;
};
let w = E.firstListings(E.newGame(SEED, parcels), parcels, bbls);
const rows = [];
const SAMPLES = [24, 72, 120, 168, 216, 264];
let m = 0;
for (const at of SAMPLES) {
  while (m < at) { w = E.advanceMonth(w, parcels, bbls, adjacency); if (w.gameOver) w = { ...w, gameOver: null, cash: 5e6 }; m++; }
  // the most promising vacant lots this month
  const cands = [];
  for (const b of bbls) {
    const rec = E.resolveRec(parcels, w, b);
    if (rec?.class !== "land" || w.holdings[b] || !rec.lotArea || rec.lotArea < 3000) continue;
    // PICK=fringe: small low-demand lots — the seed-4 shape (MDGA F7)
    if (FRINGE && (rec.demandScore >= 40 || rec.lotArea > 15000)) continue;
    const lr = E.landRead(rec, w.econ);
    cands.push({ b, s: FRINGE ? rec.demandScore : lr.builder });
  }
  cands.sort((a, b) => b.s - a.s);
  for (const { b } of cands.slice(0, 4)) {
    let g = structuredClone(w);
    const rec = E.resolveRec(parcels, g, b);
    g.holdings[b] = { bbl: b, costBasis: Math.round(E.landValue(rec, g.econ)), tenants: [], boughtM: g.month, condition: "good", loan: null, cfHistory: [], autoLease: true, stance: 0 };
    g.cash = 1e9;
    const pk = bestPlan(g, b);
    if (!pk) continue;
    const p = pk.p;
    const r = E.startDevelopment(g, parcels, b, pk.use, pk.fl, pk.cov, "gmp");
    if (r.err) { rows.push({ at, b, err: r.err }); continue; }
    g = r.s;
    const u = pk.use === "mixed" ? "office" : pk.use;
    const belief = (g.econ.rentExp?.[u] ?? 0) / (g.econ.rentIdx?.[u] || 1);
    const deliverM = g.developments[b].deliverM;
    let atDel = null;
    while (g.month < deliverM + 36) {
      g = E.advanceMonth(g, parcels, bbls, adjacency);
      if (g.gameOver) g = { ...g, gameOver: null, cash: 1e9 };
      g.cash = Math.max(g.cash, 1e8);
      const h = g.holdings[b];
      if (!g.developments[b] && h && !atDel) {
        const r2 = E.resolveRec(parcels, g, b);
        atDel = { v: E.holdingValue(r2, g.econ, h, g.month), occ: E.physicalOcc(r2, h) };
      }
    }
    const h = g.holdings[b];
    if (!h) { rows.push({ at, b, err: "lost" }); continue; }
    const r3 = E.resolveRec(parcels, g, b);
    const noi = E.holdingNOIYr(r3, g.econ, h, g.month);
    const spotNoi = E.noiYr(r3, g.econ, "good", true);
    rows.push({
      at, use: pk.use, fl: pk.fl, h: p.hurdleRatio, cost: p.basisTotal, planNoi: p.stabNoi, planVal: p.stabNoi / (p.exitYield / 100),
      belief, delV: atDel?.v, delOcc: atDel?.occ, noi36: noi, spotStab36: spotNoi, v36: E.holdingValue(r3, g.econ, h, g.month),
      occ36: E.physicalOcc(r3, h), loanRate: h.loan?.ratePct, loanBal: h.loan?.balance, phase0: w.econ.phase,
    });
  }
}
console.log("start | use fl | hurdle | basis | plan NOI | plan value | rentExp/rent @plan | value@delivery (occ) | NOI@+36mo | market-stab NOI@+36 | value@+36 (occ) | loan");
for (const r of rows) {
  if (r.err) { console.log(`m${r.at} ${r.b}: ${r.err}`); continue; }
  console.log(`m${r.at} ${r.phase0.padEnd(10)} | ${r.use} ${r.fl} | ${r.h.toFixed(2)} | ${M(r.cost)} | ${M(r.planNoi)} | ${M(r.planVal)} | ${r.belief.toFixed(2)} | ${M(r.delV ?? 0)} (${((r.delOcc ?? 0) * 100).toFixed(0)}%) = ${((r.delV ?? 0) / r.cost).toFixed(2)}x basis | ${M(r.noi36)} = ${(r.noi36 / r.planNoi).toFixed(2)}x plan | ${M(r.spotStab36)} = ${(r.spotStab36 / r.planNoi).toFixed(2)}x | ${M(r.v36)} (${(r.occ36 * 100).toFixed(0)}%) = ${(r.v36 / r.planVal).toFixed(2)}x plan val | ${M(r.loanBal ?? 0)} @${(r.loanRate ?? 0).toFixed(1)}%`);
}
