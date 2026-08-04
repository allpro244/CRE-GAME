// THE FOUR ECONOMY ACCEPTANCE TESTS.
//
// The owner's mandate, verbatim: "THE ECONOMY IS THE GAME, AND RIGHT NOW IT'S
// FAKE." These four tests are the permanent, headless statement of what a real
// market means here. They were written to FAIL against the engine as it stood
// on 2026-08-03, to prove the diagnosis; after the rebuild they are the
// regression suite that keeps it fixed. Run: node test/econ-accept.mjs
// (rebuilds nothing — bundle first like every other harness).
//
//   A. LOCATION SPREAD — identical buildings on the best and worst viable
//      blocks must stabilise ~2-3x apart in rent, with the bad location
//      materially emptier, slower.
//   B. SUPPLY SHOCK — dropping ~10% of a use's citywide stock in one place
//      must spike vacancy, cut effective rents 10-25%, take YEARS to lease,
//      and visibly wound the buildings around it.
//   C. CYCLE — across a recession, market rents for cyclical uses must
//      actually decline, not plateau.
//   D. CONSERVATION — occupied SF is tenants, and tenants are finite. Adding
//      buildings must not add occupied SF beyond a small induced factor.
//      If building space manufactures tenants, everything else is cosmetic.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { loadCity } = await import(join(HERE, "city.mjs"));

const { parcels: P0, adjacency, bbls } = loadCity(0, E.normalizeParcels);
const clone = () => JSON.parse(JSON.stringify(P0));
const results = [];
const report = (name, pass, detail) => {
  results.push({ name, pass });
  console.log(`\n${pass ? "PASS" : "FAIL"}  ${name}`);
  for (const d of detail) console.log("      " + d);
};
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))] ?? 0; };

// Answer every letter at asking — the least-skilled landlord there is, so the
// numbers measure the MARKET, not the bot.
function acceptAll(g, parcels) {
  for (const l of [...g.lois]) {
    if (!g.lois.find((x) => x.id === l.id)) continue;
    const r = E.respondLOI(g, parcels, l.id, "accept", true);
    if (!r.err) g = r.s;
  }
  return g;
}
const rollOf = (g, bbl) => {
  const h = g.holdings[bbl];
  if (!h) return { sf: 0, rent: 0 };
  let sf = 0, wr = 0;
  for (const t of h.tenants) { sf += t.sf; wr += t.sf * t.rentPsf; }
  return { sf, rent: sf > 0 ? wr / sf : 0 };
};

// ---------------------------------------------------------------------------
// A. LOCATION SPREAD
// ---------------------------------------------------------------------------
{
  const parcels = clone();
  // two identical office buildings, cloned onto the best and worst viable
  // office blocks in town — same plate, same area, same floors, same year
  const offices = bbls.map((b) => parcels[b])
    .filter((r) => r && r.class === "office" && r.bldgArea > 30000 && r.bldgArea < 90000)
    .sort((a, b) => a.demandScore - b.demandScore);
  const lo = offices[0], hi = offices[offices.length - 1];
  const TPL = { bldgArea: 60000, floors: 8, yearBuilt: 1988, unitsRes: 0 };
  for (const r of [lo, hi]) Object.assign(parcels[r.bbl], TPL, { lotArea: 9000 });
  let g = E.firstListings(E.newGame(910117, parcels), parcels, bbls);
  g = { ...g, cash: 400_000_000 };
  for (const bbl of [lo.bbl, hi.bbl]) {
    const r = E.executePurchase(g, parcels, bbl, 5_000_000, "cash", false, 1);
    if (r.err) { console.log("A: buy failed", bbl, r.err); process.exit(2); }
    g = r.s;
    g.holdings[bbl].tenants = [];
    g.holdings[bbl].makeReady = [];
    g.holdings[bbl].broker = true;
  }
  const MO = 144;
  let to80 = { [lo.bbl]: null, [hi.bbl]: null };
  for (let m = 0; m < MO; m++) {
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    g = acceptAll(g, parcels);
    for (const bbl of [lo.bbl, hi.bbl]) {
      if (to80[bbl] === null && rollOf(g, bbl).sf >= 0.8 * 60000) to80[bbl] = m + 1;
    }
  }
  const L = rollOf(g, lo.bbl), H = rollOf(g, hi.bbl);
  const spread = L.rent > 0 ? H.rent / L.rent : Infinity;
  const occL = L.sf / 60000, occH = H.sf / 60000;
  report("A. LOCATION SPREAD", spread >= 2.0 && (occH - occL) >= 0.08,
    [`demand ${lo.demandScore} vs ${hi.demandScore} (same 60k sf, 8 fl, 1988 building)`,
     `achieved rent  worst $${L.rent.toFixed(2)}/sf   best $${H.rent.toFixed(2)}/sf   spread ${spread.toFixed(2)}x   (need >= 2.0x)`,
     `occupancy at yr 12   worst ${(occL * 100).toFixed(0)}%   best ${(occH * 100).toFixed(0)}%   (need best-worst >= 8pp)`,
     `months to 80%   worst ${to80[lo.bbl] ?? ">144"}   best ${to80[hi.bbl] ?? ">144"}`]);
}

