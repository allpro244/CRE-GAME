#!/usr/bin/env node
/**
 * Spike 3 of REGION_PLAN.md — does a generated metro REGION look believable?
 *
 * Throwaway-quality, no dependencies. Writes out/region-<seed>.svg.
 *   node region-spikes/map/region.mjs            # seeds 1..6
 *   node region-spikes/map/region.mjs 7 42 --km 6
 *
 * Layers, each reading the ones before it (a place with a past):
 *   1 land & water   2 old settlements   3 road skeleton + highway master plan
 *   4 suburbs by era (built on the farm tracts of layer 5's survey)   5 open land
 *
 * Everything is generated in a canonical frame (river runs top -> bottom, any
 * sea is at the bottom) and rotated by a multiple of 90 degrees at render
 * time, so the land survey stays cardinal (north up) whatever the seed.
 *
 * Every world size carries a comment saying where it comes from. "approximate"
 * means general knowledge, not a cited measurement. "KNOB" means it is not a
 * fact at all and in the real game would be an output of the growth sim.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------- units
const MILE = 1609.344;            // international mile, m
const ACRE = 4046.856;            // m2
const FT = 0.3048;                // m
const SQFT = FT * FT;             // m2

// ---------------------------------------------------------------- world sizes (sources inline)
const SZ = {
  // Layer 1 -----------------------------------------------------------------
  riverWidth: [100, 250],          // approximate: mid-size navigable US river at a regional city (Cumberland at Nashville ~150-200 m)
  meanderPerWidth: [10, 14],       // meander wavelength ~10-14x channel width (Leopold & Wolman 1960), approximate
  floodplainExtra: [150, 700],     // approximate: 100-year floodplain of a mid-size river is ~0.4-1.6 km wide in total
  creekWidth: [8, 20],             // approximate: small tributary creek
  creekFlood: [60, 150],           // approximate: FEMA Zone A along small streams, ~100-500 ft each side
  coastFloodBand: [100, 250],      // approximate: coastal AE/VE band inland of the shoreline
  // Layer 2 -----------------------------------------------------------------
  core: [2600, 1500],              // the existing island city footprint (~2.6 x 1.5 km, broadway-and-wall/src/citygen)
  corePitch: [80, 240],            // Manhattan grid: streets every ~264 ft (80 m), avenues ~800-920 ft (Commissioners' Plan 1811)
  townPitch: [92, 120],            // ordinary American block pitch, island.mjs's own measured range
  townBlocks: [[4, 7], [3, 5]],    // approximate: a 19th-c. village plat of ~15-35 blocks (a few hundred to ~1,500 people)
  townSpacing: 2 * MILE,           // approximate: 19th-c. crossroads hamlets / mill villages ~2-5 mi apart (low end)
  townArea: (3.5 * MILE) ** 2,     // approximate: one hamlet per ~3.5 mi square, the middle of that spacing
  // Layer 3 -----------------------------------------------------------------
  section: MILE,                   // US Public Land Survey section = 1 mile square = 640 acres
  arterialROW: 66 * FT,            // section-line road ROW: 66 ft (one Gunter's chain), standard in PLSS states
  interchangeSpacing: MILE,        // FHWA / AASHTO: interchanges >= ~1 mi apart in urban areas (2-3 mi rural)
  highwayROW: 300 * FT,            // approximate: urban freeway ROW ~250-400 ft
  interstateYears: [1958, 1974],   // Interstate program 1956; most urban segments opened 1960s-early 70s
  secondYears: [1975, 1995],       // approximate: later state freeways / spurs, many cut short by freeway revolts
  plannedYears: [2029, 2046],      // approximate: 10-20 years from study to ribbon-cutting (REGION_PLAN.md s.1)
  // Layer 4 (lot sizes: frontage x depth, m) --------------------------------
  prewarLot: [40 * FT, 110 * FT],  // streetcar-suburb lot ~30-50 ft x 100-125 ft (approximate)
  prewarBlockLen: 630 * FT,        // approximate: 600-660 ft blocks typical of pre-war grids
  alley: 16 * FT,                  // Chicago-style 16 ft alley (island.mjs cites the same)
  localROW: 50 * FT,               // approximate: 50-60 ft local-street ROW
  postwarLot: [65 * FT, 115 * FT], // ~7,500 sf; Levittown NY lots were 60 x 100 ft (6,000 sf), 1950s tracts 6-10k sf
  recentLot: [70 * FT, 118 * FT],  // ~8,300 sf; Census SOC median new single-family lot ~8,000-9,000 sf in the 2010s (approximate)
  culDeSacMax: 600 * FT,           // approximate: subdivision codes cap cul-de-sacs at ~500-800 ft
  bulbRadius: 45 * FT,             // approximate: 40-50 ft turnaround radius
  pondShare: 0.04,                 // approximate: stormwater detention ~3-8% of a subdivision's area
  streetShare: { prewar: 0.30, postwar: 0.25, recent: 0.30 }, // REGION_PLAN.md: 20-30% of gross land to streets/ponds/open space
  // Era shares of housing units, US, by year built (ACS 'Year Structure Built', approximate):
  unitShare: { prewar: 0.12, postwar: 0.37, recent: 0.51 }, // pre-1940 / 1940-79 / 1980-2020
  // Travel speeds for the accessibility fields (approximate):
  walk: 5,                         // km/h, walking
  streetcar: 15,                   // km/h, ~8-10 mph average streetcar incl. stops
  arterial: 50,                    // km/h, ~30 mph urban arterial
  local: 20,                       // km/h, local streets
  freeway: 88,                     // km/h, 55 mph national limit 1974-95
};
// KNOB, not a fact: how much of the developable window is urbanised by 2026.
// In the game this is the OUTPUT of the growth sim; here it varies per seed.
const URBANISED_SHARE = [0.35, 0.6];

const CELL = 20; // raster resolution for masks and path-finding (a tool choice, not a world size)

// ---------------------------------------------------------------- rng & noise
function hashStr(s) { let h = 2166136261 >>> 0; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function makeRng(seed) {
  const r = mulberry32(hashStr(seed));
  const f = () => r();
  f.range = (a, b) => a + (b - a) * r();
  f.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  f.pick = (arr) => arr[Math.floor(r() * arr.length)];
  f.gauss = () => { let u = 0, v = 0; while (u === 0) u = r(); v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  return f;
}
function makeNoise(rng, scale) {
  const P = 256, g = new Float64Array(P * P);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  const at = (i, j) => g[(((i % P) + P) % P) * P + (((j % P) + P) % P)];
  const s = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    x /= scale; y /= scale;
    const i = Math.floor(x), j = Math.floor(y), fx = s(x - i), fy = s(y - j);
    const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

// ---------------------------------------------------------------- geometry
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const len = (a) => Math.hypot(a[0], a[1]);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const perp = (a) => [-a[1], a[0]];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function cumLen(pts) { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + dist(pts[i - 1], pts[i])); return c; }
function resample(pts, step) {
  const c = cumLen(pts), L = c[c.length - 1], out = [];
  let j = 0;
  for (let s = 0; s <= L; s += step) {
    while (j < pts.length - 2 && c[j + 1] < s) j++;
    const t = (s - c[j]) / ((c[j + 1] - c[j]) || 1);
    out.push(lerp(pts[j], pts[j + 1], Math.min(1, t)));
  }
  if (dist(out[out.length - 1], pts[pts.length - 1]) > step * 0.3) out.push(pts[pts.length - 1]);
  return out;
}
function chaikin(pts, it) {
  for (let k = 0; k < it; k++) {
    const o = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) { o.push(lerp(pts[i], pts[i + 1], 0.25), lerp(pts[i], pts[i + 1], 0.75)); }
    o.push(pts[pts.length - 1]); pts = o;
  }
  return pts;
}
function smoothMA(pts, step, window, passes) {
  let p = resample(pts, step); const k = Math.max(1, Math.round(window / step / 2));
  for (let n = 0; n < passes; n++) {
    const q = p.map((v, i) => {
      if (i === 0 || i === p.length - 1) return v;
      const a = Math.max(0, i - k), b = Math.min(p.length - 1, i + k); let sx = 0, sy = 0;
      for (let j = a; j <= b; j++) { sx += p[j][0]; sy += p[j][1]; }
      return [sx / (b - a + 1), sy / (b - a + 1)];
    });
    p = q;
  }
  return p;
}
function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]]; const d = norm(sub(b, a)); let mi = 0, md = 0;
  for (let i = 1; i < pts.length - 1; i++) { const v = sub(pts[i], a); const e = Math.abs(v[0] * d[1] - v[1] * d[0]); if (e > md) { md = e; mi = i; } }
  if (md < eps) return [a, b];
  return rdp(pts.slice(0, mi + 1), eps).slice(0, -1).concat(rdp(pts.slice(mi), eps));
}
function normals(pts) {
  return pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; return perp(norm(sub(b, a))); });
}
function segX(p1, p2, p3, p4) {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}
function crossings(A, B) { // where polyline B crosses A, as distance along A
  const cA = cumLen(A), out = [];
  for (let i = 0; i < A.length - 1; i++) {
    const bx0 = Math.min(A[i][0], A[i + 1][0]), bx1 = Math.max(A[i][0], A[i + 1][0]);
    const by0 = Math.min(A[i][1], A[i + 1][1]), by1 = Math.max(A[i][1], A[i + 1][1]);
    for (let j = 0; j < B.length - 1; j++) {
      if (Math.max(B[j][0], B[j + 1][0]) < bx0 || Math.min(B[j][0], B[j + 1][0]) > bx1) continue;
      if (Math.max(B[j][1], B[j + 1][1]) < by0 || Math.min(B[j][1], B[j + 1][1]) > by1) continue;
      const t = segX(A[i], A[i + 1], B[j], B[j + 1]);
      if (t !== null) out.push({ s: cA[i] + t * (cA[i + 1] - cA[i]), p: lerp(A[i], A[i + 1], t) });
    }
  }
  return out;
}
function pointAt(pts, s) { const c = cumLen(pts); let i = 0; while (i < c.length - 2 && c[i + 1] < s) i++; return lerp(pts[i], pts[i + 1], Math.min(1, (s - c[i]) / ((c[i + 1] - c[i]) || 1))); }
function slicePl(pts, s0, s1) { const c = cumLen(pts); const o = [pointAt(pts, s0)]; for (let i = 0; i < pts.length; i++) if (c[i] > s0 && c[i] < s1) o.push(pts[i]); o.push(pointAt(pts, s1)); return o; }
function oRect(c, u, hl, hw) { u = norm(u); const v = perp(u); return { c, u, v, hl, hw, has: (p) => { const d = sub(p, c); return Math.abs(d[0] * u[0] + d[1] * u[1]) <= hl && Math.abs(d[0] * v[0] + d[1] * v[1]) <= hw; }, poly: () => [add(add(c, mul(u, -hl)), mul(v, -hw)), add(add(c, mul(u, hl)), mul(v, -hw)), add(add(c, mul(u, hl)), mul(v, hw)), add(add(c, mul(u, -hl)), mul(v, hw))] }; }

// ---------------------------------------------------------------- raster
class Grid {
  constructor(S) { this.S = S; this.W = Math.ceil(S / CELL); this.N = this.W * this.W; }
  layer(T = Uint8Array) { return new T(this.N); }
  idx(p) { const i = Math.floor(p[0] / CELL), j = Math.floor(p[1] / CELL); return i < 0 || j < 0 || i >= this.W || j >= this.W ? -1 : j * this.W + i; }
  ctr(k) { return [((k % this.W) + 0.5) * CELL, (Math.floor(k / this.W) + 0.5) * CELL]; }
  disk(L, p, r, v = 1) {
    const W = this.W, i0 = Math.max(0, Math.floor((p[0] - r) / CELL)), i1 = Math.min(W - 1, Math.floor((p[0] + r) / CELL));
    const j0 = Math.max(0, Math.floor((p[1] - r) / CELL)), j1 = Math.min(W - 1, Math.floor((p[1] + r) / CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const x = (i + 0.5) * CELL - p[0], y = (j + 0.5) * CELL - p[1]; if (x * x + y * y <= r * r) L[j * W + i] = v; }
  }
  line(L, pts, r = 0, v = 1) { for (const q of resample(pts, CELL / 2)) { if (r) this.disk(L, q, r, v); else { const k = this.idx(q); if (k >= 0) L[k] = v; } } }
  fill(L, test, v = 1) { for (let k = 0; k < this.N; k++) if (test(this.ctr(k))) L[k] = v; }
}
class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) { const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val); while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= k[i]) break; [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]]; i = p; } }
  pop() {
    const k = this.k, v = this.v, top = v[0], last = k.length - 1;
    k[0] = k[last]; v[0] = v[last]; k.pop(); v.pop();
    let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < k.length && k[l] < k[m]) m = l; if (r < k.length && k[r] < k[m]) m = r; if (m === i) break; [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]]; i = m; }
    return top;
  }
}
const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
function astar(G, cost, a, b, hmin) {
  const W = G.W, s = G.idx(a), t = G.idx(b); if (s < 0 || t < 0) return null;
  const g = new Float64Array(G.N).fill(Infinity), from = new Int32Array(G.N).fill(-1), h = new Heap();
  const tx = t % W, ty = Math.floor(t / W);
  g[s] = 0; h.push(0, s);
  while (h.size) {
    const k = h.pop(); if (k === t) break;
    const x = k % W, y = Math.floor(k / W);
    for (const [dx, dy, d] of NB) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= W) continue;
      const n = ny * W + nx, ng = g[k] + d * CELL * (cost[k] + cost[n]) / 2;
      if (ng < g[n]) { g[n] = ng; from[n] = k; h.push(ng + hmin * CELL * Math.hypot(nx - tx, ny - ty), n); }
    }
  }
  if (from[t] < 0 && s !== t) return null;
  const out = []; for (let k = t; k >= 0; k = from[k]) { out.push(G.ctr(k)); if (k === s) break; }
  out.reverse(); out[0] = a; out[out.length - 1] = b; return out;
}
/** Travel time (minutes) from source cells; speed in km/h per cell (0 = impassable); jumps = freeway links. */
function travel(G, speed, sources, jumps) {
  const T = new Float64Array(G.N).fill(Infinity), h = new Heap(), W = G.W;
  for (const s of sources) { T[s] = 0; h.push(0, s); }
  const toMin = (m, kmh) => (m / 1000) / kmh * 60;
  while (h.size) {
    const k = h.pop(); const t = T[k];
    const x = k % W, y = Math.floor(k / W);
    for (const [dx, dy, d] of NB) {
      const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= W) continue;
      const n = ny * W + nx; if (!speed[n] || !speed[k]) continue;
      const nt = t + toMin(d * CELL, (speed[k] + speed[n]) / 2);
      if (nt < T[n]) { T[n] = nt; h.push(nt, n); }
    }
    for (const [to, m] of jumps.get(k) || []) { const nt = t + toMin(m, SZ.freeway); if (nt < T[to]) { T[to] = nt; h.push(nt, to); } }
  }
  return T;
}

