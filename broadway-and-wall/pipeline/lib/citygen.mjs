// CITYGEN — one generator, many cities.
//
// The rule this file exists to enforce: THE CITY HAS NO HOLES. Earlier maps
// defined each district as its own box of half-planes and hoped the boxes
// covered the land. They didn't, and every square metre they missed rendered
// as a beige void — land with no blocks, no streets, nothing.
//
// The fix is structural, not cosmetic. Districts are the LEAVES OF A BSP
// TREE: start with the whole plane, cut it with a line, cut each half again,
// and so on. Every leaf is convex (an intersection of half-planes) and the
// leaves partition the plane exactly — that is what a BSP is. Each district
// runs its own lattice across the whole plane and keeps the part inside its
// leaf. A lattice tiles the plane; the leaves tile the plane; therefore the
// clipped cells tile the plane. There is nowhere for a hole to come from.
//
// The second source of holes was obstacles. Parks and the diagonal boulevard
// used to PUSH a cell to one side of themselves, and a cell that wrapped a
// park corner had no convex answer, so a whole 200 m block got dropped. Now a
// cell is DIFFERENCED against the obstacle: for a convex obstacle with faces
// f1..fn, the pieces (outside f1), (inside f1 ∩ outside f2), ... exactly tile
// cell \ obstacle and every piece is convex. Nothing is dropped.
//
// What remains uncovered is only what should be: water, parks, and the
// boulevard — each of which draws its own surface. A rasterized coverage
// metric is computed at the end and printed, so a regression shows up as a
// number instead of as a screenshot somebody has to notice.
import {
  mulberry32, makeProjection, polygonArea, ringArea, centroid,
  insetRing, insetRingPerp, clipRingHalfPlane, bboxOfRing,
  isConvex, cleanRing, splitConvex,
  longestEdgeAngle, extentAlong, pointAt,
} from "./geom.mjs";

// --- small helpers ----------------------------------------------------------

export function chaikin(ring, iterations) {
  let r = ring;
  for (let it = 0; it < iterations; it++) {
    const out = [];
    for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      out.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    r = out;
  }
  return r;
}

// A coastline that isn't a hand-drawn ellipse. Each control edge is split at
// its midpoint and the midpoint pushed off the chord by a seeded amount, twice
// — the same subdivision-with-displacement that makes a fractal coast, kept
// shallow enough that the inward offset for the esplanade never folds on
// itself. Chaikin then rounds what's left, so the result reads as headlands
// and coves rather than as a polygon.
export function crinkle(ring, rand, amp) {
  let r = ring;
  for (let pass = 0; pass < 2; pass++) {
    const a = amp / (pass + 1);
    const out = [];
    for (let i = 0; i < r.length; i++) {
      const p = r[i], q = r[(i + 1) % r.length];
      out.push(p);
      const dx = q[0] - p[0], dy = q[1] - p[1];
      const len = Math.hypot(dx, dy) || 1;
      if (len < 70) continue;
      const off = (rand() * 2 - 1) * Math.min(a, len * 0.22);
      out.push([p[0] + dx / 2 - (dy / len) * off, p[1] + dy / 2 + (dx / len) * off]);
    }
    r = out;
  }
  return r;
}

export function inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function offsetInward(ring, d) {
  const c = centroid(ring);
  return ring.map((p, i) => {
    const a = ring[(i - 1 + ring.length) % ring.length];
    const b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len, ny = dx / len;
    if ((c[0] - p[0]) * nx + (c[1] - p[1]) * ny < 0) { nx = -nx; ny = -ny; }
    return [p[0] + nx * d, p[1] + ny * d];
  });
}

// A rotated rectangle, in metres.
export const rect = (cx, cy, w, h, deg = 0) => {
  const t = (deg * Math.PI) / 180;
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
    .map(([x, y]) => [x * Math.cos(t) - y * Math.sin(t) + cx, x * Math.sin(t) + y * Math.cos(t) + cy]);
};

// The half-planes of a CONVEX ring, oriented so "inside the ring" is
// `n·p <= d` for every one of them. `grow` pushes each face outward, which is
// how a park keeps a street's width of clearance around itself.
function insideFaces(ring, grow = 0) {
  const ccw = ringArea(ring) > 0;
  return ring.map((a, i) => {
    const b = ring[(i + 1) % ring.length];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const len = Math.hypot(ex, ey) || 1;
    const ox = ccw ? ey / len : -ey / len;   // outward normal
    const oy = ccw ? -ex / len : ex / len;
    return [ox, oy, a[0] * ox + a[1] * oy + grow];
  });
}

// cell \ obstacle, as convex pieces that exactly tile the difference.
// A cell that misses the obstacle comes back whole and unsplit — the overlap
// is tested first, because the decomposition below would otherwise shred a
// perfectly good block into slivers just for sitting near a park.
function subtractConvex(cell, faces, minArea) {
  let hit = cell;
  for (const [nx, ny, d] of faces) {
    hit = hit && clipRingHalfPlane(hit, nx, ny, d);
    if (!hit) return [cell];
  }
  if (polygonArea([hit]) < 1) return [cell];

  const pieces = [];
  let rest = cell;
  for (const [nx, ny, d] of faces) {
    if (!rest) break;
    const out = cleanRing(clipRingHalfPlane(rest, -nx, -ny, -d) ?? []);
    if (out && polygonArea([out]) >= minArea) pieces.push(out);
    rest = cleanRing(clipRingHalfPlane(rest, nx, ny, d) ?? []);
  }
  // whatever `rest` still holds is inside the obstacle — the park's, not ours.
  return pieces;
}

