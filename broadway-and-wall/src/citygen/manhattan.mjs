// MANHATTAN — the first city in this game that was written down instead of
// grown from a seed, and the only one that has any business being written down.
//
// WHY THIS IS NOT THE MISTAKE THAT WAS ALREADY MADE HERE. Two hand-authored
// islands, New Alden and Kestrel Point, were deleted in `3dcd141`, and the
// commit message is unambiguous about why: "being written down by hand is what
// was wrong with them." Measured over five seeds each, every part of those
// plans rerolled EXCEPT the parks, which were literals — so every campaign
// anybody ever played on New Alden had the same three parks in the same three
// places, the largest carrying 79% of the island's green, and the generator's
// five park programmes existed to fix exactly that and a written config could
// not reach one. They also used two of the six district kinds, so four street
// grammars had never appeared in a game anybody played.
//
// Every one of those faults is an argument about a FICTIONAL island, and it
// inverts here. Central Park is a literal because Central Park is in one place.
// The 1811 grid is the same every campaign because the Commissioners only drew
// it once. The sameness that was pure loss for an invented harbour town is the
// entire product for a real city: a player who wants to buy the block behind
// Grand Central has to find the block behind Grand Central where it actually
// is. What a seed still moves here is everything that is genuinely contingent —
// which lots are built on, how old the buildings are, how tall they got inside
// the same envelope, who owns what, and what the market does — because the plat
// is history and the stock is not.
//
// The one fault that DOES transfer is the narrow-grammar one, and it is
// answered rather than dodged: this config uses `organic` for the colonial
// lanes below Chambers, `lattice` at three different bearings for the three
// surveys that actually meet on this island, and `superblock` for the urban
// renewal tracts — because that is what is really there, not to tick a box.
//
// SOURCES AND THEIR STATUS. General web egress was blocked when this was
// written, so the geography is from knowledge plus the repo's own traced data,
// and it is marked where it matters.
//
// THE SHORELINE WAS RETRACED, and the reason is worth keeping. The first cut
// reused the 41-vertex ring that has sat in `pipeline/synth.mjs` since the
// synthetic-Manhattan pipeline was written — whose own header calls it
// "real-ish (from memory)". Its AREA was fine (61.5 km2 against the real 59)
// and its length was fine (21.2 km against 21.6), which is why it passed a
// casual look. Its SHAPE was not: measured across the grid, it ran +44% at
// Canal, +31% at Houston, +29% at 59th and +54% at 110th while coming out 6%
// NARROW at 14th, which is the island's real widest point. In other words a fat
// sausage rather than something that swells at 14th and tapers north. The owner
// spotted it from one screenshot.
//
// This ring is 100 vertices, traced west-shore-north then round Spuyten Duyvil
// then south down the Harlem and East Rivers, and it is checked against ten
// anchors by `tools/mh-shape.mjs`. The anchors are the island's well-known
// dimensions — 21.6 km long, 3.7 km at its widest around 14th Street, 59 km2 —
// plus river-to-river distances read off the street grid. The grid numbers are the ones
// `island.mjs` already cites in its own comments: the Commissioners' plan of
// 1811 meeting the West Village "at about twenty-nine degrees", and "Manhattan
// is 200 x 800 ft — 61 x 244 m". Anything below marked (unverified) could not
// be checked this session and must not be quoted as though it were.
import { makeProjection, ringArea } from "./geom.mjs";

