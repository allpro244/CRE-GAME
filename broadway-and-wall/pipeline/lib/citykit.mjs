// CITYKIT — the machinery every city shares, so a city script is nothing but
// its own geometry.
//
// The rule that keeps a city honest: every block is a CONVEX ring, and the
// blocks come from one continuous partition of the land. Cutting a convex ring
// by a half-plane yields convex pieces that tile it exactly, so nothing can
// overlap and nothing can be left over. The five cities differ only in how
// that first partition is drawn — a polar fan, a canal belt, a contour stack,
// a river-split lattice, an Eixample.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  polygonArea, centroid, bboxOfRing, clipRingHalfPlane,
  isConvex, cleanRing, insetConvex, splitConvex,
  longestEdgeAngle, extentAlong, pointAt, insetRingPerp,
} from "./geom.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const RAW = join(ROOT, "raw");

// ---------------------------------------------------------------- primitives
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

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

// Open polyline smoothing — endpoints stay put (rivers, contours, quays).
export function chaikinOpen(line, iterations) {
  let r = line;
  for (let it = 0; it < iterations; it++) {
    const out = [r[0]];
    for (let i = 0; i < r.length - 1; i++) {
      const a = r[i], b = r[i + 1];
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      out.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    out.push(r[r.length - 1]);
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

export function ringWinding(ring) {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s > 0;
}

export function offsetInward(ring, d) {
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

// A polyline thickened into a closed ribbon — rivers, canals, boulevards.
export function ribbon(line, halfWidth) {
  const left = [], right = [];
  const hw = typeof halfWidth === "function" ? halfWidth : () => halfWidth;
  for (let i = 0; i < line.length; i++) {
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const w = hw(i / (line.length - 1));
    left.push([line[i][0] + nx * w, line[i][1] + ny * w]);
    right.push([line[i][0] - nx * w, line[i][1] - ny * w]);
  }
  return [...left, ...right.reverse()];
}

export function rectAround(cx, cy, w, h, deg = 0) {
  const t = (deg * Math.PI) / 180;
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
    .map(([x, y]) => [x * Math.cos(t) - y * Math.sin(t) + cx, x * Math.sin(t) + y * Math.cos(t) + cy]);
}

export function circleRing(cx, cy, r, n = 40) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

// The half-planes just outside each edge of a convex ring, grown by `grow`.
export function outsideFaces(ring, grow = 0) {
  const ccw = ringWinding(ring);
  const faces = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const len = Math.hypot(ex, ey) || 1;
    const ox = ccw ? ey / len : -ey / len;
    const oy = ccw ? -ex / len : ex / len;
    faces.push([-ox, -oy, -(a[0] * ox + a[1] * oy + grow)]);
  }
  return faces;
}

export function probesOf(ring) {
  const probes = [centroid(ring)];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    for (let k = 0; k < 4; k++) probes.push([a[0] + ((b[0] - a[0]) * k) / 4, a[1] + ((b[1] - a[1]) * k) / 4]);
  }
  return probes;
}

// Trim a convex cell back to the landward side of a boundary ring, segment by
// segment. Only nearby segments are considered so the far shore can't reach
// across the water and cut a block in half.
export function clipToBoundary(ring, boundary, minArea, reachPad = 90) {
  const ccw = ringWinding(boundary);
  let r = ring;
  const c = centroid(ring);
  let reach = 0;
  for (const p of ring) reach = Math.max(reach, dist(p, c));
  for (let i = 0; i < boundary.length && r; i++) {
    const a = boundary[i], b = boundary[(i + 1) % boundary.length];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (dist(mid, c) > reach + reachPad) continue;
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const len = Math.hypot(ex, ey) || 1;
    const ox = ccw ? ey / len : -ey / len;
    const oy = ccw ? -ex / len : ex / len;
    const lim = a[0] * ox + a[1] * oy;
    if (!ring.some(([x, y]) => x * ox + y * oy > lim)) continue;
    r = cleanRing(clipRingHalfPlane(r, ox, oy, lim) ?? []);
    if (!r || !isConvex(r) || polygonArea([r]) < minArea) return null;
  }
  return r;
}

// Push a cell clear of a convex obstacle by trimming it to the outside of the
// single face that keeps the most land. A cell wrapping a corner has no convex
// answer, so that one goes.
export function avoidRegion(ring, faces, hits, minArea) {
  if (!probesOf(ring).some(hits)) return ring;
  let best = null;
  for (const [nx, ny, d] of faces) {
    const t = cleanRing(clipRingHalfPlane(ring, nx, ny, d) ?? []);
    if (!t || !isConvex(t) || polygonArea([t]) < minArea) continue;
    if (probesOf(t).some(hits)) continue;
    if (!best || polygonArea([t]) > polygonArea([best])) best = t;
  }
  return best;
}

// Cut every cell in a set by a straight boulevard: keep both flanks, throw
// away the pavement between them. Exact on convex input.
export function carveCorridor(cells, p, angleRad, halfWidth) {
  const nx = Math.sin(angleRad), ny = -Math.cos(angleRad);   // normal to the run
  const d0 = p[0] * nx + p[1] * ny;
  const out = [];
  for (const cell of cells) {
    const ring = cell.ring ?? cell;
    const a = cleanRing(clipRingHalfPlane(ring, nx, ny, d0 - halfWidth) ?? []);
    const b = cleanRing(clipRingHalfPlane(ring, -nx, -ny, -(d0 + halfWidth)) ?? []);
    for (const piece of [a, b]) {
      if (!piece || piece.length < 3 || !isConvex(piece)) continue;
      if (polygonArea([piece]) < 260) continue;
      out.push(cell.ring ? { ...cell, ring: piece } : piece);
    }
  }
  return out;
}

// Trim cells back to the edge of a curving water body.
//
// The obvious move — treat the river as an obstacle and clip to the outside of
// its convex hull — is wrong, and badly so: the hull of an S-curve is a blob
// the size of the whole map, so every block gets shoved hundreds of metres off
// the bank. That is the most valuable ground in a river city, left as mud.
//
// Instead each cell is cut against the ONE spine segment nearest to it, using
// that segment's local half-width. A half-plane cut on a convex ring is exact
// and keeps it convex, and because a block only ever spans a segment or two,
// the straight-line approximation is invisible.
export function trimToWater(cells, spine, halfWidthAt, minArea = 300) {
  const out = [];
  for (const cell of cells) {
    let ring = cell.ring ?? cell;
    const c = centroid(ring);
    let reach = 0;
    for (const p of ring) reach = Math.max(reach, dist(p, c));

    for (let i = 0; i < spine.length - 1 && ring; i++) {
      const a = spine[i], b = spine[i + 1];
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const L2 = ex * ex + ey * ey || 1;
      const t = Math.max(0, Math.min(1, ((c[0] - a[0]) * ex + (c[1] - a[1]) * ey) / L2));
      const q = [a[0] + ex * t, a[1] + ey * t];
      const w = halfWidthAt((i + t) / (spine.length - 1));
      const d = dist(c, q);
      if (d > w + reach) continue;                    // this segment cannot reach the cell
      const len = Math.sqrt(L2);
      let nx = -ey / len, ny = ex / len;              // unit normal to the run
      const sgn = (c[0] - q[0]) * nx + (c[1] - q[1]) * ny >= 0 ? 1 : -1;
      nx *= sgn; ny *= sgn;                           // point at the cell's own bank
      const lim = q[0] * nx + q[1] * ny + w;          // the waterline on that side
      ring = cleanRing(clipRingHalfPlane(ring, -nx, -ny, -lim) ?? []);
      if (!ring || ring.length < 3 || !isConvex(ring) || polygonArea([ring]) < minArea) { ring = null; break; }
    }
    if (!ring) continue;
    out.push(cell.ring ? { ...cell, ring } : ring);
  }
  return out;
}

export function chamfer(ring, i, cut) {
  const n = ring.length;
  const prev = ring[(i - 1 + n) % n], cur = ring[i], nxt = ring[(i + 1) % n];
  const p1 = [cur[0] + (prev[0] - cur[0]) * cut, cur[1] + (prev[1] - cur[1]) * cut];
  const p2 = [cur[0] + (nxt[0] - cur[0]) * cut, cur[1] + (nxt[1] - cur[1]) * cut];
  return cleanRing(ring.flatMap((pt, j) => (j === i ? [p1, p2] : [pt])));
}

// Shave every corner — the Eixample move. Turns a square into an octagon.
export function chamferAll(ring, cut) {
  const n = ring.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n], cur = ring[i], nxt = ring[(i + 1) % n];
    const lp = dist(prev, cur), ln = dist(nxt, cur);
    out.push([cur[0] + ((prev[0] - cur[0]) * cut) / lp, cur[1] + ((prev[1] - cur[1]) * cut) / lp]);
    out.push([cur[0] + ((nxt[0] - cur[0]) * cut) / ln, cur[1] + ((nxt[1] - cur[1]) * cut) / ln]);
  }
  return cleanRing(out);
}