// The inset of a convex polygon, done exactly: erode it by intersecting the
// half-planes of its own edges pushed inward. This is Minkowski erosion, and
// on a convex ring the result is always convex and always right — unlike a
// mitered vertex offset, which inverts on acute corners and hands back null.
// That failure is what left whole 170 m cells with no block on them: a
// perfectly good sliver block near a park or a district seam would come back
// as bare pavement because its sharpest corner defeated the miter.
// `dOf(edgeAngle, i)` may differ per edge — that is how avenues end up wider
// than side streets.
function erode(ring, dOf) {
  const ccw = ringArea(ring) > 0;
  let r = ring;
  for (let i = 0; i < ring.length && r; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const len = Math.hypot(ex, ey);
    if (len < 1e-9) continue;
    const ox = ccw ? ey / len : -ey / len;   // outward normal
    const oy = ccw ? -ex / len : ex / len;
    const d = typeof dOf === "function" ? dOf(Math.atan2(ey, ex), i) : dOf;
    r = clipRingHalfPlane(r, ox, oy, a[0] * ox + a[1] * oy - d);
  }
  return r ? cleanRing(r) : null;
}

function chamfer(ring, i, cut) {
  const n = ring.length;
  const prev = ring[(i - 1 + n) % n], cur = ring[i], nxt = ring[(i + 1) % n];
  const p1 = [cur[0] + (prev[0] - cur[0]) * cut, cur[1] + (prev[1] - cur[1]) * cut];
  const p2 = [cur[0] + (nxt[0] - cur[0]) * cut, cur[1] + (nxt[1] - cur[1]) * cut];
  return cleanRing(ring.flatMap((pt, j) => (j === i ? [p1, p2] : [pt])));
}

// --- district flavors -------------------------------------------------------
// A config names a flavor instead of restating twenty numbers. The flavor is
// the economics of the neighbourhood: how finely it plats, how much you may
// build, how much of it is still empty, and whether a tower is thinkable.
export const FLAVOR = {
  core:       { lot: [380, 1050, 170, 32, 7],  far: 15, vac: 0.52, towerGate: 1.0,  maxFloors: 99, yr: [1925, 1960, 0.30, 1960, 2018] },
  old:        { lot: [320, 1050, 150, 27, 14], far: 12, vac: 0.52, towerGate: 0.5,  maxFloors: 14, yr: [1885, 1945, 0.70, 1950, 1990] },
  resi:       { lot: [400, 900, 180, 26, 6],   far: 7,  vac: 0.60, towerGate: 0.03, maxFloors: 7,  yr: [1900, 1950, 0.60, 1955, 1995] },
  industrial: { lot: [800, 2300, 340, 46, 5],  far: 6,  vac: 0.66, towerGate: 0.0,  maxFloors: 5,  yr: [1915, 1978, 1.00, 1915, 1978] },
  modern:     { lot: [430, 1250, 195, 36, 6],  far: 13, vac: 0.74, towerGate: 0.12, maxFloors: 40, yr: [1972, 2024, 1.00, 1972, 2024] },
};

function classFor(flavor, heat, rand) {
  const r = rand();
  switch (flavor) {
    case "industrial":
      if (r < 0.12) return "G1";
      if (r < 0.68) return "E9";
      if (r < 0.76) return "K2";
      if (r < 0.90) return "D0";
      return "S1";
    case "modern":
      if (r < 0.06) return "G1";
      if (r < 0.58) return "O4";
      if (r < 0.78) return "D0";
      return "RM";
    case "old":
      if (r < 0.34) return "O3";
      if (r < 0.56) return "K2";
      if (r < 0.80) return "S1";
      return "D0";
    case "resi":
      if (r < 0.62) return "D0";
      if (r < 0.80) return "S1";
      if (r < 0.90) return "K2";
      return "RM";
    default:
      if (r < 0.04) return "G1";
      if (r < 0.60) return heat > 0.5 ? "O4" : "O3";
      if (r < 0.74) return "RM";
      if (r < 0.84) return "K2";
      return "D0";
  }
}

// ---------------------------------------------------------------------------

