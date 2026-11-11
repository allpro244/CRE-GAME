// NATURAL STREETS — a street network that grows from the land and its history
// instead of a district picking a template (CITYGEN_NEXT_PLAN.md).
//
// The classic generator gives each district a layout kind (lattice, radial,
// curvilinear, ...) on one of up to three surveys set 24-90 degrees apart, and
// the districts meet at straight seams. Seen from above that reads as a quilt
// of templates. Real towns do not look like that because nobody laid them out
// that way: the first streets ran along the shore and up from the landing, the
// next ones filled in between at whatever angle the ground and the old roads
// suggested, and the planned extensions came last and were bent to meet what
// was already there.
//
// METHOD. A smooth street-direction field — a 2-D tensor field, as in Chen,
// Esch, Wonka, Müller & Zhang, "Interactive Procedural Street Modeling"
// (SIGGRAPH 2008), and the open-source MapGenerator that follows it — is
// summed from basis fields, each weighted by distance:
//   - the shore: streets run along the water and straight up from it;
//   - the old centre: a radial field round the founding point, with the most
//     wander (an old town is irregular because it was walked, not surveyed);
//   - each district's survey: a grid at its bearing — the planned extension —
//     weighted by a Gaussian blur of the district's ground, so one survey
//     turns into the next over a few hundred metres instead of at a seam;
//   - squares and boulevards: streets frame them and cross them square on;
//   - creeks: like the shore, smaller.
// Two families of streamlines are traced through the field, arterials first at
// a wide spacing, then ordinary streets at the block pitch; the streets are
// noded into a planar graph and its faces are the blocks. citygen.mjs then cuts
// lots, assigns uses and masses buildings exactly as for a classic town.
//
// Deterministic: every draw comes from the salted streams handed in; nothing
// here touches the engine's rng().

import { mulberry32 } from "./geom.mjs";

const TAU = Math.PI * 2;

