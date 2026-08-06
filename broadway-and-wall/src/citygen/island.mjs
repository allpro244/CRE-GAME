// AN ISLAND FROM A NUMBER.
//
// cities.mjs hand-draws two islands and says, in its own header, that the
// island does not move — that the coast, the districts and the street names
// are what make New Alden New Alden. That was written when there were two
// islands and no size dial, and it is a good argument for KEEPING those two
// exactly as they are. It is not an argument against a third door marked
// "somewhere else", and this file is that door: everything cities.mjs writes
// by hand, generated from one seed.
//
// WHAT THIS EMITS is a config of exactly the shape cities.mjs exports — coast,
// cores, partition, districts, parks, diagonals, piers, cranes, ships,
// breakwaters, stations, labels, avenues, streets. Nothing downstream knows
// the difference: scaleCity scales it, generateCity cuts it, buildCityData
// tabulates it, the map draws it and the engine plays it, all untouched.
//
// THE FOUR THINGS THAT ARE ACTUALLY HARD, and how each is settled:
//
//   1. The coast has to be a SIMPLE polygon or the whole pipeline is garbage.
//      It is built as a radius r(θ) about the origin, sampled at monotonically
//      increasing θ, then run through an affine map. A ring with r > 0 and θ
//      monotone cannot cross itself, and an affine map is a bijection, so it
//      still cannot afterwards. Simplicity is a property of the construction
//      here, not something checked for and hoped about.
//
//   2. The coast must not be STEEPER than the esplanade offset can survive.
//      generateCity insets the coast by `esplanade` metres with offsetInward(),
//      which decides which way is inland by asking whether a vertex normal
//      points at the ring's centroid. On a wall that runs nearly radially —
//      the wall of a river notch — that test is nearly degenerate and the
//      offset folds. So the profile carries a hard bound on |d(ln r)/dθ|, and
//      an estuary is a wide funnel rather than a hairline fjord, which is what
//      an estuary is anyway. See COAST_SLOPE_MAX.
//
//   3. The BSP leaves have to TILE. They do, structurally — a BSP tree's leaves
//      partition the plane by construction — but the districts also have to
//      each get real land, and "real land" is a measurement, not an assumption.
//      Every cut here is placed at a QUANTILE of the land actually sampled on
//      the far side of it, so a 30% band is 30% of the dry ground and not 30%
//      of a bounding box that is half sea.
//
//   4. The island has to be about the same SIZE as the authored two, or the
//      size dial stops meaning the same thing on it. Measured: the New Alden
//      coast ring is 1.495 km2 and Kestrel Point's is 1.386, and they build
//      1,378-1,421 and 1,283-1,360 lots at scale 1.0. This targets that band —
//      and it targets the area of the ring the generator ACTUALLY uses, which
//      is the crinkled and Chaikin-smoothed one, not the control polygon.
//
// DETERMINISM. A save stores (island, seed, size, build-out) and rebuilds the
// town from it, so the same seed must give a byte-identical island forever.
// Every draw here comes from a mulberry32 stream seeded off the island seed,
// and nothing touches the generator's own stream. The streams are SPLIT by
// concern — the names roll from one, the coast from another, the piers from a
// third — so that adding a pier does not rename the town.
import { mulberry32, ringArea, centroid, bboxOfRing } from "./geom.mjs";
import { chaikin, crinkle, inRing, rect, offsetInward } from "./citygen.mjs";
import { cut } from "./cities.mjs";

const TAU = Math.PI * 2;
const R2D = 180 / Math.PI;

/**
 * A SEPARATE STREAM PER CONCERN.
 *
 * One stream for the whole island would mean that changing how many piers get
 * built shifts every draw after it, so a seed's town would silently become a
 * different town on any edit to this file. The salt is mixed through the same
 * avalanche demand.ts uses on its string hashes, for the same reason: seeds
 * that differ in their low bits must not produce neighbouring streams.
 */
