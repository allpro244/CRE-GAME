// TWO CITIES. Each is a config for pipeline/lib/citygen.mjs — same generator,
// same guarantees, different geography. They are both roughly New Alden's size,
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
const cut = (px, py, deg) => {
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

// A one-line blurb per city, shown in the picker. What kind of game each is.
export const TAGLINES = {
  newalden: "The original. A colonial landing, a numbered grid, and Broadway cutting both.",
  kestrel: "A narrow peninsula — frontage is scarce and the only cheap land is at the tip.",
};

// TWO CITIES, NOT SIX.
//
// Marrow, Thorne, Calder and Sable are gone. Six maps was breadth, and breadth
// was never what this is for: every one of them had to be regenerated, audited
// for density and re-verified on every change to the generator, and none of
// them made the game deeper than New Alden and Kestrel Point already do. These
// two are genuinely different games — an open grid with a hinterland, and a
// peninsula where frontage is the scarce thing — and that is the whole of what
// a second map has to earn.
export const CITIES = { newalden, kestrel };
