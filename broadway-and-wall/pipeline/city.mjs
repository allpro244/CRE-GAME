// ASHPORT — the game's city. A compact fictional harbor town (~4,000 lots),
// young and growing: a colonial Old Harbor core, an office grid (the
// Exchange), brownstone Northside, the industrial Millside waiting for
// redevelopment, and waterfront tower pads on the Point.
//
// Deterministic (seeded). Emits the same raw-file schema as fetch.mjs /
// synth.mjs, so process.mjs and tiles.mjs consume it unchanged. This is the
// canonical dataset — not a stand-in for real data.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mulberry32, makeProjection, polygonArea, centroid,
  insetRing, insetRingPerp, clipRingHalfPlane, bboxOfRing,
  isConvex, convexHull, cleanRing, insetConvex, splitConvex,
  longestEdgeAngle, extentAlong, pointAt,
} from "./lib/geom.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const RAW = join(ROOT, "raw");
mkdirSync(RAW, { recursive: true });

const SEED = 20250;
const rand = mulberry32(SEED);
const rr = (a, b) => a + (b - a) * rand();
const pick = (arr) => arr[Math.floor(rand() * arr.length) % arr.length];

// Anchor Ashport in open Atlantic water so any online basemap shows clean sea.
const CENTER = [-70.9, 41.1];
const proj = makeProjection(CENTER[0], CENTER[1]);

// Coastline control points in local meters (x east, y north): a harbor
// peninsula with a south-facing bay.
const COAST_RAW = [
  [-1250, 200], [-1290, 500], [-1120, 780],           // west shore
  [-650, 950], [0, 1010], [650, 930],                 // north shore
  [1050, 750], [1260, 400], [1310, 50],               // east shore
  [1210, -300], [900, -480],                          // southeast
  [600, -380], [455, -155], [250, -320],              // the harbor bay
  [-100, -480], [-620, -450], [-1010, -350],          // south shore
];