// ---------------------------------------------------------------- names
export const NAME_A = ["Mill", "Ash", "Oak", "Cedar", "Fair", "Green", "Elm", "Brook", "Clay", "Stone", "Wal", "Hazel", "Red", "Kings", "Marsh", "Pine", "Har", "Lin", "Bel", "Hamp"];
const NAME_B = ["ford", "ton", "ville", "field", "burg", "wood", " Crossing", " Mills", "dale", "port", "ridge", " Ferry", "mont", "boro"];
const RIVERS = ["Kessaw", "Ottaquin", "Saline", "Big Muddy", "Tenmile", "Wabeno", "Paquette", "Cold Spring"];

// ================================================================ the generator
/**
 * opts (all default off, so the SVG renders are unchanged):
 *   urbanisedScale  multiply the urbanised-share KNOB (0.33 = an earlier point in the region's growth)
 *   townSources     car-era growth also radiates from the old towns, not only downtown
 *   core            [long, deep] downtown footprint in m (default: the island city, SZ.core)
 *   townBlocks      [[nx range], [ny range]] village plat size (default SZ.townBlocks)
 *   gradientCore    { radius, inset }: a city grid graded from a centre near the waterfront, one bank only,
 *                   ragged edge, creeks routed round it (export-unreal.mjs grades the buildings)
 *   onlyRiverTown   keep just the river-crossing village
 *   bankTowns       the river-crossing village stands on one bank instead of straddling the river
 *   holdoutSigma    spread of the leapfrog factor (default 0.25; smaller = growth hugs roads and towns)
 */
