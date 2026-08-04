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
  // THE ISLAND WAS A LOZENGE. It ran 2130 m by 925 — 2.30:1, with a bulbous
  // rounded top and a width that held flat from the Village to Harlem and then
  // fell off a cliff. Manhattan is 21.6 km by 3.7 at its widest: 5.8:1, a point
  // at the Battery, the waist at 14th Street about a third of the way up, and a
  // steady taper to a finger at Spuyten Duyvil. What was drawn here was not a
  // narrow island, it was a fat one, and everything downstream reads it: an
  // island whose scarce thing is frontage cannot be shaped like a thumb.
  //
  // Held to 3.9:1 rather than the true 5.8 because the lattice needs four or
  // five avenues across the waist before a grid is a grid. Every other property
  // of the real outline is here: the point, the waist a third up, the taper,
  // and a centreline that drifts west as it climbs.
  coast: [
    [0, -1495], [-107, -1365], [-212, -1196], [-300, -1014], [-361, -832],
    [-393, -676], [-398, -494], [-396, -286], [-393, -78], [-386, 130],
    [-377, 338], [-364, 546], [-346, 754], [-318, 949], [-283, 1131],
    [-242, 1300], [-198, 1443], [-156, 1541], [-104, 1541], [-47, 1443],
    [18, 1300], [81, 1131], [137, 949], [185, 754], [224, 546],
    [257, 338], [287, 130], [315, -78], [339, -286], [361, -494],
    [377, -676], [372, -832], [337, -1014], [269, -1196], [179, -1365],
    [78, -1495],
  ],
  coastAmp: 18, esplanade: 20,
  cores: [
    { xy: [50, -1140], w: 1.00, r: 290 },   // Wall Street, at the toe
    { xy: [-40, -80], w: 0.86, r: 360 },    // Midtown, around the terminal
    { xy: [-55, -585], w: 0.30, r: 280 },   // the Village and the loft district
    { xy: [-180, 940], w: 0.20, r: 280 },   // uptown, above the park
    { xy: [-325, -195], w: 0.09, r: 200 },  // the west side yards
  ],
  // Four leaves: the colonial toe, the loft district, the numbered grid, and
  // the uptown grid above the park. The cuts run east-west because the island
  // does, which is why every New Yorker gives directions in blocks.
  partition: {
    cut: cut(0, -935, 0), pos: "downtown",
    neg: {
      cut: cut(0, -520, 0), pos: "lofts",
      neg: { cut: cut(0, 650, 0), neg: "uptown", pos: "midtown" },
    },
  },
  districts: {
    // No grid at all below the old wall — cell sizes small, angles wandering.
    downtown: { kind: "organic", flavor: "old", cell: [2600, 6800], jitterDeg: 21, streetW: 8, fullBlockP: 0.02 },
    // The loft district: the grid has arrived but the blocks are still long
    // and the buildings on them were built for machines, not people.
    lofts:    { kind: "lattice", flavor: "industrial", bearingDeg: 5, stPitch: 74, avePitch: 158, streetW: 13, aveW: 24, warpAmp: 4, fullBlockP: 0.04 },
    // THE COMMISSIONERS' PLAN. Twenty short blocks to a mile and three long
    // ones — the most valuable rectangle in the world, and the reason a corner
    // on an avenue is worth what it is.
    //
    // THE GRID RAN AT 29 DEGREES ACROSS AN ISLAND WHOSE AXIS WAS VERTICAL.
    // Manhattan's grid is rotated 29 degrees on a compass for exactly one
    // reason: the island is, and the avenues run along it. Rotating the grid
    // inside a frame where the island already runs north meant every avenue
    // met the water at an angle, and the plan render showed the consequence
    // down both shores — a fringe of orange cells too thin to carry a setback
    // and a rank of red bare-ground dots behind them, for two miles. The
    // avenues run up the island now, which is what the 29 degrees was always
    // FOR, and Broadway's 103 becomes what it is supposed to be: a shallow
    // crossing that makes a square at every avenue instead of a road at right
    // angles to the town.
    //
    // The avenue pitch comes down with it. At 274 m on a 590 m waist the
    // island carried two avenues; the real one carries twelve across 3.7 km,
    // which is the same 280 m — the pitch was right for Manhattan's width and
    // this island is a sixth of it.
    midtown:  { kind: "lattice", flavor: "core", bearingDeg: 2, stPitch: 61, avePitch: 148, streetW: 15, aveW: 31, warpAmp: 1, numbered: true, fullBlockP: 0.05 },
    uptown:   { kind: "lattice", flavor: "resi", bearingDeg: 2, stPitch: 61, avePitch: 148, streetW: 14, aveW: 28, warpAmp: 1, numbered: true, fullBlockP: 0.03 },
  },
  parks: [
    // The one nobody may build on, and the reason the addresses beside it cost
    // what they do. It was 250 by 720 on an island 925 wide — a quarter of the
    // town under grass. The real park is 4 km by 800 m on an island of 59 km2:
    // six per cent. This is that proportion, on this island, in the place it
    // actually sits — up the middle and a little west.
    { cx: -95, cy: 560, w: 125, h: 610, deg: 2, name: "Central Park" },
    { cx: 40, cy: -1080, w: 88, h: 88, deg: 2, name: "Bowling Green" },
    { cx: -90, cy: -545, w: 140, h: 112, deg: 2, name: "Washington Square" },
    { cx: 30, cy: -145, w: 112, h: 86, deg: 2, name: "Bryant Park" },
  ],
  // Broadway, running the whole length and agreeing with nothing — but
  // agreeing enough to stay on the island. At 103 degrees it leans 13 off
  // vertical, which over 2.9 km of length is 660 m of westward drift on an
  // island 775 m wide: it left the map through the Hudson somewhere around
  // 80th Street. The island's own centreline drifts about 2.5 degrees west as
  // it climbs, so a road that crosses the avenues by four or five degrees
  // makes its squares and still comes out at the top.
  diagonals: [{ cx: -60, cy: -235, w: 2900, h: 30, deg: 96.5 }],
  piers: [
    [[-390, -560], [-520, -590], [-526, -548], [-396, -518]],
    [[-396, -230], [-528, -256], [-534, -214], [-402, -188]],
    [[-390, 120], [-520, 98], [-524, 140], [-394, 162]],
    [[370, -690], [500, -726], [510, -684], [380, -648]],
    [[358, -300], [489, -328], [497, -286], [366, -258]],
    [[330, 60], [460, 40], [466, 82], [336, 102]],
  ],
  cranes: [[-430, -400, 18], [-420, 20, 96]],
  ships: [[-620, -760, 62], [600, -900, 118], [-40, -1560, 20]],
  breakwaters: [[130, -1560, 220, 15, 22]],
  stations: [
    { name: "Wall St", lines: "2 3 4 5", xy: [55, -1150], weight: 100 },
    { name: "Fulton St", lines: "A C 4 5", xy: [20, -1010], weight: 78 },
    { name: "Canal St", lines: "6 N Q", xy: [-60, -700], weight: 54 },
    { name: "Union Sq", lines: "4 5 6 N Q L", xy: [-80, -330], weight: 82 },
    { name: "Grand Central", lines: "4 5 6 7 S", xy: [25, -30], weight: 96 },
    { name: "Times Sq", lines: "1 2 3 N Q R 7 S", xy: [-90, 20], weight: 94 },
    { name: "Columbus Circle", lines: "A C B D 1", xy: [-185, 300], weight: 66 },
    { name: "72nd St", lines: "1 2 3", xy: [-230, 560], weight: 48 },
    { name: "125th St", lines: "A B C D", xy: [-255, 1160], weight: 40 },
    { name: "Hudson Yards", lines: "7", xy: [-330, -20], weight: 26 },
  ],
  labels: [
    { name: "DOWNTOWN", labelKind: "district", xy: [90, -1180] },
    { name: "THE LOFTS", labelKind: "district", xy: [-130, -640] },
    { name: "MIDTOWN", labelKind: "district", xy: [20, 60] },
    { name: "UPTOWN", labelKind: "district", xy: [-215, 1080] },
    { name: "Central Park", labelKind: "park", xy: [-95, 560] },
    { name: "Washington Square", labelKind: "park", xy: [-90, -545] },
    { name: "Bowling Green", labelKind: "park", xy: [40, -1080] },
    { name: "Upper Bay", labelKind: "water", xy: [60, -1620] },
    { name: "Hudson River", labelKind: "water", xy: [-560, 420] },
    { name: "East River", labelKind: "water", xy: [510, 300] },
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
  // IT WAS AN ISLAND. A rounded blob with water on all four sides, in the one
  // city on this list whose entire character is that the grid meets NO
  // obstacle in three directions — the note directly above says so and the
  // outline said the opposite. A player looking at it saw a small town on a
  // rock, which is Kestrel Point's game, not this one.
  //
  // Three of these edges are dead straight and they are the FRAME, not a
  // shore: a grid that runs to the edge of the paper reads as a grid that
  // keeps going. The fourth is Lake Michigan, and it is the only real
  // coastline on the map — which is exactly the asymmetry the city is built
  // out of, and why every good address in Chicago faces one direction.
  coast: [
    [-700, -720], [-700, -600], [-700, -480], [-700, -360], [-700, -240],
    [-700, -120], [-700, 0], [-700, 120], [-700, 240], [-700, 360],
    [-700, 480], [-700, 600], [-700, 720], [-700, 760], [-570, 760],
    [-440, 760], [-310, 760], [-180, 760], [-50, 760], [80, 760],
    [210, 760], [340, 760], [430, 760], [476, 600], [496, 430],
    [504, 250], [500, 60], [488, -130], [468, -320], [440, -500],
    [408, -660], [380, -720], [270, -720], [140, -720], [10, -720],
    [-120, -720], [-250, -720], [-380, -720], [-510, -720], [-640, -720],
  ],
  // smooth: 0 — the three straight edges are a FRAME and a frame has corners.
  // Chaikin rounds every vertex it is given, which turned the four corners of
  // the grid into arcs and left a bare wedge behind each one.
  coastAmp: 4, smooth: 0, esplanade: 46,   // Burnham's lakefront: wide, green, public
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
    // AND THE BLOCKS WERE HALF EMPTY BECAUSE THEY WERE NEVER SUBDIVIDED.
    // Chicago carried the loosest street pitch of any map here AND the highest
    // full-block probability — 9 and 10 per cent across a third of the town —
    // so the west and south sides came out as a field of enormous undivided
    // rectangles: median lot 994 m2 against a 453 m2 median for the game, and
    // 2.6% of every lot over 2,500 m2 against 0.5-1.2% everywhere else. 1,028
    // lots on the LARGEST buildable area of the five, which is 714 lots to the
    // square kilometre where New Alden runs 1,030. That is the sparseness.
    // Chicago's blocks are big; they are not empty.
    loop:      { kind: "lattice", flavor: "core", bearingDeg: 0, stPitch: 62, avePitch: 158, streetW: 16, aveW: 28, warpAmp: 0, numbered: true, fullBlockP: 0.05 },
    northside: { kind: "lattice", flavor: "resi", bearingDeg: 0, stPitch: 56, avePitch: 152, streetW: 14, aveW: 24, warpAmp: 1, numbered: true, fullBlockP: 0.02 },
    southloop: { kind: "lattice", flavor: "industrial", bearingDeg: 0, stPitch: 68, avePitch: 172, streetW: 16, aveW: 26, warpAmp: 2, fullBlockP: 0.04 },
    westside:  { kind: "lattice", flavor: "industrial", bearingDeg: 0, stPitch: 72, avePitch: 184, streetW: 17, aveW: 28, warpAmp: 3, fullBlockP: 0.04 },
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
  // IT WAS A DISC. A near-perfect circle, 1.17:1, in the city whose whole
  // identity is a peninsula so narrow it was nearly an island — the note above
  // says "built on a peninsula", and what was drawn was a dinner plate. The
  // shape IS the game here: the neck is why the Back Bay had to be filled, the
  // fill is why there are two street plans, and a circle has neither.
  //
  // So: the bulb of cowpaths on the old shore with the harbour biting into it
  // from the east, the Charles cutting in from the north, a narrow neck
  // running west, and the filled bay squared off on the end of it.
  coast: [
    [-996, 328], [-1009, 118], [-963, -52], [-786, -124], [-563, -157],
    [-393, -196], [-282, -308], [-196, -432], [-79, -550], [105, -616],
    [308, -596], [432, -511], [550, -393], [655, -229], [734, -39],
    [786, 170], [773, 393], [694, 583], [550, 734], [354, 838],
    [157, 904], [-52, 917], [-236, 858], [-367, 747], [-432, 616],
    [-511, 544], [-681, 517], [-865, 472], [-976, 413],
  ],
  coastAmp: 14, esplanade: 20,
  cores: [
    { xy: [393, 79], w: 1.00, r: 393 },     // the financial district, on the old shore
    { xy: [79, 236], w: 0.72, r: 393 },     // downtown crossing and the Common's edge
    { xy: [-393, 170], w: 0.50, r: 432 },   // Back Bay
    { xy: [236, 524], w: 0.16, r: 288 },    // the North End and the waterfront
    { xy: [-157, -419], w: 0.10, r: 275 },  // the channel and the yards
  ],
  // Three plans that never met: the cowpaths, the fill, and the wharves.
  partition: {
    cut: cut(0, -183, 0), pos: "seaport",
    neg: {
      cut: cut(-170, 0, 90), neg: "backbay",
      pos: { cut: cut(0, 432, 0), neg: "northend", pos: "oldtown" },
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
    // The seaport's blocks were the loosest on the map at 88 by 240 with a 12%
    // full-block roll, and it showed: a 14,000 m2 patch of bare ground in the
    // middle of it, the single biggest hole in any of the five cities.
    seaport:  { kind: "lattice", flavor: "industrial", bearingDeg: 12, stPitch: 76, avePitch: 196, streetW: 17, aveW: 28, warpAmp: 5, fullBlockP: 0.05 },
  },
  parks: [
    { cx: -39, cy: 229, w: 393, h: 275, deg: -6, name: "Boston Common" },
    { cx: -229, cy: 196, w: 229, h: 170, deg: -21, name: "The Public Garden" },
    { cx: -550, cy: 118, w: 157, h: 393, deg: -21, name: "The Fens" },
    { cx: 314, cy: 432, w: 124, h: 124, deg: 8, name: "Faneuil Green" },
  ],
  // Commonwealth Avenue's mall, running dead straight through the fill, and
  // the old Post Road out of the neck.
  diagonals: [
    { cx: -432, cy: 170, w: 917, h: 39, deg: 159 },
    { cx: 79, cy: -79, w: 812, h: 29, deg: 62 },
  ],
  piers: [
    [[681, 393], [852, 432], [838, 491], [668, 452]],
    [[734, 170], [917, 190], [912, 249], [728, 229]],
    [[563, 616], [714, 681], [692, 736], [541, 671]],
    [[314, -524], [354, -694], [409, -681], [369, -511]],
  ],
  cranes: [[393, -563, 40], [118, -524, 130]],
  ships: [[996, 393, 40], [550, -786, 15]],
  breakwaters: [[943, 550, 236, 14, 48]],
  stations: [
    { name: "State St", lines: "O B", xy: [393, 118], weight: 100 },
    { name: "Downtown Crossing", lines: "R O", xy: [144, 183], weight: 92 },
    { name: "Park St", lines: "R G", xy: [13, 236], weight: 86 },
    { name: "Arlington", lines: "G", xy: [-236, 196], weight: 62 },
    { name: "Copley", lines: "G", xy: [-419, 157], weight: 66 },
    { name: "Hynes", lines: "G", xy: [-603, 124], weight: 44 },
    { name: "Haymarket", lines: "O G", xy: [249, 393], weight: 50 },
    { name: "North Station", lines: "O G", xy: [210, 563], weight: 46 },
    { name: "South Station", lines: "R S", xy: [328, -144], weight: 70 },
    { name: "Courthouse", lines: "S", xy: [79, -393], weight: 24 },
  ],
  labels: [
    { name: "THE OLD TOWN", labelKind: "district", xy: [183, 79] },
    { name: "BACK BAY", labelKind: "district", xy: [-472, 210] },
    { name: "THE NORTH END", labelKind: "district", xy: [249, 590] },
    { name: "THE SEAPORT", labelKind: "district", xy: [52, -432] },
    { name: "Boston Common", labelKind: "park", xy: [-39, 229] },
    { name: "The Public Garden", labelKind: "park", xy: [-229, 196] },
    { name: "Boston Harbor", labelKind: "water", xy: [838, 79] },
    { name: "The Charles", labelKind: "water", xy: [-734, 563] },
    { name: "Fort Point Channel", labelKind: "water", xy: [249, -616] },
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
