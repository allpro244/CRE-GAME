// CALDER — a canal city. The harbor is a broad tidal water along the north
// edge; from it, five canal belts swing south in concentric arcs, cut by three
// radial cuts that run all the way from the quays to the ramparts. Blocks are
// long tangential strips, lots are narrow and deep, and every front door faces
// water. Beyond the last belt the 19th-century extension picks up in a plain
// orthogonal grid; inside the first belt the medieval town is still a tangle.
import { mulberry32, makeProjection } from "../lib/geom.mjs";
import {
  emitCity, insetBlocks, splitCells, avoidRegion, outsideFaces, inRing, ribbon, carveCorridor,
  rectAround, polygonArea, isConvex, cleanRing, centroid, dist,
  makeWarp, chaikinOpen,
} from "../lib/citykit.mjs";
import { convexHull, clipRingHalfPlane } from "../lib/geom.mjs";

const SEED = 43317;
const rand = mulberry32(SEED);
const rr = (a, b) => a + (b - a) * rand();
const pick = (a) => a[Math.floor(rand() * a.length) % a.length];
const proj = makeProjection(-70.9, 41.1);

// ------------------------------------------------------------------ water
const O = [0, 120];                      // the arcs all swing from the old quay
const WATER_Y = 150;                     // the harbor's south bank, roughly
const A0 = Math.PI * 1.03, A1 = Math.PI * 1.97;   // the southern half-turn
const BELTS = [430, 600, 780, 985, 1215, 1470];   // canal radii
const CANAL_HW = 17;
const RADIALS = [Math.PI * 1.21, Math.PI * 1.5, Math.PI * 1.79];
const RADIAL_HW = 15;

const arc = (r, a0 = A0, a1 = A1, n = 64) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    // the belts wobble a few metres — dug by hand, not by compass
    const rr2 = r + 7 * Math.sin(a * 5 + r * 0.01) + 4 * Math.cos(a * 9);
    return [O[0] + rr2 * Math.cos(a), O[1] + rr2 * Math.sin(a)];
  });

// Each canal is a curved ribbon; each is punched out of the land.
const CANALS = BELTS.slice(0, 5).map((r) => ribbon(arc(r), CANAL_HW));
const RADIAL_CANALS = RADIALS.map((a) =>
  ribbon(Array.from({ length: 8 }, (_, i) => {
    const t = 150 + (BELTS[5] + 240 - 150) * (i / 7);
    return [O[0] + t * Math.cos(a), O[1] + t * Math.sin(a)];
  }), RADIAL_HW),
);

// The harbor itself: everything north of the quay line, with two dock islands.
const QUAY = chaikinOpen([
  [-6000, -40], [-3600, 90], [-1700, 130], [-900, 175], [-200, 205], [500, 180], [1250, 120], [2100, 40], [3600, -60], [6000, -150],
], 3);
const HARBOR = [...QUAY, [6000, 6000], [-6000, 6000]];
const ISLAND_A = rectAround(-560, 470, 620, 210, -6);
const ISLAND_B = rectAround(760, 430, 520, 190, 5);

const OUTER = 1530;   // the rampart line

// ------------------------------------------------------------------ blocks
const cells = [];

// The belts: tangential strips between consecutive canals, cut by cross
// streets that run radially. Every cell is a trapezoid, so it is convex, and
// consecutive cells share their corner nodes exactly.
for (let k = 0; k < BELTS.length - 1; k++) {
  const rIn = BELTS[k] + CANAL_HW, rOut = BELTS[k + 1] - CANAL_HW;
  if (rOut - rIn < 30) continue;
  const midR = (rIn + rOut) / 2;
  const step = (rr(58, 78) / midR);        // ~60–80 m of frontage per block
  for (let a = A0; a < A1 - step * 0.4; a += step * rr(0.86, 1.2)) {
    const a2 = Math.min(A1, a + step);
    const jitter = () => rr(-1.6, 1.6);
    const q = cleanRing([
      [O[0] + rIn * Math.cos(a) + jitter(), O[1] + rIn * Math.sin(a) + jitter()],
      [O[0] + rOut * Math.cos(a) + jitter(), O[1] + rOut * Math.sin(a) + jitter()],
      [O[0] + rOut * Math.cos(a2) + jitter(), O[1] + rOut * Math.sin(a2) + jitter()],
      [O[0] + rIn * Math.cos(a2) + jitter(), O[1] + rIn * Math.sin(a2) + jitter()],
    ]);
    if (!q || q.length !== 4 || !isConvex(q)) continue;
    cells.push({ ring: q, band: k, kind: k === 0 ? "quays" : k < 3 ? "belt" : "outerbelt" });
  }
}

