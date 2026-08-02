// FIVE CITIES. Each is a config for pipeline/lib/citygen.mjs — same generator,
// same guarantees, different geography. They are all roughly New Alden's size,
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
// undo since. Numbered cross streets, east and west addresses. The closest of
// the five to Manhattan, and the one where frontage is scarcest.
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

// --- 2. MARROW BAY ----------------------------------------------------------
// A city bent around a bay that bites four hundred metres up into it. Nothing
// here agrees with anything else: the old town runs on the shoreline's
// bearing, the merchant grid on the surveyors', and the hill district splits
// the difference. Every trip across town crosses a seam. Boston, in short —
// and the bay means two lots the same distance from the Custom House can be
// twenty minutes apart.
const marrow = {
  name: "Marrow Bay", district: "marrow", abbr: "MB", seed: 30512,
  center: [-70.9, 41.1],
  coast: [
    [-880, -110], [-905, 175], [-800, 440], [-555, 640], [-235, 740],
    [125, 760], [470, 655], [725, 445], [830, 175], [790, -120],
    [640, -330], [430, -245], [330, -35], [115, 60], [-125, 15],
    [-305, -155], [-435, -330], [-685, -330],
  ],
  coastAmp: 44, esplanade: 26,
  cores: [
    { xy: [330, 130], w: 1.0, r: 250 },    // the Custom House, on the east arm
    { xy: [-40, 300], w: 0.66, r: 300 },   // the merchant grid
    { xy: [-480, 300], w: 0.22, r: 240 },  // the hill
    { xy: [640, 240], w: 0.16, r: 200 },   // the east yards
  ],
  partition: {
    cut: cut(430, 0, 90), pos: "eastyards",
    neg: {
      cut: cut(-450, 0, 90), neg: "hillside",
      pos: { cut: cut(0, 300, 0), neg: "merchant", pos: "oldtown" },
    },
  },
  districts: {
    oldtown:   { kind: "organic", flavor: "old", cell: [3000, 7000], jitterDeg: 18, streetW: 10, fullBlockP: 0.02 },
    merchant:  { kind: "lattice", flavor: "core", bearingDeg: -12, stPitch: 70, avePitch: 190, streetW: 14, aveW: 25, warpAmp: 4, numbered: true, fullBlockP: 0.05 },
    hillside:  { kind: "lattice", flavor: "resi", bearingDeg: 26, stPitch: 56, avePitch: 146, streetW: 12, aveW: 20, warpAmp: 6, fullBlockP: 0.02 },
    eastyards: { kind: "lattice", flavor: "industrial", bearingDeg: -40, stPitch: 96, avePitch: 248, streetW: 16, aveW: 27, warpAmp: 9, fullBlockP: 0.12 },
  },
  parks: [
    { cx: -80, cy: 380, w: 280, h: 200, deg: -12, name: "Marrow Common" },
    { cx: 320, cy: 140, w: 90, h: 90, deg: -12, name: "Custom House Sq" },
    { cx: -520, cy: 350, w: 150, h: 105, deg: 26, name: "Blackstone Green" },
  ],
  diagonals: [{ cx: 40, cy: 430, w: 900, h: 25, deg: 152 }],
  piers: [
    [[300, -60], [180, -90], [172, -52], [292, -24]],
    [[420, -190], [320, -260], [298, -228], [398, -158]],
    [[-330, -270], [-350, -380], [-312, -388], [-294, -278]],
    [[-830, 300], [-945, 325], [-938, 362], [-823, 338]],
  ],
  cranes: [[760, 320, 40], [790, 150, 100]],
  ships: [[240, -180, 15], [-560, -430, 95]],
  breakwaters: [[560, -420, 210, 15, 24]],
  stations: [
    { name: "Custom House", lines: "R B", xy: [330, 140], weight: 100 },
    { name: "State Street", lines: "B", xy: [180, 240], weight: 64 },
    { name: "Marrow Common", lines: "R G", xy: [-80, 380], weight: 88 },
    { name: "Copley", lines: "G", xy: [-330, 380], weight: 54 },
    { name: "Blackstone", lines: "G", xy: [-520, 350], weight: 38 },
    { name: "North End", lines: "R", xy: [-60, 610], weight: 44 },
    { name: "East Yards", lines: "Y", xy: [600, 260], weight: 26 },
    { name: "Drydock", lines: "Y", xy: [740, 80], weight: 20 },
  ],
  labels: [
    { name: "THE OLD TOWN", labelKind: "district", xy: [180, 140] },
    { name: "THE MERCHANT GRID", labelKind: "district", xy: [-120, 520] },
    { name: "HILLSIDE", labelKind: "district", xy: [-620, 300] },
    { name: "EAST YARDS", labelKind: "district", xy: [640, 330] },
    { name: "Marrow Common", labelKind: "park", xy: [-80, 380] },
    { name: "Blackstone Green", labelKind: "park", xy: [-520, 350] },
    { name: "Marrow Bay", labelKind: "water", xy: [120, -230] },
    { name: "The Narrows", labelKind: "water", xy: [-980, 260] },
  ],
  avenues: ["Commonwealth Ave", "Marrow Ave", "Tremont Ave", "Blackstone Ave", "Beacon Ave", "Huntington Ave"],
  streets: {
    oldtown: ["Salt Ln", "Fish St", "Dock Sq", "India Row", "Milk St", "Blackstone Row", "Cooper Alley", "Custom House St"],
    hillside: ["Acorn St", "Beacon Row", "Chestnut St", "Dartmouth St", "Exeter St", "Fairfield St"],
    eastyards: ["Gantry Rd", "Slipway St", "Boilerworks Ln", "Coal Wharf", "Foundry Row"],
    default: ["Market St", "Bridge St", "School St"],
  },
};

