#!/usr/bin/env node
/**
 * Region -> "bw-city/1", the city file the Unreal builder loads
 * (shape: broadway-and-wall/src/citygen/unrealExport.mjs toBwCity;
 *  parser: unreal/BroadwayWall/Source/BroadwayWall/CityData.cpp).
 *
 *   node region-spikes/map/export-unreal.mjs 3                 # full 10 x 10 km
 *   node region-spikes/map/export-unreal.mjs 3 --crop 2000     # 2 x 2 km around downtown
 *   node region-spikes/map/export-unreal.mjs 3 --km 6
 *
 * Writes out/city-region-<seed>[-crop<m>].json. Centimetres, integers, origin at
 * the region's centre, +X north, +Y east; rings flat [x0,y0,x1,y1,...] unclosed.
 *
 * Spike-quality. Building heights downtown and house storeys are ILLUSTRATIVE
 * (labelled where they are set): the island generator owns real downtown massing.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generate, subdivide, NAME_A, SZ, FT, MILE, makeRng, makeNoise, resample, rdp, dist, add, sub, mul, norm, perp, lerp } from "./region.mjs";

// road surface widths (carriageway, m) — the contract with the Unreal side
const W = { highway: 24, arterial: 14, local: 9, core: 12 };
const HOUSE = { prewar: [7, 11], postwar: [9, 13], recent: [9, 13] }; // footprint width x depth, m (contract)
const SETBACK = 7;            // m from the right-of-way edge (contract; ~25 ft front setback is typical, approximate)
const STOREY_CM = { 1: 450, 2: 650 };
// share of 2-storey houses by era — approximate: pre-war two-storey foursquares/bungalows mixed,
// post-war mostly one-storey ranches, recent mostly two-storey
const TWO_STOREY = { prewar: 0.6, postwar: 0.25, recent: 0.7 };
const ERA_YEARS = { prewar: [1905, 1939], postwar: [1946, 1975], recent: [1980, 2022] };
const TREE_CAP = 60000;

// ---------------------------------------------------------------- geometry helpers (map frame, metres)
function hull(pts) { // monotone chain
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cr(up.at(-2), up.at(-1), q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
const circle = (c, r, n = 12) => Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos(2 * Math.PI * i / n), c[1] + r * Math.sin(2 * Math.PI * i / n)]);
/** a road / river as convex capsules, one per segment: never self-intersects, however tight the bend */
function capsules(pl, half, n = 10) {
  const out = [];
  for (let i = 0; i < pl.length - 1; i++) {
    const h0 = typeof half === "number" ? half : half[i], h1 = typeof half === "number" ? half : half[i + 1];
    if (dist(pl[i], pl[i + 1]) < 0.01) continue;
    out.push(hull(circle(pl[i], h0, n).concat(circle(pl[i + 1], h1, n))));
  }
  return out;
}
function rectRing(c, u, w, d) { // w along u, d across
  const v = perp(u);
  return [add(add(c, mul(u, -w / 2)), mul(v, -d / 2)), add(add(c, mul(u, w / 2)), mul(v, -d / 2)), add(add(c, mul(u, w / 2)), mul(v, d / 2)), add(add(c, mul(u, -w / 2)), mul(v, d / 2))];
}
function clipPolyBox(ring, [x0, y0, x1, y1]) { // Sutherland-Hodgman against an axis-aligned box
  let out = ring;
  const edges = [[(p) => p[0] >= x0, (a, b) => lerp(a, b, (x0 - a[0]) / (b[0] - a[0]))], [(p) => p[0] <= x1, (a, b) => lerp(a, b, (x1 - a[0]) / (b[0] - a[0]))],
    [(p) => p[1] >= y0, (a, b) => lerp(a, b, (y0 - a[1]) / (b[1] - a[1]))], [(p) => p[1] <= y1, (a, b) => lerp(a, b, (y1 - a[1]) / (b[1] - a[1]))]];
  for (const [inside, cut] of edges) {
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) {
      const a = inp[i], b = inp[(i + 1) % inp.length];
      if (inside(b)) { if (!inside(a)) out.push(cut(a, b)); out.push(b); } else if (inside(a)) out.push(cut(a, b));
    }
    if (!out.length) return null;
  }
  return out.length >= 3 ? out : null;
}
function clipLineBox(line, box) { // keep the inside runs of a polyline (Liang-Barsky per segment)
  const [x0, y0, x1, y1] = box, runs = []; let cur = [];
  const ins = (p) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1], dx = b[0] - a[0], dy = b[1] - a[1];
    let t0 = 0, t1 = 1, ok = true;
    for (const [p, q] of [[-dx, a[0] - x0], [dx, x1 - a[0]], [-dy, a[1] - y0], [dy, y1 - a[1]]]) {
      if (p === 0) { if (q < 0) ok = false; continue; }
      const r = q / p; if (p < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
    }
    if (!ok || t0 > t1) { if (cur.length > 1) runs.push(cur); cur = []; continue; }
    const pa = lerp(a, b, t0), pb = lerp(a, b, t1);
    if (!cur.length) cur.push(pa);
    cur.push(pb);
    if (t1 < 1) { runs.push(cur); cur = []; }
  }
  if (cur.length > 1) runs.push(cur);
  return runs.filter((r) => !ins(r[0]) || r.length > 1);
}
/** split a polyline where ok() fails, sampling every step metres */
function keepRuns(pl, ok, step = 10) {
  const runs = []; let cur = [];
  for (const p of resample(pl, step)) { if (ok(p)) cur.push(p); else { if (cur.length > 1) runs.push(cur); cur = []; } }
  if (cur.length > 1) runs.push(cur);
  return runs.map((r) => rdp(r, 0.8));
}
/** a raster mask inside a rectangle as row-run rectangles, merged down the rows */
function maskRects(G, [x0, y0, x1, y1], ok) {
  const C = G.S / G.W, i0 = Math.max(0, Math.floor(x0 / C)), i1 = Math.min(G.W - 1, Math.ceil(x1 / C) - 1);
  const j0 = Math.max(0, Math.floor(y0 / C)), j1 = Math.min(G.W - 1, Math.ceil(y1 / C) - 1);
  const out = []; let open = new Map();
  for (let j = j0; j <= j1; j++) {
    const runs = []; let s = -1;
    for (let i = i0; i <= i1 + 1; i++) { const good = i <= i1 && ok(j * G.W + i); if (good && s < 0) s = i; if (!good && s >= 0) { runs.push([s, i - 1]); s = -1; } }
    const next = new Map();
    for (const [a, b] of runs) { const key = a + ":" + b; const r = open.get(key); if (r) { r.j1 = j; open.delete(key); next.set(key, r); } else next.set(key, { a, b, j0: j, j1: j }); }
    for (const r of open.values()) out.push(r); open = next;
  }
  for (const r of open.values()) out.push(r);
  return out.map((r) => { const xa = Math.max(x0, r.a * C), xb = Math.min(x1, (r.b + 1) * C), ya = Math.max(y0, r.j0 * C), yb = Math.min(y1, (r.j1 + 1) * C); return [[xa, ya], [xb, ya], [xb, yb], [xa, yb]]; });
}

