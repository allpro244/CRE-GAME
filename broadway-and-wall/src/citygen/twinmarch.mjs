// TWINMARCH — a written-down city, drawn so the demand can be read off the map.
//
// Two towns that grew into one: a harbour exchange at the head of a deep
// western bay, and a railhead town at the east end of the island, three
// kilometres apart, joined by one long market street that bends four times
// and crosses the Twinbourne at Halfway. Nothing here is historical — it is
// fiction, written down for the same reason Manhattan is: so every campaign
// is played on the same plat and a player can LEARN it. What the seed still
// moves is everything contingent: which lots are built on, how old and tall,
// who owns what, and what the market does.
//
// WHY THIS LAYOUT, measured against the levers the engine actually reads
// (build.mjs blends one demandScore per lot; nothing here touches the engine):
//
//   OFFICE   — heavy cores sit in core-flavour districts at both ends, so the
//              office ladder fires there and the office jobs those buildings
//              hold lift the score around them. Two peaks, not one hill.
//   RETAIL   — the Long Market and the radial roads are diagonals, the only
//              frontage signal; each bend leaves gores and a market square.
//   CENTRES  — Harbour and Railhead are three-line interchanges; Halfway is a
//              two-line stop at the bridge, the "second centre" term's bead.
//   WATER    — the water that is PRICED is the coast (the bay, the shore);
//              the river and the cut are scenery and lot geometry, because
//              build.mjs reads only the shoreline. That is stated, not hidden.
//   INDUSTRY — the wharves south of the bay and the goods yard past the
//              railhead are industrial-flavour: sheds, M zoning, and no shore
//              amenity, so housing does not outbid them for the waterfront.
//   HOUSING  — four residential quarters between the towns, split by the river
//              and the market street — the seams a resident would name — and
//              villa points out on both horns of the bay.
//
// Weights and reaches sit on the generated island's own scale (a civic seat
// sigma 245-340 m, a dock 200-230 m; weights 1.0 / 0.5-0.8 / 0.2-0.6), and no
// two cores overlap enough to sum onto coreHeat's min(1, ...) rail.
import { chaikinOpen, strokeRibbon, bufferAsCapsules, ellipseRing } from "./island.mjs";

export const TWINMARCH = "twinmarch";

const D2R = Math.PI / 180;
const round = (p) => [Math.round(p[0]), Math.round(p[1])];

// Lot conventions, the same tuples island.mjs uses: [min, max, depth,
// frontage spread, irregularity].
const LOT = {
  row:     [360, 820, 165, 34, 7],
  burgage: [360, 900, 165, 48, 15],
  fine:    [400, 950, 180, 26, 12],
  villa:   [500, 1150, 230, 20, 5],
  yard:    [850, 2500, 360, 52, 5],
};

// ------------------------------------------------------------- the coast
// Metres, x east, y north. A long island with one deep round bay biting into
// its west end — the harbour — and a soft, slightly irregular shore.
function coastRing() {
  const out = [];
  const harm = [[3, 0.05, 30], [5, 0.03, 0], [9, 0.012, 20]];
  for (let t = 194; t <= 526 + 1e-6; t += 4) {
    let f = 1;
    for (const [m, amp, ph] of harm) f += amp * Math.sin((m * t + ph) * D2R);
    out.push([2550 * f * Math.cos(t * D2R), 1150 * f * Math.sin(t * D2R)]);
  }
  // A round bay head, not a point: a sharp head left a strip of bare apron
  // between the water and the first block.
  out.push([-2300, 340], [-2050, 390]);
  for (let a = 105; a >= -105; a -= 15) out.push([-1760 + 400 * Math.cos(a * D2R), 400 * Math.sin(a * D2R)]);
  out.push([-2050, -390], [-2300, -340]);
  return out.map(round);
}

