// IRONWATER — a river city, in three versions.
//
//   node pipeline/cities/ironwater.mjs bend      the S-curve with an island
//   node pipeline/cities/ironwater.mjs forks     two rivers meeting at a point
//   node pipeline/cities/ironwater.mjs narrows   a tidal strait with a neck
//
// What all three share: the river is the only seam. Each bank is ONE
// continuous lattice, districts are read off afterwards from where a block
// landed, and the water is punched out of the land as a hole. What differs is
// the shape of the water, and therefore everything else — because in a river
// city the water decides which ground is worth anything.
//
// All three start as TOWNS. The tall stuff is the thing you build over a
// hundred years, not the thing you inherit.
import { mulberry32, makeProjection } from "../lib/geom.mjs";
import {
  emitCity, insetBlocks, splitCells, avoidRegion, outsideFaces, inRing, ribbon,
  rectAround, circleRing, polygonArea, isConvex, cleanRing, centroid, dist,
  makeWarp, chaikinOpen, carveCorridor, trimToWater,
} from "../lib/citykit.mjs";
import { convexHull, clipRingHalfPlane } from "../lib/geom.mjs";

const VARIANT = (process.argv[2] ?? "bend").toLowerCase();
const SEEDS = { bend: 60741, forks: 33902, narrows: 81155 };
const SEED = SEEDS[VARIANT] ?? 60741;
const rand = mulberry32(SEED);
const rr = (a, b) => a + (b - a) * rand();
const pick = (a) => a[Math.floor(rand() * a.length) % a.length];
const proj = makeProjection(-70.9, 41.1);

const smooth = (pts, n = 4) => chaikinOpen(pts, n);

// ---------------------------------------------------------------- the water
// Which side of a centre line a point falls on, and how far from it.
function sideOf(spine, p) {
  let best = Infinity, side = 1;
  for (let i = 0; i < spine.length - 1; i++) {
    const a = spine[i], b = spine[i + 1];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / (ex * ex + ey * ey)));
    const d = dist(p, [a[0] + ex * t, a[1] + ey * t]);
    if (d < best) { best = d; side = Math.sign(ex * (p[1] - a[1]) - ey * (p[0] - a[0])) || 1; }
  }
  return { side, d: best };
}

// True when the point sits west of the water. A cross product would do it too,
// but its sign depends on which end of the spine was typed first, and that is
// exactly the kind of thing that silently hands one bank most of the city.
function westOf(spine, p) {
  let best = Infinity, nx = 0;
  for (let i = 0; i < spine.length - 1; i++) {
    const a = spine[i], b = spine[i + 1];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / (ex * ex + ey * ey)));
    const q = [a[0] + ex * t, a[1] + ey * t];
    const d = dist(p, q);
    if (d < best) { best = d; nx = q[0]; }
  }
  return p[0] < nx;
}

const V = {};

