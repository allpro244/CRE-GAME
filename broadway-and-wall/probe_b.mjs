const E = await import("./test/.engine.mjs");
const { loadCity } = await import("./test/city.mjs");
const { parcels, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const M = (n) => `${n < 0 ? "-" : " "}$${(Math.abs(n) / 1e6).toFixed(3)}M`;
let base = E.firstListings(E.newGame(7919, parcels), parcels, bbls);
base = { ...base, cash: 800e6 };
for (let m = 0; m < 240 && !Object.keys(base.holdings).length; m++) {
  base = E.advanceQuarter(base, parcels, bbls, adjacency);
  if (!base.talks) for (const l of base.listings) {
    const rec = E.resolveRec(parcels, base, l.bbl);
    if (!rec || rec.class !== "land" || rec.lotArea < 8000) continue;
    const r = E.negotiate(base, parcels, l.bbl, Math.round(l.ask * 1.05));
    if (!r.err) { base = r.s; break; }
  }
  if (base.talks?.agreed) { const r = E.closeDeal(base, parcels, "cash", 0); base = r.err ? E.walkAway(base, parcels).s : r.s; }
  else if (base.talks) { const r = E.acceptCounter(base, parcels); base = r.err ? E.walkAway(base, parcels).s : r.s; }
}
const bbl = Object.keys(base.holdings)[0];
const rec = E.resolveRec(parcels, base, bbl);
const use = "office";
const fl = Math.min(E.maxFloorsFor(rec, 0.6, use), 12);
const plan = E.planDevelopment(base, parcels, bbl, use, fl, 0.6, "gmp");
const gate = plan.equity + Math.round(plan.costTotal * 0.06);
let g = { ...base, cash: gate };
console.log(`equity promised by the UI: ${M(plan.equity)} (of which ${M(plan.equityAtClose)} at close)`);
console.log(`cash on hand: ${M(gate)}  (the engine's own gate: equity + 6% margin)`);
g = E.startDevelopment(g, parcels, bbl, use, plan.floors, 0.6, "gmp").s;
console.log(`${"m".padStart(4)} ${"cash".padStart(11)} ${"LOCbal".padStart(11)} ${"eqSpent".padStart(11)} ${"eqLeftUI".padStart(11)}`);
for (let m = 0; m < 40; m++) {
  g = E.advanceQuarter(g, parcels, bbls, adjacency);
  const d = g.developments[bbl];
  console.log(`${String(g.month).padStart(4)} ${M(g.cash).padStart(11)} ${M(g.loc?.balance ?? 0).padStart(11)} ${d ? M(d.equitySpent).padStart(11) : "  DELIVERED"} ${d ? M(Math.max(0, d.equityBudget - d.equitySpent)).padStart(11) : ""}`);
  if (!d || g.gameOver) break;
}