// --- 3. THORNE ISLAND -------------------------------------------------------
// A whole island, small enough that every district touches water. There is no
// hinterland to expand into and no cheap edge to hide in — the only ways to
// build are up, or on ground somebody already owns. The tightest of the five,
// and the one where the land bid never really relaxes.
const thorne = {
  name: "Thorne Island", district: "thorne", abbr: "TI", seed: 30613,
  center: [-70.9, 41.1],
  coast: [
    [-620, -300], [-745, -40], [-720, 250], [-560, 480], [-290, 630],
    [40, 690], [380, 610], [625, 435], [740, 175], [700, -125],
    [545, -355], [300, -490], [0, -540], [-300, -465],
  ],
  coastAmp: 42, esplanade: 22,
  cores: [
    { xy: [140, -60], w: 1.0, r: 265 },    // the Exchange, dead centre
    { xy: [-300, 170], w: 0.5, r: 240 },
    { xy: [460, 200], w: 0.36, r: 230 },
    { xy: [-60, 430], w: 0.16, r: 210 },
  ],
  partition: {
    cut: cut(-140, 0, 90), pos: { cut: cut(340, 0, 90), neg: "exchange", pos: "eastward" },
    neg: { cut: cut(0, 90, 0), neg: "shipyard", pos: "westward" },
  },
  districts: {
    exchange: { kind: "lattice", flavor: "core", bearingDeg: 8, stPitch: 66, avePitch: 186, streetW: 14, aveW: 25, warpAmp: 2, numbered: true, fullBlockP: 0.05 },
    westward: { kind: "lattice", flavor: "resi", bearingDeg: 34, stPitch: 58, avePitch: 148, streetW: 12, aveW: 20, warpAmp: 5, fullBlockP: 0.02 },
    eastward: { kind: "organic", flavor: "old", cell: [3100, 6800], jitterDeg: 17, streetW: 10, fullBlockP: 0.03 },
    shipyard: { kind: "lattice", flavor: "industrial", bearingDeg: -26, stPitch: 92, avePitch: 240, streetW: 16, aveW: 27, warpAmp: 8, fullBlockP: 0.12 },
  },
  parks: [
    { cx: -30, cy: 150, w: 260, h: 200, deg: 8, name: "Thorne Common" },
    { cx: 170, cy: -100, w: 90, h: 90, deg: 8, name: "Exchange Square" },
    { cx: -400, cy: 330, w: 150, h: 100, deg: 34, name: "Lantern Green" },
    { cx: 500, cy: 350, w: 140, h: 105, deg: 0, name: "Eastward Green" },
  ],
  diagonals: [{ cx: 80, cy: 130, w: 940, h: 25, deg: 128 }],
  piers: [
    [[0, -500], [-20, -620], [16, -628], [36, -508]],
    [[300, -450], [282, -570], [318, -578], [336, -458]],
    [[-700, 110], [-820, 98], [-823, 135], [-703, 147]],
    [[650, 300], [770, 285], [773, 322], [653, 337]],
  ],
  cranes: [[-620, -160, 20], [-580, -240, 80]],
  ships: [[120, -690, 85], [-860, 270, 105]],
  breakwaters: [[440, -620, 220, 15, 22]],
  stations: [
    { name: "Exchange", lines: "1 A", xy: [150, -80], weight: 100 },
    { name: "Thorne Common", lines: "1 2 A", xy: [-30, 150], weight: 90 },
    { name: "Lantern", lines: "2", xy: [-400, 330], weight: 46 },
    { name: "Eastward", lines: "A", xy: [470, 250], weight: 50 },
    { name: "Ferry Landing", lines: "1", xy: [280, -330], weight: 52 },
    { name: "Northgate", lines: "2", xy: [-60, 480], weight: 34 },
    { name: "Shipyard", lines: "W", xy: [-500, -60], weight: 22 },
    { name: "Lighthouse", lines: "A", xy: [620, 60], weight: 26 },
  ],
  labels: [
    { name: "THE EXCHANGE", labelKind: "district", xy: [130, -10] },
    { name: "WESTWARD", labelKind: "district", xy: [-430, 170] },
    { name: "EASTWARD", labelKind: "district", xy: [500, 120] },
    { name: "THE SHIPYARD", labelKind: "district", xy: [-470, -180] },
    { name: "Thorne Common", labelKind: "park", xy: [-30, 150] },
    { name: "Lantern Green", labelKind: "park", xy: [-400, 330] },
    { name: "The Sound", labelKind: "water", xy: [100, -700] },
    { name: "Thorne Channel", labelKind: "water", xy: [-900, 120] },
  ],
  avenues: ["Thorne Ave", "Lantern Ave", "Meridian Ave", "Kingsway", "Harbour Ave", "Island Ave"],
  streets: {
    eastward: ["Anchor Ln", "Bight St", "Cable Row", "Dolphin St", "Ebb Ln", "Ferryman's Walk", "Gullet St"],
    westward: ["Alder St", "Birchwood St", "Cypress St", "Dunmore St", "Elmgrove St", "Foxglove St"],
    shipyard: ["Slipway Rd", "Keelhaul Ln", "Ropewalk", "Tarworks St", "Boiler Row"],
    default: ["Main St", "Cross St", "Water St"],
  },
};

