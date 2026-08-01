// IRONWATER — a river metropolis. A wide river comes down out of the north,
// swings twice, and splits around a long island before it opens into the
// estuary. Two cities grew on the two banks and never agreed on north: the
// west bank runs with the old towpath, the east bank was platted forty years
// later off a different meridian. Where they meet at the bridges the grids
// collide, and that collision is the most valuable ground in town.
import { mulberry32, makeProjection } from "../lib/geom.mjs";
import {
  emitCity, insetBlocks, splitCells, avoidRegion, outsideFaces, inRing, ribbon,
  rectAround, circleRing, polygonArea, isConvex, cleanRing, centroid, dist,
  makeWarp, chaikinOpen, carveCorridor,
} from "../lib/citykit.mjs";
import { convexHull } from "../lib/geom.mjs";

const SEED = 60741;
const rand = mulberry32(SEED);
const rr = (a, b) => a + (b - a) * rand();
const pick = (a) => a[Math.floor(rand() * a.length) % a.length];
const proj = makeProjection(-70.9, 41.1);

// -------------------------------------------------------------------- river
// One centre line, smoothed, thickened into water. Everything else in the city
// is positioned relative to it.
const SPINE = chaikinOpen([
  [-260, 2600], [-190, 2100], [-70, 1700], [180, 1380], [400, 1030],
  [420, 660], [230, 340], [-90, 60], [-330, -260], [-360, -640],
  [-180, -1020], [140, -1330], [560, -1560], [1050, -1760], [1600, -1980],
], 4);
const RIVER = ribbon(SPINE, (t) => 130 + 210 * Math.pow(t, 1.7));   // widens to the estuary

// The island sits in the middle of the second bend.
const ISLAND = (() => {
  const seg = SPINE.slice(Math.round(SPINE.length * 0.46), Math.round(SPINE.length * 0.74));
  return ribbon(seg, (t) => 60 * Math.sin(Math.PI * Math.min(1, Math.max(0, t))) + 18);
})();

// A dock basin cut into the east bank, and a ship canal on the west.
const BASIN = rectAround(980, -520, 620, 300, -12);
const CANAL = ribbon(chaikinOpen([[-1500, 1200], [-1150, 700], [-980, 120], [-1010, -520], [-1180, -1100]], 3), 26);

const WATERS = [RIVER, BASIN, CANAL];
const WATER_HULLS = WATERS.map((w) => convexHull(w));

// -------------------------------------------------------------------- banks
// Which side of the river a point falls on — the sign of the cross product
// against the nearest spine segment.
function bankOf(p) {
  let best = Infinity, side = 1;
  for (let i = 0; i < SPINE.length - 1; i++) {
    const a = SPINE[i], b = SPINE[i + 1];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / (ex * ex + ey * ey)));
    const q = [a[0] + ex * t, a[1] + ey * t];
    const d = dist(p, q);
    if (d < best) { best = d; side = Math.sign(ex * (p[1] - a[1]) - ey * (p[0] - a[0])) || 1; }
  }
  return { side, d: best };
}

// --------------------------------------------------------------- the grids
const cells = [];
function lattice({ bearingDeg, uPitch, wPitch, warpAmp, uRange, wRange, tag }) {
  const WARP = makeWarp(rand ? rr : rr);
  const th = (bearingDeg * Math.PI) / 180;
  const A = [Math.sin(th), Math.cos(th)], S = [Math.cos(th), -Math.sin(th)];
  const at = (u, w) => [u * S[0] + w * A[0], u * S[1] + w * A[1]];
  const U = [], W = [];
  for (let u = uRange[0]; u < uRange[1]; u += uPitch * rr(0.86, 1.18)) U.push(u);
  for (let w = wRange[0]; w < wRange[1]; w += wPitch * rr(0.84, 1.2)) W.push(w);
  const node = U.map((u) => W.map((w) => {
    const b = at(u, w);
    const [dx, dy] = WARP(b[0], b[1], warpAmp);
    return [b[0] + dx + rr(-1.6, 1.6), b[1] + dy + rr(-1.6, 1.6)];
  }));
  for (let i = 0; i < U.length - 1; i++) {
    for (let j = 0; j < W.length - 1; j++) {
      const q = cleanRing([node[i][j], node[i + 1][j], node[i + 1][j + 1], node[i][j + 1]]);
      if (!q || q.length !== 4 || !isConvex(q)) continue;
      cells.push({ ring: q, tag });
    }
  }
}
// West bank: the old town, tight blocks off the towpath meridian.
lattice({ bearingDeg: 14, uPitch: 200, wPitch: 92, warpAmp: 9, uRange: [-2600, 1400], wRange: [-2400, 2400], tag: "west" });
// East bank: platted later, wider blocks, a different north.
lattice({ bearingDeg: -21, uPitch: 232, wPitch: 108, warpAmp: 7, uRange: [-2200, 2600], wRange: [-2600, 2200], tag: "east" });

