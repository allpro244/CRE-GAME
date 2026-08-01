// MERIDIAN — a baroque capital on a dry plain. Nothing here is accidental:
// a surveyor stood at the Grand Place, swung ten ring boulevards, dropped
// spokes between them, and then drove four grand diagonals straight through
// the result. The blocks that survive are wedges and triangles, the cornice
// line is uniform, and the only towers stand where the axes cross.
import { mulberry32, makeProjection } from "../lib/geom.mjs";
import {
  emitCity, insetBlocks, carveCorridor, avoidRegion, outsideFaces, circleRing,
  rectAround, inRing, polygonArea, isConvex, cleanRing, centroid, dist,
} from "../lib/citykit.mjs";

const SEED = 71104;
const rand = mulberry32(SEED);
const rr = (a, b) => a + (b - a) * rand();
const pick = (a) => a[Math.floor(rand() * a.length) % a.length];
const proj = makeProjection(-70.9, 41.1);

// ---------------------------------------------------------------- the plan
const R_MAX = 1420;
// Ring boulevards. The spacing opens up as you leave the centre — tight
// courts around the Place, generous quarters at the edge.
const RINGS = [130];
{
  let r = RINGS[0], step = 74;
  while (r < R_MAX) { r += step; step *= 1.085; RINGS.push(Math.round(r)); }
}
// Spokes double twice on the way out so a block at the rim is not a mile wide.
const sectorsAt = (r) => (r < 380 ? 24 : r < 760 ? 36 : 60);

// Circular places where the axes meet — every one of them ringed by frontage.
const PLACES = [
  { xy: [0, 0], r: 118, name: "The Grand Place" },
  { xy: [0, 560], r: 74, name: "Place du Nord" },
  { xy: [0, -560], r: 74, name: "Place du Midi" },
  { xy: [700, 0], r: 66, name: "Étoile de l'Est" },
  { xy: [-700, 0], r: 66, name: "Étoile de l'Ouest" },
  { xy: [520, 520], r: 58, name: "Rond-Point Aurore" },
  { xy: [-520, -520], r: 58, name: "Rond-Point Vesper" },
];
// The formal axis: a long tapis vert running north from the Place, and a
// mirrored parterre south of it.
const AXIS_PARK = rectAround(0, 300, 190, 300);
const SOUTH_PARK = rectAround(0, -300, 150, 250);
const LAKE = circleRing(-880, 640, 210, 34);
const LAKE_PARK = circleRing(-880, 640, 330, 40);
const EAST_GARDEN = rectAround(940, -620, 420, 300, 18);

const OBSTACLES = [
  ...PLACES.map((p) => ({ ring: circleRing(p.xy[0], p.xy[1], p.r, 20) })),
  { ring: AXIS_PARK }, { ring: SOUTH_PARK }, { ring: LAKE_PARK }, { ring: EAST_GARDEN },
].map((o) => ({ ring: o.ring, faces: outsideFaces(o.ring, 7) }));

// ------------------------------------------------------------- the lattice
const cells = [];
for (let k = 0; k < RINGS.length - 1; k++) {
  const r0 = RINGS[k], r1 = RINGS[k + 1];
  const n = sectorsAt(r0);
  const twist = rr(0, Math.PI * 2) * 0;          // the plan is not rotated
  for (let j = 0; j < n; j++) {
    const a0 = twist + (j / n) * Math.PI * 2;
    const a1 = twist + ((j + 1) / n) * Math.PI * 2;
    // A hair of jitter so the drawing reads as ink rather than CAD.
    const jr = (v) => v + rr(-1.4, 1.4);
    const quad = cleanRing([
      [jr(r0 * Math.cos(a0)), jr(r0 * Math.sin(a0))],
      [jr(r1 * Math.cos(a0)), jr(r1 * Math.sin(a0))],
      [jr(r1 * Math.cos(a1)), jr(r1 * Math.sin(a1))],
      [jr(r0 * Math.cos(a1)), jr(r0 * Math.sin(a1))],
    ]);
    if (!quad || quad.length !== 4 || !isConvex(quad)) continue;
    cells.push({ ring: quad, ringIdx: k, spoke: j, sectors: n });
  }
}

// The four grand diagonals, driven straight through the rings.
let cut = cells;
const DIAGONALS = [
  { p: [0, 0], deg: 45, hw: 21 },
  { p: [0, 0], deg: -45, hw: 21 },
  { p: [0, 0], deg: 0, hw: 26 },      // the east–west state route
  { p: [0, 0], deg: 90, hw: 30 },     // the grand north–south axis
  { p: [340, -340], deg: 20, hw: 15 },
  { p: [-340, 340], deg: 20, hw: 15 },
  { p: [380, 380], deg: -22, hw: 15 },
];
for (const d of DIAGONALS) cut = carveCorridor(cut, d.p, (d.deg * Math.PI) / 180, d.hw);