// ================================================================ export
// DEFAULT = "gradient" (owner, after the 6 km render: "the city center should be the most built up and it should slowly
// turn into less dense buildings with more vacant lots, then homes and farms starting to surround it, like a real city").
// One continuous gradient by distance r from a centre near the waterfront (noisy, so the rings are not circles, and
// growth reaches further along the first highway). The band edges and shares below are the owner's spec, not facts:
//   r < 400 m    core: 4-8 floors, the two towers (11-12), footprints 70-85%, ~3% gaps
//   400-900 m    2-4 floors, footprints 55-70%, ~15% parking / vacant
//   900-1500 m   1-2 floor shops and small apartments, ~30% vacant, blocks turning into pre-war house blocks outward
//   1500-~2500 m continuous neighbourhoods: pre-war near, post-war further out and along the highway, a few vacant lots;
//                each subdivision built out from the city side first (phases), stopping at a ~2,000-home total
//   beyond       farms and woods; the one river village, small
const GRADIENT = { core: [1600, 1000], gradientCore: { radius: 2300, inset: 450, grid: [4600, 2600] }, townBlocks: [[2, 4], [2, 3]], bankTowns: true, onlyRiverTown: true };
const TRACT_HOUSES = 600; // houses in the outer neighbourhoods; the inner house blocks add ~1,500 (owner: ~2,000 in all)
// The older modes, kept behind flags. Earlier default ("few", --few-suburbs) followed the owner's previous spec: a 6 x 6 km region, a low-rise downtown (--dense restores the first
// export's skyline) and "a lot less housing": only a few neighbourhoods, so the region has room to grow.
// suburbs: "few"  (default) the generator's full growth, then only these kept as built (the rest reverts to farm):
//                  the pre-war ring nearest downtown, the two post-war tracts nearest the first interstate, and
//                  the one recent tract nearest downtown, within a 2,500-house budget (owner target 1,500-2,500).
//                  The budget is the owner's design call (an early point in the region's history), not a fact.
//          "thin"  a third of the urbanised-share KNOB, growth from towns too, little leapfrog (--thin-suburbs)
//          "full"  the generator's own growth, as in the SVG maps (--full-suburbs)
const SPARSE_GEN = { urbanisedScale: 1 / 3, townSources: true, holdoutSigma: 0.1 };
const HOUSE_BUDGET = 2500;
// owner: a small-city core of ~1.0 x 1.5 km (long side on the coast/river), villages scaled down with it —
// the island core is 3.9 km2, this is 1.5 km2 (38%), so village plats shrink by ~sqrt(0.38) a side: 2-4 x 2-3 blocks
const SMALL_TOWN = { core: [1500, 1000], townBlocks: [[2, 4], [2, 3]], bankTowns: true };
export function exportRegion(seed, { km = 6, crop = 0, dense = false, suburbs = "gradient" } = {}) {
  const grad = suburbs === "gradient";
  const M = generate(seed, km, grad ? GRADIENT : { ...(dense ? {} : SMALL_TOWN), ...(suburbs === "thin" ? SPARSE_GEN : {}) }), S = M.S, G = M.G, rng = makeRng("unreal:" + seed);
  if (suburbs === "few") keepFewNeighbourhoods(M);
  if (grad) { storyPrep(M, rng, seed); gradientNeighbourhoods(M, rng, seed); placeFringe(M, rng); }
  const phaseOk = (p) => { if (!M.phase) return true; const k = G.idx(p); return k >= 0 && M.phase[k] === 1; };
  M.rotate = Math.floor(makeRng("orient:" + seed)() * 4); // same orientation as the SVG
  // canonical -> map frame (x east, y south, metres), as render() does
  const T = (p) => { const c = S / 2; let x = p[0] - c, y = p[1] - c; for (let i = 0; i < M.rotate; i++) [x, y] = [-y, x]; return [x + c, y + c]; };
  const TT = (pts) => pts.map(T);
  // map frame -> UE centimetres (+X north, +Y east, origin at the centre)
  const ue = (p) => [Math.round((S / 2 - p[1]) * 100), Math.round((p[0] - S / 2) * 100)];
  const flat = (pts) => pts.flatMap(ue);
  // a crop is centred 1 km inland of downtown's centre, so it holds the downtown edge AND the first suburbs
  const box = crop ? (() => { const c = T(add(M.core.centre ?? M.core.c, mul(norm(sub([S / 2, S / 2], M.core.c)), 1000))); return [c[0] - crop / 2, c[1] - crop / 2, c[0] + crop / 2, c[1] + crop / 2]; })() : [0, 0, S, S];
  const inBox = (p) => p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3];
  const ringOut = (r) => { const c = clipPolyBox(r, box); return c ? flat(c) : null; };
  const centroid = (r) => r.reduce((a, p) => [a[0] + p[0] / r.length, a[1] + p[1] / r.length], [0, 0]);

  // draw order (later on top): water before pavement, so roads cross rivers as bridges
  const ground = { land: [], marsh: [], farm: [], woods: [], yard: [], stream: [], pond: [], pavement: [], block: [], park: [] };
  const put = (layer, canonRing) => { const r = ringOut(TT(canonRing)); if (r) ground[layer].push(r); };
  const coastY = M.coast ? ((xs, ys) => (x) => { const i = Math.max(0, Math.min(xs.length - 2, Math.floor((x + 200) / 40))); return ys[i] + (ys[i + 1] - ys[i]) * ((x + 200) / 40 - i); })(M.coast.line.map((p) => p[0]), M.coast.line.map((p) => p[1])) : null;
  const dry = (ring) => coastY ? ring.map((p) => [p[0], Math.min(p[1], coastY(p[0]))]) : ring; // clamp onto the shore

  // land: the whole window except the sea
  put("land", M.coast ? [[0, -1], [S, -1], ...M.coast.line.slice().reverse()] : [[0, 0], [S, 0], [S, S], [0, S]]);
  // marsh: floodplains as capsules (river every ~80 m, creeks), coastal band as a strip
  const rs = M.river.pts, step = 8;
  for (let i = 0; i < rs.length - step; i += step) put("marsh", dry(hull(circle(rs[i], M.river.fp[i], 16).concat(circle(rs[i + step], M.river.fp[i + step], 16)))));
  for (const c of M.creeks) for (const cap of capsules(rdp(c.pts, 4), c.fp)) put("marsh", dry(cap));
  if (M.coast) { const L = M.coast.line; put("marsh", L.concat(L.slice().reverse().map((p) => [p[0], p[1] - M.coast.band]))); }
  // FOREST (owner: "forests should cover the BACK of the map ... a continuous forest belt, with woodlots sprinkled
  // through the farmland in the middle"): a belt of noisy width ~0.6-1.3 km along the edges away from the coast, kept
  // more than ~2.2 km from the city's centre; developed land, water and the sea are cut out of it
  const nzF = makeNoise(makeRng("forest:" + seed), 700);
  const backEdge = (p) => Math.min(p[0], S - p[0], p[1], M.coast ? Infinity : S - p[1]); // canonical frame: the sea is at y = S
  const forestL = G.layer();
  if (grad) for (let k = 0; k < G.N; k++) {
    const p = G.ctr(k);
    if (M.water[k] || M.isSea(p) || M.coreL[k] || M.townL[k] || M.hwL[k] || (M.taken && M.taken[k]) || (M.phase && M.phase[k])) continue;
    if (M.coast && coastY(p[0]) - p[1] < 900) continue;
    if (dist(p, M.core.centre) < 2200) continue;
    if (backEdge(p) < 600 + 700 * nzF(p[0], p[1])) forestL[k] = 1;
  }
  for (const r of maskRects(G, [0, 0, S, S], (k) => forestL[k] === 1)) put("woods", r);
  // more woodlots sprinkled through the middle farmland (a farm keeps its back forty in trees), ~6% more
  if (grad) for (const t of M.tracts) if (!t.era && !t.wood && rng() < 0.06) t.wood = true;
  M.forestL = forestL;
  // farm / woods / yard from the raster, so nothing lands on the sea or covers the floodplain, and yards stay off freeway right-of-way
  const sea = (k) => M.isSea(G.ctr(k));
  for (const t of M.tracts) {
    if (t.era) {
      for (const r of maskRects(G, t.r, (k) => M.free(G.ctr(k)) && phaseOk(G.ctr(k)))) put("yard", r);
      // the unbuilt remainder of a partly built subdivision is still a field
      if (M.phase) for (const r of maskRects(G, t.r, (k) => !M.phase[k] && !sea(k) && !M.flood[k] && !M.water[k] && !M.coreL[k] && !M.townL[k] && !(M.story && M.story.rS(G.ctr(k)) < RINGS.farmClear))) put("farm", r);
    }
    else for (const r of maskRects(G, t.r, (k) => !sea(k) && !M.flood[k] && !M.water[k] && !M.coreL[k] && !M.townL[k] && !(M.story && M.story.rS(G.ctr(k)) < RINGS.farmClear))) put(t.wood ? "woods" : "farm", r); // land cleared inside the city is not farmed // floodplain stays marsh (it is drawn under farm)
  }
  // water
  for (let i = 0; i < rs.length - 2; i += 2) put("stream", hull(circle(rs[i], M.river.half[i], 12).concat(circle(rs[i + 2], M.river.half[i + 2], 12))));
  for (const c of M.creeks) for (const cap of capsules(rdp(c.pts, 2), c.w / 2, 8)) put("stream", cap);

  // ---------------- roads: pavement polygons + centrelines (built roads only)
  const centerlines = [];
  const road = (pl, cls, wm) => {
    if (pl.length < 2) return;
    const m = TT(pl);
    for (const run of clipLineBox(m, box)) centerlines.push({ w: Math.round(wm * 100), mk: 0, cls: cls === "core" ? "local" : cls, line: flat(run) });
    for (const cap of capsules(pl, wm / 2, 8)) put("pavement", cap);
  };
  for (const h of M.highways) for (const s of h.segs) if (s.built) road(rdp(s.pts, 1), "highway", W.highway);
  // old roads stop at the edge of downtown and the villages: their own street grids take over inside
  const settled = (p) => { const k = G.idx(p); return k >= 0 && (M.coreL[k] || M.townL[k]); };
  for (const r of M.oldRoads) for (const run of keepRuns(r, (p) => !settled(p), 10)) road(run, "arterial", W.arterial);
  for (const r of M.secRoads) road(r, "arterial", W.arterial);
  const okLocal = (p) => M.free(p) && phaseOk(p);
  for (const t of M.tracts) if (t.era) {
    for (const st of t.plat.streets) for (const run of keepRuns(st, okLocal)) road(run, "local", W.local);
    for (const b of t.plat.bulbs) if (okLocal(b)) put("pavement", circle(b, SZ.bulbRadius, 12));
    for (const p of t.plat.ponds) if (okLocal(p.c)) put("pond", circle(p.c, p.r, 20));
  }
  // downtown and town street grids, between the blocks
  const isWaterC = (p) => { const k = G.idx(p); return k >= 0 && M.water[k] === 1; };
  // built freeway pavement plus a verge: the blocks it crosses were cleared for it (urban renewal), so no block or building stands there
  const hwBuilt = G.layer(); for (const h of M.highways) for (const sg of h.segs) if (sg.built) G.line(hwBuilt, sg.pts, W.highway / 2 + 8);
  const underHw = (p) => { const k = G.idx(p); return k >= 0 && hwBuilt[k] === 1; };
  const blockPts = (b) => { const q = b.poly(); return q.concat([b.c], q.map((p, i) => lerp(p, q[(i + 1) % 4], 0.5))); };
  for (const [r, wm] of [[M.core, W.core], ...M.towns.map((t) => [t, W.local])]) {
    const { nL, nW, pl, pw } = r.gridInfo;
    const at = (a, b) => add(add(r.c, mul(r.u, a)), mul(r.v, b));
    // a graded city's grid only runs where its blocks were kept (the settled area), not across the whole rectangle
    const ok = (p) => !isWaterC(p) && (!(grad && r === M.core) || (settled(p) && !M.story.corr[G.idx(p)]));
    for (let i = 0; i <= nL; i++) for (const run of keepRuns([at(-r.hl + i * pl, -r.hw), at(-r.hl + i * pl, r.hw)], ok)) road(run, "core", wm);
    for (let j = 0; j <= nW; j++) for (const run of keepRuns([at(-r.hl, -r.hw + j * pw), at(r.hl, -r.hw + j * pw)], ok)) road(run, "core", wm);
  }

  for (const r of [M.core, ...M.towns]) { if (grad && r === M.core) continue; for (const b of r.blockRects) if (!blockPts(b).some((p) => isWaterC(p) || M.isSea(p) || underHw(p))) put("block", b.poly()); }

  // ---------------- buildings & parcels
  const volumes = [], parcels = [], trees = [], labels = [];
  const townOf = (p) => { let best = { name: "Downtown", d: grad ? dist(p, M.core.centre) - 1500 : dist(p, M.core.c) - M.core.hl }; for (const t of M.towns) { const d = dist(p, t.c); if (d < best.d) best = { name: t.name, d }; } return best.name; };
  const sf = (m2) => Math.round(m2 / (FT * FT));
  const coreLots = []; let nbGrid = 0;
  const blockLots = (r, front, kind) => {
    let n = 0;
    for (const b of r.blockRects) {
      const nl = Math.max(1, Math.round(2 * b.hl / front)), lw = 2 * b.hl / nl;
      for (let i = 0; i < nl; i++) for (const sd of [-1, 1]) {
        const lc = add(add(b.c, mul(b.u, -b.hl + (i + 0.5) * lw)), mul(b.v, sd * b.hw / 2));
        const lot = rectRing(lc, b.u, lw, b.hw);
        if (isWaterC(lc) || lot.some(isWaterC) || blockPts(b).some(underHw)) continue;
        // sparse: some lots are vacant or surface parking (~15% downtown, ~10% villages, approximate)
        if (!dense && rng() < (kind === "core" ? 0.15 : 0.1)) {
          const ring = TT(lot); if (!inBox(centroid(ring))) continue;
          put("pavement", lot);
          const bbl = `${kind === "core" ? "D" : "T"}${parcels.length}`;
          parcels.push({ bbl, address: `${kind === "core" ? "Downtown" : r.name} lot ${++n} (parking)`, block: 0, district: kind === "core" ? "Downtown" : r.name, districtName: kind === "core" ? "Downtown" : r.name, zone: "C", cls: "land", floors: 0, yearBuilt: 0, lotArea: sf(lw * b.hw), bldgArea: 0, ring: flat(ring) });
          continue;
        }
        const cov = dense ? 0.6 + 0.2 * rng() : 0.5 + 0.2 * rng(); // footprint share of the lot (contract: 60-80% dense, 50-70% sparse)
        // building pushed to the street edge of its half-block
        const fw = lw * Math.sqrt(cov), fd = b.hw * Math.sqrt(cov);
        const fc = add(lc, mul(b.v, sd * (b.hw - fd) / 2));
        let floors, cls;
        if (kind === "core") {
          // ILLUSTRATIVE skyline: heights fall off from the centre of the core
          const d = sub(lc, M.core.c), du = (d[0] * M.core.u[0] + d[1] * M.core.u[1]) / M.core.hl, dv = (d[0] * M.core.v[0] + d[1] * M.core.v[1]) / M.core.hw;
          const dn = Math.min(1.4, Math.hypot(du, dv));
          if (dense) {
            floors = Math.round(4 + 4 * (1 - dn / 1.4) + 36 * Math.exp(-4 * dn) * (0.3 + 1.4 * rng() ** 2));
            if (dn < 0.35 && rng() < 0.08) floors = Math.round(floors * 1.8); // the odd tower
          } else {
            // small-town centre (owner direction): mostly 2-4 floors, some 5-8 near the middle, at most two 10-12 floor towers
            floors = 2 + Math.floor(rng() * 3);
            if (dn < 0.5 && rng() < 0.18 * (1 - dn / 0.5)) floors = 5 + Math.floor(rng() * 4);
            coreLots.push({ dn, bbl: `D${parcels.length}` }); // the two most central become the towers, below
          }
          cls = floors >= (dense ? 12 : 5) ? (dn < 0.55 ? "office" : rng() < 0.5 ? "office" : "multifamily") : floors <= 4 && rng() < 0.5 ? "retail" : "multifamily";
        } else {
          floors = 1 + Math.floor(rng() * 3); // 1-3 storey village main street, approximate
          cls = i === 0 || i === nl - 1 || rng() < 0.4 ? "retail" : "multifamily";
        }
        const year = kind === "core" ? Math.round(1880 + 140 * rng() ** 0.8) : Math.round(1860 + 80 * rng());
        const bbl = `${kind === "core" ? "D" : "T"}${parcels.length}`;
        const ring = TT(rectRing(fc, b.u, fw, fd));
        if (!inBox(centroid(ring))) continue;
        volumes.push({ bbl, cls, year, z0: 0, z1: floors * 355, deco: "", crown: true, vacant: false, ring: flat(ring) });
        parcels.push({ bbl, address: `${kind === "core" ? "Downtown" : r.name} lot ${++n}`, block: 0, district: kind === "core" ? "Downtown" : r.name, districtName: kind === "core" ? "Downtown" : r.name, zone: "C", cls, floors, yearBuilt: year, lotArea: sf(lw * b.hw), bldgArea: sf(fw * fd * floors), ring: flat(TT(lot)) });
      }
    }
  };
  let gridHouses = 0;
  if (grad) gridHouses = gradientLots(M.core);
  else blockLots(M.core, 25, "core");          // ~82 ft downtown lots (approximate; island.mjs owns the real plat)
  // the interchange strip: big boxes set back behind their parking lots
  for (const [i, st] of (M.strip ?? []).entries()) {
    const ring = TT(rectRing(st.box.c, st.box.u, st.box.w, st.box.d)); if (!inBox(centroid(ring))) continue;
    put("pavement", rectRing(st.park.c, st.park.u, st.park.w, st.park.d));
    const bbl = "S" + (i + 1);
    volumes.push({ bbl, cls: "retail", year: st.year, z0: 0, z1: 650, deco: "", crown: true, vacant: false, ring: flat(ring) });
    parcels.push({ bbl, address: "Interchange strip, store " + (i + 1), block: 0, district: "Downtown", districtName: "Downtown", zone: "C", cls: "retail", floors: 1, yearBuilt: st.year, lotArea: sf((st.box.w + 10) * (st.box.d + st.park.d)), bldgArea: sf(st.box.w * st.box.d), ring: flat(TT(hull(rectRing(st.box.c, st.box.u, st.box.w, st.box.d).concat(rectRing(st.park.c, st.park.u, st.park.w, st.park.d))))) });
  }
  let exurbHouses = 0;
  for (const [i, st] of (M.pockets ?? []).entries()) {
    const bbl = "P" + (i + 1), all = [];
    let bldg = 0, floors = 1;
    for (const r of st.rects) {
      const ring = rectRing(r.c, st.u, r.w, r.d); all.push(...ring);
      if (r.kind === "pave") put("pavement", ring);
      else if (r.kind === "park") put("park", ring);
      else if (r.kind === "lawn") put("yard", ring);
      else { const q = TT(ring); if (!inBox(centroid(q))) continue; const isHouse = r.kind === "house"; if (isHouse) { exurbHouses++; const tp = T(add(r.c, mul(perp(st.u), -12))); if (inBox(tp)) trees.push(tp); } volumes.push({ bbl, cls: isHouse ? "multifamily" : r.kind === "barn" ? "industrial" : r.cls, year: st.year, z0: 0, z1: r.z, deco: isHouse ? "house" : "", crown: true, vacant: false, ring: flat(q) }); bldg += r.w * r.d; floors = Math.max(floors, Math.max(1, Math.round(r.z / 355))); }
    }
    if (!inBox(centroid(TT(all)))) continue;
    parcels.push({ bbl, address: st.name, block: 0, district: townOf(st.anchor), districtName: townOf(st.anchor), zone: st.cls === "industrial" ? "M" : "C", cls: st.cls, floors, yearBuilt: st.year, lotArea: sf(st.rects.reduce((a, r) => a + r.w * r.d, 0)), bldgArea: sf(bldg), ring: flat(TT(hull(all))) });
  }
  // owner: "at most two ~11-floor towers", in the centre of the core
  coreLots.sort((a, b) => a.dn - b.dn).slice(0, 2).forEach(({ bbl }, j) => {
    const v = volumes.find((x) => x.bbl === bbl), p = parcels.find((x) => x.bbl === bbl);
    if (!v || !p) return;
    const f = grad ? 11 + j : 11, k = f / p.floors; v.z1 = f * 355; v.cls = p.cls = "office"; p.bldgArea = Math.round(p.bldgArea * k); p.floors = f;
  });
  for (const t of M.towns) blockLots(t, 15, "town"); // ~50 ft village lots (approximate)

  function gradientLots(r) {
    const sectors = new Map(); let n = 0, nh = 0;
    const lotParcel = (bbl, address, cls, floors, year, lotM2, bldgM2, ring) => parcels.push({ bbl, address, block: 0, district: "Downtown", districtName: "Downtown", zone: "C", cls, floors, yearBuilt: year, lotArea: sf(lotM2), bldgArea: sf(bldgM2), ring: flat(ring) });
    for (const b of r.blockRects) {
      const St = M.story, kb = G.idx(b.c);
      if (blockPts(b).some((p) => isWaterC(p) || M.isSea(p) || (!St && underHw(p)))) continue;
      const rb = St ? St.rS(b.c) : r.nr(b.c), band = rb < (St ? RINGS.core : 400) ? 0 : rb < (St ? RINGS.mid : 900) ? 1 : 2;
      // what the block was built as: the river's mill/rail strip, the old main street, or the graded city
      const industrial = St && St.ind(b.c) && rb > 250;
      const mainSt = St && !industrial && St.mainL[kb] && rb > 300;
      // outward the shop blocks give way to house blocks (pre-war grid, small lots)
      const houseBlock = !industrial && !mainSt && band === 2 && rng() < Math.min(1, Math.max(0, St ? (rb - RINGS.mid) / (RINGS.city - RINGS.mid) : (rb - 900) / 600)) ** 0.8;
      const front = industrial ? 45 : mainSt ? 15 : houseBlock ? SZ.prewarLot[0] : band === 2 ? 20 : 25;
      const nl = Math.max(1, Math.round(2 * b.hl / front)), lw = 2 * b.hl / nl;
      // ground: a house block is lawn, a city block is paved; a block the freeway touched is laid lot by lot
      const touches = St && blockPts(b).some((p) => St.beside[G.idx(p)] === 1);
      if (!touches) put(houseBlock ? "yard" : "block", b.poly());
      const sec = band === 2 ? Math.floor(((Math.atan2(b.c[1] - r.centre[1], b.c[0] - r.centre[0]) + Math.PI) / (2 * Math.PI)) * 6) % 6 : -1;
      for (let i = 0; i < nl; i++) for (const sd of [-1, 1]) {
        const lc = add(add(b.c, mul(b.u, -b.hl + (i + 0.5) * lw)), mul(b.v, sd * b.hw / 2));
        const lot = rectRing(lc, b.u, lw, b.hw), ring = TT(lot);
        if (isWaterC(lc) || lot.some(isWaterC) || !inBox(centroid(ring))) continue;
        if (touches) {
          const inCorr = (p) => St.corr[G.idx(p)] === 1;
          // the corridor itself: taken for the freeway, grassed either side of the carriageway (drawn under the road)
          if (inCorr(lc) || lot.filter(inCorr).length >= 2) { put("yard", lot); continue; }
          if (St.beside[G.idx(lc)] === 1) {
            // beside the cut: what the decades made of the leftover lots
            const x = rng(), bbl = `D${parcels.length}`;
            if (x < 0.35) { put("pavement", lot); lotParcel(bbl, `Downtown lot ${++n} (parking)`, "land", 0, 0, lw * b.hw, 0, ring); }
            else if (x < 0.55) { put("yard", lot); lotParcel(bbl, `Downtown lot ${++n} (highway verge)`, "land", 0, 0, lw * b.hw, 0, ring); }
            else if (x < 0.75) { put("yard", lot); lotParcel(bbl, `Downtown lot ${++n} (vacant)`, "land", 0, 0, lw * b.hw, 0, ring); }
            else {
              put("block", lot);
              const cv = 0.5 + 0.2 * rng(), fw = lw * Math.sqrt(cv), fd = b.hw * Math.sqrt(cv), fc = add(lc, mul(b.v, sd * (b.hw - fd) / 2));
              const floors = 3 + Math.floor(rng() * 4), year = Math.round(1965 + 20 * rng()), cls = rng() < 0.6 ? "office" : "multifamily";
              volumes.push({ bbl, cls, year, z0: 0, z1: floors * 355, deco: "", crown: true, vacant: false, ring: flat(TT(rectRing(fc, b.u, fw, fd))) });
              lotParcel(bbl, `Downtown lot ${++n}`, cls, floors, year, lw * b.hw, fw * fd * floors, ring);
            }
            continue;
          }
          put(houseBlock ? "yard" : "block", lot);
        }
        if (industrial) {
          // warehouses and yards (1890-1945); the outer end declined after the 1960s, so its lots stand empty
          const declined = rb > RINGS.mid, bbl = `D${parcels.length}`;
          if (rng() < (declined ? 0.45 : 0.2)) {
            put(declined ? (touches ? "yard" : "park") : "pavement", lot); // a working rail yard is paved; a dead mill lot is weeds
            lotParcel(bbl, `Waterfront lot ${++n} (${declined ? "vacant, former mill" : "rail yard"})`, "land", 0, 0, lw * b.hw, 0, ring);
            continue;
          }
          const cv = 0.6 + 0.2 * rng(), fw = lw * Math.sqrt(cv), fd = b.hw * Math.sqrt(cv), fc = add(lc, mul(b.v, sd * (b.hw - fd) / 2));
          const floors = 1 + (rng() < 0.35 ? 1 : 0), year = Math.round(1890 + 55 * rng());
          volumes.push({ bbl, cls: "industrial", year, z0: 0, z1: floors === 1 ? 750 : 1100, deco: "", crown: true, vacant: false, ring: flat(TT(rectRing(fc, b.u, fw, fd))) });
          lotParcel(bbl, `Waterfront lot ${++n} (warehouse)`, "industrial", floors, year, lw * b.hw, fw * fd * floors, ring);
          continue;
        }
        if (mainSt) {
          // the old main street: narrow 2-3 floor shopfronts built to the lot line (1880-1930), few gaps
          const bbl = `D${parcels.length}`;
          if (rng() < 0.05) { put(touches ? "yard" : "park", lot); lotParcel(bbl, `Main Street lot ${++n} (vacant)`, "land", 0, 0, lw * b.hw, 0, ring); continue; }
          const cv = 0.8 + 0.1 * rng(), fw = lw * 0.96, fd = b.hw * cv, fc = add(lc, mul(b.v, sd * (b.hw - fd) / 2));
          const floors = 2 + (rng() < 0.45 ? 1 : 0), year = Math.round(1880 + 50 * rng()), cls = rng() < 0.7 ? "retail" : "multifamily";
          volumes.push({ bbl, cls, year, z0: 0, z1: floors * 355, deco: "", crown: true, vacant: false, ring: flat(TT(rectRing(fc, b.u, fw, fd))) });
          lotParcel(bbl, `Main Street lot ${++n}`, cls, floors, year, lw * b.hw, fw * fd * floors, ring);
          continue;
        }
        // the edge ring is mixed, not a switch: corner shops and small apartments among the houses on the inner side,
        // houses among the shops further out; the outermost blocks are only partly built (shares approximate, K)
        const tEdge = St ? Math.min(1, Math.max(0, (rb - RINGS.mid) / (RINGS.city - RINGS.mid))) : 0;
        let asShop = null, asHouse = false;
        if (houseBlock) { if ((i === 0 || i === nl - 1) && rng() < 0.5 * (1 - tEdge)) asShop = "corner"; else if (rng() < 0.18 * (1 - tEdge)) asShop = "apartment"; }
        else if (band === 2 && rng() < 0.45 * tEdge) asHouse = true;
        const vacant = rng() < (houseBlock || asHouse ? 0.12 + 0.35 * Math.max(0, (tEdge - 0.7) / 0.3) : [0.03, 0.15, 0.3][band]);
        if ((houseBlock && !asShop) || asHouse) {
          if (vacant) { if (asHouse) put(touches ? "yard" : "park", lot); continue; } // an empty lot: weeds
          const [w, d] = HOUSE.prewar;
          const c = add(lc, mul(b.v, sd * (b.hw / 2 - 4 - d / 2)));
          let s = sectors.get(sec);
          // older nearer the water, where the town began
          if (!s) { const wd = St ? Math.min(1, St.waterD[kb] / 1500) : rng(); s = { bbl: `N${++nbGrid}g`, pts: [], bldg: 0, n: 0, year: Math.round(1890 + 35 * wd + 10 * rng()) }; sectors.set(sec, s); }
          const storeys = rng() < TWO_STOREY.prewar ? 2 : 1;
          volumes.push({ bbl: s.bbl, cls: "multifamily", year: s.year, z0: 0, z1: STOREY_CM[storeys], deco: "house", crown: true, vacant: false, ring: flat(TT(rectRing(c, b.u, w, d))) });
          s.pts.push(...lot); s.bldg += w * d * storeys; s.n++; nh++;
          if (s.n % 2 === 0) { const tp = T(add(lc, mul(b.v, sd * (b.hw / 2 - 1.5)))); if (inBox(tp)) trees.push(tp); }
          continue;
        }
        const bbl = `D${parcels.length}`;
        if (vacant) { put(band < 2 && !asShop ? "pavement" : touches || houseBlock ? "yard" : "park", lot); lotParcel(bbl, `Downtown lot ${++n} (${band < 2 ? "parking" : "vacant"})`, "land", 0, 0, lw * b.hw, 0, ring); continue; }
        const cov = [[0.7, 0.85], [0.55, 0.7], [0.5, 0.65]][band], cv = cov[0] + (cov[1] - cov[0]) * rng();
        const fw = lw * Math.sqrt(cv), fd = b.hw * Math.sqrt(cv), fc = add(lc, mul(b.v, sd * (b.hw - fd) / 2));
        const floors = asShop === "corner" ? 1 + (rng() < 0.5 ? 1 : 0) : asShop === "apartment" ? 2 + (rng() < 0.5 ? 1 : 0) : band === 0 ? 4 + Math.floor(rng() * 5) : band === 1 ? 2 + Math.floor(rng() * 3) : 1 + (rng() < 0.4 ? 1 : 0);
        const x = rng();
        const cls = asShop === "corner" ? "retail" : asShop === "apartment" ? "multifamily" : band === 0 ? (x < 0.6 ? "office" : x < 0.8 ? "multifamily" : "retail") : band === 1 ? (x < 0.4 ? "retail" : x < 0.8 ? "multifamily" : "office") : (x < 0.5 ? "retail" : "multifamily");
        const year = Math.round(band === 0 ? 1880 + 140 * rng() ** 0.8 : 1890 + 70 * rng());
        if (band === 0) coreLots.push({ dn: rb, bbl });
        volumes.push({ bbl, cls, year, z0: 0, z1: floors * 355, deco: "", crown: true, vacant: false, ring: flat(TT(rectRing(fc, b.u, fw, fd))) });
        lotParcel(bbl, `Downtown lot ${++n}`, cls, floors, year, lw * b.hw, fw * fd * floors, ring);
      }
    }
    // the inner house blocks, one neighbourhood parcel per sector of the ring
    for (const s of sectors.values()) {
      const name = `${NAME_A[Math.floor(rng() * NAME_A.length)]}${["wood", "dale", "field", "brook", "view", "haven"][Math.floor(rng() * 6)]} ${["Park", "Terrace", "Heights", "Place"][Math.floor(rng() * 4)]}`;
      const lotM2 = s.pts.length / 4 * SZ.prewarLot[0] * SZ.prewarLot[1];
      parcels.push({ bbl: s.bbl, address: `${name} (neighbourhood)`, block: 0, district: "Downtown", districtName: "Downtown", zone: "R", cls: "multifamily", floors: 2, yearBuilt: s.year, lotArea: sf(lotM2), bldgArea: sf(s.bldg), houses: s.n, ring: flat(TT(hull(s.pts))) });
    }
    return nh;
  }

  const SUFFIX = { prewar: ["Park", "Terrace", "Heights", "Place"], postwar: ["Village", "Gardens", "Manor", "Acres"], recent: ["Estates", "Meadows", "Reserve", "Crossing", "Ridge"] };
  let houses = 0, nb = 0;
  for (const t of M.tracts) {
    const tr = TT([[t.r[0], t.r[1]], [t.r[2], t.r[1]], [t.r[2], t.r[3]], [t.r[0], t.r[3]]]);
    if (!inBox(centroid(tr)) && !crop) continue;
    if (crop && !clipPolyBox(tr, box)) continue;
    if (!t.era) {
      if (t.landShare === 0) continue;
      parcels.push({ bbl: `F${parcels.length}`, address: `${t.wood ? "Woodlot" : "Farm"} tract (${Math.round(t.acres)} ac)`, block: 0, district: townOf(t.c), districtName: townOf(t.c), zone: "A", cls: "land", floors: 0, yearBuilt: 0, lotArea: sf(t.acres * 4046.856 * t.landShare), bldgArea: 0, ring: ringOut(tr) });
      continue;
    }
    const [y0, y1] = ERA_YEARS[t.era], year = Math.round(y0 + (y1 - y0) * rng());
    const bbl = `N${++nb}`;
    let bldg = 0, nh = 0;
    for (const h of t.plat.houses) {
      if (t.keep && !t.keep.has(h)) continue;
      const [w, d] = HOUSE[t.era];
      const c = add(h.m, mul(perp(h.u), h.sd * (SZ.localROW / 2 + SETBACK + d / 2)));
      if (!M.free(c) || !M.free(h.m)) continue;
      const ring = TT(rectRing(c, h.u, w, d));
      if (!inBox(centroid(ring))) continue;
      const storeys = rng() < TWO_STOREY[t.era] ? 2 : 1;
      volumes.push({ bbl, cls: "multifamily", year, z0: 0, z1: STOREY_CM[storeys], deco: "house", crown: true, vacant: false, ring: flat(ring) });
      bldg += w * d * storeys; nh++;
      if (nh % 2 === 0) { const tp = T(add(h.m, mul(perp(h.u), h.sd * (SZ.localROW / 2 + 2.5)))); if (inBox(tp)) trees.push(tp); } // street tree, one per ~2 houses
    }
    houses += nh;
    const name = `${NAME_A[Math.floor(rng() * NAME_A.length)]}${["wood", "dale", "field", "brook", "view", "haven"][Math.floor(rng() * 6)]} ${SUFFIX[t.era][Math.floor(rng() * SUFFIX[t.era].length)]}`;
    parcels.push({ bbl, address: `${name} (neighbourhood)`, block: 0, district: townOf(t.c), districtName: townOf(t.c), zone: "R", cls: "multifamily", floors: 2, yearBuilt: year, lotArea: sf(t.acres * 4046.856 * t.buildable), bldgArea: sf(bldg), houses: nh, ring: ringOut(tr) });
  }
  // woodlot and forest trees on a jittered grid, thinned so the file stays under the cap
  const woodCells = []; for (const t of M.tracts) if (!t.era && t.wood) woodCells.push(t);
  const forestCells = M.forestL.reduce((a, v) => a + v, 0);
  const woodArea = woodCells.reduce((a, t) => a + (t.r[2] - t.r[0]) * (t.r[3] - t.r[1]), 0) + forestCells * (S / G.W) ** 2;
  const spacing = Math.max(12, Math.sqrt(woodArea / Math.max(1, TREE_CAP - trees.length)));
  for (const t of woodCells) for (let x = t.r[0] + spacing / 2; x < t.r[2]; x += spacing) for (let y = t.r[1] + spacing / 2; y < t.r[3]; y += spacing) {
    const p = [x + (rng() - 0.5) * spacing * 0.8, y + (rng() - 0.5) * spacing * 0.8];
    if (M.isSea(p) || isWaterC(p) || settled(p) || !M.free(p) && !M.flood[G.idx(p)] || (M.story && M.story.rS(p) < RINGS.farmClear)) continue;
    const q = T(p); if (inBox(q)) trees.push(q);
  }
  for (let x = spacing / 2; x < S; x += spacing) for (let y = spacing / 2; y < S; y += spacing) {
    const p = [x + (rng() - 0.5) * spacing * 0.8, y + (rng() - 0.5) * spacing * 0.8], k = G.idx(p);
    if (k < 0 || !M.forestL[k]) continue;
    const q = T(p); if (inBox(q)) trees.push(q);
  }
  labels.push({ name: "Downtown", kind: "town", at: ue(T(M.core.centre ?? M.core.c)) });
  for (const t of M.towns) labels.push({ name: t.name, kind: "town", at: ue(T(t.c)) });

  const [bx0, by0, bx1, by1] = box;
  const bounds = (() => { const a = ue([bx0, by1]), b = ue([bx1, by0]); return { minX: a[0], maxX: b[0], minY: a[1], maxY: b[1] }; })();
  const kept = parcels.filter((p) => p.ring);
  const name = `${M.river.name.replace(/ River$/, "")} Valley`;
  return {
    stats: { volumes: volumes.length, houses: houses + gridHouses + exurbHouses, gridHouses, exurbHouses, parcels: kept.length, neighbourhoods: nb + nbGrid, trees: trees.length, centerlines: centerlines.length, ground: Object.fromEntries(Object.entries(ground).map(([k, v]) => [k, v.length])) },
    city: {
      format: "bw-city/1",
      city: { id: `region-${seed}`, seed: Number(seed) || 0, size: "region", name, lots: kept.length },
      origin: { lon: 0, lat: 0 },
      bounds, parcels: kept, volumes, water: [], ground,
      trees: trees.flatMap(ue), labels,
      markings: { centerlines, zebras: [], crosswalks: [], curbs: [], parkkerbs: [], parkpaths: [] },
      benches: [],
    },
  };
}

