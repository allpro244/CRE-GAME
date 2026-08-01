// VANTAGE — a city built on three hills above a deep bay. The streets do not
// fight the ground: they follow it. Every block sits on its own terrace, held
// up by a retaining wall, and the ring streets are contour lines while the
// cross streets are stairs. Down at the water the land finally flattens and a
// hard commercial grid takes over. Look at it from the bay and the whole thing
// reads as an amphitheatre.
import { mulberry32, makeProjection } from "../lib/geom.mjs";
import {
  emitCity, insetBlocks, avoidRegion, outsideFaces, inRing, rectAround, circleRing,
  polygonArea, isConvex, cleanRing, centroid, dist, makeWarp, makeNoise,
  chaikin, chaikinOpen, offsetInward, clipToBoundary,
} from "../lib/citykit.mjs";
import { clipRingHalfPlane } from "../lib/geom.mjs";

const SEED = 90218;
const rand = mulberry32(SEED);
const rr = (a, b) => a + (b - a) * rand();
const pick = (a) => a[Math.floor(rand() * a.length) % a.length];
const proj = makeProjection(-70.9, 41.1);
const noise = makeNoise(rand);

// ------------------------------------------------------------------ terrain
const HILLS = [
  { xy: [-560, 430], H: 132, s: 470, R: 830, name: "Vantage Hill" },
  { xy: [640, 560], H: 104, s: 400, R: 700, name: "Signal Hill" },
  { xy: [-90, 1180], H: 86, s: 360, R: 600, name: "Kite Hill" },
];
// Height above the quay, in metres. The hills are smooth; the noise only puts
// a wobble in the contours so they read as ground rather than as a compass.
function elev(p) {
  let e = 0;
  for (const h of HILLS) e += h.H * Math.exp(-(dist(p, h.xy) ** 2) / (2 * h.s * h.s));
  return Math.max(0, e + 7 * noise(p[0], p[1]) - 2);
}
const BAND = 7;                       // one terrace every seven metres of rise
const terraceOf = (p) => Math.round(elev(p) / BAND) * BAND;

// -------------------------------------------------------------------- water
const SHORE = chaikinOpen([
  [-2600, -760], [-1900, -700], [-1250, -560], [-700, -430], [-180, -390],
  [340, -430], [860, -560], [1300, -760], [1750, -1010], [2400, -1180], [3000, -1240],
], 3);
const BAY = [...SHORE, [3000, -4200], [-2600, -4200]];
const PIERS = [
  rectAround(-980, -640, 40, 210, 8), rectAround(-560, -520, 40, 200, 3),
  rectAround(-120, -500, 40, 210, -2), rectAround(420, -560, 40, 200, -8),
];

// ------------------------------------------------------------------- blocks
const cells = [];

// Each hill gets a contour fan: ring streets at rising elevations, cross
// streets running straight down the slope. Cells are trapezoids, so convex,
// and consecutive rings share their nodes exactly.
for (const hill of HILLS) {
  const radii = [];
  for (let r = 58, step = 58; r < hill.R; r += step, step *= 1.11) radii.push(r);
  radii.push(hill.R);
  for (let k = 0; k < radii.length - 1; k++) {
    const rIn = radii[k], rOut = radii[k + 1];
    const mid = (rIn + rOut) / 2;
    const n = Math.max(8, Math.round((2 * Math.PI * mid) / rr(84, 112)));
    for (let j = 0; j < n; j++) {
      const a0 = (j / n) * Math.PI * 2 + hill.xy[0] * 0.0004;
      const a1 = ((j + 1) / n) * Math.PI * 2 + hill.xy[0] * 0.0004;
      // the contour wanders — the ring is not a circle, it is a level line
      const wob = (a, r) => r * (1 + 0.085 * noise(hill.xy[0] + r * Math.cos(a) * 2, hill.xy[1] + r * Math.sin(a) * 2));
      const P = (a, r) => [hill.xy[0] + wob(a, r) * Math.cos(a), hill.xy[1] + wob(a, r) * Math.sin(a)];
      const q = cleanRing([P(a0, rIn), P(a0, rOut), P(a1, rOut), P(a1, rIn)]);
      if (!q || q.length !== 4 || !isConvex(q)) continue;
      cells.push({ ring: q, kind: k < 2 ? "crest" : k < radii.length - 3 ? "slopes" : "lower", hill: hill.name });
    }
  }
}