// ------------------------------------------------------------------- BEND
// One river out of the north, two swings, an island in the second bend, and an
// estuary opening to the south-east. The two banks were platted forty years
// apart off different meridians; at the bridges the grids collide, and that
// collision is the best ground in town.
V.bend = () => {
  const spine = smooth([
    [-260, 2600], [-190, 2100], [-70, 1700], [180, 1380], [400, 1030],
    [420, 660], [230, 340], [-90, 60], [-330, -260], [-360, -640],
    [-180, -1020], [140, -1330], [560, -1560], [1050, -1760], [1600, -1980],
  ]);
  const river = ribbon(spine, (t) => 120 + 230 * Math.pow(t, 1.7));
  const island = ribbon(spine.slice(Math.round(spine.length * 0.46), Math.round(spine.length * 0.74)),
    (t) => 62 * Math.sin(Math.PI * Math.min(1, Math.max(0, t))) + 16);
  const basin = rectAround(1080, -560, 560, 260, -12);
  const canal = ribbon(smooth([[-1500, 1200], [-1150, 700], [-980, 120], [-1010, -520], [-1180, -1100]]), 26);
  return {
    name: "Ironwater · the Bend", slug: "ironwater-bend",
    waters: [river, basin, canal], island, spines: [spine],
    rivers: [{ spine, hw: (t) => 120 + 230 * Math.pow(t, 1.7) }],
    blobs: [basin, canal],
    grids: [
      { key: "west", bearingDeg: 14, uPitch: 196, wPitch: 90, warp: 9, uRange: [-3100, 3100], wRange: [-3100, 3100] },
      { key: "east", bearingDeg: -21, uPitch: 228, wPitch: 104, warp: 7, uRange: [-3100, 3100], wRange: [-3100, 3100] },
    ],
    sectorOf: (p) => (westOf(spine, p) ? "west" : "east"),
    quayDist: (p) => sideOf(spine, p).d,
    reach: 2150,
    parks: [
      rectAround(-1350, 780, 600, 430, 14), rectAround(1560, 660, 500, 680, -20),
      rectAround(-620, -1500, 680, 330, 8), circleRing(150, 520, 110, 24),
    ],
    cores: [
      { xy: [-330, -180], w: 1.0, r: 360 }, { xy: [430, -430], w: 0.74, r: 340 },
      { xy: [150, 520], w: 0.38, r: 260 }, { xy: [-820, 780], w: 0.32, r: 300 },
      { xy: [1080, -560], w: 0.28, r: 280 },
    ],
    bridges: [
      { xy: [-120, 30], deg: 42, len: 500 }, { xy: [280, 800], deg: -70, len: 400 },
      { xy: [-250, -450], deg: 18, len: 440 }, { xy: [520, -1420], deg: -34, len: 680 },
    ],
    boulevards: [[[-780, 300], 16, 19], [[960, -240], -19, 19]],
    stations: [
      ["Bridge Head West", "A C 1", [-330, -180], 100], ["Bridge Head East", "A C 2", [430, -430], 88],
      ["Isle Row", "A", [150, 520], 52], ["Foundry", "1", [-820, 780], 56],
      ["Old Mint", "1", [-1180, -160], 44], ["Meridian Row", "2", [1050, 240], 50],
      ["Dock Basin", "2", [1080, -560], 42], ["Estuary", "C", [-620, -1500], 34],
      ["East Park", "3", [1560, 660], 36], ["West Commons", "3", [-1350, 780], 34],
      ["North Reach", "C", [-80, 1900], 26],
    ],
    labels: [
      ["WEST BANK", "district", [-950, 220]], ["EAST BANK", "district", [1100, -260]],
      ["THE ISLE", "district", [200, 700]], ["DOCK BASIN", "district", [1080, -560]],
      ["Ironwater River", "water", [-60, 1500]], ["The Estuary", "water", [1300, -2050]],
      ["West Commons", "park", [-1350, 780]], ["East Park", "park", [1560, 660]],
    ],
    landmark: { ring: rectAround(-430, -140, 17, 17, 14), top: 76 },
  };
};

