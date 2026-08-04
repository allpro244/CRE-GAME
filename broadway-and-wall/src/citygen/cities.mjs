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
const newyork = {
  name: "New York", district: "newyork", abbr: "NY", seed: 18110,
  // OPEN OCEAN, ON PURPOSE. The centre is only the origin of the local metre
  // frame — it is not a claim about where the city is. Put it at Manhattan's
  // real coordinates and the basemap underneath obligingly draws the REAL New
  // York beside the invented one, which is exactly what the first screenshots
  // came back showing: a fictional island, and Hoboken.
  center: [-69.6, 40.2],
  coast: [
    [-70, -980], [-235, -905], [-330, -745], [-395, -560], [-430, -350],
    [-455, -120], [-470, 130], [-500, 380], [-520, 630], [-495, 860],
    [-430, 1030], [-260, 1120], [-40, 1150], [180, 1105], [330, 985],
    [385, 795], [400, 560], [425, 315], [450, 70], [470, -175],
    [455, -420], [380, -640], [250, -820], [90, -935],
  ],
  coastAmp: 22, esplanade: 22,
  cores: [
    { xy: [60, -760], w: 1.00, r: 270 },    // Wall Street, at the toe
    { xy: [-20, 60], w: 0.86, r: 330 },     // Midtown, around the terminal
    { xy: [-60, -330], w: 0.30, r: 250 },   // the Village and the loft district
    { xy: [-120, 700], w: 0.20, r: 260 },   // uptown, above the park
    { xy: [-400, -140], w: 0.09, r: 190 },  // the west side yards
  ],
  // Four leaves: the colonial toe, the loft district, the numbered grid, and
  // the uptown grid above the park. The cuts run east-west because the island
  // does, which is why every New Yorker gives directions in blocks.
  partition: {
    cut: cut(0, -560, 0), pos: "downtown",
    neg: {
      cut: cut(0, -250, 0), pos: "lofts",
      neg: { cut: cut(0, 560, 0), neg: "uptown", pos: "midtown" },
    },
  },
  districts: {
    // No grid at all below the old wall — cell sizes small, angles wandering.
    downtown: { kind: "organic", flavor: "old", cell: [2600, 6800], jitterDeg: 21, streetW: 8, fullBlockP: 0.02 },
    // The loft district: the grid has arrived but the blocks are still long
    // and the buildings on them were built for machines, not people.
    lofts:    { kind: "lattice", flavor: "industrial", bearingDeg: 29, stPitch: 78, avePitch: 224, streetW: 13, aveW: 24, warpAmp: 5, fullBlockP: 0.07 },
    // THE COMMISSIONERS' PLAN. Twenty short blocks to a mile and three long
    // ones — the most valuable rectangle in the world, and the reason a corner
    // on an avenue is worth what it is.
    midtown:  { kind: "lattice", flavor: "core", bearingDeg: 29, stPitch: 61, avePitch: 274, streetW: 15, aveW: 31, warpAmp: 1, numbered: true, fullBlockP: 0.06 },
    uptown:   { kind: "lattice", flavor: "resi", bearingDeg: 29, stPitch: 61, avePitch: 274, streetW: 14, aveW: 28, warpAmp: 1, numbered: true, fullBlockP: 0.03 },
  },
  parks: [
    // The one nobody may build on, and the reason the addresses beside it cost
    // what they do.
    { cx: -75, cy: 430, w: 250, h: 720, deg: 29, name: "Central Park" },
    { cx: 40, cy: -690, w: 95, h: 95, deg: 29, name: "Bowling Green" },
    { cx: -95, cy: -300, w: 165, h: 130, deg: 29, name: "Washington Square" },
    { cx: 40, cy: -60, w: 120, h: 90, deg: 29, name: "Bryant Park" },
  ],
  // Broadway, running the whole length and agreeing with nothing.
  diagonals: [{ cx: -60, cy: -110, w: 2000, h: 30, deg: 103 }],
  piers: [
    [[-430, -400], [-560, -430], [-566, -388], [-436, -358]],
    [[-448, -170], [-580, -196], [-586, -154], [-454, -128]],
    [[-470, 70], [-600, 48], [-604, 90], [-474, 112]],
    [[400, -520], [530, -556], [540, -514], [410, -478]],
    [[425, -260], [556, -288], [564, -246], [433, -218]],
    [[452, 0], [582, -20], [588, 22], [458, 42]],
  ],
  cranes: [[-500, -300, 18], [-520, 10, 96]],
  ships: [[-660, -560, 62], [640, -680, 118], [-30, -1120, 20]],
  breakwaters: [[120, -1120, 220, 15, 22]],
  stations: [
    { name: "Wall St", lines: "2 3 4 5", xy: [60, -760], weight: 100 },
    { name: "Fulton St", lines: "A C 4 5", xy: [10, -640], weight: 78 },
    { name: "Canal St", lines: "6 N Q", xy: [-60, -430], weight: 54 },
    { name: "Union Sq", lines: "4 5 6 N Q L", xy: [-70, -190], weight: 82 },
    { name: "Grand Central", lines: "4 5 6 7 S", xy: [30, 40], weight: 96 },
    { name: "Times Sq", lines: "1 2 3 N Q R 7 S", xy: [-70, 70], weight: 94 },
    { name: "Columbus Circle", lines: "A C B D 1", xy: [-150, 290], weight: 66 },
    { name: "72nd St", lines: "1 2 3", xy: [-190, 470], weight: 48 },
    { name: "125th St", lines: "A B C D", xy: [-200, 900], weight: 40 },
    { name: "Hudson Yards", lines: "7", xy: [-330, 40], weight: 26 },
  ],
  labels: [
    { name: "DOWNTOWN", labelKind: "district", xy: [90, -790] },
    { name: "THE LOFTS", labelKind: "district", xy: [-120, -400] },
    { name: "MIDTOWN", labelKind: "district", xy: [30, 90] },
    { name: "UPTOWN", labelKind: "district", xy: [-160, 830] },
    { name: "Central Park", labelKind: "park", xy: [-75, 430] },
    { name: "Washington Square", labelKind: "park", xy: [-95, -300] },
    { name: "Bowling Green", labelKind: "park", xy: [40, -690] },
    { name: "Upper Bay", labelKind: "water", xy: [60, -1100] },
    { name: "Hudson River", labelKind: "water", xy: [-660, 300] },
    { name: "East River", labelKind: "water", xy: [610, 200] },
  ],
  avenues: ["Broadway", "Fifth Ave", "Madison Ave", "Park Ave", "Lexington Ave", "Third Ave", "Seventh Ave", "Eighth Ave", "West End Ave"],
  streets: {
    downtown: ["Wall St", "Broad St", "Pearl St", "Water St", "Stone St", "Beaver St", "Maiden Ln", "Nassau St", "Fulton St", "John St", "Cortlandt St", "Exchange Pl"],
    lofts: ["Greene St", "Mercer St", "Wooster St", "Crosby St", "Spring St", "Prince St", "Grand St", "Howard St", "Lispenard St"],
    uptown: ["Amsterdam Ave", "Columbus Ave", "Riverside Dr", "St Nicholas Ave", "Convent Ave"],
    default: ["Church St", "Greenwich St", "Varick St", "Hudson St"],
  },
};

