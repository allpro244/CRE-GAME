// THE OLD CITY AND THE VILLAGE, CUT BY THE ISLAND GENERATOR.
//
// The owner's call: the region's downtown and old town centres come from the
// existing generator (citygen.mjs generateCity) — its believable, unique grids
// and varied lots — not from a stamped grid. generateCity cuts a town inside a
// "coast" ring under a district plan; island.mjs computes those for an island.
// Here they are computed for a river or harbour town on the mainland: the ring
// is the town's outline (story.mjs townFootprint — water on one side, the
// built edge on the others) and the district plan is a set of historic PLATS,
// each surveyed on its own:
//
//   - the LANDING at the water (the founding plat: organic, or narrow deep
//     burgage lots on the shore's bearing);
//   - DOWNTOWN behind it (the commercial grid, square to the waterfront or to
//     the main street);
//   - the MILL DISTRICT along the river (yard lots on the river's bearing);
//   - ADDITIONS on the uplands, one per BSP leaf, each with its own bearing
//     (the main street's, the section line's, an old road's or the shore's),
//     its own block size, with or without alleys, gridded or curving — so
//     plats meet at angles at their seams, as additions platted decades apart
//     by different owners do.
//
// The old country roads that ran into the landing stay as diagonals cut
// through the plats (streets meet them at angles: the triangular and
// trapezoid blocks of a real Midwest town), the main street is the widest of
// them, and the interstate's 1960s cut is a reservation through the old town.
//
// Every size here is either island.mjs's own vocabulary (block pitches, lot
// ways, street widths, measured there) or a stated shape choice [K].
import { cut } from "../cities.mjs";
import { rect } from "../citygen.mjs";
import { makeRng, add, sub, mul, dist, norm, perp, dot, rdp, pointInRing, ringCentroid, ringAreaAbs, chaikinClosed, distToLine } from "./util.mjs";
import { NAME_A, NAME_B } from "./land.mjs";

// island.mjs's lot ways (frontage ranges and depth bands, in its own units)
const LOT = {
  burgage: [360, 900, 165, 48, 15],
  fine: [400, 950, 180, 26, 12],
  yard: [850, 2500, 360, 52, 5],
  villa: [500, 1150, 230, 20, 5],
  row: [360, 820, 165, 34, 7],
};
const ALLEY = 4.9; // island.mjs: a 16 ft alley

const STREETS = {
  default: ["Market St", "Church St", "Mill St", "Bridge St", "School St", "Spring St", "Union St", "Center St"],
  core: ["Main St", "Court St", "State St", "Washington St", "Jefferson St", "Madison St", "Monroe St", "Liberty St", "Franklin St", "Commerce St"],
  landing: ["Front St", "Water St", "Ferry St", "Dock St", "Levee St", "Wharf St", "Landing St", "River St"],
  industrial: ["Railroad Ave", "Depot St", "Foundry St", "Elevator St", "Mill Race Rd", "Freight St", "Cooper St", "Tannery St"],
  resi: [
    ["Elm St", "Oak St", "Maple St", "Walnut St", "Chestnut St", "Locust St", "Cherry St", "Hickory St"],
    ["Adams St", "Lincoln Ave", "Grant St", "Garfield Ave", "Harrison St", "Cleveland Ave", "Taylor St", "Polk St"],
    ["Prospect Ave", "Highland Ave", "Park Ave", "College Ave", "Summit St", "Fairview Ave", "Belmont Ave", "Grove St"],
    ["Sycamore St", "Linden St", "Poplar St", "Cedar St", "Willow St", "Birch St", "Ash St", "Juniper St"],
    ["Wells St", "Porter St", "Hawley St", "Kimball St", "Bryant St", "Tilden St", "Mercer St", "Dorsey St"],
  ],
};
const ADDITION = ["Addition", "Addition", "Heights", "Park", "Place", "Hill"];
const SURNAME = ["Kimball", "Porter", "Hawley", "Bryant", "Mercer", "Tilden", "Wells", "Dorsey", "Fenn", "Garrett", "Hollis", "Ingram", "Lowry", "Pruitt", "Sackett", "Varney"];
const bearingOf = (v) => (Math.atan2(v[1], v[0]) * 180) / Math.PI;

/**
 * The island-generator config for the region's main town.
 *  ring: the outline (world metres); centre; wet: unit vector toward the water; roads: { main, others, freeways }
 *  (polylines, world metres); land: { rS, ind } on world points.
 */