/**
 * The city's history as fields the gradient reads (owner: density "should tell a story and be realistic", not spread
 * uniformly). Each pattern is tied to an era of the region's growth:
 *  - streetcar / wagon era (pre-1920): the city grew out along the OLD COUNTRY ROADS first, so distance counts for
 *    less along them (fingers of development); the oldest, densest fabric is by the waterfront where the town began;
 *  - the OLD MAIN STREET: the old road leaving the core inland, lined with 2-3 floor shopfronts (1880-1930);
 *  - railway / mill era (1890-1945): an INDUSTRIAL STRIP of warehouses and yards along the river; its outer end
 *    DECLINED after the 1960s, so vacant lots cluster there;
 *  - interstate era (1960s on): growth reaches out along the FIRST HIGHWAY; a newer COMMERCIAL STRIP sits at the
 *    first interchange (1985-2015);
 *  - recent: a couple of LEAPFROG subdivisions out by the highway / old roads, past a farm still holding out.
 * The strengths below (0.72 along old roads, 0.85 near the interstate, the waterfront term) are shape parameters chosen
 * by eye for this spike, not calibrated.
 */
// Ring edges in story distance (m). Owner, after the gradient render: "downtown seems about twice as large as it should
// be" and "city looks a bit too big" — so the dense core is ~0.7 x 1.0 km (radius ~280 m from a waterfront centre) and
// the whole built-up city ~1 km instead of ~1.45 km. Design values from the owner, not measurements.
export const RINGS = { core: 280, mid: 640, city: 1000, mainStreet: 1400, farmClear: 640 };
function storyPrep(M, rng, seed) {
  const G = M.G, core = M.core, c = core.centre, Wd = G.W, C = G.S / G.W;
  const bfs = (src) => {
    const d = new Float32Array(G.N).fill(Infinity), q = [];
    for (let k = 0; k < G.N; k++) if (src(k)) { d[k] = 0; q.push(k); }
    for (let h = 0; h < q.length; h++) { const k = q[h], x = k % Wd, y = Math.floor(k / Wd); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= Wd || ny >= Wd) continue; const n = ny * Wd + nx; if (d[n] === Infinity) { d[n] = d[k] + C; q.push(n); } } }
    return d;
  };
  const riverL = G.layer(); M.river.pts.forEach((p, i) => G.disk(riverL, p, M.river.half[i]));
  const waterD = bfs((k) => M.water[k] === 1), riverD = bfs((k) => riverL[k] === 1);
  const oldNear = G.layer(); for (const r of M.oldRoads) G.line(oldNear, r, 120);
  const hwNear = G.layer(); for (const h of M.highways) if (h.kind === "interstate") for (const s of h.segs) if (s.built) G.line(hwNear, s.pts, 450);
  const nz = makeNoise(makeRng("story:" + seed), 450);
  const at = (p) => G.idx(p);
  // "story distance": how far a place is from the centre in time, not metres
  const rS = (p) => {
    const k = at(p); if (k < 0) return Infinity;
    let f = 0.82 + 0.36 * nz(p[0], p[1]);
    if (oldNear[k]) f *= 0.72; else if (hwNear[k]) f *= 0.85;
    f *= 0.85 + 0.3 * Math.min(1, waterD[k] / 1800); // oldest by the water, thinner on the far side
    return dist(p, c) * f;
  };
  // the old main street: the old road that leaves the core most directly inland
  const inland = norm(sub(core.c, c));
  let best = null;
  for (const r of M.oldRoads) {
    if (Math.min(...r.map((p) => dist(p, c))) > 700) continue;
    let sc = -Infinity; for (const p of r) { const d = dist(p, c); if (d > 600 && d < 1800) sc = Math.max(sc, (sub(p, c)[0] * inland[0] + sub(p, c)[1] * inland[1]) / d); }
    if (!best || sc > best.sc) best = { r, sc };
  }
  const mainL = G.layer();
  if (best) G.line(mainL, best.r.filter((p) => dist(p, c) < 2000), 70);
  const ind = (p) => { const k = at(p); return k >= 0 && riverD[k] < 260 && dist(p, c) > 250; };
  M.story = { rS, mainL, ind, waterD, oldNear, hwNear, main: best?.r };

  // the city's extent follows the story, not a circle: keep blocks within story distance, plus the main street
  // a block also goes if it would stand in water or on built freeway (cleared for it in the 1960s), so no orphan streets remain
  // the 1960s freeway cut: only its own corridor was taken (~80 m wide, following the line, ragged where it nicked
  // blocks); the lots beside it were reassembled over the following decades (parking, a few 1970s buildings, verges,
  // weedy vacant lots). Corridor half-width 40 m and the 130 m "beside" band are approximate.
  const corr = G.layer(), beside = G.layer();
  for (const h of M.highways) for (const sg of h.segs) if (sg.built) { G.line(corr, sg.pts, 40); G.line(beside, sg.pts, 130); }
  M.story.corr = corr; M.story.beside = beside;
  const wet = (p) => { const k = at(p); return k < 0 || M.water[k] === 1 || M.isSea(p); };
  core.blockRects = core.blockRects.filter((b) => (rS(b.c) <= RINGS.city || (mainL[at(b.c)] && dist(b.c, c) < RINGS.mainStreet)) && !b.poly().concat([b.c]).some(wet));
  core.blocks = core.blockRects.map((b) => b.poly());
  M.coreL.fill(0);
  for (const b of core.blockRects) {
    const e = { ...b, hl: b.hl + 12, hw: b.hw + 12 }, P = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, d]) => add(add(b.c, mul(b.u, a * e.hl)), mul(b.v, d * e.hw)));
    const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
    for (let y = Math.max(0, Math.floor(Math.min(...ys) / C)); y <= Math.min(Wd - 1, Math.floor(Math.max(...ys) / C)); y++)
      for (let x = Math.max(0, Math.floor(Math.min(...xs) / C)); x <= Math.min(Wd - 1, Math.floor(Math.max(...xs) / C)); x++) {
        const k = y * Wd + x, q = sub(G.ctr(k), b.c);
        if (!M.water[k] && Math.abs(q[0] * b.u[0] + q[1] * b.u[1]) <= e.hl && Math.abs(q[0] * b.v[0] + q[1] * b.v[1]) <= e.hw) M.coreL[k] = 1;
      }
  }
  for (const t of M.tracts) { // land freed at the city's edge can be farmed or built again
    let ok = 0; const [x0, y0, x1, y1] = t.r;
    for (let i = 0.5; i < 6; i++) for (let j = 0.5; j < 6; j++) { const k = at([x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * j / 6]); if (k >= 0 && !M.water[k] && !M.flood[k] && !M.coreL[k] && !M.townL[k]) ok++; }
    t.buildable = ok / 36;
  }

  // the newer commercial strip at the first interchange out of the city (1985-2015)
  M.taken = G.layer(); M.strip = [];
  const ixs = M.highways.filter((h) => h.kind === "interstate").flatMap((h) => h.ix.filter((x) => !x.sys)).map((x) => ({ p: x.p, d: dist(x.p, c) })).filter((x) => x.d > 900 && x.d < 2800).sort((a, b) => a.d - b.d);
  if (ixs.length) {
    const I = ixs[0].p;
    for (const d of [140, 240, 340]) for (let a = 0; a < 2 * Math.PI && M.strip.length < 8; a += 0.35) {
      const p = add(I, [d * Math.cos(a), d * Math.sin(a)]);
      if (!M.free(p) || M.isSea(p) || M.strip.some((s) => dist(s.c, p) < 105)) continue;
      const w = 50 + 40 * rng(), dd = 35 + 25 * rng(), u = [1, 0], v = [0, 1];
      const toI = norm(sub(I, p)), side = Math.abs(toI[0]) > Math.abs(toI[1]) ? [Math.sign(toI[0]), 0] : [0, Math.sign(toI[1])];
      // the box sits back, its parking lot in front toward the interchange road (approximate big-box layout)
      const lotDepth = 45, box = { c: sub(p, mul(side, lotDepth / 2)), u: side[0] ? v : u, w, d: dd };
      const park = { c: add(p, mul(side, dd / 2)), u: box.u, w: w + 10, d: lotDepth };
      M.strip.push({ c: p, box, park, year: Math.round(1985 + 30 * rng()) });
      G.disk(M.taken, p, 90);
    }
  }
  placePockets(M, rng, rS, hwNear, oldNear);
}

