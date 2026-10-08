// BUILD SPEC — IS TROPHY WORTH ITS PRICE, AND CAN CAPITAL BUY IT LATER?
//
//   pnpm engine && node test/build-spec-arms.mjs
//
// REPORT, not a gate. A delivered office is stamped new at three
// specifications (budget 0.28 = "Box", market 0.5, signature 0.88), held
// unlevered for YEARS on the fund plan, letters signed at asking. A fourth arm
// builds budget and then buys every capital programme it is allowed — the
// "build cheap, fix it later" strategy. Paired seeds; the up-front cost of
// the spec (hard cost x specCostMult) is set against NOI − capex and the
// holding's mark at the end. Generated city, as every harness here.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, bbls } = loadCity(0, E.normalizeParcels);

const YEARS = Number(process.env.YEARS ?? 30);
const SEEDS = (process.env.SEEDS ?? "550991,12007,73303,4242").split(",").map(Number);
const N = Number(process.env.N ?? 6);
const DISC = Number(process.env.DISC ?? 0.07);   // a developer's unlevered hurdle, for the PV column
const ARMS = [
  { id: "budget",   spec: 0.28, programs: false },
  { id: "budget+capex", spec: 0.28, programs: true },
  { id: "market",   spec: 0.50, programs: false },
  { id: "market+capex", spec: 0.50, programs: true },
  { id: "signature", spec: 0.88, programs: false },
];
const offices = bbls.filter((b) => { const r = parcels[b]; return r && r.class === "office" && r.bldgArea > 40_000 && r.floors >= 4; }).slice(0, N);

function stamp(g0, owned, spec) {
  const g = structuredClone(g0);
  const yr = 2000 + Math.floor(g.month / 12);
  for (const b of owned) {
    const r = parcels[b];
    g.built ??= {};
    g.built[b] = { class: "office", bldgArea: r.bldgArea, floors: r.floors, yearBuilt: yr, buildSpec: spec };
    const h = g.holdings[b];
    h.condIdx = Math.min(E.condCeiling({ yearBuilt: yr, buildSpec: spec }, g.month), 0.90 + 0.09 * spec);
    h.condition = E.condGrade(h.condIdx);
    h.lastCapM = g.month; h.deliveredM = g.month; h.programsDone = {};
  }
  return g;
}
const hard = (g, b) => { const r = parcels[b]; return r.bldgArea * E.HARD_COST_PSF.office * E.constructionTypeMult("office", r.floors) * E.heightPremium(r.floors) * g.econ.costIdx; };

function run(g0, owned, arm) {
  let g = stamp(g0, owned, arm.spec);
  g = E.setOpsPolicy(g, { service: 0, plan: 1, stance: 0 });
  const set = new Set(owned);
  let pv = 0, rentSum = 0, rentN = 0;
  let prevNoi = 0, prevCap = 0;
  for (let m = 0; m < YEARS * 12; m++) {
    if (arm.programs) for (const b of owned) { const h = g.holdings[b]; if (h && !h.program) for (const id of ["lobby", "systems", "facade"]) { const r = E.startProgram(g, parcels, b, id); if (!r.err) { g = r.s; break; } } }
    g = E.advanceMonth(g, parcels, bbls, {});
    if (g.gameOver) g = { ...g, gameOver: null };
    for (const loi of [...(g.lois ?? [])]) if (set.has(loi.bbl)) { const r = E.respondLOI(g, parcels, loi.id, "accept"); if (!r.err) g = r.s; }
    const noi = (g.books ?? []).reduce((a, y) => a + (y.noi ?? 0), 0), cap = (g.books ?? []).reduce((a, y) => a + (y.capex ?? 0), 0);
    pv += ((noi - prevNoi) - (cap - prevCap)) / Math.pow(1 + DISC, (m + 1) / 12);
    prevNoi = noi; prevCap = cap;
    if (m % 12 === 11) for (const b of owned) { const h = g.holdings[b]; const rec = E.resolveRec(parcels, g, b); if (h && rec) { rentSum += E.managedRentPsfYr(rec, g.econ, h) / g.econ.rentIdx.office; rentN++; } }
  }
  let mark = 0, cond = 0;
  for (const b of owned) { const h = g.holdings[b]; if (!h) continue; mark += E.ownedHoldingValue(g, parcels, h); cond += h.condIdx ?? 0; }
  const cost = owned.reduce((a, b) => a + hard(g0, b) * E.specCostMult(arm.spec), 0);
  pv += mark / Math.pow(1 + DISC, YEARS);
  return { cost, net: prevNoi - prevCap, capex: prevCap, mark, pv, rent: rentSum / rentN, cond: cond / owned.length };
}

const rows = [];
for (const seed of SEEDS) {
  let g = E.firstListings(E.newGame(seed, parcels, 5e9), parcels, bbls);
  const owned = [];
  for (const b of offices) { const rec = E.resolveRec(parcels, g, b); if (!rec) continue; g.cash = 5e9; const r = E.executePurchase(g, parcels, b, Math.round(E.assetValue(rec, g.econ, E.initialCondition(rec))), "cash", true, 1); if (!r.err) { g = r.s; owned.push(b); } }
  const row = { seed };
  for (const a of ARMS) row[a.id] = run(g, owned, a);
  rows.push(row);
  console.log(`seed ${seed}: ${owned.length} offices`);
}
const M = (x) => `$${(x / 1e6).toFixed(1)}M`;
console.log(`\nBUILD SPEC ARMS — ${SEEDS.length} seeds x ${YEARS}y x ${N} new offices, unlevered, fund plan, PV at ${DISC * 100}%\n`);
console.log("arm              build cost  rent÷idx  cond@end  NOI−capex   capex    mark@end   PV(cf+mark) − cost");
for (const a of ARMS) {
  const avg = (k) => rows.reduce((s, r) => s + r[a.id][k], 0) / rows.length;
  console.log(`${a.id.padEnd(16)} ${M(avg("cost")).padStart(9)}  ${avg("rent").toFixed(2).padStart(7)}  ${avg("cond").toFixed(2).padStart(8)}  ${M(avg("net")).padStart(9)}  ${M(avg("capex")).padStart(7)}  ${M(avg("mark")).padStart(9)}  ${M(avg("pv") - avg("cost")).padStart(9)}`);
}
console.log("\nPer seed, PV − cost vs market ($M):");
for (const r of rows) console.log(String(r.seed).padEnd(8) + ARMS.filter((a) => a.id !== "market").map((a) => `${a.id} ${((r[a.id].pv - r[a.id].cost - (r.market.pv - r.market.cost)) / 1e6).toFixed(1)}`).join("  "));