// ---------------------------------------------------------------------------
// B. SUPPLY SHOCK
// ---------------------------------------------------------------------------
{
  const parcels = clone();
  let g = E.firstListings(E.newGame(424243, parcels), parcels, bbls);
  g = { ...g, cash: 2_000_000_000 };
  const PRE = 24, POST = 60;
  for (let m = 0; m < PRE; m++) g = E.advanceQuarter(g, parcels, bbls, adjacency);
  const stock0 = g.econ.stock.office;
  const vac0 = g.econ.cityVac.office;
  const rent0 = g.econ.rentIdx.office;
  // the shock: one delivery equal to 10% of citywide office stock, placed on a
  // real mid-town lot — injected as a finished building with an empty roll
  const site = bbls.map((b) => parcels[b])
    .filter((r) => r && r.class === "land" && r.lotArea > 8000)
    .sort((a, b) => b.demandScore - a.demandScore)[2];
  const addSf = Math.round(stock0 * 0.10);
  const buy = E.executePurchase(g, parcels, site.bbl, 2_000_000, "cash", false, 1);
  if (buy.err) { console.log("B: land buy failed", buy.err); process.exit(2); }
  g = buy.s;
  g.built[site.bbl] = { class: "office", mix: { office: 1 }, bldgArea: addSf, floors: 20, yearBuilt: 2002 };
  g.holdings[site.bbl].tenants = [];
  g.holdings[site.bbl].broker = true;
  E.addStock(g.econ, "office", addSf);
  // occupancy of the standing office stock around it, before
  const nbhood = bbls.map((b) => E.resolveRec(parcels, g, b))
    .filter((r) => r && r.class === "office" && r.bbl !== site.bbl && r.bldgArea > 10000);
  const occBefore = nbhood.reduce((a, r) => a + E.occupancy(r, g.econ) * r.bldgArea, 0)
    / Math.max(1, nbhood.reduce((a, r) => a + r.bldgArea, 0));
  let vacPeak = vac0, rentTrough = rent0, to80 = null;
  for (let m = 0; m < POST; m++) {
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    g = acceptAll(g, parcels);
    vacPeak = Math.max(vacPeak, g.econ.cityVac.office);
    rentTrough = Math.min(rentTrough, g.econ.rentIdx.office);
    if (to80 === null && rollOf(g, site.bbl).sf >= 0.8 * addSf) to80 = m + 1;
  }
  const occAfter = nbhood.reduce((a, r) => a + E.occupancy(r, g.econ) * r.bldgArea, 0)
    / Math.max(1, nbhood.reduce((a, r) => a + r.bldgArea, 0));
  const rentCut = 1 - rentTrough / rent0;
  report("B. SUPPLY SHOCK (+10% of office stock in one building)",
    (vacPeak - vac0) >= 0.05 && rentCut >= 0.10 && (to80 === null || to80 >= 24) && (occBefore - occAfter) >= 0.03,
    [`stock ${(stock0 / 1e6).toFixed(2)}M sf  + ${(addSf / 1e6).toFixed(2)}M sf delivered empty at demand ${site.demandScore}`,
     `citywide office vacancy ${(vac0 * 100).toFixed(1)}% -> peak ${(vacPeak * 100).toFixed(1)}%   (need +5pp)`,
     `office rent index ${rent0.toFixed(2)} -> trough ${rentTrough.toFixed(2)}  cut ${(rentCut * 100).toFixed(1)}%   (need >= 10%)`,
     `new building to 80% let: ${to80 === null ? ">60 months" : to80 + " months"}   (need >= 24, and >60 is fine)`,
     `standing office stock occupancy ${(occBefore * 100).toFixed(1)}% -> ${(occAfter * 100).toFixed(1)}%   (need -3pp: the shock must WOUND somebody)`]);
}