// The medieval core inside the first belt: recursive splitting of a convex
// seed, wild cut angles, tiny blocks.
{
  const seed = convexHull(arc(BELTS[0] - CANAL_HW, A0 + 0.06, A1 - 0.06, 40)
    .concat([[O[0] - 200, O[1] - 40], [O[0] + 200, O[1] - 40]]));
  const out = [];
  splitCells(seed, () => rr(2600, 6200), 20, 1100, out, rr);
  for (const c of out) cells.push({ ring: c, band: -1, kind: "oldtown" });
}

// The extension: a plain grid beyond the ramparts, a different city entirely.
{
  const WARP = makeWarp(rr);
  const th = (-7 * Math.PI) / 180;
  const A = [Math.sin(th), Math.cos(th)], S = [Math.cos(th), -Math.sin(th)];
  const at = (u, w) => [u * S[0] + w * A[0], u * S[1] + w * A[1]];
  const U = [], W = [];
  for (let u = -2050; u < 2050; u += rr(178, 250)) U.push(u);
  for (let w = -2200; w < 400; w += rr(88, 124)) W.push(w);
  const node = U.map((u) => W.map((w) => {
    const b = at(u, w);
    const [dx, dy] = WARP(b[0], b[1], 6);
    return [b[0] + dx + rr(-1.4, 1.4), b[1] + dy + rr(-1.4, 1.4)];
  }));
  for (let i = 0; i < U.length - 1; i++) {
    for (let j = 0; j < W.length - 1; j++) {
      const q = cleanRing([node[i][j], node[i + 1][j], node[i + 1][j + 1], node[i][j + 1]]);
      if (!q || q.length !== 4 || !isConvex(q)) continue;
      const c = centroid(q);
      const r = dist(c, O);
      if (r < OUTER || r > 2320) continue;           // only outside the ramparts
      cells.push({ ring: q, band: 9, kind: "extension" });
    }
  }
}

// The dock islands: big warehouse plates, whole-block scale.
for (const isl of [ISLAND_A, ISLAND_B]) {
  const out = [];
  splitCells(isl, () => rr(9000, 20000), 4, 4000, out, rr);
  for (const c of out) cells.push({ ring: c, band: 8, kind: "docks" });
}

// ------------------------------------------------------- water holds its own
const OBST = [];   // the belts are laid out between the canals already
const PARKS = [
  rectAround(-1180, -820, 520, 360, 12),
  rectAround(980, -1000, 460, 300, -8),
  rectAround(70, -1560, 700, 240, 3),
];
const PARK_FACES = PARKS.map((p) => outsideFaces(p, 7));

const kept = [];
for (const cell of cells) {
  let ring = cell.ring;
  // south bank of the harbor — the quays stop at the water
  ring = ring && clipRingHalfPlane(ring, 0, 1, WATER_Y - 6);
  if (cell.kind === "docks") ring = cell.ring;         // islands live in the water
  ring = ring && cleanRing(ring);
  if (!ring || !isConvex(ring) || polygonArea([ring]) < 300) continue;
  if (cell.kind !== "docks") {
    for (let i = 0; i < PARKS.length && ring; i++) {
      ring = avoidRegion(ring, PARK_FACES[i], (p) => inRing(p, PARKS[i]), 260);
    }
  }
  if (!ring || polygonArea([ring]) < 320) continue;
  kept.push({ ...cell, ring });
}

const cutByRadials = (() => {
  let list = kept.filter((c) => c.kind !== "docks");
  for (const a of RADIALS) list = carveCorridor(list, O, a + Math.PI / 2, RADIAL_HW + 4);
  return [...list, ...kept.filter((c) => c.kind === "docks")];
})();

const QUAY_NAMES = ["Zoutkade", "Wijnkade", "Koperstraat", "Lange Gracht", "Vismarkt", "Anker Kade", "Touwslagerij"];
const BELT_NAMES = ["Herengracht", "Keizersgracht", "Prinsengracht", "Bloemgracht", "Reguliersgracht", "Looiersgracht"];
const EXT_NAMES = ["Ruyterlaan", "Vondelweg", "Havenstraat", "Molenlaan", "Zonneveld", "Boomkade"];
const DOCK_NAMES = ["Pakhuis Wharf", "Silo Kade", "Entrepot Dok"];