function stream(seed, salt) {
  let h = (seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
  return mulberry32((h ^ (h >>> 16)) >>> 0);
}

/** The small change every draw in this file is made of. */
function dice(rand) {
  const f = (a, b) => a + (b - a) * rand();
  return {
    rand,
    f,
    i: (a, b) => Math.min(b, a + Math.floor((b - a + 1) * rand())),
    sign: () => (rand() < 0.5 ? -1 : 1),
    chance: (p) => rand() < p,
    pick: (arr) => arr[Math.floor(rand() * arr.length) % arr.length],
    /** n distinct members, in the order the table lists them. */
    some: (arr, n) => {
      const a = [...arr];
      // Fisher-Yates on a copy, then re-sort the survivors into table order so
      // a street list reads like a street list and not like a shuffled deck.
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      const keep = new Set(a.slice(0, Math.min(n, a.length)));
      return arr.filter((x) => keep.has(x));
    },
  };
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Shortest distance from a point to a ring's boundary. */
function distToRing(p, ring) {
  let best = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const L2 = ex * ex + ey * ey;
    let t = L2 > 1e-12 ? ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(p[0] - (a[0] + ex * t), p[1] - (a[1] + ey * t));
    if (d < best) best = d;
  }
  return best;
}

// ---------------------------------------------------------------- THE COAST

/**
 * Periodic value noise in θ: n control values around the circle, smoothstep
 * between them. Two of these at different n are the "couple of octaves" — the
 * coarse one makes lobes the size of a neighbourhood, the fine one makes the
 * coves and points between them. Value noise rather than a sum of sines
 * because a Fourier sum has a rotational symmetry you can see from the air.
 */
function valueRing(rand, n) {
  const v = Array.from({ length: n }, () => rand() * 2 - 1);
  return (th) => {
    const t = ((th / TAU) % 1 + 1) % 1;
    const x = t * n, i = Math.floor(x), f = x - i;
    const s = f * f * (3 - 2 * f);           // smoothstep: C1, so no kinks
    return v[i % n] * (1 - s) + v[(i + 1) % n] * s;
  };
}

/** A raised cosine centred on th0, half-width w. 1 at the middle, 0 at the edges, C1 throughout. */
function lobe(th, th0, w) {
  let d = th - th0;
  d = Math.atan2(Math.sin(d), Math.cos(d));  // wrap into (-pi, pi]
  if (Math.abs(d) >= w) return 0;
  return 0.5 * (1 + Math.cos((Math.PI * d) / w));
}

/**
 * HOW STEEP A COAST IS ALLOWED TO BE, as |d(ln r)/dθ|.
 *
 * This is not a look setting, it is the condition under which offsetInward()
 * — the esplanade offset generateCity runs on every coast — picks the right
 * side. That function orients each vertex normal by testing it against the
 * direction to the ring's centroid. On a boundary running at slope m = |dr/dθ|
 * / r, the inward normal's radial component is 1/sqrt(1 + m^2), which is the
 * margin the test has to work with. At m = 3.2 the margin is 0.30 — comfortable
 * against the crinkle that gets added afterwards. Above about m = 6 the test
 * starts flipping vertex to vertex and the inset ring self-intersects.
 *
 * The profile is smoothed until it clears the bound. Measured across the twelve
 * verification islands: the repair fired 0 times, because the feature bounds
 * below already satisfy it. It stays as the guard that keeps a later change to
 * those bounds from shipping a folded coastline instead of a crash.
 */
const COAST_SLOPE_MAX = 3.2;

/**
 * THE LANDMASS, at unit radius.
 *
 * Radial perturbation with two octaves of value noise, plus four deliberate
 * features because noise alone makes a potato and not a place:
 *
 *   the HARBOUR — a broad shallow bight. Deep water reaching into the land is
 *     the only reason any of these towns exists, and the whole map is oriented
 *     off it: the old town sits on it, the dominant core sits behind it, the
 *     piers hang off it and the breakwater closes it.
 *   a COVE — a second, smaller bay somewhere else on the ring, so the harbour
 *     is not the only concavity and the island does not read as a disc with a
 *     bite out of it.
 *   the HEADLAND — an outward point. It carries the lighthouse, and it is what
 *     stops the silhouette being convex-everywhere.
 *   the RIVER MOUTH — a notch that is deep and wide-mouthed and narrows as it
 *     goes in, which is an ESTUARY: the arc a fixed angular wedge cuts is
 *     proportional to the radius, so the channel funnels inland on its own.
 *
 * The four sit at angles drawn with a guaranteed 1.4 rad of clear water
 * between any two, so they never stack into one enormous dent.
 */
function profile(D) {
  const oct1 = valueRing(D.rand, D.i(5, 8));
  const oct2 = valueRing(D.rand, D.i(13, 19));
  const a1 = D.f(0.115, 0.165), a2 = D.f(0.040, 0.065);

  // Four well-separated bearings. Three gaps drawn from [1.10, 1.60] leave the
  // fourth at least TAU - 4.80 = 1.48 rad, so no pair is ever closer than 1.10.
  const base = D.f(0, TAU);
  const g1 = D.f(1.10, 1.60), g2 = D.f(1.10, 1.60), g3 = D.f(1.10, 1.60);
  const slots = [base, base + g1, base + g1 + g2, base + g1 + g2 + g3];
  // Which feature lands on which bearing is the seed's business.
  const order = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) {
    const j = Math.floor(D.rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const th = { harbour: slots[order[0]], cove: slots[order[1]], headland: slots[order[2]], river: slots[order[3]] };

  const dHarb = D.f(0.19, 0.27), wHarb = D.f(0.55, 0.78);
  const dCove = D.f(0.09, 0.17), wCove = D.f(0.30, 0.46);
  const dHead = D.f(0.17, 0.27), wHead = D.f(0.28, 0.42);
  // The estuary. Its half-width is floored against its depth so the walls stay
  // inside COAST_SLOPE_MAX: at the steepest point of a raised cosine the slope
  // is d*pi / (2*w*(1 - d - slack)), and solving that for w at the bound is
  // the line below. Deeper river, wider mouth — which is how rivers work.
  const dRiv = D.f(0.26, 0.36);
  const wRiv = Math.max(D.f(0.42, 0.58), (dRiv * Math.PI) / (2 * COAST_SLOPE_MAX * (1 - dRiv - 0.18)));

  const r = (t) => 1
    + a1 * oct1(t) + a2 * oct2(t)
    - dHarb * lobe(t, th.harbour, wHarb)
    - dCove * lobe(t, th.cove, wCove)
    - dRiv * lobe(t, th.river, wRiv)
    + dHead * lobe(t, th.headland, wHead);

  return { r, th, wHarb, wRiv };
}

/** Circular moving average on ln r, until the profile clears the slope bound. */
function flattenSteep(rs) {
  const n = rs.length, dth = TAU / n;
  let fired = 0;
  for (let pass = 0; pass < 24; pass++) {
    let worst = 0;
    for (let i = 0; i < n; i++) {
      const a = rs[(i - 1 + n) % n], b = rs[(i + 1) % n];
      worst = Math.max(worst, Math.abs(Math.log(b / a)) / (2 * dth));
    }
    if (worst <= COAST_SLOPE_MAX) break;
    fired++;
    const out = rs.slice();
    for (let i = 0; i < n; i++) {
      out[i] = Math.exp(
        0.25 * Math.log(rs[(i - 1 + n) % n]) + 0.5 * Math.log(rs[i]) + 0.25 * Math.log(rs[(i + 1) % n]),
      );
    }
    for (let i = 0; i < n; i++) rs[i] = out[i];
  }
  return fired;
}

/** Resample a closed ring at even arc length — `n` points, evenly spaced along the shore. */
function evenSpaced(fine, n) {
  const cum = [0];
  for (let i = 1; i <= fine.length; i++) cum.push(cum[i - 1] + dist(fine[i - 1], fine[i % fine.length]));
  const total = cum[fine.length];
  const out = [];
  let k = 0;
  for (let j = 0; j < n; j++) {
    const want = (total * j) / n;
    while (k < fine.length - 1 && cum[k + 1] < want) k++;
    const seg = cum[k + 1] - cum[k] || 1;
    const t = (want - cum[k]) / seg;
    const a = fine[k], b = fine[(k + 1) % fine.length];
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

/** Does a closed ring cross itself anywhere? */
function selfCrosses(ring) {
  const n = ring.length;
  const side = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      const p1 = ring[i], p2 = ring[(i + 1) % n], p3 = ring[j], p4 = ring[(j + 1) % n];
      const d1 = side(p3, p4, p1), d2 = side(p3, p4, p2), d3 = side(p1, p2, p3), d4 = side(p1, p2, p4);
      if (d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0) return true;
    }
  }
  return false;
}

/**
 * HOW COARSE THE CONTROL POLYGON HAS TO BE, and why it is not a look setting.
 *
 * generateCity offsets the coast inward by `esplanade` metres with
 * offsetInward(), which moves each vertex along a normal averaged from its two
 * neighbours. YOU CANNOT PUSH A POLYLINE IN BY MORE THAN ITS OWN VERTEX
 * SPACING without the vertices changing places — two neighbours 12 m apart,
 * each shoved 26 m inland, come out in the wrong order and the ring has a
 * bowtie in it. That bowtie is very nearly zero area, so it is invisible on the
 * map; it is not invisible to clipToShore(), which reads the inset ring segment
 * by segment and takes the seaward normal from the winding — a reversed segment
 * clips its cell from the WRONG SIDE and eats good land.
 *
 * MEASURED, on 24 islands at three size settings each (72 rings) as the target
 * spacing of the control polygon was swept:
 *
 *     150 m -> 31 control points, 33 bowties, median built edge 15.4 m
 *     210 m -> 22 control points, 13 bowties, median built edge 20.8 m
 *     240 m -> 19 control points,  6 bowties, median built edge 23.6 m
 *     320 m -> 16 control points,  6 bowties, median built edge 28.2 m
 *
 * Coarsening helps and never finishes the job — at 320 m the coast has lost its
 * bays and there are still bowties. The two authored islands sit at 226 m and
 * 298 m mean spacing and Kestrel Point produces one of these at seed 424242, so
 * this is not a fault this file introduced; it is one it has to actually close
 * rather than sit above the rate of.
 *
 * So it is closed by TESTING instead of by hoping: a candidate coast is built,
 * offset by the esplanade AT EVERY SIZE THE GAME CAN BUILD IT AT, and accepted
 * only if all five rings come back simple. If one does not, the next rung of
 * the ladder is tried. Checking every size is load-bearing rather than
 * cautious — crinkle's `len < 70` skip and its `min(amp, len*0.22)` clamp are
 * both absolute metres against an edge length that scales, so a coast that is
 * clean as a City is not thereby clean as a Hamlet.
 */
const SPACING_LADDER = [1.00, 1.14, 1.30, 0.88, 1.48, 0.78, 1.70];
/** The size multipliers in SIZES. Restated rather than imported: this is a list of what must hold. */
const SIZE_KS = [0.55, 0.78, 1.0, 1.45, 2.0];

/**
 * THE COAST, sized so that the ring the generator actually builds is the right
 * landmass.
 *
 * generateCity does not use the control polygon: it crinkles it (fractal
 * midpoint displacement, twice) and then Chaikin-smooths it, and Chaikin loses
 * a couple of per cent of the area every time — 1.7% at the spacing this
 * settles on, measured. So the target is applied to the SMOOTHED ring, by a
 * three-step fixed point: build, measure, rescale.
 *
 * The crinkle is reproducible here because it is the very first thing in
 * generateCity to draw from mulberry32(cfg.seed). That coupling is what lets
 * every pier, label and station below be placed against the real shoreline
 * rather than against an approximation of it, and it is what lets the bowtie
 * test above test the actual ring instead of a proxy for it. If a rand() call
 * is ever inserted ahead of the crinkle in generateCity, this file's placements
 * go slightly stale — nothing breaks, but the margins are what carry it, so
 * they are kept wide.
 */
function coastline(seed, D, areaTarget, coastAmp, esplanade, spacing0) {
  const { r, th, wHarb, wRiv } = profile(D);

  const N = 720;
  const rs = new Array(N);
  for (let i = 0; i < N; i++) rs[i] = Math.max(0.42, Math.min(1.45, r((i * TAU) / N)));
  const smoothed = flattenSteep(rs);

  // An island is not round. The affine below stretches one axis and squeezes
  // the other by the reciprocal, so it changes the SHAPE and not the area, and
  // it is a bijection, so a ring that did not cross itself still does not.
  // The authored two run 1.72:1 (New Alden, east-west) and 1:1.75 (Kestrel
  // Point, a north-south peninsula); this covers that ground.
  const el = D.f(0.80, 1.26), psi = D.f(0, TAU);
  const co = Math.cos(psi), si = Math.sin(psi);
  const xform = ([x, y]) => {
    const sx = x * el, sy = y / el;
    return [sx * co - sy * si, sx * si + sy * co];
  };
  const at0 = (t) => {
    // the profile, read off the smoothed table so a feature point and the ring
    // it sits on can never disagree
    const x = (((t / TAU) % 1) + 1) % 1 * N;
    const i = Math.floor(x), f = x - i;
    const rr = rs[i % N] * (1 - f) + rs[(i + 1) % N] * f;
    return xform([rr * Math.cos(t), rr * Math.sin(t)]);
  };

  const fine = [];
  for (let i = 0; i < N; i++) fine.push(at0((i * TAU) / N));
  const fineArea = Math.abs(ringArea(fine));
  const finePerim = fine.reduce((s, p, i) => s + dist(p, fine[(i + 1) % fine.length]), 0);

  let ring = null, built = null, scale = 1, rung = 0;
  for (; rung < SPACING_LADDER.length; rung++) {
    const spacing = spacing0 * SPACING_LADDER[rung];
    // Size it. Three passes; the only nonlinearity is crinkle's fixed amplitude
    // against an edge length that is scaling under it.
    let g = Math.sqrt(areaTarget / fineArea);
    for (let pass = 0; pass < 3; pass++) {
      ring = evenSpaced(fine.map(([x, y]) => [x * g, y * g]), Math.max(16, Math.round((finePerim * g) / spacing)));
      built = chaikin(crinkle(ring, mulberry32(seed >>> 0), coastAmp), 1);
      const a = Math.abs(ringArea(built));
      if (Math.abs(a / areaTarget - 1) < 0.004) break;
      g *= Math.sqrt(areaTarget / a);
    }
    scale = g;
    // The acceptance test: the esplanade offset must be a simple ring at every
    // size the player can ask for.
    const ok = SIZE_KS.every((k) => {
      const c = chaikin(crinkle(ring.map(([x, y]) => [x * k, y * k]), mulberry32(seed >>> 0), coastAmp * k), 1);
      const inr = offsetInward(c, esplanade * k);
      return !selfCrosses(inr);
    });
    if (ok) break;
  }

  return {
    ring,                                          // the config coast
    built,                                         // what generateCity will actually cut against
    smoothed,                                      // how many times the slope guard fired
    rung,                                          // which rung of the spacing ladder it took
    th, wHarb, wRiv,
    at: (t) => { const p = at0(t); return [p[0] * scale, p[1] * scale]; },
  };
}

// ------------------------------------------------------------------- NAMES
//
// Anglo-colonial-American port names, built the way the real ones were: an
// English place-element for the stem and another for the ending, which is how
// you get Salem, Marblehead, Newburyport and Bristol on the same chart. The
// register to hit is "Kestrel Point", "New Alden", "Harborside", "Ardmore
// Green", "Denholm St" — plain, Protestant, and a little damp.

const STEM = [
  "Ald", "Ash", "Bram", "Cald", "Corb", "Denh", "Ell", "Fen", "Gran", "Hart",
  "Lang", "Mar", "Nor", "Orm", "Pemb", "Quin", "Rad", "Sal", "Thorn", "Vane",
  "Wend", "Yar", "Brack", "Chad", "Dun", "Esk", "Fal", "Hal", "Ing", "Kirk",
  "Lyn", "Mer", "Ott", "Pres", "Rook", "Stan", "Tarr", "Whit", "Barr", "Ced",
  "Glend", "Harr", "Melv", "Rand", "Sedg", "Trem", "Wick", "Ayl", "Bram", "Cort",
];
const TAILS = [
  "ley", "ford", "ton", "wick", "bury", "mere", "stead", "field", "worth",
  "bourne", "don", "ham", "by", "dale", "gate", "holm", "ridge", "cott",
  "well", "stone", "marsh", "combe", "cliff", "moor", "thorpe", "wold",
];
/** Endings that already say "port", so the name takes no suffix of its own. */
const SEA_TAILS = ["haven", "port", "mouth", "wich"];

const ISLAND_SUFFIX = ["Point", "Head", "Neck", "Bight", "Reach", "Island", "Haven", "Landing", "Roads", "Sound", "Ferry"];

/** Surname streets, one per letter — a filled-in nineteenth-century grid runs alphabetically. */
const ALPHA_STREETS = [
  "Ashby", "Bancroft", "Calvert", "Denholm", "Everett", "Fenwick", "Granby",
  "Hartwell", "Ingram", "Jarvis", "Kendrick", "Larkin", "Merrow", "Norbury",
  "Ordway", "Prescott", "Quimby", "Rutland", "Sedgwick", "Tilden", "Upsall",
  "Vance", "Wadsworth", "Yardley",
];
const OLD_STREETS = [
  "Water St", "Front St", "Dock Sq", "Custom House St", "Pearl St", "Broad St",
  "Batterymarch", "India Row", "Sloop Alley", "Cooper Ln", "Salt Ln", "Ropewalk",
  "Long Wharf Rd", "Ferry Slip", "Bell Alley", "Meeting St", "Anchor Ln",
  "Quaker Ln", "Beaver St", "Stone St", "Hanover Row", "Gouverneur Ln",
  "Coenties Slip", "Bethel St",
];
const IND_STREETS = [
  "Drydock Ave", "Gantry St", "Cooperage Rd", "Packet St", "Chandlery Row",
  "Foundry St", "Tannery Rd", "Coal Wharf", "Gasworks Ln", "Slipway Rd",
  "Kiln St", "Boilerhouse Ln", "Caulkers Ln", "Fulton Wharf", "Sailmakers Row",
];
const CORE_STREETS = [
  "Bank St", "Exchange Pl", "State St", "Commerce St", "Union St", "Milk St",
  "Federal St", "Court St", "Liberty St", "Trinity Pl", "Vesey St", "Cortland St",
  "Assembly St", "Post Office Sq",
];
const AVENUE_POOL = [
  "Commonwealth Ave", "Tremont Ave", "Lexington Ave", "Bowery Ave", "Park Ave",
  "Franklin Ave", "Chestnut Ave", "Beacon Ave", "Cathedral Ave", "Liberty Ave",
  "Federal Ave", "Washington Ave", "State Ave", "Bay Ave", "Highland Ave",
  "Concord Ave", "Harbour Ave",
];
const DEFAULT_STREETS = ["Market St", "Church St", "Mill St", "Bridge St", "School St", "Spring St"];

const OLD_DISTRICT = ["The Landing", "Harborside", "The Wharves", "Old Town", "The Quays", "Dockhead", "The Slips", "The Battery", "Shipside"];
const CORE_DISTRICT = ["The Exchange", "The Change", "Bankside", "Custom House", "Merchants Row", "The Counting House", "The Cross"];
const IND_DISTRICT = ["The Yards", "Millside", "The Ropewalk", "Foundry Flats", "Tannery Flats", "The Gasworks", "The Drydocks"];
const RESI_DISTRICT = ["The Brownstones", "The Terraces", "The Crescents", "Uptown", "The Rows"];

const COMPASS = ["East", "Northeast", "North", "Northwest", "West", "Southwest", "South", "Southeast"];
const octant = (dx, dy) => COMPASS[(((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8)];

/** The two islands that already exist. A generated one is never allowed to be either. */
const TAKEN = new Set(["new alden", "kestrel point"]);

/**
 * The name of the island at this seed, and the word-stock the rest of the map
 * is written from. Its own stream, so the town keeps its name through any
 * change to the geography.
 */
export function islandNaming(seed) {
  const D = dice(stream(seed >>> 0, 0x4e414d45));
  const word = () => D.pick(STEM) + D.pick(TAILS);
  const seaWord = () => D.pick(STEM) + D.pick(SEA_TAILS);

  let name = "";
  for (let tries = 0; tries < 8 && (!name || TAKEN.has(name.toLowerCase())); tries++) {
    const roll = D.rand();
    if (roll < 0.18) name = "New " + word();
    else if (roll < 0.30) name = "Port " + word();
    else if (roll < 0.46) name = seaWord();
    else name = word() + " " + D.pick(ISLAND_SUFFIX);
  }
  // Belt and braces: if the tables are ever edited into a collision, shift it.
  if (TAKEN.has(name.toLowerCase())) name = name + " Ferry";

  const stem = name.replace(/^(New|Port)\s+/, "").split(" ")[0];
  const abbr = (stem.slice(0, 1) + (name.split(" ")[1] ?? stem).slice(0, 1)).toUpperCase();
  return {
    name,
    stem,
    abbr,
    slug: name.toLowerCase().replace(/[^a-z]+/g, ""),
    /** Fresh place-words for parks, rivers and avenues — not the island's own. */
    words: Array.from({ length: 8 }, word),
    D,
  };
}

/** Just the name, for a picker that has not built the island yet. */
export function islandName(seed) {
  return islandNaming(seed).name;
}

// ---------------------------------------------------------------- THE TOWN

/**
 * Which branch of `cut(px, py, deg)` a point falls on.
 *
 * The half-plane convention (neg is the left hand of travel) is easy to get
 * backwards and impossible to see in a screenshot until a district is on the
 * wrong side of the island. Every assignment below is written as "the side the
 * docks are on" and resolved through this, so there is no sign to get wrong.
 */
const sideOf = (c, p) => (p[0] * c[0] + p[1] * c[1] <= c[2] ? "neg" : "pos");
const branch = (spec, atPt, here, there) =>
  sideOf(spec, atPt) === "neg" ? { cut: spec, neg: here, pos: there } : { cut: spec, pos: here, neg: there };
const inLeaf = (hp, p) => hp.every(([nx, ny, d]) => p[0] * nx + p[1] * ny <= d);

/** The half-planes reaching each leaf of a partition — the same walk generateCity does. */
function leavesOf(node, hp = []) {
  if (typeof node === "string") return [{ district: node, hp }];
  const [nx, ny, d] = node.cut;
  return [...leavesOf(node.neg, [...hp, [nx, ny, d]]), ...leavesOf(node.pos, [...hp, [-nx, -ny, -d]])];
}

/**
 * A whole island, from a seed.
 *
 * Emitted at scale 1.0 — SIZES/scaleCity multiplies it afterwards, exactly as
 * it does the two authored islands, so "Great City" means the same four-times-
 * the-land here as it does on New Alden.
 */
export function islandConfig(seed) {
  const s = seed >>> 0;
  const nm = islandNaming(s);

  // --- 1. the shoreline ------------------------------------------------------
  const Dc = dice(stream(s, 0xc0a57));
  // THE BAND THE TWO AUTHORED ISLANDS OCCUPY, and nothing wider. Measured: the
  // Kestrel Point coast ring is 1.386 km2 and New Alden's is 1.495, and those
  // two numbers are the endpoints here rather than a round band around them.
  // Landmass is what makes the size dial mean the same thing on every island —
  // "Great City" has to be four times the land wherever it is built.
  const areaTarget = Dc.f(1.386e6, 1.495e6);
  // Point spacing on the control polygon, before the ladder in coastline() gets
  // a say. The authored rings run 226 m and 298 m mean; this starts a little
  // finer than that because unlike them, this coast carries its bays in the
  // control polygon rather than leaving them all to the crinkle. It also stays
  // above crinkle's 70 m skip at the smallest size setting (0.55 x 215 = 118 m),
  // or a Hamlet would come out smooth and unfractured.
  const spacing = Dc.f(215, 255);
  const coastAmp = Dc.f(15, 26);
  const esplanade = Dc.f(22, 26);
  const C = coastline(s, Dc, areaTarget, coastAmp, esplanade, spacing);
  const COAST = C.built;
  const inner = offsetInward(COAST, esplanade);

  const harbourHead = C.at(C.th.harbour);          // innermost point of the bight
  const harbourMouth = (() => {                    // midpoint of the chord across it
    const a = C.at(C.th.harbour - C.wHarb), b = C.at(C.th.harbour + C.wHarb);
    return { mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], a, b };
  })();
  const headlandTip = C.at(C.th.headland);
  const riverHead = C.at(C.th.river);

  // --- 2. the land, sampled --------------------------------------------------
  // Every placement below asks the ground a question rather than assuming an
  // answer: how much land is on the far side of this cut, which leaf is this
  // point in, how far is it from the water. A 25 m lattice over a 1.4 km2
  // island is about 2,200 samples, which is cheap enough to do all of that
  // exactly and fine enough that a district cannot hide between two of them.
  const STEP = 25;
  const [bx0, by0, bx1, by1] = bboxOfRing(inner);
  const land = [];
  for (let x = bx0; x <= bx1; x += STEP) {
    for (let y = by0; y <= by1; y += STEP) {
      const p = [x, y];
      if (inRing(p, inner)) land.push({ p, edge: distToRing(p, inner) });
    }
  }
  const mid = land.reduce((a, l) => [a[0] + l.p[0] / land.length, a[1] + l.p[1] / land.length], [0, 0]);

  // The island's long axis, from the second moment of its own dry ground.
  let sxx = 0, sxy = 0, syy = 0;
  for (const l of land) {
    const dx = l.p[0] - mid[0], dy = l.p[1] - mid[1];
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  let phi = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let u = [Math.cos(phi), Math.sin(phi)];
  // Point it AWAY from the harbour: the spine runs from the water into the town.
  if ((harbourHead[0] - mid[0]) * u[0] + (harbourHead[1] - mid[1]) * u[1] > 0) {
    phi += Math.PI; u = [Math.cos(phi), Math.sin(phi)];
  }
  const v = [-u[1], u[0]];
  const along = (p) => (p[0] - mid[0]) * u[0] + (p[1] - mid[1]) * u[1];
  const across = (p) => (p[0] - mid[0]) * v[0] + (p[1] - mid[1]) * v[1];
  const phiDeg = phi * R2D;

  /** The spine coordinate below which a given share of the island's land lies. */
  const sSorted = land.map((l) => along(l.p)).sort((a, b) => a - b);
  const quantile = (q) => sSorted[Math.max(0, Math.min(sSorted.length - 1, Math.round(q * (sSorted.length - 1))))];
  const ptAt = (sc, cr = 0) => [mid[0] + u[0] * sc + v[0] * cr, mid[1] + u[1] * sc + v[1] * cr];

  // --- 3. the district plan --------------------------------------------------
  // Bands across the spine, harbour end first: the old town on the water, the
  // Exchange behind it, the housing beyond that. This is the order every port
  // on this coast grew in, and it is why the dear ground is never at the far
  // end. The docks are cut off the flank of the middle band, on whichever side
  // has the frontage for them.
  const Dd = dice(stream(s, 0xd15701));
  const nDistricts = Dd.rand() < 0.16 ? 3 : Dd.rand() < 0.74 ? 4 : 5;

  /**
   * HOW MUCH OF THE ISLAND EACH DISTRICT GETS, and why it is not a free choice.
   *
   * A district's flavour decides how finely it plats, how much may be built on
   * it, how tall, and what class of building goes up — FLAVOR.core allows
   * ninety-nine floors and puts the offices there; FLAVOR.resi caps at seven
   * and is almost all housing. So the share of the island each band gets is a
   * statement about what kind of town this is, and getting it wrong does not
   * make a different-looking city, it makes a different economy.
   *
   * MEASURED on the two authored islands, as a share of all parcels:
   *
   *              old      core     resi     industrial
   *   New Alden  15-16%   45-47%   30-31%   8-9%
   *   Kestrel    27-28%   37-40%   26-28%   6%
   *
   * THE CORE IS THE BIGGEST DISTRICT IN BOTH, and that is the fact worth
   * keeping: a port city's commercial middle is most of its built fabric, not a
   * downtown crumb surrounded by houses. The first cut of these bands gave the
   * core 30-40% of the spine and then took a third of THAT away for the docks,
   * which left the generated islands with 13-19% of their parcels in the core
   * and 41-58% in housing — a suburb with a harbour attached, and 23% more
   * blocks per square kilometre than New Alden because resi blocks are half the
   * size of core ones. With the bands below, measured over six seeds: core
   * 32-51%, old 17-27%, resi 22-40%, industrial 4-6%, and 932-1026 lots per
   * square kilometre against New Alden's 922-951 and Kestrel Point's 926-981.
   *
   * The core band has to be WIDER than the share it is aiming for, because the
   * docks come out of it and because resi plats finer than core does: a resi
   * band lays down about 1.6 parcels for every one the same ground would carry
   * as Exchange, so land share and parcel share are not the same quantity.
   *
   * The old quarter is still the SHORTEST band. A colonial waterfront is a toe,
   * not a third of a city, and keeping it tight is what puts the core within a
   * few hundred metres of the water where it belongs.
   */
  const fOld = Dd.f(0.16, 0.23);
  const fCore = fOld + Dd.f(0.48, 0.58);
  const cutOld = cut(...ptAt(quantile(fOld)), phiDeg + 90);
  const cutCore = cut(...ptAt(quantile(fCore)), phiDeg + 90);

  const oldSide = ptAt(quantile(fOld * 0.4));
  const coreSide = ptAt(quantile((fOld + fCore) / 2));
  const farSide = ptAt(quantile((1 + fCore) / 2));

  // Which flank the yards go on: count the shoreline that the middle band
  // actually touches on each side. Docks go where the water is.
  const bandLo = quantile(fOld), bandHi = quantile(fCore);
  let coastPos = 0, coastNeg = 0;
  for (const p of COAST) {
    const sc = along(p);
    if (sc < bandLo || sc > bandHi) continue;
    if (across(p) > 0) coastPos++; else coastNeg++;
  }
  const dockSign = coastPos >= coastNeg ? 1 : -1;
  // A fifth of the middle band's land, taken from the dock side — which lands
  // the yards at 6-11% of the island, the share the authored two carry.
  const bandCross = land.filter((l) => along(l.p) >= bandLo && along(l.p) <= bandHi)
    .map((l) => across(l.p) * dockSign).sort((a, b) => b - a);
  const fDock = Dd.f(0.16, 0.24);
  const dockLine = bandCross[Math.max(0, Math.min(bandCross.length - 1, Math.round(fDock * (bandCross.length - 1))))] ?? 0;
  const cutDock = cut(...ptAt((bandLo + bandHi) / 2, dockLine * dockSign), phiDeg);
  const dockSide = ptAt((bandLo + bandHi) / 2, (dockLine + 240) * dockSign);
  const exchSide = ptAt((bandLo + bandHi) / 2, (dockLine - 320) * dockSign);

  // Names, once the geography knows where everything is.
  const Dn = nm.D;
  const dirOf = (p) => octant(p[0] - mid[0], p[1] - mid[1]);
  const cardinal = (w) => (["North", "South", "East", "West"].includes(w) ? w : null);
  const resiName = (p, used) => {
    const c = cardinal(dirOf(p));
    const opts = [...RESI_DISTRICT, ...(c ? [c + "side", c + " Hill"] : []), nm.words[3] + " Hill", nm.words[4] + " Heights"];
    const free = opts.filter((o) => !used.has(o));
    return Dn.pick(free.length ? free : opts);
  };
  const usedResi = new Set();

  const disp = { old: Dn.pick(OLD_DISTRICT), core: Dn.pick(CORE_DISTRICT) };
  disp.ind = (() => {
    const c = cardinal(dirOf(dockSide));
    return Dn.pick([...IND_DISTRICT, ...(c ? [c + " Docks", c + " Yards"] : [])]);
  })();
  disp.resi = resiName(farSide, usedResi); usedResi.add(disp.resi);

  const key = (t) => t.toLowerCase().replace(/[^a-z]+/g, "");
  const kOld = key(disp.old), kCore = key(disp.core), kInd = key(disp.ind), kResi = key(disp.resi);

  let partition, districtKeys;
  if (nDistricts === 3) {
    partition = branch(cutOld, oldSide, kOld, branch(cutCore, coreSide, kCore, kResi));
    districtKeys = { old: kOld, core: kCore, resi: [kResi] };
  } else if (nDistricts === 4) {
    partition = branch(cutOld, oldSide, kOld,
      branch(cutCore, coreSide, branch(cutDock, dockSide, kInd, kCore), kResi));
    districtKeys = { old: kOld, core: kCore, ind: kInd, resi: [kResi] };
  } else {
    disp.resi2 = resiName(ptAt(quantile((1 + Dd.f(0.80, 0.90)) / 2)), usedResi);
    const kResi2 = key(disp.resi2);
    const fResi = fCore + (1 - fCore) * Dd.f(0.48, 0.60);
    const cutResi = cut(...ptAt(quantile(fResi)), phiDeg + 90);
    const nearFar = ptAt(quantile((fCore + fResi) / 2));
    partition = branch(cutOld, oldSide, kOld,
      branch(cutCore, coreSide, branch(cutDock, dockSide, kInd, kCore),
        branch(cutResi, nearFar, kResi, kResi2)));
    districtKeys = { old: kOld, core: kCore, ind: kInd, resi: [kResi, kResi2] };
  }
  const leaves = leavesOf(partition);
  const leafOf = (p) => leaves.find((l) => inLeaf(l.hp, p))?.district ?? null;
  for (const l of land) l.d = leafOf(l.p);

  // --- 4. the street grammars ------------------------------------------------
  // The avenues run down the island's long axis, which is what a surveyor does
  // with a peninsula: the long streets go the long way. bearingDeg is the
  // COMPASS bearing of the avenues, so it is 90 minus the spine's map angle,
  // folded into (-90, 90].
  const Dg = dice(stream(s, 0x51d55));
  const fold = (a) => ((((a + 90) % 180) + 180) % 180) - 90;
  const spineBearing = fold(90 - phiDeg);
  const coreBearing = fold(spineBearing + Dg.f(-6, 6));

  const districts = {};
  districts[kCore] = {
    kind: "lattice", flavor: "core", bearingDeg: +coreBearing.toFixed(1),
    stPitch: Math.round(Dg.f(66, 76)), avePitch: Math.round(Dg.f(190, 215)),
    streetW: Math.round(Dg.f(14, 16)), aveW: Math.round(Dg.f(25, 28)),
    warpAmp: Math.round(Dg.f(1, 3)), numbered: true, fullBlockP: 0.05,
  };
  districts[kOld] = {
    kind: "organic", flavor: "old",
    cell: [Math.round(Dg.f(3050, 3600)), Math.round(Dg.f(7200, 8400))],
    jitterDeg: Math.round(Dg.f(13, 19)), streetW: Math.round(Dg.f(9, 11)), fullBlockP: 0.02,
  };
  if (districtKeys.ind) {
    districts[kInd] = {
      kind: "lattice", flavor: "industrial",
      // The yards never agreed to the surveyor's angle — they were laid to the
      // water, which is a different line.
      bearingDeg: +fold(coreBearing + Dg.f(-42, 42)).toFixed(1),
      stPitch: Math.round(Dg.f(90, 100)), avePitch: Math.round(Dg.f(230, 260)),
      streetW: Math.round(Dg.f(16, 18)), aveW: Math.round(Dg.f(26, 29)),
      warpAmp: Math.round(Dg.f(8, 10)), fullBlockP: 0.11,
    };
  }
  districtKeys.resi.forEach((k, i) => {
    districts[k] = {
      kind: "lattice", flavor: "resi",
      bearingDeg: +fold(coreBearing + Dg.f(-22, 22)).toFixed(1),
      stPitch: Math.round(Dg.f(56, 63)), avePitch: Math.round(Dg.f(144, 160)),
      streetW: Math.round(Dg.f(12, 14)), aveW: Math.round(Dg.f(19, 22)),
      warpAmp: Math.round(Dg.f(3, 5)), numbered: i === 0 && Dg.chance(0.5), fullBlockP: 0.02,
    };
  });

  // --- 5. the cores ----------------------------------------------------------
  // A site is only a candidate if it is on dry ground with room around it, in
  // the leaf it is supposed to be in. `wants` walks the land samples and takes
  // the one nearest where the core belongs, so a core can never end up at sea,
  // in a park, or in the wrong district.
  const wants = (target, want, clear) => {
    let best = null, bd = Infinity;
    for (const l of land) {
      if (l.edge < clear) continue;
      if (want && l.d !== want) continue;
      const d = dist(l.p, target);
      if (d < bd) { bd = d; best = l.p; }
    }
    return best;
  };

  const Dk = dice(stream(s, 0xc03e5));
  // The dominant core sits in the Exchange, hard against the old town's edge —
  // which is to say a few hundred metres off the harbour. That is where the
  // counting houses went: close enough to the ships to see them come in, far
  // enough back to be on a street a carriage could use.
  const seats = [];
  const seatCore = wants(ptAt(quantile(fOld + (fCore - fOld) * 0.28), across(exchSide) * 0.35), kCore, 90)
    ?? wants(ptAt(quantile(fOld + (fCore - fOld) * 0.28)), kCore, 40)
    ?? mid;
  seats.push({ xy: seatCore, r: Math.round(Dk.f(245, 300)) });
  // Midtown, then the far end.
  seats.push({ xy: wants(ptAt(quantile(Dk.f(0.55, 0.66))), null, 80) ?? ptAt(quantile(0.6)), r: Math.round(Dk.f(265, 320)) });
  seats.push({ xy: wants(ptAt(quantile(Dk.f(0.84, 0.92))), null, 60) ?? ptAt(quantile(0.88)), r: Math.round(Dk.f(210, 270)) });
  // The docks, if there are any.
  if (districtKeys.ind) {
    seats.push({ xy: wants(dockSide, kInd, 55) ?? dockSide, r: Math.round(Dk.f(160, 205)) });
  }
  // WEIGHTS FALL OFF FROM THE SEAT, and that is arranged by construction rather
  // than asserted: rank the sites by how far they are from the dominant one and
  // hand out the weights in that order, so the second-densest employment
  // cluster in the town is always the one nearest downtown.
  const wLadder = [1.0, +Dk.f(0.46, 0.64).toFixed(2), +Dk.f(0.14, 0.24).toFixed(2), +Dk.f(0.08, 0.13).toFixed(2)];
  const cores = seats
    .map((c, i) => ({ ...c, d0: i === 0 ? -1 : dist(c.xy, seats[0].xy) }))
    .sort((a, b) => a.d0 - b.d0)
    .map((c, i) => ({ xy: [Math.round(c.xy[0]), Math.round(c.xy[1])], w: wLadder[i], r: c.r }));

  // The land-value surface generateCity will compute, reproduced here so the
  // things that go on top of it — the squares, the railway — can be put where
  // the value is. `rawHeat` is the same sum without generateCity's clamp at 1;
  // see the station-weight note below for why the clamp is wrong for ranking.
  const rawHeat = (p) => cores.reduce((h, c) => h + c.w * Math.exp(-(dist(p, c.xy) ** 2) / (2 * c.r * c.r)), 0);
  const coreHeat = (p) => Math.min(1, rawHeat(p));

  // --- 6. parks --------------------------------------------------------------
  // A rectangle only goes down if its whole footprint is on land with a street's
  // width to spare, and if it is not sitting on another park. Nine probes round
  // the rim, then shrink and try again — the same thing a surveyor does when the
  // common will not fit where the plan said it would.
  const Dp = dice(stream(s, 0x9a2c5));
  const parkDeg = +(-districts[kCore].bearingDeg).toFixed(1);
  const parks = [];
  const fits = (cx, cy, w, h, deg) => {
    const r = rect(cx, cy, w, h, deg);
    const probes = [...r, ...r.map((p, i) => {
      const q = r[(i + 1) % r.length];
      return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    }), [cx, cy]];
    return probes.every((p) => inRing(p, inner) && distToRing(p, inner) > 14)
      && parks.every((q) => dist([cx, cy], [q.cx, q.cy]) > (Math.max(w, h) + Math.max(q.w, q.h)) * 0.62);
  };
  const placePark = (target, w0, h0, name, want) => {
    for (let shrink = 0; shrink < 4; shrink++) {
      const w = w0 * (1 - 0.14 * shrink), h = h0 * (1 - 0.14 * shrink);
      let best = null, bd = Infinity;
      for (const l of land) {
        if (want && l.d !== want) continue;
        const d = dist(l.p, target);
        if (d >= bd) continue;
        if (!fits(l.p[0], l.p[1], w, h, parkDeg)) continue;
        bd = d; best = l.p;
      }
      if (best) {
        parks.push({ cx: Math.round(best[0]), cy: Math.round(best[1]), w: Math.round(w), h: Math.round(h), deg: parkDeg, name });
        return true;
      }
    }
    return false;
  };
  // THE SQUARE GOES DOWN FIRST, on the dearest ground. generateCity ranks the
  // squares by the heat under them and puts the town hall on the top one, so
  // this is also the decision about where the seat of government stands.
  const commonName = `${nm.words[0]} Common`;
  const squareName = `${nm.stem} Square`;
  const greenName = `${nm.words[1]} Green`;
  placePark(cores[0].xy, Dp.f(80, 95), Dp.f(80, 95), squareName, null);
  placePark(
    // The Common sits between downtown and the housing, which is where a city
    // puts the one piece of ground it agrees never to build on.
    [(cores[0].xy[0] + cores[1].xy[0]) / 2, (cores[0].xy[1] + cores[1].xy[1]) / 2],
    Dp.f(260, 340), Dp.f(185, 240), commonName, null,
  );
  placePark(cores[2].xy, Dp.f(140, 168), Dp.f(84, 104), greenName, null);

  // --- 7. the boulevard ------------------------------------------------------
  // One street that refuses the grid. Every town on this coast has one and it
  // is always the oldest road on the map — the track that was there before the
  // surveyor, running to wherever people were already going. It is drawn as the
  // longest chord it can make on dry land through the middle of town.
  const Db = dice(stream(s, 0xb0d1e));
  const diagonals = [];
  {
    const ang = (coreBearing + Db.f(30, 55) * Db.sign()) * Math.PI / 180;
    // bearingDeg is a compass bearing; the map angle of the same line is 90 - it.
    const dir = [Math.cos(Math.PI / 2 - ang), Math.sin(Math.PI / 2 - ang)];
    const seed0 = [(cores[0].xy[0] + cores[1].xy[0]) / 2, (cores[0].xy[1] + cores[1].xy[1]) / 2];
    const reach = (sgn) => {
      let t = 0;
      for (; t < 900; t += 10) {
        const p = [seed0[0] + dir[0] * sgn * (t + 10), seed0[1] + dir[1] * sgn * (t + 10)];
        if (!inRing(p, inner) || distToRing(p, inner) < 26) break;
      }
      return t;
    };
    const rp = reach(1), rn = reach(-1);
    if (rp + rn > 420) {
      diagonals.push({
        cx: Math.round(seed0[0] + dir[0] * (rp - rn) / 2),
        cy: Math.round(seed0[1] + dir[1] * (rp - rn) / 2),
        w: Math.round(rp + rn), h: Math.round(Db.f(24, 28)),
        deg: +((Math.atan2(dir[1], dir[0]) * R2D + 360) % 360).toFixed(1),
      });
    }
  }

  // --- 8. the working waterfront ---------------------------------------------
  // A pier is rooted on the quay and reaches into the water, which is why the
  // authored ones straddle the shoreline instead of floating off it. Anchors go
  // in the harbour first — that is what the harbour is for — and then along the
  // dock district's frontage.
  const Dw = dice(stream(s, 0x2132));
  const piers = [];
  const anchorAt = (th) => {
    const ray = C.at(th);
    let best = 0, bd = Infinity;
    for (let i = 0; i < COAST.length; i++) {
      const d = dist(COAST[i], ray);
      if (d < bd) { bd = d; best = i; }
    }
    const a = COAST[(best - 1 + COAST.length) % COAST.length], b = COAST[(best + 1) % COAST.length];
    const ex = b[0] - a[0], ey = b[1] - a[1], L = Math.hypot(ex, ey) || 1;
    let n = [ey / L, -ex / L];
    const c = centroid(COAST);
    if ((COAST[best][0] - c[0]) * n[0] + (COAST[best][1] - c[1]) * n[1] < 0) n = [-n[0], -n[1]];
    return { p: COAST[best], n, t: [-n[1], n[0]] };
  };
  const addPier = (th) => {
    const { p, n, t } = anchorAt(th);
    const back = Dw.f(30, 44), out = Dw.f(95, 135), hw = Dw.f(17, 22);
    const root = [p[0] - n[0] * back, p[1] - n[1] * back];
    const tip = [p[0] + n[0] * out, p[1] + n[1] * out];
    if (!inRing(root, inner)) return false;
    if (inRing(tip, COAST)) return false;
    if (piers.some((q) => dist(centroid(q), centroid([
      [root[0] + t[0] * hw, root[1] + t[1] * hw], [tip[0] + t[0] * hw, tip[1] + t[1] * hw],
      [tip[0] - t[0] * hw, tip[1] - t[1] * hw], [root[0] - t[0] * hw, root[1] - t[1] * hw],
    ])) < 150)) return false;
    piers.push([
      [root[0] + t[0] * hw, root[1] + t[1] * hw],
      [tip[0] + t[0] * hw, tip[1] + t[1] * hw],
      [tip[0] - t[0] * hw, tip[1] - t[1] * hw],
      [root[0] - t[0] * hw, root[1] - t[1] * hw],
    ].map(([x, y]) => [Math.round(x), Math.round(y)]));
    return true;
  };
  for (let k = 0; k < 3; k++) addPier(C.th.harbour + C.wHarb * Dw.f(-0.72, 0.72));
  // The dock district's own frontage: sweep the shoreline for the stretch that
  // belongs to it and hang two or three more off that.
  const dockThetas = [];
  for (let k = 0; k < 240; k++) {
    const th = (k / 240) * TAU;
    const p = C.at(th);
    const q = [p[0] * 0.93, p[1] * 0.93];
    if (inRing(q, inner) && leafOf(q) === kInd) dockThetas.push(th);
  }
  if (dockThetas.length) {
    for (let k = 0; k < 3; k++) addPier(dockThetas[Math.floor(((k + 0.5) / 3) * dockThetas.length)]);
  } else {
    for (let k = 0; k < 2; k++) addPier(C.th.cove + Dw.f(-0.4, 0.4));
  }

  const cranes = [];
  for (const pier of piers.slice(-2)) {
    const c = centroid(pier);
    const back = [c[0] + (mid[0] - c[0]) * 0.16, c[1] + (mid[1] - c[1]) * 0.16];
    if (inRing(back, inner) && distToRing(back, inner) > 12) {
      cranes.push([Math.round(back[0]), Math.round(back[1]), Math.round(Dw.f(0, 180))]);
    }
  }

  // Ships lie in the roads outside the harbour mouth and off the estuary.
  const ships = [];
  const offshore = (p, d, deg) => {
    const L = Math.hypot(p[0], p[1]) || 1;
    const q = [p[0] + (p[0] / L) * d, p[1] + (p[1] / L) * d];
    if (!inRing(q, COAST)) ships.push([Math.round(q[0]), Math.round(q[1]), Math.round(deg)]);
  };
  offshore(harbourMouth.mid, Dw.f(90, 190), Dw.f(0, 360));
  offshore(C.at(C.th.river), Dw.f(60, 150), Dw.f(0, 360));
  offshore(C.at(C.th.cove), Dw.f(120, 240), Dw.f(0, 360));

  // A breakwater across the harbour mouth, a third of the way over — enough to
  // make the roads a harbour and not enough to close it.
  const breakwaters = [];
  {
    const chord = dist(harbourMouth.a, harbourMouth.b);
    const bdeg = Math.atan2(harbourMouth.b[1] - harbourMouth.a[1], harbourMouth.b[0] - harbourMouth.a[0]) * R2D;
    const t = Dw.f(0.16, 0.30);
    const cx = harbourMouth.a[0] + (harbourMouth.b[0] - harbourMouth.a[0]) * t;
    const cy = harbourMouth.a[1] + (harbourMouth.b[1] - harbourMouth.a[1]) * t;
    if (!inRing([cx, cy], COAST)) {
      breakwaters.push([Math.round(cx), Math.round(cy), Math.round(chord * Dw.f(0.22, 0.34)), Math.round(Dw.f(12, 16)), +bdeg.toFixed(1)]);
    }
  }

  // --- 9. the railway --------------------------------------------------------
  /**
   * A STATION'S WEIGHT IS ITS RIDERSHIP, and ridership is the people who get on
   * plus the people who get off: the residents in its catchment plus the jobs
   * in it. The job surface is the core heat, which is the same surface the
   * whole generator prices land off. The residential base is very nearly flat
   * across a built-up island — everybody lives somewhere — so ridership is a
   * constant plus a multiple of the heat. That is the shape; the two numbers
   * are measured, not chosen.
   *
   * MEASURED, on all sixteen hand-set stations across New Alden and Kestrel
   * Point: regressing the authored weight on the core heat under each station
   * gives w = 21.6 + 53.8*heat, RMS residual 15.3 against a spread of 26.4 —
   * R2 = 0.67. So the heat surface explains two thirds of what the two authored
   * tables say, and the line below is that regression rounded.
   *
   * It is not a better fit than that and it should not pretend to be. The
   * remaining third is deliberate hand-authoring the surface cannot see: on
   * Kestrel Point "Custom House" is weighted 44 and "Battery" 100 with the same
   * heat under both, because one of them is a minor stop two hundred metres
   * from the principal one. A generated railway has no such history to encode.
   *
   * The heat used here is the RAW sum, not generateCity's version of it, which
   * clamps at 1. The clamp costs the fit a fifth of its R2 (0.60 against 0.67)
   * because it flattens every downtown station onto the same value — and this
   * is ranking stations against each other, which is exactly what the clamp
   * destroys. Nothing downstream reads the absolute number: build.mjs
   * normalises the transit kernel against its own 95th percentile.
   */
  const Ds = dice(stream(s, 0x57a71));
  const stations = [];
  const addStation = (xy, name) => {
    if (!xy) return;
    if (stations.some((q) => dist(q.xy, xy) < 210)) return;
    const heat = rawHeat(xy);
    const lines = [];
    if (Math.abs(across(xy)) < 300) lines.push("1");
    if (along(xy) > quantile(0.45)) lines.push("2");
    if (along(xy) < quantile(0.55)) lines.push("A");
    if (leafOf(xy) === kInd) lines.push("W");
    stations.push({
      name, lines: (lines.length ? lines : ["1"]).join(" "),
      xy: [Math.round(xy[0]), Math.round(xy[1])],
      weight: Math.round(22 + 54 * heat),
    });
  };
  const parkByName = (n) => parks.find((p) => p.name === n);
  const sq = parkByName(squareName), cm = parkByName(commonName), gr = parkByName(greenName);
  addStation(cores[0].xy, sq ? sq.name : disp.core);
  if (cm) addStation(wants([cm.cx, cm.cy], null, 30), cm.name);
  addStation(wants(ptAt(quantile(fOld * 0.5)), kOld, 45), "Custom House");
  addStation(cores[1].xy, "Midtown");
  if (gr) addStation(wants([gr.cx, gr.cy], null, 30), gr.name);
  addStation(cores[2].xy, districtKeys.resi.length > 1 ? disp.resi2 : "Uptown");
  addStation(wants(ptAt(quantile(0.97)), null, 40), nm.words[2] + " End");
  if (districtKeys.ind) addStation(cores.find((c) => leafOf(c.xy) === kInd)?.xy ?? dockSide, nm.words[5] + " Wharf");
  // A working railway does not stop only at the landmarks. Fill the gaps along
  // the spine so nowhere in town is more than a few blocks from a platform.
  for (const q of [0.30, 0.44, 0.72, 0.86]) {
    addStation(wants(ptAt(quantile(q), Ds.f(-160, 160)), null, 55), nm.words[6] + " " + (q < 0.5 ? "St" : "Rd"));
  }

  // --- 10. what the map calls things -----------------------------------------
  const labels = [];
  const leafCentre = (k) => {
    const mine = land.filter((l) => l.d === k);
    if (!mine.length) return null;
    return [
      mine.reduce((a, l) => a + l.p[0], 0) / mine.length,
      mine.reduce((a, l) => a + l.p[1], 0) / mine.length,
    ];
  };
  const labelDistrict = (k, text) => {
    const c = leafCentre(k);
    if (c) labels.push({ name: text.toUpperCase(), labelKind: "district", xy: [Math.round(c[0]), Math.round(c[1])] });
  };
  labelDistrict(kOld, disp.old);
  labelDistrict(kCore, disp.core);
  if (districtKeys.ind) labelDistrict(kInd, disp.ind);
  labelDistrict(districtKeys.resi[0], disp.resi);
  if (districtKeys.resi[1]) labelDistrict(districtKeys.resi[1], disp.resi2);
  for (const p of parks) labels.push({ name: p.name, labelKind: "park", xy: [p.cx, p.cy] });

  // Water labels have to be ON the water. Each is pushed out along the ray it
  // sits on until it clears the coast, and dropped if it never does.
  const Dl = dice(stream(s, 0x1abe1));
  const waterAt = (th, want, name) => {
    for (let d = want; d < want + 420; d += 30) {
      const p = C.at(th);
      const L = Math.hypot(p[0], p[1]) || 1;
      const q = [p[0] + (p[0] / L) * d, p[1] + (p[1] / L) * d];
      if (!inRing(q, COAST)) {
        labels.push({ name, labelKind: "water", xy: [Math.round(q[0]), Math.round(q[1])] });
        return;
      }
    }
  };
  waterAt(C.th.harbour, Dl.f(120, 210), `${nm.name.replace(/^(New|Port)\s+/, "")} ${Dl.pick(["Harbor", "Bay", "Roads"])}`);
  waterAt(C.th.river, Dl.f(20, 70), `${nm.words[3]} River`);
  waterAt(C.th.cove, Dl.f(80, 170), `${nm.words[4]} ${Dl.pick(["Cove", "Bight", "Inlet"])}`);
  waterAt(C.th.headland + Math.PI, Dl.f(180, 320), `${nm.words[5]} ${Dl.pick(["Sound", "Channel", "Reach"])}`);

  // --- 11. the street names --------------------------------------------------
  const Dst = dice(stream(s, 0x57ee7));
  const streets = { default: DEFAULT_STREETS };
  streets[kOld] = Dst.some(OLD_STREETS, Dst.i(9, 13));
  streets[kCore] = Dst.some(CORE_STREETS, Dst.i(7, 10));
  if (districtKeys.ind) streets[kInd] = Dst.some(IND_STREETS, Dst.i(6, 9));
  // The housing gets its letters in order, starting wherever the surveyor did.
  districtKeys.resi.forEach((k, i) => {
    const start = Dst.i(0, ALPHA_STREETS.length - 9) + i * 2;
    streets[k] = ALPHA_STREETS.slice(start % ALPHA_STREETS.length, (start % ALPHA_STREETS.length) + 8)
      .map((n) => n + " St");
  });
  const avenues = [
    Dst.pick(["The Boulevard", "Grand Ave", nm.stem + "way", "The Parade"]),
    nm.stem + " Ave",
    ...Dst.some(AVENUE_POOL, 5),
  ];

  return {
    name: nm.name,
    district: nm.slug,
    abbr: nm.abbr,
    seed: s,
    generated: true,
    center: [-70.9, 41.1],
    coast: C.ring.map(([x, y]) => [Math.round(x), Math.round(y)]),
    coastAmp: Math.round(coastAmp),
    esplanade: Math.round(esplanade),
    // The lighthouse goes on the headland the profile put there, not on
    // whichever coast vertex happens to sit furthest from the origin.
    lighthouse: [Math.round(headlandTip[0]), Math.round(headlandTip[1])],
    cores,
    partition,
    districts,
    parks,
    diagonals,
    piers,
    cranes,
    ships,
    breakwaters,
    stations,
    labels,
    avenues,
    streets,
    // Not read by the generator — this is what the verification harness and any
    // future debugging need to ask the island what it thinks it is.
    plan: {
      spineDeg: +phiDeg.toFixed(2),
      mid: [Math.round(mid[0]), Math.round(mid[1])],
      harbour: [Math.round(harbourHead[0]), Math.round(harbourHead[1])],
      headland: [Math.round(headlandTip[0]), Math.round(headlandTip[1])],
      river: [Math.round(riverHead[0]), Math.round(riverHead[1])],
      keys: districtKeys,
      display: disp,
      nDistricts,
      smoothed: C.smoothed,
      rung: C.rung,
      builtArea: Math.round(Math.abs(ringArea(COAST))),
    },
  };
}