// ------------------------------------------------------------ geometry
const inPoly = (p, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
function densify(path, step = 8) {
  const out = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}
/** The run of a path from where it first enters the land to where it last leaves, with a short overhang. */
function trimToCoast(path, coast, over = 14) {
  const p = densify(path);
  const ins = p.map((q) => inPoly(q, coast));
  const i0 = ins.indexOf(true), i1 = ins.lastIndexOf(true);
  if (i0 < 0) return null;
  const ext = (a, b) => { const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [b[0] + ((b[0] - a[0]) / L) * over, b[1] + ((b[1] - a[1]) / L) * over]; };
  const out = p.slice(i0, i1 + 1);
  if (i0 > 0) out.unshift(ext(p[i0 + 1] ?? p[i0], p[i0]));
  if (i1 < p.length - 1) out.push(ext(p[i1 - 1] ?? p[i1], p[i1]));
  return out.filter((_, k) => k % 3 === 0 || k === out.length - 1);
}
/**
 * Water drawn the way island.mjs draws its creeks: one painted ribbon, and
 * straight reach-rectangles underneath for the lot cut, so the generator
 * banks, bridges and plants it like any other channel.
 */
function water(coast, name, kind, width, path, smooth, extra = {}) {
  const p = trimToCoast(chaikinOpen(path, smooth), coast);
  if (!p || p.length < 2) return [];
  const out = [];
  const ribbon = strokeRibbon(p, width);
  if (ribbon) out.push({ ring: ribbon.map(round), name, kind, ...extra });
  for (const ring of bufferAsCapsules(p, width)) out.push({ ring: ring.map(round), name, kind, paint: false, cut: true, ...extra });
  return out;
}
/** Offset an open polyline sideways by `d` metres (left of travel is positive). */
function offsetLine(path, d) {
  return path.map((p, i) => {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [Math.round((p[0] - ((b[1] - a[1]) / L) * d) * 10) / 10, Math.round((p[1] + ((b[0] - a[0]) / L) * d) * 10) / 10];
  });
}
/**
 * A RAILWAY: an eleven-metre ballast bed carrying two tracks 4.4 m apart
 * (a standard double-track formation), inside a twenty-metre corridor the
 * lots stop at, which is drawn as the grass lineside verge. The corridor goes in as a
 * cut-only stream of kind "rail" — an obstacle, nothing more: it is not
 * water, so it is not painted as water, not banked, and not in any demand
 * term.
 */
function railway(name, path) {
  const p = densify(chaikinOpen(path, 3), 10);
  const bed = strokeRibbon(p, 11);
  return {
    line: { name, bed: bed ? bed.map(round) : null, tracks: [offsetLine(p, 2.2), offsetLine(p, -2.2)] },
    cut: bufferAsCapsules(p, 20).map((ring) => ({ ring: ring.map(round), name, kind: "rail", paint: false, cut: true })),
  };
}

// ------------------------------------------------------- the district plan
// A cut through `at` at a line angle; the side the probe point falls on gets
// `a` — written by probe so a sign cannot come out backwards (manhattan.mjs).
function band(at, deg, aSide, a, b) {
  const t = deg * D2R;
  const nx = -Math.sin(t), ny = Math.cos(t);
  const c = [nx, ny, at[0] * nx + at[1] * ny];
  const onNeg = aSide[0] * nx + aSide[1] * ny <= c[2];
  return { cut: c, neg: onNeg ? a : b, pos: onNeg ? b : a };
}
/**
 * A BOX, not an ellipse. An ellipse of tangent cuts leaves its outside as a
 * ring of thin wedge leaves, and each wedge is filled on its own — the fan of
 * sliver lots that radiated from the harbour in the first draft. Four cuts
 * leave four big pieces.
 */
const box = (x0, x1, y0, y1, inner, outer) =>
  band([x0, 0], 90, [x0 - 10, 0], outer, band([x1, 0], 90, [x1 + 10, 0], outer,
    band([0, y0], 0, [0, y0 - 10], outer, band([0, y1], 0, [0, y1 + 10], outer, inner))));
/** A seam that follows a bent street: one straight cut per segment, chosen by x. */
function bentSeam(pts, northVal, southVal) {
  let node = null;
  for (let i = pts.length - 2; i >= 0; i--) {
    const a = pts[i], b = pts[i + 1];
    const seg = band(a, Math.atan2(b[1] - a[1], b[0] - a[0]) / D2R, [a[0], a[1] + 500], northVal, southVal);
    node = node ? band([b[0], 0], 90, [b[0] - 10, 0], seg, node) : seg;
  }
  return node;
}
const along = (path, key, v) => {
  const [i, j] = key === "x" ? [0, 1] : [1, 0];
  for (let k = 0; k < path.length - 1; k++) {
    const a = path[k], b = path[k + 1];
    if ((a[i] - v) * (b[i] - v) <= 0) return a[j] + ((v - a[i]) / (b[i] - a[i] || 1)) * (b[j] - a[j]);
  }
  return path[0][j];
};

// ---------------------------------------------------------------- pieces
const organic = (bearingDeg, extra = {}) => ({ flavor: "old", kind: "organic", bearingDeg, jitterDeg: 18, streetW: 8, cell: [1600, 3900], fullBlockP: 0.02, lot: LOT.burgage, ...extra });
const yards = (bearingDeg) => ({ flavor: "industrial", kind: "lattice", bearingDeg, stPitch: 90, avePitch: 170, streetW: 16, aveW: 20, warpAmp: 6, numbered: false, fullBlockP: 0.1, lot: LOT.yard });
const villas = (bearingDeg) => ({ flavor: "resi", kind: "curvi", bearingDeg, stPitch: 68, avePitch: 115, streetW: 12, aveW: 14, curveLen: 420, curveAmp: 75, fullBlockP: 0.02, lot: LOT.villa });
function rectRing(cx, cy, w, h, deg = 0) {
  const t = deg * D2R, c = Math.cos(t), s = Math.sin(t);
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
    .map(([x, y]) => [Math.round(cx + x * c - y * s), Math.round(cy + x * s + y * c)]);
}
const park = (name, cx, cy, w, h, deg = 0, flavour = "park") => ({ name, cx, cy, w, h, deg, flavour, ring: rectRing(cx, cy, w, h, deg) });
function boulevard(name, a, b, w) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  return { cx: Math.round((a[0] + b[0]) / 2), cy: Math.round((a[1] + b[1]) / 2), w: Math.round(Math.hypot(dx, dy)), h: w, deg: +(Math.atan2(dy, dx) / D2R).toFixed(1), name };
}
// WHAT MAKES A STATION BUSY is the platform, not the heat under it — the same
// rule and the same 30-90 scale island.mjs uses: thirty for a stop, twenty
// for each extra line, and a bump for a ferry or a wharf.
const station = (xy, name, lines) => ({
  xy: round(xy), name, lines,
  weight: 30 + (lines.split(" ").length - 1) * 20 + (/ferry/i.test(name) ? 14 : 0) + (/wharf|yard/i.test(name) ? 16 : 0),
});