export function generateCity(cfg) {
  const rand = mulberry32(cfg.seed);
  const rr = (a, b) => a + (b - a) * rand();
  const pick = (arr) => arr[Math.floor(rand() * arr.length) % arr.length];
  const proj = makeProjection(cfg.center[0], cfg.center[1]);

  const COAST_M = chaikin(crinkle(cfg.coast, rand, cfg.coastAmp ?? 46), cfg.smooth ?? 1);
  const COAST = COAST_M.map(proj.toLL);
  const ESPLANADE_W = cfg.esplanade ?? 26;
  const innerRing = offsetInward(COAST_M, ESPLANADE_W);
  const landBox = bboxOfRing(COAST_M);

  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const coreHeat = (p) => {
    let h = 0;
    for (const c of cfg.cores) h += c.w * Math.exp(-(dist(p, c.xy) ** 2) / (2 * c.r * c.r));
    return Math.min(1, h);
  };

  // --- obstacles ------------------------------------------------------------
  const PARK_CLEAR = 6, DIAG_CLEAR = 2;
  const PARKS_M = cfg.parks.map((p) => rect(p.cx, p.cy, p.w, p.h, p.deg ?? 0));
  const DIAG_M = (cfg.diagonals ?? []).map((d) => rect(d.cx, d.cy, d.w, d.h, d.deg));
  // Every obstacle is subtracted from any cell that meets it, so a cell never
  // has to be thrown away for touching one. The clearance the subtraction
  // leaves is the frontage road around the park — it has to be PAVED, or the
  // park comes ringed in a metre-wide moat of bare ground.
  const APRONS = [
    ...cfg.parks.map((p) => rect(p.cx, p.cy, p.w + 2 * PARK_CLEAR, p.h + 2 * PARK_CLEAR, p.deg ?? 0)),
    ...(cfg.diagonals ?? []).map((d) => rect(d.cx, d.cy, d.w + 2 * DIAG_CLEAR, d.h + 2 * DIAG_CLEAR, d.deg)),
  ];
  const OBSTACLES = [
    ...PARKS_M.map((p) => ({ ring: p, faces: insideFaces(p, PARK_CLEAR) })),
    ...DIAG_M.map((p) => ({ ring: p, faces: insideFaces(p, DIAG_CLEAR) })),
  ];

  // --- the district partition ----------------------------------------------
  // Walk the BSP tree; every leaf carries the half-planes of the path that
  // reached it. Because each cut sends `n·p <= d` one way and `n·p >= d` the
  // other, the leaves are disjoint and their union is the whole plane.
  const leaves = [];
  (function walk(node, hp) {
    if (typeof node === "string") { leaves.push({ district: node, hp }); return; }
    const [nx, ny, d] = node.cut;
    walk(node.neg, [...hp, [nx, ny, d]]);
    walk(node.pos, [...hp, [-nx, -ny, -d]]);
  })(cfg.partition, []);

  const blocks = [];   // { ring, inset|null, district, numbered?, u?, uFifth? }
  const REJECT = {};
  const rej = (k) => { REJECT[k] = (REJECT[k] ?? 0) + 1; };

  const WARP = (() => {
    const f = Array.from({ length: 6 }, () => rr(0.0011, 0.0040));
    const p = Array.from({ length: 6 }, () => rr(0, Math.PI * 2));
    return (x, y, amp) => [
      amp * (Math.sin(x * f[0] + y * f[1] + p[0]) + 0.55 * Math.sin(y * f[2] + p[1])),
      amp * (Math.cos(y * f[3] - x * f[4] + p[2]) + 0.55 * Math.cos(x * f[5] + p[3])),
    ];
  })();

  // The shoreline, bucketed on a coarse grid so a cell only ever tests the
  // handful of segments near it rather than all six hundred.
  const SHORE_CCW = ringArea(innerRing) > 0;
  const SHORE_GRID = 120;
  const shoreBuckets = new Map();
  const skey = (gx, gy) => gx * 100000 + gy;
  for (let i = 0; i < innerRing.length; i++) {
    const a = innerRing[i], b = innerRing[(i + 1) % innerRing.length];
    const [lx, hx] = a[0] < b[0] ? [a[0], b[0]] : [b[0], a[0]];
    const [ly, hy] = a[1] < b[1] ? [a[1], b[1]] : [b[1], a[1]];
    for (let gx = Math.floor(lx / SHORE_GRID); gx <= Math.floor(hx / SHORE_GRID); gx++) {
      for (let gy = Math.floor(ly / SHORE_GRID); gy <= Math.floor(hy / SHORE_GRID); gy++) {
        const k = skey(gx, gy);
        if (!shoreBuckets.has(k)) shoreBuckets.set(k, []);
        shoreBuckets.get(k).push(i);
      }
    }
  }
  const segsCross = (p1, p2, p3, p4) => {
    const d = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
    return d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0;
  };

  function clipToShore(ring, minArea) {
    // Only the shore segments that ACTUALLY RUN THROUGH THIS CELL may cut it.
    // A segment's line is infinite and a real coast is concave, so the line of
    // a segment across the bay will happily slice good dry land two hundred
    // metres inland if you let it. Requiring a genuine crossing is the whole
    // difference between a waterfront and a bare margin along it.
    const [bx0, by0, bx1, by1] = bboxOfRing(ring);
    const cand = new Set();
    for (let gx = Math.floor(bx0 / SHORE_GRID) - 1; gx <= Math.floor(bx1 / SHORE_GRID) + 1; gx++) {
      for (let gy = Math.floor(by0 / SHORE_GRID) - 1; gy <= Math.floor(by1 / SHORE_GRID) + 1; gy++) {
        for (const i of shoreBuckets.get(skey(gx, gy)) ?? []) cand.add(i);
      }
    }
    let r = ring;
    for (const i of cand) {
      if (!r) break;
      const a = innerRing[i], b = innerRing[(i + 1) % innerRing.length];
      let meets = inRing(a, ring) || inRing(b, ring);
      for (let k = 0; !meets && k < ring.length; k++) {
        meets = segsCross(a, b, ring[k], ring[(k + 1) % ring.length]);
      }
      if (!meets) continue;
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const len = Math.hypot(ex, ey) || 1;
      const ox = SHORE_CCW ? ey / len : -ey / len;   // outward (seaward)
      const oy = SHORE_CCW ? -ex / len : ex / len;
      const lim = a[0] * ox + a[1] * oy;
      r = cleanRing(clipRingHalfPlane(r, ox, oy, lim) ?? []);
      if (!r || polygonArea([r]) < minArea) return null;
    }
    return r;
  }

  // A cell, resolved into the pieces of it that are actually buildable ground.
  // Returns [] only when the cell is water, another district's, or a park.
  // KEEP is deliberately tiny. A remnant below it is smaller than a parking
  // space; anything above it is kept, and if it is too thin to carry a block
  // it still goes in as pavement. Dropping remnants is how the old generator
  // tore holes along district seams and the waterline.
  const KEEP = 40;
  function claimCell(quad, hp, minArea) {
    let r = quad;
    for (const [nx, ny, d] of hp) r = r && clipRingHalfPlane(r, nx, ny, d);
    r = r && cleanRing(r);
    // no rejection tally here: every district's lattice spans the whole map,
    // so "not mine" is the normal answer, not a failure.
    if (!r || polygonArea([r]) < minArea) return [];
    // No "is this cell at sea?" pre-test. A cell that straddles a crinkled
    // shoreline can have every probe land in water and still hold real ground,
    // and throwing it out on that evidence cost the waterfront a block-deep
    // margin all the way round. The shore clip below plus the centroid test at
    // the end already decide it correctly, so let them.
    r = clipToShore(r, minArea);
    if (!r) { rej("shore"); return []; }

    let pieces = [r];
    for (const obs of OBSTACLES) {
      pieces = pieces.flatMap((pc) => subtractConvex(pc, obs.faces, minArea));
      if (!pieces.length) break;
    }
    const kept = pieces.filter((pc) => isConvex(pc) && polygonArea([pc]) >= minArea && inRing(centroid(pc), innerRing));
    if (!kept.length) rej("obstacle");
    return kept;
  }

  // Turn a claimed cell into a block. A cell too thin to carry a full setback
  // still goes in — as pavement with no block on it, which reads as a wide
  // street rather than as a hole.
  function pushBlock(cell, district, full, streetW, aveW, extra) {
    let inset = erode(cell, (_a, e) => (full && e % 2 === 1 ? aveW / 2 : streetW / 2))
      ?? erode(cell, streetW / 2)
      ?? erode(cell, streetW / 3);
    if (inset && rand() < 0.18) inset = chamfer(inset, Math.floor(rand() * inset.length), rr(0.12, 0.3)) ?? inset;
    if (inset && polygonArea([inset]) < 150) inset = null;
    if (!inset) rej("no-inset");
    blocks.push({ ring: cell, inset, district, ...extra });
  }

  // --- lattice districts ----------------------------------------------------
  // The lattice is built ONCE per district over the whole land, then each of
  // that district's leaves keeps its share. Two leaves of the same district
  // therefore stay in register — the streets line up across the seam.
  function latticeDistrict(name, d) {
    const th = (d.bearingDeg * Math.PI) / 180;
    const A = [Math.sin(th), Math.cos(th)];
    const S = [Math.cos(th), -Math.sin(th)];
    const at = (u, w) => [u * S[0] + w * A[0], u * S[1] + w * A[1]];
    let wMin = Infinity, wMax = -Infinity, uMin = Infinity, uMax = -Infinity;
    for (const p of COAST_M) {
      const w = p[0] * A[0] + p[1] * A[1], u = p[0] * S[0] + p[1] * S[1];
      if (w < wMin) wMin = w; if (w > wMax) wMax = w;
      if (u < uMin) uMin = u; if (u > uMax) uMax = u;
    }
    // pad past the coast so the lattice provably overhangs every leaf
    wMin -= d.stPitch * 1.5; wMax += d.stPitch * 1.5;
    uMin -= d.avePitch * 1.2; uMax += d.avePitch * 1.2;

    const W = [];
    for (let w = wMin; w < wMax + d.stPitch; w += d.stPitch * rr(0.85, 1.18)) W.push(w);
    const U = [];
    for (let u = uMin; u < uMax + d.avePitch; u += d.avePitch * rr(0.82, 1.22)) U.push(u);

    const node = U.map((u) => W.map((w) => {
      const base = at(u, w);
      const [dx, dy] = WARP(base[0], base[1], d.warpAmp);
      return [base[0] + dx + rr(-1.8, 1.8), base[1] + dy + rr(-1.8, 1.8)];
    }));

    const mine = leaves.filter((l) => l.district === name);
    for (let i = 0; i < U.length - 1; i++) {
      for (let j = 0; j < W.length - 1; j++) {
        const quad = cleanRing([node[i][j], node[i + 1][j], node[i + 1][j + 1], node[i][j + 1]]);
        if (!quad || quad.length !== 4 || !isConvex(quad)) { rej("degenerate"); continue; }
        for (const leaf of mine) {
          for (const cell of claimCell(quad, leaf.hp, KEEP)) {
            const full = cell.length === 4 && cell.every((p, k) => p === quad[k]);
            pushBlock(cell, name, full, d.streetW, d.aveW, {
              numbered: d.numbered ? j + 1 : undefined,
              u: (U[i] + U[i + 1]) / 2,
              uFifth: (uMin + uMax) / 2,
            });
          }
        }
      }
    }
  }

  // --- organic districts ----------------------------------------------------
  // The colonial quarter: recursive convex splitting from the leaf itself.
  // Splitting a convex ring by a line is an exact partition, so this fills its
  // leaf with no more gaps than the lattice does.
  function splitCells(ring, targetArea, jitterDeg, minArea, out, depth = 0) {
    const area = polygonArea([ring]);
    if (depth > 18 || area < minArea * 2 || area <= targetArea()) { out.push(ring); return; }
    const axis = longestEdgeAngle(ring);
    const across = axis + Math.PI / 2;
    const longDir = extentAlong(ring, axis).span >= extentAlong(ring, across).span ? axis : across;
    const cutDir = longDir + Math.PI / 2 + (rr(-jitterDeg, jitterDeg) * Math.PI) / 180;
    const [a, b] = splitConvex(ring, pointAt(ring, longDir, rr(0.4, 0.6)), cutDir);
    if (!a || !b || polygonArea([a]) < minArea || polygonArea([b]) < minArea) { out.push(ring); return; }
    splitCells(a, targetArea, jitterDeg, minArea, out, depth + 1);
    splitCells(b, targetArea, jitterDeg, minArea, out, depth + 1);
  }

  function organicDistrict(name, d) {
    const pad = 400;
    const box = [
      [landBox[0] - pad, landBox[1] - pad], [landBox[2] + pad, landBox[1] - pad],
      [landBox[2] + pad, landBox[3] + pad], [landBox[0] - pad, landBox[3] + pad],
    ];
    for (const leaf of leaves.filter((l) => l.district === name)) {
      let seed = box;
      for (const [nx, ny, dd] of leaf.hp) seed = seed && clipRingHalfPlane(seed, nx, ny, dd);
      seed = seed && cleanRing(seed);
      if (!seed) continue;
      const cells = [];
      splitCells(seed, () => rr(d.cell[0], d.cell[1]), d.jitterDeg ?? 15, 1500, cells);
      for (const c of cells) {
        for (const cell of claimCell(c, [], KEEP)) {
          let ring = cell;
          if (rand() < 0.28) ring = chamfer(ring, Math.floor(rand() * ring.length), rr(0.15, 0.32)) ?? ring;
          pushBlock(ring, name, false, d.streetW, d.streetW, {});
        }
      }
    }
  }

  for (const [name, d] of Object.entries(cfg.districts)) {
    if (d.kind === "organic") organicDistrict(name, d);
    else latticeDistrict(name, d);
  }

  // --- parcels & buildings --------------------------------------------------
  function splitLots(ring, opt, out, depth = 0) {
    const area = polygonArea([ring]);
    if (depth > 16 || area < opt.min * 1.9 || area <= opt.target()) { out.push(ring); return; }
    const axis = longestEdgeAngle(ring);
    const across = axis + Math.PI / 2;
    const spanAlong = extentAlong(ring, axis).span;
    const spanAcross = extentAlong(ring, across).span;
    let dir, p;
    if (spanAcross > opt.maxDepth * 1.8 && spanAcross > spanAlong * 0.55) {
      dir = axis + (rr(-3.5, 3.5) * Math.PI) / 180;
      p = pointAt(ring, across, rr(0.44, 0.56));
    } else {
      dir = across + (rr(-opt.jitter, opt.jitter) * Math.PI) / 180;
      p = pointAt(ring, axis, rr(0.36, 0.64));
    }
    const [a, b] = splitConvex(ring, p, dir);
    if (!a || !b || polygonArea([a]) < opt.min || polygonArea([b]) < opt.min) { out.push(ring); return; }
    splitLots(a, opt, out, depth + 1);
    splitLots(b, opt, out, depth + 1);
  }

  const flavorOf = (name) => FLAVOR[cfg.districts[name].flavor] ?? FLAVOR.core;
  const lotOptOf = (name) => {
    const [t0, t1, min, maxDepth, jitter] = flavorOf(name).lot;
    return { target: () => rr(t0, t1), min, maxDepth, jitter };
  };

  function zoningFor(name, heat) {
    const far = Math.round((flavorOf(name).far + heat * heat * 22) * 10) / 10;
    const z = far >= 24 ? "C-8" : far >= 18 ? "C-6" : far >= 12 ? "C-5" : far >= 8 ? "C-4" : "C-2";
    return { z, commfar: far, resfar: far };
  }
  function vacancyP(name, heat) {
    const edge = Math.pow(1 - heat, 1.5);
    return Math.min(0.88, Math.max(0.2, flavorOf(name).vac * (0.42 + 1.05 * edge)));
  }
  function yearFor(name) {
    const [a0, a1, p, b0, b1] = flavorOf(name).yr;
    return Math.round(rand() < p ? rr(a0, a1) : rr(b0, b1));
  }

  const parcels = { type: "FeatureCollection", features: [] };
  const buildings = { type: "FeatureCollection", features: [] };
  let blockNo = 1, binNo = 1000001;

  for (const block of blocks) {
    const street = block.inset;
    if (!street || polygonArea([street]) < 420) continue;
    const bc = centroid(street);
    const d = block.district;
    const heat = coreHeat(bc);
    let houseNo = Math.round(rr(1, 60));
    const namedStreet = pick(cfg.streets[d] ?? cfg.streets.default);

    const lots = [];
    const fullBlockP = cfg.districts[d].fullBlockP ?? 0.05;
    if (rand() < fullBlockP) lots.push(street);
    else splitLots(street, lotOptOf(d), lots);

    let lotNo = 1;
    for (const lotRing of lots) {
      const areaM2 = polygonArea([lotRing]);
      if (areaM2 < 70) continue;
      const lotArea = Math.round(areaM2 * 10.7639);
      const c = centroid(lotRing);
      const h = coreHeat(c);
      const zone = zoningFor(d, h);
      const vacant = rand() < vacancyP(d, h);
      const cls = vacant ? "V1" : classFor(cfg.districts[d].flavor, h, rand);
      const bbl = 1000000000 + blockNo * 10000 + lotNo;

      const yearbuilt = vacant ? 0 : yearFor(d);
      let floors = 0, bldgArea = 0, footprint = null, heightM = 0;
      if (!vacant) {
        const fl = flavorOf(d);
        const towerP = Math.min(0.085, (h * h * 0.17 + (areaM2 > 1500 ? 0.012 : 0)) * fl.towerGate);
        let coverage;
        if (areaM2 > 240 && rand() < towerP) {
          floors = Math.round(rr(7, 12) + h * h * rr(6, 16));
          coverage = rr(0.46, 0.62);
        } else if (fl.maxFloors > 5 && rand() < 0.18 + h * 0.22) {
          floors = Math.round(rr(3, 6));
          coverage = rr(0.58, 0.74);
        } else {
          floors = Math.round(fl.maxFloors <= 5 ? rr(1, 3) : rr(2, 4));
          coverage = rr(0.6, 0.78);
        }
        floors = Math.min(floors, fl.maxFloors);
        if (cls === "G1") floors = Math.min(floors, 4);
        if (cls === "K2") floors = Math.min(floors, 3);
        if (cls === "E9") floors = Math.min(floors, 4);
        floors = Math.min(floors, Math.max(1, Math.floor(Math.max(zone.commfar, zone.resfar) / coverage)));
        const side = Math.sqrt(areaM2);
        const setback = Math.max(1.5, (side * (1 - Math.sqrt(coverage))) / 2);
        footprint = erode(lotRing, setback) ?? erode(lotRing, 1.5) ?? insetRingPerp(lotRing, 1.2);
        const realCov = footprint ? polygonArea([footprint]) / areaM2 : coverage;
        bldgArea = Math.round(lotArea * realCov * floors);
        heightM = floors * 3.55 + rr(1, 4);
      }

      const landPsfBase = 60 + 380 * h;
      const assessland = Math.round(lotArea * landPsfBase * rr(0.85, 1.15) * 0.45);
      const bldgPsf = cls[0] === "O" ? rr(140, 280) : cls[0] === "D" ? rr(120, 230) : rr(70, 180);
      const assesstot = assessland + Math.round(bldgArea * bldgPsf * 0.45);
      const unitsres = cls[0] === "D" || cls === "S1" || cls === "RM"
        ? Math.max(1, Math.round((bldgArea * (cls === "D0" ? 0.9 : 0.45)) / 900)) : 0;

      let address;
      if (block.numbered !== undefined && rand() < 0.25) {
        address = `${houseNo * 10 + Math.round(rr(0, 9))} ${cfg.avenues[Math.abs(Math.round((block.u - block.uFifth) / 215)) % cfg.avenues.length]}`;
      } else if (block.numbered !== undefined) {
        const n = block.numbered;
        const suf = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
        address = `${houseNo} ${block.u < block.uFifth ? "W" : "E"} ${n}${suf} St`;
      } else {
        address = `${houseNo} ${namedStreet}`;
      }

      parcels.features.push({
        type: "Feature",
        id: bbl,
        geometry: { type: "Polygon", coordinates: [[...lotRing.map(proj.toLL), proj.toLL(lotRing[0])]] },
        properties: {
          bbl: String(bbl),
          borough: cfg.abbr ?? "XX", block: String(blockNo), lot: String(lotNo),
          address,
          zonedist1: zone.z, commfar: zone.commfar, resfar: zone.resfar,
          bldgclass: cls, landuse: vacant ? "11" : cls === "G1" ? "10" : cls[0] === "O" ? "05" : "04",
          lotarea: lotArea, bldgarea: bldgArea, numfloors: floors,
          yearbuilt, assessland, assesstot, unitsres,
          cd: cfg.district, district: d,
        },
      });

      if (!vacant && footprint) {
        buildings.features.push({
          type: "Feature",
          id: binNo,
          geometry: { type: "Polygon", coordinates: [[...footprint.map(proj.toLL), proj.toLL(footprint[0])]] },
          properties: {
            bin: String(binNo++),
            base_bbl: String(bbl),
            heightroof: +(heightM * 3.28084).toFixed(1),
            cnstrct_yr: yearbuilt,
            groundelev: Math.round(rr(3, 20)),
          },
        });
      }
      houseNo += Math.round(rr(2, 8));
      lotNo++;
    }
    blockNo++;
  }

  // --- decorative waterfront ------------------------------------------------
  const PIERS_M = cfg.piers ?? [];
  let decoN = 1;
  function addDeco(ringM, topM, baseM = 0) {
    buildings.features.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[...ringM.map(proj.toLL), proj.toLL(ringM[0])]] },
      properties: {
        bin: "deco" + decoN++, base_bbl: "",
        heightroof: +(topM * 3.28084).toFixed(1),
        base_ft: baseM ? +(baseM * 3.28084).toFixed(1) : 0,
        cnstrct_yr: 1990,
      },
    });
  }
  for (const pier of PIERS_M.slice(0, 4)) {
    const shed = insetRing(pier, 4);
    if (shed) addDeco(shed, rr(5, 7));
  }
  for (const [cx, cy, deg] of cfg.cranes ?? []) {
    addDeco(rect(cx, cy, 5, 5, deg), 26);
    addDeco(rect(cx + 9 * Math.cos((deg * Math.PI) / 180), cy + 9 * Math.sin((deg * Math.PI) / 180), 24, 3, deg), 25, 22);
  }
  for (const [cx, cy, deg] of cfg.ships ?? []) {
    addDeco(rect(cx, cy, 34, 10, deg), 4);
    addDeco(rect(cx - 9 * Math.cos((deg * Math.PI) / 180), cy - 9 * Math.sin((deg * Math.PI) / 180), 9, 8, deg), 9);
  }
  const BREAKWATERS = (cfg.breakwaters ?? []).map(([cx, cy, w, h, deg]) => rect(cx, cy, w, h, deg));

  // --- context --------------------------------------------------------------
  const drawn = blocks.filter((b) => b.inset);
  const pavementFeatures = blocks.map((b) => ({
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [[...b.ring.map(proj.toLL), proj.toLL(b.ring[0])]] },
    properties: { kind: "pavement", solo: b.inset ? 0 : 1, d: b.district },
  }));
  const blockFeatures = drawn.map((b) => ({
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [[...b.inset.map(proj.toLL), proj.toLL(b.inset[0])]] },
    properties: { kind: "block" },
  }));
  const centerFeatures = blocks.map((b) => ({
    type: "Feature",
    geometry: { type: "LineString", coordinates: [...b.ring.map(proj.toLL), proj.toLL(b.ring[0])] },
    properties: { kind: "centerline", cls: b.u !== undefined ? "grid" : "lane" },
  }));
  const streetFeatures = drawn.map((b) => ({
    type: "Feature",
    geometry: { type: "LineString", coordinates: [...b.inset.map(proj.toLL), proj.toLL(b.inset[0])] },
    properties: { kind: "street", cls: b.u !== undefined ? "grid" : "lane" },
  }));
  const shoreRoad = {
    type: "Feature",
    geometry: { type: "LineString", coordinates: [...innerRing.map(proj.toLL), proj.toLL(innerRing[0])] },
    properties: { kind: "street", cls: "shore" },
  };
  const esplanade = {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [...COAST, COAST[0]],
        [...innerRing.slice().reverse().map(proj.toLL), proj.toLL(innerRing[innerRing.length - 1])],
      ],
    },
    properties: { kind: "esplanade" },
  };
  // THE BACKSTOP. Everything inside the shoreline is paved before a single
  // block is drawn on top of it. If some sliver still escapes the partition it
  // shows up as asphalt between two blocks — which is what a street looks like
  // — instead of as a patch of bare ground.
  const paveland = {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [[...innerRing.map(proj.toLL), proj.toLL(innerRing[0])]] },
    properties: { kind: "paveland" },
  };

  const treeFeatures = [];
  for (const park of PARKS_M) {
    const [minX, minY, maxX, maxY] = bboxOfRing(park);
    for (let x = minX; x < maxX; x += 17) {
      for (let y = minY; y < maxY; y += 17) {
        const p = [x + rr(-6, 6), y + rr(-6, 6)];
        if (inRing(p, park) && rand() < 0.6) treeFeatures.push(p);
      }
    }
  }
  for (let i = 0; i < innerRing.length; i += 3) {
    const p = innerRing[i], q = COAST_M[i];
    if (rand() < 0.5) treeFeatures.push([(p[0] + q[0]) / 2 + rr(-3, 3), (p[1] + q[1]) / 2 + rr(-3, 3)]);
  }

  const stations = {
    type: "FeatureCollection",
    features: cfg.stations.map((s, i) => ({
      type: "Feature", id: i + 1,
      geometry: { type: "Point", coordinates: proj.toLL(s.xy) },
      properties: { stop_name: s.name, daytime_routes: s.lines, weight: s.weight },
    })),
  };

  const jobsByBlock = new Map();
  for (const f of parcels.features) {
    const p = f.properties;
    const jobs = p.bldgclass[0] === "O" ? p.bldgarea / 230
      : p.bldgclass === "E9" ? p.bldgarea / 550
      : p.bldgclass === "K2" ? p.bldgarea / 400
      : p.bldgclass === "RM" || p.bldgclass === "S1" ? p.bldgarea / 700 : 0;
    if (!jobs) continue;
    const cur = jobsByBlock.get(p.block) ?? { jobs: 0, x: 0, y: 0, n: 0 };
    const ring = f.geometry.coordinates[0];
    cur.jobs += jobs;
    cur.x += ring.reduce((s, q) => s + q[0], 0) / ring.length;
    cur.y += ring.reduce((s, q) => s + q[1], 0) / ring.length;
    cur.n++;
    jobsByBlock.set(p.block, cur);
  }
  const employment = {
    type: "FeatureCollection",
    features: [...jobsByBlock.values()].map((b, i) => ({
      type: "Feature", id: i + 1,
      geometry: { type: "Point", coordinates: [b.x / b.n, b.y / b.n] },
      properties: { jobs: Math.round(b.jobs) },
    })),
  };

  const context = {
    type: "FeatureCollection",
    features: [
      { type: "Feature", geometry: { type: "Polygon", coordinates: [[...COAST, COAST[0]]] }, properties: { kind: "land" } },
      esplanade,
      paveland,
      ...[...PIERS_M, ...BREAKWATERS].map((ring) => ({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [[...ring.map(proj.toLL), proj.toLL(ring[0])]] },
        properties: { kind: "pier" },
      })),
      ...PARKS_M.map((ring) => ({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [[...ring.map(proj.toLL), proj.toLL(ring[0])]] },
        properties: { kind: "park" },
      })),
      // The frontage road around each park and along the boulevard. It gets
      // its own kind because it has to be paved UNDER the park, not over it —
      // it is only six metres wider than the park is, so drawing it with the
      // rest of the roadway painted the green out entirely.
      ...APRONS.map((ring) => ({
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [[...ring.map(proj.toLL), proj.toLL(ring[0])]] },
        properties: { kind: "apron" },
      })),
      ...(cfg.diagonals ?? []).map((d) => ({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            proj.toLL([d.cx - (d.w / 2) * Math.cos((d.deg * Math.PI) / 180), d.cy - (d.w / 2) * Math.sin((d.deg * Math.PI) / 180)]),
            proj.toLL([d.cx + (d.w / 2) * Math.cos((d.deg * Math.PI) / 180), d.cy + (d.w / 2) * Math.sin((d.deg * Math.PI) / 180)]),
          ],
        },
        properties: { kind: "street", cls: "shore" },
      })),
      ...pavementFeatures,
      ...blockFeatures,
      ...centerFeatures,
      ...streetFeatures,
      shoreRoad,
      ...treeFeatures.map((p) => ({
        type: "Feature", geometry: { type: "Point", coordinates: proj.toLL(p) }, properties: { kind: "tree" },
      })),
      ...cfg.stations.map((s) => ({
        type: "Feature", geometry: { type: "Point", coordinates: proj.toLL(s.xy) }, properties: { kind: "station", name: s.name },
      })),
      ...cfg.labels.map((l) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: proj.toLL(l.xy) },
        properties: { kind: "label", labelKind: l.labelKind, name: l.name },
      })),
    ],
  };

  const manifest = { source: "fictional", city: cfg.name, district: cfg.district, seed: cfg.seed, lodes: true };

  // --- coverage -------------------------------------------------------------
  // The whole point of the file, measured. Sample the buildable land on a 10 m
  // lattice; a sample is ACCOUNTED FOR if it sits in a block cell, a park, or
  // the boulevard. Anything else is bare ground the player would see as a void.
  const coverage = (() => {
    const STEP = 10;
    const [minX, minY, maxX, maxY] = bboxOfRing(innerRing);
    const GRID = 60;
    const buckets = new Map();
    const key = (gx, gy) => gx * 100000 + gy;
    for (const b of blocks) {
      const [bx0, by0, bx1, by1] = bboxOfRing(b.ring);
      for (let gx = Math.floor(bx0 / GRID); gx <= Math.floor(bx1 / GRID); gx++) {
        for (let gy = Math.floor(by0 / GRID); gy <= Math.floor(by1 / GRID); gy++) {
          const k = key(gx, gy);
          if (!buckets.has(k)) buckets.set(k, []);
          buckets.get(k).push(b.ring);
        }
      }
    }
    let land = 0, covered = 0;
    const voids = [];
    for (let x = minX; x <= maxX; x += STEP) {
      for (let y = minY; y <= maxY; y += STEP) {
        const p = [x, y];
        if (!inRing(p, innerRing)) continue;
        land++;
        const near = buckets.get(key(Math.floor(x / GRID), Math.floor(y / GRID))) ?? [];
        if (near.some((r) => inRing(p, r))) { covered++; continue; }
        if (APRONS.some((r) => inRing(p, r))) { covered++; continue; }
        voids.push(p);
      }
    }
    return { pct: land ? (100 * covered) / land : 100, landM2: land * STEP * STEP, voidM2: voids.length * STEP * STEP, voids };
  })();

  const vac = parcels.features.filter((f) => !f.properties.bldgarea).length;
  const byD = {};
  for (const f of parcels.features) byD[f.properties.district] = (byD[f.properties.district] ?? 0) + 1;

  return {
    parcels, buildings, stations, employment, context, manifest,
    stats: {
      lots: parcels.features.length,
      blocks: blockNo - 1,
      unbuiltPct: Math.round((100 * vac) / Math.max(1, parcels.features.length)),
      buildings: buildings.features.length,
      byDistrict: byD,
      reject: REJECT,
      coverage,
    },
  };
}