// The flat city at the waterline: a hard commercial grid, a different logic
// entirely, stopped wherever a hill begins.
{
  const WARP = makeWarp(rr);
  const th = (6 * Math.PI) / 180;
  const A = [Math.sin(th), Math.cos(th)], S = [Math.cos(th), -Math.sin(th)];
  const at = (u, w) => [u * S[0] + w * A[0], u * S[1] + w * A[1]];
  const U = [], W = [];
  for (let u = -2000; u < 2200; u += rr(178, 244)) U.push(u);
  for (let w = -1000; w < 1900; w += rr(88, 118)) W.push(w);
  const node = U.map((u) => W.map((w) => {
    const b = at(u, w);
    const [dx, dy] = WARP(b[0], b[1], 8);
    return [b[0] + dx + rr(-1.6, 1.6), b[1] + dy + rr(-1.6, 1.6)];
  }));
  for (let i = 0; i < U.length - 1; i++) {
    for (let j = 0; j < W.length - 1; j++) {
      const q = cleanRing([node[i][j], node[i + 1][j], node[i + 1][j + 1], node[i][j + 1]]);
      if (!q || q.length !== 4 || !isConvex(q)) continue;
      const c = centroid(q);
      if (HILLS.some((h) => dist(c, h.xy) < h.R + 26)) continue;   // the hills own their slopes
      if (dist(c, [0, 2600]) < 700) continue;                       // the reservoir park
      cells.push({ ring: q, kind: elev(c) < 16 ? "quay" : "flats" });
    }
  }
}

// ---------------------------------------------------------------- obstacles
const PARKS = [
  circleRing(-560, 430, 120, 26),          // the crown of Vantage Hill
  circleRing(640, 560, 96, 22),
  rectAround(-1500, 620, 560, 420, 16),    // the west botanic
  rectAround(1560, 200, 420, 620, -6),
  rectAround(0, 2600, 900, 480, 4),        // the reservoir meadow
];
const PARK_FACES = PARKS.map((p) => outsideFaces(p, 8));

const LANDMASK = [...SHORE, [3000, 4200], [-2600, 4200]];
const kept = [];
for (const cell of cells) {
  // the reach test in clipToBoundary only looks at nearby shore segments, so a
  // cell sitting well out in the bay is never touched by it — check the
  // centroid honestly before trusting the clip
  if (!inRing(centroid(cell.ring), LANDMASK)) continue;
  let ring = clipToBoundary(cell.ring, LANDMASK, 300, 400);
  if (!ring) continue;
  for (let i = 0; i < PARKS.length && ring; i++) {
    if (dist(centroid(ring), centroid(PARKS[i])) > 1400) continue;
    ring = avoidRegion(ring, PARK_FACES[i], (p) => inRing(p, PARKS[i]), 280);
  }
  if (!ring || polygonArea([ring]) < 340) continue;
  const c = centroid(ring);
  if (Math.abs(c[0]) > 2700 || c[1] > 3100) continue;
  kept.push({ ...cell, ring, podium: terraceOf(c) });
}

const HILL_STREETS = ["Cordillera Way", "Ladder St", "Belvedere Row", "Terrace Walk", "Switchback Rd", "Cablecar Ave", "Overlook Ln", "Sunset Steps"];
const FLAT_STREETS = ["Cannery Row", "Front St", "Embarcadero", "Bunker Ave", "Mission St", "Ferry Landing", "Battery St"];

const blocks = insetBlocks(
  kept.map((cell) => ({
    ...cell,
    district: cell.kind,
    street: cell.kind === "quay" || cell.kind === "flats" ? pick(FLAT_STREETS) : pick(HILL_STREETS),
    lane: cell.kind === "crest" || cell.kind === "slopes",
  })),
  (cell) => (cell.kind === "crest" ? 5.5 : cell.kind === "quay" ? 9 : 7),
  190,
);

// -------------------------------------------------------------- attributes
const CORES = [
  { xy: [-260, -180], w: 1.0, r: 380 },     // the financial flats at the ferry
  { xy: [-560, 430], w: 0.52, r: 330 },     // the crest
  { xy: [640, 560], w: 0.40, r: 300 },
  { xy: [700, -430], w: 0.34, r: 280 },
  { xy: [-90, 1180], w: 0.24, r: 300 },
];
const heat = (p) => Math.min(1, CORES.reduce((h, c) => h + c.w * Math.exp(-(dist(p, c.xy) ** 2) / (2 * c.r * c.r)), 0));