/** A salted stream, the same avalanche island.mjs uses. */
export function natStream(seed, salt) {
  let h = (seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
  return mulberry32((h ^ (h >>> 16)) >>> 0);
}

function inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function ringAreaSigned(r) {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i], q = r[(i + 1) % r.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

// ---------------------------------------------------------------- the field
//
// THE FIELD IS RASTERISED ON A 10 m GRID and read back bilinearly. A block is
// 60-120 m, so 10 m is six to twelve samples across one, well inside the
// field's own smoothness (its narrowest basis falls off over ~90 m).

const CELL = 10;


/**
 * Build the street-direction field.
 *
 * `spec`:
 *   land       the street line round the island (citygen's innerRing), metres
 *   bbox       [x0, y0, x1, y1] to rasterise over
 *   districts  [{ name, bearingDeg, shortPitch, longPitch, regular, old }]
 *   labelAt    (p) => district index or -1, for any point
 *   founding   [x, y] — where the town started
 *   oldR       radius of the old town, m
 *   parks      [{ ring, deg, round }]
 *   boulevards [{ cx, cy, w, h, deg }]
 *   creeks     [ring] water that runs through the town
 *   rand       a salted stream for the wander
 */
export function buildField(spec) {
  const [bx0, by0, bx1, by1] = spec.bbox;
  const W = Math.ceil((bx1 - bx0) / CELL) + 1, H = Math.ceil((by1 - by0) / CELL) + 1;
  const N = W * H;
  const tx = new Float32Array(N), ty = new Float32Array(N);       // tensor (cos 2t, sin 2t) * weight
  const sA = new Float32Array(N), sB = new Float32Array(N), sw = new Float32Array(N);
  const land = new Uint8Array(N);
  const label = new Int16Array(N);
  const X = (i) => bx0 + i * CELL, Y = (j) => by0 + j * CELL;

  // --- the shore: distance and tangent, by brute force over its segments with
  // a bucket so each cell only reads the segments near it.
  const ring = spec.land;
  const ccw = ringAreaSigned(ring) > 0;
  const BK = 80, bucket = new Map();
  const bk = (gx, gy) => gx * 65536 + gy;
  for (let s = 0; s < ring.length; s++) {
    const a = ring[s], b = ring[(s + 1) % ring.length];
    for (let gx = Math.floor(Math.min(a[0], b[0]) / BK); gx <= Math.floor(Math.max(a[0], b[0]) / BK); gx++) {
      for (let gy = Math.floor(Math.min(a[1], b[1]) / BK); gy <= Math.floor(Math.max(a[1], b[1]) / BK); gy++) {
        const k = bk(gx, gy);
        if (!bucket.has(k)) bucket.set(k, []);
        bucket.get(k).push(s);
      }
    }
  }
  /** nearest shore segment: [distance, tangent angle] */
  const shoreAt = (p) => {
    let best = Infinity, ang = 0;
    const gx0 = Math.floor(p[0] / BK), gy0 = Math.floor(p[1] / BK);
    for (let r = 0; r < 40; r++) {
      for (let gx = gx0 - r; gx <= gx0 + r; gx++) {
        for (let gy = gy0 - r; gy <= gy0 + r; gy++) {
          if (Math.max(Math.abs(gx - gx0), Math.abs(gy - gy0)) !== r) continue;
          for (const s of bucket.get(bk(gx, gy)) ?? []) {
            const a = ring[s], b = ring[(s + 1) % ring.length];
            const ex = b[0] - a[0], ey = b[1] - a[1];
            const L2 = ex * ex + ey * ey || 1;
            let t = ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / L2;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const d = Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ey * t);
            if (d < best) { best = d; ang = Math.atan2(ey, ex); }
          }
        }
      }
      if (best < (r - 1) * BK) break;
    }
    return [best, ang];
  };

  // --- district weights: the indicator of each district's ground, blurred.
  // SIGMA 170 m, set by eye on six seeds: under ~120 the turn from one survey
  // to the next is still read as a kink; over ~250 a district of 600 m never
  // reaches its own bearing anywhere and every town comes out one bent grid.
  const nd = spec.districts.length;
  const dW = Array.from({ length: nd }, () => new Float32Array(N));
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const p = [X(i), Y(j)];
      const k = j * W + i;
      land[k] = inRing(p, ring) ? 1 : 0;
      const l = spec.labelAt(p);
      label[k] = l;
      if (l >= 0) dW[l][k] = 1;
    }
  }
  const SIGMA = 170;
  for (const g of dW) blur(g, W, H, SIGMA / CELL);

  // --- the wander: three long sine waves at random bearings, a few hundred
  // metres long. Set by eye — under 200 m the streets wobble, over 600 m the
  // wander is just a different bearing.
  const rnd = spec.rand;
  const waves = Array.from({ length: 3 }, () => {
    const a = rnd() * TAU, L = 260 + rnd() * 300;
    return { kx: (Math.cos(a) * TAU) / L, ky: (Math.sin(a) * TAU) / L, ph: rnd() * TAU };
  });
  const wander = (p) => (Math.sin(p[0] * waves[0].kx + p[1] * waves[0].ky + waves[0].ph)
    + 0.7 * Math.sin(p[0] * waves[1].kx + p[1] * waves[1].ky + waves[1].ph)
    + 0.5 * Math.sin(p[0] * waves[2].kx + p[1] * waves[2].ky + waves[2].ph)) / 2.2;

  // A district's grid direction (the short-spaced family, i.e. the STREETS
  // the long block faces front) from its compass bearing of the avenues:
  // avenues run at map angle 90 - bearing, streets cross them.
  const gridAng = spec.districts.map((d) => ((90 - d.bearingDeg) * Math.PI) / 180 + Math.PI / 2);

  // Reference direction a district's grid is read against, so a 90-degree
  // turn is not a cancellation (see ALIGN below): the shore + old centre field
  // at the district's own middle.
  const F = spec.founding;
  const oldR = spec.oldR;

  // one basis at a point: accumulate weight * (cos 2t, sin 2t)
  const parks = spec.parks ?? [];
  const blvd = (spec.boulevards ?? []).map((b) => {
    const t = (b.deg * Math.PI) / 180;
    return { ...b, ux: Math.cos(t), uy: Math.sin(t), ang: t };
  });
  const creeks = spec.creeks ?? [];
  const creekSegs = [];
  for (const r of creeks) for (let s = 0; s < r.length; s++) creekSegs.push([r[s], r[(s + 1) % r.length]]);

  const natural = (p, k) => {
    let cx = 0, cy = 0;
    const add = (w, a) => { cx += w * Math.cos(2 * a); cy += w * Math.sin(2 * a); };
    // the shore. WEIGHT 1.6 within ~100 m, falling off by 260 m — set by eye:
    // the first block or two follow the water, as on every harbour front.
    const [ds, as] = shoreAt(p);
    add(1.6 * Math.exp(-((ds / 150) ** 2)), as);
    // the old centre: rings and spokes round the founding point.
    const dF = Math.hypot(p[0] - F[0], p[1] - F[1]);
    const old = Math.exp(-((dF / oldR) ** 2));
    // Faded out over the last ~80 m to the centre: the spokes of a pure radial
    // field all meet in one point, which is a knot of slivers, not a square.
    if (dF > 1) add(1.1 * old * (1 - Math.exp(-((dF / 80) ** 2))), Math.atan2(p[1] - F[1], p[0] - F[0]) + Math.PI / 2);
    // squares: the streets frame them. A round green pulls a ring.
    for (const pk of parks) {
      const d = pk.dist(p);
      // A ROUND green adds nothing: its rings and spokes would meet in a knot
      // of slivers round a 60 m circle. The streets simply stop at its
      // frontage road, as they do at Columbus Circle.
      if (pk.round) continue;
      const w = 2.2 * Math.exp(-((Math.max(0, d) / 110) ** 2));
      if (w < 0.01) continue;
      add(w, pk.ang);
    }
    // boulevards: the streets meet them square on.
    for (const b of blvd) {
      const u = (p[0] - b.cx) * b.ux + (p[1] - b.cy) * b.uy;
      const v = -(p[0] - b.cx) * b.uy + (p[1] - b.cy) * b.ux;
      const over = Math.max(0, Math.abs(u) - b.w / 2);
      const w = 1.8 * Math.exp(-(((Math.abs(v) + over) / 120) ** 2));
      if (w > 0.01) add(w, b.ang);
    }
    // creeks, like a small shore
    if (creekSegs.length) {
      let best = Infinity, ang = 0;
      for (const [a, b] of creekSegs) {
        const ex = b[0] - a[0], ey = b[1] - a[1];
        const L2 = ex * ex + ey * ey || 1;
        let t = ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const d = Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ey * t);
        if (d < best) { best = d; ang = Math.atan2(ey, ex); }
      }
      add(1.2 * Math.exp(-((best / 90) ** 2)), ang);
    }
    return [cx, cy, old];
  };

  // ALIGN. A tensor field cannot tell a grid at 0 degrees from the same grid
  // at 90 — but it reads them as opposites and they cancel. So each district's
  // grid is entered at whichever of its two directions lies nearer the field
  // already there at its middle, and its two pitches swap with it.
  const dAng = gridAng.slice(), dSA = spec.districts.map((d) => d.shortPitch), dSB = spec.districts.map((d) => d.longPitch);
  {
    const sum = Array.from({ length: nd }, () => [0, 0, 0, 0]);
    for (let k = 0; k < N; k++) { const l = label[k]; if (l >= 0) { sum[l][0] += X(k % W); sum[l][1] += Y(Math.floor(k / W)); sum[l][2]++; } }
    for (let l = 0; l < nd; l++) {
      if (!sum[l][2]) continue;
      const c = [sum[l][0] / sum[l][2], sum[l][1] / sum[l][2]];
      const [nx, ny] = natural(c, -1);
      if (Math.hypot(nx, ny) < 0.05) continue;
      const ref = Math.atan2(ny, nx) / 2;
      let diff = ((dAng[l] - ref) % Math.PI + Math.PI) % Math.PI;
      if (diff > Math.PI / 2) diff -= Math.PI;
      if (Math.abs(diff) > Math.PI / 4) {
        dAng[l] += Math.PI / 2;
        [dSA[l], dSB[l]] = [dSB[l], dSA[l]];
      }
    }
  }

  const oldness = new Float32Array(N);
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const p = [X(i), Y(j)];
      let [cx, cy, old] = natural(p, k);
      let ws = 0, a = 0, b = 0;
      for (let l = 0; l < nd; l++) {
        const w0 = dW[l][k];
        if (w0 < 1e-3) continue;
        // a planned extension is held to its survey hardest; the old town
        // least — it was walked into shape before anyone surveyed it
        const firm = spec.districts[l].old ? 0.45 : spec.districts[l].regular ? 1.25 : 0.9;
        const w = w0 * firm;
        cx += w * Math.cos(2 * dAng[l]); cy += w * Math.sin(2 * dAng[l]);
        ws += w0; a += w0 * dSA[l]; b += w0 * dSB[l];
      }
      // THE WANDER is largest in the old town: +-0.38 rad (22 deg) there and
      // +-0.07 (4 deg) in the surveyed ground, set by eye — Boston's North End
      // against the Back Bay.
      const rot = wander(p) * (0.07 + 0.31 * old);
      const t = Math.atan2(cy, cx) / 2 + rot;
      const mag = Math.hypot(cx, cy);
      tx[k] = Math.cos(2 * t) * mag; ty[k] = Math.sin(2 * t) * mag;
      oldness[k] = old;
      if (ws > 1e-3) { sA[k] = a / ws; sB[k] = b / ws; sw[k] = ws; }
    }
  }
  // fill pitch where no district reached (open water round the island)
  let fa = 0, fb = 0, fn = 0;
  for (let k = 0; k < N; k++) if (sw[k] > 0) { fa += sA[k]; fb += sB[k]; fn++; }
  fa = fn ? fa / fn : 90; fb = fn ? fb / fn : 180;
  for (let k = 0; k < N; k++) if (!(sw[k] > 0)) { sA[k] = fa; sB[k] = fb; }

  const at = (arr, p) => {
    const fx = (p[0] - bx0) / CELL, fy = (p[1] - by0) / CELL;
    const i = Math.max(0, Math.min(W - 2, Math.floor(fx))), j = Math.max(0, Math.min(H - 2, Math.floor(fy)));
    const u = Math.max(0, Math.min(1, fx - i)), v = Math.max(0, Math.min(1, fy - j));
    const k = j * W + i;
    return (arr[k] * (1 - u) + arr[k + 1] * u) * (1 - v) + (arr[k + W] * (1 - u) + arr[k + W + 1] * u) * v;
  };
  return {
    W, H, bbox: spec.bbox,
    /** the street direction (the short-spaced family) and the field's strength */
    dir(p) { const cx = at(tx, p), cy = at(ty, p); return [Math.atan2(cy, cx) / 2, Math.hypot(cx, cy)]; },
    /** spacing of the family along `dir` and of the one across it */
    sep(p, fam) { return (fam === 0 ? at(sA, p) : at(sB, p)); },
    oldness(p) { return at(oldness, p); },
    land(p) { return inRing(p, ring); },
    shoreDist(p) { return shoreAt(p)[0]; },
  };
}

