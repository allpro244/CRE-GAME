// THE TOWN IS BUILT FOR ITS PEOPLE (CITY_PLAN 18, owner 2026-11-11: "generate
// the town from demand, not ladders").
//
// Up to plan 17 a lot's use came off a per-district ladder (citygen.mjs
// `classFor`): the Exchange 48% office, the modern quarter 29%. Nothing
// asked who the offices were for. Measured over Frontier and Young-town
// islands the towns came out 50-58% office by floor area — four office desks
// for every resident, a regional downtown on every map — and in play office
// was the only thing worth building, because the generator had already
// decided the town was an office market.
//
// What a town's floors hold is set by who uses them. This pass keeps every
// building the massing drew — its plate, its height, its date — and decides
// what each one is FOR, from three sourced inputs:
//
//   1. WHO LIVES ON THE ISLAND AND WHO LIVES AROUND IT. The island is the
//      core of a region. Which ring of it is drawn per seed: a radius between
//      2 miles (the Census's own "downtown", the band nearest city hall) and
//      10 (the outer edge of Kneebone's middle ring), uniform [M], read off
//      the Census 2010 population by distance from city hall for the metro
//      size the density preset describes (Census C2010SR-01, Table 3.4) [S].
//      A Frontier town (a metro under 250,000) is most of its region — the
//      island holds 21-71% of its people; a Capital (2.5-5 million) holds
//      3-31%.
//
//   2. WHERE EACH INDUSTRY'S JOBS ARE. The share of each NAICS sector's jobs
//      within 3 miles of downtown and beyond 10 miles, 98 largest metros 2006
//      (Kneebone, "Job Sprawl Revisited", Brookings 2009, Table 3) [S]:
//      finance 31.7% within 3 miles, retail 13.0%, manufacturing 14.0%,
//      against 21.3% of all jobs. Residents for the same metros are Table 3.4's
//      metros of 500,000 and over [S]. The island's share of a sector's
//      region-wide jobs is that sector's cumulative share at the radius where
//      the same metros hold the island's share of residents — the core is
//      matched to the region by people, not by miles, so a small town's core
//      and a capital's are read off one set of gradients. Density is uniform
//      within each ring [M] (linear interpolation in area).
//
//   3. WHAT EACH JOB OCCUPIES. The engine's own industry table — US
//      employment, the share off a commercial floor or at home, feet a worker
//      — as feet of each class per resident (floorDemand.mjs, generated from
//      industries.ts so the town is built by the numbers its firms rent by).
//      Homes are the engine's 900 sf over 2.51 people. Each class's stock is
//      its occupied floor over the engine's opening vacancy.
//
// The built floor area is fixed, so the island's residents solve
//   F = P x (homes + sum over classes of capture x region-per-resident),
// and each class gets its share. Then lots change use, one at a time, where
// the change fits best — offices onto the dearest ground, shops onto the
// corridors and corners, sheds into the working districts and low frames,
// homes onto the quiet blocks — until each class is within half a lot of its
// floor. A use only goes where its building can be that use: a shop of one
// or two storeys (taller frontage becomes flats over a shop), a shed of
// four or fewer. Garages, the peak and lots the town reserved keep their
// use.
//
// No random stream is read: the region radius is a hash of the seed, so
// every earlier pass draws exactly what it drew under plan 17.
import { FLOOR_PER_RESIDENT, HOME_SF_PER_RESIDENT, JOBS_PER_RESIDENT, OPENING_VAC } from "./floorDemand.mjs";
import { assetClass, resolveMix } from "./build.mjs";

/** Kneebone 2009 Table 3: [share within 3 miles of the CBD, share beyond 10 miles], 98 metros, 2006 [S]. */
const JOB_RINGS = {
  all: [0.213, 0.451],
  "22": [0.327, 0.422], "23": [0.138, 0.523], "3": [0.140, 0.537], "42": [0.183, 0.479],
  "44": [0.130, 0.505], "48": [0.166, 0.442], "51": [0.287, 0.394], "52": [0.317, 0.383],
  "53": [0.225, 0.413], "54": [0.287, 0.420], "55": [0.232, 0.460], "56": [0.203, 0.438],
  "61": [0.312, 0.345], "62": [0.247, 0.405], "71": [0.247, 0.465], "72": [0.215, 0.446],
};
/** Kneebone counts jobs within 35 miles of the CBD; the rings close there. */
const JOB_EDGE_MI = 35;

