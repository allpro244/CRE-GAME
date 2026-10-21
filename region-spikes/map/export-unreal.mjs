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
import { generate, NAME_A, SZ, FT, makeRng, resample, rdp, dist, add, sub, mul, norm, perp, lerp } from "./region.mjs";

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
// Defaults follow the owner's final call ("the original small-town version"):
//  - LOW-RISE DOWNTOWN: a small-town centre with some parking lots (--dense restores the first export's skyline);
//  - THIN SUBURBS: the region at an earlier point in its growth — a third of the urbanised-share KNOB, car-era
//    growth from the old towns as well as downtown, little leapfrogging (--full-suburbs uses the SVG maps' growth).
const SPARSE_GEN = { urbanisedScale: 1 / 3, townSources: true, holdoutSigma: 0.1 };
export function exportRegion(seed, { km = 10, crop = 0, dense = false, fullSuburbs = false } = {}) {
  const M = generate(seed, km, fullSuburbs ? {} : SPARSE_GEN), S = M.S, G = M.G, rng = makeRng("unreal:" + seed);
  M.rotate = Math.floor(makeRng("orient:" + seed)() * 4); // same orientation as the SVG
  // canonical -> map frame (x east, y south, metres), as render() does
  const T = (p) => { const c = S / 2; let x = p[0] - c, y = p[1] - c; for (let i = 0; i < M.rotate; i++) [x, y] = [-y, x]; return [x + c, y + c]; };
  const TT = (pts) => pts.map(T);
  // map frame -> UE centimetres (+X north, +Y east, origin at the centre)
  const ue = (p) => [Math.round((S / 2 - p[1]) * 100), Math.round((p[0] - S / 2) * 100)];
  const flat = (pts) => pts.flatMap(ue);
  // a crop is centred 1 km inland of downtown's centre, so it holds the downtown edge AND the first suburbs
  const box = crop ? (() => { const c = T(add(M.core.c, mul(norm(sub([S / 2, S / 2], M.core.c)), 1000))); return [c[0] - crop / 2, c[1] - crop / 2, c[0] + crop / 2, c[1] + crop / 2]; })() : [0, 0, S, S];
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
  // farm / woods / yard from the raster, so nothing lands on the sea or covers the floodplain, and yards stay off freeway right-of-way
  const sea = (k) => M.isSea(G.ctr(k));
  for (const t of M.tracts) {
    if (t.era) { for (const r of maskRects(G, t.r, (k) => M.free(G.ctr(k)))) put("yard", r); }
    else for (const r of maskRects(G, t.r, (k) => !sea(k) && !M.flood[k] && !M.water[k])) put(t.wood ? "woods" : "farm", r); // floodplain stays marsh (it is drawn under farm)
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
  const okLocal = (p) => M.free(p);
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
    for (let i = 0; i <= nL; i++) for (const run of keepRuns([at(-r.hl + i * pl, -r.hw), at(-r.hl + i * pl, r.hw)], (p) => !isWaterC(p))) road(run, "core", wm);
    for (let j = 0; j <= nW; j++) for (const run of keepRuns([at(-r.hl, -r.hw + j * pw), at(r.hl, -r.hw + j * pw)], (p) => !isWaterC(p))) road(run, "core", wm);
  }

  for (const r of [M.core, ...M.towns]) for (const b of r.blockRects) if (!blockPts(b).some((p) => isWaterC(p) || M.isSea(p) || underHw(p))) put("block", b.poly());

  // ---------------- buildings & parcels
  const volumes = [], parcels = [], trees = [], labels = [];
  const townOf = (p) => { let best = { name: "Downtown", d: dist(p, M.core.c) - 1300 }; for (const t of M.towns) { const d = dist(p, t.c); if (d < best.d) best = { name: t.name, d }; } return best.name; };
  const sf = (m2) => Math.round(m2 / (FT * FT));
  let towers = 0;
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
            if (dn < 0.2 && towers < 2 && rng() < 0.02) { floors = 10 + Math.floor(rng() * 3); towers++; }
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
  blockLots(M.core, 25, "core");          // ~82 ft downtown lots (approximate; island.mjs owns the real plat)
  for (const t of M.towns) blockLots(t, 15, "town"); // ~50 ft village lots (approximate)

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
  // woodlot trees on a jittered grid, thinned so the file stays under the cap
  const woodCells = []; for (const t of M.tracts) if (!t.era && t.wood) woodCells.push(t);
  const woodArea = woodCells.reduce((a, t) => a + (t.r[2] - t.r[0]) * (t.r[3] - t.r[1]), 0);
  const spacing = Math.max(12, Math.sqrt(woodArea / Math.max(1, TREE_CAP - trees.length)));
  for (const t of woodCells) for (let x = t.r[0] + spacing / 2; x < t.r[2]; x += spacing) for (let y = t.r[1] + spacing / 2; y < t.r[3]; y += spacing) {
    const p = [x + (rng() - 0.5) * spacing * 0.8, y + (rng() - 0.5) * spacing * 0.8];
    if (M.isSea(p) || isWaterC(p) || settled(p) || !M.free(p) && !M.flood[G.idx(p)]) continue;
    const q = T(p); if (inBox(q)) trees.push(q);
  }
  labels.push({ name: "Downtown", kind: "town", at: ue(T(M.core.c)) });
  for (const t of M.towns) labels.push({ name: t.name, kind: "town", at: ue(T(t.c)) });

  const [bx0, by0, bx1, by1] = box;
  const bounds = (() => { const a = ue([bx0, by1]), b = ue([bx1, by0]); return { minX: a[0], maxX: b[0], minY: a[1], maxY: b[1] }; })();
  const kept = parcels.filter((p) => p.ring);
  const name = `${M.river.name.replace(/ River$/, "")} Valley`;
  return {
    stats: { volumes: volumes.length, houses, parcels: kept.length, neighbourhoods: nb, trees: trees.length, centerlines: centerlines.length, ground: Object.fromEntries(Object.entries(ground).map(([k, v]) => [k, v.length])) },
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

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2); let km = 10, crop = 0, dense = false, fullSuburbs = false; const seeds = [];
  for (let i = 0; i < args.length; i++) { if (args[i] === "--km") km = Number(args[++i]); else if (args[i] === "--dense") dense = true; else if (args[i] === "--full-suburbs") fullSuburbs = true; else if (args[i] === "--crop") crop = Number(args[++i]); else seeds.push(args[i]); }
  if (!seeds.length) seeds.push("3");
  const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "out"); fs.mkdirSync(outDir, { recursive: true });
  for (const seed of seeds) {
    const t0 = Date.now();
    const { city, stats } = exportRegion(seed, { km, crop, dense, fullSuburbs });
    const file = path.join(outDir, `city-region-${seed}${crop ? `-crop${crop}` : ""}${dense ? "-dense" : ""}${fullSuburbs ? "-fullsuburbs" : ""}${km !== 10 ? `-${km}km` : ""}.json`);
    fs.writeFileSync(file, JSON.stringify(city));
    const mb = fs.statSync(file).size / 1e6;
    console.log(`${path.relative(process.cwd(), file)}  ${mb.toFixed(1)} MB  ${Date.now() - t0} ms\n  ${JSON.stringify(stats)}`);
  }
}
