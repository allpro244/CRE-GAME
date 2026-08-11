// TWO HARNESS FIXTURES, and nothing a player can reach. See the note on the
// CITIES export at the bottom of this file before you touch either of them, or
// before you add a third: the game generates its island now, and a config
// written down by hand is the reason the parks never changed.
//
// Each is a config for pipeline/lib/citygen.mjs — same generator, same
// guarantees, different geography. They are both roughly New Alden's size,
// which is the scale where a player can hold the whole market in their head:
// about two miles end to end, four neighbourhoods, some fourteen hundred lots.
//
// The district plan of each is a BSP tree, so the leaves tile the plane and
// the map cannot have a hole in it. Cuts are written with the helper below
// rather than as raw half-planes, because `cut(0, -330, 0)` — a line through
// (0, -330) running due east — is something a person can picture, and
// `[0, 1, -330]` is not.

// A cut through (px, py) travelling at `deg` (0 = east, 90 = north).
// `neg` is the LEFT-HAND side of that travel; `pos` is the right.
// Exported because island.mjs writes its partitions with it too — a generated
// island's district plan has to be the same kind of object as a hand-drawn
// one's, and that starts with being cut by the same helper.
export const cut = (px, py, deg) => {
  const t = (deg * Math.PI) / 180;
  const nx = Math.sin(t), ny = -Math.cos(t);
  return [nx, ny, px * nx + py * ny];
};