export function generate(seed, km = 10, opts = {}) {
  const S = km * 1000, rng = makeRng("region:" + seed), G = new Grid(S);
  const nz = makeNoise(rng, 900), nzFine = makeNoise(rng, 250);
  const M = { seed, S, G };

  // ---------------- Layer 1: land and water -----------------------------
  const coast = rng() < 0.5;
  const coastBase = S * rng.range(0.80, 0.88);
  const coastAmp = rng.range(150, 450), coastNz = makeNoise(rng, 1400);
  const coastY = (x) => coastBase + coastAmp * (coastNz(x, 7) - 0.5) * 2;
  const isSea = (p) => coast && p[1] > coastY(p[0]);

  const rw = rng.range(...SZ.riverWidth);
  const lam = rw * rng.range(...SZ.meanderPerWidth);
  const p0 = [S * rng.range(0.25, 0.75), -200], p1 = [S * rng.range(0.25, 0.75), S + 200];
  const ax = norm(sub(p1, p0)), nrm = perp(ax), L = dist(p0, p1);
  const A1 = rng.range(250, 800), lam1 = S * rng.range(0.9, 1.6), ph1 = rng.range(0, 6.28); // valley-scale bend, approximate
  const A2 = lam / 4, ph2 = rng.range(0, 6.28);                                              // meander amplitude ~ wavelength/4, approximate
  let river = [];
  for (let s = 0; s <= L; s += 40) {
    const off = A1 * Math.sin(2 * Math.PI * s / lam1 + ph1) + A2 * (0.4 + nz(s, 50)) * Math.sin(2 * Math.PI * s / lam + ph2);
    const p = add(add(p0, mul(ax, s)), mul(nrm, off));
    river.push(p);
    if (coast && p[1] > coastY(p[0]) + 60) break;
  }
  river = chaikin(river, 2);
  const rHalf = river.map((p) => rw / 2 * (0.85 + 0.3 * nzFine(p[0], p[1])));
  const fpHalf = river.map((p, i) => rHalf[i] + SZ.floodplainExtra[0] + (SZ.floodplainExtra[1] - SZ.floodplainExtra[0]) * nz(p[0] + 999, p[1]));
  M.river = { pts: river, half: rHalf, fp: fpHalf, name: rng.pick(RIVERS) + " River" };

  M.coast = coast ? { line: Array.from({ length: Math.ceil((S + 400) / 40) + 1 }, (_, i) => [-200 + i * 40, coastY(-200 + i * 40)]), band: rng.range(...SZ.coastFloodBand) } : null;

  const creeks = [];
  for (let c = 0, n = rng.int(1, 3); c < n; c++) {
    const side = rng() < 0.5 ? -1 : 1;
    const ry = rng.range(0.15, 0.7) * S;
    const start = [side < 0 ? -50 : S + 50, ry];
    let best = null; // join the river downstream of the start
    river.forEach((p, i) => { if (p[1] > ry + 300 && !isSea(p) && (!best || dist(p, start) < dist(best, start))) best = p; });
    if (!best) continue;
    const d = dist(start, best), dir = norm(sub(best, start)), nn = perp(dir), wl = rng.range(500, 1000), amp = rng.range(60, 200), ph = rng.range(0, 6.28);
    const pts = []; for (let s = 0; s <= d; s += 30) pts.push(add(add(start, mul(dir, s)), mul(nn, amp * Math.sin(Math.PI * s / d) * Math.sin(2 * Math.PI * s / wl + ph))));
    creeks.push({ pts: chaikin(pts, 2), w: rng.range(...SZ.creekWidth), fp: rng.range(...SZ.creekFlood) });
  }
  M.creeks = creeks;

  const water = G.layer(), flood = G.layer();
  const fillWater = () => {
    water.fill(0); flood.fill(0);
    river.forEach((p, i) => { G.disk(flood, p, fpHalf[i]); G.disk(water, p, rHalf[i]); });
    for (const c of creeks) { G.line(flood, c.pts, c.fp); G.line(water, c.pts, c.w / 2 + 1); }
    if (coast) for (let k = 0; k < G.N; k++) { const p = G.ctr(k); if (isSea(p)) water[k] = 1; else if (p[1] > coastY(p[0]) - M.coast.band) flood[k] = 1; }
  };
  fillWater();
  const isWater = (p) => { const k = G.idx(p); return k >= 0 ? water[k] === 1 : isSea(p); };
  const isFlood = (p) => { const k = G.idx(p); return k >= 0 && flood[k] === 1; };
  M.water = water; M.flood = flood;

  // ---------------- Layer 2: old settlements ------------------------------
  const [CL, CW] = opts.core ?? SZ.core;
  let core;
  const siteScore = (r) => {
    let wet = 0, out = 0; for (const q of r.poly().concat([r.c])) if (q[0] < 0 || q[1] < 0 || q[0] > S || q[1] > S) out++;
    for (let a = -0.9; a <= 0.9; a += 0.3) for (let b = -0.9; b <= 0.9; b += 0.3) { const q = add(add(r.c, mul(r.u, a * r.hl)), mul(r.v, b * r.hw)); if (isWater(q) && !isSea(q)) wet++; }
    return wet * 3 + out * 20 + rng();
  };
  if (coast) {
    // a port downtown fronts the sea beside the river mouth, on whichever bank is dry
    const mouth = river[river.length - 1];
    let best = null;
    for (const sd of [1, -1]) for (let k = 0; k < 10; k++) {
      const x = mouth[0] + sd * (CL / 2 + rw / 2 + 40 + k * 120);
      const r = oRect([x, coastY(x) - CW / 2 + 120], [1, 0], CL / 2, CW / 2);
      const sc = siteScore(r) + k * 0.5; // prefer hugging the mouth
      if (!best || sc < best.sc) best = { r, sc };
    }
    core = best.r;
  } else {
    // a downtown sits on ONE bank where the river runs straight enough (a landing): try sites, keep the driest that fits the window
    let best = null;
    for (let tr = 0; tr < 40; tr++) {
      const i = Math.floor(river.length * rng.range(0.3, 0.7));
      const tan = norm(sub(river[i + 4], river[i - 4]));
      for (const sd of [1, -1]) {
        const r = oRect(add(river[i], mul(perp(tan), sd * (rHalf[i] + CW / 2 + 40))), tan, CL / 2, CW / 2);
        const sc = siteScore(r);
        if (!best || sc < best.sc) best = { r, sc };
      }
    }
    core = best.r;
  }
  if (opts.gradientCore) {
    // the city's centre sits near the waterfront (the landing), inset from the rect's wet side
    const { radius: R, inset } = opts.gradientCore;
    const wetSide = (sd) => { let w = 0; for (let a = -0.9; a <= 0.9; a += 0.15) if (isWater(add(add(core.c, mul(core.v, sd * core.hw * 1.05)), mul(core.u, a * core.hl)))) w++; return w; };
    const sd = wetSide(1) >= wetSide(-1) ? 1 : -1;
    // grid: the site is chosen at the small-city size above, then the street grid is laid out larger, growing inland from
    // that waterfront (so a bigger grid does not drag the town away from its landing)
    if (opts.gradientCore.grid) {
      const [GL, GD] = opts.gradientCore.grid, edge = add(core.c, mul(core.v, sd * core.hw));
      core = oRect(sub(edge, mul(core.v, sd * GD / 2)), core.u, GL / 2, GD / 2);
    }
    core.centre = add(core.c, mul(core.v, sd * (core.hw - inset)));
    // creeks bend around the city (in life they are culverted or the city grew around their valleys)
    const rOut = R + 150, riverL = G.layer();
    river.forEach((p, i) => G.disk(riverL, p, rHalf[i] + 10));
    for (const c of creeks) {
      const inside = c.pts.map((p) => dist(p, core.centre) < rOut);
      if (!inside.some(Boolean)) continue;
      let pts = c.pts.map((p, i) => inside[i] ? add(core.centre, mul(norm(sub(p, core.centre)), rOut)) : p);
      if (inside.at(-1)) { // the confluence was inside the city: follow its edge round to the river
        const l = pts.at(-1), a0 = Math.atan2(l[1] - core.centre[1], l[0] - core.centre[0]);
        let bestArc = null;
        for (const dir of [1, -1]) {
          const arc = [];
          for (let t = 0.02; t < 3.2; t += 0.02) { const q = add(core.centre, [rOut * Math.cos(a0 + dir * t), rOut * Math.sin(a0 + dir * t)]); arc.push(q); const k = G.idx(q); if (k >= 0 && riverL[k]) { if (!bestArc || arc.length < bestArc.length) bestArc = arc; break; } }
        }
        if (bestArc) pts = pts.concat(bestArc);
      }
      c.pts = chaikin(pts, 2);
    }
    fillWater();
  }
  core.blocks = gridBlocks(core, SZ.corePitch[1], SZ.corePitch[0], 18, isWater); // 60 ft street ROW ~18 m, approximate
  if (opts.gradientCore) {
    // one bank and a ragged edge: keep blocks reachable from the centre over dry land, within a noisy radius
    const { radius: R } = opts.gradientCore;
    const reach = G.layer(), q = [];
    let k0 = G.idx(core.centre);
    if (k0 < 0 || water[k0]) { let bd = Infinity; for (let k = 0; k < G.N; k++) if (!water[k]) { const d = dist(G.ctr(k), core.centre); if (d < bd) { bd = d; k0 = k; } } }
    reach[k0] = 1; q.push(k0);
    while (q.length) { const k = q.pop(), x = k % G.W, y = Math.floor(k / G.W); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= G.W || ny >= G.W) continue; const n = ny * G.W + nx; if (!reach[n] && !water[n] && dist(G.ctr(n), core.centre) < S) { reach[n] = 1; q.push(n); } } }
    const nzC = makeNoise(rng, 500);
    core.nr = (p) => dist(p, core.centre) * (0.85 + 0.3 * nzC(p[0], p[1]));
    core.blockRects = core.blockRects.filter((b) => G.idx(b.c) >= 0 && reach[G.idx(b.c)] && core.nr(b.c) <= R);
    core.blocks = core.blockRects.map((b) => b.poly());
    M.cityBank = reach;
  }
  M.core = core;

  const towns = [];
  const okTown = (p) => p[0] > 500 && p[0] < S - 500 && p[1] > 500 && p[1] < S - 500 && !isSea(p) && dist(p, core.c) > SZ.townSpacing && !core.has(p) && towns.every((t) => dist(t.c, p) > SZ.townSpacing);
  // a river-crossing town (ferry or mill village), then crossroads towns inland
  for (let tries = 0; tries < 200; tries++) {
    const i = rng.int(5, river.length - 6), p = river[i];
    if (!okTown(p)) continue;
    towns.push(makeTown(p, norm(sub(river[i + 1], river[i - 1])), "river", rHalf[i]));
    break;
  }
  const nTowns = opts.onlyRiverTown ? Math.min(1, towns.length) : Math.max(2, Math.round(S * S / SZ.townArea) + rng.int(0, 1));
  for (let tries = 0; tries < 400 && towns.length < nTowns; tries++) {
    const p = [rng.range(0, S), rng.range(0, S)];
    if (!okTown(p) || isWater(p) || isFlood(p)) continue;
    towns.push(makeTown(p, rng() < 0.5 ? [1, 0] : [Math.cos(rng.range(-0.35, 0.35)), Math.sin(rng.range(-0.35, 0.35))], "crossroads")); // platted on the survey, or pre-survey askew (approximate)
  }
  function makeTown(c, u, kind, riverHalf = 0) {
    const nx = rng.int(...(opts.townBlocks ?? SZ.townBlocks)[0]), ny = rng.int(...(opts.townBlocks ?? SZ.townBlocks)[1]), pitch = rng.range(...SZ.townPitch);
    // bankTowns: a ferry/mill village sits on ONE bank, its landing at the water (otherwise it straddles the river)
    if (opts.bankTowns && kind === "river") { const v = perp(norm(u)), side = isWater(add(c, mul(v, riverHalf + ny * pitch / 2 + 20))) ? -1 : 1; c = add(c, mul(v, side * (riverHalf + ny * pitch / 2 + 20))); }
    const r = oRect(c, u, nx * pitch / 2, ny * pitch / 2);
    r.blocks = gridBlocks(r, pitch, pitch, 18, isWater); // 60 ft street ROW ~18 m, approximate
    r.kind = kind; r.name = rng.pick(NAME_A) + rng.pick(NAME_B);
    return r;
  }
  M.towns = towns;
  const coreL = G.layer(), townL = G.layer();
  if (opts.gradientCore) { // the settled area is the kept blocks plus their half-streets, not the whole rectangle
    for (const b of core.blockRects) {
      const e = oRect(b.c, b.u, b.hl + 12, b.hw + 12), P = e.poly();
      const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
      for (let y = Math.max(0, Math.floor(Math.min(...ys) / CELL)); y <= Math.min(G.W - 1, Math.floor(Math.max(...ys) / CELL)); y++)
        for (let x = Math.max(0, Math.floor(Math.min(...xs) / CELL)); x <= Math.min(G.W - 1, Math.floor(Math.max(...xs) / CELL)); x++) { const k = y * G.W + x; if (!water[k] && e.has(G.ctr(k))) coreL[k] = 1; }
    }
  } else G.fill(coreL, (p) => core.has(p) && !isWater(p));
  for (const t of towns) G.fill(townL, (p) => t.has(p) && !isWater(p));

  // ---------------- Layer 3: road skeleton --------------------------------
  // 3a old country roads, found on a cost surface (terrain stand-in: noise; rivers costly except where a town or the core bridges them)
  const roadL = G.layer();
  const cost = new Float64Array(G.N);
  const baseCost = (k) => { const p = G.ctr(k); let c = 1 + 0.8 * nz(p[0] * 1.7, p[1] * 1.7); if (flood[k]) c *= 2.5; if (water[k]) c *= (townL[k] || coreL[k]) ? 3 : 60; if (coreL[k] || townL[k]) c *= 0.6; return c; };
  for (let k = 0; k < G.N; k++) cost[k] = baseCost(k);
  const oldRoads = [];
  const road = (a, b) => {
    const p = astar(G, cost, a, b, 0.35); if (!p) return;
    const pl = chaikin(rdp(p, 18), 3);
    oldRoads.push(pl);
    for (const q of resample(pl, CELL / 2)) { const k = G.idx(q); if (k >= 0) { roadL[k] = 1; cost[k] = Math.min(cost[k], 0.35); } }
  };
  const edgePoint = (from, ang) => { const d = [Math.cos(ang), Math.sin(ang)]; let t = 0; let p = from; while (p[0] > 0 && p[0] < S && p[1] > 0 && p[1] < S) { t += 20; p = add(from, mul(d, t)); } return [Math.min(S - 1, Math.max(1, p[0])), Math.min(S - 1, Math.max(1, p[1]))]; };
  const nRad = rng.int(4, 5), a0 = rng.range(0, 6.28);
  for (let i = 0; i < nRad; i++) { const e = edgePoint(core.c, a0 + i * 2 * Math.PI / nRad + rng.range(-0.3, 0.3)); if (!isWater(e)) road(core.c, e); }
  for (const t of towns) {
    road(t.c, core.c);
    const away = Math.atan2(t.c[1] - core.c[1], t.c[0] - core.c[0]) + rng.range(-0.6, 0.6);
    const e = edgePoint(t.c, away); if (!isWater(e)) road(t.c, e);
  }
  for (let i = 0; i < towns.length; i++) { const j = (i + 1) % towns.length; if (towns.length > 2 || i === 0) road(towns[i].c, towns[j].c); }
  M.oldRoads = oldRoads;

  // 3b survey grid: section lines every mile (PLSS), roads on them unless they hit water or a settlement
  const ox = rng.range(0, MILE), oy = rng.range(0, MILE);
  M.survey = { ox, oy };
  const secRoads = [];
  const xs = [], ys = []; for (let x = ox - MILE; x < S + MILE; x += MILE) xs.push(x); for (let y = oy - MILE; y < S + MILE; y += MILE) ys.push(y);
  const trySec = (a, b) => {
    a = [Math.max(0, Math.min(S, a[0])), Math.max(0, Math.min(S, a[1]))]; b = [Math.max(0, Math.min(S, b[0])), Math.max(0, Math.min(S, b[1]))];
    if (dist(a, b) < 100) return;
    const smp = resample([a, b], 40); let run = [];
    const flush = () => { if (run.length > 4) secRoads.push([run[0], run[run.length - 1]]); run = []; };
    for (const p of smp) { const k = G.idx(p); if (k < 0 || water[k] || coreL[k] || townL[k]) flush(); else run.push(p); }
    flush();
  };
  for (const x of xs) for (let j = 0; j < ys.length - 1; j++) trySec([x, ys[j]], [x, ys[j + 1]]);
  for (const y of ys) for (let i = 0; i < xs.length - 1; i++) trySec([xs[i], y], [xs[i + 1], y]);
  M.secRoads = secRoads;
  const artL = G.layer(); for (const r of oldRoads.concat(secRoads)) G.line(artL, r);

  // 3c highway master plan
  const hcost = new Float64Array(G.N);
  for (let k = 0; k < G.N; k++) { const p = G.ctr(k); let c = 1 + 0.4 * nz(p[0], p[1] + 500); if (flood[k]) c *= 1.5; if (water[k]) c *= isSea(p) ? 1e4 : 15; if (coreL[k]) c *= 3; if (townL[k]) c *= 5; if (roadL[k]) c *= 0.8; hcost[k] = c; }
  const hwPath = (pts) => { let out = []; for (let i = 0; i < pts.length - 1; i++) { const p = astar(G, hcost, pts[i], pts[i + 1], 0.8); if (!p) return null; out = out.concat(i ? p.slice(1) : p); } return smoothMA(out, 20, 900, 4); };
  const highways = [];
  // H1: the interstate, skirting downtown on the landward side
  const coreN = (() => { let n = core.v; const t = add(core.c, mul(n, CW / 2 + 250)); return isWater(t) || t[1] > S || t[1] < 0 ? mul(n, -1) : n; })();
  const wp = add(core.c, mul(coreN, CW / 2 + 200));
  const h1a = rng.range(0, 6.28);
  const e1 = edgePoint(wp, h1a), e2 = edgePoint(wp, h1a + Math.PI + rng.range(-0.4, 0.4));
  const fixE = (e) => { const a = Math.atan2(e[1] - wp[1], e[0] - wp[0]); for (let k = 0; k < 12 && isWater(e); k++) e = edgePoint(wp, a + (k % 2 ? 1 : -1) * 0.25 * Math.ceil((k + 1) / 2)); return e; };
  const H1 = hwPath([fixE(e1), wp, fixE(e2)]);
  if (H1) highways.push({ id: "H1", pts: H1, kind: "interstate", built: "all", years: SZ.interstateYears });
  // later freeways do not run alongside an existing one: make its flanks dear (but not its junction with downtown)
  if (H1) { const near = G.layer(); G.line(near, H1, 350); for (let k = 0; k < G.N; k++) if (near[k] && dist(G.ctr(k), wp) > 500) hcost[k] *= 6; }
  // H2: a later radial spur from H1 near downtown, often stopped short
  const angs = H1 ? [Math.atan2(H1[0][1] - wp[1], H1[0][0] - wp[0]), Math.atan2(H1[H1.length - 1][1] - wp[1], H1[H1.length - 1][0] - wp[0])] : [];
  let a2 = null; for (let tr = 0; tr < 40; tr++) { const a = rng.range(0, 6.28); const e = edgePoint(wp, a); if (!isWater(e) && angs.every((b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) > 1.1)) { a2 = a; break; } }
  if (a2 !== null) { const H2 = hwPath([wp, edgePoint(wp, a2)]); if (H2) highways.push({ id: "H2", pts: H2, kind: "spur", built: rng() < 0.4 ? "all" : rng.range(0.3, 0.7), years: SZ.secondYears }); }
  // H3: proposed outer bypass, an arc around downtown
  const R = rng.range(0.42, 0.55) * S, ac = Math.atan2(S / 2 - core.c[1], S / 2 - core.c[0]) + rng.range(-0.5, 0.5), span = rng.range(2.2, 3.6);
  let arc = [], run = []; for (let a = ac - span / 2; a <= ac + span / 2 + 1e-6; a += 0.2) { const p = add(core.c, [R * Math.cos(a), R * Math.sin(a)]); if (p[0] > 30 && p[0] < S - 30 && p[1] > 30 && p[1] < S - 30 && !isWater(p) && !townL[G.idx(p)] && !(coast && p[1] > coastY(p[0]) - 700)) { run.push(p); if (run.length > arc.length) arc = run; } else run = []; }
  if (arc.length >= 5) { const H3 = hwPath(arc); if (H3) highways.push({ id: "H3", pts: H3, kind: "bypass", built: "none", years: SZ.plannedYears }); }

  // interchanges: arterial & highway crossings, at least a mile apart along each highway
  for (const h of highways) {
    let xs2 = [];
    for (const o of highways) if (o !== h) for (const c of crossings(h.pts, o.pts)) xs2.push({ ...c, sys: true });
    if (h.id === "H2") xs2.push({ s: 0, p: h.pts[0], sys: true });
    for (const r of oldRoads) for (const c of crossings(h.pts, r)) xs2.push({ ...c, sys: false, old: true });
    for (const r of secRoads) for (const c of crossings(h.pts, r)) xs2.push({ ...c, sys: false });
    xs2.sort((a, b) => (b.sys - a.sys) || ((b.old ? 1 : 0) - (a.old ? 1 : 0)) || (a.s - b.s));
    const kept = [];
    for (const c of xs2) if (c.sys ? kept.every((k) => Math.abs(k.s - c.s) > 50) : kept.every((k) => Math.abs(k.s - c.s) >= SZ.interchangeSpacing)) kept.push(c);
    h.ix = kept.sort((a, b) => a.s - b.s);
    // segments between interchanges, each BUILT (year) or PROPOSED (planned year)
    const Lh = cumLen(h.pts).at(-1); const cuts = [0, ...h.ix.map((c) => c.s).filter((s) => s > 30 && s < Lh - 30), Lh];
    const nSeg = cuts.length - 1; const builtUpTo = h.built === "all" ? nSeg : h.built === "none" ? 0 : Math.max(1, Math.round(nSeg * h.built));
    let yB = h.years[0], yP = SZ.plannedYears[0] + rng.int(0, 4);
    // build outward from the end nearest downtown
    const fromStart = dist(h.pts[0], core.c) <= dist(h.pts.at(-1), core.c);
    h.segs = [];
    for (let q = 0; q < nSeg; q++) {
      const i = fromStart ? q : nSeg - 1 - q;
      const built = q < builtUpTo;
      const year = built ? (yB = Math.min(h.years[1], Math.round(yB + rng.range(0, (h.years[1] - h.years[0]) / Math.max(1, nSeg) * 1.6)))) : (yP = Math.min(SZ.plannedYears[1], yP + rng.int(1, 5)));
      h.segs[i] = { pts: slicePl(h.pts, cuts[i], cuts[i + 1]), built, year, s0: cuts[i], s1: cuts[i + 1] };
    }
  }
  M.highways = highways;
  const hwL = G.layer(); for (const h of highways) G.line(hwL, h.pts, SZ.highwayROW / 2);

  // ---------------- Layer 5 substrate: the survey's farm tracts ----------
  // Aliquot parts of each section: quarter (160 ac), half-quarter (80), quarter-quarter (40); whole sections (640) far out.
  // Split odds are approximate: Midwest plat books show mostly 40-160 ac holdings, larger farms consolidated.
  const tracts = [];
  const clip = (x0, y0, x1, y1) => { const a = [Math.max(0, x0), Math.max(0, y0), Math.min(S, x1), Math.min(S, y1)]; return a[2] - a[0] > 40 && a[3] - a[1] > 40 ? a : null; };
  const push = (x0, y0, x1, y1) => { const r = clip(x0, y0, x1, y1); if (r && (r[2] - r[0]) * (r[3] - r[1]) > 5 * ACRE) tracts.push({ r, acres: (x1 - x0) * (y1 - y0) / ACRE }); };
  for (const x of xs) for (const y of ys) {
    const c = [x + MILE / 2, y + MILE / 2];
    if (dist(c, core.c) > 3500 && rng() < 0.12) { push(x, y, x + MILE, y + MILE); continue; }
    const h = MILE / 2, q = MILE / 4;
    for (const [qx, qy] of [[x, y], [x + h, y], [x, y + h], [x + h, y + h]]) {
      const r = rng();
      if (r < 0.3) push(qx, qy, qx + h, qy + h);
      else if (r < 0.6) { if (rng() < 0.5) { push(qx, qy, qx + h, qy + q); push(qx, qy + q, qx + h, qy + h); } else { push(qx, qy, qx + q, qy + h); push(qx + q, qy, qx + h, qy + h); } }
      else if (r < 0.82) { push(qx, qy, qx + q, qy + q); push(qx + q, qy, qx + h, qy + q); push(qx, qy + q, qx + q, qy + h); push(qx + q, qy + q, qx + h, qy + h); }
      else { push(qx, qy, qx + h, qy + q); push(qx, qy + q, qx + q, qy + h); push(qx + q, qy + q, qx + h, qy + h); }
    }
  }
  for (const t of tracts) {
    let ok = 0, n = 0; const [x0, y0, x1, y1] = t.r;
    for (let i = 0.5; i < 6; i++) for (let j = 0.5; j < 6; j++) { const k = G.idx([x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * j / 6]); n++; if (k >= 0 && !water[k] && !flood[k] && !coreL[k] && !townL[k]) ok++; }
    t.buildable = ok / n; t.c = [(x0 + x1) / 2, (y0 + y1) / 2];
    t.landShare = (() => { let l = 0; for (let i = 0.5; i < 6; i++) for (let j = 0.5; j < 6; j++) { const k = G.idx([x0 + (x1 - x0) * i / 6, y0 + (y1 - y0) * j / 6]); if (k >= 0 && !water[k]) l++; } return l / 36; })();
    t.crop = rng.int(0, 4); t.wood = rng() < 0.08; // approximate: farm woodlots
    t.holdout = Math.exp((opts.holdoutSigma ?? 0.25) * rng.gauss()); // leapfrog: some owners don't sell when the city arrives (spread approximate)
  }
  M.tracts = tracts;

  // ---------------- Layer 4: suburbs by era -------------------------------
  const coreSrc = []; for (let k = 0; k < G.N; k++) if (coreL[k]) coreSrc.push(k);
  const carSrc = opts.townSources ? coreSrc.concat([...townL.keys()].filter((k) => townL[k])) : coreSrc;
  const sp = (era) => {
    const s = new Float32Array(G.N);
    for (let k = 0; k < G.N; k++) {
      const road = artL[k] || roadL[k];
      if (water[k] && !road && !coreL[k] && !townL[k]) continue;
      if (era === "prewar") s[k] = roadL[k] ? SZ.streetcar : SZ.walk; // streetcar lines ran out the old radial roads
      else s[k] = road ? SZ.arterial : SZ.local;
    }
    return s;
  };
  const jumps = (year) => { // freeway links between consecutive interchanges over built segments
    const J = new Map();
    for (const h of highways) {
      for (let i = 0; i < h.ix.length - 1; i++) {
        const a = h.ix[i], b = h.ix[i + 1];
        const segs = h.segs.filter((sg) => sg.s1 > a.s + 1 && sg.s0 < b.s - 1);
        if (!segs.every((sg) => sg.built && sg.year <= year)) continue;
        const ka = G.idx(a.p), kb = G.idx(b.p); if (ka < 0 || kb < 0) continue;
        const m = b.s - a.s;
        (J.get(ka) || J.set(ka, []).get(ka)).push([kb, m]); (J.get(kb) || J.set(kb, []).get(kb)).push([ka, m]);
      }
    }
    return J;
  };
  const eras = [
    { id: "prewar", T: travel(G, sp("prewar"), coreSrc, new Map()) },
    { id: "postwar", T: travel(G, sp("postwar"), carSrc, jumps(1975)) },
    { id: "recent", T: travel(G, sp("recent"), carSrc, jumps(2026)) },
  ];
  // land budget per era: share of units x gross land per unit
  const lotM2 = { prewar: SZ.prewarLot[0] * SZ.prewarLot[1], postwar: SZ.postwarLot[0] * SZ.postwarLot[1], recent: SZ.recentLot[0] * SZ.recentLot[1] };
  const w = Object.fromEntries(Object.keys(lotM2).map((e) => [e, SZ.unitShare[e] * lotM2[e] / (1 - SZ.streetShare[e])]));
  const wsum = w.prewar + w.postwar + w.recent;
  const dev = tracts.filter((t) => t.buildable >= 0.5);
  const devAcres = dev.reduce((s, t) => s + t.acres * t.buildable, 0);
  M.urbanised = rng.range(...URBANISED_SHARE) * (opts.urbanisedScale ?? 1);
  M.budget = {};
  for (const e of eras) {
    const budget = devAcres * M.urbanised * w[e.id] / wsum; M.budget[e.id] = Math.round(budget);
    const cand = dev.filter((t) => !t.era).map((t) => ({ t, score: e.T[G.idx(t.c)] * t.holdout })).filter((c) => isFinite(c.score)).sort((a, b) => a.score - b.score);
    let used = 0;
    for (const { t } of cand) { if (used >= budget) break; t.era = e.id; used += t.acres * t.buildable; }
  }
  for (const t of tracts) if (t.era) subdivide(t, rng, M, isWater);

  // ---------------- parcel count by type (what the engine would have to hold)
  const free = (p) => { const k = G.idx(p); return k >= 0 && !water[k] && !flood[k] && !coreL[k] && !townL[k] && !hwL[k]; };
  const coreKm2 = coreL.reduce((a, v) => a + v, 0) * CELL * CELL / 1e6;
  const townBlocks = towns.reduce((a, t) => a + t.blocks.length, 0);
  Object.assign(M, { free, isSea, coreL, townL, hwL, roadL, artL });
  M.parcels = {
    // island.mjs measures 932-1,026 lots per km2 on the generated islands (New Alden 922-951)
    downtown: [Math.round(coreKm2 * 932), Math.round(coreKm2 * 1026)],
    // a ~100 m village block holds two rows of ~50 x 140 ft lots: ~12 (approximate)
    townLots: townBlocks * 12,
    // one lot per frontage tick, counted only where the tick stands on buildable land
    suburbanLots: Object.fromEntries(['prewar', 'postwar', 'recent'].map((e) => [e, tracts.filter((t) => t.era === e).reduce((a, t) => a + t.plat.ticks.filter(([p, q]) => free(lerp(p, q, 0.5))).length, 0)])),
    farmTracts: tracts.filter((t) => !t.era && t.landShare > 0).length,
    subdividedTracts: tracts.filter((t) => t.era).length,
  };
  return M;
}