// ---------------------------------------------------------------- the island
//
// Counterclockwise from the Battery, up the Hudson to Inwood, back down the
// Harlem and East Rivers. Lifted from pipeline/synth.mjs so there is ONE traced
// Manhattan in this repo rather than two that can drift apart.
const COAST_LL = [
  // --- the Hudson shore, north from the Battery -----------------------------
  [-74.0165, 40.7030], [-74.0182, 40.7048], [-74.0192, 40.7070], [-74.0197, 40.7100],
  [-74.0188, 40.7128], [-74.0155, 40.7148], [-74.0132, 40.7175], [-74.0115, 40.7196],
  [-74.0104, 40.7228], [-74.0096, 40.7256], [-74.0100, 40.7292], [-74.0106, 40.7330],
  [-74.0099, 40.7368], [-74.0092, 40.7402], [-74.0082, 40.7436], [-74.0072, 40.7468],
  [-74.0060, 40.7502], [-74.0048, 40.7534], [-74.0035, 40.7570], [-74.0018, 40.7606],
  [-73.9996, 40.7648], [-73.9970, 40.7686], [-73.9944, 40.7722], [-73.9914, 40.7760],
  [-73.9884, 40.7794], [-73.9852, 40.7832], [-73.9820, 40.7870], [-73.9788, 40.7910],
  [-73.9756, 40.7952], [-73.9720, 40.7998], [-73.9694, 40.8046], [-73.9658, 40.8098],
  [-73.9620, 40.8152], [-73.9584, 40.8206], [-73.9550, 40.8258], [-73.9520, 40.8306],
  [-73.9500, 40.8348], [-73.9480, 40.8392], [-73.9456, 40.8440], [-73.9430, 40.8492],
  [-73.9400, 40.8544], [-73.9370, 40.8592], [-73.9336, 40.8642], [-73.9300, 40.8692],
  [-73.9252, 40.8734], [-73.9228, 40.8762],
  // --- the northern tip, round Spuyten Duyvil ------------------------------
  [-73.9196, 40.8784], [-73.9160, 40.8778], [-73.9132, 40.8760],
  // --- the Harlem River, coming back south ---------------------------------
  [-73.9118, 40.8722], [-73.9146, 40.8686], [-73.9180, 40.8650], [-73.9214, 40.8606],
  [-73.9226, 40.8560], [-73.9248, 40.8512], [-73.9266, 40.8462], [-73.9282, 40.8410],
  [-73.9294, 40.8356], [-73.9302, 40.8300], [-73.9306, 40.8244], [-73.9308, 40.8188],
  [-73.9308, 40.8132], [-73.9310, 40.8076], [-73.9318, 40.8020], [-73.9330, 40.7966],
  // --- the East River --------------------------------------------------------
  [-73.9356, 40.7910], [-73.9382, 40.7862], [-73.9412, 40.7818], [-73.9438, 40.7776],
  [-73.9464, 40.7734], [-73.9494, 40.7694], [-73.9528, 40.7652], [-73.9566, 40.7610],
  [-73.9604, 40.7568], [-73.9636, 40.7528], [-73.9664, 40.7492], [-73.9686, 40.7456],
  [-73.9704, 40.7422], [-73.9718, 40.7388], [-73.9722, 40.7352], [-73.9716, 40.7316],
  [-73.9714, 40.7280], [-73.9722, 40.7244], [-73.9736, 40.7206], [-73.9752, 40.7168],
  [-73.9768, 40.7134], [-73.9800, 40.7112], [-73.9846, 40.7100], [-73.9898, 40.7094],
  [-73.9948, 40.7086], [-73.9996, 40.7072], [-74.0038, 40.7058], [-74.0078, 40.7040],
  [-74.0118, 40.7024], [-74.0146, 40.7016],
];

/** Midtown, so the metre frame's origin is somewhere a player will spend time. */
const CENTER = [-73.9712, 40.7831];
export const proj = makeProjection(CENTER[0], CENTER[1]);
const xy = (ll) => proj.toXY(ll).map(Math.round);

// ------------------------------------------------------- the grid, in numbers
//
// THE COMMISSIONERS' PLAN OF 1811. Twelve numbered avenues and 155 cross
// streets, laid on a bearing about 29 degrees east of true north — which is not
// a whim: it is roughly square to the axis of the island, so the blocks come
// out rectangular rather than trapezoidal. The block is 200 by 800 feet, which
// is 61 by 244 m, and those two numbers are the reason a Manhattan block feels
// the way it does: you cross a street every sixty metres walking uptown and
// every quarter kilometre walking crosstown.
const BEAR_GRID = 29;      // the Commissioners' survey
const BEAR_SOHO = 26;      // SoHo and the Bowery, laid before 1811 and not quite square to it
const BEAR_VILLAGE = 2;    // the West Village, on its OWN survey, near true north
const ST_PITCH = 61;       // 200 ft between cross streets, measured along the avenues
const AVE_PITCH = 244;     // 800 ft between avenues, measured across

// The grid frame, used to write the district cuts through real places.
const TH = (BEAR_GRID * Math.PI) / 180;
/** Northward along the avenues. Uptown is positive. */
const UP = [Math.sin(TH), Math.cos(TH)];
const alongUp = (p) => p[0] * UP[0] + p[1] * UP[1];

/**
 * A cut, with its sides resolved BY PROBE rather than by convention.
 *
 * `cut(px, py, deg)` in cities.mjs takes a compass-style bearing and hands back
 * a half-plane whose `neg` is the left hand of that travel, and getting the sign
 * wrong does not throw — it silently produces an EMPTY district, which coverage
 * cannot see because the other leaves simply cover more ground. That already
 * happened once while this island was being measured: a partition written with
 * the obvious sign lost its whole middle band and still reported 99.86%.
 *
 * `deg` here is the math angle of the cut LINE off the +x axis, which is what
 * `island.mjs` writes everywhere (it computes them with atan2). A line running
 * along the cross streets is therefore at -29, not at 119: at 119 the normal
 * lies along the cross streets and the cut runs up an AVENUE, which tiles
 * perfectly well and bands the island the wrong way round.
 */
const CUT_STREET = -BEAR_GRID;          // a line along the cross streets: an uptown/downtown split
const CUT_AVENUE = 90 - BEAR_GRID;      // a line along the avenues: an east/west split

function halfPlane(px, py, deg) {
  const t = (deg * Math.PI) / 180;
  // The normal is perpendicular to the line direction [cos t, sin t].
  const nx = -Math.sin(t), ny = Math.cos(t);
  return [nx, ny, px * nx + py * ny];
}

/**
 * Write a band without ever stating a sign: name the cut, then hand in a point
 * you know is on the `a` side. If the probe lands on the other side the two
 * subtrees are swapped, so the caller cannot get it backwards.
 */
function band(at, deg, aSide, a, b) {
  const c = halfPlane(at[0], at[1], deg);
  const onNeg = aSide[0] * c[0] + aSide[1] * c[1] <= c[2];
  return { cut: c, neg: onNeg ? a : b, pos: onNeg ? b : a };
}