// ------------------------------------------------------------------ FORKS
// Two rivers come down out of the hills and meet head-on. The wedge of land
// between them narrows to a point, and the point is downtown — three
// waterfronts on a site you can walk across in ten minutes. Every other
// district is across a bridge from it, which makes the bridges the whole game.
V.forks = () => {
  const north = smooth([[-2500, 2300], [-1700, 1750], [-1050, 1250], [-560, 800], [-230, 420], [-40, 120], [40, -160]]);
  const east = smooth([[2600, 2100], [1800, 1620], [1150, 1150], [640, 740], [280, 380], [80, 90], [40, -160]]);
  const trunk = smooth([[40, -160], [10, -620], [-60, -1100], [-190, -1650], [-380, -2300]]);
  const nRiver = ribbon([...north, ...trunk.slice(1)], (t) => 92 + 150 * t);
  const eRiver = ribbon([...east, ...trunk.slice(1)], (t) => 84 + 150 * t);
  const inWedge = (p) => sideOf(north, p).side < 0 && sideOf(east, p).side > 0 && p[1] < 2000;
  return {
    name: "Ironwater · the Forks", slug: "ironwater-forks",
    waters: [nRiver, eRiver], island: null, spines: [north, east, trunk],
    rivers: [
      { spine: [...north, ...trunk.slice(1)], hw: (t) => 92 + 150 * t },
      { spine: [...east, ...trunk.slice(1)], hw: (t) => 84 + 150 * t },
    ],
    blobs: [],
    grids: [
      { key: "point", bearingDeg: -4, uPitch: 168, wPitch: 78, warp: 5, uRange: [-1600, 1600], wRange: [-2900, 1600] },
      { key: "northshore", bearingDeg: 33, uPitch: 214, wPitch: 96, warp: 10, uRange: [-3200, 3200], wRange: [-3200, 3200] },
      { key: "eastshore", bearingDeg: -35, uPitch: 208, wPitch: 94, warp: 9, uRange: [-3200, 3200], wRange: [-3200, 3200] },
    ],
    sectorOf: (p) => {
      if (inWedge(p)) return "point";
      return sideOf(north, p).side > 0 ? "northshore" : "eastshore";
    },
    quayDist: (p) => Math.min(sideOf(north, p).d, sideOf(east, p).d, sideOf(trunk, p).d),
    reach: 2200,
    parks: [
      circleRing(-70, -420, 150, 28),                 // the confluence green, right at the tip
      rectAround(-1500, 1450, 620, 420, 33), rectAround(1620, 1150, 560, 420, -35),
      rectAround(-820, -1900, 700, 360, 6), rectAround(760, -1500, 420, 520, -10),
    ],
    cores: [
      { xy: [-60, -260], w: 1.0, r: 420 }, { xy: [-120, -820], w: 0.60, r: 340 },
      { xy: [-760, 900], w: 0.40, r: 320 }, { xy: [820, 640], w: 0.38, r: 320 },
      { xy: [-1500, 1450], w: 0.20, r: 300 },
    ],
    bridges: [
      { xy: [-420, 640], deg: 33, len: 320 }, { xy: [-980, 1180], deg: 33, len: 300 },
      { xy: [520, 560], deg: -35, len: 300 }, { xy: [1080, 1020], deg: -35, len: 300 },
      { xy: [-30, -900], deg: 84, len: 380 }, { xy: [-230, -1720], deg: 76, len: 460 },
    ],
    boulevards: [[[0, 0], -4, 22], [[-1000, 1200], 33, 18], [[1050, 900], -35, 18]],
    stations: [
      ["The Point", "1 2 3", [-60, -300], 100], ["Confluence", "1 2", [-90, -680], 76],
      ["North Bridge", "2", [-420, 640], 58], ["East Bridge", "3", [520, 560], 56],
      ["Northshore", "2", [-1080, 1220], 46], ["Eastshore", "3", [1120, 960], 44],
      ["Trunk Wharf", "1", [-150, -1450], 40], ["Mill Bend", "4", [-1620, 1600], 30],
      ["Hollow Run", "4", [1700, 1300], 28], ["South Reach", "1", [-380, -2150], 26],
    ],
    labels: [
      ["THE POINT", "district", [-60, -560]], ["NORTHSHORE", "district", [-1250, 1350]],
      ["EASTSHORE", "district", [1350, 1080]], ["North Fork", "water", [-1500, 1050]],
      ["East Fork", "water", [1550, 1000]], ["Ironwater River", "water", [-260, -2000]],
      ["Confluence Green", "park", [-70, -420]],
    ],
    landmark: { ring: circleRing(-70, -300, 14, 16), top: 84 },
  };
};