/** Separable Gaussian blur, approximated by three box passes each way. */
function blur(a, W, H, sigma) {
  const r = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2));
  const tmp = new Float32Array(a.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let j = 0; j < H; j++) {
      let s = 0;
      const row = j * W;
      for (let i = -r; i <= r; i++) s += a[row + Math.max(0, Math.min(W - 1, i))];
      for (let i = 0; i < W; i++) {
        tmp[row + i] = s / (2 * r + 1);
        s += a[row + Math.min(W - 1, i + r + 1)] - a[row + Math.max(0, i - r)];
      }
    }
    for (let i = 0; i < W; i++) {
      let s = 0;
      for (let j = -r; j <= r; j++) s += tmp[Math.max(0, Math.min(H - 1, j)) * W + i];
      for (let j = 0; j < H; j++) {
        a[j * W + i] = s / (2 * r + 1);
        s += tmp[Math.min(H - 1, j + r + 1) * W + i] - tmp[Math.max(0, j - r) * W + i];
      }
    }
  }
}

// ---------------------------------------------------------- the streamlines

/**
 * Trace the network. Returns polylines `{ pts, fam, major }` in metres.
 *
 * `blocked(p)` is true on ground a street may not enter (water, a park's
 * reservation); `field` is buildField's.
 */
export function traceStreets(field, { blocked, seeds, rand, majorK = 4.2 }) {
  const lines = [];
  // spatial hash of every traced point, per family
  const HC = 16;
  const hash = [new Map(), new Map()];
  const hk = (x, y) => Math.floor(x / HC) * 100003 + Math.floor(y / HC);
  const addPt = (fam, p, id, idx) => {
    const k = hk(p[0], p[1]);
    let b = hash[fam].get(k);
    if (!b) hash[fam].set(k, (b = []));
    b.push(p[0], p[1], id, idx);
  };
  /** nearest same-family point within r, skipping line `self` near index `selfIdx` */
  const near = (fam, p, r, self = -1, selfIdx = 0) => {
    const g = Math.ceil(r / HC);
    const cx = Math.floor(p[0] / HC), cy = Math.floor(p[1] / HC);
    const r2 = r * r;
    for (let gx = cx - g; gx <= cx + g; gx++) {
      for (let gy = cy - g; gy <= cy + g; gy++) {
        const b = hash[fam].get(gx * 100003 + gy);
        if (!b) continue;
        for (let q = 0; q < b.length; q += 4) {
          const dx = b[q] - p[0], dy = b[q + 1] - p[1];
          if (dx * dx + dy * dy >= r2) continue;
          if (b[q + 2] === self && Math.abs(b[q + 3] - selfIdx) < 40) continue;
          return true;
        }
      }
    }
    return false;
  };

  const STEP = 5;           // m; a street bends over tens of metres, 5 m is fine-grained
  const MAXLEN = 6000;
  const dirAt = (p, fam, prev) => {
    const [t, mag] = field.dir(p);
    if (mag < 0.02) return null;                      // a degenerate point: the street stops
    const a = fam === 0 ? t : t + Math.PI / 2;
    let v = [Math.cos(a), Math.sin(a)];
    if (prev && v[0] * prev[0] + v[1] * prev[1] < 0) v = [-v[0], -v[1]];
    return v;
  };
  const sepAt = (p, fam, major) => field.sep(p, fam) * (major ? majorK : 1);

  function integrate(seed, fam, major, sgn, id) {
    const pts = [];
    let p = seed;
    let prev = dirAt(p, fam, null);
    if (!prev) return pts;
    if (sgn < 0) prev = [-prev[0], -prev[1]];
    let len = 0;
    while (len < MAXLEN) {
      // RK2 (midpoint): curvature over 5 m steps is small, RK4 buys nothing
      const v1 = dirAt(p, fam, prev);
      if (!v1) break;
      const mid = [p[0] + v1[0] * STEP / 2, p[1] + v1[1] * STEP / 2];
      const v2 = dirAt(mid, fam, v1);
      if (!v2) break;
      const q = [p[0] + v2[0] * STEP, p[1] + v2[1] * STEP];
      // a sharp turn in one step is a degenerate point, not a street
      if (v2[0] * prev[0] + v2[1] * prev[1] < 0.9) break;
      if (!field.land(q) || blocked(q)) { pts.push(q); break; }      // runs onto the shore or a square: ends there
      // Chen et al. stop a line at half the separation; 0.62 keeps the
      // converging ends from leaving blocks half the size of their neighbours
      // (set by eye, six seeds).
      const dtest = sepAt(q, fam, major) * 0.62;
      if (near(fam, q, dtest, id, pts.length)) { pts.push(q); break; }
      // loops back on itself
      if (pts.length > 60 && pts.slice(0, -40).some((r) => Math.hypot(r[0] - q[0], r[1] - q[1]) < dtest)) break;
      pts.push(q);
      prev = v2;
      p = q;
      len += STEP;
    }
    return pts;
  }

  const queue = [];
  const pushSeed = (p, fam, major) => queue.push({ p, fam, major });
  for (const s of seeds) { pushSeed(s, 0, true); pushSeed(s, 1, true); }

  function trace(seed, fam, major) {
    if (!field.land(seed) || blocked(seed)) return null;
    const dsep = sepAt(seed, fam, major);
    if (near(fam, seed, dsep * 0.92)) return null;
    const id = lines.length;
    const fwd = integrate(seed, fam, major, 1, id);
    const back = integrate(seed, fam, major, -1, id);
    const pts = [...back.reverse(), seed, ...fwd];
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (L < field.sep(seed, 1 - fam) * 0.55) return null;           // a stub shorter than a block is no street
    lines.push({ pts, fam, major });
    pts.forEach((p, i) => addPt(fam, p, id, i));
    // seeds: the same family a spacing either side; the other family along it
    let acc = 0, accO = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const sl = Math.hypot(b[0] - a[0], b[1] - a[1]);
      acc += sl; accO += sl;
      const ex = (b[0] - a[0]) / (sl || 1), ey = (b[1] - a[1]) / (sl || 1);
      const ds = sepAt(b, fam, major);
      if (acc >= ds * 0.5) {
        acc = 0;
        pushSeed([b[0] - ey * ds, b[1] + ex * ds], fam, major);
        pushSeed([b[0] + ey * ds, b[1] - ex * ds], fam, major);
      }
      const dso = sepAt(b, 1 - fam, major);
      if (accO >= dso) { accO = 0; pushSeed(b, 1 - fam, major); }
    }
    return lines[id];
  }

  // ARTERIALS FIRST, then the streets between them (Chen et al. sec. 5).
  for (const major of [true, false]) {
    if (!major) {
      // every point of an arterial seeds the streets, both families
      for (const l of lines) for (let i = 0; i < l.pts.length; i += 6) { pushSeed(l.pts[i], 0, false); pushSeed(l.pts[i], 1, false); }
      for (const s of seeds) { pushSeed(s, 0, false); pushSeed(s, 1, false); }
    }
    let guard = 0;
    while (guard++ < 200000) {
      if (!queue.length) {
        // nothing left in reach: fall back on the fallback seeds, shuffled
        const fb = (major ? [] : field.fallback ?? []).filter((s) => !s.used);
        if (!fb.length) break;
        const s = fb[Math.floor(rand() * fb.length)];
        s.used = true;
        pushSeed(s.p, 0, false); pushSeed(s.p, 1, false);
        continue;
      }
      const s = queue.shift();
      if (s.major !== major) continue;
      trace(s.p, s.fam, major);
    }
  }
  return lines;
}