function gridBlocks(r, pitchL, pitchW, street, isWater) {
  const out = []; r.blockRects = [];
  const nL = Math.max(1, Math.round(2 * r.hl / pitchL)), nW = Math.max(1, Math.round(2 * r.hw / pitchW));
  const pl = 2 * r.hl / nL, pw = 2 * r.hw / nW;
  r.gridInfo = { nL, nW, pl, pw };
  for (let i = 0; i < nL; i++) for (let j = 0; j < nW; j++) {
    const c = add(add(r.c, mul(r.u, -r.hl + (i + 0.5) * pl)), mul(r.v, -r.hw + (j + 0.5) * pw));
    if (isWater(c)) continue;
    const b = oRect(c, r.u, pl / 2 - street / 2, pw / 2 - street / 2); r.blockRects.push(b); out.push(b.poly());
  }
  return out;
}

// ---------------------------------------------------------------- layer 4 templates
export function subdivide(t, rng, M, isWater) {
  const [x0, y0, x1, y1] = t.r, inset = SZ.arterialROW / 2 + 4;
  const X0 = x0 + inset, Y0 = y0 + inset, X1 = x1 - inset, Y1 = y1 - inset;
  const horiz = X1 - X0 >= Y1 - Y0;
  // local frame: u along the long side, v across
  const Lu = horiz ? X1 - X0 : Y1 - Y0, Lv = horiz ? Y1 - Y0 : X1 - X0;
  const P = (u, v) => horiz ? [X0 + u, Y0 + v] : [X0 + v, Y0 + u];
  const streets = [], ticks = [], bulbs = [], ponds = [], houses = [];
  const lotTicks = (pl, front, depth, sides = [1, -1]) => {
    const rs = resample(pl, front), n = normals(rs);
    for (let i = 1; i < rs.length - 1; i++) for (const sd of sides) { const a = add(rs[i], mul(n[i], sd * SZ.localROW / 2)), b = add(rs[i], mul(n[i], sd * (SZ.localROW / 2 + depth))); if (inside(b) && inside(a)) ticks.push([a, b]); }
    // one house per lot, centred between this lot line and the next (used by export-unreal.mjs)
    for (let i = 1; i < rs.length - 2; i++) { const m = lerp(rs[i], rs[i + 1], 0.5), u = norm(sub(rs[i + 1], rs[i])); for (const sd of sides) { const back = add(m, mul(perp(u), sd * (SZ.localROW / 2 + depth))); if (inside(m) && inside(back)) houses.push({ m, u, sd, depth }); } }
  };
  const inside = (p) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1 && !ponds.some((q) => dist(p, q.c) < q.r + 6);
  if (t.era === "prewar") {
    const [front, depth] = SZ.prewarLot, pitch = 2 * depth + SZ.alley + SZ.localROW;
    const nv = Math.max(1, Math.round(Lv / pitch)), nu = Math.max(1, Math.round(Lu / SZ.prewarBlockLen));
    for (let j = 0; j <= nv; j++) { const v = j * Lv / nv; const pl = [P(0, v), P(Lu, v)]; streets.push(pl); lotTicks(pl, front, depth); }
    for (let i = 0; i <= nu; i++) { const u = i * Lu / nu; streets.push([P(u, 0), P(u, Lv)]); }
  } else {
    // stormwater pond in the corner nearest water (detention drains toward the creek / river)
    const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
    const near = corners.map((c) => ({ c, d: nearestWater(M, c) })).sort((a, b) => a.d - b.d)[0].c;
    const r = Math.sqrt(SZ.pondShare * (x1 - x0) * (y1 - y0) / Math.PI);
    ponds.push({ c: lerp(near, t.c, (r + 25) / dist(near, t.c)), r });
  }
  if (t.era === "postwar") {
    // the one curvilinear template: parallel gently curving streets closed into loops at both ends
    const [front, depth] = SZ.postwarLot, pitch = 2 * depth + SZ.localROW;
    const n = Math.max(1, Math.round(Lv / pitch)), amp = Math.min(30, pitch * 0.35), ph = rng.range(0, 6.28), end = depth + 15;
    const lines = [];
    for (let j = 0; j < n; j++) {
      const v = (j + 0.5) * Lv / n, pl = [];
      for (let u = end; u <= Lu - end + 1; u += 15) pl.push(P(u, v + amp * Math.sin(Math.PI * 2 * u / Lu + ph) * Math.sin(Math.PI * (u - end) / (Lu - 2 * end))));
      lines.push(pl); streets.push(pl); lotTicks(pl, front, depth);
    }
    streets.push(lines.map((l) => l[0]), lines.map((l) => l.at(-1)));          // loop closers
    const mid = lines[Math.floor(n / 2)]; streets.push([mid[0], P(0, (Math.floor(n / 2) + 0.5) * Lv / n)], [mid.at(-1), P(Lu, (Math.floor(n / 2) + 0.5) * Lv / n)]); // entrances to the arterials
  }
  if (t.era === "recent") {
    // collector spine(s) with cul-de-sacs; lots back onto the collector
    const [front, depth] = SZ.recentLot, pitch = 2 * depth + SZ.localROW;
    const ns = Math.max(1, Math.round(Lv / (2 * (SZ.culDeSacMax + 30))));
    for (let s = 0; s < ns; s++) {
      const vc = (s + 0.5) * Lv / ns, half = Lv / ns / 2, amp = rng.range(15, 40), ph = rng.range(0, 6.28);
      const spine = []; for (let u = 0; u <= Lu + 1; u += 15) spine.push(P(u, vc + amp * Math.sin(Math.PI * 2 * u / Lu + ph) * Math.sin(Math.PI * u / Lu)));
      streets.push(spine);
      const cl = Math.min(SZ.culDeSacMax, half - depth - 10);
      if (cl < 40) continue;
      const nc = Math.floor((Lu - 2 * depth) / pitch);
      for (let i = 0; i < nc; i++) for (const sd of [1, -1]) {
        const u = depth + (i + 0.5) * (Lu - 2 * depth) / nc, base = spine[Math.min(spine.length - 1, Math.round(u / 15))];
        const bv = horiz ? base[1] - Y0 : base[0] - X0;
        const tip = P(u + rng.range(-12, 12), bv + sd * cl);
        if (!inside(tip)) continue;
        const pl = [base, tip]; streets.push(pl); bulbs.push(tip); lotTicks(pl, front, depth);
      }
    }
  }
  t.plat = { streets, ticks, bulbs, ponds, houses };
}
function nearestWater(M, p) {
  let d = Infinity;
  for (const q of M.river.pts) d = Math.min(d, dist(p, q));
  for (const c of M.creeks) for (const q of c.pts) d = Math.min(d, dist(p, q));
  return d;
}