// Chaikin corner-cutting: geography, not a polygon.
function chaikin(ring, iterations) {
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
const COAST_M = chaikin(COAST_RAW, 2);
const landRing = COAST_M;
const COAST = COAST_M.map(proj.toLL);

// Inward offset of the coast — the buildable boundary. Everything between it
// and the water is the shore esplanade, so the city meets the sea on purpose.
function offsetInward(ring, d) {
  const c = centroid(ring);
  return ring.map((p, i) => {
    const a = ring[(i - 1 + ring.length) % ring.length];
    const b = ring[(i + 1) % ring.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len, ny = dx / len;
    // orient the normal toward the interior
    if ((c[0] - p[0]) * nx + (c[1] - p[1]) * ny < 0) { nx = -nx; ny = -ny; }
    return [p[0] + nx * d, p[1] + ny * d];
  });
}
const ESPLANADE_W = 26;
const innerRing = offsetInward(COAST_M, ESPLANADE_W);

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Activity cores. Harbor Square is THE core — the skyline peaks there and
// tapers away; the back of the map stays low so the drama reads from the bay.
const CORES = [
  { xy: [420, -60], w: 1.0, r: 340 },   // Harbor Square — the summit
  { xy: [140, 180], w: 0.6, r: 380 },   // lower Exchange, shoulder of the peak
  { xy: [980, -30], w: 0.38, r: 250 },  // the Point
  { xy: [-80, 700], w: 0.14, r: 260 },  // North Plaza — background calm
];
function coreHeat(p) {
  let h = 0;
  for (const c of CORES) h += c.w * Math.exp(-(dist(p, c.xy) ** 2) / (2 * c.r * c.r));
  return Math.min(1, h);
}

// --- districts --------------------------------------------------------------
// Old Harbor region: land clipped to a rough pentagon around the bay head.
function clipMany(ring, cuts) {
  let r = ring;
  for (const [nx, ny, d] of cuts) {
    r = r && clipRingHalfPlane(r, nx, ny, d);
  }
  return r;
}
const oldHarborRing = clipMany(innerRing, [
  [0, 1, 240],    // y <= 240
  [-1, 0, -60],   // x >= 60
  [1, 0, 800],    // x <= 800
]);
function inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// (districts are now defined as the convex REGION half-planes below, so a
// cell can be clipped to its district instead of merely tested against it)

// Parks: Founders Park (grid-aligned), Harbor Square, Mill Common.
const TH12 = (12 * Math.PI) / 180;
const rot = ([x, y]) => [x * Math.cos(TH12) - y * Math.sin(TH12), x * Math.sin(TH12) + y * Math.cos(TH12)];
const rectAround = (cx, cy, w, h) =>
  [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(rot).map(([x, y]) => [x + cx, y + cy]);
const PARKS_M = [
  rectAround(30, 520, 480, 260),   // Founders Park
  rectAround(420, -40, 95, 95),    // Harbor Square
  rectAround(-700, 150, 130, 95),  // Mill Common
  rectAround(-250, 820, 150, 90),  // Rowan Green
];
const PIERS_M = [
  [[240, -330], [200, -470], [235, -478], [275, -338]],
  [[380, -300], [355, -450], [390, -458], [415, -308]],
  [[540, -280], [560, -430], [595, -422], [575, -272]],
  [[-300, -470], [-310, -580], [-270, -585], [-260, -474]],
  [[1030, -330], [1120, -430], [1148, -405], [1058, -305]],
  [[-1150, 340], [-1260, 320], [-1263, 355], [-1153, 375]],
];

// Transit: stations drive the demand map (weights ~ ridership).
const STATIONS_M = [
  { name: "Exchange Ct", lines: "1 2 3", xy: [80, 330], weight: 100 },
  { name: "Harbor Square", lines: "1 H", xy: [420, -60], weight: 80 },
  { name: "Custom House", lines: "H", xy: [610, -140], weight: 45 },
  { name: "Ferry Basin", lines: "H", xy: [180, -300], weight: 50 },
  { name: "Founders Park", lines: "2", xy: [-140, 470], weight: 55 },
  { name: "North Plaza", lines: "2 3", xy: [-40, 720], weight: 55 },
  { name: "Rowan Green", lines: "2", xy: [-320, 830], weight: 35 },
  { name: "Beacon & 9th", lines: "3", xy: [420, 560], weight: 40 },
  { name: "The Point", lines: "3", xy: [960, 120], weight: 45 },
  { name: "Spithead", lines: "3", xy: [1100, -220], weight: 25 },
  { name: "Mill Common", lines: "M", xy: [-690, 90], weight: 35 },
  { name: "Foundry Yards", lines: "M", xy: [-950, -120], weight: 25 },
  { name: "West Gate", lines: "M 2", xy: [-520, 420], weight: 30 },
];

// --- street names -----------------------------------------------------------
const AVENUES = ["Broadway", "Meridian Ave", "Commerce Ave", "Beacon Ave", "Cordage Ave", "Harbor Ave", "Garland Ave"];
const OLD_STREETS = [
  "Wall St", "Wharf St", "Chandler Row", "Tidewater St", "Cooper Ln", "Anchorage Rd",
  "Salt St", "Rigging Ln", "Customs Pl", "Bell Slip", "Mariners Walk", "Gullwing Ct",
];
const MILL_STREETS = ["Foundry Rd", "Kiln St", "Freight Ave", "Cinder Row", "Boiler St", "Gantry Way", "Slipway Rd"];
const NORTH_STREETS = ["Elm St", "Ash St", "Rowan St", "Linden St", "Juniper St", "Tamarack St", "Holly St"];
const POINT_STREETS = ["Point Rd", "Breakwater Blvd", "Spindrift Way", "Lighthouse Ave", "Sound View Dr"];

// --- blocks -----------------------------------------------------------------
// Every block in Ashport is a CONVEX cell, and every cell comes from either a
// shared-node lattice (the gridded districts) or recursive splitting of a
// convex seed (Old Harbor). Convexity is the whole trick: a half-plane cut
// through a convex ring yields two convex rings that tile it exactly, so the
// lot subdivision below is a true partition. Nothing overlaps because nothing
// can — the geometry has no way to express an overlap.
const blocks = []; // { ring, inset, district, numbered?, u?, uFifth? }

// Why cells get turned away — printed at the end so the fabric stays tunable.
const REJECT = {};
let lastReject = "?";
const rej = (k) => { REJECT[k] = (REJECT[k] ?? 0) + 1; };

// A coherent low-frequency warp — the surveyor's hand, not a random shake.
// Streets bend over hundreds of meters instead of zigzagging block to block.
const WARP = (() => {
  const f = Array.from({ length: 6 }, () => rr(0.0011, 0.0040));
  const p = Array.from({ length: 6 }, () => rr(0, Math.PI * 2));
  return (x, y, amp) => [
    amp * (Math.sin(x * f[0] + y * f[1] + p[0]) + 0.55 * Math.sin(y * f[2] + p[1])),
    amp * (Math.cos(y * f[3] - x * f[4] + p[2]) + 0.55 * Math.cos(x * f[5] + p[3])),
  ];
})();

// Each district owns a convex region, and the regions are pulled apart from
// one another so a boundary street falls between them. A cell is CLIPPED to
// its district's half-planes rather than discarded — clipping a convex ring by
// a half-plane keeps it convex, and because the regions are disjoint, two
// lattices at different bearings can never both claim the same ground.
const HARBOR_BOX = [240, 60, 800];  // y <= 240, x >= 60, x <= 800
const SEAM = 4;   // districts pull apart by this much; each side then adds
                  // its own street inset, so the seam reads as one avenue
const REGION = {
  millside:  [[1, 0, -450 - SEAM]],
  point:     [[-1, 0, -(820 + SEAM)]],
  northside: [[0, -1, -(560 + SEAM)], [-1, 0, 450 - SEAM], [1, 0, 820 - SEAM]],
  exchange:  [[0, 1, 560 - SEAM], [-1, 0, 450 - SEAM], [1, 0, 820 - SEAM]],
  oldharbor: [[0, 1, HARBOR_BOX[0] - SEAM], [-1, 0, -(HARBOR_BOX[1] + SEAM)], [1, 0, HARBOR_BOX[2] - SEAM]],
};
// Old Harbor's footprint, grown by the seam — no other district may touch it.
function inHarborBox(p) {
  return p[1] <= HARBOR_BOX[0] + SEAM && p[0] >= HARBOR_BOX[1] - SEAM && p[0] <= HARBOR_BOX[2] + SEAM;
}
// A neighbouring cell that runs into Old Harbor gets trimmed back to one side
// of the offending face rather than thrown away — dropping a whole 220 m cell
// tears a void in the fabric. A cell wrapping a corner of the box has no
// convex answer, so that one does go.
const HARBOR_ESCAPES = [
  [0, -1, -(HARBOR_BOX[0] + SEAM)],  // north of it
  [1, 0, HARBOR_BOX[1] - SEAM],      // west of it
  [-1, 0, -(HARBOR_BOX[2] + SEAM)],  // east of it
];

function probesOf(ring) {
  const probes = [centroid(ring)];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    for (let k = 0; k < 4; k++) probes.push([a[0] + ((b[0] - a[0]) * k) / 4, a[1] + ((b[1] - a[1]) * k) / 4]);
  }
  return probes;
}

// The half-planes just OUTSIDE each edge of a convex ring, grown by `grow`.
function outsideFaces(ring, grow = 0) {
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
function ringWinding(ring) {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s > 0;
}

// Push a cell clear of a convex obstacle by trimming it to the outside of
// whichever single face keeps the most land. A cell wrapping a corner of the
// obstacle has no convex answer, so that one is dropped.
function avoidRegion(ring, faces, hits, minArea) {
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

// Trim a cell back to the shoreline rather than dropping it — the city should
// meet the esplanade, not stop a whole block short of it. Only shore segments
// near the cell are considered, so the far side of the bay can't reach across
// and cut it.
const SHORE_CCW = ringWinding(innerRing);
function clipToShore(ring, minArea) {
  let r = ring;
  const c = centroid(ring);
  let reach = 0;
  for (const p of ring) reach = Math.max(reach, Math.hypot(p[0] - c[0], p[1] - c[1]));
  for (let i = 0; i < innerRing.length && r; i++) {
    const a = innerRing[i], b = innerRing[(i + 1) % innerRing.length];
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (Math.hypot(mid[0] - c[0], mid[1] - c[1]) > reach + 90) continue;
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const len = Math.hypot(ex, ey) || 1;
    const ox = SHORE_CCW ? ey / len : -ey / len;   // outward (seaward)
    const oy = SHORE_CCW ? -ex / len : ex / len;
    const lim = a[0] * ox + a[1] * oy;
    if (!ring.some(([x, y]) => x * ox + y * oy > lim)) continue; // wholly landward
    r = cleanRing(clipRingHalfPlane(r, ox, oy, lim) ?? []);
    if (!r || !isConvex(r) || polygonArea([r]) < minArea) return null;
  }
  return r;
}

// Parks hold their ground: a block may come up to the park edge but never
// into it, so every park is ringed by street frontage.
const PARK_FACES = PARKS_M.map((p) => outsideFaces(p, 6));
const inAnyPark = (p) => PARKS_M.some((k) => inRing(p, k));

// Trim a cell to its district, or reject it. Returns the usable ring or null.
function claimCell(ring, district, minArea) {
  let r = ring;
  for (const [nx, ny, d] of REGION[district] ?? []) {
    r = r && clipRingHalfPlane(r, nx, ny, d);
  }
  r = r && cleanRing(r);
  if (!r || !isConvex(r) || polygonArea([r]) < minArea) { lastReject = "region-clip"; return null; }
  // Does the cell touch land at all? A cell that merely straddles the shore
  // keeps the landward part — testing the centroid alone threw away the whole
  // waterfront band, which is exactly where a harbor town's blocks belong.
  if (!probesOf(r).some((p) => inRing(p, innerRing))) { lastReject = "at-sea"; return null; }

  r = clipToShore(r, minArea);
  if (!r) { lastReject = "shore"; return null; }

  if (district !== "oldharbor") {
    r = avoidRegion(r, HARBOR_ESCAPES, inHarborBox, minArea);
    if (!r) { lastReject = "harbor"; return null; }
  }
  for (let i = 0; i < PARKS_M.length && r; i++) {
    const park = PARKS_M[i];
    r = avoidRegion(r, PARK_FACES[i], (p) => inRing(p, park), minArea);
  }
  if (!r) { lastReject = "park"; return null; }

  // clipToShore already trimmed to the waterline; a few metres of overhang
  // into the esplanade between sample edges is invisible, so only the
  // centroid has to be honestly on land.
  if (!inRing(centroid(r), innerRing)) { lastReject = "final-sea"; return null; }
  for (const p of probesOf(r)) {
    if (inAnyPark(p)) { lastReject = "final-park"; return null; }
  }
  return r;
}

// Shave a corner off a convex ring. Only ever removes area, so a chamfered
// cell still sits inside its lattice slot.
function chamfer(ring, i, cut) {
  const n = ring.length;
  const prev = ring[(i - 1 + n) % n], cur = ring[i], nxt = ring[(i + 1) % n];
  const p1 = [cur[0] + (prev[0] - cur[0]) * cut, cur[1] + (prev[1] - cur[1]) * cut];
  const p2 = [cur[0] + (nxt[0] - cur[0]) * cut, cur[1] + (nxt[1] - cur[1]) * cut];
  return cleanRing(ring.flatMap((pt, j) => (j === i ? [p1, p2] : [pt])));
}

// Recursive convex splitting: cut across the long axis, jitter the angle, stop
// at target area. Used for Old Harbor's colonial cells and for lots.
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

// Lots front the street. Cut narrow parcels across the block's long axis, and
// where the block is deep enough, slice the mid-block party line first so the
// lots sit back-to-back the way a real block platted.
function splitLots(ring, opt, out, depth = 0) {
  const area = polygonArea([ring]);
  if (depth > 16 || area < opt.min * 1.9 || area <= opt.target()) { out.push(ring); return; }
  const axis = longestEdgeAngle(ring);
  const across = axis + Math.PI / 2;
  const spanAlong = extentAlong(ring, axis).span;
  const spanAcross = extentAlong(ring, across).span;
  let dir, p;
  if (spanAcross > opt.maxDepth * 1.8 && spanAcross > spanAlong * 0.55) {
    dir = axis + (rr(-3.5, 3.5) * Math.PI) / 180;          // the party line
    p = pointAt(ring, across, rr(0.44, 0.56));
  } else {
    dir = across + (rr(-opt.jitter, opt.jitter) * Math.PI) / 180; // side lot lines
    p = pointAt(ring, axis, rr(0.36, 0.64));
  }
  const [a, b] = splitConvex(ring, p, dir);
  if (!a || !b || polygonArea([a]) < opt.min || polygonArea([b]) < opt.min) { out.push(ring); return; }
  splitLots(a, opt, out, depth + 1);
  splitLots(b, opt, out, depth + 1);
}

const LOT_OPT = {
  exchange:  { target: () => rr(420, 1300), min: 180, maxDepth: 32, jitter: 7 },
  oldharbor: { target: () => rr(360, 1350), min: 155, maxDepth: 27, jitter: 14 },
  northside: { target: () => rr(470, 1120), min: 195, maxDepth: 26, jitter: 6 },
  point:     { target: () => rr(480, 1600), min: 205, maxDepth: 36, jitter: 6 },
  millside:  { target: () => rr(1150, 4100), min: 400, maxDepth: 46, jitter: 5 },
};

// Old Harbor: the colonial fabric. Recursive splitting from a CONVEX seed —
// the hull of the district — with wild cut angles, then anything that spills
// past the shoreline or into a neighbouring district is dropped. The ragged
// edge that leaves along the bay is the point: the town grew to the water.
if (oldHarborRing) {
  const cells = [];
  splitCells(convexHull(oldHarborRing), () => rr(3400, 8200), 15, 1500, cells);
  for (const cell of cells) {
    let ring = claimCell(cell, "oldharbor", 800);
    if (!ring) continue;
    if (rand() < 0.28) ring = chamfer(ring, Math.floor(rand() * ring.length), rr(0.15, 0.32)) ?? ring;
    const inset = insetConvex(ring, rr(3.4, 5)) ?? insetConvex(ring, 2.5); // narrow colonial lanes
    if (!inset || polygonArea([inset]) < 450) continue;
    blocks.push({ ring, inset, district: "oldharbor" });
  }
}

// Gridded districts: a WARPED LATTICE. Neighbouring cells read the same corner
// nodes, so however hard the lattice bends it still tiles the plane exactly —
// no gaps, no overlaps. The blocks come out as skewed quadrilaterals with
// non-parallel sides and gently curving streets, which is the irregularity the
// grid was missing, without giving up the grid's logic.
function latticeDistrict({ bearingDeg, stPitch, avePitch, streetW, aveW, warpAmp, district, numbered }) {
  const th = (bearingDeg * Math.PI) / 180;
  const A = [Math.sin(th), Math.cos(th)];   // across-street axis
  const S = [Math.cos(th), -Math.sin(th)];  // along-street axis
  const at = (u, w) => [u * S[0] + w * A[0], u * S[1] + w * A[1]];
  let wMin = Infinity, wMax = -Infinity, uMin = Infinity, uMax = -Infinity;
  for (const p of landRing) {
    const w = p[0] * A[0] + p[1] * A[1], u = p[0] * S[0] + p[1] * S[1];
    if (w < wMin) wMin = w; if (w > wMax) wMax = w;
    if (u < uMin) uMin = u; if (u > uMax) uMax = u;
  }
  const W = [];
  for (let w = wMin; w < wMax + stPitch; w += stPitch * rr(0.85, 1.18)) W.push(w);
  const U = [];
  for (let u = uMin; u < uMax + avePitch; u += avePitch * rr(0.82, 1.22)) U.push(u);

  const node = U.map((u) => W.map((w) => {
    const base = at(u, w);
    const [dx, dy] = WARP(base[0], base[1], warpAmp);
    return [base[0] + dx + rr(-1.8, 1.8), base[1] + dy + rr(-1.8, 1.8)];
  }));

  for (let i = 0; i < U.length - 1; i++) {
    for (let j = 0; j < W.length - 1; j++) {
      const quad = cleanRing([node[i][j], node[i + 1][j], node[i + 1][j + 1], node[i][j + 1]]);
      if (!quad || quad.length !== 4) { rej("degenerate"); continue; }
      if (!isConvex(quad)) { rej("nonconvex-quad"); continue; }
      const cell = claimCell(quad, district, 300);
      if (!cell) { rej("claim:" + lastReject); continue; }
      // On a full cell, edges 0 and 2 run along the street and 1/3 face the
      // avenue; a clipped cell has picked up a boundary edge, so fall back to
      // the side-street width there.
      const full = cell.length === 4 && cell.every((p, k) => p === quad[k]);
      // A cell trimmed at a district edge or the shore can be too thin to
      // carry a full setback; give it a narrower frontage rather than leaving
      // a block-sized hole in the fabric.
      let inset = insetConvex(cell, (_a, e) => (full && e % 2 === 1 ? aveW / 2 : streetW / 2))
        ?? insetConvex(cell, streetW / 2)
        ?? insetConvex(cell, streetW / 3)
        ?? insetConvex(cell, 2.5);
      if (!inset) { rej("inset-null"); continue; }
      if (rand() < 0.18) inset = chamfer(inset, Math.floor(rand() * inset.length), rr(0.12, 0.3)) ?? inset;
      if (polygonArea([inset]) < 150) { rej("inset-small"); continue; }
      blocks.push({
        ring: cell, inset, district,
        numbered: numbered ? j + 1 : undefined,
        u: (U[i] + U[i + 1]) / 2,
        uFifth: (uMin + uMax) / 2,
      });
    }
  }
}

latticeDistrict({ bearingDeg: 12, stPitch: 76, avePitch: 218, streetW: 15, aveW: 26, warpAmp: 9, district: "exchange", numbered: true });
latticeDistrict({ bearingDeg: 12, stPitch: 64, avePitch: 158, streetW: 13, aveW: 21, warpAmp: 7, district: "northside", numbered: true });
latticeDistrict({ bearingDeg: 20, stPitch: 82, avePitch: 214, streetW: 16, aveW: 26, warpAmp: 11, district: "point", numbered: false });
latticeDistrict({ bearingDeg: -8, stPitch: 102, avePitch: 268, streetW: 18, aveW: 30, warpAmp: 13, district: "millside", numbered: false });

// --- attributes -------------------------------------------------------------
// Fictional-but-plausible zoning, keyed by district and heat.
function zoningFor(district, heat) {
  if (district === "oldharbor") return heat > 0.6
    ? { z: "C-5", commfar: 8, resfar: 6 }
    : { z: "C-4", commfar: 5, resfar: 5 };
  if (district === "exchange") return heat > 0.55
    ? { z: "C-6", commfar: 12, resfar: 8 }
    : { z: "C-4", commfar: 7, resfar: 6 };
  if (district === "point") return { z: "C-5W", commfar: 10, resfar: 10 };
  if (district === "northside") return { z: "R-4", commfar: 2, resfar: 4.5 };
  return { z: "M-1", commfar: 3, resfar: 0 }; // millside — upzoning is a later-phase story
}

// A YOUNG town in 2026: the core is built, the edges are still fields and
// yards. Vacancy climbs steeply with distance from Harbor Square, so the
// player watches the city fill in from the middle out over a century.
function vacancyP(district, heat) {
  const edge = Math.pow(1 - heat, 1.5);   // 0 at the core, ~1 at the fringe
  const base = district === "point" ? 0.60
    : district === "millside" ? 0.55
    : district === "northside" ? 0.48
    : 0.40;                                // the Exchange / Old Harbor core
  return Math.min(0.85, base * (0.3 + 1.2 * edge));
}

// Class mix per district. A young city: Millside and the Point carry real
// vacancy — that land is the development game.
function classFor(district, heat) {
  if (rand() < vacancyP(district, heat)) return "V1";
  const r = rand();
  switch (district) {
    case "millside":
      if (r < 0.12) return "G1";
      if (r < 0.68) return "E9";   // lofts and sheds
      if (r < 0.76) return "K2";
      if (r < 0.90) return "D0";
      return "S1";
    case "point":
      if (r < 0.06) return "G1";
      if (r < 0.58) return "O4";
      if (r < 0.78) return "D0";
      return "RM";
    case "oldharbor":
      if (r < 0.34) return "O3";
      if (r < 0.56) return "K2";
      if (r < 0.80) return "S1";
      return "D0";
    case "northside":
      if (r < 0.62) return "D0";
      if (r < 0.80) return "S1";
      if (r < 0.90) return "K2";
      return "RM";
    default: // exchange
      if (r < 0.04) return "G1";
      if (r < 0.60) return heat > 0.5 ? "O4" : "O3";
      if (r < 0.74) return "RM";
      if (r < 0.84) return "K2";
      return "D0";
  }
}

function yearFor(district) {
  const r = rand();
  switch (district) {
    case "oldharbor": return Math.round(r < 0.7 ? rr(1885, 1945) : rr(1950, 1990));
    case "northside": return Math.round(r < 0.6 ? rr(1900, 1950) : rr(1955, 1995));
    case "millside": return Math.round(rr(1915, 1978));
    case "point": return Math.round(rr(1972, 2024));
    default: return Math.round(r < 0.3 ? rr(1925, 1960) : rr(1960, 2018));
  }
}

const parcels = { type: "FeatureCollection", features: [] };
const buildings = { type: "FeatureCollection", features: [] };
let blockNo = 1, binNo = 1000001;

for (const block of blocks) {
  const gridded = block.u !== undefined;
  const street = block.inset;   // the block behind the curb; lots partition it exactly
  if (!street || polygonArea([street]) < 420) continue;
  const bc = centroid(street);
  const d = block.district;
  const heat = coreHeat(bc);
  let houseNo = Math.round(rr(1, 60));
  const namedStreet =
    d === "oldharbor" ? pick(OLD_STREETS)
    : d === "millside" ? pick(MILL_STREETS)
    : d === "point" ? pick(POINT_STREETS)
    : pick(NORTH_STREETS);

  const lots = [];
  const fullBlockP = d === "exchange" ? 0.10 : d === "point" ? 0.14 : d === "millside" ? 0.20 : 0.03;
  if (rand() < fullBlockP) lots.push(street);
  else splitLots(street, LOT_OPT[d] ?? LOT_OPT.exchange, lots);

  let lotNo = 1;
  for (const lotRing of lots) {
    const areaM2 = polygonArea([lotRing]);
    if (areaM2 < 70) continue;
    const lotArea = Math.round(areaM2 * 10.7639);
    const c = centroid(lotRing);
    const h = coreHeat(c);
    const zone = zoningFor(d, h);
    const cls = classFor(d, h);
    const vacant = cls === "V1";
    const bbl = 1000000000 + blockNo * 10000 + lotNo;

    const yearbuilt = vacant ? 0 : yearFor(d);
    let floors = 0, bldgArea = 0, footprint = null, heightM = 0;
    if (!vacant) {
      // a young skyline that PEAKS AT HARBOR SQUARE: tower odds are gated by
      // district so the tall stuff clusters at the core, not the back rows
      const towerGate = d === "millside" ? 0 : d === "northside" ? 0.06 : d === "point" ? 0.28 : 1;
      const towerP = Math.min(0.24, (h * h * 0.45 + (areaM2 > 1500 ? 0.04 : 0)) * towerGate);
      let coverage;
      if (areaM2 > 240 && rand() < towerP) {
        floors = Math.round(rr(8, 15) + h * rr(3, 9)); // tallest only at the core
        coverage = rr(0.46, 0.62);
      } else if (d !== "millside" && rand() < 0.22 + h * 0.35) {
        floors = Math.round(d === "northside" ? rr(3, 6) : rr(4, 9));
        coverage = rr(0.58, 0.74);
      } else {
        floors = Math.round(d === "millside" ? rr(1, 3) : rr(2, 5));
        coverage = rr(0.6, 0.78);
      }
      if (d === "northside") floors = Math.min(floors, 7);
      if (cls === "G1") floors = Math.min(floors, 4);
      if (cls === "K2") floors = Math.min(floors, 3);
      if (cls === "E9") floors = Math.min(floors, 4);
      if (yearbuilt >= 1961) {
        floors = Math.min(floors, Math.max(1, Math.round(Math.max(zone.commfar, zone.resfar) / coverage)));
      }
      // a real side-yard on EVERY wall. Lots are convex now, so the exact
      // edge-offset inset applies: every wall sits the same distance off its
      // lot line, and neighbouring buildings can't kiss.
      const side = Math.sqrt(areaM2);
      const setback = Math.max(1.5, (side * (1 - Math.sqrt(coverage))) / 2);
      footprint = insetConvex(lotRing, setback)
        ?? insetConvex(lotRing, 1.5)
        ?? insetRingPerp(lotRing, 1.2);
      const realCov = footprint ? polygonArea([footprint]) / areaM2 : coverage;
      bldgArea = Math.round(lotArea * realCov * floors);
      heightM = floors * 3.55 + rr(1, 4);
    }

    // secondary-market pricing: land runs $60–440/sf by heat
    const landPsfBase = 60 + 380 * h;
    const assessland = Math.round(lotArea * landPsfBase * rr(0.85, 1.15) * 0.45);
    const bldgPsf = cls[0] === "O" ? rr(140, 280) : cls[0] === "D" ? rr(120, 230) : rr(70, 180);
    const assesstot = assessland + Math.round(bldgArea * bldgPsf * 0.45);
    const unitsres = cls[0] === "D" || cls === "S1" || cls === "RM"
      ? Math.max(1, Math.round((bldgArea * (cls === "D0" ? 0.9 : 0.45)) / 900)) : 0;

    let address;
    if (block.numbered !== undefined && rand() < 0.25) {
      address = `${houseNo * 10 + Math.round(rr(0, 9))} ${AVENUES[Math.abs(Math.round((block.u - block.uFifth) / 215)) % AVENUES.length]}`;
    } else if (block.numbered !== undefined) {
      const n = block.numbered;
      const suf = n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th";
      address = `${houseNo} ${block.district === "northside" ? "N" : "S"} ${n}${suf} St`;
    } else {
      address = `${houseNo} ${namedStreet}`;
    }

    parcels.features.push({
      type: "Feature",
      id: bbl,
      geometry: { type: "Polygon", coordinates: [[...lotRing.map(proj.toLL), proj.toLL(lotRing[0])]] },
      properties: {
        bbl: String(bbl),
        borough: "AP", block: String(blockNo), lot: String(lotNo),
        address,
        zonedist1: zone.z, commfar: zone.commfar, resfar: zone.resfar,
        bldgclass: cls, landuse: vacant ? "11" : cls === "G1" ? "10" : cls[0] === "O" ? "05" : "04",
        lotarea: lotArea, bldgarea: bldgArea, numfloors: floors,
        yearbuilt, assessland, assesstot, unitsres,
        cd: "ashport", district: d,
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

// --- decorative waterfront (non-selectable extrusions, base_bbl empty) -----
const rect = (cx, cy, w, h, deg = 0) => {
  const t = (deg * Math.PI) / 180;
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
    .map(([x, y]) => [x * Math.cos(t) - y * Math.sin(t) + cx, x * Math.sin(t) + y * Math.cos(t) + cy]);
};
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
// pier sheds
for (const pier of PIERS_M.slice(0, 4)) {
  const shed = insetRing(pier, 4);
  if (shed) addDeco(shed, rr(5, 7));
}
// Millside gantry cranes: mast + jib
for (const [cx, cy, deg] of [[-1080, -180, 20], [-880, -370, -15], [-1180, 220, 80]]) {
  addDeco(rect(cx, cy, 5, 5, deg), 26);
  addDeco(rect(cx + 9 * Math.cos((deg * Math.PI) / 180), cy + 9 * Math.sin((deg * Math.PI) / 180), 24, 3, deg), 25, 22);
}
// moored ships: hull + superstructure
for (const [cx, cy, deg] of [[380, -640, 75], [820, -700, 30], [-350, -700, 100], [1420, -150, -60]]) {
  addDeco(rect(cx, cy, 34, 10, deg), 4);
  addDeco(rect(cx - 9 * Math.cos((deg * Math.PI) / 180), cy - 9 * Math.sin((deg * Math.PI) / 180), 9, 8, deg), 9);
}
// harbor breakwater
const BREAKWATER = rect(760, -560, 190, 14, 35);

// --- streets, esplanade, labels, trees -------------------------------------
// The curb line: the block edge the lots front onto. Drawing this rather than
// the lattice cell keeps the street reading as a paved corridor between two
// curbs instead of a stripe down the middle of nothing.
const streetFeatures = blocks.map((b) => ({
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
const LABELS = [
  { name: "OLD HARBOR", labelKind: "district", xy: [430, -170] },
  { name: "THE EXCHANGE", labelKind: "district", xy: [60, 320] },
  { name: "NORTHSIDE", labelKind: "district", xy: [-80, 770] },
  { name: "MILLSIDE", labelKind: "district", xy: [-800, -20] },
  { name: "THE POINT", labelKind: "district", xy: [1010, 70] },
  { name: "Founders Park", labelKind: "park", xy: [30, 520] },
  { name: "Harbor Square", labelKind: "park", xy: [420, -40] },
  { name: "Mill Common", labelKind: "park", xy: [-700, 150] },
  { name: "Rowan Green", labelKind: "park", xy: [-250, 820] },
  { name: "Ashport Harbor", labelKind: "water", xy: [430, -760] },
  { name: "West River", labelKind: "water", xy: [-1520, 250] },
];
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
// esplanade trees, sparse
for (let i = 0; i < innerRing.length; i += 3) {
  const p = innerRing[i], q = COAST_M[i];
  if (rand() < 0.5) treeFeatures.push([(p[0] + q[0]) / 2 + rr(-3, 3), (p[1] + q[1]) / 2 + rr(-3, 3)]);
}

// --- stations / employment / context ---------------------------------------
const stations = {
  type: "FeatureCollection",
  features: STATIONS_M.map((s, i) => ({
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
    ...[...PIERS_M, BREAKWATER].map((ring) => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[...ring.map(proj.toLL), proj.toLL(ring[0])]] },
      properties: { kind: "pier" },
    })),
    ...PARKS_M.map((ring) => ({
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[...ring.map(proj.toLL), proj.toLL(ring[0])]] },
      properties: { kind: "park" },
    })),
    ...streetFeatures,
    shoreRoad,
    ...treeFeatures.map((p) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: proj.toLL(p) },
      properties: { kind: "tree" },
    })),
    ...STATIONS_M.map((s) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: proj.toLL(s.xy) },
      properties: { kind: "station", name: s.name },
    })),
    ...LABELS.map((l) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: proj.toLL(l.xy) },
      properties: { kind: "label", labelKind: l.labelKind, name: l.name },
    })),
  ],
};