// ---------------------------------------------------------------- NARROWS
// A tidal strait: wide at both ends, pinched to three hundred metres in the
// middle. The two banks stare at each other across the neck, so the whole city
// is built end-on to the water, and a single crossing at the pinch carries
// everything. A barrier spit shelters the southern harbour.
V.narrows = () => {
  const spine = smooth([
    [-140, 2900], [-90, 2200], [-40, 1600], [10, 1050], [40, 560],
    [30, 120], [-20, -340], [-90, -880], [-120, -1450], [-80, -2100], [40, -2800],
  ]);
  const width = (t) => {
    const pinch = Math.exp(-Math.pow((t - 0.46) / 0.13, 2));   // the neck
    return 470 - 320 * pinch;
  };
  const river = ribbon(spine, width);
  const spit = ribbon(smooth([[-1500, -2050], [-800, -2250], [-100, -2330], [620, -2280]]), 52);
  return {
    name: "Ironwater · the Narrows", slug: "ironwater-narrows",
    waters: [river, spit].slice(0, 1), island: spit, spines: [spine],
    rivers: [{ spine, hw: width }],
    blobs: [],
    grids: [
      { key: "west", bearingDeg: 4, uPitch: 182, wPitch: 84, warp: 6, uRange: [-3300, 3300], wRange: [-3300, 3300] },
      { key: "east", bearingDeg: -46, uPitch: 200, wPitch: 92, warp: 8, uRange: [-3500, 3500], wRange: [-3500, 3500] },
    ],
    sectorOf: (p) => (westOf(spine, p) ? "west" : "east"),
    quayDist: (p) => sideOf(spine, p).d,
    reach: 2250,
    parks: [
      rectAround(-1450, 520, 560, 620, 4), rectAround(1350, 300, 520, 640, -46),
      rectAround(-380, -2050, 900, 300, 6), circleRing(-900, 1750, 320, 30),
    ],
    cores: [
      { xy: [-380, 120], w: 1.0, r: 380 },      // the west head of the crossing
      { xy: [330, 60], w: 0.86, r: 360 },       // and the east head, staring back
      { xy: [-620, -1100], w: 0.36, r: 320 }, { xy: [760, -900], w: 0.32, r: 300 },
      { xy: [-820, 1450], w: 0.26, r: 320 },
    ],
    bridges: [
      { xy: [10, 90], deg: 84, len: 340 },        // the crossing at the neck
      { xy: [-40, 1250], deg: 86, len: 720 },
      { xy: [-100, -1250], deg: 80, len: 800 },
    ],
    boulevards: [[[-900, 0], 4, 21], [[900, -200], -46, 21]],
    stations: [
      ["West Head", "1 2 N", [-380, 120], 100], ["East Head", "1 3 N", [330, 60], 92],
      ["Neck Crossing", "N", [10, 90], 70], ["Ropewalk", "2", [-620, -1100], 46],
      ["Saltings", "3", [760, -900], 44], ["North Reach", "2", [-820, 1450], 40],
      ["East Green", "3", [1350, 300], 34], ["Spit Harbour", "1", [-380, -2050], 30],
      ["Long Field", "4", [-1450, 520], 32], ["Upper Strait", "4", [-100, 2300], 24],
    ],
    labels: [
      ["WEST HEAD", "district", [-600, 200]], ["EAST HEAD", "district", [620, -60]],
      ["THE SALTINGS", "district", [900, -1050]], ["The Narrows", "water", [-30, 700]],
      ["Ironwater Strait", "water", [-160, -1700]], ["The Spit", "district", [-380, -2280]],
    ],
    landmark: { ring: rectAround(-330, 180, 16, 16, 4), top: 80 },
  };
};

// ---------------------------------------------------------------------------
const cfg = (V[VARIANT] ?? V.bend)();

const cells = [];
for (const g of cfg.grids) {
  const WARP = makeWarp(rr);
  const th = (g.bearingDeg * Math.PI) / 180;
  const A = [Math.sin(th), Math.cos(th)], S = [Math.cos(th), -Math.sin(th)];
  const at = (u, w) => [u * S[0] + w * A[0], u * S[1] + w * A[1]];
  const U = [], W = [];
  for (let u = g.uRange[0]; u < g.uRange[1]; u += g.uPitch * rr(0.86, 1.18)) U.push(u);
  for (let w = g.wRange[0]; w < g.wRange[1]; w += g.wPitch * rr(0.84, 1.2)) W.push(w);
  const node = U.map((u) => W.map((w) => {
    const b = at(u, w);
    const [dx, dy] = WARP(b[0], b[1], g.warp);
    return [b[0] + dx + rr(-1.6, 1.6), b[1] + dy + rr(-1.6, 1.6)];
  }));
  for (let i = 0; i < U.length - 1; i++) {
    for (let j = 0; j < W.length - 1; j++) {
      const q = cleanRing([node[i][j], node[i + 1][j], node[i + 1][j + 1], node[i][j + 1]]);
      if (!q || q.length !== 4 || !isConvex(q)) continue;
      cells.push({ ring: q, tag: g.key });
    }
  }
}
// islands and spits are their own small fabric
if (cfg.island) {
  const out = [];
  splitCells(convexHull(cfg.island), () => rr(3000, 6800), 8, 1300, out, rr);
  for (const c of out) cells.push({ ring: c, tag: "isle" });
}

const PARK_FACES = cfg.parks.map((p) => outsideFaces(p, 8));
const WATER_OBST = (cfg.blobs ?? []).map((w) => {
  const hull = convexHull(w);
  return { ring: w, hull, faces: outsideFaces(hull, 5) };
});

