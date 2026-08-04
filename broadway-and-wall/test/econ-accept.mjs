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
// MEDIAN OF THREE SEEDS. This test flipped from pass to fail on IDENTICAL
// mechanics when an unrelated change reshuffled the RNG stream — a snapshot
// of two specific buildings on one specific seed is weather, not climate. The
// clauses now assert on the median across three seeds, so a single lucky or
// unlucky draw can neither pass a broken market nor fail a working one.
{
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)];
  const runs = [];
  let loD = 0, hiD = 0;
  for (const seed of [910117, 411133, 87019]) {
    const parcels = clone();
    // two identical office buildings, cloned onto the best and worst viable
    // office blocks in town — same plate, same area, same floors, same year
    const offices = bbls.map((b) => parcels[b])
      .filter((r) => r && r.class === "office" && r.bldgArea > 30000 && r.bldgArea < 90000)
      .sort((a, b) => a.demandScore - b.demandScore);
    const lo = offices[0], hi = offices[offices.length - 1];
    loD = lo.demandScore; hiD = hi.demandScore;
    const TPL = { bldgArea: 60000, floors: 8, yearBuilt: 1988, unitsRes: 0 };
    for (const r of [lo, hi]) Object.assign(parcels[r.bbl], TPL, { lotArea: 9000 });
    let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
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
    const to80 = { [lo.bbl]: null, [hi.bbl]: null };
    for (let m = 0; m < MO; m++) {
      g = E.advanceQuarter(g, parcels, bbls, adjacency);
      g = acceptAll(g, parcels);
      for (const bbl of [lo.bbl, hi.bbl]) {
        if (to80[bbl] === null && rollOf(g, bbl).sf >= 0.8 * 60000) to80[bbl] = m + 1;
      }
    }
    const L = rollOf(g, lo.bbl), H = rollOf(g, hi.bbl);
    runs.push({
      spread: L.rent > 0 ? H.rent / L.rent : Infinity,
      gap: H.sf / 60000 - L.sf / 60000,
      occL: L.sf / 60000, occH: H.sf / 60000,
      loTo80: to80[lo.bbl], hiTo80: to80[hi.bbl],
    });
  }
  const spread = med(runs.map((r) => r.spread));
  const gap = med(runs.map((r) => r.gap));
  report("A. LOCATION SPREAD (median of 3 seeds)", spread >= 2.0 && gap >= 0.08,
    [`demand ${loD} vs ${hiD} (same 60k sf, 8 fl, 1988 building)`,
     `achieved rent spread per seed: ${runs.map((r) => r.spread.toFixed(2) + "x").join("  ")}   median ${spread.toFixed(2)}x   (need >= 2.0x)`,
     `occupancy gap at yr 12 per seed: ${runs.map((r) => ((r.gap) * 100).toFixed(0) + "pp").join("  ")}   median ${(gap * 100).toFixed(0)}pp   (need >= 8pp)`,
     `worst-location occupancy per seed: ${runs.map((r) => (r.occL * 100).toFixed(0) + "%").join("  ")}   best: ${runs.map((r) => (r.occH * 100).toFixed(0) + "%").join("  ")}`,
     `months to 80%, worst location: ${runs.map((r) => r.loTo80 ?? ">144").join("  ")}   best: ${runs.map((r) => r.hiTo80 ?? ">144").join("  ")}`]);
}

