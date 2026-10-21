// THE REGION'S TOOLBOX: seeded streams, value noise, polyline geometry, a
// 20 m raster with path-finding, and the contour that turns a raster mask into
// the town's outline. Ported from the region-map spike
// (region-spikes/map/region.mjs on claude/region-map-spike), unchanged in
// behaviour; nothing here is a world size.

export const MILE = 1609.344;            // international mile, m
export const ACRE = 4046.856;            // m2
export const FT = 0.3048;                // m
export const SQFT_PER_M2 = 10.7639;

/** FNV over a string, for salting a stream by name. */
export function hashStr(s) { let h = 2166136261 >>> 0; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
/**
 * A stream per concern, keyed by name: "region:12345", "plat:N7:12345". Adding
 * a draw to one concern never shifts another's, so a new pocket does not move
 * the river.
 */
export function makeRng(key) {
  const r = mulberry(hashStr(key));
  const f = () => r();
  f.range = (a, b) => a + (b - a) * r();
  f.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  f.pick = (arr) => arr[Math.floor(r() * arr.length) % arr.length];
  f.gauss = () => { let u = 0; while (u === 0) u = r(); const v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  return f;
}
/** Smooth value noise in [0,1], `scale` metres per lattice cell. */
export function makeNoise(rng, scale) {
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

// ---------------------------------------------------------------- vectors
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
export const mul = (a, k) => [a[0] * k, a[1] * k];
export const len = (a) => Math.hypot(a[0], a[1]);
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
export const perp = (a) => [-a[1], a[0]];
export const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

export function cumLen(pts) { const c = [0]; for (let i = 1; i < pts.length; i++) c.push(c[i - 1] + dist(pts[i - 1], pts[i])); return c; }
export function resample(pts, step) {
  if (pts.length < 2) return pts.slice();
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
export function chaikinOpen(pts, it) {
  for (let k = 0; k < it; k++) {
    const o = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) o.push(lerp(pts[i], pts[i + 1], 0.25), lerp(pts[i], pts[i + 1], 0.75));
    o.push(pts[pts.length - 1]); pts = o;
  }
  return pts;
}
export function chaikinClosed(ring, it) {
  for (let k = 0; k < it; k++) {
    const o = [];
    for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; o.push(lerp(a, b, 0.25), lerp(a, b, 0.75)); }
    ring = o;
  }
  return ring;
}
export function smoothMA(pts, step, window, passes) {
  let p = resample(pts, step); const k = Math.max(1, Math.round(window / step / 2));
  for (let n = 0; n < passes; n++) {
    p = p.map((v, i) => {
      if (i === 0 || i === p.length - 1) return v;
      const a = Math.max(0, i - k), b = Math.min(p.length - 1, i + k); let sx = 0, sy = 0;
      for (let j = a; j <= b; j++) { sx += p[j][0]; sy += p[j][1]; }
      return [sx / (b - a + 1), sy / (b - a + 1)];
    });
  }
  return p;
}
export function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts[pts.length - 1], d = norm(sub(b, a)); let mi = 0, md = 0;
  for (let i = 1; i < pts.length - 1; i++) { const v = sub(pts[i], a); const e = Math.abs(v[0] * d[1] - v[1] * d[0]); if (e > md) { md = e; mi = i; } }
  if (md < eps) return [a, b];
  return rdp(pts.slice(0, mi + 1), eps).slice(0, -1).concat(rdp(pts.slice(mi), eps));
}
export function normals(pts) {
  return pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)]; return perp(norm(sub(b, a))); });
}
function segX(p1, p2, p3, p4) {
  const d = (p2[0] - p1[0]) * (p4[1] - p3[1]) - (p2[1] - p1[1]) * (p4[0] - p3[0]);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((p3[0] - p1[0]) * (p4[1] - p3[1]) - (p3[1] - p1[1]) * (p4[0] - p3[0])) / d;
  const u = ((p3[0] - p1[0]) * (p2[1] - p1[1]) - (p3[1] - p1[1]) * (p2[0] - p1[0])) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : null;
}
/** Where polyline B crosses A, as distance along A. */
export function crossings(A, B) {
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
export function pointAt(pts, s) { const c = cumLen(pts); let i = 0; while (i < c.length - 2 && c[i + 1] < s) i++; return lerp(pts[i], pts[i + 1], Math.min(1, (s - c[i]) / ((c[i + 1] - c[i]) || 1))); }
export function slicePl(pts, s0, s1) { const c = cumLen(pts); const o = [pointAt(pts, s0)]; for (let i = 0; i < pts.length; i++) if (c[i] > s0 && c[i] < s1) o.push(pts[i]); o.push(pointAt(pts, s1)); return o; }
/** An oriented rectangle: centre, unit axis, half-length, half-width. */
export function oRect(c, u, hl, hw) {
  u = norm(u); const v = perp(u);
  return {
    c, u, v, hl, hw,
    has: (p) => { const d = sub(p, c); return Math.abs(d[0] * u[0] + d[1] * u[1]) <= hl && Math.abs(d[0] * v[0] + d[1] * v[1]) <= hw; },
    poly: () => [add(add(c, mul(u, -hl)), mul(v, -hw)), add(add(c, mul(u, hl)), mul(v, -hw)), add(add(c, mul(u, hl)), mul(v, hw)), add(add(c, mul(u, -hl)), mul(v, hw))],
  };
}
/** A rectangle ring: centre, axis, extent along it, extent across it. */
export function rectRing(c, u, w, d) {
  const v = perp(u);
  return [add(add(c, mul(u, -w / 2)), mul(v, -d / 2)), add(add(c, mul(u, w / 2)), mul(v, -d / 2)), add(add(c, mul(u, w / 2)), mul(v, d / 2)), add(add(c, mul(u, -w / 2)), mul(v, d / 2))];
}
export function hull(pts) { // monotone chain
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cr(up.at(-2), up.at(-1), q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
export const circle = (c, r, n = 12) => Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos(2 * Math.PI * i / n), c[1] + r * Math.sin(2 * Math.PI * i / n)]);
/** A road or river as convex capsules, one per segment: never self-intersects, however tight the bend. */
export function capsules(pl, half, n = 10) {
  const out = [];
  for (let i = 0; i < pl.length - 1; i++) {
    const h0 = typeof half === "number" ? half : half[i], h1 = typeof half === "number" ? half : half[i + 1];
    if (dist(pl[i], pl[i + 1]) < 0.01) continue;
    out.push(hull(circle(pl[i], h0, n).concat(circle(pl[i + 1], h1, n))));
  }
  return out;
}
export function ringAreaAbs(r) { let s = 0; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s / 2); }
export function ringCentroid(r) { return r.reduce((a, p) => [a[0] + p[0] / r.length, a[1] + p[1] / r.length], [0, 0]); }
export function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
/** Distance from p to a polyline. */
export function distToLine(p, pl) {
  let best = Infinity;
  for (let i = 0; i + 1 < pl.length; i++) {
    const a = pl[i], b = pl[i + 1], ex = b[0] - a[0], ey = b[1] - a[1], L2 = ex * ex + ey * ey;
    const t = L2 > 1e-12 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / L2)) : 0;
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * ex, p[1] - a[1] - t * ey));
  }
  return best;
}

