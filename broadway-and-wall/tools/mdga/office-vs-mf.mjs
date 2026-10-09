// MDGA instrument — WHAT DOES AN OFFICE BUILDING COST THE PLAYER THAT MF DOES NOT?
// Same lot, same floors, built twice: once multifamily, once office. Each is
// followed from delivery for YEARS years and three things are counted on that
// deed alone:
//   stops      months the clock stopped for something on this building
//   decisions  letters and tenant requests that reached the principal
//   cash       months its own ledger (deedCf) went negative, the deepest the
//              running total fell below zero after delivery, and the total
// Arms: MF (by hand), office by hand (accept every letter), office on auto-lease.
//   pnpm engine && node tools/mdga/office-vs-mf.mjs        (~5 min)
//   LOTS=6 YEARS=10 node tools/mdga/office-vs-mf.mjs
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, "..", "..", "test", ".engine.mjs"));
const { loadCity } = await import(join(HERE, "..", "..", "test", "city.mjs"));
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const SEED = Number(process.env.SEED ?? 7919);
const LOTS = Number(process.env.LOTS ?? 4);
const YEARS = Number(process.env.YEARS ?? 8);
const M = (n) => `${n < 0 ? "-" : ""}$${(Math.abs(n) / 1e6).toFixed(2)}M`;

let w = E.firstListings(E.newGame(SEED, parcels), parcels, bbls);
for (let m = 0; m < 36; m++) { w = E.advanceMonth(w, parcels, bbls, adjacency); if (w.gameOver) w = { ...w, gameOver: null, cash: 5e6 }; }

const cands = [];
for (const b of bbls) {
  const rec = E.resolveRec(parcels, w, b);
  if (rec?.class !== "land" || w.holdings[b] || !rec.lotArea || rec.lotArea < 4000) continue;
  if (E.zoneUseBar(rec, "office", w.econ) || E.zoneUseBar(rec, "multifamily", w.econ)) continue;
  // ranked on location: an office lot first, since a lot that only works as
  // housing measures the location, not the management load
  cands.push({ b, s: rec.demandScore ?? 0 });
}
cands.sort((a, b) => b.s - a.s);

function arm(b, use, auto) {
  let g = structuredClone(w);
  const rec = E.resolveRec(parcels, g, b);
  g.holdings[b] = { bbl: b, costBasis: Math.round(E.landValue(rec, g.econ)), tenants: [], boughtM: g.month, condition: "good", loan: null, cfHistory: [], autoLease: auto, stance: 0 };
  g.cash = 1e9;
  const cov = E.MAX_COVERAGE[use] ?? 0.7;
  const fl = Math.min(8, E.maxFloorsFor(rec, cov, use));
  const r = E.startDevelopment(g, parcels, b, use, fl, cov, "gmp");
  if (r.err) return { err: r.err };
  g = r.s;
  // the schedule slips; delivery is the month the development record clears
  // the delivery month is counted: it is when the lease-up reserve arrives
  let cfFrom = 0, reserve = 0;
  while (g.developments[b]) {
    cfFrom = (g.deedCf?.[b]?.cf ?? []).length;
    reserve = g.developments[b].leaseUpReserve ?? 0;
    g = E.advanceMonth(g, parcels, bbls, adjacency); if (g.gameOver) g = { ...g, gameOver: null }; g.cash = Math.max(g.cash, 1e8);
  }
  const del = g.month;
  let stops = 0, decisions = 0;
  const stopKinds = {};
  while (g.month < del + 12 * YEARS) {
    const stop = E.stopRule(g, parcels);
    g = E.advanceMonth(g, parcels, bbls, adjacency);
    if (g.gameOver) g = { ...g, gameOver: null };
    g.cash = Math.max(g.cash, 1e8);
    const f = stop(g);
    if (f && f.key.includes(b)) { stops++; const k = f.key.split(":")[0]; stopKinds[k] = (stopKinds[k] ?? 0) + 1; }
    // the principal answers every letter and request that reaches them
    for (const l of [...g.lois].filter((l) => l.bbl === b && E.loiNeedsPrincipal(g, l))) {
      decisions++;
      const x = E.respondLOI(g, parcels, l.id, "accept", true);
      g = x.err ? E.respondLOI(g, parcels, l.id, "decline").s : x.s;
    }
    for (const a of [...(g.asks ?? [])].filter((a) => a.bbl === b)) { decisions++; g = E.answerAsk(g, parcels, a.id, "decline").s; }
  }
  const cf = (g.deedCf?.[b]?.cf ?? []).slice(cfFrom);
  let neg = 0, run = 0, trough = 0, tot = 0;
  for (let i = 0; i < cf.length; i += 2) { const v = cf[i + 1]; tot += v; run += v; if (v < 0) neg++; trough = Math.min(trough, run); }
  const h = g.holdings[b];
  const r2 = E.resolveRec(parcels, g, b);
  return { fl, reserve, stops, stopKinds, decisions, neg, trough, tot, months: cf.length / 2, occ: h ? E.physicalOcc(r2, h) : NaN };
}

const rows = [];
for (const { b } of cands.slice(0, LOTS)) {
  for (const [label, use, auto] of [["MF", "multifamily", false], ["office", "office", false], ["office auto", "office", true]]) {
    const r = arm(b, use, auto);
    rows.push({ b, label, ...r });
    if (r.err) { console.log(`${b} ${label}: ${r.err}`); continue; }
    console.log(`${b} ${label.padEnd(11)} ${r.fl}fl | stops ${String(r.stops).padStart(3)} | decisions ${String(r.decisions).padStart(3)} | neg-cash months ${String(r.neg).padStart(3)}/${r.months} | reserve ${M(r.reserve)} | trough ${M(r.trough)} | total ${M(r.tot)} | occ ${(r.occ * 100).toFixed(0)}% | ${JSON.stringify(r.stopKinds)}`);
  }
}
console.log(`\nMEAN over ${LOTS} lots, ${YEARS} years from delivery`);
for (const label of ["MF", "office", "office auto"]) {
  const rs = rows.filter((r) => r.label === label && !r.err);
  const avg = (k) => rs.reduce((a, r) => a + r[k], 0) / Math.max(1, rs.length);
  console.log(`  ${label.padEnd(11)} stops ${avg("stops").toFixed(1)} | decisions ${avg("decisions").toFixed(1)} | neg-cash months ${avg("neg").toFixed(1)} | reserve ${M(avg("reserve"))} | trough ${M(avg("trough"))} | total ${M(avg("tot"))}`);
}