/**
 * Census 2010 population by distance from city hall, by metro size (C2010SR-01
 * Table 3.4) [S]: persons under 2 miles, 2-4, 5-9, 10-14, 15-19, 20-29, 30-39.
 * The 30-39 band is cut at 35 miles by area to match Kneebone's frame.
 */
const RES_RINGS = {
  "5M":   [1455904, 5666173, 13962092, 13177887, 10038657, 15670119, 8548884],
  "2.5M": [1324513, 3763669, 8172749, 8418510, 6463182, 8256766, 3645292],
  "1M":   [1785156, 6827398, 13618365, 10322213, 6041524, 6493069, 2768571],
  "0.5M": [2696414, 6797045, 9656005, 6199680, 4066333, 4117291, 1652975],
  "0.25M": [3219650, 7162639, 7343592, 4364444, 2978364, 2631087, 652418],
  small:  [5639174, 7711569, 5637176, 3421994, 1967538, 1765105, 401195],
};
const RES_EDGES = [2, 5, 10, 15, 20, 30, JOB_EDGE_MI];
/** The metro size each density preset describes (see citygen DENSITY's notes). */
const METRO_OF = {
  landing: "small", frontier: "small", village: "0.25M", town1900: "0.5M", spiky: "0.5M",
  provincial: "0.5M", harbour: "1M", shipped: "1M", capital: "2.5M", metropolis: "5M",
};
/** The island's radius in its region's terms: from the Census's downtown band to Kneebone's middle ring [S] edges, uniform [M]. */
const CORE_MI = [2, 10];

/** Cumulative share within r for ring points [[r, cum], ...] closing at 1, uniform density within a ring. */
function ringCurve(points) {
  return (r) => {
    let r0 = 0, c0 = 0;
    for (const [r1, c1] of points) {
      if (r <= r1) return c0 + (c1 - c0) * (r * r - r0 * r0) / (r1 * r1 - r0 * r0);
      r0 = r1; c0 = c1;
    }
    return 1;
  };
}
function resCurve(counts) {
  const last = counts.length - 1;
  // the 30-39 band, cut at 35 miles by area
  const w = counts.map((n, i) => (i === last ? n * (35 * 35 - 30 * 30) / (40 * 40 - 30 * 30) : n));
  const tot = w.reduce((a, b) => a + b, 0);
  let c = 0;
  return ringCurve(w.map((n, i) => { c += n; return [RES_EDGES[i], c / tot]; }));
}
function invert(f, s) {
  let lo = 0, hi = JOB_EDGE_MI;
  for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (f(m) < s) lo = m; else hi = m; }
  return (lo + hi) / 2;
}
const BIG_METROS = resCurve(RES_RINGS["5M"].map((_, i) => ["5M", "2.5M", "1M", "0.5M"].reduce((a, k) => a + RES_RINGS[k][i], 0)));
const JOB_CURVE = Object.fromEntries(Object.entries(JOB_RINGS)
  .map(([k, [in3, out10]]) => [k, ringCurve([[3, in3], [10, 1 - out10], [JOB_EDGE_MI, 1]])]));

const seedHash = (str) => {
  let x = 2166136261;
  for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 16777619); }
  x ^= x >>> 13; x = Math.imul(x, 0x5bd1e995); x ^= x >>> 15;
  return (x >>> 0) / 4294967296;
};

/**
 * WHO LIVES IN THE ISLAND'S FLATS. In the engine every home on the island is a
 * rented flat; the region's owners own across the water (households.ts: the
 * region's ownership is the nation's), and a household's commute is part of
 * where it lives — an island job pays it to live on the island, a mainland
 * job to stay off it (`commuteSaving`). So the island's flats are let to the
 * households of the island's own work that rent: its workers' people at
 * the region's jobs per resident, times the share of US households that rent
 * — Census HVS 2023 annual homeownership 65.9% [S]. Sizing them for every
 * resident of the island's ring built more flats than the whole region had
 * renters (seed 22: 11,000 island tenants wanted from ~9,000 renters), and
 * they could never let.
 */
const RENTER_SHARE = 1 - 0.659;