emitCity({
  name: "Vantage", slug: "vantage", seed: SEED, proj, rand, blocks,
  landRings: [{ outer: [[-5200, -4600], [5200, -4600], [5200, 5200], [-5200, 5200]], holes: [BAY] }],
  piers: PIERS,
  parks: PARKS,
  // The terraces: one slab per cell, and because the cells tile the hill the
  // slabs abut into a continuous stepped ground with retaining walls at every
  // change of level. This is the whole illusion.
  deco: [
    ...kept.filter((c) => c.podium > 3).map((c) => ({ ring: c.ring, top: c.podium })),
    // the beacon on the crest and the bay bridge towers
    { ring: circleRing(-560, 430, 8, 12), top: 168, base: 132 },
    ...[[1200, -700], [1900, -1020]].map(([x, y]) => ({ ring: rectAround(x, y, 16, 16, 20), top: 120 })),
    ...[[-980, -820], [-120, -700], [420, -760]].map(([x, y]) => ({ ring: rectAround(x, y, 70, 14, 6), top: 5 })),
  ],
  stations: [
    { name: "Ferry Landing", lines: "1 2 K", xy: [-240, -320], weight: 100 },
    { name: "Battery & Front", lines: "1 2", xy: [420, -180], weight: 72 },
    { name: "Cable Terminus", lines: "K", xy: [-560, 60], weight: 60 },
    { name: "Vantage Crest", lines: "K", xy: [-560, 430], weight: 55 },
    { name: "Signal Hill", lines: "K3", xy: [640, 560], weight: 48 },
    { name: "Cannery Row", lines: "2", xy: [-1300, -260], weight: 44 },
    { name: "Botanic Gate", lines: "3", xy: [-1500, 620], weight: 36 },
    { name: "Kite Hill", lines: "3", xy: [-90, 1180], weight: 38 },
    { name: "Reservoir", lines: "3", xy: [0, 2200], weight: 26 },
    { name: "East Slope", lines: "K3", xy: [1400, 480], weight: 30 },
    { name: "Bridge Head", lines: "1", xy: [1180, -640], weight: 34 },
  ],
  labels: [
    { name: "THE FLATS", labelKind: "district", xy: [80, -160] },
    { name: "VANTAGE HILL", labelKind: "district", xy: [-560, 430] },
    { name: "SIGNAL HILL", labelKind: "district", xy: [640, 560] },
    { name: "KITE HILL", labelKind: "district", xy: [-90, 1180] },
    { name: "Vantage Bay", labelKind: "water", xy: [200, -1900] },
    { name: "Botanic Garden", labelKind: "park", xy: [-1500, 620] },
    { name: "The Reservoir", labelKind: "park", xy: [0, 2600] },
  ],
  trees: (() => {
    const t = [];
    for (const park of PARKS) {
      const c = centroid(park);
      for (let i = 0; i < 300; i++) {
        const q = [c[0] + rr(-480, 480), c[1] + rr(-330, 330)];
        if (inRing(q, park)) t.push(q);
      }
    }
    // eucalyptus down every contour street on the upper slopes
    for (const hill of HILLS) {
      for (let r = 120; r < hill.R; r += 90) {
        const n = Math.round((2 * Math.PI * r) / 22);
        for (let i = 0; i < n; i++) {
          if (rand() > 0.30) continue;
          const a = (i / n) * Math.PI * 2;
          t.push([hill.xy[0] + r * Math.cos(a), hill.xy[1] + r * Math.sin(a)]);
        }
      }
    }
    return t;
  })(),
  heat,
  farFor: (d, h) => Math.round((d === "quay" ? 14 : d === "flats" ? 9 : d === "lower" ? 6 : d === "slopes" ? 4.5 : 3.5) * 10 + h * h * 170) / 10,
  vacancyP: (d, h) => Math.min(0.8, (d === "crest" ? 0.34 : d === "slopes" ? 0.44 : d === "lower" ? 0.48 : d === "flats" ? 0.52 : 0.34) * (0.3 + 1.2 * Math.pow(1 - h, 1.5))),
  classTable: (d) => (d === "quay" ? [["G1", .05], ["O4", .56], ["E9", .70], ["RM", .84], ["D0", 1]]
    : d === "flats" ? [["O3", .30], ["E9", .48], ["D0", .74], ["K2", .88], ["S1", 1]]
    : d === "crest" ? [["D0", .66], ["S1", .88], ["K2", 1]]
    : [["D0", .62], ["S1", .80], ["K2", .92], ["O3", 1]]),
  yearFor: (d) => Math.round(d === "crest" ? rr(1895, 1955) : d === "quay" ? rr(1920, 2015) : rr(1900, 1985)),
  // Wooden hill houses two and three storeys tall, stacked up the slope; the
  // only real height is in the flats, where the ground is worth something.
  skylineFor: ({ district, heat: h, areaM2 }) => {
    if (district === "quay" && areaM2 > 400 && rand() < 0.22 + h * h * 0.5) return { floors: rr(16, 30) + h * h * rr(8, 24), coverage: rr(0.5, 0.68), floorH: 3.8 };
    if (district === "flats" && areaM2 > 400 && rand() < 0.08 + h * h * 0.2) return { floors: rr(9, 18), coverage: rr(0.54, 0.7), floorH: 3.7 };
    if (district === "quay" || district === "flats") return { floors: rr(3, 7), coverage: rr(0.6, 0.8), floorH: 3.6 };
    return { floors: rr(2, 4.2), coverage: rr(0.5, 0.68), floorH: 3.2 };
  },
  lotOpt: (d) => (d === "quay" || d === "flats" ? { target: () => rr(1500, 3600), min: 520, maxDepth: 42, jitter: 5 }
    : { target: () => rr(700, 1500), min: 300, maxDepth: 30, jitter: 9 }),
  fullBlockP: (d) => (d === "quay" ? 0.16 : 0.03),
  landPsf: (h) => 55 + 430 * h,
});
