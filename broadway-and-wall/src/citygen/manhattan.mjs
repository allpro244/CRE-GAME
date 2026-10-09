// MANHATTAN — the one city in this game that is surveyed rather than grown
// from a seed, and the only one that has any business being written down.
//
// WHY THIS IS NOT THE MISTAKE THAT WAS ALREADY MADE HERE. Two hand-authored
// islands, New Alden and Kestrel Point, were deleted in `3dcd141` because
// "being written down by hand is what was wrong with them": every campaign on
// them had the same three parks in the same three places. That fault inverts
// for a real city. Central Park is a literal because Central Park is in one
// place; a player who wants to buy the block behind Grand Central has to find
// the block behind Grand Central where it actually is. What a seed still moves
// here is everything genuinely contingent — which lots are built on, how old
// and how tall the buildings are, who owns what and what the market does —
// because the plat is history and the stock is not.
//
// THE PLAT IS THE CITY'S OWN, NOT A DRAWING OF IT. The first cut of this file
// laid the generator's lattices over a coastline traced from memory, at the
// Commissioners' bearing and pitch: the right idea at the wrong resolution.
// Fifth Avenue was wherever a 244 m pitch happened to put it, Broadway was a
// straight reservation pasted across the grid, the parks were four-cornered
// guesses with a pond dug in each (Washington Square has a fountain), the
// colonial lanes below Chambers were a random tangle rather than Wall, Pearl
// and Broad, and the island bulged where it should taper. The owner looked at
// it and called it terrible, and measured against the record it was.
//
// So the ground now comes from `data/manhattan-plat.json`, baked from public
// city records by `pipeline/manhattan/bake.py` (read its header):
//
//   * every BLOCK is the union of its real MapPLUTO tax lots, and every LOT is
//     a real tax lot with its real BBL and street address — 10,041 below 14th
//     Street, against the 12,800 the lattice cut, because the real city was
//     assembled into bigger sites than a subdivider makes;
//   * each block's STREET CELL is the Voronoi region of its kerb, so the
//     streets are the ground no lot covers, at their real widths, and two
//     kerbs meet on the street's real centre line;
//   * the PARKS are the city's open-space lots, named from Parks Properties;
//   * the COAST is the borough boundary at the bulkhead plus the piers;
//   * the STATIONS are every subway complex, weighted by its measured
//     ridership (one week of 2024, as a share of Times Square's) instead of a
//     judgement of how much of the system meets there;
//   * the retail CORRIDORS are the avenues, Broadway and the wide crosstown
//     streets, at their real roadway widths.
//
// What stays judgement, and is marked as such where it is written: the value
// cores (submarket centres a leasing agent would name, with reaches calibrated
// to the generator's own convention) and the district partition, which now
// carries only flavour, zoning and street-name pools — it no longer lays out
// a single street.
//
// THE DATA IS LOADED, NOT IMPORTED. It is 3.5 MB of geometry (0.9 MB gzipped),
// and every player of a generated island would otherwise download it. Call
// `loadManhattanPlat()` (index.mjs `preloadCity`) before `makeCity`.
import { makeProjection, ringArea } from "./geom.mjs";

/** Midtown, so the metre frame's origin is somewhere a player will spend time.
 *  pipeline/manhattan/bake.py projects into this same frame. */
const CENTER = [-73.9712, 40.7831];
export const proj = makeProjection(CENTER[0], CENTER[1]);
const xy = (ll) => proj.toXY(ll).map(Math.round);

let PLAT = null;
// An ASSET, not a module: Vite copies it into the build and the browser fetches
// and parses it as JSON, which is several times faster than evaluating it as a
// 3.5 MB JavaScript module. Under Node (harnesses, tools) the same URL is a
// file: URL and is read off disk.
// Made when asked for, not at load: inside a worker started from a blob (the
// town worker, in the single-file build) this module's own URL is a blob: URL,
// a relative URL against it throws, and the worker died before it could run.
const platUrl = () => new URL("./data/manhattan-plat.json", import.meta.url);
/** Fetch the baked plat once. Resolves immediately on every later call. */
export async function loadManhattanPlat() {
  if (!PLAT) {
    if (globalThis.document?.getElementById?.("bw-manhattan-plat")) {
      // The single-file playable (package/build-onefile.mjs) carries the plat
      // inline, because a page opened from file:// cannot fetch a neighbour.
      // Asked first: that page's URL is a file: URL too, and the Node branch
      // below is no use to a browser (it refused Manhattan outright).
      PLAT = JSON.parse(globalThis.document.getElementById("bw-manhattan-plat").textContent);
    } else if (!globalThis.document && platUrl().protocol === "file:") {
      const fsName = "node:fs/promises";   // a variable, so the browser build never resolves it
      const { readFile } = await import(/* @vite-ignore */ fsName);
      PLAT = JSON.parse(await readFile(platUrl(), "utf8"));
    } else {
      const r = await fetch(platUrl());
      if (!r.ok) throw new Error(`Manhattan plat ${r.status}`);
      PLAT = await r.json();
    }
  }
  return PLAT;
}
/** For callers that already hold the JSON (a Node harness reading the file). */
export function setManhattanPlat(data) { PLAT = data; }
export const manhattanPlatLoaded = () => PLAT !== null;

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