// --- 1. KESTREL POINT -------------------------------------------------------
// A long peninsula between two rivers, running north to south — about a mile
// of land and never much more than half of that across. The old town is jammed
// onto the toe where the ships came in, the surveyors' grid marches up behind
// it, and one colonial road cuts the grid at an angle nobody has been able to
// undo since. Numbered cross streets, east and west addresses. The one where
// frontage is scarcest, and the closest of the two to Manhattan.
const kestrel = {
  name: "Kestrel Point", district: "kestrel", abbr: "KP", seed: 30411,
  center: [-70.9, 41.1],
  coast: [
    [-154, -780], [-384, -690], [-454, -500], [-410, -320], [-493, -120],
    [-442, 110], [-506, 330], [-410, 510], [-454, 690], [-314, 850],
    [-38, 925], [250, 890], [422, 745], [378, 555], [448, 355],
    [384, 135], [454, -85], [410, -295], [474, -495], [314, -680], [70, -785],
  ],
  coastAmp: 40, esplanade: 24,
  cores: [
    { xy: [40, -520], w: 1.0, r: 250 },    // the Battery, at the toe
    { xy: [-20, -110], w: 0.62, r: 300 },  // the Exchange
    { xy: [10, 380], w: 0.22, r: 260 },    // midtown
    { xy: [-250, -60], w: 0.10, r: 180 },  // the docks
  ],
  partition: {
    cut: cut(0, -330, 0), pos: "harborside",
    neg: {
      cut: cut(0, 260, 0), pos: { cut: cut(-160, 0, 90), neg: "westdocks", pos: "exchange" },
      neg: { cut: cut(0, 500, 0), neg: "northside", pos: "exchange" },
    },
  },
  districts: {
    harborside: { kind: "organic", flavor: "old", cell: [3200, 7400], jitterDeg: 17, streetW: 10, fullBlockP: 0.02 },
    westdocks:  { kind: "lattice", flavor: "industrial", bearingDeg: -8, stPitch: 92, avePitch: 236, streetW: 16, aveW: 26, warpAmp: 8, fullBlockP: 0.11 },
    exchange:   { kind: "lattice", flavor: "core", bearingDeg: 3, stPitch: 68, avePitch: 196, streetW: 14, aveW: 26, warpAmp: 2, numbered: true, fullBlockP: 0.05 },
    northside:  { kind: "lattice", flavor: "resi", bearingDeg: 3, stPitch: 58, avePitch: 152, streetW: 12, aveW: 20, warpAmp: 3, numbered: true, fullBlockP: 0.02 },
  },
  parks: [
    { cx: -40, cy: 60, w: 250, h: 190, deg: 3, name: "Kestrel Common" },
    { cx: 60, cy: -540, w: 85, h: 85, deg: 3, name: "Battery Square" },
    { cx: -60, cy: 620, w: 150, h: 90, deg: 3, name: "Ardmore Green" },
  ],
  diagonals: [{ cx: -30, cy: 190, w: 1020, h: 25, deg: 108 }],
  piers: [
    [[-360, -160], [-470, -186], [-474, -150], [-364, -124]],
    [[-350, 180], [-460, 164], [-463, 200], [-353, 216]],
    [[330, 200], [440, 186], [443, 222], [333, 236]],
    [[320, -380], [430, -400], [436, -364], [326, -344]],
  ],
  cranes: [[-390, -60, 15], [-386, 90, 95]],
  ships: [[130, -880, 70], [-470, 420, 100]],
  breakwaters: [[100, -960, 200, 14, 8]],
  stations: [
    { name: "Battery", lines: "1 A", xy: [40, -520], weight: 100 },
    { name: "Custom House", lines: "A", xy: [180, -350], weight: 44 },
    { name: "Exchange Pl", lines: "1 2", xy: [-20, -180], weight: 84 },
    { name: "Kestrel Common", lines: "1 2 A", xy: [-40, 60], weight: 88 },
    { name: "Midtown", lines: "1", xy: [10, 330], weight: 58 },
    { name: "Ardmore", lines: "1 2", xy: [-60, 620], weight: 42 },
    { name: "Uptown", lines: "2", xy: [40, 820], weight: 28 },
    { name: "West Dock", lines: "W", xy: [-270, -40], weight: 24 },
  ],
  labels: [
    { name: "HARBORSIDE", labelKind: "district", xy: [30, -560] },
    { name: "THE EXCHANGE", labelKind: "district", xy: [110, -120] },
    { name: "NORTHSIDE", labelKind: "district", xy: [30, 700] },
    { name: "WEST DOCKS", labelKind: "district", xy: [-280, 20] },
    { name: "Kestrel Common", labelKind: "park", xy: [-40, 60] },
    { name: "Battery Square", labelKind: "park", xy: [60, -540] },
    { name: "Kestrel Bay", labelKind: "water", xy: [60, -930] },
    { name: "West River", labelKind: "water", xy: [-560, 120] },
    { name: "East River", labelKind: "water", xy: [540, 60] },
  ],
  avenues: ["The Boulevard", "Kestrel Ave", "Ardmore Ave", "Vesey Ave", "Trinity Ave", "Cortland Ave", "Park Ave"],
  streets: {
    harborside: ["Water St", "Front St", "Beaver St", "Stone St", "Coenties Slip", "Pearl St", "Gouverneur Ln", "Hanover Row"],
    westdocks: ["Drydock Ave", "Gantry St", "Cooperage Rd", "Packet St", "Chandlery Row", "Ferry Slip"],
    northside: ["Ardmore St", "Bellamy St", "Corliss St", "Delafield St", "Ellsworth St", "Fanshaw St"],
    default: ["Market St", "Church St", "Mill St", "Bridge St"],
  },
};