// ---------------------------------------------------------------------------
// B. SUPPLY SHOCK
// ---------------------------------------------------------------------------
{
  const parcels = clone();
  let g = E.firstListings(E.newGame(424243, parcels), parcels, bbls);
  g = { ...g, cash: 2_000_000_000 };
  const PRE = 24, POST = 120;
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
  // THE COUNTERFACTUAL. This clause used to measure the rent trough against
  // the rent on the day of the shock — which was fine while rents had no
  // trend, and became meaningless the moment they gained one. Rents now grow
  // with the nominal wages that pay them (~3.4%/yr), so a shock can knock
  // 15% off where rents WOULD have been without ever pushing them below where
  // they started. What a supply shock does is depress rents relative to the
  // path the market would otherwise have taken, so that is what we measure:
  // the same seed, the same everything, without the building.
  const ctlPath = (() => {
    const cp = clone();
    let cg = E.firstListings(E.newGame(424243, cp), cp, bbls);
    cg = { ...cg, cash: 2_000_000_000 };
    for (let m = 0; m < PRE; m++) cg = E.advanceQuarter(cg, cp, bbls, adjacency);
    const out = [];
    for (let m = 0; m < POST; m++) {
      cg = E.advanceQuarter(cg, cp, bbls, adjacency);
      cg = acceptAll(cg, cp);
      out.push(cg.econ.rentIdx.office);
    }
    return out;
  })();
  let vacPeak = vac0, rentTrough = rent0, to80 = null, occAfter = occBefore;
  let worstGap = 0;
  for (let m = 0; m < POST; m++) {
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    g = acceptAll(g, parcels);
    vacPeak = Math.max(vacPeak, g.econ.cityVac.office);
    rentTrough = Math.min(rentTrough, g.econ.rentIdx.office);
    worstGap = Math.max(worstGap, 1 - g.econ.rentIdx.office / Math.max(1, ctlPath[m]));
    if (to80 === null && rollOf(g, site.bbl).sf >= 0.8 * addSf) to80 = m + 1;
    // the WOUND is the trough, not the end state — over a ten-year window the
    // market is allowed (expected, even) to heal; it is not allowed to never bleed
    const occNow = nbhood.reduce((a, r) => a + E.occupancy(r, g.econ) * r.bldgArea, 0)
      / Math.max(1, nbhood.reduce((a, r) => a + r.bldgArea, 0));
    occAfter = Math.min(occAfter, occNow);
  }
  const rentCut = worstGap;
  // The panel's upper bound, adopted: a building that NEVER leases should not
  // pass a queue test. Ten years is the allowance — this is a prime site; if
  // the market cannot absorb it in a decade the pool is broken the other way.
  report("B. SUPPLY SHOCK (+10% of office stock in one building)",
    (vacPeak - vac0) >= 0.05 && rentCut >= 0.10 && to80 !== null && to80 >= 24 && to80 <= 120 && (occBefore - occAfter) >= 0.03,
    [`stock ${(stock0 / 1e6).toFixed(2)}M sf  + ${(addSf / 1e6).toFixed(2)}M sf delivered empty at demand ${site.demandScore}`,
     `citywide office vacancy ${(vac0 * 100).toFixed(1)}% -> peak ${(vacPeak * 100).toFixed(1)}%   (need +5pp)`,
     `office rents vs the same city WITHOUT the building: ${(rentCut * 100).toFixed(1)}% below the counterfactual at the worst   (need >= 10%)`,
     `   (nominal path ${rent0.toFixed(0)} -> trough ${rentTrough.toFixed(0)}; rents carry a wage-driven trend now, so the counterfactual is the only honest measure)`,
     `new building to 80% let: ${to80 === null ? ">120 months" : to80 + " months"}   (need 24-120: years, not forever)`,
     `standing office stock occupancy ${(occBefore * 100).toFixed(1)}% -> trough ${(occAfter * 100).toFixed(1)}%   (need -3pp: the shock must WOUND somebody)`]);
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
  //
  // MEDIAN OF THREE SEED-PAIRS. The metric is a small difference of two large
  // numbers, and the injection itself forks the RNG stream at month 24 — so a
  // single pair measured anywhere from -34% to +20% across mechanically
  // identical builds. One draw is weather; the median is the mechanism.
  const run = (seed, inject) => {
    const parcels = clone();
    let g = E.firstListings(E.newGame(seed, parcels), parcels, bbls);
    let addSf = 0;
    for (let m = 0; m < 60; m++) {
      if (inject && m === 24) {
        addSf = Math.round(g.econ.stock.office * 0.12);
        E.addStock(g.econ, "office", addSf);
      }
      g = E.advanceQuarter(g, parcels, bbls, adjacency);
    }
    return { occ: g.econ.occupied.office, stock: g.econ.stock.office, addSf };
  };
  const pairs = [133713, 51423, 900871].map((seed) => {
    const ctl = run(seed, false), inj = run(seed, true);
    return { seed, ctl, inj, frac: (inj.occ - ctl.occ) / Math.max(1, inj.addSf) };
  });
  const fracs = pairs.map((p) => p.frac).sort((a, b) => a - b);
  const frac = fracs[1];
  report("D. CONSERVATION (does supply manufacture tenants? median of 3 seed-pairs)",
    frac <= 0.15,
    [`control occupied: ${pairs.map((p) => (p.ctl.occ / 1e6).toFixed(2) + "M").join("  ")} of ~${(pairs[0].ctl.stock / 1e6).toFixed(2)}M stock`,
     `injection: +${(pairs[0].inj.addSf / 1e6).toFixed(2)}M sf of office at month 24, per pair`,
     `conjured per pair: ${pairs.map((p) => (p.frac * 100).toFixed(1) + "%").join("  ")}   median ${(frac * 100).toFixed(1)}%   (allowed <= 15% induced demand)`]);
}