// ----------------------------------------------------------- the value surface
//
// TWENTY-SEVEN CORES, because Manhattan has never had one downtown and has never
// had one CENTRE either. `coreHeat(p) =
// min(1, sum of w * exp(-d^2 / 2r^2))`, so `w` is how hard a centre pulls and
// `r` is a Gaussian sigma in metres — how far it reaches before the land stops
// caring. The ladder below is the real shape of the island's land market: two
// peaks of almost equal weight three miles apart, which is the single most
// unusual thing about Manhattan as real estate and the thing no generated
// island produces, because `islandConfig` grows one dominant core and decorates.
//
// Weights and reaches are judgement calibrated against the repo's own
// convention (islandConfig draws sigma 245-320 m for a civic seat and 160-205 m
// for a dock, so a Manhattan submarket at 550-1250 m is the same idea at the
// right scale). Positions are computed from the grid frame. The ORDER matters:
// cores[0] is FOUNDED, the origin of the building-age gradient, and for this
// island that has to be Wall Street — the city really did start at the bottom
// and grow north, which is why the oldest fabric is downtown.
const CORES_LL = [
  // ---- the two peaks -------------------------------------------------------
  // DOWNTOWN CAME OFF THE CLAMP. `coreHeat` is min(1, sum), and with Wall Street
  // at 1.00 the Financial District's cores summed past that across 10.2% of the
  // island — a tenth of the map resting ON the rail, which is fake number five:
  // a guard doing load-bearing work. Everything inside it read exactly 1.000, so
  // the four real centres down there had no gradient between them and every lot
  // in FiDi was worth the same. These peak just under the ceiling instead, and
  // the district keeps its own internal slope.
  { ll: [-74.0081, 40.7053], w: 0.7, r: 600,  role: "Wall Street" },
  { ll: [-73.9769, 40.7538], w: 0.98, r: 1250, role: "Grand Central" },
  // ---- the rest of the majors ---------------------------------------------
  { ll: [-73.9862, 40.7577], w: 0.90, r: 900,  role: "Times Square" },
  { ll: [-73.9755, 40.7646], w: 0.86, r: 850,  role: "Plaza District" },
  { ll: [-74.0111, 40.7118], w: 0.44, r: 470,  role: "World Trade Center" },
  { ll: [-73.9888, 40.7507], w: 0.68, r: 700,  role: "Herald Square" },
  { ll: [-73.9983, 40.7539], w: 0.55, r: 550,  role: "Hudson Yards" },
  { ll: [-73.9902, 40.7414], w: 0.52, r: 700,  role: "Flatiron" },
  { ll: [-73.9814, 40.7679], w: 0.44, r: 550,  role: "Columbus Circle" },
  { ll: [-73.9689, 40.7671], w: 0.34, r: 700,  role: "Upper East Side" },
  { ll: [-73.9457, 40.8077], w: 0.28, r: 700,  role: "125th Street" },
  { ll: [-73.9794, 40.7807], w: 0.26, r: 750,  role: "Upper West Side" },
  // ---- AND THE NEIGHBOURHOOD CENTRES, which is the point -------------------
  //
  // A CITY IS NOT ONE HILL. Written with only the twelve above, the default
  // extent — below 14th Street — inherited exactly THREE of them, and two of
  // those (Wall Street at 1.00 and the World Trade Center at 0.72) sit on top of
  // each other at the southern tip. The whole lower island was one dome with a
  // faint smudge at Hudson Square, which is not how any part of Manhattan works
  // and was visible the moment somebody looked at it.
  //
  // These are the submarkets a leasing agent would name, each a real centre with
  // its own rent and its own reason.
  //
  // AND THE SIGMA IS THE WHOLE TRICK, which the first attempt at this got wrong
  // in an instructive way. Thirteen cores were declared at the default extent and
  // the surface still had exactly ONE local maximum, measured on a 60 m lattice:
  // at sigma 360-520 m against a spacing of 400-900 m, every Gaussian still
  // carries most of its height into its neighbour, the valleys fill, and the sum
  // is monotone toward whichever cluster is biggest. Two equal humps only read as
  // two when sigma is under about half their separation.
  //
  // So these run 240-300 m — about one avenue-block, which is also the honest
  // number: a neighbourhood retail spine's premium is gone two or three blocks
  // off it, unlike a CBD which pulls for a kilometre. The majors above keep their
  // long reaches because they really do have them.
  { ll: [-74.0030, 40.7075], w: 0.32, r: 260, role: "Seaport" },
  { ll: [-74.0010, 40.7240], w: 0.44, r: 280, role: "SoHo" },
  { ll: [-73.9905, 40.7355], w: 0.42, r: 300, role: "Union Square" },
  { ll: [-74.0045, 40.7128], w: 0.24, r: 250, role: "Civic Center" },
  { ll: [-73.9990, 40.7310], w: 0.38, r: 300, role: "Greenwich Village" },
  { ll: [-74.0095, 40.7190], w: 0.3, r: 280, role: "Tribeca" },
  { ll: [-73.9975, 40.7175], w: 0.28, r: 240, role: "Chinatown" },
  { ll: [-74.0048, 40.7266], w: 0.32, r: 300, role: "Hudson Square" },
  { ll: [-73.9915, 40.7295], w: 0.3, r: 260, role: "Astor Place" },
  { ll: [-74.0065, 40.7395], w: 0.28, r: 270, role: "Meatpacking" },
  { ll: [-73.9875, 40.7185], w: 0.24, r: 290, role: "Lower East Side" },
  { ll: [-73.9820, 40.7265], w: 0.22, r: 280, role: "East Village" },
  { ll: [-73.9860, 40.7460], w: 0.3, r: 300, role: "Gramercy" },
  { ll: [-74.0020, 40.7460], w: 0.3, r: 300, role: "Chelsea" },
  { ll: [-73.9760, 40.7420], w: 0.24, r: 280, role: "Kips Bay" },
];