// ------------------------------------------------------------ the config
const RIVER = [[330, 1400], [250, 1050], [380, 760], [260, 470], [330, 200], [290, 0], [360, -260], [210, -560], [330, -860], [230, -1400]];
// The bends are kept OFF the river, so each bridge carries a straight run of
// its road and can be squared to it.
const MARKET = [[-1150, 20], [-560, 90], [120, 45], [880, -40], [1360, 10]];
const RAIL = [[-1250, 330], [-650, 400], [80, 375], [620, 315], [1250, 170], [1500, 110], [1900, 80], [2150, -80], [2250, -380]];

export function twinmarchConfig(seed = 1) {
  const coast = coastRing();
  const rail = railway("Twinmarch & Harbour Railway", RAIL);
  const streams = [
    ...water(coast, "The Twinbourne", "river", 46, RIVER, 3, { embank: true }),
    ...water(coast, "Exchange Cut", "canal", 22, [[-1420, -150], [-1220, -260], [-960, -310]], 2, { embank: true }),
    { ring: ellipseRing(580, 1000, 120, 70, 48).map(round), name: "Halfway Mere", kind: "pond" },
    { ring: ellipseRing(-930, -310, 70, 45, 48).map(round), name: "Exchange Basin", kind: "pond" },
    ...rail.cut,
  ];

  const districts = {
    exchange: organic(6, { flavor: "core", cell: [1200, 3000], lot: LOT.fine, jitterDeg: 20 }),
    quayside: organic(28, { cell: [1400, 3300], jitterDeg: 16 }),
    lanternhill: villas(30),
    wharves: yards(-18),
    thepoint: villas(-30),
    northfield: organic(8, { flavor: "resi", jitterDeg: 12 }),
    millbank: organic(-6, { flavor: "resi", jitterDeg: 12 }),
    southfield: organic(-10, { flavor: "resi", jitterDeg: 12, cell: [1800, 4200], lot: LOT.row }),
    ferrybank: organic(12, { flavor: "resi", jitterDeg: 12 }),
    railhead: { flavor: "core", kind: "lattice", bearingDeg: 3, stPitch: 72, avePitch: 145, streetW: 14, aveW: 22, warpAmp: 12, numbered: true, fullBlockP: 0.05, lot: LOT.fine },
    newtown: { flavor: "resi", kind: "chamfer", regular: true, bearingDeg: 3, stPitch: 113, avePitch: 113, streetW: 20, aveW: 20, chamferAll: 0.215, warpAmp: 0, fullBlockP: 0.02 },
    goodsyard: yards(3),
  };
  const districtNames = {
    exchange: "The Exchange", quayside: "Quayside", lanternhill: "Lantern Hill", wharves: "The Wharves",
    thepoint: "The Point", northfield: "Northfield", millbank: "Millbank", southfield: "Southfield",
    ferrybank: "Ferrybank", railhead: "Railhead", newtown: "New Town", goodsyard: "Goods Yard",
  };

  // West: the harbour town in a box round the bay head, the quays north of
  // it, the wharves south, villas out on both points.
  const west = box(-1720, -820, -470, 480, "exchange",
    band([0, 0], 0, [0, 500],
      band([-1650, 0], 90, [-2000, 0], "lanternhill", "quayside"),
      band([-1950, 0], 90, [-2200, 0], "thepoint", "wharves")));
  // Middle: four quarters split by the river and the market street.
  const rx = along(RIVER, "y", 0);
  const mid = band([rx, 0], 90, [rx - 500, 0],
    bentSeam(MARKET.filter((p) => p[0] <= 400), "northfield", "southfield"),
    bentSeam(MARKET.filter((p) => p[0] >= 200), "millbank", "ferrybank"));
  // East: the railhead grid on the market street, Cerdà's new town north of
  // it, the goods yard south-east and out to the far point.
  const east = band([2050, 0], 90, [1500, 0],
    band([0, -420], 0, [0, 0],
      band([0, 520], 0, [0, 0], "railhead", "newtown"),
      band([1250, 0], 90, [1000, 0], "ferrybank", "goodsyard")),
    "goodsyard");
  const partition = band([-820, 0], 90, [-1500, 0], west, band([1060, 0], 90, [0, 0], mid, east));

  const diagonals = [];
  for (let i = 0; i < MARKET.length - 1; i++) diagonals.push(boulevard("The Long Market", MARKET[i], MARKET[i + 1], 28));
  diagonals.push(boulevard("Quay Street", [-1830, 520], [-1180, 380], 22));
  diagonals.push(boulevard("Old North Road", [-480, 100], [-950, 950], 22));
  diagonals.push(boulevard("Station Parade", [1500, -560], [1500, 680], 26));
  diagonals.push(boulevard("Ferry Road", [600, -20], [900, -900], 22));

  // The decks over the Twinbourne, each squared to the road it carries:
  // `deg` is set so the deck's long axis runs along the road, `w` is the
  // road's width (down the deck's u axis) and `h` spans the water and both
  // promenades so each end lands on the street.
  const crossing = (path, name, roadW, extra = {}) => {
    const x = along(RIVER, "y", along(path, "x", along(RIVER, "y", 0)));
    const y = along(path, "x", x);
    let k = 0;
    while (k < path.length - 2 && path[k + 1][0] < x) k++;
    const a = path[k], b = path[k + 1];
    const roadDeg = Math.atan2(b[1] - a[1], b[0] - a[0]) / D2R;
    // how obliquely the road meets the river stretches the span
    const flow = Math.atan2(40, along(RIVER, "y", y + 20) - along(RIVER, "y", y - 20)) / D2R;
    const sin = Math.abs(Math.sin((roadDeg - flow) * D2R)) || 1;
    return { cx: Math.round(x), cy: Math.round(y), w: roadW, h: Math.round(64 / sin), deg: +(roadDeg - 90).toFixed(1), name, deck: true, ...extra };
  };
  const bridges = [
    crossing(MARKET, "Halfway Bridge", 30),
    crossing(RAIL, "Railway Bridge", 13, { type: "rail" }),
  ];

  const parks = [
    park("Exchange Square", -1180, 140, 100, 70, 6, "market"),
    park("Halfway Market", 120, 170, 120, 70, -4, "market"),
    park("Bend Market", -560, 210, 90, 60, 7, "market"),
    park("Station Square", 1400, -150, 110, 80, 3, "market"),
    park("Mere Gardens", 720, 1000, 380, 170, 0),
    park("Halfway Green", -150, -560, 260, 130, -10),
    park("Northfield Common", -350, 800, 220, 120, 8),
    park("Ferry Green", 900, -650, 160, 100, 12),
    park("North Hill Cemetery", 900, 850, 200, 110, -6, "cemetery"),
    park("Bay Battery", -2030, 620, 140, 80, 20, "battery"),
    park("Railway Gardens", 1700, 820, 220, 110, 3),
  ];
  // cores[0] is FOUNDED — the origin of the building-age gradient — and the
  // harbour is the older of the two towns.
  const cores = [
    { xy: [-1180, 30], w: 0.95, r: 340, role: "Harbour Exchange" },
    { xy: [1500, 0], w: 0.80, r: 300, role: "Railhead" },
    { xy: [2150, -450], w: 0.60, r: 230, role: "Goods Yard" },
    { xy: [-1500, -700], w: 0.56, r: 200, role: "The Wharves" },
    { xy: [200, 60], w: 0.42, r: 250, role: "Halfway" },
    { xy: [-1500, 720], w: 0.30, r: 240, role: "Quayside" },
    { xy: [-560, 120], w: 0.26, r: 200, role: "Market Bend" },
    { xy: [1450, 800], w: 0.26, r: 250, role: "New Town" },
    { xy: [-300, -800], w: 0.20, r: 250, role: "Southfield" },
  ];
  const stations = [
    station([-1180, 30], "Harbour Ferry", "1 2 3"), station([1500, 0], "Railhead", "1 2 3"),
    station([200, 60], "Halfway", "1 2"), station([-560, 100], "Market Bend", "1"),
    station([880, -40], "Ferry Road", "1"), station([2150, -450], "Goods Yard", "3"),
    station([-1500, 720], "Quayside", "2"), station([-1500, -700], "Wharf", "3"),
    station([720, 850], "Mere", "2"), station([-300, -800], "Southfield", "3"),
    station([1450, 800], "New Town", "2"),
  ];
  const labels = [
    ...cores.map((c) => ({ xy: c.xy, name: c.role.toUpperCase(), labelKind: "district" })),
    ...parks.map((p) => ({ xy: [p.cx, p.cy], name: p.name, labelKind: "park" })),
    { xy: [-1800, 0], name: "Exchange Bay", labelKind: "water" },
    { xy: [330, -300], name: "The Twinbourne", labelKind: "water" },
    { xy: [0, -1450], name: "The Narrow Sea", labelKind: "water" },
  ];

  return {
    name: "Twinmarch",
    district: TWINMARCH, abbr: "TM", seed: seed >>> 0,
    // Open water in the Gulf of Maine: a centre for the map projection and
    // nowhere anybody has drawn a city.
    center: [-69.4, 42.6],
    coast, coastAmp: 12, smooth: 1, esplanade: 18,
    lighthouse: [-2500, -300],
    cores, partition, districts, districtNames, parks, diagonals, streams, bridges,
    railways: [rail.line],
    piers: [], cranes: [], ships: [], breakwaters: [],
    stations, labels,
    avenues: ["The Long Market", "Station Parade", "Quay Street", "Harbour Road", "Mere Road", "Railway Street"],
    streets: {
      default: ["High St", "Market St", "Bridge St", "Mill St", "Water St", "Church St"],
      exchange: ["Counting House Ln", "Bullion St", "Charter St", "Customs St", "Anchor St", "Tide St", "Exchange Alley", "Bourse St"],
      quayside: ["Cooper's Row", "Netmender's Walk", "Chandler St", "Ropewalk", "Salt Ln", "Herring Steps"],
      wharves: ["Dock Rd", "Crane St", "Bonded Store Ln", "Capstan St", "Slipway"],
      northfield: ["Orchard St", "Hayward St", "Barley St", "Meadow Ln", "Plough St"],
      millbank: ["Weir St", "Millrace", "Sluice Ln", "Wheelwright St", "Miller's Row"],
      southfield: ["Fenn St", "Reed St", "Osier Ln", "Heron St", "Sedge St"],
      ferrybank: ["Ferry Ln", "Boatman's Row", "Towpath", "Wherry St", "Landing St"],
      railhead: ["Platform St", "Signal St", "Junction Rd", "Coupling St", "Viaduct St"],
      newtown: ["Union St", "Commerce St", "Progress St", "Liberty St", "Union Sq"],
      goodsyard: ["Siding Rd", "Freight St", "Turntable Ln", "Coal Drop Rd"],
    },
    plan: { harbour: [-1360, 0], cove: [-2300, 330], headland: [-2500, -300], landmark: "roundhouse", seams: 0 },
  };
}

export function twinmarchName() { return "Twinmarch"; }

/** Designed whole: one extent. */
export const TWINMARCH_EXTENTS = {
  whole: { name: "The whole island",
    note: "Two towns and the market street between them: a harbour exchange, a railhead, a river, a railway and twelve districts. About ten thousand lots." },
};
