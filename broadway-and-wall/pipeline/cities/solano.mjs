// SOLANO — the Eixample. One engineer, one grid, one rule: every corner of
// every block gets shaved off at 45 degrees, so each intersection opens into
// a small octagonal square and the whole city breathes. Nothing here is
// picturesque and that is the point — it is beautiful because it is relentless.
// Two diagonals cut across it, the sea takes the south-east edge, and the old
// town survives as a knot of lanes the grid simply went around.
import { mulberry32, makeProjection } from "../lib/geom.mjs";
import {
  emitCity, insetBlocks, splitCells, avoidRegion, outsideFaces, inRing,
  rectAround, circleRing, chamferAll, polygonArea, isConvex, cleanRing,
  centroid, dist, carveCorridor, chaikinOpen, clipToBoundary,
} from "../lib/citykit.mjs";
import { convexHull } from "../lib/geom.mjs";

const SEED = 25508;
const rand = mulberry32(SEED);
const rr = (a, b) => a + (b - a) * rand();
const pick = (a) => a[Math.floor(rand() * a.length) % a.length];
const proj = makeProjection(-70.9, 41.1);

// -------------------------------------------------------------------- coast
// The sea comes in from the south-east on a long straight strand.
const SHORE = chaikinOpen([
  [-2900, -2050], [-2000, -1780], [-1100, -1520], [-200, -1300],
  [700, -1120], [1600, -980], [2500, -900], [3300, -880],
], 3);
const SEA = [...SHORE, [3300, -5000], [-2900, -5000]];
const LANDMASK = [...SHORE, [3300, 4200], [-2900, 4200]];

// The hill behind the town, kept as parkland.
const MONTE = circleRing(-1750, 1550, 640, 40);

// ------------------------------------------------------------------- the grid
// A single continuous lattice at one bearing across the whole plain. Nothing
// is warped and nothing is jittered: this city was drawn with a ruler.
const TH = (28 * Math.PI) / 180;
const A = [Math.sin(TH), Math.cos(TH)], S = [Math.cos(TH), -Math.sin(TH)];
const at = (u, w) => [u * S[0] + w * A[0], u * S[1] + w * A[1]];
const PITCH = 133;         // Cerdà's 113 m block plus a 20 m street
const CHAMFER = 26;        // the shaved corner

const cells = [];
for (let iu = -22; iu <= 22; iu++) {
  for (let iw = -22; iw <= 22; iw++) {
    const u = iu * PITCH, w = iw * PITCH;
    const half = (PITCH - 20) / 2;
    const sq = [at(u - half, w - half), at(u + half, w - half), at(u + half, w + half), at(u - half, w + half)];
    const oct = chamferAll(sq, CHAMFER);
    if (!oct || !isConvex(oct)) continue;
    cells.push({ ring: oct, iu, iw });
  }
}

// The two diagonals, driven across the grid at odd angles so they slice the
// octagons into triangles and trapezoids.
let cut = cells;
cut = carveCorridor(cut, [0, 0], TH + Math.PI / 4 + 0.02, 27);          // the Gran Diagonal
cut = carveCorridor(cut, [420, -520], TH - Math.PI / 3, 21);            // the Paral·lel
cut = carveCorridor(cut, [-1150, 260], TH + Math.PI / 2 + 0.02, 24);    // the Rambla

// The old town: a knot the grid never touched.
const OLD = circleRing(-260, -820, 430, 26);
{
  const out = [];
  splitCells(convexHull(OLD), () => rr(2400, 5600), 22, 900, out, rr);
  for (const c of out) cut.push({ ring: c, old: true });
}

// ---------------------------------------------------------------- obstacles
const PARKS = [
  MONTE,
  rectAround(1250, 900, 620, 620, 28),            // the Parc de Llevant
  rectAround(-1900, -900, 480, 380, 28),          // Parc de Ponent
  rectAround(500, -1180, 1500, 190, 8),           // the strand promenade
];
const PARK_FACES = PARKS.map((p) => outsideFaces(p, 9));
const OLD_FACES = outsideFaces(OLD, 10);