// Recursive convex splitting to a target area.
export function splitCells(ring, targetArea, jitterDeg, minArea, out, rr, depth = 0) {
  const area = polygonArea([ring]);
  if (depth > 18 || area < minArea * 2 || area <= targetArea()) { out.push(ring); return; }
  const axis = longestEdgeAngle(ring);
  const across = axis + Math.PI / 2;
  const longDir = extentAlong(ring, axis).span >= extentAlong(ring, across).span ? axis : across;
  const cutDir = longDir + Math.PI / 2 + (rr(-jitterDeg, jitterDeg) * Math.PI) / 180;
  const [a, b] = splitConvex(ring, pointAt(ring, longDir, rr(0.4, 0.6)), cutDir);
  if (!a || !b || polygonArea([a]) < minArea || polygonArea([b]) < minArea) { out.push(ring); return; }
  splitCells(a, targetArea, jitterDeg, minArea, out, rr, depth + 1);
  splitCells(b, targetArea, jitterDeg, minArea, out, rr, depth + 1);
}

// Lots front the street: narrow parcels across the block's long axis, with a
// mid-block party line where the block is deep enough.
export function splitLots(ring, opt, out, rr, depth = 0) {
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
  splitLots(a, opt, out, rr, depth + 1);
  splitLots(b, opt, out, rr, depth + 1);
}