// The island: one long spine street with short cross blocks.
{
  const out = [];
  splitCells(convexHull(ISLAND), () => rr(3200, 7000), 8, 1400, out, rr);
  for (const c of out) cells.push({ ring: c, tag: "island" });
}

// ------------------------------------------------------------------- claim
const PARKS = [
  rectAround(-1350, 780, 620, 440, 14),      // the west commons
  rectAround(1500, 620, 520, 700, -20),      // east park
  rectAround(-620, -1500, 700, 340, 8),      // the estuary green
  circleRing(150, 520, 120, 24),             // island green
];
const PARK_FACES = PARKS.map((p) => outsideFaces(p, 8));
const WATER_OBST = WATERS.map((w, i) => ({ ring: w, hull: WATER_HULLS[i], faces: outsideFaces(WATER_HULLS[i], 5) }));

const kept = [];
for (const cell of cells) {
  const c0 = centroid(cell.ring);
  if (WATERS.some((w, i) => cell.tag !== "island" && inRing(c0, w))) continue;
  if (cell.tag !== "island" && inRing(c0, ISLAND)) continue;
  // each lattice keeps only its own bank
  const b = bankOf(c0);
  if (cell.tag === "west" && b.side < 0) continue;
  if (cell.tag === "east" && b.side > 0) continue;
  if (Math.hypot(c0[0], c0[1]) > 2900) continue;

  let ring = cell.ring;
  if (cell.tag !== "island") {
    for (const o of WATER_OBST) {
      if (!ring) break;
      if (dist(centroid(ring), centroid(o.hull)) > 3400) continue;
      ring = avoidRegion(ring, o.faces, (p) => inRing(p, o.ring), 300);
    }
  }
  for (let i = 0; i < PARKS.length && ring; i++) {
    if (dist(centroid(ring), centroid(PARKS[i])) > 1300) continue;
    ring = avoidRegion(ring, PARK_FACES[i], (p) => inRing(p, PARKS[i]), 300);
  }
  if (!ring || polygonArea([ring]) < 380) continue;
  kept.push({ ...cell, ring });
}

// Two great avenues run the length of each bank, parallel to the water.
let cut = kept;
for (const [p, deg, hw] of [[[-780, 300], 16, 19], [[900, -200], -19, 19]]) {
  cut = carveCorridor(cut, p, (deg * Math.PI) / 180, hw);
}

// -------------------------------------------------------------- districts
const WEST_STREETS = ["Towpath St", "Foundry Row", "Cutler St", "Gasworks Ln", "Rope Walk", "Old Mint St", "Cinder Way"];
const EAST_STREETS = ["Meridian Row", "Ironwater Ave", "Alcott St", "Pearl Row", "Signal St", "Tannery Ln", "Draper Ave"];
const ISLE_STREETS = ["Isle Row", "Mid-Stream Walk", "Lantern Ln"];