// --- 2. NEW ALDEN -----------------------------------------------------------
// The original — the city the game shipped with, ported onto this generator so
// it keeps its geography (the Landing at the harbor, the numbered midtown grid,
// Broadway cutting it at thirty-eight degrees, the brownstones arguing with
// downtown the way Back Bay does) but gains the no-holes guarantee the old
// hand-written region boxes never had. Same seed, same bones.
const newalden = {
  name: "New Alden", district: "newalden", abbr: "AP", seed: 20261,
  center: [-70.9, 41.1],
  coast: [
    [-880, -60], [-920, 200], [-810, 430],
    [-460, 610], [40, 680], [470, 600],
    [750, 420], [890, 150],
    [860, -110], [660, -290],
    [420, -350], [250, -215], [90, -330],
    [-190, -370], [-540, -310], [-780, -210],
  ],
  coastAmp: 18, esplanade: 26,
  cores: [
    { xy: [300, -40], w: 1.0, r: 260 },   // where the Landing meets the grid
    { xy: [30, 190], w: 0.55, r: 300 },   // midtown
    { xy: [-360, 470], w: 0.16, r: 220 }, // the brownstones
    { xy: [-700, 60], w: 0.10, r: 200 },  // the wharves
  ],
  // The old REGION boxes, restated as a BSP so they tile. Exchange shows up as
  // three leaves (west of, east of, and north of the Landing) — same district,
  // same lattice, so its streets stay in register across all three.
  partition: {
    cut: cut(-560, 0, 90), neg: "millside",
    pos: {
      cut: cut(0, 330, 0), neg: "northside",
      pos: {
        cut: cut(110, 0, 90), neg: "exchange",
        pos: {
          cut: cut(680, 0, 90), pos: "exchange",
          neg: { cut: cut(0, 30, 0), neg: "exchange", pos: "oldharbor" },
        },
      },
    },
  },
  districts: {
    oldharbor: { kind: "organic", flavor: "old", cell: [3400, 8200], jitterDeg: 15, streetW: 9, fullBlockP: 0.02 },
    exchange:  { kind: "lattice", flavor: "core", bearingDeg: 4, stPitch: 72, avePitch: 205, streetW: 15, aveW: 27, warpAmp: 2, numbered: true, fullBlockP: 0.05 },
    northside: { kind: "lattice", flavor: "resi", bearingDeg: -18, stPitch: 58, avePitch: 148, streetW: 13, aveW: 20, warpAmp: 4, fullBlockP: 0.02 },
    millside:  { kind: "lattice", flavor: "industrial", bearingDeg: -34, stPitch: 96, avePitch: 255, streetW: 17, aveW: 28, warpAmp: 9, fullBlockP: 0.11 },
  },
  parks: [
    { cx: -50, cy: 130, w: 330, h: 230, deg: 4, name: "Alden Common" },
    { cx: 300, cy: -30, w: 85, h: 85, deg: 4, name: "Landing Square" },
    { cx: -340, cy: 500, w: 150, h: 85, deg: 4, name: "Calvert Green" },
  ],
  diagonals: [{ cx: -125, cy: 255, w: 900, h: 27, deg: 134.5 }],
  piers: [
    [[180, -300], [150, -420], [185, -428], [215, -308]],
    [[340, -300], [320, -430], [355, -438], [375, -308]],
    [[520, -290], [545, -400], [578, -390], [553, -280]],
    [[-350, -340], [-360, -450], [-322, -455], [-312, -345]],
    [[-830, 60], [-950, 40], [-953, 75], [-833, 95]],
    [[-800, 280], [-915, 300], [-910, 335], [-795, 315]],
  ],
  cranes: [[-860, -140, 25], [-880, 180, 85]],
  ships: [[300, -520, 75], [640, -480, 30], [-500, -520, 100]],
  breakwaters: [[560, -450, 160, 13, 35]],
  stations: [
    { name: "Landing Square", lines: "1 A", xy: [300, -40], weight: 100 },
    { name: "Alden Common", lines: "1 2", xy: [70, 130], weight: 85 },
    { name: "Custom House", lines: "A", xy: [520, -150], weight: 45 },
    { name: "Midtown", lines: "1 2", xy: [-30, 340], weight: 60 },
    { name: "Uptown", lines: "1", xy: [130, 520], weight: 40 },
    { name: "Calvert Green", lines: "2", xy: [-330, 470], weight: 40 },
    { name: "Wharf Gate", lines: "W 2", xy: [-560, 190], weight: 30 },
    { name: "Drydock", lines: "W", xy: [-760, -60], weight: 22 },
  ],
  labels: [
    { name: "THE LANDING", labelKind: "district", xy: [400, -160] },
    { name: "MIDTOWN", labelKind: "district", xy: [-60, 300] },
    { name: "THE BROWNSTONES", labelKind: "district", xy: [-120, 520] },
    { name: "THE WHARVES", labelKind: "district", xy: [-720, 130] },
    { name: "Alden Common", labelKind: "park", xy: [-50, 130] },
    { name: "Landing Square", labelKind: "park", xy: [300, -30] },
    { name: "Calvert Green", labelKind: "park", xy: [-340, 500] },
    { name: "New Alden Harbor", labelKind: "water", xy: [250, -560] },
    { name: "Alden River", labelKind: "water", xy: [-1120, 180] },
  ],
  avenues: ["Broadway", "Alden Ave", "Commonwealth Ave", "Tremont Ave", "Lexington Ave", "Bowery Ave", "Park Ave"],
  streets: {
    oldharbor: ["Union St", "Milk St", "State St", "Dock Sq", "Batterymarch", "India Row", "Pearl St", "Broad St", "Sloop Alley", "Oliver Ln", "Custom House St", "Salem Row"],
    millside: ["Drydock Ave", "Gantry St", "Cooperage Rd", "Chandlery Row", "Packet St", "Fulton Wharf", "Caulkers Ln"],
    northside: ["Ashby St", "Bancroft St", "Calvert St", "Denholm St", "Everett St", "Fenwick St", "Granby St", "Hartwell St"],
    default: ["Market St", "Church St", "Mill St"],
  },
};