// --------------------------------------------------------- the planar graph

/** Douglas-Peucker on an open polyline. */
export function simplify(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const a = pts[i0], b = pts[i1];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const L = Math.hypot(ex, ey) || 1;
    let best = -1, bi = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const d = Math.abs((pts[i][0] - a[0]) * ey - (pts[i][1] - a[1]) * ex) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; stack.push([i0, bi], [bi, i1]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function segX(a, b, c, d) {
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den;
  const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return [t, u];
}

/**
 * Node the polylines into a planar graph and return its bounded faces.
 * `lines`: [{ pts, cls }], open polylines; a closed ring repeats its first point.
 * Returns { faces: [{ ring, cls: [per edge] }], segs } — `segs` are the noded
 * edges with their class, for classifying block edges later.
 */
export function polygonize(lines, { snap = 0.6, extend = 0 } = {}) {
  // 1. dangling ends reach forward to meet the next street (Chen et al. 5.3):
  // a street that stopped short of a crossing is extended up to `extend(p)`.
  const segs = [];
  for (let li = 0; li < lines.length; li++) {
    const P = lines[li].pts;
    for (let i = 1; i < P.length; i++) segs.push({ a: P[i - 1], b: P[i], li });
  }
  const G = 40, grid = new Map();
  const gk = (x, y) => Math.floor(x / G) * 100003 + Math.floor(y / G);
  const index = (s, si) => {
    const x0 = Math.min(s.a[0], s.b[0]), x1 = Math.max(s.a[0], s.b[0]);
    const y0 = Math.min(s.a[1], s.b[1]), y1 = Math.max(s.a[1], s.b[1]);
    for (let gx = Math.floor(x0 / G); gx <= Math.floor(x1 / G); gx++) {
      for (let gy = Math.floor(y0 / G); gy <= Math.floor(y1 / G); gy++) {
        const k = gx * 100003 + gy;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(si);
      }
    }
  };
  segs.forEach(index);
  const candidates = (a, b) => {
    const out = new Set();
    const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]);
    const y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
    for (let gx = Math.floor(x0 / G); gx <= Math.floor(x1 / G); gx++) {
      for (let gy = Math.floor(y0 / G); gy <= Math.floor(y1 / G); gy++) {
        for (const si of grid.get(gx * 100003 + gy) ?? []) out.add(si);
      }
    }
    return out;
  };
  if (extend) {
    for (let li = 0; li < lines.length; li++) {
      const L = lines[li];
      if (L.closed || L.pts.length < 2) continue;
      for (const end of [0, 1]) {
        const P = L.pts;
        const e = end ? P[P.length - 1] : P[0];
        const f = end ? P[P.length - 2] : P[1];
        const dx = e[0] - f[0], dy = e[1] - f[1], dl = Math.hypot(dx, dy) || 1;
        const reach = extend(e);
        const far = [e[0] + (dx / dl) * reach, e[1] + (dy / dl) * reach];
        let bestT = Infinity;
        for (const si of candidates(e, far)) {
          const s = segs[si];
          if (s.li === li) continue;
          const x = segX(e, far, s.a, s.b);
          if (x && x[0] > 1e-6 && x[0] < bestT) bestT = x[0];
        }
        if (bestT <= 1) {
          // overshoot a hair so the noding below sees a true crossing
          const t = Math.min(1, bestT + 0.5 / reach);
          const q = [e[0] + (far[0] - e[0]) * t, e[1] + (far[1] - e[1]) * t];
          const s = { a: e, b: q, li };
          segs.push(s); index(s, segs.length - 1);
          if (end) P.push(q); else P.unshift(q);
        }
      }
    }
  }

  // 2. node every crossing: split points per line, by parameter along it
  const cuts = lines.map((L) => L.pts.map(() => []));   // per segment i (from pts[i] to pts[i+1]) a list of t
  const segOf = [];
  for (let li = 0; li < lines.length; li++) for (let i = 1; i < lines[li].pts.length; i++) segOf.push([li, i - 1]);
  // segs[0..segOf.length) align with segOf only for the original segments; recompute from lines
  const all = [];
  for (let li = 0; li < lines.length; li++) {
    const P = lines[li].pts;
    for (let i = 1; i < P.length; i++) all.push({ a: P[i - 1], b: P[i], li, i: i - 1 });
  }
  const grid2 = new Map();
  all.forEach((s, si) => {
    const x0 = Math.min(s.a[0], s.b[0]), x1 = Math.max(s.a[0], s.b[0]);
    const y0 = Math.min(s.a[1], s.b[1]), y1 = Math.max(s.a[1], s.b[1]);
    for (let gx = Math.floor(x0 / G); gx <= Math.floor(x1 / G); gx++) {
      for (let gy = Math.floor(y0 / G); gy <= Math.floor(y1 / G); gy++) {
        const k = gx * 100003 + gy;
        if (!grid2.has(k)) grid2.set(k, []);
        grid2.get(k).push(si);
      }
    }
  });
  for (const list of grid2.values()) {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const s = all[list[x]], q = all[list[y]];
        if (s.li === q.li && Math.abs(s.i - q.i) <= 1) continue;
        const r = segX(s.a, s.b, q.a, q.b);
        if (!r) continue;
        cuts[s.li][s.i].push(r[0]);
        cuts[q.li][q.i].push(r[1]);
      }
    }
  }
  // 3. vertices with snapping, edges between consecutive split points
  const V = [], vgrid = new Map();
  const vid = (p) => {
    const cx = Math.floor(p[0] / snap), cy = Math.floor(p[1] / snap);
    for (let gx = cx - 1; gx <= cx + 1; gx++) {
      for (let gy = cy - 1; gy <= cy + 1; gy++) {
        for (const v of vgrid.get(gx * 1000003 + gy) ?? []) {
          if (Math.hypot(V[v][0] - p[0], V[v][1] - p[1]) <= snap) return v;
        }
      }
    }
    V.push(p);
    const k = cx * 1000003 + cy;
    if (!vgrid.has(k)) vgrid.set(k, []);
    vgrid.get(k).push(V.length - 1);
    return V.length - 1;
  };
  const E = new Map();          // "u,v" (u<v) -> cls
  for (let li = 0; li < lines.length; li++) {
    const P = lines[li].pts;
    let last = null;
    for (let i = 0; i < P.length - 1; i++) {
      const ts = [...new Set(cuts[li][i].map((t) => Math.round(t * 1e6) / 1e6))].sort((a, b) => a - b);
      const a = P[i], b = P[i + 1];
      const pts = [a, ...ts.filter((t) => t > 0 && t < 1).map((t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]), b];
      for (const q of pts) {
        const v = vid(q);
        if (last !== null && last !== v) {
          const key = last < v ? `${last},${v}` : `${v},${last}`;
          if (!E.has(key)) E.set(key, lines[li].cls);
        }
        last = v;
      }
    }
  }
  // 4. adjacency, then prune dangling ends until every vertex closes a face
  const adj = V.map(() => new Set());
  for (const key of E.keys()) { const [u, v] = key.split(",").map(Number); adj[u].add(v); adj[v].add(u); }
  const stack = [];
  for (let v = 0; v < V.length; v++) if (adj[v].size === 1) stack.push(v);
  while (stack.length) {
    const v = stack.pop();
    if (adj[v].size !== 1) continue;
    const [u] = adj[v];
    adj[v].delete(u); adj[u].delete(v);
    if (adj[u].size === 1) stack.push(u);
  }
  // 5. faces: at each vertex sort the neighbours by angle; walking u->v, the
  // next edge is the one just clockwise of v->u (the face on the left).
  const order = adj.map((s, v) => [...s].sort((a, b) =>
    Math.atan2(V[a][1] - V[v][1], V[a][0] - V[v][0]) - Math.atan2(V[b][1] - V[v][1], V[b][0] - V[v][0])));
  const used = new Set();
  const faces = [];
  for (let u = 0; u < V.length; u++) {
    for (const v0 of order[u]) {
      if (used.has(`${u}>${v0}`)) continue;
      const ring = [], cls = [];
      let a = u, b = v0, guard = 0;
      while (!used.has(`${a}>${b}`) && guard++ < 5000) {
        used.add(`${a}>${b}`);
        ring.push(V[a]);
        cls.push(E.get(a < b ? `${a},${b}` : `${b},${a}`));
        const nb = order[b];
        const k = nb.indexOf(a);
        const c = nb[(k - 1 + nb.length) % nb.length];
        a = b; b = c;
      }
      if (ring.length >= 3 && ringAreaSigned(ring) > 1) faces.push({ ring, cls });
    }
  }
  const outSegs = [];
  for (const [key, cls] of E) {
    const [u, v] = key.split(",").map(Number);
    if (adj[u].has(v)) outSegs.push({ a: V[u], b: V[v], cls });
  }
  return { faces, segs: outSegs };
}