// --- 4. CALDER FALLS --------------------------------------------------------
// A river town that grew off its water power. The mills took the bank because
// they had to, the merchants took the terrace above them, and the mill owners
// built on the ridge where they could watch both. Inland: no harbor, so the
// waterfront is a working one and value runs uphill instead of out to sea —
// the one map of the five where the cheap land is the land with the view of
// the water.
const calder = {
  name: "Calder Falls", district: "calder", abbr: "CF", seed: 30714,
  center: [-70.9, 41.1],
  coast: [
    [-830, -230], [-880, 70], [-800, 350], [-570, 555], [-240, 650],
    [130, 670], [490, 585], [760, 400], [875, 140], [820, -145],
    [625, -330], [350, -390], [120, -250], [-120, -330], [-380, -430],
    [-620, -380],
  ],
  coastAmp: 46, esplanade: 20,
  cores: [
    { xy: [60, 60], w: 1.0, r: 270 },      // Falls Square
    { xy: [420, 250], w: 0.5, r: 260 },
    { xy: [-420, 300], w: 0.26, r: 230 },
    { xy: [-180, -180], w: 0.16, r: 210 },
  ],
  partition: {
    cut: cut(0, -20, 0), pos: "millrace",
    neg: {
      cut: cut(0, 330, 0), neg: "theridge",
      pos: { cut: cut(140, 0, 90), neg: "terrace", pos: "downtown" },
    },
  },
  districts: {
    millrace: { kind: "lattice", flavor: "industrial", bearingDeg: 12, stPitch: 90, avePitch: 234, streetW: 16, aveW: 26, warpAmp: 7, fullBlockP: 0.13 },
    downtown: { kind: "lattice", flavor: "core", bearingDeg: 6, stPitch: 70, avePitch: 192, streetW: 14, aveW: 26, warpAmp: 3, numbered: true, fullBlockP: 0.05 },
    terrace:  { kind: "organic", flavor: "old", cell: [3300, 7400], jitterDeg: 14, streetW: 10, fullBlockP: 0.03 },
    theridge: { kind: "lattice", flavor: "resi", bearingDeg: -22, stPitch: 58, avePitch: 150, streetW: 12, aveW: 20, warpAmp: 5, fullBlockP: 0.02 },
  },
  parks: [
    { cx: 60, cy: 60, w: 250, h: 190, deg: 6, name: "Falls Square" },
    { cx: 430, cy: 260, w: 170, h: 115, deg: 6, name: "Calder Green" },
    { cx: -450, cy: 420, w: 150, h: 105, deg: -22, name: "Ridgeview Park" },
  ],
  diagonals: [{ cx: 180, cy: 150, w: 980, h: 25, deg: 34 }],
  piers: [
    [[80, -270], [60, -380], [96, -388], [116, -278]],
    [[420, -350], [402, -460], [438, -468], [456, -358]],
    [[-500, -400], [-515, -510], [-478, -516], [-464, -408]],
  ],
  cranes: [[-260, -270, 18], [-60, -240, 92]],
  ships: [[240, -470, 78]],
  breakwaters: [],
  stations: [
    { name: "Falls Square", lines: "1 2", xy: [60, 60], weight: 100 },
    { name: "Calder Green", lines: "1", xy: [430, 260], weight: 62 },
    { name: "Terrace", lines: "2", xy: [-180, 200], weight: 55 },
    { name: "Ridgeview", lines: "2", xy: [-450, 420], weight: 42 },
    { name: "Uptown", lines: "1", xy: [420, 500], weight: 34 },
    { name: "Millrace", lines: "M", xy: [-330, -260], weight: 26 },
    { name: "Foundry", lines: "M", xy: [-40, -230], weight: 30 },
    { name: "Depot", lines: "1 M", xy: [370, -250], weight: 44 },
  ],
  labels: [
    { name: "DOWNTOWN", labelKind: "district", xy: [250, 90] },
    { name: "THE TERRACE", labelKind: "district", xy: [-260, 90] },
    { name: "THE RIDGE", labelKind: "district", xy: [-420, 500] },
    { name: "THE MILLRACE", labelKind: "district", xy: [-200, -280] },
    { name: "Falls Square", labelKind: "park", xy: [60, 60] },
    { name: "Ridgeview Park", labelKind: "park", xy: [-450, 420] },
    { name: "Calder River", labelKind: "water", xy: [120, -520] },
    { name: "The Falls", labelKind: "water", xy: [-760, -430] },
  ],
  avenues: ["Calder Ave", "Ridge Ave", "Canal Ave", "Mill Ave", "Union Ave", "Prospect Ave"],
  streets: {
    terrace: ["Cotton Row", "Loom St", "Spindle Ln", "Bobbin St", "Weavers Walk", "Dyehouse Row", "Carder St"],
    theridge: ["Ashfield St", "Braemar St", "Crestwood St", "Dunbar St", "Elmridge St", "Fernhill St"],
    millrace: ["Tailrace Rd", "Penstock St", "Forge Ln", "Flume St", "Turbine Row"],
    default: ["Main St", "Water St", "Church St"],
  },
};