// --- 3. NEW YORK ------------------------------------------------------------
// Manhattan, at the scale this game plays at. Everything that makes the island
// what it is, is here and is here for a reason: a long narrow rock running
// north-north-east between two rivers; a tangle of colonial lanes at the toe
// that no surveyor ever straightened; the Commissioners' grid slammed down
// above it in one stroke in 1811, numbered and relentless; Broadway, the old
// Wickquasgeck trail, cutting across that grid at an angle and making a public
// square at every crossing; and eight hundred acres of park in the middle that
// nobody is ever allowed to build on. The scarce thing here is the same thing
// it is in life — a full block on the avenue grid.

// --- 4. CHICAGO -------------------------------------------------------------
// The flat one. No island, no peninsula, no natural constraint at all except a
// lake on the east that the city refuses to build on — so the grid runs
// unbroken to the horizon in the other three directions, which is exactly what
// makes it a different game. The river forks just north-west of the core and
// splits the town into three sides; the Loop is the tightest and most valuable
// rectangle on the map because the elevated tracks draw a box around it and
// everybody knows where the box is; and the lakefront is a mile of park by law.
// Land is not scarce here. Location is.

// --- 5. BOSTON --------------------------------------------------------------
// The oldest and the strangest. Boston is a city built on a peninsula so
// narrow it was nearly an island, and then made twice its size by filling in
// the bay — so it has two street plans that have nothing to do with each
// other. The original town is a knot of cowpaths that never once agreed to be
// straightened; Back Bay, filled and laid out in the 1850s, is the most formal
// grid in America, alphabetical and dead straight. Between them sits the
// Common, the oldest public park in the country. Nothing here is at right
// angles to anything else, and that is the game.

// Kept for the harnesses that print which fixture they ran on. Not a picker
// blurb any more — there is no picker; see CITIES below.
export const TAGLINES = {
  newalden: "Harness fixture. A colonial landing, a numbered grid, and Broadway cutting both.",
  kestrel: "Harness fixture. A narrow peninsula where frontage is the scarce thing.",
};