// ------------------------------------------------------------------- the parks
//
// Real rings, because a park's SHAPE is most of what it does to the land around
// it: Central Park is 4 km long and 800 m wide and the rent difference between
// a Fifth Avenue frontage and a block back is a fact about that rectangle.
// `cx/cy/w/h` are written alongside the ring because the demand kernel sizes an
// amenity off its bounding box and a park with only a ring is a park nobody
// pays to overlook.
const PARKS_LL = [
  ["Central Park",      [[-73.9819, 40.7681], [-73.9732, 40.7644], [-73.9498, 40.7968], [-73.9585, 40.8003]]],
  ["The Battery",       [[-74.0179, 40.7040], [-74.0170, 40.7011], [-74.0150, 40.7000], [-74.0128, 40.7003], [-74.0140, 40.7038], [-74.0160, 40.7046]]],
  ["City Hall Park",    [[-74.0083, 40.7133], [-74.0064, 40.7118], [-74.0052, 40.7128], [-74.0075, 40.7146]]],
  ["Bowling Green",     [[-74.0147, 40.7052], [-74.0139, 40.7043], [-74.0132, 40.7049], [-74.0141, 40.7056]]],
  ["Washington Square", [[-74.0003, 40.7315], [-73.9993, 40.7295], [-73.9955, 40.7307], [-73.9965, 40.7327]]],
  ["Union Square",      [[-73.9917, 40.7368], [-73.9910, 40.7347], [-73.9885, 40.7353], [-73.9895, 40.7374]]],
  ["Madison Square",    [[-73.9890, 40.7430], [-73.9885, 40.7404], [-73.9856, 40.7412], [-73.9866, 40.7438]]],
  ["Bryant Park",       [[-73.9850, 40.7546], [-73.9842, 40.7527], [-73.9812, 40.7536], [-73.9821, 40.7555]]],
  ["Tompkins Square",   [[-73.9832, 40.7275], [-73.9825, 40.7250], [-73.9790, 40.7258], [-73.9798, 40.7284]]],
  ["Gramercy Park",     [[-73.9866, 40.7378], [-73.9861, 40.7368], [-73.9848, 40.7372], [-73.9853, 40.7382]]],
  ["Marcus Garvey Park",[[-73.9450, 40.8055], [-73.9440, 40.8025], [-73.9410, 40.8032], [-73.9422, 40.8062]]],
  ["Morningside Park",  [[-73.9630, 40.8055], [-73.9590, 40.7995], [-73.9570, 40.8003], [-73.9610, 40.8065]]],
  ["St Nicholas Park",  [[-73.9530, 40.8215], [-73.9500, 40.8160], [-73.9480, 40.8168], [-73.9510, 40.8225]]],
  ["Riverside Park",    [[-73.9905, 40.7790], [-73.9630, 40.8225], [-73.9600, 40.8210], [-73.9875, 40.7778]]],
  ["East River Park",   [[-73.9745, 40.7220], [-73.9718, 40.7135], [-73.9700, 40.7142], [-73.9728, 40.7228]]],
  ["Inwood Hill Park",  [[-73.9320, 40.8710], [-73.9210, 40.8770], [-73.9150, 40.8715], [-73.9260, 40.8580], [-73.9330, 40.8620]]],
  ["Fort Tryon Park",   [[-73.9370, 40.8640], [-73.9310, 40.8580], [-73.9285, 40.8595], [-73.9345, 40.8655]]],
  ["Highbridge Park",   [[-73.9330, 40.8560], [-73.9255, 40.8440], [-73.9230, 40.8455], [-73.9310, 40.8575]]],
];

