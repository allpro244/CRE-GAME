// BUILD CLASS — DOES BUILDING CHEAP AND SELLING STILL WIN?
//
//   pnpm engine && pnpm class-arms
//
// REPORT, not a gate. BUILD_CLASS_PLAN.md step 0. Offices are stamped new at
// each of the four build tiers (and Value + every capital programme, the
// "fix it later" arm), opened where the engine opens them, held unlevered on
// the Fund plan with every letter signed at asking. Each run is read twice:
//
//   FLIP  sold at FLIP_M months (default 36, 48, 60 — three points in the
//         cycle): PV of cash flow to then + the mark net of SALE_COST
//   HOLD  held YEARS: PV of cash flow + the mark at the end
//
// Cost is the real development budget on the bones: hard x specCostMult, with
// soft cost and contingency on top (they scale with hard), so the cheap side's
// saving is not understated. Paired seeds; a tier "beats Standard" only on the
// per-seed difference. The phase of the cycle at each flip month is printed
// with it — the plan's target is that cheap-and-flip does not win on average,
// does win into a hot market, and loses into a soft one. Generated city.
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));
const { parcels, bbls } = loadCity(0, E.normalizeParcels);

const YEARS = Number(process.env.YEARS ?? 25);
const SEEDS = (process.env.SEEDS ?? "550991,12007,73303,4242").split(",").map(Number);
const N = Number(process.env.N ?? 6);
const DISC = Number(process.env.DISC ?? 0.07);
const SALE_COST = 0.03;   // brokerage, transfer tax and legal on the way out — the same for every arm
const FLIPS = (process.env.FLIP_M ?? "36,48,60").split(",").map(Number);
// Fallbacks so the same probe runs on a tree from before BUILD_CLASS_PLAN —
// the before/after comparison is the whole point of a report like this.
const TIER_SPEC = { value: 0.15, standard: 0.5, premium: 0.75, trophy: 0.95 };
const tier = (k) => E.BUILD_TIERS?.find((t) => t.key === k).spec ?? TIER_SPEC[k];
const openIdx = (spec) => E.openingCondIdx ? E.openingCondIdx(spec) : 0.90 + 0.09 * spec;
const scoreOf = (rec, h, g) => E.buildingScore ? E.buildingScore(rec, h, g).score : 0;
const ARMS = [
  { id: "value", spec: tier("value"), programs: false },
  { id: "value+capex", spec: tier("value"), programs: true },
  { id: "standard", spec: tier("standard"), programs: false },
  { id: "premium", spec: tier("premium"), programs: false },
  { id: "trophy", spec: tier("trophy"), programs: false },
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
    h.condIdx = Math.min(E.condCeiling({ yearBuilt: yr, buildSpec: spec }, g.month), openIdx(spec));
    h.condition = E.condGrade(h.condIdx);
    h.lastCapM = g.month; h.deliveredM = g.month; h.programsDone = {};
  }
  return g;
}
const budget = (g, b, spec) => {
  const r = parcels[b];
  const hard = r.bldgArea * E.HARD_COST_PSF.office * E.constructionTypeMult("office", r.floors) * E.heightPremium(r.floors) * g.econ.costIdx * E.specCostMult(spec);
  return hard * (1 + E.SOFT_COST) * (1 + E.CONTINGENCY);
};