/**
 * Ordinary parcels with buildings out in the region, each laid against an arterial (offset past its 66 ft ROW). Sizes are
 * typical of the type (approximate): strip centre 80-140 m long, 1 storey, parking in front; distribution centre
 * 180-260 x 90-130 m, 10-15 m clear height, truck court; grain elevator silos ~35 m; small office park 3 x 2-3 storeys.
 */
function placePockets(M, rng, rS, hwNear, oldNear) {
  const G = M.G, sites = []; M.pockets = sites;
  const okPt = (p) => { const k = G.idx(p); return k >= 0 && M.free(p) && !M.isSea(p) && !M.taken[k] && !M.flood[k] && !(M.phase && M.phase[k]) && !M.coreL[k]; };
  const tryPlace = (anchor, u, pieces, meta) => {
    for (const side of [1, -1]) {
      const v = mul(perp(u), side);
      const rects = pieces.map((pc) => ({ ...pc, c: add(add(anchor, mul(u, pc.a)), mul(v, 12 + pc.o + pc.d / 2)) }));
      if (!rects.flatMap((r) => rectRing(r.c, u, r.w, r.d).concat([r.c])).every(okPt)) continue;
      if (sites.some((x) => dist(x.anchor, anchor) < Math.min(meta.gap ?? 500, x.gap ?? 500))) return false; // pockets stand apart
      for (const r of rects) G.disk(M.taken, r.c, Math.max(r.w, r.d) / 2 + 15);
      sites.push({ ...meta, anchor, u, rects }); return true;
    }
    return false;
  };
  // where pockets can go: points every 150 m along the arterials, with the road's direction
  const pts = [];
  for (const pl of M.oldRoads.concat(M.secRoads)) {
    const r = resample(pl, 150);
    for (let i = 1; i < r.length - 1; i++) pts.push({ p: r[i], u: norm(sub(r[i + 1], r[i - 1])), rs: rS(r[i]), hw: !!hwNear[G.idx(r[i])], old: !!oldNear[G.idx(r[i])] });
  }
  const ix = M.highways.filter((h) => h.kind === "interstate").flatMap((h) => h.ix.filter((x) => !x.sys && h.segs.some((sg) => sg.built && x.s >= sg.s0 - 1 && x.s <= sg.s1 + 1)).map((x) => x.p));
  const nearIx = (p, d) => ix.some((q) => dist(p, q) < d);
  const shuffle = (a) => a.map((x) => [rng(), x]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
  const place = (n, filter, make) => { let k = 0; for (const c of shuffle(pts.filter(filter))) { if (k >= n) break; if (tryPlace(c.p, c.u, ...make())) k++; } return k; };
  const R = (a, b) => a + (b - a) * rng();
  // distribution centres near the highway and its interchanges (1990-2020)
  place(2 + (rng() < 0.5 ? 1 : 0), (c) => c.rs > 1200 && nearIx(c.p, 900), () => { const w = R(180, 260), d = R(90, 130); return [[{ a: 0, o: 0, w: w + 20, d: 50, kind: "pave" }, { a: 0, o: 50, w, d, kind: "bldg", z: Math.round(R(1000, 1500)), cls: "industrial" }], { name: "Distribution centre", cls: "industrial", year: Math.round(R(1990, 2020)) }]; });
  // retail strip centres along arterials (1960-2005)
  place(3 + (rng() < 0.5 ? 1 : 0), (c) => c.rs > 1100 && c.rs < 2800 && (c.old || c.hw), () => { const L = R(80, 140); return [[{ a: 0, o: 0, w: L, d: 35, kind: "pave" }, { a: 0, o: 35, w: L, d: 22, kind: "bldg", z: 520, cls: "retail" }], { name: "Strip centre", cls: "retail", year: Math.round(R(1960, 2005)) }]; });
  // a gas station and diner at a country crossroads
  place(1, (c) => c.rs > 1800 && !c.hw, () => [[{ a: 0, o: 0, w: 45, d: 30, kind: "pave" }, { a: -6, o: 30, w: 16, d: 11, kind: "bldg", z: 450, cls: "retail" }, { a: 34, o: 0, w: 26, d: 16, kind: "pave" }, { a: 34, o: 16, w: 18, d: 12, kind: "bldg", z: 450, cls: "retail" }], { name: "Gas station and diner", cls: "retail", year: Math.round(R(1935, 1965)) }]);
  // a farm co-op grain elevator on a country road
  place(1, (c) => c.rs > 2200 && !c.hw, () => [[{ a: 0, o: 0, w: 70, d: 45, kind: "pave" }, { a: -22, o: 45, w: 12, d: 12, kind: "bldg", z: 3600, cls: "industrial" }, { a: -8, o: 45, w: 12, d: 12, kind: "bldg", z: 3600, cls: "industrial" }, { a: 6, o: 45, w: 12, d: 12, kind: "bldg", z: 3200, cls: "industrial" }, { a: 32, o: 45, w: 36, d: 18, kind: "bldg", z: 700, cls: "industrial" }], { name: "Farm co-op grain elevator", cls: "industrial", year: Math.round(R(1910, 1950)) }]);
  // a small business park by the highway (1975-2000)
  place(1, (c) => c.rs > 1100 && c.rs < 3200 && (c.hw || nearIx(c.p, 1500)), () => [[{ a: 0, o: 0, w: 160, d: 40, kind: "pave" }, ...[-55, 0, 55].map((a) => ({ a, o: 40, w: 38, d: 24, kind: "bldg", z: 355 * (2 + (rng() < 0.5 ? 1 : 0)), cls: "office" }))], { name: "Business park", cls: "office", year: Math.round(R(1975, 2000)) }]);
  // a church and school campus with its playing field
  place(1, (c) => c.rs > 1000 && c.rs < 2400, () => [[{ a: -45, o: 0, w: 50, d: 30, kind: "pave" }, { a: -45, o: 30, w: 70, d: 35, kind: "bldg", z: 760, cls: "office" }, { a: 40, o: 8, w: 18, d: 32, kind: "bldg", z: 1300, cls: "office" }, { a: -10, o: 70, w: 100, d: 60, kind: "park" }], { name: "Church and school", cls: "office", year: Math.round(R(1900, 1960)) }]);

  M._pk = { tryPlace, shuffle, place, R, pts };
}

/** the exurban fringe, laid after the neighbourhoods so it starts where building actually stops */
function placeFringe(M, rng) {
  // EXURBAN FRINGE (owner: the city should not stop in a wall): big-lot homes strung along the roads leading out,
  // hobby farms, a few houses at farm crossroads, a gravel lot or two. Lots grow from ~0.5 to ~2 ac over the first
  // ~600 m past the city's edge and thin out; beyond that only the odd lot. Rural lot sizes 0.5-2 ac [S, approximate];
  // the probabilities are shape parameters [K].
  const { tryPlace, shuffle, place, R } = M._pk, G = M.G;
  // distance from what is already built (the city and the neighbourhoods), so the fringe hugs the real edge
  const built = new Float32Array(G.N).fill(Infinity), q = [];
  for (let k = 0; k < G.N; k++) if (M.coreL[k] || (M.phase && M.phase[k])) { built[k] = 0; q.push(k); }
  const C = G.S / G.W;
  for (let h = 0; h < q.length; h++) { const k = q[h], x = k % G.W, y = Math.floor(k / G.W); for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= G.W || ny >= G.W) continue; const n = ny * G.W + nx; if (built[n] === Infinity) { built[n] = built[k] + C; q.push(n); } } }
  const rS = (p) => { const k = G.idx(p); return k < 0 ? Infinity : CITY + built[k]; };
  const CITY = RINGS.city;
  const house = (a, o, year) => { const two = rng() < 0.5; return [{ a, o, w: 10, d: 14, kind: "house", z: two ? 650 : 450 }, { a, o: 0, w: 4, d: o, kind: "pave" }]; };
  const pts70 = [];
  for (const pl of M.oldRoads.concat(M.secRoads)) { const r = resample(pl, 70); for (let i = 1; i < r.length - 1; i++) pts70.push({ p: r[i], u: norm(sub(r[i + 1], r[i - 1])), rs: rS(r[i]) }); }
  const fringeP = (rs) => rs < CITY ? 0 : rs < CITY + 600 ? 0.08 + 0.7 * (1 - (rs - CITY) / 600) : rs < CITY + 1600 ? 0.05 : 0;
  for (const c of shuffle(pts70)) {
    if (rng() > fringeP(c.rs)) continue;
    const far = Math.min(1, Math.max(0, (c.rs - CITY) / 600)), year = Math.round(1950 + 60 * Math.min(1, far * 0.7 + 0.3 * rng()));
    if (rng() < 0.03 + 0.12 * far) { // a hobby farm, ~5 ac: house, barn, paddock
      tryPlace(c.p, c.u, [{ a: 0, o: 0, w: 110, d: 170, kind: "lawn" }, ...house(-30, 18, year), { a: 25, o: 45, w: 18, d: 30, kind: "barn", z: 900 }], { name: "Hobby farm (5 ac)", cls: "multifamily", year, gap: 40 });
      continue;
    }
    const ac = 0.5 + 1.5 * far * rng(), area = ac * 4046.856, Fw = Math.sqrt(area / 1.6), Dd = area / Fw; // frontage : depth ~ 1 : 1.6
    tryPlace(c.p, c.u, [{ a: 0, o: 0, w: Fw, d: Dd, kind: "lawn" }, ...house((rng() - 0.5) * Fw * 0.4, 12 + 12 * rng(), year)], { name: `Rural home (${ac.toFixed(1)} ac)`, cls: "multifamily", year, gap: 40 });
  }
  // a few older houses at the farm crossroads (section corners), and a gravel lot or two by the road
  const { ox, oy } = M.survey;
  for (let x = ox - MILE; x < M.S + MILE; x += MILE) for (let y = oy - MILE; y < M.S + MILE; y += MILE) {
    const p = [x, y]; if (p[0] < 100 || p[1] < 100 || p[0] > M.S - 100 || p[1] > M.S - 100 || rS(p) < CITY + 300 || rng() > 0.4) continue;
    for (const [da, u] of [[70, [1, 0]], [-70, [1, 0]], [70, [0, 1]]]) if (rng() < 0.6) { const year = Math.round(1900 + 60 * rng()); tryPlace(add(p, mul(u, da)), u, [{ a: 0, o: 0, w: 50, d: 80, kind: "lawn" }, ...house(0, 15, year)], { name: "Farmhouse at the crossroads", cls: "multifamily", year, gap: 40 }); }
  }
  place(2, (c) => c.rs > CITY + 200 && c.rs < CITY + 1500, () => [[{ a: 0, o: 0, w: 30 + 15 * rng(), d: 40, kind: "pave" }], { name: "Gravel lot", cls: "land", year: Math.round(R(1950, 1990)), gap: 300 }]);
}