// Places and parks hold their ground.
const kept = [];
for (const cell of cut) {
  let ring = cell.ring;
  for (const o of OBSTACLES) {
    if (!ring) break;
    ring = avoidRegion(ring, o.faces, (p) => inRing(p, o.ring), 260);
  }
  if (!ring || polygonArea([ring]) < 300) continue;
  const c = centroid(ring);
  if (Math.hypot(c[0], c[1]) > R_MAX) continue;
  kept.push({ ...cell, ring });
}

// ------------------------------------------------------------ districts
// Assigned AFTER the tiling, from where a block landed — so there is no seam
// between districts to leave a void.
const RING_NAMES = ["Rue de la Monnaie", "Rue Corbière", "Rue des Halles", "Rue Vaubourg", "Rue Sainte-Cloche", "Rue Lamartine", "Rue du Rempart", "Rue Belfort"];
const AVENUES = ["Avenue Impériale", "Avenue du Cordon", "Avenue Saint-Marc", "Avenue Verrier", "Avenue des Tilleuls", "Avenue Bourbon"];
function districtOf(c) {
  const r = Math.hypot(c[0], c[1]);
  if (r < 330) return "citadel";
  if (r < 700) return "ministries";
  if (r < 1050) return "quarters";
  return "faubourg";
}

const blocks = insetBlocks(
  kept.map((cell) => {
    const c = centroid(cell.ring);
    const d = districtOf(c);
    return {
      ...cell, district: d,
      street: rand() < 0.34 ? pick(AVENUES) : pick(RING_NAMES),
      lane: d === "faubourg",
    };
  }),
  (cell) => (cell.district === "citadel" ? 8.5 : cell.district === "faubourg" ? 7 : 8),
  190,
);

// ------------------------------------------------------------- attributes
const CORES = [
  { xy: [0, 0], w: 1.0, r: 300 },
  { xy: [0, 430], w: 0.42, r: 260 },
  { xy: [700, 0], w: 0.34, r: 230 },
  { xy: [-700, 0], w: 0.30, r: 230 },
  { xy: [520, 520], w: 0.22, r: 200 },
];
const heat = (p) => Math.min(1, CORES.reduce((h, c) => h + c.w * Math.exp(-(dist(p, c.xy) ** 2) / (2 * c.r * c.r)), 0));

const STATIONS = [
  { name: "Grand Place", lines: "1 2 4", xy: [0, 150], weight: 100 },
  { name: "Place du Nord", lines: "1 3", xy: [0, 560], weight: 70 },
  { name: "Place du Midi", lines: "1", xy: [0, -560], weight: 55 },
  { name: "Étoile de l'Est", lines: "2", xy: [700, 0], weight: 60 },
  { name: "Étoile de l'Ouest", lines: "2", xy: [-700, 0], weight: 55 },
  { name: "Halles Corbière", lines: "4", xy: [280, 210], weight: 60 },
  { name: "Ministères", lines: "4", xy: [-260, -230], weight: 50 },
  { name: "Aurore", lines: "3", xy: [520, 520], weight: 40 },
  { name: "Vesper", lines: "3", xy: [-520, -520], weight: 35 },
  { name: "Lac Vaubourg", lines: "5", xy: [-880, 640], weight: 30 },
  { name: "Belfort", lines: "5", xy: [1080, 380], weight: 28 },
  { name: "Porte du Sud", lines: "5", xy: [-380, -1080], weight: 26 },
];