/**
 * The island in its region: per resident of the region, the floor of each
 * class the island holds — its share of the region's workplaces, and flats
 * for the households of that work who rent — and the island's flat dwellers
 * per region resident (`flatShare`, what the engine opens the region at).
 */
export function regionOf(seed, density) {
  const metro = METRO_OF[density] ?? METRO_OF.village;
  const coreMi = CORE_MI[0] + (CORE_MI[1] - CORE_MI[0]) * seedHash(`region:${seed >>> 0}`);
  const share = resCurve(RES_RINGS[metro])(coreMi);
  // the same share of residents, in the metros the job gradients were measured in
  const r = invert(BIG_METROS, share);
  const perRes = { office: 0, retail: 0, industrial: 0, multifamily: 0 };
  let jobs = 0;
  for (const row of FLOOR_PER_RESIDENT) {
    const capture = (JOB_CURVE[row.sector] ?? JOB_CURVE.all)(r);
    perRes[row.cls] += row.sf * capture;
    jobs += row.jobs * capture;
  }
  const flatShare = (jobs / JOBS_PER_RESIDENT) * RENTER_SHARE;
  perRes.multifamily = flatShare * HOME_SF_PER_RESIDENT;
  for (const k of Object.keys(perRes)) perRes[k] /= 1 - OPENING_VAC[k];
  return { metro, coreMi: +coreMi.toFixed(2), share: +share.toFixed(4), flatShare, perRes };
}

const CLASSES = ["office", "retail", "industrial", "multifamily"];

function legsOf(pp) {
  const kind = assetClass(pp.bldgclass, pp.landuse, pp.bldgarea);
  if (kind === "land") return null;
  const { mix } = resolveMix(kind, pp.numfloors, pp.unitsres ?? 0, String(pp.bbl), pp.upper);
  const out = {};
  for (const k of CLASSES) out[k] = (mix?.[k] ?? 0) * pp.bldgarea;
  return out;
}

/** The codes a lot's frame can carry: offices, shops (one or two storeys; taller frontage is flats over a shop), sheds (four storeys or fewer), flats. */
function codesFor(lot) {
  const fl = lot.pp.numfloors;
  return [lot.h > 0.5 ? "O4" : "O3", fl <= 2 ? "K2" : "RM", ...(fl <= 4 ? ["E9"] : []), "D0"];
}

/** How well a lot suits a use, 0..~1.35: the site logic the ladders encoded, kept as a ranking. */
function fit(use, lot) {
  switch (use) {
    case "office": return lot.h;
    case "retail": return lot.front;
    case "industrial": return lot.flavor === "industrial" ? 1 : 0.5 * (1 - lot.h);
    default: return (1 - lot.h) + (lot.flavor === "resi" ? 0.3 : 0);
  }
}
const mainOf = (legs) => CLASSES.reduce((m, k) => (legs[k] > legs[m] ? k : m), CLASSES[0]);

/** The record a lot carries as `code`: its assessment by use, its land use, its homes. */
function recordAs(pp, code) {
  const area = pp.bldgarea;
  const psf = (c) => (c[0] === "O" ? 210 : c[0] === "D" ? 175 : 125);   // citygen's assessed-psf midpoints by letter
  return {
    ...pp,
    assesstot: pp.assessland + Math.round((pp.assesstot - pp.assessland) * psf(code) / psf(pp.bldgclass)),
    bldgclass: code,
    landuse: code[0] === "O" ? "05" : "04",
    unitsres: code[0] === "D" || code === "S1" || code === "RM"
      ? Math.max(1, Math.round((area * (code === "D0" ? 0.9 : 0.45)) / 900)) : 0,
    upper: code === "S1" || code === "RM" ? "homes" : undefined,
  };
}

/**
 * Re-use the island's buildings to fit its region's demand. `lots` are the
 * generator's built lots ({ h, pf, ... }); `districts` the config's. Returns
 * the region record and what moved, for the manifest.
 */
