// ASSEMBLE, THEN BUILD. test/assemble.mjs checks the deeds fold together;
// this checks the thing assembling is for: one building on the whole site.
// For sites of 3, 4 and 5 lots it assembles (all at once, and one lot at a
// time), plans on the site, breaks ground, runs the clock to delivery, and
// asserts the building stands on the parent with the whole site's dirt under
// it and nothing on the folded deeds. Then it dissolves each site's lot
// outlines (src/map/real/siteRing.ts) the way the renderer does and asserts
// one footprint comes back — the 3D map draws ONE building, not one per lot.
// The clock is run with advanceUntilAttention (what Play and Yr run), and it
// must stop in the month the building is delivered.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { assertFreshBundle } from "./fresh.mjs";
assertFreshBundle();

const HERE = dirname(fileURLToPath(import.meta.url));
const E = await import(join(HERE, ".engine.mjs"));
const { makeCity, PROCEDURAL, REFERENCE_SEED } = await import(join(HERE, "../src/citygen/index.mjs"));
const SR = await (async () => {
  const out = buildSync({ entryPoints: [join(HERE, "../src/map/real/siteRing.ts")], bundle: true, format: "esm", write: false, platform: "node" });
  return import("data:text/javascript;base64," + Buffer.from(out.outputFiles[0].text).toString("base64"));
})();

const seed = process.env.BW_SEED ? Number(process.env.BW_SEED) >>> 0 : REFERENCE_SEED;
const city = makeCity(PROCEDURAL, seed, {});
E.normalizeParcels(city.parcels);
const { parcels, adjacency } = city;
const bbls = Object.keys(parcels);

let fails = 0;
const fail = (...a) => { fails++; console.error("FAIL", ...a); };

function own(g, bbl) {
  const rec = parcels[bbl];
  const price = Math.round(E.landValue(rec, g.econ) * 1.02);
  const next = structuredClone(g);
  next.cash -= price;
  next.holdings[bbl] = {
    bbl, boughtM: next.month, costBasis: price, condition: "average",
    tenants: [], loan: null, assessed: price, condIdx: 0.55, svcIdx: 0.55,
    service: 0, stance: 0, plan: 1, cfHistory: [],
  };
  return next;
}

/** n vacant lots on one block, each touching one already in the set. */
function findSite(n, skip) {
  for (const a of bbls) {
    const ra = parcels[a];
    if (!ra || ra.class !== "land" || ra.lotArea < 1500 || skip.has(a)) continue;
    const set = [a];
    while (set.length < n) {
      const next = set.flatMap((b) => adjacency[b] ?? []).find((b) =>
        !set.includes(b) && !skip.has(b) && parcels[b]?.class === "land"
        && parcels[b].lotArea >= 1500 && parcels[b].block === ra.block);
      if (!next) break;
      set.push(next);
    }
    if (set.length === n) return set;
  }
  return null;
}

// --- the lot outlines the renderer will dissolve -------------------------
const lat0 = city.parcelFeatures.features[0].geometry.coordinates[0][0][1];
const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
const o = city.parcelFeatures.features[0].geometry.coordinates[0][0];
const rings = {};
for (const f of city.parcelFeatures.features) {
  rings[f.properties.bbl] = f.geometry.coordinates[0].slice(0, -1).map(([x, y]) => [(x - o[0]) * kx, (y - o[1]) * 111320]);
}

/** The first plan on the site that the zoning hosts, at the tallest it will go. */
function bestPlan(g, bbl) {
  const rec = E.resolveRec(parcels, g, bbl);
  for (const use of ["multifamily", "office", "mixed", "retail", "industrial"]) {
    const fl = E.maxFloorsFor(rec, 0.6, use);
    for (let f = fl; f >= 1; f = Math.floor(f * 0.7)) {
      const p = E.planDevelopment(g, parcels, bbl, use, f, 0.6);
      if (p) return { use, floors: f, plan: p };
      if (f === 1) break;
    }
  }
  return null;
}