export function townConfig({ seed, ring, centre, wet, roads, land, center: lonlat, name, abbr }) {
  const rng = makeRng("town:" + seed);
  const R = (a, b) => rng.range(a, b);
  const shore = perp(wet);                    // along the waterfront
  const inland = mul(wet, -1);
  const mainDir = roads.main && roads.main.length > 1 ? norm(sub(farthest(roads.main, centre), centre)) : inland;
  const mainDeg = bearingOf(mainDir), shoreDeg = bearingOf(shore);

  // the town's ground, sampled
  const STEP = 25, samples = [];
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += STEP) for (let y = Math.min(...ys); y <= Math.max(...ys); y += STEP) if (pointInRing([x, y], ring)) samples.push([x, y]);
  const areaOf = (pts) => pts.length * STEP * STEP;

  // A CUT is a line through a point at a bearing; side() says which half a point is on (the "neg" half is
  // n.p <= d, as cities.mjs cut() defines it)
  const mkCut = (p, deg) => { const c = cut(p[0], p[1], deg); return { c, neg: (q) => q[0] * c[0] + q[1] * c[1] <= c[2] }; };
  const quantileAlong = (pts, dir, q) => { const s = pts.map((p) => dot(p, dir)).sort((a, b) => a - b); return s[Math.max(0, Math.min(s.length - 1, Math.round(q * (s.length - 1))))]; };
  const pointAtProj = (dir, s, through) => add(through, mul(dir, s - dot(through, dir)));

  const districts = {}, names = {}, streets = { default: STREETS.default }, labels = [];
  let resiN = 0;
  const leaf = (key, pts, spec, display, pool) => {
    districts[key] = spec; names[key] = display; streets[key] = pool;
    const c = ringCentroid(pts.length ? pts : [centre]);
    labels.push({ name: display.toUpperCase(), labelKind: "district", xy: [Math.round(c[0]), Math.round(c[1])] });
    return key;
  };

  // --- the waterfront band and the uplands
  const t1 = R(60, 180);
  const bandCut = mkCut(pointAtProj(inland, dot(centre, inland) + t1, centre), shoreDeg); // a line along the shore
  const bandIsNeg = bandCut.neg(add(centre, mul(wet, 300)));
  const inBand = (p) => bandCut.neg(p) === bandIsNeg;
  const band = samples.filter(inBand), uplands = samples.filter((p) => !inBand(p));

  // the band: downtown in the middle, the landing in front of it, the mill district or an old quarter either side
  const wL = R(170, 300), wR = R(170, 300);
  const cutL = mkCut(add(centre, mul(shore, -wL)), bearingOf(wet));
  const cutR = mkCut(add(centre, mul(shore, wR)), bearingOf(wet));
  const leftIsNeg = cutL.neg(add(centre, mul(shore, -wL - 100)));
  const rightIsNeg = cutR.neg(add(centre, mul(shore, wR + 100)));
  const onLeft = (p) => cutL.neg(p) === leftIsNeg, onRight = (p) => cutR.neg(p) === rightIsNeg;
  const landingDepth = R(130, 230);
  const landCut = mkCut(add(centre, mul(wet, landingDepth)), shoreDeg);
  const landIsNeg = landCut.neg(add(centre, mul(wet, landingDepth + 200)));

  const landingOrganic = rng() < 0.55;
  const landingSpec = landingOrganic
    ? { flavor: "old", bearingDeg: shoreDeg + R(-6, 6), fullBlockP: 0.02, lot: LOT.burgage, lotWay: "burgage", kind: "organic", cell: [Math.round(R(2100, 2800)), Math.round(R(4800, 6200))], jitterDeg: Math.round(R(13, 19)), streetW: Math.round(R(9, 12)) }
    : { flavor: "old", bearingDeg: shoreDeg + R(-4, 4), ...(rng() < 0.5 ? { alley: ALLEY } : {}), fullBlockP: 0.02, lot: LOT.burgage, lotWay: "burgage", kind: "lattice", stPitch: Math.round(R(64, 82)), avePitch: Math.round(R(170, 240)), streetW: Math.round(R(12, 14)), aveW: Math.round(R(16, 24)), warpAmp: Math.round(R(3, 7)), numbered: false };
  const coreBearing = rng() < 0.6 ? shoreDeg + R(-3, 3) : mainDeg + R(-3, 3);
  const coreSpec = rng() < 0.8
    ? { flavor: "core", bearingDeg: coreBearing, fullBlockP: 0.05, lot: LOT.fine, lotWay: "fine", kind: "lattice", stPitch: Math.round(R(80, 104)), avePitch: Math.round(R(110, 190)), streetW: Math.round(R(15, 19)), aveW: Math.round(R(18, 24)), warpAmp: Math.round(R(1, 4)), numbered: rng() < 0.5 }
    : { flavor: "core", bearingDeg: coreBearing, fullBlockP: 0.05, lot: LOT.fine, lotWay: "fine", kind: "chamfer", regular: true, stPitch: 105, avePitch: 105, streetW: 18, aveW: 18, chamferAll: 0.16, warpAmp: 0 };

  const sidePlat = (pts, which) => {
    const indShare = pts.length ? pts.filter((p) => land.ind(p)).length / pts.length : 0;
    if (indShare > 0.25) {
      const riverDeg = shoreDeg + R(-10, 10);
      return leaf(`mills${which}`, pts, { flavor: "industrial", bearingDeg: riverDeg, fullBlockP: 0.11, lot: LOT.yard, lotWay: "yard", kind: "lattice", stPitch: Math.round(R(105, 150)), avePitch: Math.round(R(150, 360)), streetW: Math.round(R(18, 22)), aveW: Math.round(R(20, 30)), warpAmp: Math.round(R(2, 8)), numbered: false },
        which === "a" ? "The Mill District" : "The Flats", STREETS.industrial);
    }
    return leaf(`oldtown${which}`, pts, { flavor: "old", bearingDeg: shoreDeg + R(-12, 12), ...(rng() < 0.5 ? { alley: ALLEY } : {}), fullBlockP: 0.02, lot: rng() < 0.5 ? LOT.row : LOT.fine, lotWay: "row", kind: "lattice", stPitch: Math.round(R(70, 95)), avePitch: Math.round(R(150, 230)), streetW: Math.round(R(12, 16)), aveW: Math.round(R(14, 20)), warpAmp: Math.round(R(3, 8)), numbered: false },
      which === "a" ? "Lower Town" : "Old Town", STREETS.landing);
  };
  const leftPts = band.filter(onLeft), rightPts = band.filter(onRight), midPts = band.filter((p) => !onLeft(p) && !onRight(p));
  const landingKey = leaf("landing", midPts.filter((p) => landCut.neg(p) === landIsNeg), landingSpec, "The Landing", STREETS.landing);
  const coreKey = leaf("downtown", midPts.filter((p) => landCut.neg(p) !== landIsNeg), coreSpec, "Downtown", STREETS.core);
  const leftKey = leftPts.length > 30 ? sidePlat(leftPts, "a") : coreKey;
  const rightKey = rightPts.length > 30 ? sidePlat(rightPts, "b") : coreKey;
  const bandTree = {
    cut: cutL.c, ...(leftIsNeg ? { neg: leftKey, pos: null } : { pos: leftKey, neg: null }),
  };
  const midTree = { cut: landCut.c, ...(landIsNeg ? { neg: landingKey, pos: coreKey } : { pos: landingKey, neg: coreKey }) };
  const rightTree = { cut: cutR.c, ...(rightIsNeg ? { neg: rightKey, pos: midTree } : { pos: rightKey, neg: midTree }) };
  if (leftIsNeg) bandTree.pos = rightTree; else bandTree.neg = rightTree;

  // --- the uplands: additions, split until each is a plat a single owner could have surveyed
  const MIN_LEAF = 160_000, MAX_LEAF = 420_000;   // m2: ~40-100 acres a plat [K]
  const roadDegs = [mainDeg, ...(roads.others ?? []).map((r) => bearingOf(sub(r.at(-1), r[0])))];
  const SURVEY = 0;                               // the section lines run cardinal (land.mjs keeps the survey cardinal)
  const split = (pts, depth) => {
    if (pts.length === 0) return coreKey;
    const area = areaOf(pts);
    if (depth >= 4 || area < MIN_LEAF * 2 || (area < MAX_LEAF && rng() < 0.4)) return addition(pts);
    const c = ringCentroid(pts);
    const options = [mainDeg, mainDeg + 90, SURVEY, SURVEY + 90, ...roadDegs, shoreDeg];
    for (let tries = 0; tries < 6; tries++) {
      const deg = options[Math.floor(rng() * options.length)] + R(-8, 8);
      const n = [Math.cos(((deg + 90) * Math.PI) / 180), Math.sin(((deg + 90) * Math.PI) / 180)];
      const s = quantileAlong(pts, n, R(0.35, 0.65));
      const k = mkCut(pointAtProj(n, s, c), deg);
      const a = pts.filter(k.neg), b = pts.filter((p) => !k.neg(p));
      if (areaOf(a) < MIN_LEAF || areaOf(b) < MIN_LEAF) continue;
      return { cut: k.c, neg: split(a, depth + 1), pos: split(b, depth + 1) };
    }
    return addition(pts);
  };
  function addition(pts) {
    const i = resiN++;
    const c = ringCentroid(pts);
    const rs = land.rS(c);
    const inner = rs < 420;
    // the addition's bearing: the street it was platted along, the survey, or the shore; never quite square
    const near = [roads.main, ...(roads.others ?? [])].filter(Boolean).map((r) => ({ r, d: distToLine(c, r) })).sort((a, b) => a.d - b.d)[0];
    const roadDeg = near && near.d < 350 ? bearingOf(sub(near.r.at(-1), near.r[0])) : null;
    const bearing = (roadDeg !== null && rng() < 0.55 ? roadDeg : rng() < 0.6 ? SURVEY + (rng() < 0.5 ? 0 : 90) : shoreDeg) + R(-4, 4);
    const pool = STREETS.resi[i % STREETS.resi.length];
    const named = `${rng.pick(SURNAME)}'s ${rng.pick(ADDITION)}`;
    let spec;
    const roll = rng();
    if (inner && roll < 0.65) {
      // a streetcar-era addition: a grid of narrow deep house lots, alleys behind most of them
      spec = { flavor: "resi", bearingDeg: bearing, ...(rng() < 0.7 ? { alley: ALLEY } : {}), fullBlockP: 0.02, lot: rng() < 0.6 ? LOT.row : LOT.fine, lotWay: "row", kind: "lattice", stPitch: Math.round(R(72, 100)), avePitch: Math.round(R(170, 270)), streetW: Math.round(R(14, 18)), aveW: Math.round(R(15, 22)), warpAmp: Math.round(R(2, 9)), numbered: rng() < 0.3 };
    } else if (roll < 0.35) {
      // a romantic suburb: streets that bend with the ground
      spec = { flavor: "resi", bearingDeg: bearing, fullBlockP: 0.02, lot: LOT.villa, lotWay: "villa", kind: "curvi", stPitch: Math.round(R(85, 105)), avePitch: Math.round(R(110, 200)), streetW: Math.round(R(15, 19)), aveW: Math.round(R(15, 20)), curveLen: Math.round(R(380, 640)), curveAmp: Math.round(R(70, 130)) };
    } else if (roll < 0.5) {
      // an old irregular quarter, lanes before any survey reached it
      spec = { flavor: "resi", bearingDeg: bearing, fullBlockP: 0.02, lot: LOT.fine, lotWay: "fine", kind: "organic", cell: [Math.round(R(2600, 4400)), Math.round(R(6000, 9200))], jitterDeg: Math.round(R(12, 20)), streetW: Math.round(R(11, 14)) };
    } else {
      // a later addition on bigger lots, no alleys
      spec = { flavor: "resi", bearingDeg: bearing, ...(rng() < 0.25 ? { alley: ALLEY } : {}), fullBlockP: 0.02, lot: rng() < 0.5 ? LOT.villa : LOT.fine, lotWay: "villa", kind: "lattice", stPitch: Math.round(R(90, 125)), avePitch: Math.round(R(150, 300)), streetW: Math.round(R(15, 19)), aveW: Math.round(R(15, 22)), warpAmp: Math.round(R(2, 10)), numbered: false };
    }
    // BLOCKS GROW WITH DISTANCE (owner): an addition platted further out, on cheaper land, was cut in
    // bigger blocks — up to ~1.5x the pitch at the town's edge, smoothly by story distance, with each
    // plat's own variance [K]. The lots inside grow too (citygen.mjs LOTS GROW TOWARD THE EDGE).
    const gs = (1 + 0.5 * smooth01((rs - 200) / 600)) * R(0.9, 1.1);
    if (spec.stPitch) { spec.stPitch = Math.round(spec.stPitch * gs); spec.avePitch = Math.round(spec.avePitch * gs); }
    if (spec.cell) spec.cell = spec.cell.map((v) => Math.round(v * gs * gs));
    if (spec.curveLen) spec.curveLen = Math.round(spec.curveLen * gs);
    return leaf(`add${i + 1}`, pts, spec, named, pool);
  }
  const upTree = split(uplands, 0);
  const partition = { cut: bandCut.c, ...(bandIsNeg ? { neg: bandTree, pos: upTree } : { pos: bandTree, neg: upTree }) };

  // --- the roads that ran into the landing, as reservations through the plats
  const diagonals = [];
  const inTown = (p) => pointInRing(p, ring);
  const reserve = (pl, h, maxSegs) => {
    if (!pl || pl.length < 2) return;
    const inside = pl.filter((p, i) => inTown(p) || (i > 0 && inTown(pl[i - 1])) || (i < pl.length - 1 && inTown(pl[i + 1])));
    if (inside.length < 2) return;
    const simp = rdp(inside, 22);
    let n = 0;
    for (let i = 0; i + 1 < simp.length && n < maxSegs; i++) {
      const a = simp[i], b = simp[i + 1], L = dist(a, b);
      if (L < 60) continue;
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      diagonals.push({ cx: Math.round(m[0]), cy: Math.round(m[1]), w: Math.round(L + 14), h, deg: +bearingOf(sub(b, a)).toFixed(1) });
      n++;
    }
  };
  for (const f of roads.freeways ?? []) reserve(f, 36, 4);         // the 1960s cut: ~80 m taken, a 36 m reservation kept [K]
  reserve(roads.main, Math.round(R(18, 22)), 4);                  // the main street, the widest of the old roads
  for (const r of roads.others ?? []) reserve(r, Math.round(R(12, 15)), 3);

  // --- greens: the courthouse square, sometimes a riverside park and a neighbourhood park
  const parks = [];
  const fits = (ringP) => ringP.every(inTown) && !diagonals.some((d) => ringP.some((q) => diagHit(d, q, 14)));
  const tryPark = (c, w, h, deg, name, flavour) => {
    const r = rect(c[0], c[1], w, h, deg);
    if (!fits(r)) return false;
    parks.push({ cx: Math.round(c[0]), cy: Math.round(c[1]), w: Math.round(w), h: Math.round(h), deg: +deg.toFixed(1), name, ring: r.map((p) => [Math.round(p[0]), Math.round(p[1])]), shape: "square", flavour });
    return true;
  };
  for (let k = 0; k < 8; k++) if (tryPark(add(centre, add(mul(inland, 110 + 30 * k), mul(shore, R(-60, 60)))), R(75, 100), R(75, 100), coreBearing, "Courthouse Square", "park")) break;
  if (rng() < 0.6) for (let k = 0; k < 6; k++) if (tryPark(add(centre, add(mul(wet, landingDepth + 40 - 15 * k), mul(shore, R(-260, 260)))), R(110, 180), R(40, 60), shoreDeg, "Riverfront Park", "park")) break;
  if (rng() < 0.6) {
    const far = samples.filter((p) => land.rS(p) > 380 && land.rS(p) < 600);
    for (let k = 0; k < 6 && far.length; k++) { const p = far[Math.floor(rng() * far.length)]; if (tryPark(p, R(70, 110), R(60, 90), R(0, 90), `${rng.pick(SURNAME)} Park`, "park")) break; }
  }

  // --- the heat: a small downtown, the main street, the mills, the far additions
  const landingPt = samples.filter((p) => land.rS(p) < 200).sort((a, b) => dot(b, wet) - dot(a, wet))[0] ?? centre;
  const millPts = samples.filter((p) => land.ind(p) && dist(p, centre) > 300);
  const cores = [
    { xy: round(add(centre, mul(inland, 60))), w: 1, r: Math.round(R(210, 250)), role: "core" },
    { xy: round(add(centre, mul(mainDir, R(380, 520)))), w: +R(0.4, 0.5).toFixed(2), r: Math.round(R(230, 270)), role: "mid" },
  ];
  if (millPts.length > 20) cores.push({ xy: round(ringCentroid(millPts)), w: 0.55, r: Math.round(R(160, 190)), role: "ind" });
  const farPts = samples.filter((p) => land.rS(p) > 500);
  if (farPts.length) cores.push({ xy: round(ringCentroid(farPts)), w: +R(0.06, 0.12).toFixed(2), r: Math.round(R(220, 270)), role: "up" });

  const avenues = ["Broadway", "Grand Ave", "River Rd", "Central Ave", "Lake St", "Division St", "Ridge Rd"];
  return {
    name, district: name.toLowerCase().replace(/[^a-z]/g, ""), abbr, seed, generated: true,
    center: lonlat,
    coast: ring.map(round),
    coastAmp: 6, smooth: 1, esplanade: 14,
    lighthouse: false,
    cores, partition, districts, districtNames: names,
    parks, diagonals, streams: [], bridges: [], piers: [], cranes: [], ships: [], breakwaters: [], stations: [],
    labels, frontagePlat: true, avenues, streets,
    plan: { harbour: round(landingPt), cove: round(millPts.length ? ringCentroid(millPts) : landingPt), headland: round(landingPt), landmark: "church", seams: 0, mid: round(centre) },
  };
}