// NO CITIES, ONLY FIXTURES.
//
// Six traced maps became two drawn ones became none. The last step is the one
// worth writing down, because these two configs are still here and it would be
// easy to mistake them for content.
//
// THEY ARE NOT PLAYABLE. `cityList()` offers one island and it is generated.
// What finally disqualified these two was measurable: across five seeds each,
// every part of the plan rerolled — lot lines, building heights, lot counts —
// except the parks, which are literals forty lines above this comment. Every
// campaign anybody ever played on New Alden had the same three parks in the
// same three places, the largest carrying 79% of the island's green. The
// generator grew five park programmes to fix exactly that fault (island.mjs,
// "WHAT KIND OF PARK CITY THIS IS") and a hand-written config cannot use one.
//
// The same went for the street plans. Six district kinds exist; these two use
// lattice and organic, so curvi, radial, chamfer and superblock had never
// appeared in a game anybody played. A generated island runs three distinct
// kinds in the median town.
//
// WHAT THEY ARE NOW is the fixed reference town for the harnesses. `pnpm
// baseline` measures ~31 standing numbers on `makeCity("newalden", 1)` and
// fourteen probes default to it; a baseline whose town moves underneath it is
// not a baseline. `makeCity` still builds them by id and always will. If you
// are here to add a city, do not — add it to the generator instead, where
// every seed gets it.
export const CITIES = { newalden, kestrel };

/**
 * HOW BIG THIS TOWN IS — and the one thing that must NOT change with it.
 *
 * A bigger island is more blocks, not bigger blocks. Manhattan's blocks are
 * the same size as a small town's; there are simply a great many more of them.
 * So the scale multiplies every POSITION and every EXTENT in the geography —
 * the coastline, the core radii, the partition cuts, the parks, the piers —
 * and leaves the street grid alone: stPitch, avePitch, streetW, aveW and the
 * organic districts' block-area range are dimensions of a city block, and a
 * block is a block at any city size.
 *
 * Scaling the pitch too would have been the easy version and it would have
 * been wrong twice over. Visually it is a zoom, not a bigger town — the same
 * map with everything fattened. Economically it is worse: lot areas, buildable
 * envelopes, rent per square foot and cost per square foot are all quoted
 * against real dimensions, so a 2x grid would hand every parcel four times the
 * land under the same building and quietly break every number the economy is
 * measured in.
 *
 * Land area goes as the square of this, so lot count roughly does too: 0.55
 * gives about a third of a standard town, 2.0 about four times one.
 *
 * The core RADII do scale. A core's reach is the decay length of the land
 * gradient, and downtown in a big city genuinely does pull further than
 * downtown in a small one. Keeping them fixed would make a large island almost
 * entirely fringe — one small bright middle and miles of nothing — which is a
 * different city rather than a bigger one.
 */
export const SIZES = {
  hamlet: { k: 0.55, name: "Hamlet", note: "A few hundred lots. You can hold every corner of it in your head." },
  town:   { k: 0.78, name: "Town", note: "Half the standard map. Tight, and every mistake is visible." },
  city:   { k: 1.00, name: "City", note: "The standard island — about fourteen hundred lots, two miles end to end." },
  metro:  { k: 1.45, name: "Metropolis", note: "Twice the land. Submarkets you will never personally visit." },
  giant:  { k: 2.00, name: "Great City", note: "Four times the land. A career is not long enough to learn all of it." },
};
export const DEFAULT_SIZE = "city";

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const pt = (p, k) => (Array.isArray(p) ? [p[0] * k, p[1] * k] : p);

/** Scale the third term of a half-plane [nx, ny, c]: the normal is a direction, c is a distance. */
function scaleCuts(node, k) {
  if (!node || typeof node !== "object" || !node.cut) return node;
  return {
    ...node,
    cut: [node.cut[0], node.cut[1], node.cut[2] * k],
    pos: scaleCuts(node.pos, k),
    neg: scaleCuts(node.neg, k),
  };
}