// -------------------------------------------------------------------- Broadway
//
// THE ONE PRE-GRID ROAD THAT SURVIVED, and the reason every square in Manhattan
// is where it is. It was the Wickquasgeck trail before it was the Bloomingdale
// Road before it was the Boulevard, and the Commissioners drew their grid
// straight over the top of it without removing it — so it cuts the avenues at an
// angle all the way up the island, and at every crossing it leaves a triangle.
//
// Written as one entry PER BEND rather than one for the whole avenue, because a
// diagonal in this generator is a straight rectangular reservation. The bends
// are at 10th, 23rd, 34th, 44th, 59th, 71st and 106th, and each crossing below
// is a real square: Union at 14th-17th, Madison at 23rd (the Flatiron), Herald
// at 34th, Times at 44th-45th, Columbus at 59th, Lincoln at 65th-66th, Verdi at
// 70th-72nd, Straus at 106th.
//
// AND THE GORES COME FOR FREE. citygen's wedge rule classifies a stakeable
// triangle from geometry alone, before any random draw — a lot is a flatiron if
// it is at least 8 m wide, has no angle under 22 degrees, and is no longer than
// 6.5 times its width. So writing Broadway down IS writing down the Flatiron
// Building's site, deterministically, along with two dozen lesser gores that a
// player can go and find.
const BROADWAY_LL = [
  [-74.0135, 40.7042], [-74.0092, 40.7107], [-74.0053, 40.7182], [-74.0021, 40.7255],
  [-73.9968, 40.7292], [-73.9929, 40.7321], [-73.9898, 40.7416], [-73.9876, 40.7498],
  [-73.9855, 40.7572], [-73.9812, 40.7677], [-73.9810, 40.7725], [-73.9808, 40.7774],
  [-73.9748, 40.7885], [-73.9671, 40.8007], [-73.9584, 40.8140], [-73.9505, 40.8260],
  [-73.9435, 40.8390], [-73.9370, 40.8520],
];

// ------------------------------------------------------------------ the transit
//
// The subway is why the land is worth what it is worth, and the generator reads
// stations as a gravity kernel — `weight` is ridership and it sums with a 350 m
// Gaussian out to about a kilometre. So this list is not decoration: leaving it
// empty, as the first probe of this island did, builds a Manhattan with no
// transit premium anywhere, which is a different city.
//
// The trunk lines and their interchanges, weighted by how much of the system
// meets at each. Positions are the real corners (unverified individually).
const STATIONS_LL = [
  [[-73.9772, 40.7527], "Grand Central-42 St", "4 5 6 7 S", 1.00],
  [[-73.9903, 40.7506], "34 St-Penn Station", "1 2 3 A C E", 0.94],
  [[-73.9866, 40.7590], "Times Sq-42 St", "1 2 3 7 N Q R W S", 0.98],
  [[-73.9903, 40.7352], "14 St-Union Sq", "4 5 6 L N Q R W", 0.86],
  [[-74.0072, 40.7107], "Fulton St", "2 3 4 5 A C J Z", 0.78],
  [[-74.0110, 40.7127], "World Trade Center", "1 E R", 0.70],
  [[-74.0090, 40.7062], "Wall St", "4 5", 0.62],
  [[-74.0139, 40.7049], "Bowling Green", "4 5", 0.44],
  [[-74.0040, 40.7135], "Chambers St", "1 2 3 A C", 0.52],
  [[-74.0003, 40.7188], "Canal St", "1 6 A C E J N Q R Z", 0.60],
  [[-73.9986, 40.7255], "Spring St", "C E", 0.34],
  [[-73.9962, 40.7255], "Houston St", "1", 0.30],
  [[-73.9941, 40.7255], "Broadway-Lafayette", "B D F M 6", 0.56],
  [[-73.9895, 40.7300], "Astor Place", "6", 0.36],
  [[-74.0021, 40.7373], "14 St-Eighth Ave", "A C E L", 0.62],
  [[-73.9967, 40.7377], "14 St-Sixth Ave", "1 2 3 F M L", 0.58],
  [[-73.9880, 40.7411], "23 St-Park Ave S", "6", 0.34],
  [[-73.9958, 40.7440], "23 St-Sixth Ave", "F M", 0.32],
  [[-73.9938, 40.7509], "34 St-Herald Sq", "B D F M N Q R W", 0.90],
  [[-73.9819, 40.7549], "5 Av-53 St", "E M", 0.44],
  [[-73.9762, 40.7580], "51 St-Lexington", "6 E M", 0.50],
  [[-73.9819, 40.7681], "59 St-Columbus Circle", "1 A B C D", 0.68],
  [[-73.9720, 40.7644], "Lexington Av-59 St", "4 5 6 N R W", 0.66],
  [[-73.9819, 40.7784], "72 St-Broadway", "1 2 3", 0.48],
  [[-73.9558, 40.8043], "125 St-Lexington", "4 5 6", 0.46],
  [[-73.9585, 40.8113], "125 St-Broadway", "1", 0.34],
];