/** A village on one bank: one or two plats along the river road. */
export function villageConfig({ seed, rect: t, wet, center: lonlat, name, abbr }) {
  const rng = makeRng("village:" + seed);
  const R = (a, b) => rng.range(a, b);
  // a softly irregular outline round the platted blocks
  const base = t.poly().map((p) => add(p, mul(norm(sub(p, t.c)), R(10, 40))));
  const ring = chaikinClosed(base, 2).map(round);
  const deg = bearingOf(t.u) + R(-3, 3);
  const pitch = Math.round(t.pitch ?? 100);
  const one = { flavor: "old", bearingDeg: deg, ...(rng() < 0.4 ? { alley: ALLEY } : {}), fullBlockP: 0.03, lot: LOT.fine, lotWay: "fine", kind: "lattice", stPitch: pitch, avePitch: Math.round(pitch * R(1.0, 1.6)), streetW: Math.round(R(13, 16)), aveW: Math.round(R(15, 20)), warpAmp: Math.round(R(2, 6)), numbered: false };
  const two = { ...one, flavor: "resi", bearingDeg: deg + R(-12, 12), lot: LOT.villa, lotWay: "villa", stPitch: Math.round(pitch * R(1.0, 1.25)) };
  const c = mkCutAt(t.c, bearingOf(wet) + 90);
  const k1 = "village", k2 = "villageup";
  const wetIsNeg = c.neg(add(t.c, mul(wet, 50)));
  const partition = { cut: c.c, ...(wetIsNeg ? { neg: k1, pos: k2 } : { pos: k1, neg: k2 }) };
  return {
    name, district: name.toLowerCase().replace(/[^a-z]/g, ""), abbr, seed, generated: true,
    center: lonlat, coast: ring, coastAmp: 4, smooth: 1, esplanade: 10, lighthouse: false,
    cores: [{ xy: round(add(t.c, mul(wet, 40))), w: 0.55, r: 140, role: "core" }],
    partition, districts: { [k1]: one, [k2]: two }, districtNames: { [k1]: name, [k2]: `${name} Heights` },
    parks: [], diagonals: [], streams: [], bridges: [], piers: [], cranes: [], ships: [], breakwaters: [], stations: [],
    labels: [{ name: name.toUpperCase(), labelKind: "district", xy: round(t.c) }], frontagePlat: true,
    avenues: ["Main St", "River Rd"], streets: { default: ["Main St", "Mill St", "Church St", "Ferry St", "School St", "Elm St", "Oak St"] },
    plan: { harbour: round(add(t.c, mul(wet, 150))), cove: round(t.c), headland: round(t.c), landmark: "church", seams: 0, mid: round(t.c) },
  };
}

const smooth01 = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };
function mkCutAt(p, deg) { const c = cut(p[0], p[1], deg); return { c, neg: (q) => q[0] * c[0] + q[1] * c[1] <= c[2] }; }
function round(p) { return [Math.round(p[0]), Math.round(p[1])]; }
function farthest(pl, c) { let b = pl[0]; for (const p of pl) if (dist(p, c) > dist(b, c)) b = p; return dist(b, c) > 1 ? b : pl.at(-1); }
/** Is q within `pad` of a diagonal reservation? */
function diagHit(d, q, pad) {
  const t = (d.deg * Math.PI) / 180, u = [Math.cos(t), Math.sin(t)], v = [-u[1], u[0]];
  const r = sub(q, [d.cx, d.cy]);
  return Math.abs(dot(r, u)) <= d.w / 2 + pad && Math.abs(dot(r, v)) <= d.h / 2 + pad;
}
export { ringAreaAbs };