// The grid frame, used to write the district cuts through real places.
const TH = (BEAR_GRID * Math.PI) / 180;
/** Northward along the avenues. Uptown is positive. */
const UP = [Math.sin(TH), Math.cos(TH)];

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
// dial: "Manhattan below 14th Street" is a real place at real scale, and a
// SIZES multiplier on a surveyed city would only make a fictional island with
// real-sized blocks in it. Each extent is cut along the real centre line of its
// street in the bake — Houston bends, and the cut bends with it.
//
// Every lot count below is the baked count of real tax lots (open space is
// parks, not lots).
export const EXTENTS = {
  houston: { name: "below Houston Street",
    note: "The oldest city. Wall Street, the Seaport, City Hall, Tribeca, SoHo and the Lower East Side's southern blocks — about 4,800 real tax lots, and below Chambers the streets are the colonial lanes they always were." },
  "14th": { name: "below 14th Street",
    note: "Adds Greenwich Village on its own survey, the East Village, Stuyvesant Town and Union Square. About 10,000 real tax lots." },
  "23rd": { name: "below 23rd Street",
    note: "Adds Chelsea, Gramercy Park, Madison Square and the Flatiron Building's gore. About 12,300 lots." },
  "34th": { name: "below 34th Street",
    note: "Adds the Garment District, Herald Square, Penn Station and the Empire State Building's block. About 14,300 lots." },
  "42nd": { name: "below 42nd Street",
    note: "Adds Bryant Park, Murray Hill and the Hudson Yards. About 15,700 lots." },
  "59th": { name: "below 59th Street",
    note: "All of Midtown: Times Square, Grand Central, Rockefeller Center, the Plaza District and the south edge of Central Park. About 19,000 lots." },
};
export const DEFAULT_EXTENT = "14th";
export function extentList() {
  return Object.entries(EXTENTS).map(([id, e]) => ({ id, name: e.name, note: e.note }));
}

const ring = (flat) => {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i] / 10, flat[i + 1] / 10]);
  return out;
};
function inside(p, r) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    if ((r[i][1] > p[1]) !== (r[j][1] > p[1])
      && p[0] < ((r[j][0] - r[i][0]) * (p[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
  }
  return c;
}
function bbox(r) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of r) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
}

// --------------------------------------------------------------- the config
/**
 * Manhattan, at a chosen extent. A pure function of (extent, seed) and the
 * baked plat: the same pair gives byte-identical output, which is what lets a
 * save store the pair instead of the geometry.
 */