const kept = [];
for (const cell of cut) {
  const c0 = centroid(cell.ring);
  if (!inRing(c0, LANDMASK)) continue;
  if (dist(c0, [-1750, 1550]) > 3400) continue;
  let ring = clipToBoundary(cell.ring, LANDMASK, 300, 400);
  if (!ring) continue;
  if (!cell.old) ring = avoidRegion(ring, OLD_FACES, (p) => inRing(p, OLD), 320);
  for (let i = 0; i < PARKS.length && ring; i++) {
    if (dist(centroid(ring), centroid(PARKS[i])) > 1500) continue;
    ring = avoidRegion(ring, PARK_FACES[i], (p) => inRing(p, PARKS[i]), 320);
  }
  if (!ring || polygonArea([ring]) < 400) continue;
  kept.push({ ...cell, ring });
}

// ---------------------------------------------------------------- districts
const CORES = [
  { xy: [-140, -420], w: 1.0, r: 420 },      // Plaça Catalunya, where old meets new
  { xy: [640, 120], w: 0.62, r: 400 },       // the Diagonal's crossing
  { xy: [-900, -760], w: 0.42, r: 320 },
  { xy: [900, -900], w: 0.36, r: 300 },      // the strand
  { xy: [-1250, 700], w: 0.26, r: 330 },
];
const heat = (p) => Math.min(1, CORES.reduce((h, c) => h + c.w * Math.exp(-(dist(p, c.xy) ** 2) / (2 * c.r * c.r)), 0));

function districtOf(cell) {
  const c = centroid(cell.ring);
  if (cell.old) return "oldtown";
  const b = bandOf(c);
  if (b < 340) return "strand";
  if (dist(c, [-140, -420]) < 780 || dist(c, [640, 120]) < 620) return "eixample";
  if (dist(c, [-1750, 1550]) < 1500) return "gracia";
  return "extension";
}
function bandOf(p) {   // distance to the strand
  let best = Infinity;
  for (let i = 0; i < SHORE.length - 1; i++) {
    const a = SHORE[i], b = SHORE[i + 1];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / (ex * ex + ey * ey)));
    best = Math.min(best, dist(p, [a[0] + ex * t, a[1] + ey * t]));
  }
  return best;
}

const GRID_STREETS = ["Carrer Aragó", "Carrer Mallorca", "Carrer València", "Carrer Provença", "Carrer Rosselló", "Carrer Consell", "Carrer Diputació"];
const OLD_STREETS = ["Carrer del Pi", "Baixada de la Llum", "Carrer Ferran", "Argenteria", "Carrer Avinyó"];
const SEA_STREETS = ["Passeig Marítim", "Moll de Llevant", "Carrer de la Barca"];

const blocks = insetBlocks(
  kept.map((cell) => {
    const d = districtOf(cell);
    return {
      ...cell, district: d,
      street: d === "oldtown" ? pick(OLD_STREETS) : d === "strand" ? pick(SEA_STREETS) : pick(GRID_STREETS),
      lane: d === "oldtown",
    };
  }),
  (cell) => (cell.district === "oldtown" ? 3.8 : 8),
  200,
);