// A coherent low-frequency warp — the surveyor's hand, not a random shake.
export function makeWarp(rr) {
  const f = Array.from({ length: 6 }, () => rr(0.0011, 0.0040));
  const p = Array.from({ length: 6 }, () => rr(0, Math.PI * 2));
  return (x, y, amp) => [
    amp * (Math.sin(x * f[0] + y * f[1] + p[0]) + 0.55 * Math.sin(y * f[2] + p[1])),
    amp * (Math.cos(y * f[3] - x * f[4] + p[2]) + 0.55 * Math.cos(x * f[5] + p[3])),
  ];
}

// Smooth value noise — terrain, density fields, contour wobble.
export function makeNoise(rr) {
  const oct = Array.from({ length: 4 }, (_, i) => ({
    fx: rr(0.0007, 0.0016) * (i + 1) * 1.9,
    fy: rr(0.0007, 0.0016) * (i + 1) * 1.9,
    px: rr(0, 7), py: rr(0, 7),
    amp: 1 / (i + 1.3),
  }));
  const norm = oct.reduce((s, o) => s + o.amp, 0);
  return (x, y) => {
    let v = 0;
    for (const o of oct) v += o.amp * Math.sin(x * o.fx + o.px) * Math.cos(y * o.fy + o.py);
    return v / norm;            // roughly -1..1
  };
}