/** gradient mode: neighbourhoods wrap the city continuously. Every tract on the city's bank is laid out; then houses are
 * built in order of their (noisy, highway-shortened) distance from the centre until the budget is spent — so each
 * subdivision is built out from the city side first, the way a plat is built in phases. */
function gradientNeighbourhoods(M, rng, seed) {
  const G = M.G, c = M.core.centre, nz = makeNoise(makeRng("grad:" + seed), 600);
  const nearHw = G.layer();
  for (const h of M.highways) if (h.kind === "interstate") for (const s of h.segs) if (s.built) G.line(nearHw, s.pts, 600);
  const rEff = M.story ? M.story.rS : (p) => { const k = G.idx(p); return dist(p, c) * (0.85 + 0.3 * nz(p[0], p[1])) * (k >= 0 && nearHw[k] ? 0.75 : 1); };
  const taken = (p) => { if (!M.taken) return false; const k = G.idx(p); return k >= 0 && M.taken[k] === 1; };
  for (const t of M.tracts) t.era = null;
  const cands = M.tracts.filter((t) => t.buildable >= 0.5 && M.cityBank[G.idx(t.c)] && rEff(t.c) < 3500);
  const all = [];
  for (const t of cands) {
    const k = G.idx(t.c);
    t.era = rEff(t.c) < 2000 && !nearHw[k] ? "prewar" : "postwar"; // pre-war near, post-war further out and on the highway
    subdivide(t, rng, M, (p) => { const q = G.idx(p); return q >= 0 && M.water[q] === 1; });
    for (const h of t.plat.houses) if (M.free(h.m) && !taken(h.m)) all.push({ t, h, r: rEff(h.m) });
  }
  all.sort((a, b) => a.r - b.r);
  for (const t of cands) t.keep = new Set();
  M.phase = G.layer();
  // contiguous growth: a house is built only within ~200 m of the city or of houses already built (no islands in the
  // fields; 200 m lets a subdivision cross a creek's floodplain on its road bridge)
  const grow = G.layer();
  for (let k = 0; k < G.N; k++) if (M.coreL[k]) G.disk(grow, G.ctr(k), 200);
  let n = 0;
  for (let added = 1; added && n < TRACT_HOUSES;) { added = 0; for (const a of all) {
    if (n >= TRACT_HOUSES) break;
    if (a.t.keep.has(a.h) || a.skip) continue;
    if (!grow[G.idx(a.h.m)]) continue;
    if (rng() < 0.06) { a.skip = true; continue; } // a few lots left vacant
    a.t.keep.add(a.h); n++;
    G.disk(M.phase, a.h.m, 55); G.disk(grow, a.h.m, 200); added++;
  } }
  // leapfrog (recent era): a developer skips the farm still holding out at the edge and builds a whole subdivision
  // further out, where the land is cheaper but the highway or an old road gives access — at most two, ~250 homes each
  if (M.story) {
    const built = all.filter((a) => a.t.keep.has(a.h)), front = Math.max(0, ...built.map((a) => a.r));
    const near = (t) => { const k = G.idx(t.c); return k >= 0 && (M.story.hwNear[k] || M.story.oldNear[k]); };
    const gap = (t) => built.every((a) => dist(a.h.m, t.c) > 450);
    const jumps = cands.filter((t) => t.keep.size === 0 && near(t) && gap(t) && rEff(t.c) > front + 300 && rEff(t.c) < front + 1600).sort((a, b) => rEff(a.c) - rEff(b.c));
    let j = 0;
    for (const t of jumps) {
      if (j >= 2) break;
      t.era = "recent";
      subdivide(t, rng, M, (p) => { const q = G.idx(p); return q >= 0 && M.water[q] === 1; });
      const hs = t.plat.houses.filter((h) => M.free(h.m) && !taken(h.m)).sort((a, b) => rEff(a.m) - rEff(b.m)).slice(0, 250);
      if (hs.length < 80) { t.era = null; continue; }
      t.keep = new Set(hs); t.leapfrog = true; j++;
      for (const h of hs) G.disk(M.phase, h.m, 55);
    }
  }
  for (const t of cands) if (t.keep && t.keep.size < 20) { t.era = null; t.keep = null; } // no slivers: a tract is a neighbourhood or still a farm
}