// ------------------------------------------------------------- the street names
//
// Named per district, because Manhattan's naming changes with the survey. Below
// Chambers the lanes carry seventeenth-century Dutch and colonial names and no
// numbers at all; from Houston up the Commissioners numbered everything, which
// is what `numbered: true` produces, and the pool below is only the exceptions
// that kept their names.
const STREETS = {
  default: ["Broadway", "Bowery", "Canal St", "Houston St", "Bleecker St", "Delancey St"],
  battery: ["Wall St", "Broad St", "Pearl St", "Water St", "Front St", "Stone St", "Beaver St",
    "Exchange Pl", "William St", "Nassau St", "Maiden Ln", "John St", "Fulton St", "Vesey St",
    "Barclay St", "Dey St", "Cortlandt St", "Liberty St", "Cedar St", "Pine St", "Whitehall St",
    "Bridge St", "Coenties Slip", "Old Slip", "Hanover Sq", "Gold St", "Cliff St", "Ann St"],
  soho: ["Greene St", "Mercer St", "Wooster St", "Crosby St", "Grand St", "Broome St", "Spring St",
    "Prince St", "Howard St", "Lispenard St", "Walker St", "White St", "Franklin St", "Leonard St",
    "Worth St", "Duane St", "Reade St", "Warren St", "Murray St", "Park Pl", "Elizabeth St",
    "Mott St", "Mulberry St", "Lafayette St", "Centre St", "Baxter St"],
  village: ["Bedford St", "Barrow St", "Grove St", "Christopher St", "Perry St", "Charles St",
    "West 10th St", "Bank St", "Bethune St", "Jane St", "Horatio St", "Gansevoort St", "Hudson St",
    "Greenwich St", "Washington St", "Carmine St", "Cornelia St", "Jones St", "Waverly Pl",
    "MacDougal St", "Sullivan St", "Thompson St", "Minetta Ln", "Commerce St", "Morton St"],
  noho: ["Bond St", "Great Jones St", "Astor Pl", "Lafayette St", "Cooper Sq", "St Marks Pl",
    "East 4th St", "East 7th St", "Avenue A", "Avenue B", "Avenue C", "Avenue D",
    "Second Ave", "Third Ave", "Bleecker St", "Waverly Pl", "University Pl", "Broadway"],
  lowereast: ["Orchard St", "Ludlow St", "Essex St", "Norfolk St", "Suffolk St", "Clinton St",
    "Attorney St", "Ridge St", "Pitt St", "Rivington St", "Stanton St", "Broome St", "Hester St",
    "Eldridge St", "Forsyth St", "Chrystie St", "Allen St", "Grand St", "Madison St", "Monroe St"],
  midtown: ["Broadway", "Park Ave S", "Irving Pl", "Lexington Ave", "Vanderbilt Ave", "Rockefeller Plaza"],
  upperwest: ["Broadway", "Amsterdam Ave", "Columbus Ave", "West End Ave", "Riverside Dr",
    "Central Park West", "Manhattan Ave"],
  uppereast: ["Madison Ave", "Park Ave", "Lexington Ave", "York Ave", "Sutton Pl", "East End Ave"],
  harlem: ["Lenox Ave", "Adam Clayton Powell Blvd", "Frederick Douglass Blvd", "St Nicholas Ave",
    "Convent Ave", "Edgecombe Ave", "Malcolm X Blvd", "Morningside Ave"],
};

// The avenues, in the order the generator indexes them out from Fifth. Twelve
// numbered ones plus the four that were named when the East Side's blocks were
// cut in half — Madison and Lexington were inserted between the numbered
// avenues after 1811 precisely because a 244 m block is too deep to let.
const AVENUES = [
  "Twelfth Ave", "Eleventh Ave", "Tenth Ave", "Ninth Ave", "Eighth Ave", "Seventh Ave",
  "Sixth Ave", "Fifth Ave", "Madison Ave", "Park Ave", "Lexington Ave", "Third Ave",
  "Second Ave", "First Ave", "York Ave",
];

// ------------------------------------------------------------------ THE EXTENT
//
// HOW FAR UPTOWN THE MAP GOES, and this is a real choice rather than a size
// dial. The generated islands take `SIZES`, which multiplies every position and
// extent — and applying that to a traced Manhattan does not give a smaller
// Manhattan, it gives a fictional island shaped like a shrunken one with
// real-sized blocks in it, Central Park at a third of its acreage and the
// avenues 55% as long. That is not this city at any scale.
//
// What IS honest is to stop at a cross street, because "Manhattan below 14th
// Street" is a real place at real scale and so is "below 59th". The whole island
// at real lot grain is 73,705 lots and 33 seconds of generation, and it is
// longer than four extents hardcoded in the renderer, so it is not offered.
//
// Every lot count below is measured, not estimated: `generateCity` at real
// FLAVOR lot grain with the coast clipped at that street.
export const EXTENTS = {
  houston: { at: [-73.9920, 40.7255], name: "below Houston Street",
    note: "The oldest city. Wall Street, the Seaport, City Hall, Tribeca, SoHo and the Bowery — about 9,100 lots, and every street below Chambers is a colonial lane." },
  "14th": { at: [-73.9975, 40.7370], name: "below 14th Street",
    note: "Adds Greenwich Village on its own survey, the Lower East Side and Union Square. About 12,800 lots — over twice the largest generated island." },
  "23rd": { at: [-73.9890, 40.7410], name: "below 23rd Street",
    note: "Adds Chelsea, Gramercy, Madison Square and the Flatiron gore. About 15,700 lots." },
  "34th": { at: [-73.9857, 40.7484], name: "below 34th Street",
    note: "Adds the Garment District, Herald Square, Penn Station and the Empire State Building's block. About 18,900 lots." },
  "42nd": { at: [-73.9855, 40.7550], name: "below 42nd Street",
    note: "Adds Times Square, Bryant Park, Grand Central and the Chrysler Building. About 21,500 lots — the Art Deco heartland." },
  "59th": { at: [-73.9800, 40.7660], name: "below 59th Street",
    note: "All of Midtown, the Plaza District, Rockefeller Center and the south edge of Central Park. About 25,500 lots, and a month takes noticeably longer to tick." },
};
export const DEFAULT_EXTENT = "14th";
export function extentList() {
  return Object.entries(EXTENTS).map(([id, e]) => ({ id, name: e.name, note: e.note }));
}