/** Positions inside a district config scale; everything else about it does not. */
function scaleDistricts(ds, k) {
  const out = {};
  for (const [name, d] of Object.entries(ds ?? {})) out[name] = d.focus ? { ...d, focus: pt(d.focus, k) } : d;
  return out;
}

export function scaleCity(cfg, k) {
  if (!isNum(k) || Math.abs(k - 1) < 1e-6) return cfg;
  // A BOX MAY CARRY A DRAWN RING, AND THE RING IS THE THING THAT GETS DRAWN.
  //
  // `...o` spread the park `ring` added by the park work through UNSCALED
  // while its bounding box moved, so the same park had two positions and two
  // areas: citygen cuts, aprons and turfs `p.ring ?? rect(cx,cy,w,h)` — the
  // ring wins on every generated island — while build.mjs sites the amenity
  // premium off the scaled `cx/cy/w/h`. At Great City that put the premium
  // ~400 m from the green it was for; at Hamlet the k=1 ring on a shrunken
  // coastline put 19 of 29 greens partly ON THE WATER, with every invariant
  // `fitsRing` checked — dry land, clear of a seam, clear of its neighbours —
  // validated in a coordinate frame the town is not built in.
  //
  // Invisible to every harness: the drawn fixtures carry no ring and BASELINE
  // runs at the default size, where scaleCity early-returns. Every live run at
  // any other size hit it, and all five sizes are player-selectable.
  const box = (o) => ({
    ...o,
    cx: o.cx * k, cy: o.cy * k, w: o.w * k, h: o.h * k,
    ...(o.ring ? { ring: o.ring.map((p) => pt(p, k)) } : {}),
  });
  return {
    ...cfg,
    coast: cfg.coast.map((p) => pt(p, k)),
    coastAmp: cfg.coastAmp * k,
    esplanade: cfg.esplanade * k,
    // `w` on a core is a WEIGHT, not a width — it stays.
    cores: cfg.cores.map((c) => ({ ...c, xy: pt(c.xy, k), r: c.r * k })),
    // A stated lighthouse is a POSITION on the coast, so it moves with the
    // coast. Neither authored island sets one — generateCity falls back to the
    // furthest coast vertex — so this had never been wrong in play; a
    // generated island does set one, and at "Great City" it would otherwise
    // have stood half a mile inland with the town built around it.
    lighthouse: cfg.lighthouse ? pt(cfg.lighthouse, k) : cfg.lighthouse,
    partition: scaleCuts(cfg.partition, k),
    // A district's street DIMENSIONS are deliberately untouched — see the note
    // above; a block is a block at any city size. A radial district's `focus`
    // is not a dimension, it is a POSITION on the island: the palace or the
    // harbour mouth the whole plan is aimed at. Left unscaled it stayed where a
    // standard City put it while the island grew out from under it, which at
    // Great City is a triumphal arch three quarters of a mile out to sea with
    // the avenues of a landlocked town pointing at it.
    districts: scaleDistricts(cfg.districts, k),
    parks: (cfg.parks ?? []).map(box),
    diagonals: (cfg.diagonals ?? []).map(box),
    piers: (cfg.piers ?? []).map((ring) => ring.map((p) => pt(p, k))),
    // [x, y, bearing] — the bearing is an angle.
    cranes: (cfg.cranes ?? []).map(([x, y, d]) => [x * k, y * k, d]),
    ships: (cfg.ships ?? []).map(([x, y, d]) => [x * k, y * k, d]),
    // [x, y, w, h, bearing]
    breakwaters: (cfg.breakwaters ?? []).map(([x, y, w, h, d]) => [x * k, y * k, w * k, h * k, d]),
    // A station's weight is its ridership, not a distance.
    stations: (cfg.stations ?? []).map((st) => ({ ...st, xy: pt(st.xy, k) })),
    labels: (cfg.labels ?? []).map((l) => ({ ...l, xy: pt(l.xy, k) })),
  };
}