emitCity({
  name: "Meridian", slug: "meridian", seed: SEED, proj, rand, blocks,
  // Meridian sits inland: open country runs to the horizon in every
  // direction, so the plain has to reach past the frame or the plan reads as
  // a coin dropped in the sea.
  landRings: [{
    outer: Array.from({ length: 72 }, (_, i) => {
      const a = (i / 72) * Math.PI * 2;
      const r = 5200 + 900 * Math.sin(a * 3 + 1.1) + 500 * Math.cos(a * 5 - 0.4);
      return [r * Math.cos(a), r * Math.sin(a)];
    }),
    holes: [LAKE],
  }],
  parks: [AXIS_PARK, SOUTH_PARK, LAKE_PARK, EAST_GARDEN, ...PLACES.map((p) => circleRing(p.xy[0], p.xy[1], p.r, 24))],
  stations: STATIONS,
  labels: [
    { name: "THE CITADEL", labelKind: "district", xy: [180, -180] },
    { name: "MINISTRY QUARTER", labelKind: "district", xy: [-420, -380] },
    { name: "THE QUARTERS", labelKind: "district", xy: [820, 620] },
    { name: "FAUBOURG BELFORT", labelKind: "district", xy: [1120, -260] },
    { name: "The Grand Place", labelKind: "park", xy: [0, 0] },
    { name: "Tapis Vert", labelKind: "park", xy: [0, 300] },
    { name: "Lac Vaubourg", labelKind: "water", xy: [-880, 640] },
    { name: "Jardin de l'Est", labelKind: "park", xy: [940, -620] },
  ],
  trees: (() => {
    const t = [];
    for (const park of [AXIS_PARK, SOUTH_PARK, LAKE_PARK, EAST_GARDEN]) {
      for (let i = 0; i < 260; i++) {
        const p = [rr(-1, 1), rr(-1, 1)];
        const c = centroid(park);
        const q = [c[0] + p[0] * 260, c[1] + p[1] * 260];
        if (inRing(q, park) && !inRing(q, LAKE)) t.push(q);
      }
    }
    // allées: trees down every grand diagonal
    for (const d of DIAGONALS.slice(0, 4)) {
      const th = (d.deg * Math.PI) / 180;
      for (let s = -R_MAX; s < R_MAX; s += 26) {
        for (const side of [-1, 1]) {
          const x = d.p[0] + s * Math.cos(th) - side * (d.hw + 4) * Math.sin(th);
          const y = d.p[1] + s * Math.sin(th) + side * (d.hw + 4) * Math.cos(th);
          if (Math.hypot(x, y) < R_MAX - 20 && rand() < 0.55) t.push([x, y]);
        }
      }
    }
    return t;
  })(),
  deco: [
    // the dome over the Grand Place and four corner pavilions
    { ring: circleRing(0, 0, 34, 18), top: 74 },
    { ring: circleRing(0, 0, 20, 16), top: 96, base: 70 },
    ...[[0, 560], [0, -560], [700, 0], [-700, 0]].map(([x, y]) => ({ ring: circleRing(x, y, 9, 12), top: 34 })),
    // the triumphal column at the head of the tapis vert
    { ring: circleRing(0, 452, 7, 14), top: 46 },
  ],
  heat,
  farFor: (d, h) => Math.round((d === "citadel" ? 13 : d === "ministries" ? 9 : d === "quarters" ? 7 : 5.5) * 10 + h * h * 190) / 10,
  vacancyP: (d, h) => Math.min(0.8, (d === "faubourg" ? 0.56 : d === "quarters" ? 0.42 : 0.30) * (0.3 + 1.2 * Math.pow(1 - h, 1.5))),
  classTable: (d) => (d === "citadel" ? [["G1", .06], ["O4", .58], ["RM", .74], ["K2", .86], ["D0", 1]]
    : d === "ministries" ? [["G1", .10], ["O3", .48], ["D0", .74], ["K2", .88], ["S1", 1]]
    : d === "quarters" ? [["D0", .58], ["S1", .76], ["K2", .90], ["O3", 1]]
    : [["D0", .52], ["S1", .70], ["E9", .86], ["K2", 1]]),
  yearFor: (d, r) => Math.round(d === "citadel" ? rr(1861, 1905) : d === "ministries" ? rr(1866, 1920) : d === "quarters" ? rr(1880, 1948) : rr(1900, 1985)),
  // The Haussmann move: a uniform seven-storey cornice everywhere, broken only
  // where the axes cross. That flat plane of roofs with a few spires through it
  // is the whole look.
  skylineFor: ({ district, heat: h, areaM2 }) => {
    const towerP = district === "citadel" ? h * h * 0.5 : district === "ministries" ? h * h * 0.16 : 0.015;
    if (areaM2 > 300 && rand() < towerP) return { floors: rr(14, 22) + h * h * rr(10, 30), coverage: rr(0.5, 0.66), floorH: 3.9 };
    const base = district === "citadel" ? rr(6.4, 8.4) : district === "ministries" ? rr(5.6, 7.6) : district === "quarters" ? rr(4.6, 6.6) : rr(2.6, 4.6);
    return { floors: base, coverage: rr(0.68, 0.84), floorH: 4.1 };
  },
  lotOpt: (d) => (d === "citadel" ? { target: () => rr(380, 1150), min: 165, maxDepth: 30, jitter: 4 }
    : d === "faubourg" ? { target: () => rr(700, 2400), min: 260, maxDepth: 40, jitter: 5 }
    : { target: () => rr(450, 1400), min: 190, maxDepth: 32, jitter: 4 }),
  fullBlockP: (d) => (d === "citadel" ? 0.12 : 0.06),
  landPsf: (h) => 70 + 400 * h,
});