// --- 4. CHICAGO -------------------------------------------------------------
// The flat one. No island, no peninsula, no natural constraint at all except a
// lake on the east that the city refuses to build on — so the grid runs
// unbroken to the horizon in the other three directions, which is exactly what
// makes it a different game. The river forks just north-west of the core and
// splits the town into three sides; the Loop is the tightest and most valuable
// rectangle on the map because the elevated tracks draw a box around it and
// everybody knows where the box is; and the lakefront is a mile of park by law.
// Land is not scarce here. Location is.
const chicago = {
  name: "Chicago", district: "chicago", abbr: "CH", seed: 18712,
  center: [-68.3, 39.4],   // open water — see the note on New York
  // NOT AS BIG AS THE REAL ONE, and the first cut of this map is why. At full
  // Chicago extents the town came out with 2,920 lots and NOT ONE OFFICE
  // BUILDING: the cores were spread so thin across so much land that no point
  // on the map ever cleared the intensity an office needs. A map has to be the
  // size a player can hold in their head, and the thing that makes Chicago
  // Chicago is not its acreage — it is that the grid meets no obstacle in
  // three directions while the fourth is a lake nobody may build on.
  coast: [
    [430, -640], [470, -420], [492, -190], [500, 40], [494, 270],
    [470, 500], [430, 690], [200, 750], [-90, 780], [-390, 775],
    [-620, 735], [-690, 490], [-710, 210], [-710, -80], [-690, -360],
    [-620, -610], [-390, -680], [-90, -710], [200, -690],
  ],
  coastAmp: 10, esplanade: 46,     // Burnham's lakefront: wide, green, public
  cores: [
    { xy: [158, 21], w: 1.00, r: 265 },     // the Loop
    { xy: [119, 186], w: 0.55, r: 250 },    // the Magnificent Mile, north of the river
    { xy: [66, -147], w: 0.24, r: 225 },    // the South Loop
    { xy: [-161, 59], w: 0.14, r: 230 },    // the west side, past the branch
    { xy: [-350, -210], w: 0.08, r: 200 },  // the stockyards and the rail
  ],
  // The river makes the partition, the way it makes the city: north side,
  // west side, south side, and the Loop in the crook of the fork.
  // Travelling east, `pos` is the RIGHT-hand side, which is SOUTH. The first
  // cut of this map had these the wrong way round and put the Loop in the
  // north side and the north side in the Loop — the town came out with 1,292
  // lots and NOT ONE OFFICE, because the only district whose flavour makes
  // office towers had been handed the residential half of the map.
  partition: {
    cut: cut(0, 330, 0), neg: "northside",
    pos: {
      cut: cut(-140, 0, 90), neg: "westside",
      pos: { cut: cut(0, -260, 0), neg: "loop", pos: "southloop" },
    },
  },
  districts: {
    // THE LOOP. Tight blocks, the tightest street pitch on any map here, and a
    // hard grid — it is a rectangle of about a third of a square mile and it
    // holds more office space than most cities have.
    loop:      { kind: "lattice", flavor: "core", bearingDeg: 0, stPitch: 66, avePitch: 172, streetW: 16, aveW: 28, warpAmp: 0, numbered: true, fullBlockP: 0.08 },
    northside: { kind: "lattice", flavor: "resi", bearingDeg: 0, stPitch: 60, avePitch: 168, streetW: 14, aveW: 24, warpAmp: 1, numbered: true, fullBlockP: 0.03 },
    southloop: { kind: "lattice", flavor: "industrial", bearingDeg: 0, stPitch: 74, avePitch: 196, streetW: 16, aveW: 26, warpAmp: 2, fullBlockP: 0.09 },
    westside:  { kind: "lattice", flavor: "industrial", bearingDeg: 0, stPitch: 82, avePitch: 220, streetW: 17, aveW: 28, warpAmp: 3, fullBlockP: 0.10 },
  },
  parks: [
    { cx: 360, cy: 15, w: 140, h: 430, deg: 0, name: "Grant Park" },
    { cx: 375, cy: 360, w: 105, h: 225, deg: 0, name: "Lincoln Park" },
    { cx: -125, cy: 40, w: 135, h: 105, deg: 0, name: "Union Park" },
    { cx: 145, cy: -295, w: 100, h: 92, deg: 0, name: "Dearborn Green" },
  ],
  // Ogden and Milwaukee: the two angled roads that predate the grid and never
  // gave in to it.
  diagonals: [
    { cx: -125, cy: 175, w: 980, h: 24, deg: 34 },
    { cx: -85, cy: -180, w: 840, h: 22, deg: 148 },
  ],
  piers: [
    [[490, 210], [602, 202], [605, 235], [493, 244]],
    [[483, -126], [595, -137], [598, -104], [486, -92]],
    [[462, 532], [560, 524], [563, 554], [465, 563]],
  ],
  cranes: [[-616, -392, 8], [-588, -210, 62]],
  ships: [[441, 59, 4], [480, -206, 172]],
  breakwaters: [[281, 14, 103, 6, 0], [285, -144, 69, 5, 0]],
  stations: [
    { name: "State & Madison", lines: "R B", xy: [79, 10], weight: 100 },
    { name: "LaSalle", lines: "B P", xy: [55, 5], weight: 74 },
    { name: "Union Station", lines: "M", xy: [27, 7], weight: 68 },
    { name: "Merchandise Mart", lines: "B P", xy: [46, 55], weight: 56 },
    { name: "Chicago Ave", lines: "R", xy: [55, 113], weight: 52 },
    { name: "Fullerton", lines: "R B", xy: [48, 192], weight: 36 },
    { name: "Roosevelt", lines: "R G", xy: [67, -79], weight: 44 },
    { name: "Ashland", lines: "G P", xy: [-62, 14], weight: 30 },
    { name: "Halsted", lines: "G", xy: [-134, -96], weight: 20 },
  ],
  labels: [
    { name: "THE LOOP", labelKind: "district", xy: [238, 42] },
    { name: "NORTH SIDE", labelKind: "district", xy: [98, 448] },
    { name: "SOUTH LOOP", labelKind: "district", xy: [84, -336] },
    { name: "WEST SIDE", labelKind: "district", xy: [-350, 126] },
    { name: "Grant Park", labelKind: "park", xy: [364, 14] },
    { name: "Lincoln Park", labelKind: "park", xy: [378, 364] },
    { name: "Lake Michigan", labelKind: "water", xy: [672, 182] },
    { name: "Chicago River", labelKind: "water", xy: [-112, 175] },
  ],
  avenues: ["State St", "Michigan Ave", "Wabash Ave", "Dearborn St", "Clark St", "LaSalle St", "Wells St", "Franklin St", "Halsted St", "Ashland Ave"],
  streets: {
    loop: ["Madison St", "Monroe St", "Adams St", "Jackson Blvd", "Van Buren St", "Randolph St", "Washington St", "Lake St"],
    southloop: ["Roosevelt Rd", "Polk St", "Harrison St", "Congress Pkwy", "Balbo Dr", "Cermak Rd"],
    westside: ["Fulton Market", "Kinzie St", "Grand Ave", "Ogden Ave", "Racine Ave", "Morgan St"],
    default: ["Ontario St", "Erie St", "Huron St", "Superior St", "Chicago Ave"],
  },
};