const used = new Set();
for (const n of [3, 4, 5]) {
  const site = findSite(n, used);
  if (!site) { console.log(`skip ${n}-lot site — none on this map`); continue; }
  site.forEach((b) => used.add(b));
  const sumArea = site.reduce((a, b) => a + parcels[b].lotArea, 0);
  const biggest = site.reduce((a, b) => (parcels[b].lotArea > parcels[a].lotArea ? b : a));

  const envelope = {};
  for (const mode of ["all-at-once", "one-at-a-time"]) {
    let g = E.firstListings(E.newGame(7 + n, parcels), parcels, bbls);
    g = { ...g, cash: g.cash + 400e6 };
    for (const b of site) g = own(g, b);

    const singlePlan = bestPlan(g, biggest);

    if (mode === "all-at-once") {
      const r = E.assembleLots(g, parcels, adjacency, site);
      if (r.err) { fail(n, mode, "assemble", r.err); continue; }
      g = r.s;
    } else {
      for (let i = 1; i < site.length; i++) {
        const r = E.assembleLots(g, parcels, adjacency, [E.siteRoot(g, site[0]), site[i]]);
        if (r.err) { fail(n, mode, "assemble step", i, r.err); break; }
        g = r.s;
      }
    }
    const root = E.siteRoot(g, site[0]);
    const deeds = E.siteDeeds(g, root);
    if (deeds.length !== n) fail(n, mode, "deeds", deeds.length);
    for (const b of site) if (E.siteRoot(g, b) !== root) fail(n, mode, "deed outside site", b);
    for (const [c, p] of Object.entries(g.merged ?? {})) if (g.merged[p]) fail(n, mode, "nested merge", c, p);

    const rec = E.resolveRec(parcels, g, root);
    if (Math.abs(rec.lotArea - sumArea) > 1) fail(n, mode, "site area", rec.lotArea, sumArea);
    // the envelope is every deed's at its own FAR, whichever deed is the parent
    const farRes = site.reduce((a, b) => a + parcels[b].lotArea * parcels[b].farMaxRes, 0) / sumArea;
    const farComm = site.reduce((a, b) => a + parcels[b].lotArea * parcels[b].farMaxComm, 0) / sumArea;
    if (Math.abs(rec.farMaxRes - farRes) > 0.02 || Math.abs(rec.farMaxComm - farComm) > 0.02) {
      fail(n, mode, "site envelope is not the sum of its deeds", { res: [rec.farMaxRes, farRes], comm: [rec.farMaxComm, farComm] });
    }
    envelope[mode] = Math.round(rec.lotArea * Math.max(rec.farMaxRes, rec.farMaxComm));
    for (const c of deeds.slice(1)) {
      const cr = E.resolveRec(parcels, g, c);
      if (cr.lotArea !== 0) fail(n, mode, "child keeps dirt", c, cr.lotArea);
      // building on a folded deed is refused with a reason, not silently allowed
      const rc = E.startDevelopment(g, parcels, c, "multifamily", 3, 0.6);
      if (!rc.err) fail(n, mode, "child accepted a building", c);
    }

    // THE PLAN IS SIZED TO THE SITE.
    const best = bestPlan(g, root);
    if (!best) { fail(n, mode, "no plan on the site"); continue; }
    if (singlePlan && best.plan.sf <= singlePlan.plan.sf * 1.2) {
      fail(n, mode, "site plans no bigger than its biggest lot", { site: best.plan.sf, lot: singlePlan.plan.sf });
    }
    // gsf / site area, not gsf / one lot
    if (Math.abs(best.plan.far - best.plan.sf / sumArea) > 0.11) fail(n, mode, "far on the wrong area", best.plan.far, best.plan.sf / sumArea);

    const st = E.startDevelopment(g, parcels, root, best.use, best.floors, 0.6);
    if (st.err) { fail(n, mode, "groundbreak", st.err); continue; }
    g = st.s;
    const dev = g.developments[root];
    if (!dev) { fail(n, mode, "no development on root"); continue; }
    for (const c of deeds.slice(1)) if (g.developments[c]) fail(n, mode, "development on child", c);

    // RUN THE CLOCK THE WAY PLAY AND YR DO, and it has to stop on the delivery.
    let stoppedOn = null;
    for (let i = 0; i < 200 && g.developments[root]; i++) {
      const r = E.advanceUntilAttention(g, parcels, bbls, adjacency, 120);
      g = r.s;
      if (g.gameOver) g = { ...g, gameOver: null, cash: g.cash + 50e6 };
      if (r.key?.startsWith(`delivered:${root}:`)) stoppedOn = r;
      if (r.months === 0) break;
    }
    if (g.developments[root]) { fail(n, mode, "never delivered"); continue; }
    if (!stoppedOn) {
      const r = E.advanceUntilAttention(g, parcels, bbls, adjacency, 1);
      fail(n, mode, "the clock ran past the delivery", { deliveredM: g.holdings[root]?.deliveredM, month: g.month, next: r.key });
    } else if (g.holdings[root]?.deliveredM !== g.month) {
      fail(n, mode, "stopped on the delivery in the wrong month", { deliveredM: g.holdings[root]?.deliveredM, month: g.month });
    }
    if (!g.holdings[root]) { fail(n, mode, "lost the site before delivery"); continue; }
    const after = E.resolveRec(parcels, g, root);
    if (Math.abs(after.lotArea - sumArea) > 1) fail(n, mode, "delivered site area", after.lotArea, sumArea);
    if (!(after.bldgArea > 0) || after.class === "land") fail(n, mode, "no building delivered on the site", after.class, after.bldgArea);
    if (Math.abs(after.bldgArea - dev.sf) > 1) fail(n, mode, "delivered sf", after.bldgArea, dev.sf);
    for (const c of deeds.slice(1)) {
      if (g.built?.[c]) fail(n, mode, "a building was stamped on a folded deed", c);
      if (g.merged?.[c] !== root) fail(n, mode, "deed came unfolded after delivery", c);
    }
    console.log(`${n} lots ${mode}: ${sumArea.toLocaleString()} sf site -> ${best.use} ${best.floors} fl, ${Math.round(after.bldgArea).toLocaleString()} sf delivered`
      + (singlePlan ? ` (largest lot alone: ${Math.round(singlePlan.plan.sf).toLocaleString()} sf)` : ""));
  }

  if (envelope["all-at-once"] !== envelope["one-at-a-time"]) fail(n, "envelope depends on assembly order", envelope);

  // ONE FOOTPRINT ON THE MAP.
  const rs = site.map((b) => rings[b]).filter(Boolean);
  const outline = SR.siteOutline(rs);
  const total = rs.reduce((a, r) => a + SR.ringArea(r), 0);
  if (!outline) fail(n, "no site outline");
  else if (Math.abs(SR.ringArea(outline) - total) > total * 0.05) fail(n, "site outline area", SR.ringArea(outline), total);
}

// The outline dissolves across the whole map, not just the sites above.
{
  let tried = 0, one = 0;
  for (const a of bbls) {
    if (!rings[a]) continue;
    const set = [a];
    while (set.length < 3) {
      const nx = set.flatMap((b) => adjacency[b] ?? []).find((b) => rings[b] && !set.includes(b) && parcels[b]?.block === parcels[a].block);
      if (!nx) break;
      set.push(nx);
    }
    if (set.length < 3) continue;
    tried++;
    const rs = set.map((b) => rings[b]);
    const total = rs.reduce((x, r) => x + SR.ringArea(r), 0);
    const out = SR.siteOutline(rs);
    if (out && Math.abs(SR.ringArea(out) - total) <= total * 0.05) one++;
  }
  const rate = one / Math.max(1, tried);
  console.log(`3-lot outlines dissolved to one footprint: ${one}/${tried} (${(rate * 100).toFixed(1)}%)`);
  if (tried < 50) fail("too few 3-lot groups to measure", tried);
  if (rate < 0.97) fail("site outlines", rate);
}

if (fails) { console.error(`${fails} failure(s)`); process.exit(1); }
console.log("assemble-build ok");