export function manhattanConfig(seed = 1, opts = {}) {
  if (!PLAT) throw new Error("Manhattan's plat is not loaded — await loadManhattanPlat() (index.mjs preloadCity) first");
  const extentId = EXTENTS[opts.extent] ? opts.extent : DEFAULT_EXTENT;
  const ext = EXTENTS[extentId];
  const ei = PLAT.extents.indexOf(extentId);
  const coast = ring(PLAT.coast[extentId]);
  const onLand = (p) => inside(p, coast);

  const cores = CORES_LL.map((c) => ({ xy: xy(c.ll), w: c.w, r: c.r, role: c.role }))
    .filter((c) => onLand(c.xy));

  const blocks = PLAT.blocks.filter((b) => b.e <= ei).map((b) => ({
    n: b.n, cell: ring(b.c), outline: ring(b.o),
    lots: b.l.map(([r, bbl, address, landuse]) => ({ ring: ring(r), bbl, address, landuse })),
  }));
  const parkRecs = PLAT.parks.filter((p) => p.e <= ei);
  const parks = parkRecs.map((p) => {
    const r = ring(p.o);
    const [x0, y0, x1, y1] = bbox(r);
    return {
      name: p.name, ring: r, real: true,
      cx: Math.round((x0 + x1) / 2), cy: Math.round((y0 + y1) / 2),
      w: Math.round(x1 - x0), h: Math.round(y1 - y0),
      // The Battery is the battery the generator's flavour is named after:
      // open lawn on the harbour and a flagstaff.
      flavour: p.name === "The Battery" ? "battery" : "park",
    };
  });

  const stations = PLAT.stations.filter((s) => s.e <= ei).map((s) => ({
    xy: [Math.round(s.x / 10), Math.round(s.y / 10)], name: s.name, lines: s.lines,
    weight: Math.round(s.w * 1000),
  }));
  const corridors = PLAT.corridors.map((c) => ({ name: c.name, w: c.w, line: ring(c.p) }));

  // Label the parks a map would: the named ones big enough to read.
  const labels = [
    ...cores.map((c) => ({ xy: c.xy, name: c.role, labelKind: "district" })),
    ...parks.filter((p) => p.name !== "Open space" && Math.abs(ringArea(p.ring)) > 4000)
      .map((p) => ({ xy: [p.cx, p.cy], name: p.name, labelKind: "park" })),
  ];

  // ---- the district partition ---------------------------------------------
  //
  // FLAVOUR, ZONING AND NAMES — NOT STREETS. The bake hands over every block,
  // so a district no longer lays out anything; what it still decides is what
  // the ground is FOR (the engine reads that as office versus housing versus
  // walk-up), how high the zoning lets it go, and which pool of street names a
  // lot without a filed address draws from. The bands are written through real
  // corners with the sides resolved by probe, exactly as before.
  //
  // `kind: "organic"` survives on the colonial quarter for one reason: it tells
  // the renderer those are lanes nobody ever painted crossings on.
  const district = (flavor, kind = "lattice", extra = {}) => ({ flavor, kind, bearingDeg: BEAR_GRID, numbered: false, fullBlockP: 0, ...extra });
  // THE FINANCIAL DISTRICT IS A CBD, NOT AN OLD TOWN (plan 10). Everything
  // below Chambers was "old", whose ceiling is 14 floors — so the second
  // business district in the country, on Metropolis, topped out at 20 floors
  // with a median of 4, the owner's "it looks tiny". In 2000, the year the
  // game opens, that ground held the Twin Towers, 40 Wall (1930, 70 floors),
  // the Woolworth (1913, 57), 60 Wall, One Chase Plaza, One Liberty Plaza and
  // dozens more past forty. It takes the core preset — the same one Midtown
  // has — and keeps `organic` so the colonial lanes still read as lanes.
  // `assembled` turns on the tower roll calibrated to MapPLUTO below
  // Chambers (citygen.mjs THE FINANCIAL DISTRICT IS ASSEMBLED FOR TOWERS).
  // Older plans keep "old" so a saved downtown rebuilds as it was.
  const plan10 = (opts.planV ?? 9) >= 10;
  const districts = {
    battery: district(plan10 ? "core" : "old", "organic", plan10 ? { assembled: true } : {}),
    soho: district("old"),
    village: district("old"),
    noho: district("old"),
    lowereast: district("resi"),
    midtown: district("core"),
    upperwest: district("resi"),
    uppereast: district("resi"),
    harlem: district("resi"),
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
    // The bulkhead line as filed: not crinkled, not rounded (see cfg.plat in
    // citygen.mjs), and only a kerb's width of esplanade, because the ground
    // between the lots and the water is already the FDR and the West Side
    // Highway, which the street cells pave.
    coast, coastAmp: 0, smooth: 0, esplanade: 4,
    lighthouse: false,
    plat: { blocks, parkCells: parkRecs.map((p) => ring(p.c)) },
    cores, partition, districts, parks, diagonals: [], corridors, streams: [], bridges: [],
    breakwaters: [], stations, labels,
    avenues: AVENUES, streets: STREETS,
    plan: { landmark: "none", harbour: xy([-74.0110, 40.7040]), seams: 0 },
  };
}

/** The extent an id names, for the picker and for a save's own label. */
export function manhattanName(extent) {
  const e = EXTENTS[extent] ?? EXTENTS[DEFAULT_EXTENT];
  return `Manhattan ${e.name}`;
}
export const MANHATTAN = "manhattan";
export { ringArea };