// ================================================================ SVG
const COL = {
  land: "#efeadb", crop: ["#e4dcbf", "#dfe0bd", "#e8d9b0", "#d9dcb6", "#e2d6b8"], wood: "#bdcc9e", tractLine: "#b9ac86",
  flood: "#9fc1a8", water: "#8db8d9", waterLine: "#5f93bd",
  core: "#6b5d73", coreBlock: "#4f4257", town: "#9a7f6e", townBlock: "#7a5f50",
  prewar: "#e8b7a0", postwar: "#f2d48f", recent: "#c9d6ef", lot: "#00000033", street: "#ffffff", streetCase: "#a9a49a",
  arterial: "#f7f2e4", arterialCase: "#8a7f68", hwBuilt: "#d9532b", hwCase: "#7a2a14", hwProp: "#d9532b", ix: "#ffffff",
};
export { SZ, MILE, ACRE, FT, makeRng, makeNoise, resample, rdp, dist, add, sub, mul, norm, perp, lerp, cumLen };
export function render(M, seed) {
  const S = M.S, LEG = 2500, rot = M.rotate ?? 0;
  const T = (p) => { const c = S / 2; let x = p[0] - c, y = p[1] - c; for (let i = 0; i < rot; i++) [x, y] = [-y, x]; return [x + c, y + c]; };
  const f = (p) => { const q = T(p); return `${Math.round(q[0])} ${Math.round(q[1])}`; };
  const d = (pts, close) => "M" + pts.map(f).join("L") + (close ? "Z" : "");
  const dMany = (pls, close) => pls.map((p) => d(p, close)).join("");
  const o = [];
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S + LEG} ${S}" width="${Math.round((S + LEG) / 4.5)}" height="${Math.round(S / 4.5)}" font-family="Helvetica,Arial,sans-serif">`);
  o.push(`<rect width="${S + LEG}" height="${S}" fill="#fbf9f3"/><clipPath id="win"><rect width="${S}" height="${S}"/></clipPath>`);
  // build mask: what suburbs may NOT cover
  const sea = M.coast ? [...M.coast.line, [S + 300, S + 600], [-300, S + 600]] : null;
  // variable-width river drawn as overlapping round-capped stroke chunks: an offset polygon folds over itself on tight meanders
  const vStroke = (pts, half, col, extra = 0) => { const out = []; for (let i = 0; i < pts.length - 1; i += 10) { const ch = pts.slice(i, i + 11); const h = half.slice(i, i + 11); out.push(`<path d="${d(ch)}" fill="none" stroke="${col}" stroke-width="${Math.round(2 * h.reduce((a, b) => a + b, 0) / h.length + extra)}" stroke-linecap="round" stroke-linejoin="round"/>`); } return out.join(""); };
  o.push(`<mask id="buildable"><rect width="${S}" height="${S}" fill="#fff"/><g fill="#000" stroke="#000" stroke-linejoin="round">`);
  o.push(vStroke(M.river.pts, M.river.fp, "#000"));
  for (const c of M.creeks) o.push(`<path d="${d(c.pts)}" fill="none" stroke-width="${2 * c.fp}"/>`);
  if (sea) o.push(`<path d="${d(sea, true)}"/><path d="${d(M.coast.line)}" fill="none" stroke-width="${2 * M.coast.band}"/>`);
  o.push(`<path d="${d(M.core.poly(), true)}"/>`); for (const t of M.towns) o.push(`<path d="${d(t.poly(), true)}"/>`);
  for (const h of M.highways) o.push(`<path d="${d(h.pts)}" fill="none" stroke-width="${SZ.highwayROW}"/>`);
  o.push(`</g></mask>`);
  o.push(`<g clip-path="url(#win)">`);
  o.push(`<rect width="${S}" height="${S}" fill="${COL.land}"/>`);
  // layer 5: farm tracts (and the outline of every tract, developed or not)
  const tractPoly = (t) => { const [x0, y0, x1, y1] = t.r; return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; };
  const byFill = new Map();
  for (const t of M.tracts) { const fill = t.era ? null : t.wood ? COL.wood : COL.crop[t.crop]; if (fill) (byFill.get(fill) || byFill.set(fill, []).get(fill)).push(tractPoly(t)); }
  for (const [fill, ps] of byFill) o.push(`<path d="${dMany(ps, true)}" fill="${fill}"/>`);
  o.push(`<path d="${dMany(M.tracts.map(tractPoly), true)}" fill="none" stroke="${COL.tractLine}" stroke-width="5"/>`);
  // layer 1: floodplain & water
  o.push(`<g fill="${COL.flood}" stroke="${COL.flood}" stroke-linejoin="round" opacity="0.85">${vStroke(M.river.pts, M.river.fp, COL.flood)}`);
  for (const c of M.creeks) o.push(`<path d="${d(c.pts)}" fill="none" stroke-width="${2 * c.fp}" stroke-linecap="round"/>`);
  if (sea) o.push(`<path d="${d(M.coast.line)}" fill="none" stroke-width="${2 * M.coast.band}"/>`);
  o.push(`</g>`);
  // layer 4: suburbs, masked off floodplain, settlements and freeway ROW
  o.push(`<g mask="url(#buildable)">`);
  for (const era of ["prewar", "postwar", "recent"]) {
    const ts = M.tracts.filter((t) => t.era === era); if (!ts.length) continue;
    o.push(`<path d="${dMany(ts.map(tractPoly), true)}" fill="${COL[era]}"/>`);
    const st = ts.flatMap((t) => t.plat.streets);
    o.push(`<path d="${dMany(ts.flatMap((t) => t.plat.ticks))}" stroke="${COL.lot}" stroke-width="2" fill="none"/>`);
    o.push(`<path d="${dMany(st)}" stroke="${COL.streetCase}" stroke-width="${SZ.localROW * 0.75}" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`);
    o.push(`<path d="${dMany(st)}" stroke="${COL.street}" stroke-width="${SZ.localROW * 0.5}" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`);
    const bl = ts.flatMap((t) => t.plat.bulbs);
    if (bl.length) o.push(`<g fill="${COL.street}" stroke="${COL.streetCase}" stroke-width="3">${bl.map((p) => { const q = T(p); return `<circle cx="${Math.round(q[0])}" cy="${Math.round(q[1])}" r="${Math.round(SZ.bulbRadius)}"/>`; }).join("")}</g>`);
    const pd = ts.flatMap((t) => t.plat.ponds);
    if (pd.length) o.push(`<g fill="${COL.water}" stroke="${COL.waterLine}" stroke-width="3">${pd.map((p) => { const q = T(p.c); return `<circle cx="${Math.round(q[0])}" cy="${Math.round(q[1])}" r="${Math.round(p.r)}"/>`; }).join("")}</g>`);
  }
  o.push(`</g>`);
  // layer 2: core & towns
  o.push(`<path d="${d(M.core.poly(), true)}" fill="${COL.core}" opacity="0.25"/><path d="${dMany(M.core.blocks, true)}" fill="${COL.coreBlock}"/>`);
  for (const t of M.towns) o.push(`<path d="${d(t.poly(), true)}" fill="${COL.town}" opacity="0.2"/><path d="${dMany(t.blocks, true)}" fill="${COL.townBlock}"/>`);
  // water drawn over settlements: blocks were already dropped where they would stand in it
  o.push(`<g fill="${COL.water}" stroke="${COL.waterLine}" stroke-width="6" stroke-linejoin="round">${vStroke(M.river.pts, M.river.half, COL.waterLine, 12)}${vStroke(M.river.pts, M.river.half, COL.water)}`);
  if (sea) o.push(`<path d="${d(sea, true)}"/>`);
  for (const c of M.creeks) o.push(`<path d="${d(c.pts)}" fill="none" stroke="${COL.water}" stroke-width="${c.w}" stroke-linecap="round"/>`);
  o.push(`</g>`);
  // layer 3: arterials, highways
  const arts = M.oldRoads.concat(M.secRoads);
  o.push(`<path d="${dMany(arts)}" stroke="${COL.arterialCase}" stroke-width="${SZ.arterialROW * 1.0}" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`);
  o.push(`<path d="${dMany(arts)}" stroke="${COL.arterial}" stroke-width="${SZ.arterialROW * 0.6}" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`);
  o.push(`<path d="${dMany(M.oldRoads)}" stroke="#e9c46a" stroke-width="${SZ.arterialROW * 0.6}" fill="none" stroke-linejoin="round" stroke-linecap="round"/>`);
  for (const h of M.highways) {
    const b = h.segs.filter((s) => s.built), p = h.segs.filter((s) => !s.built);
    if (b.length) o.push(`<path d="${dMany(b.map((s) => s.pts))}" stroke="${COL.hwCase}" stroke-width="44" fill="none" stroke-linejoin="round"/><path d="${dMany(b.map((s) => s.pts))}" stroke="${COL.hwBuilt}" stroke-width="28" fill="none" stroke-linejoin="round"/>`);
    if (p.length) o.push(`<path d="${dMany(p.map((s) => s.pts))}" stroke="${COL.hwProp}" stroke-width="22" fill="none" stroke-dasharray="70 50" opacity="0.9"/>`);
  }
  for (const h of M.highways) for (const c of h.ix) { const q = T(c.p); o.push(`<circle cx="${Math.round(q[0])}" cy="${Math.round(q[1])}" r="${c.sys ? 60 : 38}" fill="${COL.ix}" stroke="${COL.hwCase}" stroke-width="12"/>`); }
  // labels
  const label = (p, txt, size, extra = "", halo = "#fbf9f3") => { const q = T(p); return `<text x="${Math.round(q[0])}" y="${Math.round(q[1])}" font-size="${size}" text-anchor="middle" paint-order="stroke" stroke="${halo}" stroke-width="${size / 5}" ${extra}>${txt}</text>`; };
  for (const h of M.highways) for (const s of h.segs) { if (cumLen(s.pts).at(-1) < 500) continue; const m = pointAt(s.pts, cumLen(s.pts).at(-1) / 2); o.push(label(add(m, [0, -50]), s.built ? `${s.year}` : `plan ${s.year}`, 95, `fill="${COL.hwCase}" font-style="${s.built ? "normal" : "italic"}"`)); }
  for (const h of M.highways) { const p = pointAt(h.pts, cumLen(h.pts).at(-1) * 0.12); o.push(label(p, h.name, 120, `font-weight="bold" fill="#fff"`, COL.hwCase)); }
  o.push(label(add(M.core.c, [0, 40]), "DOWNTOWN", 170, `font-weight="bold" fill="#2b2230" letter-spacing="20"`));
  o.push(label(add(M.core.c, [0, 200]), "(island-city core footprint)", 95, `fill="#2b2230"`));
  for (const t of M.towns) o.push(label(add(t.c, [0, -t.hw - 60]), t.name, 140, `font-weight="bold" fill="#5a3c2c"`));
  const rm = M.river.pts.slice(Math.floor(M.river.pts.length * 0.1), Math.floor(M.river.pts.length * 0.9)).filter((p) => p[0] > 600 && p[0] < S - 600 && p[1] > 300 && p[1] < S - 300).map((p) => ({ p, d: Math.min(dist(p, M.core.c) - 1300, ...M.towns.map((t) => dist(p, t.c))) })).sort((a, b) => b.d - a.d)[0]?.p ?? M.river.pts[0]; o.push(label(rm, M.river.name, 120, `font-style="italic" fill="#2f5f86"`));
  o.push(`</g>`);
  o.push(`<rect width="${S}" height="${S}" fill="none" stroke="#333" stroke-width="10"/>`);
  o.push(legend(M, seed, S, LEG));
  o.push(`</svg>`);
  return o.join("\n");
}
function legend(M, seed, S, LEG) {
  const x = S + 120, o = []; let y = 200;
  const t = (txt, size = 110, extra = "") => { o.push(`<text x="${x}" y="${y}" font-size="${size}" ${extra}>${txt}</text>`); y += size * 1.45; };
  t(`Region · seed ${seed}`, 170, `font-weight="bold"`);
  t(`${M.S / 1000} × ${M.S / 1000} km · ${M.coast ? "river mouth on a coast" : "inland river"}`, 95);
  t(`urbanised by 2026: ${Math.round(M.urbanised * 100)}% of developable land (KNOB)`, 80, `fill="#a33"`);
  y += 60;
  const sw = (fill, txt, stroke, dash) => { o.push(`<rect x="${x}" y="${y - 80}" width="200" height="100" fill="${fill}" stroke="${stroke || "#0003"}" stroke-width="${stroke ? 20 : 4}" ${dash ? `stroke-dasharray="40 30"` : ""}/><text x="${x + 260}" y="${y}" font-size="95">${txt}</text>`); y += 150; };
  const ln = (col, w, txt, dash, cas) => { if (cas) o.push(`<line x1="${x}" x2="${x + 200}" y1="${y - 30}" y2="${y - 30}" stroke="${cas}" stroke-width="${w + 16}"/>`); o.push(`<line x1="${x}" x2="${x + 200}" y1="${y - 30}" y2="${y - 30}" stroke="${col}" stroke-width="${w}" ${dash ? `stroke-dasharray="${dash}"` : ""}/><text x="${x + 260}" y="${y}" font-size="95">${txt}</text>`); y += 150; };
  sw(COL.water, "water (river, creeks, sea, ponds)");
  sw(COL.flood, "floodplain — unbuildable");
  sw(COL.coreBlock, "downtown core (island city)");
  sw(COL.townBlock, "historic town / village");
  ln(COL.hwBuilt, 28, "highway, built (year opened)", null, COL.hwCase);
  ln(COL.hwProp, 22, "highway, proposed (planned year)", "70 50");
  o.push(`<circle cx="${x + 100}" cy="${y - 30}" r="38" fill="#fff" stroke="${COL.hwCase}" stroke-width="12"/><text x="${x + 260}" y="${y}" font-size="95">interchange (≥ 1 mile apart)</text>`); y += 150;
  ln("#e9c46a", 14, "old country road → arterial", null, COL.arterialCase);
  ln(COL.arterial, 14, "section-line road (1-mile survey grid)", null, COL.arterialCase);
  ln(COL.street, 9, "local street / cul-de-sac", null, COL.streetCase);
  sw(COL.prewar, "pre-war streetcar suburb (grid, ~4,400 sf lots)");
  sw(COL.postwar, "post-war tract (curving loops, ~7,500 sf)");
  sw(COL.recent, "1980s+ cul-de-sac subdivision (~8,300 sf)");
  sw(COL.crop[0], "farm tract (40 / 80 / 160 / 640 ac)", COL.tractLine);
  sw(COL.wood, "woodlot");
  y += 60;
  const n = (e) => M.tracts.filter((t) => t.era === e).length;
  const P = M.parcels, sub = P.suburbanLots.prewar + P.suburbanLots.postwar + P.suburbanLots.recent;
  t(`parcels ≈ ${(P.downtown[0] + sub + P.townLots + P.farmTracts).toLocaleString("en-US")}`, 80);
  t(`downtown lots ${P.downtown[0].toLocaleString("en-US")}–${P.downtown[1].toLocaleString("en-US")}, house lots ${sub.toLocaleString("en-US")}`, 80);
  t(`village lots ${P.townLots} · farm tracts ${P.farmTracts}`, 80);
  t(`tracts: ${M.tracts.length} · subdivided: pre-war ${n("prewar")}, post-war ${n("postwar")}, recent ${n("recent")}`, 80);
  for (const h of M.highways) t(`${h.name}: ${h.segs.filter((s) => s.built).length} built / ${h.segs.filter((s) => !s.built).length} proposed segments`, 80);
  // scale bar: 1 mile and 1 km
  y += 80;
  o.push(`<rect x="${x}" y="${y}" width="${MILE}" height="40" fill="#333"/><text x="${x}" y="${y - 30}" font-size="85">1 mile (survey section)</text>`); y += 160;
  o.push(`<rect x="${x}" y="${y}" width="1000" height="40" fill="#777"/><text x="${x}" y="${y - 30}" font-size="85">1 km</text>`); y += 160;
  o.push(`<g transform="translate(${x + 1500},${y - 200})"><path d="M0 -150 L60 60 L0 20 L-60 60Z" fill="#333"/><text y="150" font-size="110" text-anchor="middle">N</text></g>`);
  return o.join("\n");
}