// ------------------------------------------------------- faces into blocks

/**
 * A face of the street graph into convex cells, each edge tagged with the
 * class of street it lies on (`null` for a cut this step made, which is an
 * ordinary street too).
 *
 * A gently bent street leaves a face very slightly concave. Cutting a cross
 * street at every such bend would put a junction every forty metres, so a
 * reflex vertex that stands less than `flat` metres off the chord of its
 * neighbours is straightened: the block gives that sliver to the street, which
 * is a metre or two wider there — invisible at the scale of a 15-20 m street.
 * What is still concave after that is cut, from its most reflex corner, along
 * the corner's bisector to the far side — the cross street a surveyor would
 * have run there.
 */
export function convexCells(ring, cls, { flat = 2.2, minArea = 60 } = {}) {
  let R = ring.map((p, i) => ({ p, c: cls[i] }));      // edge i runs R[i] -> R[i+1]
  // straighten slight reflex bends
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  const ccw = ringAreaSigned(ring) > 0;
  const reflex = (i, Rr) => {
    const n = Rr.length;
    const a = Rr[(i - 1 + n) % n].p, b = Rr[i].p, c = Rr[(i + 1) % n].p;
    const x = cross(a, b, c);
    return ccw ? x < -1e-9 : x > 1e-9;
  };
  const height = (i, Rr) => {
    const n = Rr.length;
    const a = Rr[(i - 1 + n) % n].p, b = Rr[i].p, c = Rr[(i + 1) % n].p;
    const ex = c[0] - a[0], ey = c[1] - a[1], L = Math.hypot(ex, ey) || 1;
    return Math.abs((b[0] - a[0]) * ey - (b[1] - a[1]) * ex) / L;
  };
  // also drop collinear-ish vertices (the 5 m streamline steps)
  for (let pass = 0; pass < 400 && R.length > 3; pass++) {
    let best = -1, bh = Infinity;
    for (let i = 0; i < R.length; i++) {
      const h = height(i, R);
      const lim = reflex(i, R) ? flat : 0.35;
      // keep a vertex where the street class changes — it is a junction
      const n = R.length;
      if (R[(i - 1 + n) % n].c !== R[i].c && h > 0.05) continue;
      if (h < lim && h < bh) { bh = h; best = i; }
    }
    if (best < 0) break;
    const n = R.length;
    // the merged edge keeps the class of the longer of the two
    const a = R[(best - 1 + n) % n], b = R[best], c = R[(best + 1) % n];
    const la = Math.hypot(b.p[0] - a.p[0], b.p[1] - a.p[1]), lb = Math.hypot(c.p[0] - b.p[0], c.p[1] - b.p[1]);
    if (lb > la) a.c = b.c;
    R.splice(best, 1);
  }
  const out = [];
  const rec = (Rr, depth) => {
    if (Rr.length < 3) return;
    const pts = Rr.map((x) => x.p);
    const area = Math.abs(ringAreaSigned(pts));
    if (area < minArea) return;
    const loc = ringAreaSigned(pts) > 0;
    let worst = -1, wa = 0;
    for (let i = 0; i < Rr.length; i++) {
      const n = Rr.length;
      const a = Rr[(i - 1 + n) % n].p, b = Rr[i].p, c = Rr[(i + 1) % n].p;
      const x = cross(a, b, c);
      if (loc ? x < -1e-7 : x > 1e-7) {
        const ang = Math.abs(Math.atan2(Math.abs(x), (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1])));
        if (ang > wa) { wa = ang; worst = i; }
      }
    }
    if (worst < 0 || depth > 12) { if (worst < 0) out.push(Rr); return; }
    // cut along the interior bisector from the reflex corner
    const n = Rr.length;
    const a = Rr[(worst - 1 + n) % n].p, b = Rr[worst].p, c = Rr[(worst + 1) % n].p;
    const u1 = norm([b[0] - a[0], b[1] - a[1]]), u2 = norm([b[0] - c[0], b[1] - c[1]]);
    let d = norm([u1[0] + u2[0], u1[1] + u2[1]]);
    if (!Number.isFinite(d[0])) d = loc ? [-u1[1], u1[0]] : [u1[1], -u1[0]];
    const far = [b[0] + d[0] * 1e4, b[1] + d[1] * 1e4];
    let bt = Infinity, be = -1, bu = 0;
    for (let e = 0; e < n; e++) {
      if (e === worst || (e + 1) % n === worst) continue;
      const x = segX(b, far, Rr[e].p, Rr[(e + 1) % n].p);
      if (x && x[0] > 1e-7 && x[0] < bt) { bt = x[0]; be = e; bu = x[1]; }
    }
    if (be < 0) { out.push(Rr); return; }
    const e0 = Rr[be].p, e1 = Rr[(be + 1) % n].p;
    const q = [e0[0] + (e1[0] - e0[0]) * bu, e0[1] + (e1[1] - e0[1]) * bu];
    // piece 1: worst .. be, q ; piece 2: q, be+1 .. worst
    const A = [], B = [];
    for (let k = worst; ; k = (k + 1) % n) { A.push({ ...Rr[k] }); if (k === be) break; }
    A.push({ p: q, c: null });                    // q -> worst is the new cut
    A[A.length - 2] = { ...A[A.length - 2], c: Rr[be].c };
    B.push({ p: q, c: Rr[be].c });
    for (let k = (be + 1) % n; ; k = (k + 1) % n) { B.push({ ...Rr[k] }); if (k === worst) break; }
    B[B.length - 1] = { ...B[B.length - 1], c: null };   // worst -> q is the cut
    rec(A, depth + 1);
    rec(B, depth + 1);
  };
  rec(R, 0);
  return out.map((Rr) => ({ ring: Rr.map((x) => x.p), cls: Rr.map((x) => x.c) }));
}

function norm(v) { const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l]; }