// --- 5. SABLE HARBOR --------------------------------------------------------
// A harbor behind a hook of land: the deepest water in the region and a town
// that has never been anything but a port. The basin bites three hundred
// metres up into the middle of the map, so the waterfront frontage is enormous
// relative to the land behind it — more of this city is within sight of a ship
// than any of the other four, and the Hook is the only quarter that never had
// a surveyor.
const sable = {
  name: "Sable Harbor", district: "sable", abbr: "SH", seed: 30815,
  center: [-70.9, 41.1],
  coast: [
    [-900, 10], [-855, 300], [-620, 505], [-300, 615], [85, 645],
    [435, 575], [705, 405], [845, 150], [810, -135], [640, -320],
    [470, -215], [430, -20], [250, -105], [95, -300], [-160, -380],
    [-480, -360], [-720, -235],
  ],
  coastAmp: 40, esplanade: 25,
  cores: [
    { xy: [520, 110], w: 1.0, r: 250 },    // Sable Exchange, on the hook's neck
    { xy: [40, 180], w: 0.64, r: 290 },
    { xy: [-330, 400], w: 0.22, r: 235 },
    { xy: [-680, 130], w: 0.13, r: 200 },
  ],
  partition: {
    cut: cut(-440, 0, 90), neg: "thespit",
    pos: {
      cut: cut(0, 340, 0), neg: "landward",
      pos: { cut: cut(230, 0, 90), neg: "seaward", pos: "thehook" },
    },
  },
  districts: {
    thehook:  { kind: "organic", flavor: "old", cell: [2900, 6600], jitterDeg: 19, streetW: 10, fullBlockP: 0.02 },
    thespit:  { kind: "lattice", flavor: "industrial", bearingDeg: -14, stPitch: 92, avePitch: 240, streetW: 16, aveW: 27, warpAmp: 9, fullBlockP: 0.12 },
    seaward:  { kind: "lattice", flavor: "core", bearingDeg: 15, stPitch: 69, avePitch: 196, streetW: 14, aveW: 26, warpAmp: 3, numbered: true, fullBlockP: 0.05 },
    landward: { kind: "lattice", flavor: "resi", bearingDeg: -24, stPitch: 57, avePitch: 146, streetW: 12, aveW: 20, warpAmp: 5, fullBlockP: 0.02 },
  },
  parks: [
    { cx: 0, cy: 190, w: 270, h: 200, deg: 15, name: "Sable Common" },
    { cx: 540, cy: 130, w: 90, h: 90, deg: 15, name: "Hook Square" },
    { cx: -360, cy: 450, w: 150, h: 105, deg: -24, name: "Winslow Green" },
  ],
  diagonals: [{ cx: -20, cy: 300, w: 980, h: 25, deg: 148 }],
  piers: [
    [[300, -110], [270, -230], [307, -240], [332, -120]],
    [[430, -60], [520, -140], [546, -110], [456, -30]],
    [[-380, -330], [-395, -440], [-357, -446], [-343, -338]],
    [[-870, 190], [-985, 212], [-978, 248], [-863, 226]],
  ],
  cranes: [[-760, -40, 22], [-800, 180, 88]],
  ships: [[300, -230, 40], [-560, -430, 96]],
  breakwaters: [[560, -420, 220, 15, 30]],
  stations: [
    { name: "Sable Exchange", lines: "1 A", xy: [520, 110], weight: 100 },
    { name: "The Hook", lines: "A", xy: [370, -40], weight: 56 },
    { name: "Sable Common", lines: "1 2", xy: [0, 190], weight: 86 },
    { name: "Seaward", lines: "1", xy: [130, 420], weight: 52 },
    { name: "Winslow", lines: "2", xy: [-360, 450], weight: 40 },
    { name: "Landward", lines: "2", xy: [-120, 500], weight: 36 },
    { name: "Spit Gate", lines: "W 2", xy: [-520, 200], weight: 28 },
    { name: "Drydock", lines: "W", xy: [-760, 60], weight: 20 },
  ],
  labels: [
    { name: "THE HOOK", labelKind: "district", xy: [520, -20] },
    { name: "SEAWARD", labelKind: "district", xy: [60, 60] },
    { name: "LANDWARD", labelKind: "district", xy: [-180, 520] },
    { name: "THE SPIT", labelKind: "district", xy: [-700, 250] },
    { name: "Sable Common", labelKind: "park", xy: [0, 190] },
    { name: "Winslow Green", labelKind: "park", xy: [-360, 450] },
    { name: "Sable Harbor", labelKind: "water", xy: [280, -230] },
    { name: "The Roads", labelKind: "water", xy: [-1000, 100] },
  ],
  avenues: ["Post Road", "Sable Ave", "Winslow Ave", "Commercial Ave", "Atlantic Ave", "Harbour Ave"],
  streets: {
    thehook: ["Ropewalk", "Sail Loft Ln", "Cordage St", "Hook St", "Tide Row", "Barrel Alley", "Fathom St"],
    landward: ["Amherst St", "Bridgeworth St", "Colby St", "Danforth St", "Endicott St", "Fairhaven St"],
    thespit: ["Spit Rd", "Careen St", "Graving Dock", "Oakum Ln", "Windlass Row"],
    default: ["Main St", "Water St", "Front St"],
  },
};

// --- 6. NEW ALDEN -----------------------------------------------------------
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
  marrow: "A crescent around a deep bay; three grids that refuse to agree.",
  thorne: "An island. No hinterland, no cheap edge — build up or buy somebody out.",
  calder: "A mill town. Value runs uphill, away from the working river.",
  sable: "A hooked harbor — more waterfront than land behind it.",
};

export const CITIES = { newalden, kestrel, marrow, thorne, calder, sable };