// ---------------------------------------------------------------------------
// C. CYCLE
// ---------------------------------------------------------------------------
{
  const parcels = clone();
  let g = E.firstListings(E.newGame(550991, parcels), parcels, bbls);
  const rents = [], phases = [];
  for (let m = 0; m < 600; m++) {
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    rents.push(g.econ.rentIdx.office);
    phases.push(g.econ.phase);
  }
  // worst peak-to-trough drawdown, and the same measured only inside
  // recession windows (entering 6 months early, leaving 12 late)
  let peak = -Infinity, dd = 0;
  for (const r of rents) { peak = Math.max(peak, r); dd = Math.max(dd, 1 - r / peak); }
  let recDd = 0;
  for (let i = 0; i < rents.length; i++) {
    if (phases[i] !== "recession") continue;
    const j0 = Math.max(0, i - 6), j1 = Math.min(rents.length - 1, i + 12);
    const localPeak = Math.max(...rents.slice(j0, i + 1));
    const localTrough = Math.min(...rents.slice(i, j1 + 1));
    recDd = Math.max(recDd, 1 - localTrough / localPeak);
  }
  const recMonths = phases.filter((p) => p === "recession").length;
  report("C. CYCLE (50 years, office rent index)",
    recDd >= 0.05,
    [`recession months: ${recMonths} of 600`,
     `worst drawdown anywhere: ${(dd * 100).toFixed(1)}%`,
     `worst drawdown across a recession window: ${(recDd * 100).toFixed(1)}%   (need >= 5% — rents must actually FALL)`,
     `rent index start ${rents[0].toFixed(2)} end ${rents[rents.length - 1].toFixed(2)} (${(rents[rents.length - 1] / rents[0]).toFixed(2)}x over 50y)`]);
}

// ---------------------------------------------------------------------------
// D. CONSERVATION
// ---------------------------------------------------------------------------
{
  // paired runs, same seed: one gets +12% office stock injected at month 24,
  // the control does not. If tenants are conserved, the injected run's OCCUPIED
  // sf may exceed the control's only by a small induced-demand factor.
  const run = (inject) => {
    const parcels = clone();
    let g = E.firstListings(E.newGame(133713, parcels), parcels, bbls);
    let addSf = 0;
    for (let m = 0; m < 60; m++) {
      if (inject && m === 24) {
        addSf = Math.round(g.econ.stock.office * 0.12);
        E.addStock(g.econ, "office", addSf);
      }
      g = E.advanceQuarter(g, parcels, bbls, adjacency);
    }
    return { occ: g.econ.occupied.office, stock: g.econ.stock.office, addSf,
             req: E.marketRequirement ? E.marketRequirement(g.econ, "office") : null };
  };
  const ctl = run(false), inj = run(true);
  const conjured = inj.occ - ctl.occ;
  const frac = conjured / Math.max(1, inj.addSf);
  report("D. CONSERVATION (does supply manufacture tenants?)",
    frac <= 0.15,
    [`control: occupied ${(ctl.occ / 1e6).toFixed(3)}M sf of ${(ctl.stock / 1e6).toFixed(2)}M stock`,
     `injected +${(inj.addSf / 1e6).toFixed(2)}M sf at month 24: occupied ${(inj.occ / 1e6).toFixed(3)}M sf`,
     `occupied sf conjured by the new supply: ${(conjured / 1e6).toFixed(3)}M = ${(frac * 100).toFixed(1)}% of the injection   (allowed <= 15% induced demand)`,
     `monthly tenant requirement ${ctl.req !== null ? `control ${(ctl.req / 1e3).toFixed(0)}k sf vs injected ${(inj.req / 1e3).toFixed(0)}k sf` : "n/a"} — a requirement that RISES with stock is the leak`]);
}

// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(64));
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length} of ${results.length} acceptance tests pass`);
if (failed.length) { console.log("failing: " + failed.map((f) => f.name.split(".")[0]).join(", ")); process.exit(1); }