// -------------------------------------------------------------- the emitter
const DEFAULT_CLASSES = {
  core:   [["G1", .04], ["O4", .58], ["RM", .72], ["K2", .83], ["D0", 1]],
  res:    [["D0", .60], ["S1", .79], ["K2", .90], ["RM", 1]],
  works:  [["G1", .12], ["E9", .66], ["K2", .76], ["D0", .90], ["S1", 1]],
  old:    [["O3", .32], ["K2", .55], ["S1", .80], ["D0", 1]],
  water:  [["O4", .50], ["D0", .74], ["RM", .90], ["K2", 1]],
};
export function rollClass(table, r) {
  for (const [cls, p] of table) if (r < p) return cls;
  return table[table.length - 1][0];
}

/**
 * Turn a set of convex blocks into the raw GeoJSON the rest of the pipeline
 * already knows how to eat.
 *
 * blocks: [{ ring, inset, district, street?, numbered?, ordinalSide? }]
 */
export function emitCity(cfg) {
  const {
    name, slug, seed, proj, rand, blocks,
    landRings,            // [{ outer, holes: [] }] — holes read as water
    parks = [], piers = [], deco = [], stations = [], labels = [], trees = [],
    extraPavement = [],   // boulevards and plazas carved OUT of the cells still need a surface
    esplanade = null,     // { coast, inner }
    shoreLines = [],      // extra polylines drawn as streets (quays, embankments)
    heat, farFor, vacancyP, classTable, yearFor, skylineFor, lotOpt,
    fullBlockP = () => 0.08,
    landPsf = (h) => 60 + 380 * h,
  } = cfg;

  const rr = (a, b) => a + (b - a) * rand();
  const parcels = { type: "FeatureCollection", features: [] };
  const buildings = { type: "FeatureCollection", features: [] };
  let blockNo = 1, binNo = 1000001;

  for (const block of blocks) {
    const street = block.inset;
    if (!street || street.length < 3 || polygonArea([street]) < 420) continue;
    const d = block.district;
    let houseNo = Math.round(rr(1, 60));

    const lots = [];
    if (rand() < fullBlockP(d)) lots.push(street);
    else splitLots(street, lotOpt(d), lots, rr);

    let lotNo = 1;
    for (const lotRing of lots) {
      const areaM2 = polygonArea([lotRing]);
      if (areaM2 < 70) continue;
      const lotArea = Math.round(areaM2 * 10.7639);
      const c = centroid(lotRing);
      const h = heat(c);
      const far = farFor(d, h);
      const zoneName = far >= 24 ? "C-8" : far >= 18 ? "C-6" : far >= 12 ? "C-5" : far >= 8 ? "C-4" : "C-2";
      const vacant = rand() < vacancyP(d, h);
      const cls = vacant ? "V1" : rollClass(classTable(d, h), rand());
      const bbl = 1000000000 + blockNo * 10000 + lotNo;
      const yearbuilt = vacant ? 0 : yearFor(d, rand());

      let floors = 0, bldgArea = 0, footprint = null, heightM = 0;
      if (!vacant) {
        const sky = skylineFor({ district: d, heat: h, areaM2, cls, rr, rand });
        floors = Math.max(1, Math.round(sky.floors));
        const coverage = sky.coverage;
        floors = Math.min(floors, Math.max(1, Math.floor(far / coverage)));
        const side = Math.sqrt(areaM2);
        const setback = Math.max(1.4, (side * (1 - Math.sqrt(coverage))) / 2);
        footprint = insetConvex(lotRing, setback) ?? insetConvex(lotRing, 1.4) ?? insetRingPerp(lotRing, 1.1);
        const realCov = footprint ? polygonArea([footprint]) / areaM2 : coverage;
        bldgArea = Math.round(lotArea * realCov * floors);
        heightM = floors * (sky.floorH ?? 3.55) + rr(1, 4);
      }

      const assessland = Math.round(lotArea * landPsf(h) * rr(0.85, 1.15) * 0.45);
      const bldgPsf = cls[0] === "O" ? rr(140, 280) : cls[0] === "D" ? rr(120, 230) : rr(70, 180);
      const assesstot = assessland + Math.round(bldgArea * bldgPsf * 0.45);
      const unitsres = cls[0] === "D" || cls === "S1" || cls === "RM"
        ? Math.max(1, Math.round((bldgArea * (cls === "D0" ? 0.9 : 0.45)) / 900)) : 0;

      const address = block.numbered !== undefined
        ? `${houseNo} ${ordinal(block.numbered, block.ordinalSide)}`
        : `${houseNo} ${block.street}`;

      parcels.features.push({
        type: "Feature",
        id: bbl,
        geometry: { type: "Polygon", coordinates: [[...lotRing.map(proj.toLL), proj.toLL(lotRing[0])]] },
        properties: {
          bbl: String(bbl), borough: "AP", block: String(blockNo), lot: String(lotNo),
          address, zonedist1: zoneName, commfar: far, resfar: far,
          bldgclass: cls, landuse: vacant ? "11" : cls === "G1" ? "10" : cls[0] === "O" ? "05" : "04",
          lotarea: lotArea, bldgarea: bldgArea, numfloors: floors,
          yearbuilt, assessland, assesstot, unitsres,
          cd: slug, district: d,
        },
      });

      if (!vacant && footprint) {
        buildings.features.push({
          type: "Feature", id: binNo,
          geometry: { type: "Polygon", coordinates: [[...footprint.map(proj.toLL), proj.toLL(footprint[0])]] },
          properties: {
            bin: String(binNo++), base_bbl: String(bbl),
            heightroof: +((heightM + (block.podium ?? 0)) * 3.28084).toFixed(1),
            base_ft: block.podium ? +(block.podium * 3.28084).toFixed(1) : 0,
            cnstrct_yr: yearbuilt, groundelev: Math.round(block.podium ?? 0),
          },
        });
      }
      houseNo += Math.round(rr(2, 8));
      lotNo++;
    }
    blockNo++;
  }

  // --- decorative extrusions (non-selectable) -------------------------------
  let decoN = 1;
  for (const dd of deco) {
    buildings.features.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[...dd.ring.map(proj.toLL), proj.toLL(dd.ring[0])]] },
      properties: {
        bin: "deco" + decoN++, base_bbl: "",
        heightroof: +(dd.top * 3.28084).toFixed(1),
        base_ft: dd.base ? +(dd.base * 3.28084).toFixed(1) : 0,
        cnstrct_yr: 1990,
      },
    });
  }

  // --- context --------------------------------------------------------------
  // The cell is the block PLUS its half of the surrounding street, and the
  // cells tile the land exactly — so painting the cells as pavement and the
  // insets back over them as blocks yields the street network for free, with
  // two real curbs instead of a hairline. The cell ring is shared by
  // neighbouring cells, which makes it the centre of the street as well.
  const pavementFeatures = [...blocks.map((b) => b.ring), ...extraPavement].map((ring) => ({
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [[...ring.map(proj.toLL), proj.toLL(ring[0])]] },
    properties: { kind: "pavement" },
  }));
  const blockFeatures = blocks.map((b) => ({
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [[...b.inset.map(proj.toLL), proj.toLL(b.inset[0])]] },
    properties: { kind: "block" },
  }));
  const centerFeatures = blocks.map((b) => ({
    type: "Feature",
    geometry: { type: "LineString", coordinates: [...b.ring.map(proj.toLL), proj.toLL(b.ring[0])] },
    properties: { kind: "centerline", cls: b.lane ? "lane" : "grid" },
  }));
  const streetFeatures = blocks.map((b) => ({
    type: "Feature",
    geometry: { type: "LineString", coordinates: [...b.inset.map(proj.toLL), proj.toLL(b.inset[0])] },
    properties: { kind: "street", cls: b.lane ? "lane" : "grid" },
  }));
  for (const line of shoreLines) {
    streetFeatures.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: line.map(proj.toLL) },
      properties: { kind: "street", cls: "shore" },
    });
  }

  const contextFeatures = [];
  for (const l of landRings) {
    contextFeatures.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [...l.outer.map(proj.toLL), proj.toLL(l.outer[0])],
          ...(l.holes ?? []).map((hr) => [...hr.slice().reverse().map(proj.toLL), proj.toLL(hr[hr.length - 1])]),
        ],
      },
      properties: { kind: "land" },
    });
  }
  if (esplanade) {
    contextFeatures.push({
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [
          [...esplanade.coast.map(proj.toLL), proj.toLL(esplanade.coast[0])],
          [...esplanade.inner.slice().reverse().map(proj.toLL), proj.toLL(esplanade.inner[esplanade.inner.length - 1])],
        ],
      },
      properties: { kind: "esplanade" },
    });
  }
  for (const ring of piers) {
    contextFeatures.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[...ring.map(proj.toLL), proj.toLL(ring[0])]] },
      properties: { kind: "pier" },
    });
  }
  for (const ring of parks) {
    contextFeatures.push({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[...ring.map(proj.toLL), proj.toLL(ring[0])]] },
      properties: { kind: "park" },
    });
  }
  contextFeatures.push(...pavementFeatures, ...blockFeatures, ...centerFeatures, ...streetFeatures);
  for (const p of trees) {
    contextFeatures.push({ type: "Feature", geometry: { type: "Point", coordinates: proj.toLL(p) }, properties: { kind: "tree" } });
  }
  for (const s of stations) {
    contextFeatures.push({ type: "Feature", geometry: { type: "Point", coordinates: proj.toLL(s.xy) }, properties: { kind: "station", name: s.name } });
  }
  for (const l of labels) {
    contextFeatures.push({ type: "Feature", geometry: { type: "Point", coordinates: proj.toLL(l.xy) }, properties: { kind: "label", labelKind: l.labelKind, name: l.name } });
  }

  const stationsFC = {
    type: "FeatureCollection",
    features: stations.map((s, i) => ({
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

  mkdirSync(RAW, { recursive: true });
  writeFileSync(join(RAW, "parcels.geojson"), JSON.stringify(parcels));
  writeFileSync(join(RAW, "buildings.geojson"), JSON.stringify(buildings));
  writeFileSync(join(RAW, "stations.geojson"), JSON.stringify(stationsFC));
  writeFileSync(join(RAW, "employment.geojson"), JSON.stringify(employment));
  writeFileSync(join(RAW, "context.geojson"), JSON.stringify({ type: "FeatureCollection", features: contextFeatures }));
  writeFileSync(join(RAW, "manifest.json"), JSON.stringify({ source: "fictional", city: name, district: slug, seed, lodes: true }, null, 2));

  const byD = {};
  for (const f of parcels.features) byD[f.properties.district] = (byD[f.properties.district] ?? 0) + 1;
  const vac = parcels.features.filter((f) => !f.properties.bldgarea).length;
  const tallest = parcels.features.reduce((m, f) => Math.max(m, f.properties.numfloors), 0);
  console.log(`${name}: ${parcels.features.length} lots on ${blockNo - 1} blocks (${Math.round(100 * vac / parcels.features.length)}% unbuilt), ${buildings.features.length} buildings, tallest ${tallest} fl.`);
  console.log("  districts:", Object.entries(byD).map(([k, v]) => `${k} ${v}`).join(", "));
  return { parcels, buildings };
}

const SUF = (n) => (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");
function ordinal(n, side) {
  return `${side ? side + " " : ""}${n}${SUF(n)} St`;
}

// Blocks whose rings tile the land exactly; give each one its curb inset.
export function insetBlocks(cells, widthOf, minArea = 150) {
  const out = [];
  for (const cell of cells) {
    const ring = cell.ring ?? cell;
    if (!ring || ring.length < 3 || !isConvex(ring)) continue;
    const w = widthOf(cell);
    let inset = insetConvex(ring, w) ?? insetConvex(ring, w * 0.6) ?? insetConvex(ring, 2.4);
    if (!inset || polygonArea([inset]) < minArea) continue;
    out.push(cell.ring ? { ...cell, inset } : { ring, inset });
  }
  return out;
}

export { polygonArea, centroid, bboxOfRing, clipRingHalfPlane, isConvex, cleanRing, insetConvex, splitConvex, longestEdgeAngle, extentAlong, pointAt };