function districtOf(cell) {
  const c = centroid(cell.ring);
  const b = bankOf(c);
  if (cell.tag === "island") return "isle";
  if (b.d < 340) return cell.tag === "west" ? "westquay" : "eastquay";
  if (inRing(c, rectAround(980, -520, 900, 560, -12))) return "basin";
  return cell.tag === "west" ? "westside" : "eastside";
}

const blocks = insetBlocks(
  cut.map((cell) => {
    const d = districtOf(cell);
    return {
      ...cell, district: d,
      street: d === "isle" ? pick(ISLE_STREETS) : cell.tag === "west" ? pick(WEST_STREETS) : pick(EAST_STREETS),
      lane: d === "isle",
    };
  }),
  (cell) => (cell.district === "isle" ? 6 : cell.district.endsWith("quay") ? 9 : 8),
  200,
);

// -------------------------------------------------------------- attributes
const CORES = [
  { xy: [-330, -180], w: 1.0, r: 360 },     // the west bank at the great bridge
  { xy: [420, -420], w: 0.78, r: 340 },     // the east bank opposite
  { xy: [150, 520], w: 0.40, r: 260 },      // the island
  { xy: [-820, 780], w: 0.34, r: 300 },
  { xy: [980, -520], w: 0.30, r: 280 },     // the basin
];
const heat = (p) => Math.min(1, CORES.reduce((h, c) => h + c.w * Math.exp(-(dist(p, c.xy) ** 2) / (2 * c.r * c.r)), 0));

// Bridges: slabs laid across the water at the crossings.
const BRIDGES = [
  { xy: [-120, 30], deg: 42, len: 520 },
  { xy: [280, 800], deg: -70, len: 420 },
  { xy: [-250, -450], deg: 18, len: 460 },
  { xy: [520, -1420], deg: -34, len: 700 },
  { xy: [-1010, 120], deg: 86, len: 120 },
];