export function balanceUses(lots, { seed, density, districts }) {
  const region = regionOf(seed, density);
  const items = [];
  const stock = { office: 0, retail: 0, industrial: 0, multifamily: 0 };
  for (const b of lots) {
    const pp = b.pf.properties;
    // A shop with homes over it is that: the floors above a plan-18 shopfront
    // are flats, and offices are office buildings (build.mjs resolveMix).
    if ((pp.bldgclass === "S1" || pp.bldgclass === "RM") && pp.unitsres > 0) pp.upper = "homes";
    const legs = legsOf(pp);
    if (!legs) continue;
    for (const k of CLASSES) stock[k] += legs[k];
    const fixed = pp.landmark || pp.bldgclass === "G1" || pp.reserved;
    if (fixed) continue;
    const it = {
      pp, legs, h: b.h ?? 0,
      front: Math.exp(-(pp.corridorm ?? 9999) / 45) + (pp.corner ? 0.35 : 0),
      flavor: districts?.[pp.district]?.flavor ?? "core",
      moved: false,
    };
    it.options = codesFor(it).filter((c) => c !== pp.bldgclass).map((code) => {
      const rec = recordAs(pp, code);
      return { code, rec, legs: legsOf(rec) };
    });
    items.push(it);
  }
  const F = CLASSES.reduce((a, k) => a + stock[k], 0);
  const perRes = CLASSES.reduce((a, k) => a + region.perRes[k], 0);
  const target = Object.fromEntries(CLASSES.map((k) => [k, (F / perRes) * region.perRes[k]]));
  const before = { ...stock };

  // THE MISS: each workplace class's distance from its floor, either way, and
  // homes only where they fall short. Floor the region cannot fill with work
  // — a tall town short of sheds, which go only in four storeys or fewer —
  // is homes: the frames stand, and more of the region's people live on the
  // island. One lot at a time, the change that closes the most miss per foot
  // it moves, the best-sited first among equals, until no change helps.
  // flat arrays: every candidate change as its move in each class, its fit, and its size
  const T = CLASSES.map((k) => target[k]);
  const S = CLASSES.map((k) => stock[k]);
  const opts = [];
  for (let n = 0; n < items.length; n++) {
    const it = items[n];
    const fit0 = fit(mainOf(it.legs), it);
    for (const o of it.options) opts.push({ n, o, d: CLASSES.map((k) => o.legs[k] - it.legs[k]), inv: 1 / it.pp.bldgarea, fit: 0.5 * (fit(mainOf(o.legs), it) - fit0) });
  }
  const M = opts.length;
  const D = new Float64Array(M * 4), INV = new Float64Array(M), FIT = new Float64Array(M), OWN = new Int32Array(M);
  opts.forEach((x, j) => { for (let k = 0; k < 4; k++) D[j * 4 + k] = x.d[k]; INV[j] = x.inv; FIT[j] = x.fit; OWN[j] = x.n; });
  const MF = CLASSES.indexOf("multifamily");
  const miss = (k, v) => (k === MF ? Math.max(0, T[k] - v) : Math.abs(v - T[k]));
  const moved = new Uint8Array(items.length);
  let moves = 0;
  for (let guard = 0; guard < items.length; guard++) {
    const m0 = [miss(0, S[0]), miss(1, S[1]), miss(2, S[2]), miss(3, S[3])];
    let bj = -1, bs = 0;
    for (let j = 0; j < M; j++) {
      if (moved[OWN[j]]) continue;
      const b = j * 4;
      const gain = m0[0] - miss(0, S[0] + D[b]) + m0[1] - miss(1, S[1] + D[b + 1])
        + m0[2] - miss(2, S[2] + D[b + 2]) + m0[3] - miss(3, S[3] + D[b + 3]);
      if (!(gain > 0)) continue;
      const score = gain * INV[j] + FIT[j];
      if (bj < 0 || score > bs) { bj = j; bs = score; }
    }
    if (bj < 0) break;
    const it = items[OWN[bj]], o = opts[bj].o;
    for (let k = 0; k < 4; k++) S[k] += D[bj * 4 + k];
    Object.assign(it.pp, o.rec);
    it.legs = o.legs;
    moved[OWN[bj]] = 1;
    moves++;
  }
  CLASSES.forEach((k, i) => { stock[k] = S[i]; });
  const pct = (o) => Object.fromEntries(CLASSES.map((k) => [k, +(o[k] / F).toFixed(4)]));
  return {
    metro: region.metro, coreMi: region.coreMi, ringShare: region.share,
    // the island's flat dwellers over the region's people, as built
    regionShare: +(region.flatShare * (stock.multifamily / target.multifamily)).toFixed(5),
    regionPop: Math.round(F / perRes), moved: moves,
    mixBefore: pct(before), mixTarget: pct(target), mix: pct(stock),
  };
}