const kept = [];
for (const cell of cells) {
  const c0 = centroid(cell.ring);
  if (Math.hypot(c0[0], c0[1]) > cfg.reach) continue;
  if (cell.tag !== "isle") {
    if (cfg.waters.some((w) => inRing(c0, w))) continue;
    if (cfg.island && inRing(c0, cfg.island)) continue;
    if (cfg.sectorOf(c0) !== cell.tag) continue;     // each bank keeps only its own ground
  }
  let ring = cell.ring;
  // rivers are trimmed segment-by-segment further down; only the compact water
  // bodies — a dock basin, a short cut — are convex enough to treat as blobs
  if (cell.tag !== "isle") {
    for (const o of WATER_OBST) {
      if (!ring) break;
      if (dist(centroid(ring), centroid(o.hull)) > 1600) continue;
      ring = avoidRegion(ring, o.faces, (p) => inRing(p, o.ring), 300);
    }
  }
  for (let i = 0; i < cfg.parks.length && ring; i++) {
    if (dist(centroid(ring), centroid(cfg.parks[i])) > 1500) continue;
    ring = avoidRegion(ring, PARK_FACES[i], (p) => inRing(p, cfg.parks[i]), 300);
  }
  if (!ring || polygonArea([ring]) < 380) continue;
  kept.push({ ...cell, ring });
}

// the banks: every cell cut back to its own waterline
let cut = kept;
for (const r of cfg.rivers) cut = trimToWater(cut, r.spine, (t) => r.hw(t) + 16, 320);

// the outline of the town, used to stop the boulevards at its edge
const TOWN_HULL = convexHull(cut.flatMap((c) => c.ring));

// the boulevards, and the surface they leave behind
const boulevardPavement = [];
for (const [p, deg, hw] of cfg.boulevards) {
  const th = (deg * Math.PI) / 180;
  const nx = Math.sin(th), ny = -Math.cos(th);
  const d0 = p[0] * nx + p[1] * ny;
  const R = cfg.reach;
  let strip = [
    [p[0] - R * Math.cos(th) - hw * nx, p[1] - R * Math.sin(th) - hw * ny],
    [p[0] + R * Math.cos(th) - hw * nx, p[1] + R * Math.sin(th) - hw * ny],
    [p[0] + R * Math.cos(th) + hw * nx, p[1] + R * Math.sin(th) + hw * ny],
    [p[0] - R * Math.cos(th) + hw * nx, p[1] - R * Math.sin(th) + hw * ny],
  ];
  // a boulevard that keeps going past the last building is a runway, not a
  // street — clip the surface to the outline of the built-up area
  for (const [fx, fy, fd] of outsideFaces(TOWN_HULL, 40)) {
    strip = strip && cleanRing(clipRingHalfPlane(strip, -fx, -fy, -fd) ?? []);
  }
  if (strip && strip.length >= 3) boulevardPavement.push(strip);
  void d0;
  cut = carveCorridor(cut, p, th, hw);
}

// ------------------------------------------------------------------ naming
const STREETS = {
  west: ["Towpath St", "Foundry Row", "Cutler St", "Gasworks Ln", "Rope Walk", "Old Mint St", "Cinder Way"],
  east: ["Meridian Row", "Ironwater Ave", "Alcott St", "Pearl Row", "Signal St", "Tannery Ln", "Draper Ave"],
  point: ["Wedge St", "Confluence Row", "Ferry Slip", "Pilot St", "Tidewater Walk", "Landing Ln"],
  northshore: ["Mill Bend Rd", "Kiln Row", "Bracken St", "Weir Ave", "Halyard St"],
  eastshore: ["Hollow Run", "Quarry Row", "Sable St", "Lockkeeper Ln", "Bellow Ave"],
  isle: ["Isle Row", "Mid-Stream Walk", "Lantern Ln", "Spit Rd"],
};
const heat = (p) => Math.min(1, cfg.cores.reduce((h, c) => h + c.w * Math.exp(-(dist(p, c.xy) ** 2) / (2 * c.r * c.r)), 0));

function districtOf(cell) {
  const c = centroid(cell.ring);
  if (cell.tag === "isle") return "isle";
  return cfg.quayDist(c) < 340 ? cell.tag + "quay" : cell.tag;
}

const blocks = insetBlocks(
  cut.map((cell) => {
    const d = districtOf(cell);
    return {
      ...cell, district: d,
      street: pick(STREETS[cell.tag] ?? STREETS.west),
      lane: cell.tag === "isle",
    };
  }),
  (cell) => (cell.tag === "isle" ? 5.5 : cell.district.endsWith("quay") ? 8 : 7),
  200,
);

const isQuay = (d) => d.endsWith("quay");