writeFileSync(join(RAW, "parcels.geojson"), JSON.stringify(parcels));
writeFileSync(join(RAW, "buildings.geojson"), JSON.stringify(buildings));
writeFileSync(join(RAW, "stations.geojson"), JSON.stringify(stations));
writeFileSync(join(RAW, "employment.geojson"), JSON.stringify(employment));
writeFileSync(join(RAW, "context.geojson"), JSON.stringify(context));
writeFileSync(join(RAW, "manifest.json"), JSON.stringify({
  source: "fictional", city: "Ashport", district: "ashport", seed: SEED, lodes: true,
}, null, 2));

const byD = {};
for (const f of parcels.features) byD[f.properties.district] = (byD[f.properties.district] ?? 0) + 1;
const vac = parcels.features.filter((f) => !f.properties.bldgarea).length;
console.log(`Ashport: ${parcels.features.length} lots on ${blockNo - 1} blocks (${Math.round(100 * vac / parcels.features.length)}% unbuilt), ${buildings.features.length} buildings.`);
console.log("  districts:", Object.entries(byD).map(([k, v]) => `${k} ${v}`).join(", "));
console.log("  cell rejections:", JSON.stringify(REJECT));
{
  const per = {};
  for (const b of blocks) {
    const d = b.district;
    per[d] = per[d] ?? { cell: 0, inset: 0, n: 0 };
    per[d].cell += polygonArea([b.ring]);
    per[d].inset += polygonArea([b.inset]);
    per[d].n++;
  }
  let tc = 0, ti = 0;
  console.log("  street share WITHIN tiled cells:");
  for (const [d, v] of Object.entries(per)) {
    tc += v.cell; ti += v.inset;
    console.log(`    ${d.padEnd(10)} ${v.n} cells, ${Math.round(v.cell).toLocaleString()} m2 tiled, block ${(100*v.inset/v.cell).toFixed(1)}% / street ${(100*(1-v.inset/v.cell)).toFixed(1)}%`);
  }
  console.log(`    TOTAL      ${Math.round(tc).toLocaleString()} m2 tiled of ~2,925,000 m2 buildable = ${(100*tc/2925216).toFixed(1)}% tiled; untiled void = ${(100-100*tc/2925216).toFixed(1)}%`);
  console.log(`    blocks are ${(100*ti/tc).toFixed(1)}% of tiled area`);
}