const blocks = insetBlocks(
  cutByRadials.map((cell) => ({
    ...cell,
    district: cell.kind,
    street: cell.kind === "oldtown" ? pick(QUAY_NAMES)
      : cell.kind === "extension" ? pick(EXT_NAMES)
      : cell.kind === "docks" ? pick(DOCK_NAMES) : pick(BELT_NAMES),
    lane: cell.kind === "oldtown",
  })),
  (cell) => (cell.kind === "oldtown" ? 4.2 : cell.kind === "docks" ? 9 : cell.kind === "extension" ? 7 : 6.5),
  180,
);

// -------------------------------------------------------------- attributes
const CORES = [
  { xy: [-40, -180], w: 1.0, r: 340 },     // the Dam
  { xy: [-330, -520], w: 0.5, r: 300 },
  { xy: [430, -430], w: 0.42, r: 290 },
  { xy: [-560, 470], w: 0.34, r: 250 },    // the docks
  { xy: [760, 430], w: 0.30, r: 230 },
];
const heat = (p) => Math.min(1, CORES.reduce((h, c) => h + c.w * Math.exp(-(dist(p, c.xy) ** 2) / (2 * c.r * c.r)), 0));

emitCity({
  name: "Calder", slug: "calder", seed: SEED, proj, rand, blocks,
  landRings: [{
    outer: [[-5600, -5200], [5600, -5200], [5600, 5600], [-5600, 5600]],
    holes: [HARBOR, ...CANALS, ...RADIAL_CANALS],
  }],
  piers: [
    // bridges: one slab wherever a radial crosses a belt, plus the dock quays
    ...RADIALS.flatMap((a) => BELTS.slice(0, 5).map((r) =>
      rectAround(O[0] + r * Math.cos(a), O[1] + r * Math.sin(a), 46, 26, (a * 180) / Math.PI))),
    ...BELTS.slice(0, 5).flatMap((r) => [A0 + 0.35, (A0 + A1) / 2 - 0.4, A1 - 0.35].map((a) =>
      rectAround(O[0] + r * Math.cos(a), O[1] + r * Math.sin(a), 40, 22, (a * 180) / Math.PI))),
    rectAround(-560, 470, 680, 250, -6), rectAround(760, 430, 580, 230, 5),
  ],
  parks: PARKS,
  stations: [
    { name: "Centraal", lines: "1 2 5", xy: [-30, 60], weight: 100 },
    { name: "Dam", lines: "1 2", xy: [-40, -180], weight: 85 },
    { name: "Herengracht", lines: "2", xy: [-330, -520], weight: 60 },
    { name: "Keizersgracht", lines: "2", xy: [430, -430], weight: 58 },
    { name: "Westerdok", lines: "5", xy: [-560, 470], weight: 45 },
    { name: "Oosterdok", lines: "5", xy: [760, 430], weight: 42 },
    { name: "Prinsengracht", lines: "3", xy: [-760, -700], weight: 40 },
    { name: "Bloemgracht", lines: "3", xy: [640, -830], weight: 38 },
    { name: "Rampart Zuid", lines: "4", xy: [70, -1560], weight: 34 },
    { name: "Vondelweg", lines: "4", xy: [-1400, -1500], weight: 28 },
    { name: "Molenlaan", lines: "4", xy: [1500, -1600], weight: 26 },
    { name: "Boomkade", lines: "6", xy: [-1900, -400], weight: 24 },
  ],
  labels: [
    { name: "OLD TOWN", labelKind: "district", xy: [-40, -140] },
    { name: "THE BELTS", labelKind: "district", xy: [-820, -640] },
    { name: "THE DOCKS", labelKind: "district", xy: [-560, 470] },
    { name: "THE EXTENSION", labelKind: "district", xy: [1250, -1800] },
    { name: "Calder Water", labelKind: "water", xy: [200, 1400] },
    { name: "Herengracht", labelKind: "water", xy: [-380, -560] },
    { name: "Westerpark", labelKind: "park", xy: [-1180, -820] },
    { name: "Oosterpark", labelKind: "park", xy: [980, -1000] },
    { name: "Ramparts Green", labelKind: "park", xy: [70, -1560] },
  ],
  trees: (() => {
    const t = [];
    // every canal is lined with elms — this is what makes it read as a canal
    for (const line of [...BELTS.slice(0, 5).map((r) => arc(r, A0, A1, 90)),
      ...RADIALS.map((a) => Array.from({ length: 40 }, (_, i) => {
        const s = 300 + (BELTS[5] - 300) * (i / 39);
        return [O[0] + s * Math.cos(a), O[1] + s * Math.sin(a)];
      }))]) {
      for (const p of line) {
        for (const side of [-1, 1]) {
          if (rand() > 0.5) continue;
          const dx = p[0] - O[0], dy = p[1] - O[1];
          const l = Math.hypot(dx, dy) || 1;
          t.push([p[0] + (dx / l) * side * (CANAL_HW + 5), p[1] + (dy / l) * side * (CANAL_HW + 5)]);
        }
      }
    }
    for (const park of PARKS) {
      const c = centroid(park);
      for (let i = 0; i < 220; i++) {
        const q = [c[0] + rr(-320, 320), c[1] + rr(-230, 230)];
        if (inRing(q, park)) t.push(q);
      }
    }
    return t;
  })(),
  deco: [
    // the Westertoren, and cranes along the dock islands
    { ring: rectAround(-250, -240, 15, 15, 20), top: 62 },
    { ring: rectAround(-250, -240, 8, 8, 20), top: 86, base: 58 },
    ...[[-820, 560], [-300, 570], [420, 520], [1010, 520]].map(([x, y]) => ({ ring: rectAround(x, y, 5, 5), top: 30 })),
    ...[[-820, 560], [-300, 570], [420, 520], [1010, 520]].map(([x, y]) => ({ ring: rectAround(x + 12, y, 28, 3), top: 29, base: 26 })),
    // moored barges on the harbor
    ...[[-1200, 900, 12], [200, 1100, -8], [1400, 820, 22], [-200, 1900, 4]].map(([x, y, d]) => ({ ring: rectAround(x, y, 60, 12, d), top: 5 })),
  ],
  heat,
  farFor: (d, h) => Math.round((d === "oldtown" ? 7 : d === "quays" || d === "belt" ? 8 : d === "docks" ? 11 : 6) * 10 + h * h * 150) / 10,
  vacancyP: (d, h) => Math.min(0.82, (d === "docks" ? 0.62 : d === "extension" ? 0.55 : d === "outerbelt" ? 0.40 : 0.26) * (0.3 + 1.2 * Math.pow(1 - h, 1.5))),
  classTable: (d) => (d === "oldtown" ? [["O3", .26], ["K2", .54], ["S1", .78], ["D0", 1]]
    : d === "quays" || d === "belt" ? [["O3", .30], ["D0", .62], ["K2", .78], ["S1", .90], ["RM", 1]]
    : d === "docks" ? [["E9", .52], ["O4", .74], ["G1", .84], ["D0", 1]]
    : [["D0", .60], ["S1", .78], ["K2", .90], ["E9", 1]]),
  yearFor: (d) => Math.round(d === "oldtown" ? rr(1620, 1780) : d === "quays" || d === "belt" ? rr(1660, 1830) : d === "docks" ? rr(1890, 1975) : rr(1875, 1935)),
  // Calder is LOW and even: four to six storeys of gabled brick, shoulder to
  // shoulder, the whole way round. The docks are the only place with height.
  skylineFor: ({ district, heat: h, areaM2 }) => {
    if (district === "docks") {
      if (areaM2 > 3000 && rand() < 0.28 + h * 0.4) return { floors: rr(14, 30), coverage: rr(0.5, 0.7), floorH: 3.7 };
      return { floors: rr(3, 7), coverage: rr(0.62, 0.8), floorH: 4.4 };
    }
    if (district === "extension") return { floors: rr(3, 5.6), coverage: rr(0.6, 0.78), floorH: 3.5 };
    return { floors: rr(3.4, 6.2) + h * 1.2, coverage: rr(0.72, 0.9), floorH: 3.3 };
  },
  // narrow and deep — the canal house
  lotOpt: (d) => (d === "docks" ? { target: () => rr(2600, 8000), min: 700, maxDepth: 60, jitter: 4 }
    : d === "extension" ? { target: () => rr(1200, 2800), min: 430, maxDepth: 36, jitter: 5 }
    : { target: () => rr(420, 820), min: 175, maxDepth: 36, jitter: 8 }),
  fullBlockP: (d) => (d === "docks" ? 0.35 : 0.03),
  landPsf: (h) => 80 + 340 * h,
});