// --- 5. BOSTON --------------------------------------------------------------
// The oldest and the strangest. Boston is a city built on a peninsula so
// narrow it was nearly an island, and then made twice its size by filling in
// the bay — so it has two street plans that have nothing to do with each
// other. The original town is a knot of cowpaths that never once agreed to be
// straightened; Back Bay, filled and laid out in the 1850s, is the most formal
// grid in America, alphabetical and dead straight. Between them sits the
// Common, the oldest public park in the country. Nothing here is at right
// angles to anything else, and that is the game.
const boston = {
  name: "Boston", district: "boston", abbr: "BO", seed: 16300,
  center: [-67.0, 38.6],   // open water — see the note on New York
  coast: [
    [-745, -272], [-835, 47], [-790, 382], [-620, 620], [-357, 727],
    [-47, 786], [276, 765], [561, 667], [765, 476], [837, 212],
    [790, -94], [620, -357], [395, -514], [217, -395], [47, -535],
    [-217, -595], [-501, -501],
  ],
  coastAmp: 30, esplanade: 20,
  cores: [
    { xy: [300, 60], w: 1.00, r: 300 },     // the financial district, on the old shore
    { xy: [60, 180], w: 0.72, r: 300 },     // downtown crossing and the Common's edge
    { xy: [-300, 130], w: 0.50, r: 330 },   // Back Bay
    { xy: [180, 400], w: 0.16, r: 220 },    // the North End and the waterfront
    { xy: [-120, -320], w: 0.10, r: 210 },  // the channel and the yards
  ],
  // Three plans that never met: the cowpaths, the fill, and the wharves.
  partition: {
    cut: cut(0, -140, 0), pos: "seaport",
    neg: {
      cut: cut(-130, 0, 90), neg: "backbay",
      pos: { cut: cut(0, 330, 0), neg: "northend", pos: "oldtown" },
    },
  },
  districts: {
    // THE COWPATHS. The highest jitter on any map here, small cells, narrow
    // streets — this is what a city looks like when nobody ever planned it.
    oldtown:  { kind: "organic", flavor: "old", cell: [2400, 6200], jitterDeg: 27, streetW: 8, fullBlockP: 0.01 },
    northend: { kind: "organic", flavor: "old", cell: [1900, 4400], jitterDeg: 24, streetW: 7, fullBlockP: 0.01 },
    // AND THE FILL. Laid out in one go in the 1850s and never deviated from:
    // the straightest grid in the book, sitting at an angle to everything.
    backbay:  { kind: "lattice", flavor: "resi", bearingDeg: -21, stPitch: 62, avePitch: 190, streetW: 14, aveW: 30, warpAmp: 0, fullBlockP: 0.02 },
    seaport:  { kind: "lattice", flavor: "industrial", bearingDeg: 12, stPitch: 88, avePitch: 240, streetW: 17, aveW: 28, warpAmp: 6, fullBlockP: 0.12 },
  },
  parks: [
    { cx: -30, cy: 175, w: 300, h: 210, deg: -6, name: "Boston Common" },
    { cx: -175, cy: 150, w: 175, h: 130, deg: -21, name: "The Public Garden" },
    { cx: -420, cy: 90, w: 120, h: 300, deg: -21, name: "The Fens" },
    { cx: 240, cy: 330, w: 95, h: 95, deg: 8, name: "Faneuil Green" },
  ],
  // Commonwealth Avenue's mall, running dead straight through the fill, and
  // the old Post Road out of the neck.
  diagonals: [
    { cx: -330, cy: 130, w: 700, h: 30, deg: 159 },
    { cx: 60, cy: -60, w: 620, h: 22, deg: 62 },
  ],
  piers: [
    [[520, 300], [650, 330], [640, 375], [510, 345]],
    [[560, 130], [700, 145], [696, 190], [556, 175]],
    [[430, 470], [545, 520], [528, 562], [413, 512]],
    [[240, -400], [270, -530], [312, -520], [282, -390]],
  ],
  cranes: [[300, -430, 40], [90, -400, 130]],
  ships: [[760, 300, 40], [420, -600, 15]],
  breakwaters: [[720, 420, 180, 14, 48]],
  stations: [
    { name: "State St", lines: "O B", xy: [300, 90], weight: 100 },
    { name: "Downtown Crossing", lines: "R O", xy: [110, 140], weight: 92 },
    { name: "Park St", lines: "R G", xy: [10, 180], weight: 86 },
    { name: "Arlington", lines: "G", xy: [-180, 150], weight: 62 },
    { name: "Copley", lines: "G", xy: [-320, 120], weight: 66 },
    { name: "Hynes", lines: "G", xy: [-460, 95], weight: 44 },
    { name: "Haymarket", lines: "O G", xy: [190, 300], weight: 50 },
    { name: "North Station", lines: "O G", xy: [160, 430], weight: 46 },
    { name: "South Station", lines: "R S", xy: [250, -110], weight: 70 },
    { name: "Courthouse", lines: "S", xy: [60, -300], weight: 24 },
  ],
  labels: [
    { name: "THE OLD TOWN", labelKind: "district", xy: [140, 60] },
    { name: "BACK BAY", labelKind: "district", xy: [-360, 160] },
    { name: "THE NORTH END", labelKind: "district", xy: [190, 450] },
    { name: "THE SEAPORT", labelKind: "district", xy: [40, -330] },
    { name: "Boston Common", labelKind: "park", xy: [-30, 175] },
    { name: "The Public Garden", labelKind: "park", xy: [-175, 150] },
    { name: "Boston Harbor", labelKind: "water", xy: [640, 60] },
    { name: "The Charles", labelKind: "water", xy: [-560, 430] },
    { name: "Fort Point Channel", labelKind: "water", xy: [190, -470] },
  ],
  avenues: ["Commonwealth Ave", "Boylston St", "Newbury St", "Beacon St", "Tremont St", "Washington St", "Atlantic Ave", "Huntington Ave"],
  streets: {
    oldtown: ["State St", "Milk St", "Congress St", "Devonshire St", "Federal St", "Franklin St", "Water St", "India St", "Broad St", "Batterymarch St", "Court St", "School St"],
    northend: ["Hanover St", "Salem St", "Prince St", "Fleet St", "North St", "Charter St", "Sheafe St"],
    backbay: ["Arlington St", "Berkeley St", "Clarendon St", "Dartmouth St", "Exeter St", "Fairfield St", "Gloucester St", "Hereford St"],
    default: ["Summer St", "Winter St", "Bromfield St", "Chauncy St"],
  },
};

// A one-line blurb per city, shown in the picker. What kind of game each is.
export const TAGLINES = {
  newalden: "The original. A colonial landing, a numbered grid, and Broadway cutting both.",
  kestrel: "A narrow peninsula — frontage is scarce and the only cheap land is at the tip.",
  newyork: "The island. Colonial lanes at the toe, the Commissioners' grid above them, Broadway across everything, and 800 acres nobody may build on.",
  chicago: "The flat one. No natural limit in three directions — land is cheap, location is everything, and the Loop is a box the tracks drew.",
  boston: "Two street plans that never met: a knot of cowpaths, and the straightest grid in America built on top of a filled-in bay.",
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
export const CITIES = { newalden, kestrel, newyork, chicago, boston };