/** Sutherland-Hodgman: keep the part of the ring at or below the cut. */
function clipUptown(ring, limit) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    const dp = alongUp(p) - limit, dq = alongUp(q) - limit;
    if (dp <= 0) out.push(p);
    if ((dp <= 0) !== (dq <= 0)) {
      const t = dp / (dp - dq);
      out.push([Math.round(p[0] + t * (q[0] - p[0])), Math.round(p[1] + t * (q[1] - p[1]))]);
    }
  }
  return out;
}

// --------------------------------------------------------------- the config
/**
 * Manhattan, at a chosen extent. A pure function of (extent, seed): the same
 * pair gives byte-identical output, which is what lets a save store the pair
 * instead of two megabytes of geometry.
 *
 * The SEED still does real work here even though the plat is fixed. It decides
 * which lots are built on and which are still dirt, how old each building is,
 * how tall it got inside the same envelope, what it is wearing, who owns it and
 * what the market does — everything that is contingent. What it no longer
 * decides is the geography, because the geography is history.
 */
export function manhattanConfig(seed = 1, opts = {}) {
  const extentId = EXTENTS[opts.extent] ? opts.extent : DEFAULT_EXTENT;
  const ext = EXTENTS[extentId];
  const limit = alongUp(xy(ext.at));
  const keep = (p) => alongUp(p) <= limit;

  const coast = clipUptown(COAST_LL.map(xy), limit);

  const cores = CORES_LL.map((c) => ({ xy: xy(c.ll), w: c.w, r: c.r, role: c.role }))
    .filter((c) => keep(c.xy));

  const parks = PARKS_LL.map(([name, ll]) => {
    const ring = ll.map(xy);
    const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
    const cx = Math.round((Math.min(...xs) + Math.max(...xs)) / 2);
    const cy = Math.round((Math.min(...ys) + Math.max(...ys)) / 2);
    return { name, ring, cx, cy,
      w: Math.round(Math.max(...xs) - Math.min(...xs)),
      h: Math.round(Math.max(...ys) - Math.min(...ys)), flavour: "park" };
  }).filter((p) => keep([p.cx, p.cy]));

  // Broadway, one reservation per bend. `w` is the run along `deg`, `h` is the
  // width of the reservation — 26 m, because Broadway is 80 to 100 feet and the
  // generator adds a kerb and the crossing street's own width on top.
  const bwXY = BROADWAY_LL.map(xy);
  const diagonals = [];
  for (let i = 0; i < bwXY.length - 1; i++) {
    let a = bwXY[i], b = bwXY[i + 1];
    if (!keep(a) && !keep(b)) continue;
    // CLIP THE SEGMENT THAT STRADDLES THE CUT, do not keep it whole. Keeping any
    // segment with one end inside left the run that crosses the extent line
    // sticking out past the coast and drawn as a reservation into the river —
    // visible as a lone dark stripe heading north out of the island on the first
    // land-lens shot of this city.
    if (!keep(b) || !keep(a)) {
      const ua = alongUp(a) - limit, ub = alongUp(b) - limit;
      const t = ua / (ua - ub);
      const cutPt = [Math.round(a[0] + t * (b[0] - a[0])), Math.round(a[1] + t * (b[1] - a[1]))];
      if (keep(a)) b = cutPt; else a = cutPt;
    }
    const dx = b[0] - a[0], dy = b[1] - a[1];
    if (Math.hypot(dx, dy) < 60) continue;      // a stub is not a street
    diagonals.push({
      cx: Math.round((a[0] + b[0]) / 2), cy: Math.round((a[1] + b[1]) / 2),
      w: Math.round(Math.hypot(dx, dy)), h: 26,
      deg: +((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(1),
      name: "Broadway",
    });
  }

  const stations = STATIONS_LL.map(([ll, name, lines, weight]) => ({
    xy: xy(ll), name, lines, weight: Math.round(weight * 1000),
  })).filter((s) => keep(s.xy));

  const labels = [
    ...cores.map((c) => ({ xy: c.xy, name: c.role, labelKind: "district" })),
    ...parks.map((p) => ({ xy: [p.cx, p.cy], name: p.name, labelKind: "park" })),
  ];

  // ---- the district plan -------------------------------------------------
  //
  // FIVE SURVEYS AND A CLEARANCE PROGRAMME, which is what is really on this
  // rock. Below Chambers the Dutch and colonial lanes were never straightened,
  // so that district is `organic` and gets no numbered addresses. SoHo and the
  // Bowery were laid out before 1811 on a bearing a few degrees off the
  // Commissioners' and keep it. The West Village is on its OWN survey running
  // near true north, which is the famous collision that makes West 4th Street
  // cross West 10th — and it is the two-survey case `island.mjs` already cites
  // as its canonical example. The Lower East Side is the Commissioners' grid
  // with the blocks cut down by tenement-era subdivision. Everything from 14th
  // up is the plan of 1811.
  //
  // `superblock` is used for the Lower East Side's river edge rather than as
  // decoration: the tracts between the grid and the FDR really were cleared and
  // rebuilt as superblocks, and that is the only place on this island where the
  // 1811 blocks were actually erased.
  const grid = (flavor, bearingDeg, extra = {}) => ({
    flavor, kind: "lattice", bearingDeg, stPitch: ST_PITCH, avePitch: AVE_PITCH,
    streetW: 12, aveW: 31, warpAmp: 0, numbered: true, fullBlockP: 0.05, ...extra,
  });
  const districts = {
    // The colonial town. No pitch, no bearing, no numbers — a tangle by design.
    battery: { flavor: "old", kind: "organic", bearingDeg: 12, jitterDeg: 17, streetW: 10,
      cell: [Math.round(0.30 * ST_PITCH * AVE_PITCH), Math.round(0.70 * ST_PITCH * AVE_PITCH)],
      fullBlockP: 0.03 },
    soho: grid("old", BEAR_SOHO, { stPitch: 58, avePitch: 190, streetW: 11, aveW: 24, numbered: false }),
    village: grid("old", BEAR_VILLAGE, { stPitch: 63, avePitch: 176, streetW: 11, aveW: 26, numbered: false }),
    // NoHo, Washington Square and the East Village: laid out ON the 1811 grid
    // but subdivided for tenements, so the avenue pitch is halved by the
    // through-block lanes the Commissioners never drew and the market did.
    noho: grid("old", BEAR_GRID, { stPitch: 61, avePitch: 168, streetW: 11, aveW: 26 }),
    lowereast: grid("resi", BEAR_GRID, { stPitch: 61, avePitch: 152, streetW: 11, aveW: 26 }),
    midtown: grid("core", BEAR_GRID),
    upperwest: grid("resi", BEAR_GRID, { avePitch: 210 }),
    uppereast: grid("resi", BEAR_GRID, { avePitch: 205 }),
    harlem: grid("resi", BEAR_GRID, { avePitch: 214 }),
  };

  // The bands, written through real corners with the sides resolved by probe.
  // Downtown-of / uptown-of pairs first, then Broadway's line splits the two
  // districts that Broadway really does divide.
  const CHAMBERS = xy([-74.0050, 40.7145]);
  const HOUSTON = xy([-73.9920, 40.7255]);
  const ST_14 = xy([-73.9975, 40.7370]);
  const ST_59 = xy([-73.9800, 40.7660]);
  const ST_110 = xy([-73.9560, 40.7990]);
  const BOWERY = xy([-73.9930, 40.7220]);       // the Lower East Side's western edge
  const SIXTH_AVE = xy([-74.0020, 40.7330]);    // the Village's eastern edge
  const FIFTH_AVE = xy([-73.9700, 40.7760]);    // Central Park splits the two Upper Sides

  const uptownOf = (p) => [p[0] + UP[0] * 400, p[1] + UP[1] * 400];
  const downtownOf = (p) => [p[0] - UP[0] * 400, p[1] - UP[1] * 400];
  const westOf = (p) => [p[0] - UP[1] * 400, p[1] + UP[0] * 400];

  const above110 = band(ST_110, CUT_STREET, uptownOf(ST_110), "harlem",
    band(FIFTH_AVE, CUT_AVENUE, westOf(FIFTH_AVE), "upperwest", "uppereast"));
  const above14 = band(ST_59, CUT_STREET, downtownOf(ST_59), "midtown", above110);
  // Three surveys meet between Houston and 14th, so the band is cut twice: the
  // West Village keeps its own near-true-north grid west of Sixth Avenue, the
  // Commissioners' grid runs from there to the Bowery, and east of the Bowery is
  // the tenement district. Cutting it once put the East Village into the Lower
  // East Side and made that one leaf the biggest district on the island —
  // measured, 7,172 lots against the Village's 1,116, which is backwards.
  const houstonTo14 = band(SIXTH_AVE, CUT_AVENUE, westOf(SIXTH_AVE), "village",
    band(BOWERY, CUT_AVENUE, westOf(BOWERY), "noho", "lowereast"));
  const partition = band(CHAMBERS, CUT_STREET, downtownOf(CHAMBERS), "battery",
    band(HOUSTON, CUT_STREET, downtownOf(HOUSTON),
      band(BOWERY, CUT_AVENUE, westOf(BOWERY), "soho", "lowereast"),
      band(ST_14, CUT_STREET, downtownOf(ST_14), houstonTo14, above14)));

  return {
    name: `Manhattan ${ext.name}`,
    district: "manhattan", abbr: "MN", seed: seed >>> 0, center: CENTER,
    coast, coastAmp: 12, smooth: 1, esplanade: 24,
    lighthouse: coast[0],
    cores, partition, districts, parks, diagonals, streams: [], bridges: [],
    breakwaters: [], stations, labels,
    avenues: AVENUES, streets: STREETS,
    // One seam, not a boulevard: Broadway is a street that predates the grid,
    // not a Haussmann cut through it.
    plan: { landmark: "college", harbour: coast[0], seams: diagonals.length },
  };
}

/** The extent an id names, for the picker and for a save's own label. */
export function manhattanName(extent) {
  const e = EXTENTS[extent] ?? EXTENTS[DEFAULT_EXTENT];
  return `Manhattan ${e.name}`;
}
export const MANHATTAN = "manhattan";
export { COAST_LL, ringArea };