/** keep only a few neighbourhoods as built; every other subdivided tract goes back to farmland */
function keepFewNeighbourhoods(M) {
  const houses = (t) => t.plat.houses.filter((h) => M.free(h.m)).length;
  const firstHw = M.highways.find((h) => h.kind === "interstate");
  const hwPts = firstHw ? firstHw.segs.filter((s) => s.built).flatMap((s) => s.pts) : [];
  const toHw = (t) => hwPts.reduce((m, p) => Math.min(m, dist(p, t.c)), Infinity);
  const toCore = (t) => dist(t.c, M.core.c);
  const by = (era, key) => M.tracts.filter((t) => t.era === era).sort((a, b) => key(a) - key(b));
  const keep = new Set(); let total = 0;
  const take = (t) => { const n = houses(t); if (total + n > HOUSE_BUDGET) return false; keep.add(t); total += n; return true; };
  // pre-war ring first, but leave room for the post-war and recent picks
  for (const t of by("prewar", toCore)) if (total + houses(t) <= HOUSE_BUDGET * 0.55) take(t);
  // a real subdivision, not a sliver the freeway right-of-way cut off (150 houses ~ a 40-ac tract, approximate)
  let pw = 0; for (const t of by("postwar", toHw)) { if (pw >= 2) break; if (houses(t) >= 150 && take(t)) pw++; }
  for (const t of by("recent", toCore)) if (take(t)) break;
  for (const t of M.tracts) if (t.era && !keep.has(t)) t.era = null;
  M.keptHouses = total;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2); let km = 6, crop = 0, dense = false, suburbs = "gradient"; const seeds = [];
  for (let i = 0; i < args.length; i++) { if (args[i] === "--km") km = Number(args[++i]); else if (args[i] === "--dense") dense = true; else if (args[i] === "--full-suburbs") suburbs = "full"; else if (args[i] === "--thin-suburbs") suburbs = "thin"; else if (args[i] === "--few-suburbs") suburbs = "few"; else if (args[i] === "--crop") crop = Number(args[++i]); else seeds.push(args[i]); }
  if (!seeds.length) seeds.push("3");
  const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "out"); fs.mkdirSync(outDir, { recursive: true });
  for (const seed of seeds) {
    const t0 = Date.now();
    const { city, stats } = exportRegion(seed, { km, crop, dense, suburbs });
    const file = path.join(outDir, `city-region-${seed}${crop ? `-crop${crop}` : ""}${dense ? "-dense" : ""}${suburbs !== "gradient" ? `-${suburbs}suburbs` : ""}${km !== 6 ? `-${km}km` : ""}.json`);
    fs.writeFileSync(file, JSON.stringify(city));
    const mb = fs.statSync(file).size / 1e6;
    console.log(`${path.relative(process.cwd(), file)}  ${mb.toFixed(1)} MB  ${Date.now() - t0} ms\n  ${JSON.stringify(stats)}`);
  }
}