// ---------------------------------------------------------------- raster
export const CELL = 20; // raster resolution for masks and path-finding (a tool choice, not a world size)
export class Grid {
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
  /** Breadth-first distance (m, 4-neighbour) from every cell where src(k). */
  bfs(src, pass = () => true) {
    const d = new Float32Array(this.N).fill(Infinity), q = new Int32Array(this.N); let qh = 0, qt = 0;
    for (let k = 0; k < this.N; k++) if (src(k)) { d[k] = 0; q[qt++] = k; }
    const W = this.W;
    while (qh < qt) {
      const k = q[qh++], x = k % W, y = (k - x) / W;
      const nb = [x > 0 ? k - 1 : -1, x < W - 1 ? k + 1 : -1, y > 0 ? k - W : -1, y < W - 1 ? k + W : -1];
      for (const n of nb) if (n >= 0 && d[n] === Infinity && pass(n)) { d[n] = d[k] + CELL; q[qt++] = n; }
    }
    return d;
  }
}
export class Heap {
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
/** A* over a per-cell cost surface. */
export function astar(G, cost, a, b, hmin) {
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

/**
 * THE OUTLINE OF A MASK, as one simple ring: the boundary of the largest
 * 4-connected component, holes filled, traced along cell edges (so it cannot
 * cross itself), then simplified and rounded. Coordinates are cell corners.
 */
export function maskOutline(G, mask) {
  const W = G.W, N = G.N;
  // largest component
  const comp = new Int32Array(N).fill(-1); let best = -1, bestN = 0, id = 0;
  for (let k = 0; k < N; k++) {
    if (!mask[k] || comp[k] >= 0) continue;
    const q = [k]; comp[k] = id; let n = 0;
    while (q.length) { const c = q.pop(); n++; const x = c % W, y = (c - x) / W; for (const m of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, y > 0 ? c - W : -1, y < W - 1 ? c + W : -1]) if (m >= 0 && mask[m] && comp[m] < 0) { comp[m] = id; q.push(m); } }
    if (n > bestN) { bestN = n; best = id; }
    id++;
  }
  if (best < 0) return null;
  // fill holes: everything not reachable from the border through non-member cells is inside
  const inC = (k) => comp[k] === best;
  const outside = new Uint8Array(N), q = [];
  for (let i = 0; i < W; i++) for (const k of [i, (W - 1) * W + i, i * W, i * W + W - 1]) if (!inC(k) && !outside[k]) { outside[k] = 1; q.push(k); }
  while (q.length) { const c = q.pop(), x = c % W, y = (c - x) / W; for (const m of [x > 0 ? c - 1 : -1, x < W - 1 ? c + 1 : -1, y > 0 ? c - W : -1, y < W - 1 ? c + W : -1]) if (m >= 0 && !outside[m] && !inC(m)) { outside[m] = 1; q.push(m); } }
  const solid = (x, y) => x >= 0 && y >= 0 && x < W && y < W && !outside[y * W + x];
  // every boundary edge, directed so the solid cell is on its right (y-down lattice), keyed by its start corner
  const key = (x, y) => y * (W + 1) + x;
  const out = new Map();
  const addE = (x0, y0, x1, y1) => { const k = key(x0, y0); const l = out.get(k); if (l) l.push([x1, y1]); else out.set(k, [[x1, y1]]); };
  let start = null;
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    if (!solid(x, y)) continue;
    if (!solid(x, y - 1)) { addE(x, y, x + 1, y); start ??= [x, y]; }   // top edge, heading +x
    if (!solid(x + 1, y)) addE(x + 1, y, x + 1, y + 1);                 // right edge, heading +y
    if (!solid(x, y + 1)) addE(x + 1, y + 1, x, y + 1);                 // bottom edge, heading -x
    if (!solid(x - 1, y)) addE(x, y + 1, x, y);                         // left edge, heading -y
  }
  if (!start) return null;
  const pts = []; let cur = start, dir = [1, 0];
  for (let guard = 0; guard < 4 * N; guard++) {
    pts.push(cur);
    const opts = out.get(key(cur[0], cur[1]));
    if (!opts || !opts.length) break;
    // at a saddle corner take the right turn, which keeps 4-connected pieces apart
    let pick = 0;
    if (opts.length > 1) {
      const right = [-dir[1], dir[0]];
      const i = opts.findIndex((n) => n[0] - cur[0] === right[0] && n[1] - cur[1] === right[1]);
      pick = i >= 0 ? i : 0;
    }
    const nxt = opts.splice(pick, 1)[0];
    dir = [nxt[0] - cur[0], nxt[1] - cur[1]];
    cur = nxt;
    if (cur[0] === start[0] && cur[1] === start[1]) break;
  }
  // drop collinear corners
  const ring = pts.filter((p, i) => {
    const a = pts[(i - 1 + pts.length) % pts.length], b = pts[(i + 1) % pts.length];
    return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
  });
  return ring.map(([i, j]) => [i * CELL, j * CELL]);
}