emitCity({
  name: cfg.name, slug: cfg.slug, seed: SEED, proj, rand, blocks,
  landRings: [{ outer: [[-6000, -6000], [6000, -6000], [6000, 6000], [-6000, 6000]], holes: cfg.waters }],
  piers: cfg.slug === "ironwater-bend" ? [rectAround(1080, -560, 640, 320, -12)] : [],
  parks: cfg.parks,
  extraPavement: boulevardPavement,
  stations: cfg.stations.map(([name, lines, xy, weight]) => ({ name, lines, xy, weight })),
  labels: cfg.labels.map(([name, labelKind, xy]) => ({ name, labelKind, xy })),
  trees: (() => {
    const t = [];
    for (const park of cfg.parks) {
      const c = centroid(park);
      for (let i = 0; i < 340; i++) {
        const q = [c[0] + rr(-460, 460), c[1] + rr(-400, 400)];
        if (inRing(q, park)) t.push(q);
      }
    }
    for (const w of cfg.waters) for (const p of w) if (rand() < 0.16) t.push(p);   // embankment planes
    return t;
  })(),
  deco: [
    cfg.landmark,
    // A bridge is a deck in the air with piers under it. Painted flat on the
    // ground it read as a sandbar with two towers standing on it.
    ...cfg.bridges.flatMap((b) => {
      const th = (b.deg * Math.PI) / 180;
      return [
        { ring: rectAround(b.xy[0], b.xy[1], b.len, 21, b.deg), top: 12.5, base: 9.5 },
        ...[-1, 1].map((k) => ({
          ring: rectAround(b.xy[0] + k * b.len * 0.31 * Math.cos(th), b.xy[1] + k * b.len * 0.31 * Math.sin(th), 11, 11, b.deg),
          top: 30,
        })),
        ...[-0.42, -0.14, 0.14, 0.42].map((k) => ({
          ring: rectAround(b.xy[0] + k * b.len * Math.cos(th), b.xy[1] + k * b.len * Math.sin(th), 7, 15, b.deg),
          top: 9.5,
        })),
      ];
    }),
    ...cfg.waters[0].filter((_, i) => i % 37 === 11).slice(0, 6).map((p, i) => ({
      ring: rectAround(p[0], p[1], 48, 10, i * 37), top: 4,   // barges
    })),
  ],
  heat,
  farFor: (d, h) => Math.round((isQuay(d) ? 13 : d === "isle" ? 8 : 8) * 10 + h * h * 190) / 10,
  // A TOWN in 2026. Better than half the frontage is still a yard or a
  // two-storey building — that is the inventory the century runs on.
  vacancyP: (d, h) => Math.min(0.86, Math.max(0.18, (d === "isle" ? 0.36 : isQuay(d) ? 0.32 : 0.46) * (0.5 + 0.95 * Math.pow(1 - h, 1.5)))),
  classTable: (d) => (isQuay(d) ? [["G1", .05], ["O3", .50], ["RM", .68], ["K2", .84], ["D0", 1]]
    : d === "isle" ? [["D0", .52], ["O3", .72], ["S1", .90], ["K2", 1]]
    : [["D0", .48], ["S1", .66], ["O3", .80], ["K2", .91], ["E9", 1]]),
  yearFor: (d) => Math.round(d === "isle" ? rr(1840, 1920) : d.startsWith("west") || d === "point" ? rr(1855, 1955) : rr(1885, 2005)),
  skylineFor: ({ district, heat: h, areaM2 }) => {
    const gate = isQuay(district) ? 1 : district === "isle" ? 0.2 : 0.3;
    if (areaM2 > 320 && rand() < Math.min(0.085, h * h * 0.18 * gate)) {
      return { floors: rr(8, 13) + h * h * rr(5, 14), coverage: rr(0.48, 0.64), floorH: 3.9 };
    }
    if (district === "isle") return { floors: rr(3, 5), coverage: rr(0.66, 0.84), floorH: 3.4 };
    return { floors: rr(2, 5) + h * 1.6, coverage: rr(0.6, 0.78), floorH: 3.7 };
  },
  lotOpt: (d) => (d === "isle" ? { target: () => rr(900, 1900), min: 380, maxDepth: 32, jitter: 8 }
    : { target: () => rr(2100, 5000), min: 760, maxDepth: 46, jitter: 6 }),
  fullBlockP: (d) => (isQuay(d) ? 0.11 : 0.05),
  landPsf: (h) => 60 + 400 * h,
});