emitCity({
  name: "Ironwater", slug: "ironwater", seed: SEED, proj, rand, blocks,
  landRings: [{ outer: [[-5200, -5200], [5200, -5200], [5200, 5200], [-5200, 5200]], holes: WATERS }],
  piers: [
    ...BRIDGES.map((b) => rectAround(b.xy[0], b.xy[1], b.len, 26, b.deg)),
    rectAround(980, -520, 700, 360, -12),
    ...[[-760, -980], [-560, 1500], [1250, -1180]].map(([x, y]) => rectAround(x, y, 150, 46, 20)),
  ],
  parks: PARKS,
  stations: [
    { name: "Bridge Head West", lines: "A C 1", xy: [-330, -180], weight: 100 },
    { name: "Bridge Head East", lines: "A C 2", xy: [420, -420], weight: 88 },
    { name: "Isle Row", lines: "A", xy: [150, 520], weight: 52 },
    { name: "Foundry", lines: "1", xy: [-820, 780], weight: 56 },
    { name: "Old Mint", lines: "1", xy: [-1180, -160], weight: 44 },
    { name: "Meridian Row", lines: "2", xy: [1050, 240], weight: 50 },
    { name: "Dock Basin", lines: "2", xy: [980, -520], weight: 42 },
    { name: "Estuary", lines: "C", xy: [-620, -1500], weight: 34 },
    { name: "East Park", lines: "3", xy: [1500, 620], weight: 36 },
    { name: "West Commons", lines: "3", xy: [-1350, 780], weight: 34 },
    { name: "Draper Ave", lines: "3", xy: [1750, -1050], weight: 28 },
    { name: "North Reach", lines: "C", xy: [-80, 1900], weight: 26 },
  ],
  labels: [
    { name: "WEST BANK", labelKind: "district", xy: [-900, 200] },
    { name: "EAST BANK", labelKind: "district", xy: [1050, -280] },
    { name: "THE ISLE", labelKind: "district", xy: [200, 700] },
    { name: "DOCK BASIN", labelKind: "district", xy: [980, -520] },
    { name: "Ironwater River", labelKind: "water", xy: [-60, 1500] },
    { name: "The Estuary", labelKind: "water", xy: [1300, -2050] },
    { name: "West Commons", labelKind: "park", xy: [-1350, 780] },
    { name: "East Park", labelKind: "park", xy: [1500, 620] },
  ],
  trees: (() => {
    const t = [];
    for (const park of PARKS) {
      const c = centroid(park);
      for (let i = 0; i < 320; i++) {
        const q = [c[0] + rr(-380, 380), c[1] + rr(-330, 330)];
        if (inRing(q, park)) t.push(q);
      }
    }
    // planes along both embankments
    for (const p of RIVER) if (rand() < 0.16) t.push(p);
    return t;
  })(),
  deco: [
    // bridge pylons
    ...BRIDGES.flatMap((b) => {
      const th = (b.deg * Math.PI) / 180;
      return [-1, 1].map((s) => ({
        ring: rectAround(b.xy[0] + s * b.len * 0.3 * Math.cos(th), b.xy[1] + s * b.len * 0.3 * Math.sin(th), 15, 15, b.deg),
        top: 62,
      }));
    }),
    // the clock tower on the west bank and gasholders on the east
    { ring: rectAround(-430, -140, 17, 17, 14), top: 88 },
    ...[[1180, -300], [1290, -420]].map(([x, y]) => ({ ring: circleRing(x, y, 26, 20), top: 30 })),
    // barges on the river
    ...[[-160, 1250, 40], [330, 900, -60], [-320, -820, 20], [900, -1700, -30]].map(([x, y, d]) => ({ ring: rectAround(x, y, 54, 11, d), top: 4 })),
  ],
  heat,
  farFor: (d, h) => Math.round((d.endsWith("quay") ? 15 : d === "isle" ? 9 : d === "basin" ? 8 : 8.5) * 10 + h * h * 210) / 10,
  vacancyP: (d, h) => Math.min(0.82, (d === "basin" ? 0.58 : d === "isle" ? 0.44 : d.endsWith("quay") ? 0.34 : 0.48) * (0.3 + 1.2 * Math.pow(1 - h, 1.5))),
  classTable: (d) => (d.endsWith("quay") ? [["G1", .05], ["O4", .58], ["RM", .74], ["K2", .86], ["D0", 1]]
    : d === "basin" ? [["E9", .56], ["G1", .68], ["K2", .80], ["D0", 1]]
    : d === "isle" ? [["D0", .54], ["O3", .74], ["S1", .90], ["K2", 1]]
    : [["D0", .50], ["S1", .68], ["O3", .82], ["K2", .92], ["E9", 1]]),
  yearFor: (d) => Math.round(d === "isle" ? rr(1840, 1920) : d.startsWith("west") ? rr(1855, 1955) : rr(1890, 2005)),
  skylineFor: ({ district, heat: h, areaM2 }) => {
    const gate = district.endsWith("quay") ? 1 : district === "isle" ? 0.25 : district === "basin" ? 0.1 : 0.4;
    if (areaM2 > 320 && rand() < Math.min(0.3, h * h * 0.62 * gate)) {
      return { floors: rr(16, 26) + h * h * rr(14, 40), coverage: rr(0.46, 0.64), floorH: 3.8 };
    }
    if (district === "basin") return { floors: rr(1.6, 4), coverage: rr(0.6, 0.8), floorH: 5.2 };
    if (district === "isle") return { floors: rr(4, 7), coverage: rr(0.66, 0.84), floorH: 3.5 };
    return { floors: rr(4, 9) + h * 3, coverage: rr(0.6, 0.78), floorH: 3.7 };
  },
  lotOpt: (d) => (d === "basin" ? { target: () => rr(2400, 7000), min: 700, maxDepth: 52, jitter: 4 }
    : d === "isle" ? { target: () => rr(700, 1500), min: 300, maxDepth: 30, jitter: 8 }
    : { target: () => rr(1500, 3600), min: 520, maxDepth: 42, jitter: 6 }),
  fullBlockP: (d) => (d === "basin" ? 0.3 : d.endsWith("quay") ? 0.13 : 0.06),
  landPsf: (h) => 65 + 420 * h,
});