// ---------------------------------------------------------------------------
// E. MID-GRADIENT (adopted from the design panel)
// ---------------------------------------------------------------------------
{
  // The extremes are easy to keep honest; the middle is where the game is
  // actually played and where tuning quietly re-flattens things. Two identical
  // empty buildings on ~demand-30 and ~demand-70 blocks, letters counted for
  // four years, nothing signed: the better block must draw >= 2x the letters.
  const parcels = clone();
  const offices = bbls.map((b) => parcels[b])
    .filter((r) => r && r.class === "office" && r.bldgArea > 30000 && r.bldgArea < 90000);
  const near = (t) => offices.slice().sort((a, b) => Math.abs(a.demandScore - t) - Math.abs(b.demandScore - t))[0];
  const mid30 = near(30);
  const mid70 = offices.filter((r) => r.bbl !== mid30.bbl)
    .sort((a, b) => Math.abs(a.demandScore - 70) - Math.abs(b.demandScore - 70))[0];
  const TPL = { bldgArea: 60000, floors: 8, yearBuilt: 1988, unitsRes: 0 };
  for (const r of [mid30, mid70]) Object.assign(parcels[r.bbl], TPL, { lotArea: 9000 });
  let g = E.firstListings(E.newGame(777001, parcels), parcels, bbls);
  g = { ...g, cash: 400_000_000 };
  for (const bbl of [mid30.bbl, mid70.bbl]) {
    const r = E.executePurchase(g, parcels, bbl, 5_000_000, "cash", false, 1);
    if (r.err) { console.log("E: buy failed", bbl, r.err); process.exit(2); }
    g = r.s;
    g.holdings[bbl].tenants = [];
    g.holdings[bbl].makeReady = [];
    g.holdings[bbl].broker = true;
  }
  const seen = { [mid30.bbl]: new Set(), [mid70.bbl]: new Set() };
  for (let m = 0; m < 48; m++) {
    g = E.advanceQuarter(g, parcels, bbls, adjacency);
    for (const l of g.lois) if (seen[l.bbl] && l.kind === "new") seen[l.bbl].add(l.id);
  }
  const n30 = seen[mid30.bbl].size, n70 = seen[mid70.bbl].size;
  const ratio = n30 > 0 ? n70 / n30 : Infinity;
  report("E. MID-GRADIENT (letters at demand ~30 vs ~70, empty twins, 4 years)",
    n70 >= 2 && ratio >= 2.0,
    [`demand ${mid30.demandScore} drew ${n30} letters   demand ${mid70.demandScore} drew ${n70}`,
     `ratio ${n30 > 0 ? ratio.toFixed(2) + "x" : "inf"}   (need >= 2x — the middle of the gradient must not flatten)`]);
}

// ---------------------------------------------------------------------------
console.log("\n" + "=".repeat(64));
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length} of ${results.length} acceptance tests pass`);
if (failed.length) { console.log("failing: " + failed.map((f) => f.name.split(".")[0]).join(", ")); process.exit(1); }