// ================================================================ CLI
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const args = process.argv.slice(2); let km = 10, png = false; const seeds = [];
  for (let i = 0; i < args.length; i++) { if (args[i] === "--km") km = Number(args[++i]); else if (args[i] === "--png") png = true; else seeds.push(args[i]); }
  if (!seeds.length) seeds.push("1", "2", "3", "4", "5", "6");
  const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "out"); fs.mkdirSync(outDir, { recursive: true });
  for (const seed of seeds) {
    const t0 = Date.now();
    const M = generate(seed, km);
    const r = makeRng("orient:" + seed); M.rotate = Math.floor(r() * 4);
    nameHighways(M, r);
    const file = path.join(outDir, `region-${seed}${km !== 10 ? `-${km}km` : ""}.svg`);
    fs.writeFileSync(file, render(M, seed));
    if (png) toPng(file, M.S);
    console.log(`seed ${seed}: ${path.relative(process.cwd(), file)}  (${Date.now() - t0} ms, ${M.tracts.length} tracts, parcels ${JSON.stringify(M.parcels)})`);
  }
}
function nameHighways(M, r) {
  // Interstate numbering convention: 2-digit odd = north-south, even = east-west; 3-digit with odd first digit = spur, even = loop/bypass.
  for (const h of M.highways) {
    const a = h.pts[0], b = h.pts.at(-1); let ns = Math.abs(b[1] - a[1]) > Math.abs(b[0] - a[0]); if (M.rotate % 2) ns = !ns;
    const base = M.base ?? (M.base = 10 + 2 * Math.floor(r() * 40) + (ns ? 1 : 0));
    if (h.kind === "interstate") h.name = `I-${base}`;
    else if (h.kind === "spur") h.name = `I-${2 * Math.floor(r() * 4) + 1}${String(base).padStart(2, "0")}`;
    else h.name = `I-${2 * Math.floor(r() * 4) + 2}${String(base).padStart(2, "0")}`;
  }
}

/** Optional PNG via a locally installed Chromium browser in headless mode (no npm dependency). Skipped if none is found. */
function toPng(svgFile, S) {
  const cands = [process.env.CHROME, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/chromium", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean);
  const exe = cands.find((c) => fs.existsSync(c));
  if (!exe) { console.log("  (no Chrome/Edge found: set CHROME=path to export PNG)"); return; }
  const w = Math.round((S + 2500) / 4.5), h = Math.round(S / 4.5); // the SVG's own pixel size
  const out = svgFile.replace(/\.svg$/, ".png");
  spawnSync(exe, ["--headless", "--disable-gpu", "--hide-scrollbars", `--window-size=${w},${h}`, `--screenshot=${path.resolve(out)}`, pathToFileURL(path.resolve(svgFile)).href], { stdio: "ignore", timeout: 60000 });
  console.log(`  png: ${path.relative(process.cwd(), out)}`);
}