emitCity({
  name: "Solano", slug: "solano", seed: SEED, proj, rand, blocks,
  landRings: [{ outer: [[-5400, -5000], [5400, -5000], [5400, 5200], [-5400, 5200]], holes: [SEA] }],
  piers: [
    rectAround(1050, -1050, 620, 90, 8),
    rectAround(-400, -1330, 60, 220, 12), rectAround(300, -1230, 60, 220, 6),
  ],
  parks: PARKS,
  stations: [
    { name: "Plaça Catalunya", lines: "1 3 L", xy: [-140, -420], weight: 100 },
    { name: "Diagonal", lines: "3 5", xy: [640, 120], weight: 82 },
    { name: "Rambla", lines: "1", xy: [-620, -700], weight: 66 },
    { name: "Universitat", lines: "1 2", xy: [-900, -760], weight: 58 },
    { name: "Barceloneta", lines: "L", xy: [900, -900], weight: 52 },
    { name: "Gràcia", lines: "3", xy: [-1250, 700], weight: 46 },
    { name: "Monte Gate", lines: "5", xy: [-1750, 950], weight: 34 },
    { name: "Parc de Llevant", lines: "5", xy: [1250, 900], weight: 34 },
    { name: "Paral·lel", lines: "2", xy: [-200, -1050], weight: 44 },
    { name: "Sagrada", lines: "2 5", xy: [1100, 480], weight: 40 },
    { name: "Ponent", lines: "1", xy: [-1900, -900], weight: 28 },
  ],
  labels: [
    { name: "THE EIXAMPLE", labelKind: "district", xy: [420, -160] },
    { name: "OLD TOWN", labelKind: "district", xy: [-260, -820] },
    { name: "GRÀCIA", labelKind: "district", xy: [-1300, 900] },
    { name: "THE STRAND", labelKind: "district", xy: [900, -1000] },
    { name: "Solano Sea", labelKind: "water", xy: [700, -2100] },
    { name: "Monte Solano", labelKind: "park", xy: [-1750, 1550] },
    { name: "Parc de Llevant", labelKind: "park", xy: [1250, 900] },
  ],
  trees: (() => {
    const t = [];
    for (const park of PARKS) {
      const c = centroid(park);
      for (let i = 0; i < 420; i++) {
        const q = [c[0] + rr(-700, 700), c[1] + rr(-660, 660)];
        if (inRing(q, park)) t.push(q);
      }
    }
    // planes down the diagonals and every fourth cross street
    for (const [p, ang, hw] of [[[0, 0], TH + Math.PI / 4 + 0.02, 31], [[420, -520], TH - Math.PI / 3, 25], [[-1150, 260], TH + Math.PI / 2 + 0.02, 28]]) {
      for (let s = -3000; s < 3000; s += 18) {
        for (const side of [-1, 1]) {
          const x = p[0] + s * Math.cos(ang) - side * hw * Math.sin(ang);
          const y = p[1] + s * Math.sin(ang) + side * hw * Math.cos(ang);
          if (inRing([x, y], LANDMASK) && Math.hypot(x + 700, y - 200) < 3000 && rand() < 0.6) t.push([x, y]);
        }
      }
    }
    return t;
  })(),
  deco: [
    // the unfinished basilica — eight spires over the grid
    ...Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2;
      return { ring: circleRing(1100 + 30 * Math.cos(a), 480 + 30 * Math.sin(a), 9, 12), top: 92 + (i % 3) * 18 };
    }),
    { ring: circleRing(1100, 480, 20, 16), top: 148 },
    // the strand: bathing pavilions and a breakwater
    ...[[300, -1240], [760, -1180], [1240, -1120]].map(([x, y]) => ({ ring: rectAround(x, y, 34, 16, 8), top: 6 })),
  ],
  heat,
  farFor: (d, h) => Math.round((d === "eixample" ? 12 : d === "strand" ? 10 : d === "oldtown" ? 8 : 7.5) * 10 + h * h * 170) / 10,
  vacancyP: (d, h) => Math.min(0.8, (d === "extension" ? 0.54 : d === "gracia" ? 0.44 : d === "strand" ? 0.46 : 0.28) * (0.3 + 1.2 * Math.pow(1 - h, 1.5))),
  classTable: (d) => (d === "eixample" ? [["G1", .05], ["O4", .42], ["D0", .72], ["K2", .86], ["RM", 1]]
    : d === "oldtown" ? [["O3", .22], ["K2", .50], ["S1", .78], ["D0", 1]]
    : d === "strand" ? [["O4", .34], ["D0", .62], ["K2", .78], ["E9", 1]]
    : [["D0", .62], ["S1", .78], ["K2", .90], ["O3", 1]]),
  yearFor: (d) => Math.round(d === "oldtown" ? rr(1740, 1870) : d === "eixample" ? rr(1875, 1935) : rr(1890, 1990)),
  // Cerdà's cornice: a flat eight-storey plane over the whole grid, with the
  // towers only where the diagonals cross it.
  skylineFor: ({ district, heat: h, areaM2 }) => {
    if (district === "oldtown") return { floors: rr(4, 6.4), coverage: rr(0.78, 0.94), floorH: 3.2 };
    const towerP = district === "eixample" ? h * h * 0.42 : district === "strand" ? h * h * 0.34 : 0.02;
    if (areaM2 > 340 && rand() < towerP) return { floors: rr(15, 24) + h * h * rr(10, 28), coverage: rr(0.5, 0.68), floorH: 3.8 };
    const base = district === "eixample" ? rr(7, 9) : district === "gracia" ? rr(4, 6) : rr(5, 7.4);
    return { floors: base, coverage: rr(0.7, 0.86), floorH: 3.6 };
  },
  lotOpt: (d) => (d === "oldtown" ? { target: () => rr(220, 480), min: 100, maxDepth: 24, jitter: 12 }
    : { target: () => rr(750, 1900), min: 300, maxDepth: 34, jitter: 3 }),
  fullBlockP: (d) => (d === "eixample" ? 0.10 : 0.05),
  landPsf: (h) => 75 + 390 * h,
});