function run(g0, owned, arm) {
  let g = stamp(g0, owned, arm.spec);
  g = E.setOpsPolicy(g, { service: 0, plan: 1, stance: 0 });
  const set = new Set(owned);
  let pv = 0, prevNoi = 0, prevCap = 0;
  const flips = {};
  const occ = [], credit = [];
  for (let m = 0; m < YEARS * 12; m++) {
    if (arm.programs) for (const b of owned) { const h = g.holdings[b]; if (h && !h.program) for (const id of ["lobby", "systems", "facade"]) { const r = E.startProgram(g, parcels, b, id); if (!r.err) { g = r.s; break; } } }
    g = E.advanceMonth(g, parcels, bbls, {});
    if (g.gameOver) g = { ...g, gameOver: null };
    for (const loi of [...(g.lois ?? [])]) if (set.has(loi.bbl)) { const r = E.respondLOI(g, parcels, loi.id, "accept"); if (!r.err) g = r.s; }
    const noi = (g.books ?? []).reduce((a, y) => a + (y.noi ?? 0), 0), cap = (g.books ?? []).reduce((a, y) => a + (y.capex ?? 0), 0);
    pv += ((noi - prevNoi) - (cap - prevCap)) / Math.pow(1 + DISC, (m + 1) / 12);
    prevNoi = noi; prevCap = cap;
    if (FLIPS.includes(m + 1)) {
      let mark = 0;
      for (const b of owned) { const h = g.holdings[b]; if (h) mark += E.ownedHoldingValue(g, parcels, h); }
      flips[m + 1] = { pv: pv + mark * (1 - SALE_COST) / Math.pow(1 + DISC, (m + 1) / 12), phase: g.econ.phase };
    }
    if (m % 12 === 11) {
      let sf = 0, let_ = 0, cr = 0, n = 0;
      for (const b of owned) {
        const h = g.holdings[b]; const rec = E.resolveRec(parcels, g, b); if (!h || !rec) continue;
        sf += E.rentableSf(rec); let_ += h.tenants.reduce((a, t) => a + t.sf, 0);
        for (const t of h.tenants) { cr += t.credit * t.sf; n += t.sf; }
      }
      occ.push(sf ? let_ / sf : 0); credit.push(n ? cr / n : 0);
    }
  }
  let mark = 0, score = 0;
  for (const b of owned) {
    const h = g.holdings[b]; const rec = E.resolveRec(parcels, g, b); if (!h || !rec) continue;
    mark += E.ownedHoldingValue(g, parcels, h); score += scoreOf(rec, h, g);
  }
  const cost = owned.reduce((a, b) => a + budget(g0, b, arm.spec), 0);
  const mean = (xs) => xs.reduce((a, x) => a + x, 0) / Math.max(1, xs.length);
  const sd = (xs) => { const mu = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - mu) ** 2))); };
  return {
    cost, hold: pv + mark * (1 - SALE_COST) / Math.pow(1 + DISC, YEARS) - cost,
    flips: Object.fromEntries(Object.entries(flips).map(([k, v]) => [k, { net: v.pv - cost, phase: v.phase }])),
    occ: mean(occ), occSd: sd(occ), credit: mean(credit), score: score / owned.length,
  };
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
const M = (x) => `${x < 0 ? "-" : ""}$${(Math.abs(x) / 1e6).toFixed(1)}M`;
const avg = (id, f) => rows.reduce((s, r) => s + f(r[id]), 0) / rows.length;
const beats = (id, f) => rows.filter((r) => f(r[id]) > f(r.standard)).length;
console.log(`\nBUILD CLASS ARMS — ${SEEDS.length} seeds x ${YEARS}y x ${N} new offices, unlevered, Fund plan, PV at ${DISC * 100}%, ${SALE_COST * 100}% sale cost\n`);
console.log("arm           budget     occ   occ sd  credit  score@end   " + FLIPS.map((f) => `flip@${f}m`.padStart(11)).join(" ") + "   hold" );
for (const a of ARMS) {
  console.log(`${a.id.padEnd(12)} ${M(avg(a.id, (x) => x.cost)).padStart(8)}  ${(avg(a.id, (x) => x.occ) * 100).toFixed(0).padStart(4)}%  ${(avg(a.id, (x) => x.occSd) * 100).toFixed(1).padStart(5)}  ${avg(a.id, (x) => x.credit).toFixed(2).padStart(6)}  ${avg(a.id, (x) => x.score).toFixed(0).padStart(8)}   `
    + FLIPS.map((f) => M(avg(a.id, (x) => x.flips[f].net)).padStart(11)).join(" ") + `  ${M(avg(a.id, (x) => x.hold)).padStart(8)}`);
}
console.log("\nSeeds beating Standard (paired):");
for (const a of ARMS.filter((x) => x.id !== "standard")) {
  console.log(`${a.id.padEnd(12)} ` + FLIPS.map((f) => `flip@${f}m ${beats(a.id, (x) => x.flips[f].net)}/${rows.length}`).join("  ") + `  hold ${beats(a.id, (x) => x.hold)}/${rows.length}`);
}
console.log("\nValue − Standard on the flip, by the phase the sale landed in ($M):");
for (const r of rows) {
  console.log(String(r.seed).padEnd(8) + FLIPS.map((f) => `${f}m ${r.value.flips[f].phase.padEnd(10)} ${((r.value.flips[f].net - r.standard.flips[f].net) / 1e6).toFixed(1).padStart(6)}`).join("   "));
}
